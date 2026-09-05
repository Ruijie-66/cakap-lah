// server/index.js — express app entrypoint

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { PORT, MOCK } from './config.js';
import sttRouter from './routes/stt.js';
import ttsRouter from './routes/tts.js';
import scenariosRouter from './routes/scenarios.js';
import evaluateRouter from './routes/evaluate.js';
import summariseRouter from './routes/summarise.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mock: MOCK });
});

app.use(sttRouter);
app.use(ttsRouter);
app.use(scenariosRouter);
app.use(evaluateRouter);
app.use(summariseRouter);

app.use(express.static(publicDir));

// Exported so tests (and any future embedder) can boot the same app on an
// ephemeral port; we only listen when this file is the process entrypoint.
export default app;
export { app };

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  app.listen(PORT, () => {
    console.log(`CAKAP LAH! server listening on http://localhost:${PORT} (mock=${MOCK})`);
  });
}
