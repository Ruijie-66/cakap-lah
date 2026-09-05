import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WEIGHTS,
  PARTIAL_BAND,
  RETRY_CAP,
  computeOverall,
  bandFor,
  deriveResult,
  normaliseTranscript,
  isEmptyTranscript,
  clampToPartialBand,
  applyRetryCap,
  fallbackEvaluate,
  fallbackSummarise,
  summaryBandFor,
} from '../server/game/scoring.js';
import { getScenario } from '../server/game/scenarios.js';
import { findStep } from '../server/game/branching.js';

test('weights are 40/25/20/15', () => {
  assert.deepEqual(WEIGHTS, { intent: 0.4, semantic: 0.25, comprehensibility: 0.2, naturalness: 0.15 });
});

test('computeOverall applies the 40/25/20/15 weights (92/88/90/82 -> 89)', () => {
  // .40*92 + .25*88 + .20*90 + .15*82 = 89.1 -> 89.
  // The brief's illustrative payload shows 88; that is the MODEL's arithmetic,
  // which we deliberately discard and recompute server-side.
  assert.equal(
    computeOverall({
      intent_score: 92,
      semantic_score: 88,
      comprehensibility_score: 90,
      naturalness_score: 82,
    }),
    89,
  );
  assert.equal(
    computeOverall({ intent_score: 100, semantic_score: 100, comprehensibility_score: 100, naturalness_score: 100 }),
    100,
  );
  assert.equal(
    computeOverall({ intent_score: 80, semantic_score: 60, comprehensibility_score: 60, naturalness_score: 40 }),
    Math.round(0.4*80 + 0.25*60 + 0.20*60 + 0.15*40),
  );
});

test('computeOverall clamps junk input instead of producing NaN', () => {
  assert.equal(
    computeOverall({ intent_score: 'x', semantic_score: -50, comprehensibility_score: 500, naturalness_score: null }),
    20, // 0 + 0 + .20*100 + 0
  );
});

test('bands: 90-100 power, 75-89 passed, 55-74 almost, <55 retry', () => {
  assert.equal(bandFor(100), 'power');
  assert.equal(bandFor(90), 'power');
  assert.equal(bandFor(89), 'passed');
  assert.equal(bandFor(75), 'passed');
  assert.equal(bandFor(74), 'almost');
  assert.equal(bandFor(55), 'almost');
  assert.equal(bandFor(54), 'retry');
  assert.equal(bandFor(0), 'retry');
});

test('result derivation needs BOTH overall >= 75 and intent_pass', () => {
  assert.equal(deriveResult(88, true), 'success');
  assert.equal(deriveResult(88, false), 'partial', 'high score without intent_pass is not success');
  assert.equal(deriveResult(60, true), 'partial');
  assert.equal(deriveResult(54, true), 'retry');
  assert.equal(deriveResult(75, true), 'success');
});

test('retry cap: after RETRY_CAP retries the route grants partial and advances', () => {
  assert.equal(RETRY_CAP, 2);
  // applyRetryCap is the SHIPPED implementation — /api/evaluate calls this very
  // function, so this test cannot drift away from the route.
  assert.deepEqual(applyRetryCap(30, false, 0), { result: 'retry', overall: 30, retry_capped: false });
  assert.deepEqual(applyRetryCap(30, false, 1), { result: 'retry', overall: 30, retry_capped: false });
  assert.deepEqual(applyRetryCap(30, false, 2), { result: 'partial', overall: 55, retry_capped: true });
  assert.deepEqual(applyRetryCap(30, false, 5), { result: 'partial', overall: 55, retry_capped: true });
  // Clamped to AT LEAST 55, and never above the partial band.
  assert.deepEqual(applyRetryCap(54, false, 2), { result: 'partial', overall: 55, retry_capped: true });
  // A genuine success, and a genuine partial, are untouched by the cap.
  assert.deepEqual(applyRetryCap(90, true, 5), { result: 'success', overall: 90, retry_capped: false });
  assert.deepEqual(applyRetryCap(60, false, 5), { result: 'partial', overall: 60, retry_capped: false });
});

