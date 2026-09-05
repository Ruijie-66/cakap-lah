// server/index.js — express app entrypoint

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { PORT, MOCK } from './config.js';
import sttRouter from './routes/stt.js';
import ttsRouter from './routes/tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mock: MOCK });
});

// Later tasks mount their own routers the same way, right here:
//   import evaluateRouter from './routes/evaluate.js';
//   app.use(evaluateRouter);
app.use(sttRouter);
app.use(ttsRouter);

app.use(express.static(publicDir));

app.listen(PORT, () => {
  console.log(`CAKAP LAH! server listening on http://localhost:${PORT} (mock=${MOCK})`);
});
