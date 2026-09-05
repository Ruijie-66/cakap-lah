// test/routes.test.js — HTTP-level tests for the evaluate/summarise/scenarios
// routes. Boots the real express app on an ephemeral port in mock mode
// (?mock=1), so the suite is hermetic: it needs no API key and makes no
// outbound network call.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import app from '../server/index.js';
import {
  FALLBACK_WARN_THRESHOLD,
  noteEvaluatorFallback,
  noteEvaluatorSuccess,
  consecutiveFallbackCount,
  resetFallbackStreak,
} from '../server/adapters/evaluator.js';
import { validateLlmProvider, SUPPORTED_LLM_PROVIDERS } from '../server/config.js';
import { COMPLETE } from '../server/game/branching.js';

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
});

/** POST helper. `query` is appended verbatim (e.g. '&fail=json'). */
async function post(path, body, query = '') {
  const res = await fetch(`${base}${path}?mock=1${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const turn = (over = {}) => ({
  scenario_id: 'mamak_01',
  step_id: 'order',
  level: 1,
  stt_transcript: 'saya nak teh tarik satu kurang manis',
  conversation_history: [],
  ...over,
});

// ---------------------------------------------------------------------------

test('GET /api/health responds', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('/api/evaluate returns the full scored turn shape', async () => {
  const { status, body } = await post('/api/evaluate', turn());
  assert.equal(status, 200);
  assert.equal(body.scored, true);
  assert.ok(['success', 'partial', 'retry'].includes(body.result));
  assert.ok(['power', 'passed', 'almost', 'retry'].includes(body.band));
  assert.equal(typeof body.band_label, 'string');
  assert.equal(typeof body.npc_state, 'string', 'npc_state is always present');
  assert.equal(typeof body.next_step_id, 'string', 'next_step_id is always present');
  assert.equal(typeof body.overall_score, 'number');
  assert.equal(typeof body.npc_reply, 'string');
  assert.equal(body.free_retry, false);
  assert.equal(typeof body.complete, 'boolean');
  // overall is recomputed server-side with the 40/25/20/15 weights.
  const expected = Math.round(
    0.4 * body.intent_score +
      0.25 * body.semantic_score +
      0.2 * body.comprehensibility_score +
      0.15 * body.naturalness_score,
  );
  if (!body.retry_capped) assert.equal(body.overall_score, expected);
});

test('/api/evaluate short-circuits an empty transcript: free retry, no score, same step', async () => {
  for (const transcript of ['', '   ', '\n\t ', '...!!!']) {
    const { status, body } = await post('/api/evaluate', turn({ stt_transcript: transcript }));
    assert.equal(status, 200);
    assert.equal(body.result, 'no_input');
    assert.equal(body.scored, false);
    assert.equal(body.free_retry, true);
    assert.equal(body.overall_score, null);
    assert.equal(body.band, null);
    assert.equal(body.intent_pass, null);
    assert.equal(body.source, 'short_circuit');
    assert.equal(body.fallback, false);
    assert.equal(body.next_step_id, 'order', 'stays on the same step');
    assert.equal(body.complete, false);
    assert.equal(typeof body.npc_state, 'string');
  }
});

test('/api/evaluate rejects a step that is not part of the requested level', async () => {
  // `upsell` is L3-only in mamak_01.
  const { status, body } = await post('/api/evaluate', turn({ step_id: 'upsell', level: 1 }));
  assert.equal(status, 400);
  assert.match(body.error, /upsell/);
  assert.match(body.error, /level 1/);
  // ...and is accepted at L3.
  const ok = await post('/api/evaluate', turn({ step_id: 'upsell', level: 3 }));
  assert.equal(ok.status, 200);
});

test('/api/evaluate validates its inputs', async () => {
  assert.equal((await post('/api/evaluate', turn({ scenario_id: '' }))).status, 400);
  assert.equal((await post('/api/evaluate', turn({ step_id: '' }))).status, 400);
  assert.equal((await post('/api/evaluate', turn({ level: 9 }))).status, 400);
  assert.equal((await post('/api/evaluate', turn({ stt_transcript: 42 }))).status, 400);
  assert.equal((await post('/api/evaluate', turn({ conversation_history: 'x' }))).status, 400);
  assert.equal((await post('/api/evaluate', turn({ scenario_id: 'nope' }))).status, 404);
  assert.equal((await post('/api/evaluate', turn({ step_id: 'nope' }))).status, 404);
});

test('/api/evaluate routes the last L1 step to __complete__', async () => {
  const { body } = await post('/api/evaluate', turn({ step_id: 'wrong_order', stt_transcript: 'x' }));
  // wrong_order -> upsell (L3-only) resolves forward to COMPLETE at L1 unless
  // the mock returned `retry`, which loops on the same step.
  if (body.result === 'retry') {
    assert.equal(body.next_step_id, 'wrong_order');
    assert.equal(body.complete, false);
  } else {
    assert.equal(body.next_step_id, COMPLETE);
    assert.equal(body.complete, true);
  }
});

test('/api/evaluate retry cap: 2 retries later the run advances with partial credit', async () => {
  // A one-word transcript makes the mock return `retry` deterministically.
  const short = { stt_transcript: 'apa' };
  const first = await post('/api/evaluate', turn({ ...short, retry_count: 0 }));
  assert.equal(first.body.result, 'retry');
  assert.equal(first.body.retry_capped, false);

  const capped = await post('/api/evaluate', turn({ ...short, retry_count: 2 }));
  assert.equal(capped.body.result, 'partial');
  assert.equal(capped.body.retry_capped, true);
  assert.ok(capped.body.overall_score >= 55, 'clamped to at least 55');
  assert.notEqual(capped.body.next_step_id, 'order', 'the run advances, it does not dead-end');
});

test('/api/evaluate ?fail=json falls back inside the partial band without penalty', async () => {
  const { status, body } = await post('/api/evaluate', turn(), '&fail=json');
  assert.equal(status, 200);
  assert.equal(body.fallback, true);
  assert.equal(body.source, 'fallback');
  assert.ok(body.overall_score >= 55 && body.overall_score <= 74, 'stays in the partial band');
  assert.notEqual(body.result, 'retry', 'a system failure never costs points');
  assert.equal(typeof body.npc_state, 'string');
});

test('/api/evaluate ?fail=eval degrades to the fallback instead of dead-ending on a 502', async () => {
  const { status, body } = await post('/api/evaluate', turn(), '&fail=eval');
  assert.equal(status, 200, 'the demo must never dead-end');
  assert.equal(body.fallback, true);
  assert.equal(body.source, 'fallback');
  assert.ok(body.overall_score >= 55 && body.overall_score <= 74);
  assert.notEqual(body.result, 'retry');
  assert.equal(typeof body.next_step_id, 'string');
});

test('/api/summarise returns the end-screen shape', async () => {
  const payload = {
    scenario_id: 'mamak_01',
    level: 1,
    conversation: [{ npc: 'Nak minum apa?', player: 'teh tarik one, less sweet' }],
    turn_scores: [{ overall_score: 80 }],
  };
  const { status, body } = await post('/api/summarise', payload);
  assert.equal(status, 200);
  assert.equal(body.scenario_id, 'mamak_01');
  assert.equal(typeof body.overall_score, 'number');
  assert.ok(['power', 'mission_passed', 'almost', 'retry'].includes(body.band));
  assert.equal(typeof body.band_label, 'string');
  assert.equal(typeof body.verdict, 'string');
  assert.ok(Array.isArray(body.bm_upgrades));
  assert.ok(Array.isArray(body.strengths));
  assert.ok(Array.isArray(body.improvements));

  const failed = await post('/api/summarise', payload, '&fail=eval');
  assert.equal(failed.status, 200, 'the end screen never crashes');
  assert.equal(failed.body.fallback, true);
});

test('GET /api/scenarios/:id never leaks answer keys and uses the COMPLETE sentinel', async () => {
  const res = await fetch(`${base}/api/scenarios/mamak_01?level=1`);
  assert.equal(res.status, 200);
  const text = await res.text();
  for (const field of ['sample_answers', 'expected_semantics', 'fallback_concepts', 'key_concepts']) {
    assert.ok(!text.includes(field), `leaks ${field}`);
  }
  const pub = JSON.parse(text);
  assert.equal(pub.first_step_id, 'order');
  // Every branch target the client sees is level-resolved and routable.
  const ids = new Set(pub.steps.map((s) => s.id));
  for (const step of pub.steps) {
    for (const target of Object.values(step.branches)) {
      assert.ok(target === COMPLETE || ids.has(target), `unroutable branch target ${target}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Guardrails added by the review
// ---------------------------------------------------------------------------

test('the evaluator warns loudly after N consecutive fallbacks', () => {
  resetFallbackStreak();
  const seen = [];
  const original = console.warn;
  console.warn = (msg) => seen.push(String(msg));
  try {
    for (let i = 0; i < FALLBACK_WARN_THRESHOLD; i += 1) noteEvaluatorFallback('no_api_key');
  } finally {
    console.warn = original;
  }
  assert.equal(consecutiveFallbackCount(), FALLBACK_WARN_THRESHOLD);
  assert.equal(seen.length, 1, 'exactly one warning per threshold crossing');
  assert.match(seen[0], /fallen back 3 times in a row/);
  assert.match(seen[0], /LLM_PROVIDER/);

  noteEvaluatorSuccess();
  assert.equal(consecutiveFallbackCount(), 0, 'a real LLM success clears the streak');
  resetFallbackStreak();
});

test('an unknown LLM_PROVIDER warns unmistakably instead of failing silently', () => {
  const seen = [];
  assert.equal(validateLlmProvider('openal', (m) => seen.push(String(m))), 'openai');
  assert.equal(seen.length, 1);
  assert.match(seen[0], /WARNING/);
  assert.match(seen[0], /not recognised/);
  for (const provider of SUPPORTED_LLM_PROVIDERS) {
    const quiet = [];
    assert.equal(validateLlmProvider(provider, (m) => quiet.push(m)), provider);
    assert.equal(quiet.length, 0, `${provider} must not warn`);
  }
});
