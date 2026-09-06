// server/routes/summarise.js — POST /api/summarise
//
// A second, whole-conversation LLM call. NOT an average of turn scores: it sees
// recovery, register and real-life viability. Never crashes the end screen —
// any failure degrades to the deterministic summary fallback.

import { Router } from 'express';

import { getEvaluator, evaluatorFailureFlags, isMockRequest } from '../adapters/index.js';
import { noteEvaluatorFallback } from '../adapters/evaluator.js';
import { getScenario } from '../game/scenarios.js';
import { registerSpoken } from '../game/spoken-text.js';
import { sessionKey } from '../middleware/rate-limit.js';
import { levelConfig } from '../game/branching.js';
import {
  summaryBandFor,
  SUMMARY_BAND_LABELS,
  SUMMARY_VERDICTS,
  fallbackSummarise,
} from '../game/scoring.js';

const router = Router();

router.post('/api/summarise', async (req, res) => {
  const body = req.body || {};
  const scenarioId = body.scenario_id;
  const level = Number(body.level);

  if (typeof scenarioId !== 'string' || !scenarioId) {
    return res.status(400).json({ error: 'Field "scenario_id" is required.' });
  }
  if (!Number.isInteger(level) || level < 1 || level > 3) {
    return res.status(400).json({ error: 'Field "level" must be 1, 2 or 3.' });
  }
  const conversation = Array.isArray(body.conversation) ? body.conversation : null;
  if (!conversation) {
    return res.status(400).json({ error: 'Field "conversation" is required and must be an array.' });
  }
  const turnScores = Array.isArray(body.turn_scores) ? body.turn_scores : [];

  const scenario = getScenario(scenarioId);
  if (!scenario) return res.status(404).json({ error: `Unknown scenario "${scenarioId}".` });

  const cfg = levelConfig(scenario, level);
  const adapter = getEvaluator(req);
  const flags = evaluatorFailureFlags(req);

  let raw;
  try {
    raw = await adapter.summarise({
      scenario,
      level,
      levelConfig: cfg,
      conversation,
      turnScores,
      ...flags,
    });
  } catch (err) {
    // Never crash the end screen.
    console.warn(`[summarise] adapter threw, using fallback: ${err.message}`);
    if (!isMockRequest(req)) noteEvaluatorFallback('upstream_error');
    raw = fallbackSummarise({ turnScores, level, reason: 'upstream_error' });
  }

  const overall = Math.min(100, Math.max(0, Math.round(Number(raw.overall_score) || 0)));
  const band = summaryBandFor(overall);
  const verdict = raw.verdict || SUMMARY_VERDICTS[band];
  const summary = raw.summary || '';

  // The end screen's speak button reads the verdict on its own AND, from the
  // "dengar" control, `verdict + ' ' + summary` joined. The client does the
  // joining, so the server registers the joined form too or that button plays
  // silence.
  registerSpoken(sessionKey(req), verdict, summary, `${verdict} ${summary}`.trim());

  res.json({
    scenario_id: scenario.id,
    level,
    badge: scenario.badge,
    overall_score: overall,
    band,
    band_label: SUMMARY_BAND_LABELS[band],
    verdict,
    summary,
    strengths: Array.isArray(raw.strengths) ? raw.strengths : [],
    improvements: Array.isArray(raw.improvements) ? raw.improvements : [],
    bm_upgrades: Array.isArray(raw.bm_upgrades) ? raw.bm_upgrades : [],
    source: raw.source || 'llm',
    fallback: Boolean(raw.fallback),
  });
});

export default router;
