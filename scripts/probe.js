#!/usr/bin/env node
// scripts/probe.js — "is the key alive" smoke test against the live Revolab API.
//
// Sequentially: key present -> GET /v1/models -> list voices -> TTS a short
// Malay line -> feed those bytes straight back into STT -> print transcript,
// confidence, latency for each leg. Prints PASS/FAIL per step and exits
// non-zero on failure.

import { REVOLAB_API_KEY, REVOLAB_BASE_URL } from '../server/config.js';
import { listModels, synthesize, transcribe } from '../server/adapters/revolab.js';

const VOICE_TABLE = [
  { id: 'paan-f695215e', lang: 'ms', gender: 'M' },
  { id: 'ali-13002bfa', lang: 'ms', gender: 'M' },
  { id: 'peter-aa4355f2', lang: 'ms', gender: 'M' },
  { id: 'angel-e67ca253', lang: 'ms', gender: 'F' },
  { id: 'nur-b184422b', lang: 'ms', gender: 'F' },
  { id: 'liyana-fb5824d7', lang: 'ms', gender: 'F' },
  { id: 'salina-d3e1a70d', lang: 'ms', gender: 'F' },
  { id: 'ahmad-642668a6', lang: 'en', gender: 'M' },
];

const PROBE_TEXT = 'Selamat pagi, apa khabar?';

let failed = false;

function ok(step, detail) {
  console.log(`✅ ${step}${detail ? ' — ' + detail : ''}`);
}

function fail(step, detail) {
  failed = true;
  console.log(`❌ ${step}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  console.log(`Probing Revolab API at ${REVOLAB_BASE_URL}\n`);

  // 1. Key present
  if (!REVOLAB_API_KEY) {
    fail('REVOLAB_API_KEY present', 'not set in environment/.env — cannot proceed with any live call');
    console.log('\nSet REVOLAB_API_KEY in .env (see .env.example) and re-run: npm run probe');
    process.exit(1);
    return;
  }
  ok('REVOLAB_API_KEY present');

  // 2. GET /v1/models
  let models;
  try {
    models = await listModels();
    ok('GET /v1/models', JSON.stringify(models));
  } catch (err) {
    fail('GET /v1/models', err.message);
    process.exit(1);
    return;
  }

  // 3. List voices (API doesn't expose a voices endpoint per the contract — print the known table)
  ok('Voice list', `${VOICE_TABLE.length} known voices (no /v1/voices endpoint; using documented table)`);
  console.table(VOICE_TABLE);

  // 4. TTS a short Malay line
  let ttsResult;
  try {
    ttsResult = await synthesize({
      text: PROBE_TEXT,
      voiceId: 'nur-b184422b',
      speed: 1.0,
      language: 'ms',
    });
    ok(
      'POST /v1/tts',
      `${ttsResult.audio.length} bytes, contentType=${ttsResult.contentType}, durationS=${ttsResult.durationS}, latencyMs=${ttsResult.latencyMs}, requestId=${ttsResult.requestId}`
    );
  } catch (err) {
    fail('POST /v1/tts', err.message);
    process.exit(1);
    return;
  }

  // 5. Feed those bytes straight back into STT
  try {
    const sttResult = await transcribe({
      buffer: ttsResult.audio,
      filename: 'probe.mp3',
      mimetype: 'audio/mpeg',
      language: 'ms',
    });
    ok(
      'POST /v1/stt (round-trip of TTS output)',
      `text="${sttResult.text}", language=${sttResult.language}, confidence=${sttResult.confidence}, durationS=${sttResult.durationS}, latencyMs=${sttResult.latencyMs}`
    );
  } catch (err) {
    fail('POST /v1/stt (round-trip of TTS output)', err.message);
    process.exit(1);
    return;
  }

  console.log('\nAll probe steps passed.');
  process.exit(0);
}

main().catch((err) => {
  fail('probe (unexpected error)', err.stack || err.message);
  process.exit(1);
});
