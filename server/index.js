// server/index.js — express app entrypoint

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { PORT, HOST, MOCK, TRUST_PROXY } from './config.js';
import { generalLimiter, costlyLimiter, turnBudgetLimiter } from './middleware/limits.js';
import sttRouter from './routes/stt.js';
import ttsRouter from './routes/tts.js';
import scenariosRouter from './routes/scenarios.js';
import evaluateRouter from './routes/evaluate.js';
import summariseRouter from './routes/summarise.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();

// How many reverse proxies sit in front of this process. On Render/Fly/Railway
// that is exactly one, and `1` makes req.ip the address that proxy appended to
// X-Forwarded-For — the only entry in the chain a caller cannot forge. Set
// TRUST_PROXY=0 if the process is ever exposed directly. Getting this wrong is
// the classic rate-limiter bug in both directions: 0 behind a proxy buckets
// every visitor as one client, and `true` lets any caller spoof a fresh IP.
app.set('trust proxy', TRUST_PROXY);
app.disable('x-powered-by');

// 64 KB is far more than any of these routes' JSON bodies (the largest is a
// summarise payload with a whole conversation in it, a few KB). The old 1 MB
// ceiling was free memory for anyone posting junk.
app.use(express.json({ limit: '64kb' }));

// Every /api/* request is accounted, mock mode included — a `?mock=1` bypass
// that left the counters empty would be a hole worth probing. Mock requests
// cost no upstream quota, so they are cheap against the budgets they consume.
app.use('/api', generalLimiter);
// The four routes that spend the Revolab / OpenAI quota.
app.use(['/api/tts', '/api/stt', '/api/evaluate', '/api/summarise'], costlyLimiter);
// …and a per-session ceiling on scored turns on top of that.
app.use('/api/evaluate', turnBudgetLimiter);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mock: MOCK });
});

app.use(sttRouter);
app.use(ttsRouter);
app.use(scenariosRouter);
app.use(evaluateRouter);
app.use(summariseRouter);

app.use(express.static(publicDir));

// Last line of defence: any error that escapes a route (a malformed JSON body,
// a thrown middleware) becomes express's HTML error page by default, and the
// client would render that markup — or a stack trace — at the player. Answer
// with the same human-readable JSON shape everything else uses.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err?.status || err?.statusCode || 500;
  console.error(`[server] unhandled error on ${req.method} ${req.path}: ${err?.message || err}`);
  if (res.headersSent) return;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error:
      status === 413
        ? 'That request was too large. Please try again.'
        : 'Something went wrong on the server. Please try again.',
  });
});

// Exported so tests (and any future embedder) can boot the same app on an
// ephemeral port; we only listen when this file is the process entrypoint.
export default app;
export { app };

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  // Bind 0.0.0.0, not localhost: a container's port mapping and every hosting
  // platform's health check reach the process from outside its loopback.
  app.listen(PORT, HOST, () => {
    console.log(`CAKAP LAH! server listening on http://${HOST}:${PORT} (mock=${MOCK})`);
  });
}
