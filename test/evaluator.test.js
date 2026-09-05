import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateTurnOutput,
  validateSummaryOutput,
  TURN_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  TURN_SCHEMA,
  SUMMARY_SCHEMA,
  evaluate as liveEvaluate,
  summarise as liveSummarise,
} from '../server/adapters/evaluator.js';
import * as mock from '../server/adapters/mock.js';
import { getScenario, publicScenario, ANSWER_KEY_FIELDS } from '../server/game/scenarios.js';
import { findStep } from '../server/game/branching.js';
import { computeOverall, PARTIAL_BAND } from '../server/game/scoring.js';
import { hasLlmKey, LLM_PROVIDER } from '../server/config.js';

// These two assertions describe the "no key configured" branch. When the
// developer running the suite DOES have a key in .env we skip them rather than
// make a real network call from a unit test.
const skipIfKey = hasLlmKey()
  ? { skip: `LLM_PROVIDER=${LLM_PROVIDER} has a key configured` }
  : {};

const scenario = getScenario('mamak_01');
const step = findStep(scenario, 'order');

const GOOD_TURN = {
  intent_pass: true,
  intent_score: 92,
  semantic_score: 88,
  comprehensibility_score: 90,
  naturalness_score: 82,
  overall_score: 12345, // deliberately wrong — the server recomputes
  result: 'nonsense',
  what_worked: 'Jelas.',
  improvement: 'Tambah "boleh".',
  npc_reply: 'Ok boss.',
  branch: 'success',
};

test('validateTurnOutput accepts a well-formed object and normalises it', () => {
  const out = validateTurnOutput(GOOD_TURN);
  assert.equal(out.intent_score, 92);
  assert.equal(out.npc_reply, 'Ok boss.');
  assert.equal(computeOverall(out), 89); // recomputed, not the model's 12345
  assert.equal('overall_score' in out, false, 'model arithmetic is discarded');
});

test('validateTurnOutput rejects malformed output', () => {
  const bad = [
    null,
    'not an object',
    [],
    { ...GOOD_TURN, intent_pass: 'yes' },
    { ...GOOD_TURN, intent_score: 'high' },
    { ...GOOD_TURN, semantic_score: 140 },
    { ...GOOD_TURN, naturalness_score: NaN },
    { ...GOOD_TURN, npc_reply: '' },
    (() => { const o = { ...GOOD_TURN }; delete o.what_worked; return o; })(),
  ];
  for (const b of bad) assert.throws(() => validateTurnOutput(b), `should reject ${JSON.stringify(b)}`);
});

test('validateSummaryOutput accepts and filters', () => {
  const out = validateSummaryOutput({
    overall_score: 84,
    band: 'mission_passed',
    verdict: 'Dah boleh cakap.',
    summary: 'Bagus.',
    strengths: ['a', '', 3],
    improvements: ['b'],
    bm_upgrades: [{ you_said: 'less sweet', try: 'kurang manis' }, { bogus: 1 }],
  });
  assert.deepEqual(out.strengths, ['a']);
  assert.deepEqual(out.bm_upgrades, [{ you_said: 'less sweet', try: 'kurang manis' }]);
});

test('validateSummaryOutput rejects a missing bm_upgrades array', () => {
  assert.throws(() =>
    validateSummaryOutput({ overall_score: 80, verdict: 'x', summary: 'y', strengths: [], improvements: [] }),
  );
});

test('prompts carry the required rules verbatim', () => {
  assert.match(TURN_SYSTEM_PROMPT, /Never require exact wording/);
  assert.match(TURN_SYSTEM_PROMPT, /\{allowed_code_switch\}/);
  assert.match(TURN_SYSTEM_PROMPT, /Never penalise casual register/);
  assert.match(TURN_SYSTEM_PROMPT, /1–2 sentences/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /bm_upgrades/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /NOT an average/);
});

test('structured-output schemas require every field', () => {
  assert.equal(TURN_SCHEMA.additionalProperties, false);
  assert.equal(TURN_SCHEMA.required.length, Object.keys(TURN_SCHEMA.properties).length);
  assert.equal(SUMMARY_SCHEMA.required.length, Object.keys(SUMMARY_SCHEMA.properties).length);
});

