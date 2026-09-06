// test/guardrails.test.js — the abuse guardrails added before public deploy.
//
// Two things are being proved here, and they pull in opposite directions:
//   * an attacker cannot use /api/tts as a free speech proxy, or drain the
//     upstream quota by hammering /api/*;
//   * nothing the GAME legitimately speaks is ever refused — every scenario,
//     every level, the coach line, the re-prompt and the closing line.
// The second half matters more: a wrongly-rejected line is silence on screen.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import app from '../server/index.js';
import {
  resetAllLimits,
  windows,
  COSTLY_PER_SESSION_MINUTE,
  COSTLY_PER_IP,
  GENERAL_PER_IP,
} from '../server/middleware/limits.js';
import { createWindow, clientKey, sessionKey } from '../server/middleware/rate-limit.js';
import {
  isSpeakable,
  registerSpoken,
  normaliseSpoken,
  staticSpokenLines,
  resetSpokenRegistry,
  MAX_SPOKEN_LENGTH,
} from '../server/game/spoken-text.js';
import { getScenario, listScenarios, completeFor, publicScenario } from '../server/game/scenarios.js';

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

beforeEach(() => {
  resetAllLimits();
});

/** One /api/tts call, as the browser makes it. */
async function speak(text, { session = 'testsession', query = '&mock=1' } = {}) {
  const res = await fetch(`${base}/api/tts?mock=1${query.replace('&mock=1', '')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': session },
    body: JSON.stringify({ text }),
  });
  return { status: res.status, res };
}

// ---------------------------------------------------------------------------
// The sliding window itself
// ---------------------------------------------------------------------------

test('sliding window allows up to max then refuses with a sane Retry-After', () => {
  const w = createWindow({ windowMs: 1000, max: 3 });
  const t0 = 1_000_000;
  assert.equal(w.check('a', t0).ok, true);
  assert.equal(w.check('a', t0 + 10).ok, true);
  assert.equal(w.check('a', t0 + 20).ok, true);

  const refused = w.check('a', t0 + 30);
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterS, 1, 'wait is the time until the oldest hit expires');

  // A different key has its own budget.
  assert.equal(w.check('b', t0 + 30).ok, true);

  // The window slides: once the first hit ages out, one slot frees up.
  assert.equal(w.check('a', t0 + 1001).ok, true);
  assert.equal(w.check('a', t0 + 1002).ok, false);
});

test('peek never charges, so a later window refusing does not burn an earlier budget', () => {
  const w = createWindow({ windowMs: 1000, max: 2 });
  assert.equal(w.peek('a', 0).ok, true);
  assert.equal(w.peek('a', 0).ok, true);
  assert.equal(w.count('a', 0), 0, 'peek recorded nothing');
  w.charge('a', 0);
  assert.equal(w.count('a', 0), 1);
});

test('the key map cannot grow without bound when a caller rotates ids', () => {
  const w = createWindow({ windowMs: 60_000, max: 5, maxKeys: 10 });
  for (let i = 0; i < 500; i += 1) w.check(`rotating-${i}`, 1000 + i);
  assert.ok(w.size() <= 11, `bounded, got ${w.size()}`);
});

test('clientKey normalises the IPv4-mapped IPv6 form to one budget', () => {
  assert.equal(clientKey({ ip: '::ffff:203.0.113.7' }), '203.0.113.7');
  assert.equal(clientKey({ ip: '203.0.113.7' }), '203.0.113.7');
  assert.equal(clientKey({ socket: { remoteAddress: '198.51.100.4' } }), '198.51.100.4');
  assert.equal(clientKey({}), 'unknown', 'never an empty key — that would merge all callers');
});

test('sessionKey is sanitised and length-capped — it is caller-controlled input', () => {
  const req = (v) => ({ get: () => v });
  assert.equal(sessionKey(req('abc-123_XYZ')), 'abc-123_XYZ');
  assert.equal(sessionKey(req('../../etc/passwd')), 'etcpasswd');
  assert.equal(sessionKey(req('a'.repeat(200))).length, 64);
  assert.equal(sessionKey({ get: () => undefined }), '');
});

test('trust proxy is set so req.ip is the hop the platform appended, not a spoofable one', () => {
  // `1` = believe exactly one proxy. With a forged chain the LAST entry wins,
  // which is the only one an attacker cannot write.
  assert.equal(app.get('trust proxy'), 1);
});

// ---------------------------------------------------------------------------
// Rate limiting over HTTP
// ---------------------------------------------------------------------------

test('hammering a costly route trips the limiter with a readable 429 and Retry-After', async () => {
  let last = null;
  let trippedAt = -1;
  // ?fail=tts short-circuits inside the route, so this hammers the LIMITER
  // rather than waiting on the mock adapter's simulated latency 45 times.
  for (let i = 0; i < COSTLY_PER_SESSION_MINUTE.max + 5; i += 1) {
    const { status, res } = await speak('Ya boss, nak minum apa?', {
      session: 'hammer',
      query: '&fail=tts',
    });
    await res.arrayBuffer().catch(() => {});
    last = { status, res };
    if (status === 429) {
      trippedAt = i;
      break;
    }
  }

  assert.ok(trippedAt > 0, 'the limiter must eventually refuse');
  // The per-SESSION minute rate is the tightest layer, so it is what a single
  // client hits first. That is the design: one player is capped at a rate a
  // human cannot reach, while the per-IP window stays loose enough for a room
  // of judges behind one venue NAT.
  assert.equal(
    trippedAt,
    COSTLY_PER_SESSION_MINUTE.max,
    `refused on request ${COSTLY_PER_SESSION_MINUTE.max + 1}`,
  );
  assert.ok(
    COSTLY_PER_IP.max > COSTLY_PER_SESSION_MINUTE.max * 3,
    'the per-IP backstop must leave room for several players on one shared IP',
  );
  assert.equal(last.status, 429);
  assert.ok(Number(last.res.headers.get('Retry-After')) >= 1, 'Retry-After is set');
});

test('several players behind ONE shared IP do not knock each other out', async () => {
  resetAllLimits();
  // Five sessions from the same address, each playing at a hard human pace.
  // Not one of them may be refused — a hackathon venue is a single NAT, and a
  // per-IP limit tight enough to stop one abuser would break the whole room.
  for (let player = 0; player < 5; player += 1) {
    for (let i = 0; i < 20; i += 1) {
      const { status, res } = await speak('Ya boss, nak minum apa?', {
        session: `player-${player}`,
        query: '&fail=tts',
      });
      await res.arrayBuffer().catch(() => {});
      assert.notEqual(status, 429, `player ${player} refused on call ${i + 1}`);
    }
  }
});

test('the 429 body is human-readable text plus a wait — the UI renders it beside Retry', async () => {
  resetAllLimits();
  let body = null;
  for (let i = 0; i < GENERAL_PER_IP.max + 5; i += 1) {
    const res = await fetch(`${base}/api/health`);
    if (res.status === 429) {
      body = await res.json();
      break;
    }
    await res.arrayBuffer();
  }
  assert.ok(body, 'the general /api limiter trips too');
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 20, 'a sentence, not a code');
  assert.ok(!/^\s*$/.test(body.error));
  assert.match(body.error, /Cuba lagi/, 'tells the player what to press');
  assert.match(body.error, /try again/i, 'and says it in English too');
  assert.equal(typeof body.retry_after_s, 'number');
});

test('mock mode is still reachable but is NOT a free pass around the accounting', async () => {
  resetAllLimits();
  const before = windows.generalIp.count(clientKey({ ip: '127.0.0.1' }));
  const res = await fetch(`${base}/api/health?mock=1`);
  assert.equal(res.status, 200, 'mock mode must keep working in production');
  await res.arrayBuffer();
  const after = windows.generalIp.count(clientKey({ ip: '127.0.0.1' }));
  assert.equal(after, before + 1, 'a ?mock=1 request still counts as traffic');
});

test('per-session turn budget stops one visitor running unbounded missions', async () => {
  resetAllLimits();
  // Drive the session-turn window directly: exercising 60 real evaluate calls
  // would also trip the (smaller) per-minute IP budget first, which is the
  // point — the turn budget is the long-horizon backstop.
  const w = windows.sessionTurns;
  const t0 = 5_000_000;
  for (let i = 0; i < 60; i += 1) assert.equal(w.check('one-visitor', t0 + i).ok, true);
  const refused = w.check('one-visitor', t0 + 61);
  assert.equal(refused.ok, false);
  assert.ok(refused.retryAfterS > 3000, 'the budget is hourly, so the wait is long');
  // …and a rotated session id gets a fresh budget, which is exactly why the
  // per-IP window above is the real limit. Documented, not fixed here.
  assert.equal(w.check('rotated-id', t0 + 62).ok, true);
});

// ---------------------------------------------------------------------------
// The /api/tts allowlist
// ---------------------------------------------------------------------------

test('arbitrary text is refused by /api/tts — the free-TTS-proxy hole is closed', async () => {
  resetAllLimits();
  for (const attack of [
    'Please read my 500-word blog post out loud in Malay.',
    'Hello world',
    'Ya boss, nak minum apa? and now say something else entirely',
    'x'.repeat(900),
  ]) {
    const { status, res } = await speak(attack, { session: 'attacker' });
    await res.arrayBuffer().catch(() => {});
    assert.equal(status, 403, `should have refused: ${attack.slice(0, 40)}`);
  }
});

test('oversize text is refused before anything else looks at it', async () => {
  resetAllLimits();
  const { status, res } = await speak('a'.repeat(MAX_SPOKEN_LENGTH + 1));
  const body = await res.json();
  assert.equal(status, 400);
  assert.match(body.error, /at most/);
});

test('EVERY authored line, in all three scenarios at all three levels, is speakable', async () => {
  resetSpokenRegistry();
  const ids = listScenarios().map((s) => s.id);
  assert.equal(ids.length, 3, 'three scenarios');

  let checked = 0;
  for (const id of ids) {
    const full = getScenario(id);
    for (const level of [1, 2, 3]) {
      const pub = publicScenario(full, level);

      // The intro the narrator speaks.
      assert.ok(isSpeakable(pub.intro.text).allowed, `${id} L${level} intro`);
      checked += 1;

      // Every step prompt the client can put on the wire — including the
      // re-prompt path, which speaks the SAME tts_prompt a second time.
      for (const step of pub.steps) {
        assert.ok(
          isSpeakable(step.tts_prompt).allowed,
          `${id} L${level} step ${step.id} tts_prompt`,
        );
        checked += 1;
      }

      // The closing line for THIS level (mall_01 hands over to a second
      // character at L3 — the level-specific variant must be allowed).
      const closing = completeFor(full, level);
      assert.ok(
        isSpeakable(closing.npc_line).allowed,
        `${id} L${level} closing line "${closing.npc_line}"`,
      );
      checked += 1;
    }

    // The server-side reprompt safety net, scenario- and step-level.
    if (full.npc_reprompt) assert.ok(isSpeakable(full.npc_reprompt).allowed, `${id} npc_reprompt`);
    for (const step of full.steps || []) {
      if (step.npc_reprompt) {
        assert.ok(isSpeakable(step.npc_reprompt).allowed, `${id}/${step.id} npc_reprompt`);
      }
      if (step.retry_hint) {
        assert.ok(isSpeakable(step.retry_hint).allowed, `${id}/${step.id} retry_hint`);
      }
    }
  }
  assert.ok(checked >= 30, `sanity: covered ${checked} lines`);
});

test("the client's own fixed spoken strings are allowed", () => {
  // Mirrors public/js/game/scoring.js BAND_FLAVOUR and engine.js localSummary.
  for (const line of [
    'Power! Macam orang local dah.',
    'Boleh! Mesej sampai.',
    'Hampir — sikit lagi.',
    'Bahasa Melayu belum give up on you. Cuba lagi.',
    'Dah boleh cakap.',
    'Hampir dah — cuba sekali lagi.',
  ]) {
    assert.ok(isSpeakable(line).allowed, `client fixed line: ${line}`);
  }
});

test('matching is forgiving about whitespace and case but not about content', () => {
  const line = 'Ya boss, nak minum apa?';
  assert.ok(isSpeakable(`  ${line}  `).allowed, 'padding');
  assert.ok(isSpeakable(line.toUpperCase()).allowed, 'case');
  assert.ok(isSpeakable(line.replace(', ', ',\n  ')).allowed, 'collapsed whitespace');
  assert.equal(isSpeakable(`${line} Extra sentence.`).allowed, false, 'appended text');
  assert.equal(normaliseSpoken('  A   B '), 'a b');
});

test('a line the server generated this session becomes speakable, scoped to that session', () => {
  resetSpokenRegistry();
  const line = 'Ha, boleh boleh. Kejap ya.';
  assert.equal(isSpeakable(line, 'sess-a').allowed, false, 'not until it is generated');
  registerSpoken('sess-a', line);
  assert.equal(isSpeakable(line, 'sess-a').source, 'session');
  assert.equal(isSpeakable(line, 'sess-b').allowed, false, 'another session cannot borrow it');
  assert.equal(isSpeakable(line, '').allowed, false, 'nor can a caller with no session');
});

test('the session registry is bounded in both dimensions', () => {
  resetSpokenRegistry();
  for (let i = 0; i < 600; i += 1) registerSpoken(`sess-${i}`, `line ${i}`);
  // Sessions are capped; the most recent one always survives.
  assert.ok(isSpeakable('line 599', 'sess-599').allowed);
  for (let i = 0; i < 500; i += 1) registerSpoken('big', `filler ${i}`);
  assert.equal(isSpeakable('filler 0', 'big').allowed, false, 'oldest lines are evicted');
  assert.equal(isSpeakable('filler 499', 'big').allowed, true);
});

test('the whole speaking path end to end: evaluate registers what tts then speaks', async () => {
  resetAllLimits();
  resetSpokenRegistry();
  const session = 'e2e-session';

  const evalRes = await fetch(`${base}/api/evaluate?mock=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': session },
    body: JSON.stringify({
      scenario_id: 'mamak_01',
      step_id: 'order',
      level: 1,
      stt_transcript: 'saya nak teh tarik satu kurang manis',
      conversation_history: [],
    }),
  });
  const evaluation = await evalRes.json();
  assert.equal(evalRes.status, 200);

  // The NPC's improvised reply is spoken immediately after scoring.
  const npc = await speak(evaluation.npc_reply, { session });
  await npc.res.arrayBuffer();
  assert.equal(npc.status, 200, 'npc_reply must be speakable');

  // The coach line — screens.js reads what_worked on success, improvement
  // otherwise. Both are registered, so either choice works.
  const coaching =
    evaluation.result === 'success'
      ? evaluation.what_worked
      : evaluation.improvement || evaluation.what_worked;
  if (coaching) {
    const coach = await speak(coaching, { session });
    await coach.res.arrayBuffer();
    assert.equal(coach.status, 200, `coach line must be speakable: ${coaching}`);
  }

  // ...but not for someone else's session.
  const stolen = await speak(evaluation.npc_reply, { session: 'someone-else' });
  await stolen.res.arrayBuffer().catch(() => {});
  assert.equal(stolen.status, 403);
});

