// server/game/scenarios.js
//
// Loads content/scenarios/*.json once at startup and exposes them to the
// routes. The FULL scenario (with sample_answers / expected_semantics /
// fallback_concepts) stays server-side; publicScenario() below is the only
// shape that may be sent to the browser.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { includedSteps, isStepIncluded, levelConfig, resolveForward, COMPLETE } from './branching.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = path.join(__dirname, '..', '..', 'content', 'scenarios');

/**
 * Fields that are evaluator inputs and must NEVER reach the browser.
 *
 * `npc_persona` is not an answer key, but it is model guidance in the same
 * class: character notes written for the LLM, never for a player to read.
 * Shipping it would put the NPC's stage directions on the wire next to the
 * lines they are meant to produce. `npc_reprompt` is the server-side safety
 * net used when a generated line has to be discarded, and is likewise never
 * something the client chooses to say.
 *
 * `world_facts` is the same class again: the concrete truths of the scene
 * (the floor, the time, whose report it is), written so the improvised
 * `npc_reply` cannot contradict the scripted line that follows it. It is
 * authored at scenario level — where the browser-safe projection below is an
 * explicit allowlist and so never copies it — but it is listed here too, so
 * that a per-step override, the day someone writes one, is stripped as well.
 * Half of it is the answer key restated as fact ("tingkat empat"), so it must
 * never reach a player who is about to be asked to say exactly that.
 */
export const ANSWER_KEY_FIELDS = Object.freeze([
  'sample_answers',
  'expected_semantics',
  'fallback_concepts',
  'key_concepts',
  'npc_persona',
  'npc_reprompt',
  'world_facts',
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
 * Resolve the closing line for one level.
 *
 * `complete` is normally a single object. When the last step differs by level
 * — mall_01 hands the conversation to a second character only at level 3 — it
 * may instead be an ARRAY of variants, each gated by `levels` exactly like a
 * step. Without this the level-3 line ("Terima kasih ya dik!", Makcik) played
 * at level 1 in Abang Guard's voice, thanking the player for something they
 * never did. The first variant matching the level wins; an unmatched level
 * falls back to the last variant rather than ending the mission in silence.
 *
 * @param {object} scenario
 * @param {number} level
 * @returns {object|undefined} the single closing block for this level
 */
export function completeFor(scenario, level) {
  const complete = scenario?.complete;
  if (!Array.isArray(complete)) return complete;
  return complete.find((v) => isStepIncluded(v, level)) || complete[complete.length - 1];
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
    complete: completeFor(scenario, cfg.level),
    level: cfg.level,
    speed: cfg.speed,
    hint: cfg.hint,
    allowed_code_switch: cfg.allowed_code_switch,
    first_step_id: steps.length ? steps[0].id : COMPLETE,
    steps,
  };
}
