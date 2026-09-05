// server/game/scenarios.js
//
// Loads content/scenarios/*.json once at startup and exposes them to the
// routes. The FULL scenario (with sample_answers / expected_semantics /
// fallback_concepts) stays server-side; publicScenario() below is the only
// shape that may be sent to the browser.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { includedSteps, levelConfig, resolveForward } from './branching.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = path.join(__dirname, '..', '..', 'content', 'scenarios');

/** Fields that are evaluator inputs and must NEVER reach the browser. */
export const ANSWER_KEY_FIELDS = Object.freeze([
  'sample_answers',
  'expected_semantics',
  'fallback_concepts',
]);

function loadAll() {
  const map = new Map();
  let files = [];
  try {
    files = fs.readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json'));
  } catch (err) {
    console.warn(`[scenarios] could not read ${SCENARIO_DIR}: ${err.message}`);
    return map;
  }
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SCENARIO_DIR, file), 'utf8'));
      if (raw && raw.id) map.set(raw.id, raw);
    } catch (err) {
      console.warn(`[scenarios] skipping ${file}: ${err.message}`);
    }
  }
  return map;
}

const SCENARIOS = loadAll();

/** @returns {object|null} the full server-side scenario */
export function getScenario(id) {
  return SCENARIOS.get(id) || null;
}

export function listScenarios() {
  return [...SCENARIOS.values()]
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((s) => ({
      id: s.id,
      title: s.title,
      order: s.order,
      badge: s.badge,
      context: s.context,
      scene: s.scene,
      npc_name: s.npc_name,
    }));
}

/**
 * Browser-safe projection of a scenario at one level:
 *  - only the steps included at that level
 *  - the level's speed / hint / allowed_code_switch resolved
 *  - answer-key fields stripped from every step
 */
export function publicScenario(scenario, level) {
  const cfg = levelConfig(scenario, level);
  const steps = includedSteps(scenario, level).map((step) => {
    const out = {};
    for (const [k, v] of Object.entries(step)) {
      if (ANSWER_KEY_FIELDS.includes(k)) continue;
      out[k] = v;
    }
    // Per-step NPC overrides resolved against the scenario defaults.
    out.npc_name = step.npc_name || scenario.npc_name;
    out.voice_id = step.voice_id || scenario.voice_id;
    out.portrait = step.portrait || scenario.portrait;
    // Branch targets are resolved FORWARD for this level, so the client can
    // never route to a step that does not exist at the chosen level. The
    // authoritative next step still comes from /api/evaluate.next_step_id.
    out.branches = Object.fromEntries(
      Object.entries(step.branches || {}).map(([result, target]) => [
        result,
        resolveForward(scenario, target, level),
      ]),
    );
    return out;
  });

  return {
    id: scenario.id,
    title: scenario.title,
    order: scenario.order,
    badge: scenario.badge,
    context: scenario.context,
    npc_name: scenario.npc_name,
    voice_id: scenario.voice_id,
    scene: scenario.scene,
    portrait: scenario.portrait,
    intro: scenario.intro,
    complete: scenario.complete,
    level: cfg.level,
    speed: cfg.speed,
    hint: cfg.hint,
    allowed_code_switch: cfg.allowed_code_switch,
    first_step_id: steps.length ? steps[0].id : '__complete__',
    steps,
  };
}
