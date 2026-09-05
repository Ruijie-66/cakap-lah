// public/js/api.js — thin fetch wrappers for the CAKAP LAH! server API.
//
// The browser NEVER holds the Revolab key: it only ever talks to /api/*, and
// the server signs the upstream calls. Nothing in this file (or anything it
// imports) should ever carry a credential.
//
// Mock / failure toggles: the server reads ?mock=1 and ?fail=stt|tts off the
// request query string (see server/adapters/index.js). We mirror whatever is
// on the *page's* own URL onto every API call, so loading
// http://localhost:3000/?mock=1&fail=tts exercises those paths end to end
// without any code change.

const DEFAULT_TIMEOUT_MS = 30000;

/** Query params on the page URL that we forward to the API. */
const FORWARDED_PARAMS = ['mock', 'fail'];

/**
 * Build an API path with the page's mock/fail params appended.
 * @param {string} path e.g. '/api/stt'
 * @param {Record<string,string|number>} [extra] additional query params
 * @returns {string}
 */
export function apiUrl(path, extra = {}) {
  const url = new URL(path, window.location.origin);
  const pageParams = new URLSearchParams(window.location.search);
  for (const key of FORWARDED_PARAMS) {
    const value = pageParams.get(key);
    if (value !== null) url.searchParams.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.pathname + (url.search || '');
}

/** True when the page URL asks for mock mode. Handy for UI badges. */
export function isMockMode() {
  return new URLSearchParams(window.location.search).get('mock') === '1';
}

/**
 * An error with a human-readable `.message` safe to show a player, plus
 * machine-readable extras for logging.
 */
export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'error', cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind; // 'timeout' | 'network' | 'http' | 'error'
    if (cause) this.cause = cause;
  }
}

/**
 * fetch() with an AbortController timeout and human-readable failures.
 * @param {string} url
 * @param {RequestInit & {timeoutMs?: number, label?: string}} [options]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, label = 'The server', ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new ApiError(
        `${label} took longer than ${Math.round(timeoutMs / 1000)} seconds to answer. Please try again.`,
        { kind: 'timeout', cause: err },
      );
    }
    throw new ApiError(
      `Could not reach the server. Check that it is running, then try again.`,
      { kind: 'network', cause: err },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the server's `{ error }` message out of a failed response, falling back
 * to something a human can read.
 * @param {Response} res
 * @param {string} label
 * @returns {Promise<ApiError>}
 */
async function errorFromResponse(res, label) {
  let detail = '';
  try {
    const text = await res.text();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        detail = typeof parsed?.error === 'string' ? parsed.error : '';
      } catch {
        // Non-JSON. Express's 404/500 pages are HTML — never show markup to a
        // player; a short plain-text body is fine.
        const trimmed = text.trim();
        detail = trimmed.startsWith('<') ? '' : trimmed.slice(0, 200);
      }
    }
  } catch {
    /* body already consumed or unreadable — fall through to the generic text */
  }
  const message = detail || `${label} failed (HTTP ${res.status}). Please try again.`;
  return new ApiError(message, { status: res.status, kind: 'http' });
}

/** Map a blob MIME type to a filename the server/upstream will recognise. */
function filenameFor(mimeType = '') {
  const base = String(mimeType).split(';')[0].trim().toLowerCase();
  const ext =
    {
      'audio/webm': 'webm',
      'video/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/mp4': 'm4a',
      'video/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/aac': 'aac',
    }[base] || 'webm';
  return `recording.${ext}`;
}

/**
 * Send a recorded audio blob for transcription.
 * @param {Blob} blob raw MediaRecorder output — no transcoding
 * @param {string} [mimeType] defaults to blob.type
 * @param {{language?: string, timeoutMs?: number}} [options]
 * @returns {Promise<{text: string, confidence: number|null, durationS: number|null, latencyMs: number|null}>}
 */
export async function stt(blob, mimeType, options = {}) {
  if (!blob || !blob.size) {
    throw new ApiError('No audio was captured. Try recording again.', { kind: 'error' });
  }
  const type = mimeType || blob.type || 'audio/webm';
  const form = new FormData();
  form.append('audio', blob, filenameFor(type));
  form.append('language', options.language || 'ms');

  const res = await fetchWithTimeout(apiUrl('/api/stt'), {
    method: 'POST',
    body: form,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: 'Transcription',
  });
  if (!res.ok) throw await errorFromResponse(res, 'Transcription');
  return res.json();
}

/**
 * Synthesise speech. Resolves to a playable blob plus server timing headers.
 * @param {{text: string, voiceId?: string, speed?: number, language?: string, timeoutMs?: number}} params
 * @returns {Promise<{blob: Blob, contentType: string, durationS: number|null, latencyMs: number|null}>}
 */
export async function tts({ text, voiceId, speed, language, timeoutMs } = {}) {
  if (!text || !String(text).trim()) {
    throw new ApiError('There is nothing to say — the reply text was empty.', { kind: 'error' });
  }
  const body = { text: String(text) };
  if (voiceId) body.voiceId = voiceId;
  if (speed != null) body.speed = speed;
  if (language) body.language = language;

  const res = await fetchWithTimeout(apiUrl('/api/tts'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: 'The voice',
  });
  if (!res.ok) throw await errorFromResponse(res, 'The voice');

  const contentType = res.headers.get('Content-Type') || 'audio/mpeg';
  const durationS = numberOrNull(res.headers.get('X-Duration-S'));
  const latencyMs = numberOrNull(res.headers.get('X-Latency-Ms'));
  const blob = await res.blob();
  return { blob, contentType, durationS, latencyMs };
}

function numberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Generic JSON GET/POST helper for the routes built by the game-content task.
 * @param {string} path
 * @param {{method?: string, body?: any, query?: object, timeoutMs?: number, label?: string}} [options]
 */
async function json(path, options = {}) {
  const { method = 'GET', body, query, timeoutMs, label = 'The server' } = options;
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetchWithTimeout(apiUrl(path, query), { ...init, timeoutMs, label });
  if (!res.ok) throw await errorFromResponse(res, label);
  return res.json();
}

// --- Routes owned by the game-content/server task. These wrappers exist so
// --- the game engine has a single import surface; they are NOT yet verified
// --- against a live implementation.

/** @returns {Promise<any>} list of available scenarios */
export function getScenarios(options = {}) {
  return json('/api/scenarios', { label: 'Loading scenarios', ...options });
}

/**
 * @param {string} id scenario id, e.g. 'mamak_01'
 * @param {string} [level] difficulty level
 */
export function getScenario(id, level, options = {}) {
  return json(`/api/scenarios/${encodeURIComponent(id)}`, {
    query: level ? { level } : undefined,
    label: 'Loading the scenario',
    ...options,
  });
}

/** @param {object} payload turn data to grade */
export function evaluate(payload, options = {}) {
  return json('/api/evaluate', { method: 'POST', body: payload, label: 'Scoring your answer', ...options });
}

/** @param {object} payload session data to summarise */
export function summarise(payload, options = {}) {
  return json('/api/summarise', { method: 'POST', body: payload, label: 'Building your summary', ...options });
}

/** @returns {Promise<{ok: boolean, mock: boolean}>} */
export function health(options = {}) {
  return json('/api/health', { label: 'Health check', ...options });
}
