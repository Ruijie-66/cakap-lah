// server/routes/stt.js — POST /api/stt

import { Router } from 'express';
import multer from 'multer';
import { getAdapter, isForcedFailure } from '../adapters/index.js';

// A 20-second recording (the client's own cap, see public/js/audio/recorder.js
// MAX_RECORDING_MS) is roughly 30 KB of Opus/WebM. The old 50 MB ceiling was
// sized for a 30-minute file and, on a public URL, is 1500x more upload than
// this endpoint can ever legitimately need. 4 MB leaves a very large margin
// for a verbose codec while keeping a single request cheap to refuse.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8, parts: 12 },
});

const router = Router();

// Accept field name "audio" (primary) with "file" as an alias.
const rawUploadFields = upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'file', maxCount: 1 },
]);

// multer rejects an oversized or malformed upload by calling next(err), which
// without this handler becomes express's HTML 500 page — markup the player
// would see verbatim. Turn it into the same human-readable JSON every other
// failure on this route uses.
function uploadFields(req, res, next) {
  rawUploadFields(req, res, (err) => {
    if (!err) return next();
    console.warn(`[stt] upload rejected: ${err.code || ''} ${err.message}`);
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(413).json({
      error: tooBig
        ? `That recording is too large (limit ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB). Record a shorter answer and try again.`
        : 'That upload could not be read. Please try recording again.',
    });
  });
}

router.post('/api/stt', uploadFields, async (req, res) => {
  const uploaded =
    (req.files && req.files.audio && req.files.audio[0]) ||
    (req.files && req.files.file && req.files.file[0]) ||
    null;

  if (!uploaded) {
    res.status(400).json({ error: 'No audio file uploaded. Send it as multipart field "audio".' });
    return;
  }

  if (isForcedFailure(req, 'stt')) {
    res.status(502).json({ error: 'Simulated STT failure (fail=stt).' });
    return;
  }

  try {
    const adapter = getAdapter(req);
    const language = typeof req.body?.language === 'string' ? req.body.language : 'ms';

    const result = await adapter.transcribe({
      buffer: uploaded.buffer,
      filename: uploaded.originalname,
      mimetype: uploaded.mimetype,
      language,
    });

    // Empty/whitespace transcript is not an error — 200 with text: "".
    const text = typeof result.text === 'string' ? result.text : '';

    res.status(200).json({
      text: text.trim() ? text : '',
      confidence: result.confidence ?? null,
      durationS: result.durationS ?? null,
      latencyMs: result.latencyMs ?? null,
    });
  } catch (err) {
    // D10: the provider's error body never reaches the browser.
    console.error(`[stt] upstream failure: ${err?.message || err}`);
    res.status(502).json({
      error: 'We could not transcribe that recording. Please try again.',
    });
  }
});

export default router;
