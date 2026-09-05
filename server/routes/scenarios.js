// server/routes/scenarios.js — GET /api/scenarios, GET /api/scenarios/:id?level=N

import { Router } from 'express';
import { getScenario, listScenarios, publicScenario } from '../game/scenarios.js';

const router = Router();

function parseLevel(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 3) return null;
  return n;
}

router.get('/api/scenarios', (req, res) => {
  res.json({ scenarios: listScenarios() });
});

router.get('/api/scenarios/:id', (req, res) => {
  const scenario = getScenario(req.params.id);
  if (!scenario) {
    res.status(404).json({ error: `Unknown scenario "${req.params.id}".` });
    return;
  }

  const level = req.query.level === undefined ? 1 : parseLevel(req.query.level);
  if (level === null) {
    res.status(400).json({ error: 'Query param "level" must be 1, 2 or 3.' });
    return;
  }

  // publicScenario strips sample_answers / expected_semantics / fallback_concepts.
  res.json(publicScenario(scenario, level));
});

export default router;
