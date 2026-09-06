// server/game/spoken-text.js
//
// /api/tts used to accept any string up to 10,000 characters. On a public URL
// that is a free text-to-speech proxy backed by a finite hackathon quota, and
// rate limiting only slows it down. This module removes the abuse entirely by
// answering a different question: *is this a line the game actually produces?*
//
// There are exactly two ways a line can be legitimate.
//
//   1. It is authored content — a scenario `intro`, a step `tts_prompt`, a
//      `complete.npc_line`, an `npc_reprompt`, or one of the handful of fixed
//      client-side strings the UI can speak. All of that is known at startup,
//      so it becomes a static set.
//
//   2. The server itself generated it this session — an `npc_reply` from
//      /api/evaluate, the coaching line the coach voice reads out, the
//      verdict/summary from /api/summarise. Those routes register what they
//      return, keyed by the caller's session, and /api/tts will speak a
//      registered line back for as long as that session lives.
//
// Nothing else is spoken. The failure mode to fear is the opposite one — a
// legitimate line rejected leaves the player in silence — so every rejection
// is logged with the text that was refused, and the client degrades to showing
// the line on screen rather than dead-ending.

import { getScenario, listScenarios } from './scenarios.js';

/** Longest line the game ever speaks (verdict + summary) with headroom. */
export const MAX_SPOKEN_LENGTH = 1200;

/** How long a session's generated lines stay speakable. */
const SESSION_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
/** Cap per session, so one caller cannot grow the cache without bound. */
const MAX_LINES_PER_SESSION = 400;
/** Cap on concurrent sessions held in memory. */
const MAX_SESSIONS = 1000;

/**
 * Canonical form for comparison: NFC, whitespace collapsed, case-folded.
 * Forgiving on purpose — the client trims and joins strings on its way to the
 * speaker, and a trailing space must never cost the player a voice line.
 * @param {unknown} text
 * @returns {string}
 */
