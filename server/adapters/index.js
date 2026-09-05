// server/adapters/index.js
//
// Picks the mock or live Revolab adapter for a given request, honouring
// both the server-wide MOCK=1 env var and a per-request override from the
// browser (query ?mock=1 or header x-mock: 1). This is the single seam
// routes should go through instead of importing revolab.js/mock.js directly.

import { MOCK } from '../config.js';
import * as revolab from './revolab.js';
import * as mock from './mock.js';
import * as evaluator from './evaluator.js';

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isMockRequest(req) {
  if (MOCK) return true;
  if (req.query && req.query.mock === '1') return true;
  if (req.get && req.get('x-mock') === '1') return true;
  return false;
}

/**
 * @param {import('express').Request} req
 * @param {'stt'|'tts'|'eval'|'json'} route
 * @returns {boolean} whether this request should take the forced-error path
 */
export function isForcedFailure(req, route) {
  return Boolean(req.query && req.query.fail === route);
}

/**
 * @param {import('express').Request} req
 * @returns {{transcribe: Function, synthesize: Function}}
 */
export function getAdapter(req) {
  return isMockRequest(req) ? mock : revolab;
}

/**
 * Same seam as getAdapter(), for the LLM evaluator/summariser.
 * @param {import('express').Request} req
 * @returns {{evaluate: Function, summarise: Function}}
 */
export function getEvaluator(req) {
  return isMockRequest(req) ? mock : evaluator;
}

/**
 * Forced-failure flags the evaluator routes pass straight into the adapter:
 *   ?fail=eval -> upstream error   ?fail=json -> malformed model output
 * @param {import('express').Request} req
 */
export function evaluatorFailureFlags(req) {
  return {
    forceUpstreamError: isForcedFailure(req, 'eval'),
    forceMalformed: isForcedFailure(req, 'json'),
  };
}
