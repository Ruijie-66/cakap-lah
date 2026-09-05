import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPLETE,
  includedSteps,
  isStepIncluded,
  firstStepId,
  resolveForward,
  resolveBranch,
  levelConfig,
} from '../server/game/branching.js';
import { getScenario, listScenarios } from '../server/game/scenarios.js';

const IDS = ['mamak_01', 'mall_01', 'office_01'];
const LEVELS = [1, 2, 3];

test('all three scenarios load', () => {
  assert.equal(listScenarios().length, 3);
  for (const id of IDS) assert.ok(getScenario(id), `${id} should load`);
});

test('level gating: L1/L2 exclude the L3-only third step, L3 includes it', () => {
  for (const id of IDS) {
    const s = getScenario(id);
    assert.equal(includedSteps(s, 1).length, 2, `${id} L1`);
    assert.equal(includedSteps(s, 2).length, 2, `${id} L2`);
    assert.equal(includedSteps(s, 3).length, 3, `${id} L3`);
    assert.equal(isStepIncluded(s.steps[2], 1), false);
    assert.equal(isStepIncluded(s.steps[2], 3), true);
  }
});

test('firstStepId is the first included step at each level', () => {
  for (const id of IDS) {
    const s = getScenario(id);
    for (const level of LEVELS) assert.equal(firstStepId(s, level), s.steps[0].id);
  }
});

test('resolve forward: mamak_01 wrong_order.success -> upsell (L3-only) becomes __complete__ at L1/L2', () => {
  const s = getScenario('mamak_01');
  assert.equal(s.steps[1].branches.success, 'upsell', 'fixture precondition');
  assert.equal(resolveBranch(s, 'wrong_order', 1, 'success').next_step_id, COMPLETE);
  assert.equal(resolveBranch(s, 'wrong_order', 2, 'partial').next_step_id, COMPLETE);
  assert.equal(resolveBranch(s, 'wrong_order', 3, 'success').next_step_id, 'upsell');
});

test('every branch of every step at every level resolves to an included step or __complete__', () => {
  for (const id of IDS) {
    const s = getScenario(id);
    for (const level of LEVELS) {
      const includedIds = new Set(includedSteps(s, level).map((x) => x.id));
      for (const step of s.steps) {
        for (const result of ['success', 'partial', 'retry']) {
          const { next_step_id: next } = resolveBranch(s, step.id, level, result);
          assert.ok(
            next === COMPLETE || includedIds.has(next),
            `${id} L${level} ${step.id}.${result} resolved to "${next}" which is not included`,
          );
        }
      }
    }
  }
});

test('retry branches point back at the same step when that step is included', () => {
  for (const id of IDS) {
    const s = getScenario(id);
    for (const level of LEVELS) {
      for (const step of includedSteps(s, level)) {
        assert.equal(resolveBranch(s, step.id, level, 'retry').next_step_id, step.id);
      }
    }
  }
});

test('missing / sentinel branch targets return __complete__', () => {
  const s = getScenario('mamak_01');
  assert.equal(resolveForward(s, 'no_such_step', 3), COMPLETE);
  assert.equal(resolveForward(s, COMPLETE, 3), COMPLETE);
  assert.equal(resolveForward(s, undefined, 3), COMPLETE);
  assert.equal(resolveBranch(s, 'no_such_step', 3, 'success').next_step_id, COMPLETE);
});

test('resolve forward skips a gated step and lands on the next included one', () => {
  // Synthetic scenario: a -> b (L3 only) -> c (all levels).
  const s = {
    steps: [
      { id: 'a', levels: [1, 2, 3], branches: { success: 'b' } },
      { id: 'b', levels: [3], branches: { success: 'c' } },
      { id: 'c', levels: [1, 2, 3], branches: { success: COMPLETE } },
    ],
  };
  assert.equal(resolveBranch(s, 'a', 1, 'success').next_step_id, 'c');
  assert.equal(resolveBranch(s, 'a', 3, 'success').next_step_id, 'b');
});

test('levelConfig resolves speed / hint / allowed_code_switch', () => {
  const s = getScenario('mamak_01');
  assert.deepEqual(levelConfig(s, 1), {
    level: 1,
    speed: 0.85,
    hint: 'en',
    allowed_code_switch: 'beginner',
  });
  assert.equal(levelConfig(s, 2).allowed_code_switch, 'intermediate');
  assert.equal(levelConfig(s, 3).hint, 'none');
  // Unknown level falls back to safe defaults rather than throwing.
  assert.equal(levelConfig(s, 9).allowed_code_switch, 'intermediate');
});
