// server/adapters/mock.js
//
// Mirrors the transcribe/synthesize signatures of server/adapters/revolab.js
// but never makes a network call. Used when MOCK=1, or per-request via
// ?mock=1 / x-mock: 1, so the UI can be developed and demoed without a
// live Revolab API key.

import { fallbackEvaluate, fallbackSummarise } from '../game/scoring.js';

const MOCK_DELAY_MS = 300;

const MOCK_TRANSCRIPT = 'Bang, teh tarik satu, kurang manis.';

// A real ~0.3s silent MP3 (24kHz mono), generated with ffmpeg + libmp3lame
// and embedded as base64 so no binary asset file is needed.
const SILENT_MP3_BASE64 =
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYyLjEyLjEwMAAAAAAAAAAAAAAA//OEwAAAAAAAAAAAAEluZm8AAAAPAAAADwAABmAALS0tLS0tPDw8PDw8PEtLS0tLS1paWlpaWlppaWlpaWlpeHh4eHh4h4eHh4eHh5aWlpaWlpalpaWlpaW0tLS0tLS0w8PDw8PDw9LS0tLS0uHh4eHh4eHw8PDw8PDw////////AAAAAExhdmM2Mi4yOAAAAAAAAAAAAAAAACQDYAAAAAAAAAZga5fgdQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//NExAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExFMAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKYAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKwAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKwAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKwAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKwAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKwAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKwAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKwAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKwAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKwAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMu//NExKwAAANIAAAAADEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NExKwAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NExKwAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock transcribe — same signature/shape as adapters/revolab.js#transcribe.
 * @param {{buffer: Buffer, filename?: string, mimetype?: string, language?: string}} input
 * @returns {Promise<{text: string, language: string, durationS: number, confidence: number, latencyMs: number}>}
 */
export async function transcribe({ buffer } = {}) {
  const start = Date.now();
  await delay(MOCK_DELAY_MS);
  return {
    text: MOCK_TRANSCRIPT,
    language: 'Malay',
    durationS: buffer && buffer.length ? Math.max(1, buffer.length / 32000) : 2.9,
    confidence: 0.95,
    latencyMs: Date.now() - start,
  };
}

/**
 * Mock synthesize — same signature/shape as adapters/revolab.js#synthesize.
 * @param {{text: string, voiceId: string, speed?: number, language?: string}} input
 * @returns {Promise<{audio: Buffer, contentType: string, durationS: number, latencyMs: number, requestId: string}>}
 */
