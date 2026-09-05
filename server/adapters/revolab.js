// server/adapters/revolab.js
//
// The ONLY file in this project that knows the Revolab HTTP contract:
// base URL, endpoint paths, model IDs, and the auth header. No other file
// may reference api.revolab.ai, aisyah-1.0-pro, nada-1.0-pro, or the
// Authorization header directly.

import { REVOLAB_API_KEY, REVOLAB_BASE_URL } from '../config.js';

const STT_MODEL = 'aisyah-1.0-pro';
const TTS_MODEL = 'nada-1.0-pro';

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${REVOLAB_API_KEY}`,
    ...extra,
  };
}

async function readErrorBody(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function httpError(status, body) {
  const err = new Error(
    `Revolab API error ${status}: ${body || '(empty response body)'}`
  );
  err.status = status;
  err.body = body;
  return err;
}

/**
 * Transcribe audio via Revolab STT.
 * @param {{buffer: Buffer, filename?: string, mimetype?: string, language?: string}} input
 * @returns {Promise<{text: string, language: string, durationS: number, confidence: number, latencyMs: number}>}
 */
export async function transcribe({ buffer, filename, mimetype, language }) {
  if (!REVOLAB_API_KEY) {
    throw new Error('REVOLAB_API_KEY is not set — cannot call the live Revolab API.');
  }

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimetype || 'application/octet-stream' });
  form.append('file', blob, filename || 'audio.webm');
  form.append('model', STT_MODEL);
  if (language) form.append('language', language);

  const res = await fetch(`${REVOLAB_BASE_URL}/v1/stt`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  if (!res.ok) {
    throw httpError(res.status, await readErrorBody(res));
  }

  const data = await res.json();
  return {
    text: data.text,
    language: data.language,
    durationS: data.duration_s,
    confidence: data.confidence,
    latencyMs: data.latency_ms,
  };
}

/**
 * Synthesize speech via Revolab TTS.
 * @param {{text: string, voiceId: string, speed?: number, language?: string}} input
 * @returns {Promise<{audio: Buffer, contentType: string, durationS: number|null, latencyMs: number|null, requestId: string|null}>}
 */
export async function synthesize({ text, voiceId, speed, language }) {
  if (!REVOLAB_API_KEY) {
    throw new Error('REVOLAB_API_KEY is not set — cannot call the live Revolab API.');
  }

  const res = await fetch(`${REVOLAB_BASE_URL}/v1/tts`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      model: TTS_MODEL,
      text,
      voice_id: voiceId,
      language: language || 'ms',
      output_format: 'mp3',
      speed,
    }),
  });

  if (!res.ok) {
    throw httpError(res.status, await readErrorBody(res));
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    audio: Buffer.from(arrayBuffer),
    contentType: res.headers.get('content-type') || 'audio/mpeg',
    durationS: res.headers.get('x-duration-s')
      ? Number(res.headers.get('x-duration-s'))
      : null,
    latencyMs: res.headers.get('x-latency-ms')
      ? Number(res.headers.get('x-latency-ms'))
      : null,
    requestId: res.headers.get('x-request-id') || null,
  };
}

/**
 * List available models (used by the probe script).
 * @returns {Promise<string[]>}
 */
export async function listModels() {
  if (!REVOLAB_API_KEY) {
    throw new Error('REVOLAB_API_KEY is not set — cannot call the live Revolab API.');
  }

  const res = await fetch(`${REVOLAB_BASE_URL}/v1/models`, {
    method: 'GET',
    headers: authHeaders(),
  });

  if (!res.ok) {
    throw httpError(res.status, await readErrorBody(res));
  }

  return res.json();
}
