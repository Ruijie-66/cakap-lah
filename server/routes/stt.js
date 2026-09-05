// server/routes/stt.js — POST /api/stt

import { Router } from 'express';
import multer from 'multer';
import { getAdapter, isForcedFailure } from '../adapters/index.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

const router = Router();

// Accept field name "audio" (primary) with "file" as an alias.
const uploadFields = upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'file', maxCount: 1 },
]);

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
    res.status(502).json({
      error: `STT failed: ${err.message}`,
    });
  }
});

export default router;