test('live evaluator with no API key falls back deterministically instead of throwing', skipIfKey, async () => {
  const out = await liveEvaluate({
    scenario,
    step,
    level: 1,
    levelConfig: { allowed_code_switch: 'beginner' },
    transcript: 'teh tarik satu kurang manis',
    conversationHistory: [],
  });
  assert.equal(out.fallback, true);
  assert.equal(out.fallback_reason, 'no_api_key');
  const overall = computeOverall(out);
  assert.ok(overall >= PARTIAL_BAND.min && overall <= PARTIAL_BAND.max);
});

test('forceMalformed (?fail=json) retries then falls back, in both adapters', async () => {
  for (const adapter of [liveEvaluate, mock.evaluate]) {
    const out = await adapter({
      scenario,
      step,
      level: 1,
      levelConfig: { allowed_code_switch: 'beginner' },
      transcript: 'teh tarik satu kurang manis',
      conversationHistory: [],
      forceMalformed: true,
    });
    assert.equal(out.fallback, true);
    assert.equal(out.fallback_reason, 'malformed_output');
    const overall = computeOverall(out);
    assert.ok(overall >= PARTIAL_BAND.min && overall <= PARTIAL_BAND.max, 'never penalised');
  }
});

// The ADAPTER still throws on ?fail=eval; the route no longer turns that into a
// 502 — it degrades to the deterministic fallback (see test/routes.test.js).
test('forceUpstreamError (?fail=eval) throws out of the adapter', async () => {
  await assert.rejects(() => mock.evaluate({ step, transcript: 'x', forceUpstreamError: true }));
  await assert.rejects(() => liveEvaluate({ step, transcript: 'x', forceUpstreamError: true }));
});

test('mock evaluate is varied — not always success', async () => {
  const transcripts = [
    'saya nak teh tarik satu kurang manis',
    'boleh bagi teh tarik kurang gula',
    'teh tarik satu bang jangan manis sangat',
    'bang saya nak minum teh',
    'eh sorry saya order teh tarik tadi bukan milo',
    'nak teh tarik less sweet please',
    'satu teh tarik ya',
    'apa ni',
  ];
  const results = new Set();
  for (const t of transcripts) {
    const out = await mock.evaluate({ step, transcript: t });
    results.add(out.intent_pass ? 'success-ish' : 'not-success');
  }
  assert.ok(results.size > 1, 'mock should not always return the same result');
});

test('mock summarise returns bm_upgrades harvested across the conversation', async () => {
  const out = await mock.summarise({
    conversation: [
      { npc: 'Ya boss, nak minum apa?', player: 'teh tarik one, less sweet' },
      { npc: 'Ni dia! Milo ais satu.', player: 'sorry bang, I order teh tarik' },
    ],
    turnScores: [{ overall_score: 70 }, { overall_score: 88 }],
  });
  assert.ok(Array.isArray(out.bm_upgrades));
  assert.ok(out.bm_upgrades.some((u) => u.try === 'kurang manis'));
  assert.equal(Number.isFinite(out.overall_score), true);
});

test('live summarise with no key falls back with an empty bm_upgrades array', skipIfKey, async () => {
  const out = await liveSummarise({ scenario, level: 1, conversation: [], turnScores: [{ overall_score: 80 }] });
  assert.equal(out.fallback, true);
  assert.deepEqual(out.bm_upgrades, []);
});

test('publicScenario strips every answer-key field at every level', () => {
  for (const id of ['mamak_01', 'mall_01', 'office_01']) {
    for (const level of [1, 2, 3]) {
      const pub = publicScenario(getScenario(id), level);
      const json = JSON.stringify(pub);
      for (const field of ANSWER_KEY_FIELDS) {
        assert.ok(!json.includes(field), `${id} L${level} leaks ${field}`);
      }
      for (const s of pub.steps) {
        assert.ok(s.npc_name && s.voice_id, 'per-step npc overrides resolved');
      }
    }
  }
});

test('publicScenario resolves the mall_01 makcik step override at L3', () => {
  const pub = publicScenario(getScenario('mall_01'), 3);
  const last = pub.steps[pub.steps.length - 1];
  assert.equal(last.id, 'give_directions');
  assert.equal(last.npc_name, 'Makcik');
  assert.notEqual(last.voice_id, pub.voice_id);
});