export async function synthesize({ text } = {}) {
  const start = Date.now();
  await delay(MOCK_DELAY_MS);
  return {
    audio: Buffer.from(SILENT_MP3_BASE64, 'base64'),
    contentType: 'audio/mpeg',
    durationS: 0.3,
    latencyMs: Date.now() - start,
    requestId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

// ---------------------------------------------------------------------------
// Mock evaluator (Task 2) — mirrors server/adapters/evaluator.js
// ---------------------------------------------------------------------------

/** Small stable hash so the same transcript always mocks the same way. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const MOCK_NPC_REPLIES = {
  success: ['Ha, boleh boleh. Kejap ya.', 'Ok faham, saya buatkan sekarang.', 'Baik, tiada masalah.'],
  partial: ['Hmm, ok. Macam mana tadi? Sekali lagi boleh?', 'Ok... saya rasa saya faham. Jap ya.'],
  retry: ['Hah? Maaf, tak dengar. Boleh ulang?', 'Eh, apa tu? Cakap sekali lagi boleh?'],
};

const MOCK_COACHING = {
  success: {
    what_worked: 'Maksud anda jelas dan tugasan tercapai.',
    improvement: 'Cuba tambah satu perkataan sopan seperti "boleh" untuk bunyi lebih natural.',
  },
  partial: {
    what_worked: 'Anda berjaya sampaikan sebahagian besar maksud anda.',
    improvement: 'Sebut butiran yang tertinggal supaya permintaan anda lengkap.',
  },
  retry: {
    what_worked: 'Anda berani cuba bercakap — itu langkah pertama.',
    improvement: 'Cuba sebut tugasan itu dengan ayat yang lebih lengkap.',
  },
};

const MOCK_SCORES = {
  success: { intent_score: 95, semantic_score: 90, comprehensibility_score: 92, naturalness_score: 84 },
  partial: { intent_score: 70, semantic_score: 66, comprehensibility_score: 74, naturalness_score: 62 },
  retry: { intent_score: 40, semantic_score: 35, comprehensibility_score: 50, naturalness_score: 45 },
};

/**
 * Mock evaluate — same signature/shape as adapters/evaluator.js#evaluate.
 * Deliberately varied (not always success) so all three UI branches can be
 * demoed without spending credits.
 */
export async function evaluate(input = {}) {
  const { step, transcript = '' } = input;

  if (input.forceUpstreamError) {
    throw new Error('Simulated evaluator upstream failure (fail=eval).');
  }
  if (input.forceMalformed) {
    console.warn('[mock evaluator] forced malformed output (fail=json): attempt 1/2 failed');
    console.warn('[mock evaluator] forced malformed output (fail=json): attempt 2/2 failed');
    return fallbackEvaluate({ step, transcript, reason: 'malformed_output' });
  }

  await delay(MOCK_DELAY_MS);

  const words = String(transcript).trim().split(/\s+/).filter(Boolean);
  let result;
  if (words.length < 3) {
    result = 'retry';
  } else {
    const bucket = hash(`${step?.id || ''}|${transcript}`) % 10;
    result = bucket <= 5 ? 'success' : bucket <= 8 ? 'partial' : 'retry';
  }

  const replies = MOCK_NPC_REPLIES[result];
  return {
    ...MOCK_SCORES[result],
    intent_pass: result === 'success',
    ...MOCK_COACHING[result],
    npc_reply: replies[hash(transcript) % replies.length],
    source: 'mock',
    fallback: false,
  };
}

/** Mock summarise — same signature/shape as adapters/evaluator.js#summarise. */
export async function summarise(input = {}) {
  const { turnScores = [], conversation = [] } = input;

  if (input.forceUpstreamError) {
    throw new Error('Simulated summariser upstream failure (fail=eval).');
  }
  if (input.forceMalformed) {
    console.warn('[mock evaluator] forced malformed output (fail=json): attempt 1/2 failed');
    console.warn('[mock evaluator] forced malformed output (fail=json): attempt 2/2 failed');
    return fallbackSummarise({ turnScores, reason: 'malformed_output' });
  }

  await delay(MOCK_DELAY_MS);

  const nums = turnScores
    .map((t) => (typeof t === 'number' ? t : t && t.overall_score))
    .map(Number)
    .filter(Number.isFinite);
  const avg = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 78;
  // Not a plain average: the mock nudges for recovery across the conversation.
  const overall = Math.min(100, Math.max(0, avg + (nums.length > 1 && nums[nums.length - 1] > nums[0] ? 4 : -2)));

  const said = conversation
    .map((t) => (t && typeof t.player === 'string' ? t.player : ''))
    .join(' ')
    .toLowerCase();
  const upgrades = [];
  if (said.includes('less sweet')) upgrades.push({ you_said: 'less sweet', try: 'kurang manis' });
  if (said.includes('sorry')) upgrades.push({ you_said: 'sorry', try: 'maaf' });
  if (said.includes('order')) upgrades.push({ you_said: 'order', try: 'pesan' });
  if (said.includes('thanks') || said.includes('thank you')) {
    upgrades.push({ you_said: 'thanks', try: 'terima kasih' });
  }

  return {
    overall_score: overall,
    verdict: overall >= 75 ? 'Dah boleh cakap.' : 'Hampir dah — cuba sekali lagi.',
    summary:
      'Anda mula sedikit teragak-agak tetapi pulih pada giliran seterusnya dan berjaya menyampaikan maksud anda. Nada anda sesuai untuk situasi ini. Perbualan ini akan berjaya dalam kehidupan sebenar.',
    strengths: ['Maksud anda jelas walaupun ayat pendek.', 'Anda pulih selepas giliran yang tersasar.'],
    improvements: ['Kurangkan tukar ke bahasa Inggeris.', 'Tambah kata sopan seperti "boleh" dan "ya".'],
    bm_upgrades: upgrades,
    source: 'mock',
    fallback: false,
  };
}
