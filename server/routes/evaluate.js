// server/routes/evaluate.js — POST /api/evaluate
//
// The client sends only what it knows; the server loads the scenario/step and
// assembles the evaluator input itself, so answer keys never leave the server.
// All of overall_score / result / branch / next_step_id are derived HERE — the
// model's own arithmetic and branch choice are never trusted.

import { Router } from 'express';

import { getEvaluator, evaluatorFailureFlags, isMockRequest } from '../adapters/index.js';
import { noteEvaluatorFallback } from '../adapters/evaluator.js';
import { getScenario } from '../game/scenarios.js';
import {
  levelConfig,
  findStep,
  resolveBranch,
  isStepIncluded,
  COMPLETE,
} from '../game/branching.js';
import {
  computeOverall,
  bandFor,
  bandLabel,
  applyRetryCap,
  isEmptyTranscript,
  fallbackEvaluate,
} from '../game/scoring.js';

const router = Router();

function badRequest(res, message) {
  res.status(400).json({ error: message });
}

router.post('/api/evaluate', async (req, res) => {
  const body = req.body || {};
  const {
    scenario_id: scenarioId,
    step_id: stepId,
    level: rawLevel,
    stt_transcript: transcript,
    stt_confidence: sttConfidence,
    conversation_history: history,
    retry_count: rawRetryCount,
  } = body;

  if (typeof scenarioId !== 'string' || !scenarioId) return badRequest(res, 'Field "scenario_id" is required.');
  if (typeof stepId !== 'string' || !stepId) return badRequest(res, 'Field "step_id" is required.');

  const level = Number(rawLevel);
  if (!Number.isInteger(level) || level < 1 || level > 3) {
    return badRequest(res, 'Field "level" must be 1, 2 or 3.');
  }
  if (typeof transcript !== 'string') {
    return badRequest(res, 'Field "stt_transcript" is required and must be a string.');
  }
  // Required: a short answer only parses if the evaluator knows what was asked.
  // An empty array is fine on turn 1.
  if (!Array.isArray(history)) {
    return badRequest(res, 'Field "conversation_history" is required and must be an array (use [] on turn 1).');
  }

  const scenario = getScenario(scenarioId);
  if (!scenario) return res.status(404).json({ error: `Unknown scenario "${scenarioId}".` });
  const step = findStep(scenario, stepId);
  if (!step) return res.status(404).json({ error: `Unknown step "${stepId}" in scenario "${scenarioId}".` });
  // The step exists, but is it part of THIS level's route? Scoring a step that
  // is gated out silently routes the player to an early end screen, so a client
  // bug must surface as a 400 rather than as a mysteriously short run.
  if (!isStepIncluded(step, level)) {
    return badRequest(
      res,
      `Step "${stepId}" is not part of scenario "${scenarioId}" at level ${level}.`,
    );
  }

  const cfg = levelConfig(scenario, level);
  const retryCount = Number.isFinite(Number(rawRetryCount)) ? Math.max(0, Number(rawRetryCount)) : 0;

  // ---- Empty transcript: short-circuit before any LLM call, no penalty. ----
  if (isEmptyTranscript(transcript)) {
    return res.json({
      result: 'no_input',
      scored: false,
      band: null,
      band_label: null,
      intent_pass: null,
      intent_score: null,
      semantic_score: null,
      comprehensibility_score: null,
      naturalness_score: null,
      overall_score: null,
      what_worked: null,
      improvement: step.retry_hint || 'Cuba sebut sekali lagi — saya tak dengar apa-apa.',
      npc_reply: 'Hah? Saya tak dengar apa-apa. Cuba cakap sekali lagi.',
      branch: 'no_input',
      next_step_id: step.id,
      npc_state: (step.npc_states && step.npc_states.retry) || 'idle',
      complete: false,
      free_retry: true,
      retry_count: retryCount,
      retry_capped: false,
      source: 'short_circuit',
      fallback: false,
    });
  }

  const adapter = getEvaluator(req);
  const flags = evaluatorFailureFlags(req);

  let raw;
  try {
    raw = await adapter.evaluate({
      scenario,
      step,
      level,
      levelConfig: cfg,
      transcript,
      sttConfidence: sttConfidence ?? null,
      conversationHistory: history,
      ...flags,
    });
  } catch (err) {
    // The demo must never dead-end and a system failure must never cost the
    // learner points: degrade to the deterministic fallback, exactly as
    // /api/summarise does. (?fail=eval therefore exercises THIS path.)
    console.warn(`[evaluate] adapter threw, using fallback: ${err.message}`);
    if (!isMockRequest(req)) noteEvaluatorFallback('upstream_error');
    raw = fallbackEvaluate({ step, transcript, reason: 'upstream_error' });
  }

  // ---- Server-side derivation ------------------------------------------------
  // Single source of truth for the cap lives in game/scoring.js so the unit
  // test and this route can never disagree.
  const { result, overall, retry_capped: retryCapped } = applyRetryCap(
    computeOverall(raw),
    raw.intent_pass === true,
    retryCount,
  );

  const band = bandFor(overall);
  const branchInfo = resolveBranch(scenario, step.id, level, result);

  res.json({
    result,
    scored: true,
    band,
    band_label: bandLabel(band),
    intent_pass: raw.intent_pass === true,
    intent_score: raw.intent_score,
    semantic_score: raw.semantic_score,
    comprehensibility_score: raw.comprehensibility_score,
    naturalness_score: raw.naturalness_score,
    overall_score: overall,
    what_worked: raw.what_worked,
    improvement: raw.improvement,
    npc_reply: raw.npc_reply,
    branch: branchInfo.branch,
    next_step_id: branchInfo.next_step_id,
    npc_state: (step.npc_states && step.npc_states[result]) || 'idle',
    complete: branchInfo.next_step_id === COMPLETE,
    free_retry: false,
    retry_count: retryCount,
    retry_capped: retryCapped,
    source: raw.source || 'llm',
    fallback: Boolean(raw.fallback),
  });
});

export default router;
