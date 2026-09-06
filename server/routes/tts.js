// server/routes/tts.js — POST /api/tts
//
// This route is the only thing on the box that turns arbitrary text into
// upstream spend, so it is locked to text the game actually produces. See
// server/game/spoken-text.js for the two ways a line qualifies (authored
// content, or a line this server generated for this session).

import { Router } from 'express';
import { getAdapter, isForcedFailure } from '../adapters/index.js';
import { isSpeakable, MAX_SPOKEN_LENGTH } from '../game/spoken-text.js';
import { sessionKey } from '../middleware/rate-limit.js';

const DEFAULT_VOICE_ID = 'nur-b184422b';
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
  if (text.length > MAX_SPOKEN_LENGTH) {
    res.status(400).json({ error: `Field "text" must be at most ${MAX_SPOKEN_LENGTH} characters.` });
    return;
  }

  const session = sessionKey(req);
  const verdict = isSpeakable(text, session);
  if (!verdict.allowed) {
    // Log loudly and in full. If this ever fires for a legitimate line the
    // player hears silence, and this line in the log is how that gets found.
    console.warn(
      `[tts] REJECTED text not in the game's allowlist (session="${session || '-'}"): ` +
        JSON.stringify(text.slice(0, 300)),
    );
    res.status(403).json({
      error:
        'Suara ini tidak tersedia untuk teks tersebut. ' +
        '(This voice only speaks lines from the game.)',
    });
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
    // D10: never echo the provider's error body to the browser — it can carry
    // upstream request ids, quota details and key state. The player gets a
    // sentence they can act on; the detail stays in the server log.
    console.error(`[tts] upstream failure: ${err?.message || err}`);
    res.status(502).json({
      error: 'The voice service is not responding right now. Please try again.',
    });
  }
});

export default router;