test('normaliseTranscript lowercases, strips punctuation, collapses whitespace', () => {
  assert.equal(normaliseTranscript('  Bang, TEH tarik satu... kurang   manis! '), 'bang teh tarik satu kurang manis');
  assert.equal(isEmptyTranscript('   \n\t  '), true);
  assert.equal(isEmptyTranscript('...!!!'), true);
  assert.equal(isEmptyTranscript('teh'), false);
});

test('clampToPartialBand never leaves 55-74', () => {
  assert.equal(clampToPartialBand(0), PARTIAL_BAND.min);
  assert.equal(clampToPartialBand(100), PARTIAL_BAND.max);
  assert.equal(clampToPartialBand(60), 60);
});

const mamakOrder = findStep(getScenario('mamak_01'), 'order');

test('fallback: all concept groups satisfied -> top of the partial band', () => {
  const out = fallbackEvaluate({ step: mamakOrder, transcript: 'Bang, teh tarik satu, kurang manis.' });
  assert.equal(out.fallback_groups_total, 2);
  assert.equal(out.fallback_groups_matched, 2);
  assert.equal(computeOverall(out), PARTIAL_BAND.max);
  assert.equal(deriveResult(computeOverall(out), out.intent_pass), 'partial');
});

test('fallback: a group is satisfied by ANY variant (English variant counts)', () => {
  const out = fallbackEvaluate({ step: mamakOrder, transcript: 'one teh tarik please, less sweet' });
  assert.equal(out.fallback_groups_matched, 2);
});

test('fallback scores are capped INSIDE the partial band and never fall below it', () => {
  for (const transcript of ['', 'hello world', 'blah blah blah nothing relevant', 'teh']) {
    const out = fallbackEvaluate({ step: mamakOrder, transcript });
    const overall = computeOverall(out);
    assert.ok(
      overall >= PARTIAL_BAND.min && overall <= PARTIAL_BAND.max,
      `transcript ${JSON.stringify(transcript)} scored ${overall}, outside 55-74`,
    );
    assert.notEqual(deriveResult(overall, out.intent_pass), 'retry', 'a system failure must never cost points');
  }
});

test('fallback with a step that has no fallback_concepts still stays in band', () => {
  const out = fallbackEvaluate({ step: { id: 'x' }, transcript: 'apa-apa' });
  const overall = computeOverall(out);
  assert.ok(overall >= PARTIAL_BAND.min && overall <= PARTIAL_BAND.max);
});

test('fallback coaching text is generic — it does not quote the learner sentence', () => {
  const transcript = 'saya nak teh tarik kurang manis boss';
  const out = fallbackEvaluate({ step: mamakOrder, transcript });
  for (const field of ['what_worked', 'improvement', 'npc_reply']) {
    assert.ok(out[field] && out[field].length > 0, `${field} present`);
    assert.ok(!out[field].includes(transcript), `${field} must not quote the learner`);
    assert.ok(!/teh tarik/i.test(out[field]), `${field} must stay generic`);
  }
  assert.equal(out.source, 'fallback');
  assert.equal(out.fallback, true);
});

test('summary fallback averages turn scores and returns an empty bm_upgrades array', () => {
  const out = fallbackSummarise({ turnScores: [{ overall_score: 80 }, { overall_score: 70 }] });
  assert.equal(out.overall_score, 75);
  assert.equal(out.band, 'mission_passed');
  assert.deepEqual(out.bm_upgrades, []);
  assert.ok(out.verdict && out.summary);
});

test('summary fallback survives zero turns without crashing', () => {
  const out = fallbackSummarise({});
  assert.equal(Number.isFinite(out.overall_score), true);
  assert.deepEqual(out.bm_upgrades, []);
});

test('summary bands', () => {
  assert.equal(summaryBandFor(95), 'power');
  assert.equal(summaryBandFor(84), 'mission_passed');
  assert.equal(summaryBandFor(60), 'almost');
  assert.equal(summaryBandFor(10), 'retry');
});