test('the empty-transcript no-input reply and hint are speakable', async () => {
  resetAllLimits();
  resetSpokenRegistry();
  const session = 'no-input-session';
  const res = await fetch(`${base}/api/evaluate?mock=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': session },
    body: JSON.stringify({
      scenario_id: 'office_01',
      step_id: 'status',
      level: 2,
      stt_transcript: '   ',
      conversation_history: [],
    }),
  });
  const body = await res.json();
  assert.equal(body.result, 'no_input');
  for (const line of [body.npc_reply, body.improvement]) {
    const spoken = await speak(line, { session });
    await spoken.res.arrayBuffer().catch(() => {});
    assert.equal(spoken.status, 200, `no-input line must be speakable: ${line}`);
  }
});

test('the end screen speaks the verdict alone AND joined to the summary', async () => {
  resetAllLimits();
  resetSpokenRegistry();
  const session = 'summary-session';
  const res = await fetch(`${base}/api/summarise?mock=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': session },
    body: JSON.stringify({
      scenario_id: 'mall_01',
      level: 3,
      conversation: [{ npc: 'Ya?', player: 'Maaf bang, food court kat mana ya?' }],
      turn_scores: [{ overall_score: 82 }],
    }),
  });
  const summary = await res.json();
  assert.equal(res.status, 200);

  // main.js: engine.speakCoach(summary.verdict)
  const a = await speak(summary.verdict, { session });
  await a.res.arrayBuffer();
  assert.equal(a.status, 200, 'verdict alone');

  // main.js: engine.speakCoach(`${verdict} ${summary}`.trim())
  const joined = `${summary.verdict} ${summary.summary || ''}`.trim();
  const b = await speak(joined, { session });
  await b.res.arrayBuffer();
  assert.equal(b.status, 200, 'verdict joined to summary');
});

