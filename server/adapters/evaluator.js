// server/adapters/evaluator.js
//
// The LLM brain of CAKAP LAH!: a per-turn meaning evaluator and a
// whole-conversation summariser. Supports OpenAI and Gemini (LLM_PROVIDER),
// uses each provider's structured-output feature, validates the result
// strictly, retries once on malformed output, and falls back to the
// deterministic scorer in server/game/scoring.js when everything fails.
//
// Exports `evaluate` and `summarise` with the same signatures as the mock
// adapter, so server/adapters/index.js can swap between them per request.

import {
  LLM_PROVIDER,
  OPENAI_BASE_URL,
  OPENAI_MODEL,
  GEMINI_BASE_URL,
  GEMINI_MODEL,
  LLM_TIMEOUT_MS,
  llmApiKey,
  hasLlmKey,
} from '../config.js';
import { fallbackEvaluate, fallbackSummarise } from '../game/scoring.js';

// ---------------------------------------------------------------------------
// Prompts (5.4 in the brief — implemented faithfully)
// ---------------------------------------------------------------------------

export const TURN_SYSTEM_PROMPT = `You are the evaluator for CAKAP LAH!, a Bahasa Melayu speaking-practice game. You judge whether a learner's **spoken** response accomplished a communicative task.

- Never require exact wording. \`sample_answers\` illustrate the *range* of acceptable answers — they are NOT a match list, and an answer unlike all of them can still score 100.
- Judge meaning and task completion first; grammar last.
- The transcript is from speech recognition. Spelling/punctuation artifacts are not the learner's fault.
- Code-switch policy is \`{allowed_code_switch}\`: **beginner** — Manglish **passes** if the task is done; offer the BM replacement as coaching, never failure. **intermediate** — may pass; reduce \`naturalness_score\` where a normal BM alternative exists. **advanced** — expect predominantly BM except proper nouns and technical terms. This axis is about *how much BM*, not formality. **Never penalise casual register.**
- Be encouraging. Never mock the learner. Humour targets the situation, never the person.
- \`what_worked\` / \`improvement\`: ONE short sentence each.
- \`npc_reply\`: in character, natural Malaysian BM, 1–2 sentences, reacting to what the learner **actually said**.`;

export const SUMMARY_SYSTEM_PROMPT = `You are the end-of-scenario reviewer for CAKAP LAH!, a Bahasa Melayu speaking-practice game. You have just watched a whole conversation between the learner and an NPC.

- This is NOT an average of the per-turn scores. Judge the exchange as a whole: did the learner recover after a weak turn, did the register hold, would this conversation actually have worked in real life with a real Malaysian?
- The per-turn scores are reference context only. You may score above or below their average and should say why in the summary.
- \`summary\`: 2–3 sentences on how the conversation went as a whole.
- \`strengths\` and \`improvements\`: short concrete phrases, 2 each where possible.
- \`bm_upgrades\` is the most useful thing on the screen: harvest EVERY English or Manglish word or phrase the learner used anywhere in the conversation and give the natural Bahasa Melayu replacement, as {"you_said": "...", "try": "..."}. If the learner code-switched nowhere, return an empty array.
- Be encouraging and specific. Never mock the learner.
- \`verdict\`: a very short Malaysian-sounding line, e.g. "Dah boleh cakap."`;

// ---------------------------------------------------------------------------
// Structured-output schemas
// ---------------------------------------------------------------------------

const scoreProp = { type: 'integer', minimum: 0, maximum: 100 };

export const TURN_SCHEMA = {
  type: 'object',
  properties: {
    intent_pass: { type: 'boolean' },
    intent_score: scoreProp,
    semantic_score: scoreProp,
    comprehensibility_score: scoreProp,
    naturalness_score: scoreProp,
    overall_score: scoreProp,
    result: { type: 'string', enum: ['success', 'partial', 'retry'] },
    what_worked: { type: 'string' },
    improvement: { type: 'string' },
    npc_reply: { type: 'string' },
    branch: { type: 'string', enum: ['success', 'partial', 'retry'] },
  },
  required: [
    'intent_pass',
    'intent_score',
    'semantic_score',
    'comprehensibility_score',
    'naturalness_score',
    'overall_score',
    'result',
    'what_worked',
    'improvement',
    'npc_reply',
    'branch',
  ],
  additionalProperties: false,
};

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    overall_score: scoreProp,
    band: { type: 'string', enum: ['power', 'mission_passed', 'almost', 'retry'] },
    verdict: { type: 'string' },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
    bm_upgrades: {
      type: 'array',
      items: {
        type: 'object',
        properties: { you_said: { type: 'string' }, try: { type: 'string' } },
        required: ['you_said', 'try'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'overall_score',
    'band',
    'verdict',
    'summary',
    'strengths',
    'improvements',
    'bm_upgrades',
  ],
  additionalProperties: false,
};

/** Gemini's responseSchema dialect does not accept additionalProperties. */
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties') continue;
    out[k] = toGeminiSchema(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation — strict; anything off-shape throws so retry/fallback can kick in
// ---------------------------------------------------------------------------

class MalformedOutputError extends Error {}

function requireScore(obj, key) {
  const n = obj[key];
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) {
    throw new MalformedOutputError(`field "${key}" must be a number 0-100 (got ${JSON.stringify(n)})`);
  }
  return Math.round(n);
}

function requireText(obj, key) {
  const s = obj[key];
  if (typeof s !== 'string' || !s.trim()) {
    throw new MalformedOutputError(`field "${key}" must be a non-empty string`);
  }
  return s.trim();
}

/** @throws {MalformedOutputError} */
export function validateTurnOutput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MalformedOutputError('evaluator output is not a JSON object');
  }
  if (typeof raw.intent_pass !== 'boolean') {
    throw new MalformedOutputError('field "intent_pass" must be a boolean');
  }
  return {
    intent_pass: raw.intent_pass,
    intent_score: requireScore(raw, 'intent_score'),
    semantic_score: requireScore(raw, 'semantic_score'),
    comprehensibility_score: requireScore(raw, 'comprehensibility_score'),
    naturalness_score: requireScore(raw, 'naturalness_score'),
    what_worked: requireText(raw, 'what_worked'),
    improvement: requireText(raw, 'improvement'),
    npc_reply: requireText(raw, 'npc_reply'),
  };
}

