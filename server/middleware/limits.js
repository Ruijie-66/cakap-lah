// server/middleware/limits.js — the actual budgets, in one place.
//
// Sizing rationale (a real mission, measured against the loop in
// public/js/game/engine.js):
//
//   intro TTS 1 + per step (prompt TTS 1, STT 1, evaluate 1, reply TTS 1,
//   plus a re-prompt TTS on a retry) + closing TTS 1 + summarise 1, and a
//   player may press "Dengar sekali lagi" or "Dengar coach" a few times.
//
// A 3-step mission is therefore ~12-20 API calls over 3-5 minutes, and a
// player retrying everything and replaying every line peaks around 15 costly
// calls a minute. Every budget below is sized against that number.

import { createWindow, clientKey, sessionKey, limiter } from './rate-limit.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * The shape of the policy, and why it is three layers rather than one:
 *
 *   per SESSION  — the tight one. A single player, honest or not, is capped at
 *                  a rate a human cannot exceed. This is the fairness layer.
 *   per IP       — the backstop, for a client that rotates its session id.
 *                  Deliberately LOOSE, because at a hackathon a whole room of
 *                  judges shares one venue NAT and therefore one IP. Sized for
 *                  ~5 simultaneous players, not for one.
 *   global       — the quota ceiling. Whatever else happens, this bounds the
 *                  spend per minute for the entire box.
 *
 * Making the per-IP layer the tight one is the tempting mistake: it would trip
 * the moment two judges opened the link from the same wifi, and the demo would
 * look broken to exactly the people it is for.
 */

/** Everything under /api/*, including the cheap JSON routes. */
export const GENERAL_PER_IP = { windowMs: MINUTE, max: 300 };
export const GENERAL_GLOBAL = { windowMs: MINUTE, max: 1500 };

/**
 * The four routes that spend upstream quota, per player. A turn costs about
 * five of these (prompt TTS, STT, evaluate, reply TTS, coach TTS) and takes
 * 20s at the very fastest, so ~15/minute is flat-out human play. 30 is double
 * that and still far below anything that drains a quota.
 */
export const COSTLY_PER_SESSION_MINUTE = { windowMs: MINUTE, max: 30 };
/** Same routes, per IP — sized for ~5 players sharing one NAT. */
export const COSTLY_PER_IP = { windowMs: MINUTE, max: 150 };
/** Same routes, whole box. The hard ceiling on spend per minute. */
export const COSTLY_GLOBAL = { windowMs: MINUTE, max: 300 };

/**
 * Per-session turn budget. One mission scores 3-6 turns, so 60 scored turns an
 * hour is roughly ten full missions — beyond any honest demo session, and a
 * hard stop on a script looping one browser tab. A hostile client can mint a
 * new session id per request, which is exactly why the per-IP window above is
 * the real backstop; this budget is fairness, not security.
 */
export const SESSION_TURNS = { windowMs: HOUR, max: 60 };
/** ...and a session-wide ceiling on all four costly routes. */
export const SESSION_COSTLY = { windowMs: HOUR, max: 400 };

export const windows = {
  generalIp: createWindow(GENERAL_PER_IP),
  generalGlobal: createWindow({ ...GENERAL_GLOBAL, maxKeys: 4 }),
  costlyIp: createWindow(COSTLY_PER_IP),
  costlySessionMinute: createWindow({ ...COSTLY_PER_SESSION_MINUTE, maxKeys: 2000 }),
  costlyGlobal: createWindow({ ...COSTLY_GLOBAL, maxKeys: 4 }),
  sessionTurns: createWindow({ ...SESSION_TURNS, maxKeys: 2000 }),
  sessionCostly: createWindow({ ...SESSION_COSTLY, maxKeys: 2000 }),
};

/** Reset every window — used by the tests, never in production. */
export function resetAllLimits() {
  for (const w of Object.values(windows)) w.reset();
}

const GLOBAL_KEY = () => 'global';

/**
 * Applied to every /api/* request.
 *
 * Note what is deliberately NOT here: a mock-mode exemption. Mock mode is a
 * demo fallback that must stay reachable in production, but exempting it from
 * accounting would hand anyone a `?mock=1` bypass that keeps the limiter's
 * counters empty while they probe for other holes. Mock requests cost no
 * upstream quota, so they never trip the *costly* windows they are cheap
 * against — they simply still count as traffic.
 */
export const generalLimiter = limiter([
  { window: windows.generalGlobal, key: GLOBAL_KEY, label: 'global /api ceiling' },
  { window: windows.generalIp, key: clientKey, label: 'per-IP /api budget' },
]);

/** Applied to /api/tts, /api/stt, /api/evaluate and /api/summarise. */
export const costlyLimiter = limiter([
  { window: windows.costlyGlobal, key: GLOBAL_KEY, label: 'global upstream ceiling' },
  { window: windows.costlyIp, key: clientKey, label: 'per-IP upstream budget' },
  {
    window: windows.costlySessionMinute,
    key: sessionKey,
    label: 'per-session upstream rate',
  },
  {
    window: windows.sessionCostly,
    key: sessionKey,
    label: 'per-session upstream budget',
  },
]);

/** Applied to /api/evaluate only — the per-session turn budget. */
export const turnBudgetLimiter = limiter([
  { window: windows.sessionTurns, key: sessionKey, label: 'per-session turn budget' },
]);