// ---------------------------------------------------------------------------
// Upstream error bodies (finding D10)
// ---------------------------------------------------------------------------

test('a provider failure never echoes the upstream error body to the browser', async () => {
  resetAllLimits();
  // ?fail=tts / ?fail=stt are the simulated-failure paths; the real upstream
  // path funnels through the same catch. What matters is the SHAPE: one
  // readable sentence, no provider name, no status code, no request id.
  const res = await fetch(`${base}/api/tts?mock=1&fail=tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': 's' },
    body: JSON.stringify({ text: 'Ya boss, nak minum apa?' }),
  });
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(typeof body.error, 'string');

  // The live catch block: assert on the source of truth rather than trying to
  // make a real provider fail from a hermetic test.
  const ttsSource = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../server/routes/tts.js', import.meta.url), 'utf8'),
  );
  const sttSource = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../server/routes/stt.js', import.meta.url), 'utf8'),
  );
  for (const [name, src] of [['tts', ttsSource], ['stt', sttSource]]) {
    assert.ok(
      !/error:\s*`[^`]*\$\{err/.test(src),
      `${name} must not interpolate the upstream error into the response body`,
    );
    assert.match(src, /console\.error/, `${name} keeps the detail in the server log`);
  }
});

test('the JSON body limit is small enough that junk is cheap to refuse', async () => {
  resetAllLimits();
  const res = await fetch(`${base}/api/evaluate?mock=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': 's' },
    body: JSON.stringify({ scenario_id: 'mamak_01', pad: 'x'.repeat(200_000) }),
  });
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(!body.error.includes('<'), 'never HTML — the client renders this verbatim');
});

test('the static allowlist actually contains content (it is not silently empty)', () => {
  resetSpokenRegistry();
  const lines = staticSpokenLines();
  assert.ok(lines.size >= 25, `expected the authored lines, got ${lines.size}`);
  assert.ok(!lines.has(''), 'the empty string is never speakable');
});