/** @throws {MalformedOutputError} */
export function validateSummaryOutput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MalformedOutputError('summariser output is not a JSON object');
  }
  const strings = (v) =>
    Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];

  const upgrades = Array.isArray(raw.bm_upgrades)
    ? raw.bm_upgrades
        .filter((u) => u && typeof u.you_said === 'string' && typeof u.try === 'string')
        .map((u) => ({ you_said: u.you_said.trim(), try: u.try.trim() }))
    : null;
  if (upgrades === null) throw new MalformedOutputError('field "bm_upgrades" must be an array');

  return {
    overall_score: requireScore(raw, 'overall_score'),
    verdict: requireText(raw, 'verdict'),
    summary: requireText(raw, 'summary'),
    strengths: strings(raw.strengths),
    improvements: strings(raw.improvements),
    bm_upgrades: upgrades,
  };
}

// ---------------------------------------------------------------------------
// Provider calls (global fetch only — no SDK dependency)
// ---------------------------------------------------------------------------

function parseJsonStrict(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new MalformedOutputError(`model did not return valid JSON: ${err.message}`);
  }
}

async function callOpenAI({ system, user, schema, schemaName }) {
  const res = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${llmApiKey()}`,
    },
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new MalformedOutputError('OpenAI returned no message content');
  return parseJsonStrict(text);
}

async function callGemini({ system, user, schema }) {
  // The key goes in a header, never in the query string: URLs end up in proxy
  // and access logs, request headers do not.
  const url = `${GEMINI_BASE_URL}/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': llmApiKey(),
    },
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(user) }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  if (!text) throw new MalformedOutputError('Gemini returned no candidate text');
  return parseJsonStrict(text);
}

function callProvider(args) {
  return LLM_PROVIDER === 'gemini' ? callGemini(args) : callOpenAI(args);
}

// ---------------------------------------------------------------------------
// Consecutive-fallback alarm
// ---------------------------------------------------------------------------
// A rejected key or a wrong LLM_PROVIDER used to be completely silent: every
// turn quietly returned the deterministic fallback's flat scores and generic
// coaching, i.e. a working-but-lobotomised demo. Warn loudly once a streak of
// fallbacks builds up, and again on every further multiple of the threshold.

/** Consecutive fallbacks tolerated before the loud warning fires. */
export const FALLBACK_WARN_THRESHOLD = 3;

let consecutiveFallbacks = 0;

/** Record one evaluator/summariser fallback; warns on a sustained streak. */
export function noteEvaluatorFallback(reason = 'unknown') {
  consecutiveFallbacks += 1;
  if (consecutiveFallbacks % FALLBACK_WARN_THRESHOLD === 0) {
    console.warn(
      `\n*** [evaluator] WARNING: the evaluator has fallen back ${consecutiveFallbacks} times in a row ` +
        `(latest reason: ${reason}). Learners are getting flat fallback scores and generic coaching. ` +
        `Check LLM_PROVIDER (currently "${LLM_PROVIDER}") and the matching API key. ***\n`,
    );
  }
  return consecutiveFallbacks;
}

/** Record a real LLM success; clears the streak. */
export function noteEvaluatorSuccess() {
  consecutiveFallbacks = 0;
}

/** Test/introspection helper. */
export function consecutiveFallbackCount() {
  return consecutiveFallbacks;
}

/** Test helper — reset the streak counter. */
export function resetFallbackStreak() {
  consecutiveFallbacks = 0;
}

let warnedNoKey = false;
function noKey() {
  if (!hasLlmKey()) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn(
        `[evaluator] no API key for LLM_PROVIDER=${LLM_PROVIDER} — using the deterministic fallback scorer for every turn.`,
      );
    }
    return true;
  }
  return false;
}