export function normaliseSpoken(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Fixed strings the browser can put through /api/tts that are not authored
 * scenario content. Each one is a literal in the client — keep this list and
 * the client in step, or the line plays as silence.
 *
 *   BAND_FLAVOUR          public/js/game/scoring.js — stand-in coaching line
 *   localSummary()        public/js/game/engine.js — offline end screen, spoken
 *                         by the verdict button as `verdict` and as
 *                         `verdict + ' ' + summary`
 */
const LOCAL_VERDICTS = ['Dah boleh cakap.', 'Hampir dah — cuba sekali lagi.'];
const LOCAL_SUMMARY =
  'Anda telah menghabiskan perbualan ini. Skor di atas dikira daripada giliran-giliran anda kerana ringkasan penuh tidak dapat dimuatkan.';

export const CLIENT_FIXED_LINES = Object.freeze([
  // public/js/game/scoring.js BAND_FLAVOUR
  'Power! Macam orang local dah.',
  'Boleh! Mesej sampai.',
  'Hampir — sikit lagi.',
  'Bahasa Melayu belum give up on you. Cuba lagi.',
  // public/js/game/engine.js NO_INPUT_MESSAGE (shown, but cheap to allow)
  'Tak dengar tadi — cuba lagi.',
  // public/js/game/engine.js localSummary()
  ...LOCAL_VERDICTS,
  LOCAL_SUMMARY,
  ...LOCAL_VERDICTS.map((v) => `${v} ${LOCAL_SUMMARY}`),
]);

/**
 * Walk one scenario and yield every string it can cause to be spoken.
 * @param {object} scenario the FULL server-side scenario
 */
function* scenarioLines(scenario) {
  if (!scenario) return;
  if (scenario.intro?.text) yield scenario.intro.text;
  if (scenario.npc_reprompt) yield scenario.npc_reprompt;

  const complete = Array.isArray(scenario.complete) ? scenario.complete : [scenario.complete];
  for (const variant of complete) {
    if (variant?.npc_line) yield variant.npc_line;
  }

  for (const step of scenario.steps || []) {
    if (step.tts_prompt) yield step.tts_prompt;
    if (step.npc_reprompt) yield step.npc_reprompt;
    // retry_hint is returned as `improvement` on the no-input path, and the
    // coach button speaks whatever is in the coaching slot.
    if (step.retry_hint) yield step.retry_hint;
  }
}

/** @type {Set<string>} */
let STATIC_LINES = null;

/** Build (once) the set of authored lines. Exported for the tests. */
export function staticSpokenLines() {
  if (STATIC_LINES) return STATIC_LINES;
  const set = new Set();
  for (const line of CLIENT_FIXED_LINES) set.add(normaliseSpoken(line));
  for (const summary of listScenarios()) {
    for (const line of scenarioLines(getScenario(summary.id))) set.add(normaliseSpoken(line));
  }
  set.delete('');
  STATIC_LINES = set;
  return set;
}

// ---------------------------------------------------------------------------
// Session-scoped registry of server-generated lines
// ---------------------------------------------------------------------------

/** @type {Map<string, {expires: number, lines: Set<string>}>} */
const sessions = new Map();

function bucketFor(sessionId, now = Date.now()) {
  let bucket = sessions.get(sessionId);
  if (bucket && bucket.expires <= now) {
    sessions.delete(sessionId);
    bucket = undefined;
  }
  if (!bucket) {
    bucket = { expires: now + SESSION_TTL_MS, lines: new Set() };
    sessions.set(sessionId, bucket);
  }
  return bucket;
}

function evictExpired(now = Date.now()) {
  for (const [id, bucket] of sessions) {
    if (bucket.expires <= now) sessions.delete(id);
  }
}

/**
 * Remember lines this server just generated so the browser may speak them.
 *
 * Called by /api/evaluate and /api/summarise with everything they return that
 * can reach a voice: `npc_reply`, the coaching text (`what_worked` /
 * `improvement`), and the summary `verdict` / `summary`. The joined
 * "verdict summary" form the end screen speaks is registered too — the client
 * concatenates before it asks, so the server has to anticipate the join.
 *
 * A missing session id is a no-op rather than an error: the request still
 * succeeds, the player just falls back to the static allowlist.
 *
 * @param {string} sessionId
 * @param {...(string|null|undefined)} texts
 */
export function registerSpoken(sessionId, ...texts) {
  if (!sessionId) return;
  const now = Date.now();
  const bucket = bucketFor(sessionId, now);
  bucket.expires = now + SESSION_TTL_MS;

  for (const text of texts) {
    const key = normaliseSpoken(text);
    if (!key || key.length > MAX_SPOKEN_LENGTH) continue;
    if (bucket.lines.size >= MAX_LINES_PER_SESSION && !bucket.lines.has(key)) {
      // Drop the oldest insertion — Sets preserve insertion order.
      bucket.lines.delete(bucket.lines.values().next().value);
    }
    bucket.lines.add(key);
  }

  if (sessions.size > MAX_SESSIONS) {
    evictExpired(now);
    let excess = sessions.size - MAX_SESSIONS;
    for (const id of sessions.keys()) {
      if (excess <= 0) break;
      if (id === sessionId) continue;
      sessions.delete(id);
      excess -= 1;
    }
  }
}

/**
 * May this text be synthesised for this session?
 * @param {string} text
 * @param {string} [sessionId]
 * @returns {{allowed: boolean, source: 'content'|'session'|'rejected'}}
 */
export function isSpeakable(text, sessionId = '') {
  const key = normaliseSpoken(text);
  if (!key) return { allowed: false, source: 'rejected' };
  if (staticSpokenLines().has(key)) return { allowed: true, source: 'content' };
  if (sessionId) {
    const bucket = sessions.get(sessionId);
    if (bucket && bucket.expires > Date.now() && bucket.lines.has(key)) {
      return { allowed: true, source: 'session' };
    }
  }
  return { allowed: false, source: 'rejected' };
}

/** Test helper. */
export function resetSpokenRegistry() {
  sessions.clear();
  STATIC_LINES = null;
}

/** Test/introspection helper. */
export function spokenRegistryStats() {
  return { sessions: sessions.size, staticLines: staticSpokenLines().size };
}
