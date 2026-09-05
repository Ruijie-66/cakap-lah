// server/game/branching.js
//
// Pure, side-effect-free level gating + branch resolution for CAKAP LAH!.
// No express, no I/O — unit-testable on its own (see test/branching.test.js).
//
// ENGINE RULE (the confusing one):
//   steps[].levels gates which steps exist at the chosen level. A branch may
//   point at a step that is EXCLUDED at the current level (e.g. in mamak_01
//   `wrong_order.success -> upsell`, and `upsell` is L3-only). In that case we
//   RESOLVE FORWARD: advance to the next INCLUDED step in array order after the
//   target's position. If there is none — or the target does not exist at all —
//   return the sentinel `__complete__`.

export const COMPLETE = '__complete__';

/**
 * @param {object} step
 * @param {number} level
 * @returns {boolean}
 */
export function isStepIncluded(step, level) {
  if (!step) return false;
  if (!Array.isArray(step.levels)) return true; // no gate == always included
  return step.levels.includes(Number(level));
}

/**
 * Steps of a scenario that exist at the given level, in array order.
 * @param {object} scenario
 * @param {number} level
 * @returns {object[]}
 */
export function includedSteps(scenario, level) {
  const steps = (scenario && scenario.steps) || [];
  return steps.filter((s) => isStepIncluded(s, level));
}

/**
 * The first step the player should see at this level.
 * @returns {string} step id, or COMPLETE if the level has no steps at all
 */
export function firstStepId(scenario, level) {
  const included = includedSteps(scenario, level);
  return included.length ? included[0].id : COMPLETE;
}

/**
 * Find a step by id regardless of level gating (the server always holds the
 * full scenario; gating only affects what the player is routed through).
 */
export function findStep(scenario, stepId) {
  const steps = (scenario && scenario.steps) || [];
  return steps.find((s) => s.id === stepId) || null;
}

/**
 * Resolve a raw branch target to a step that actually exists at this level.
 *
 * @param {object} scenario
 * @param {string|null|undefined} targetId raw value from step.branches[result]
 * @param {number} level
 * @returns {string} an included step id, or COMPLETE
 */
export function resolveForward(scenario, targetId, level) {
  if (!targetId || targetId === COMPLETE) return COMPLETE;

  const steps = (scenario && scenario.steps) || [];
  const idx = steps.findIndex((s) => s.id === targetId);

  // Branch target missing entirely -> the scenario is over.
  if (idx === -1) return COMPLETE;

  // Target exists at this level -> use it.
  if (isStepIncluded(steps[idx], level)) return steps[idx].id;

  // Target is gated out -> advance to the next included step in array order.
  for (let i = idx + 1; i < steps.length; i += 1) {
    if (isStepIncluded(steps[i], level)) return steps[i].id;
  }
  return COMPLETE;
}

/**
 * Resolve the next step for a (step, result) pair at a level.
 *
 * @param {object} scenario
 * @param {string} currentStepId
 * @param {number} level
 * @param {'success'|'partial'|'retry'} result
 * @returns {{ branch: string, raw_target: string|null, next_step_id: string,
 *             complete: boolean }}
 *   `branch` is the raw branch key/target semantics the client shows;
 *   `raw_target` is the UNRESOLVED value of `step.branches[result]` (null when
 *     the step declares no branch for this result) — diagnostic only, kept so
 *     level gating is debuggable; never route on it;
 *   `next_step_id` is always safe to route to.
 */
export function resolveBranch(scenario, currentStepId, level, result) {
  const step = findStep(scenario, currentStepId);
  if (!step) {
    return { branch: result, next_step_id: COMPLETE, complete: true };
  }
  const branches = step.branches || {};
  const rawTarget = branches[result];
  const nextStepId = resolveForward(scenario, rawTarget, level);
  return {
    branch: result,
    raw_target: rawTarget === undefined ? null : rawTarget,
    next_step_id: nextStepId,
    complete: nextStepId === COMPLETE,
  };
}

/**
 * Level config (speed / hint / allowed_code_switch) with a safe default.
 */
export function levelConfig(scenario, level) {
  const lv = String(level);
  const cfg = (scenario && scenario.levels && scenario.levels[lv]) || null;
  return {
    level: Number(level),
    speed: cfg && cfg.speed != null ? cfg.speed : 1.0,
    hint: cfg && cfg.hint ? cfg.hint : 'none',
    allowed_code_switch: cfg && cfg.allowed_code_switch ? cfg.allowed_code_switch : 'intermediate',
  };
}