/**
 * Call the provider, validate, retry ONCE on malformed output or transport
 * error. Returns null when both attempts failed (caller falls back).
 */
async function attemptWithRetry({ system, user, schema, schemaName, validate, label }) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await callProvider({ system, user, schema, schemaName });
      return validate(raw);
    } catch (err) {
      const kind = err instanceof MalformedOutputError ? 'malformed output' : 'upstream error';
      console.warn(`[evaluator] ${label} attempt ${attempt}/2 failed (${kind}): ${err.message}`);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Per-turn evaluation. Returns unweighted axis scores + coaching text; the
 * route recomputes overall/result/branch itself and never trusts the model.
 *
 * @param {{
 *   scenario: object, step: object, level: number, levelConfig: object,
 *   transcript: string, sttConfidence?: number|null,
 *   conversationHistory: Array<{npc?: string, player?: string}>,
 *   forceMalformed?: boolean, forceUpstreamError?: boolean
 * }} input
 */
export async function evaluate(input = {}) {
  const { scenario, step, level, levelConfig: cfg, transcript, sttConfidence, conversationHistory } =
    input;

  if (input.forceUpstreamError) {
    throw new Error('Simulated evaluator upstream failure (fail=eval).');
  }

  // ?fail=json — the model returns garbage twice, exercising retry-then-fallback.
  if (input.forceMalformed) {
    console.warn('[evaluator] forced malformed output (fail=json): attempt 1/2 failed');
    console.warn('[evaluator] forced malformed output (fail=json): attempt 2/2 failed');
    noteEvaluatorFallback('malformed_output');
    return fallbackEvaluate({ step, transcript, reason: 'malformed_output' });
  }

  if (noKey()) {
    noteEvaluatorFallback('no_api_key');
    return fallbackEvaluate({ step, transcript, reason: 'no_api_key' });
  }

  const system = TURN_SYSTEM_PROMPT.replace(
    '{allowed_code_switch}',
    cfg?.allowed_code_switch || 'intermediate',
  );

  const user = {
    scenario_id: scenario?.id,
    level: Number(level),
    allowed_code_switch: cfg?.allowed_code_switch,
    scenario_context: scenario?.context,
    npc_prompt: step?.tts_prompt,
    task_goal: step?.task_en,
    expected_semantics: step?.expected_semantics || [],
    sample_answers: step?.sample_answers || [],
    stt_transcript: transcript,
    stt_confidence: sttConfidence ?? null,
    conversation_history: conversationHistory || [],
  };

  const ok = await attemptWithRetry({
    system,
    user,
    schema: TURN_SCHEMA,
    schemaName: 'cakap_lah_turn_evaluation',
    validate: validateTurnOutput,
    label: 'evaluate',
  });

  if (!ok) {
    noteEvaluatorFallback('llm_failed');
    return fallbackEvaluate({ step, transcript, reason: 'llm_failed' });
  }
  noteEvaluatorSuccess();
  return { ...ok, source: 'llm', fallback: false };
}

/**
 * Whole-conversation summary — a second LLM call, not an average of turns.
 *
 * @param {{
 *   scenario: object, level: number, levelConfig: object,
 *   conversation: Array<{npc?: string, player?: string}>,
 *   turnScores: Array<object|number>,
 *   forceMalformed?: boolean, forceUpstreamError?: boolean
 * }} input
 */
export async function summarise(input = {}) {
  const { scenario, level, levelConfig: cfg, conversation, turnScores } = input;

  if (input.forceUpstreamError) {
    throw new Error('Simulated summariser upstream failure (fail=eval).');
  }

  if (input.forceMalformed) {
    console.warn('[evaluator] forced malformed output (fail=json): attempt 1/2 failed');
    console.warn('[evaluator] forced malformed output (fail=json): attempt 2/2 failed');
    noteEvaluatorFallback('malformed_output');
    return fallbackSummarise({ turnScores, reason: 'malformed_output' });
  }

  if (noKey()) {
    noteEvaluatorFallback('no_api_key');
    return fallbackSummarise({ turnScores, reason: 'no_api_key' });
  }

  const user = {
    scenario_id: scenario?.id,
    scenario_title: scenario?.title,
    scenario_context: scenario?.context,
    npc_name: scenario?.npc_name,
    level: Number(level),
    allowed_code_switch: cfg?.allowed_code_switch,
    conversation: conversation || [],
    turn_scores: turnScores || [],
  };

  const ok = await attemptWithRetry({
    system: SUMMARY_SYSTEM_PROMPT,
    user,
    schema: SUMMARY_SCHEMA,
    schemaName: 'cakap_lah_conversation_summary',
    validate: validateSummaryOutput,
    label: 'summarise',
  });

  if (!ok) {
    noteEvaluatorFallback('llm_failed');
    return fallbackSummarise({ turnScores, reason: 'llm_failed' });
  }
  noteEvaluatorSuccess();
  return { ...ok, source: 'llm', fallback: false };
}
