// server/game/scoring.js
//
// Pure scoring maths + the deterministic fallback evaluator.
// Imported by both the live evaluator adapter and the mock adapter, so it must
// stay free of I/O and of express.
//
// Weights: intent 40 · semantics 25 · comprehensibility 20 · naturalness 15.
// Bands:   90-100 Power! · 75-89 Passed · 55-74 Almost · <55 Retry.

export const WEIGHTS = Object.freeze({
  intent: 0.4,
  semantic: 0.25,
  comprehensibility: 0.2,
  naturalness: 0.15,
});

export const PARTIAL_BAND = Object.freeze({ min: 55, max: 74 });

/** Retries allowed on one step before we grant partial credit and advance. */
export const RETRY_CAP = 2;

function clamp100(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

/**
 * overall = round(.40*intent + .25*semantic + .20*comprehensibility + .15*naturalness)
 * Always recomputed server-side — the model's own arithmetic is never trusted.
 */
export function computeOverall({
  intent_score,
  semantic_score,
  comprehensibility_score,
  naturalness_score,
}) {
  return Math.round(
    WEIGHTS.intent * clamp100(intent_score) +
      WEIGHTS.semantic * clamp100(semantic_score) +
      WEIGHTS.comprehensibility * clamp100(comprehensibility_score) +
      WEIGHTS.naturalness * clamp100(naturalness_score),
  );
}

/**
 * @param {number} overall
 * @returns {'power'|'passed'|'almost'|'retry'}
 */
export function bandFor(overall) {
  const n = clamp100(overall);
  if (n >= 90) return 'power';
  if (n >= 75) return 'passed';
  if (n >= 55) return 'almost';
  return 'retry';
}

export const BAND_LABELS = Object.freeze({
  power: 'Power!',
  passed: 'Passed',
  almost: 'Almost',
  retry: 'Retry',
});

export function bandLabel(band) {
  return BAND_LABELS[band] || 'Retry';
}

/**
 * result = success if overall >= 75 && intent_pass; partial if 55-74; else retry.
 * Derived server-side; the model's own `result` field is ignored.
 * @returns {'success'|'partial'|'retry'}
 */
export function deriveResult(overall, intentPass) {
  const n = clamp100(overall);
  if (n >= 75 && intentPass === true) return 'success';
  if (n >= 55) return 'partial';
  return 'retry';
}

/**
 * Retry cap. After RETRY_CAP retries on ONE step we grant partial credit and
 * let the run advance rather than looping — the demo must never dead-end.
 *
 * This is THE implementation: /api/evaluate calls it, and so does the unit
 * test, so the two can never drift apart.
 *
 * @param {number} overall recomputed overall score for this turn
 * @param {boolean} intentPass the model's intent_pass, already coerced
 * @param {number} retryCount retries already spent on this step
 * @returns {{result: 'success'|'partial'|'retry', overall: number, retry_capped: boolean}}
 */
export function applyRetryCap(overall, intentPass, retryCount) {
  const result = deriveResult(overall, intentPass === true);
  const spent = Number(retryCount);
  if (result === 'retry' && Number.isFinite(spent) && spent >= RETRY_CAP) {
    return {
      result: 'partial',
      overall: clampToPartialBand(Math.max(clamp100(overall), PARTIAL_BAND.min)),
      retry_capped: true,
    };
  }
  return { result, overall: clamp100(overall), retry_capped: false };
}

/** lowercase, strip punctuation, collapse whitespace */
export function normaliseTranscript(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isEmptyTranscript(text) {
  return normaliseTranscript(text).length === 0;
}

/**
 * Clamp a score into the partial band (55-74). A system failure must never cost
 * the learner points, and must never claim more than partial credit either.
 */
export function clampToPartialBand(n) {
  return Math.min(PARTIAL_BAND.max, Math.max(PARTIAL_BAND.min, Math.round(Number(n) || 0)));
}

/**
 * Which language the COACHING (what_worked / improvement / summary / strengths /
 * improvements) is written in. Level 1 learners are beginners who still get the
 * English hint on screen (`task_en`) — coaching them in a language they cannot
 * yet read is the classic mistake. Levels 2 and 3 wean off English exactly as
 * the on-screen hints do. `npc_reply` is Bahasa Melayu at every level and is
 * NOT affected by this.
 *
 * @param {number|string|undefined} level
 * @returns {'en'|'ms'}
 */
export function coachingLanguage(level) {
  return Number(level) === 1 ? 'en' : 'ms';
}

/** Generic fallback coaching, in both coaching languages. Deliberately vague:
 *  the fallback did NOT judge the learner's specific sentence. */
const FALLBACK_COACHING = Object.freeze({
  en: Object.freeze({
    what_worked: 'You kept going and gave it a try — that is the hard part.',
    improvement: 'Try saying it again a bit more fully so your meaning comes through.',
  }),
  ms: Object.freeze({
    what_worked: 'Anda terus bercakap dan cuba — teruskan.',
    improvement: 'Cuba sebut semula dengan lebih lengkap supaya maksud anda jelas.',
  }),
});

const FALLBACK_SUMMARY_TEXT = Object.freeze({
  en: Object.freeze({
    summary:
      'You made it through the whole conversation. The score above is worked out from your turns, because the full reviewer could not be reached.',
    strengths: Object.freeze(['You kept talking right to the end of the conversation.']),
    improvements: Object.freeze(['Give it another go for more detailed feedback.']),
  }),
  ms: Object.freeze({
    summary:
      'Anda telah menyelesaikan perbualan ini. Skor di atas dikira daripada giliran-giliran anda kerana penilai penuh tidak dapat dihubungi.',
    strengths: Object.freeze(['Anda terus bercakap sehingga habis perbualan.']),
    improvements: Object.freeze(['Cuba sekali lagi untuk maklum balas yang lebih terperinci.']),
  }),
});

/**
 * Deterministic fallback — used when the LLM fails twice or no key is set.
 *
 * NOT keyword matching of the answer: it checks the step's `fallback_concepts`,
 * an array of CONCEPT GROUPS, each a list of variant phrasings. A group is
 * satisfied if ANY variant appears in the normalised transcript. All groups
 * satisfied -> `partial`.
 *
 * Hard rules (both unit-tested):
 *   1. Scores are capped inside the partial band (55-74) and never below it.
 *   2. Coaching text stays generic — it must not pretend to have judged the
 *      learner's specific sentence.
 *   3. Coaching language follows the level: English at L1, BM at L2/L3.
 *
 * @param {{step: object, transcript: string, level?: number, reason?: string}} input
 */
export function fallbackEvaluate({ step, transcript, level, reason = 'evaluator_unavailable' } = {}) {
  const normalised = normaliseTranscript(transcript);
  const groups = Array.isArray(step && step.fallback_concepts) ? step.fallback_concepts : [];

  const groupsMatched = groups.filter((group) =>
    (Array.isArray(group) ? group : [group]).some((variant) =>
      normalised.includes(normaliseTranscript(variant)),
    ),
  ).length;

  const allSatisfied = groups.length > 0 && groupsMatched === groups.length;

  // Even when not all groups are satisfied we stay inside the partial band:
  // a system failure must never cost the learner points.
  const base = allSatisfied ? PARTIAL_BAND.max : PARTIAL_BAND.min + 5;

  const scores = {
    intent_score: clampToPartialBand(base),
    semantic_score: clampToPartialBand(base),
    comprehensibility_score: clampToPartialBand(base),
    naturalness_score: clampToPartialBand(base),
  };

  const lang = coachingLanguage(level);
  const generic = FALLBACK_COACHING[lang];

  return {
    ...scores,
    intent_pass: true,
    // Generic coaching only — we did not actually judge this sentence.
    what_worked: generic.what_worked,
    // `retry_hint` is authored in Bahasa Melayu, so it is only usable when the
    // coaching language IS Bahasa Melayu (L2/L3). At L1 we stay in English.
    improvement: (lang === 'ms' && step && step.retry_hint) || generic.improvement,
    // npc_reply is Bahasa Melayu at every level.
    npc_reply: 'Ha, ok ok. Jom kita teruskan.',
    source: 'fallback',
    fallback: true,
    fallback_reason: reason,
    fallback_groups_matched: groupsMatched,
    fallback_groups_total: groups.length,
  };
}

/**
 * Fallback for /api/summarise: weighted (here: plain) average of turn scores,
 * a generic band/verdict, and an empty bm_upgrades array. Never crashes the
 * end screen even with zero turns.
 */
export function fallbackSummarise({ turnScores = [], level, reason = 'evaluator_unavailable' } = {}) {
  const nums = (Array.isArray(turnScores) ? turnScores : [])
    .map((t) => (typeof t === 'number' ? t : t && t.overall_score))
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));

  const overall = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 60;
  const band = summaryBandFor(overall);
  const text = FALLBACK_SUMMARY_TEXT[coachingLanguage(level)];

  return {
    overall_score: overall,
    band,
    // The verdict is a Malaysian catchphrase at every level — it is flavour,
    // not coaching, and it is the game's voice.
    verdict: SUMMARY_VERDICTS[band],
    summary: text.summary,
    strengths: [...text.strengths],
    improvements: [...text.improvements],
    bm_upgrades: [],
    source: 'fallback',
    fallback: true,
    fallback_reason: reason,
  };
}

/**
 * @param {number} overall
 * @returns {'power'|'mission_passed'|'almost'|'retry'}
 */
export function summaryBandFor(overall) {
  const n = clamp100(overall);
  if (n >= 90) return 'power';
  if (n >= 75) return 'mission_passed';
  if (n >= 55) return 'almost';
  return 'retry';
}

export const SUMMARY_VERDICTS = Object.freeze({
  power: 'Power betul!',
  mission_passed: 'Dah boleh cakap.',
  almost: 'Hampir dah — cuba sekali lagi.',
  retry: 'Jom cuba lagi.',
});

export const SUMMARY_BAND_LABELS = Object.freeze({
  power: 'Power!',
  mission_passed: 'Mission Passed',
  almost: 'Almost',
  retry: 'Try Again',
});
