// server/routes/tts.js — POST /api/tts

import { Router } from 'express';
import { getAdapter, isForcedFailure } from '../adapters/index.js';

const DEFAULT_VOICE_ID = 'nur-b184422b';
const MAX_TEXT_LENGTH = 10000;
const MIN_SPEED = 0.5;
const MAX_SPEED = 2.0;

function clampSpeed(speed) {
  const n = Number(speed);
  if (!Number.isFinite(n)) return 1.0;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n));
}

const router = Router();

router.post('/api/tts', async (req, res) => {
  const body = req.body || {};
  const text = typeof body.text === 'string' ? body.text : '';

  if (!text.trim()) {
    res.status(400).json({ error: 'Field "text" is required and must be non-empty.' });
    return;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: `Field "text" must be at most ${MAX_TEXT_LENGTH} characters.` });
    return;
  }

  const voiceId = typeof body.voiceId === 'string' && body.voiceId ? body.voiceId : DEFAULT_VOICE_ID;
  const speed = clampSpeed(body.speed);
  const language = typeof body.language === 'string' && body.language ? body.language : 'ms';

  if (isForcedFailure(req, 'tts')) {
    res.status(502).json({ error: 'Simulated TTS failure (fail=tts).' });
    return;
  }

  try {
    const adapter = getAdapter(req);
    const result = await adapter.synthesize({ text, voiceId, speed, language });

    res.set('Content-Type', result.contentType || 'audio/mpeg');
    if (result.durationS != null) res.set('X-Duration-S', String(result.durationS));
    if (result.latencyMs != null) res.set('X-Latency-Ms', String(result.latencyMs));
    if (result.requestId) res.set('X-Request-Id', String(result.requestId));

    res.status(200).send(result.audio);
  } catch (err) {
    res.status(502).json({
      error: `TTS failed: ${err.message}`,
    });
  }
});

export default router;
