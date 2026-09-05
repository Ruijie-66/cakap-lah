// public/js/game/scoring.js — score bands, labels and the count-up animation.
//
// The server is the authority on scores and bands (it recomputes the weighted
// overall and returns `band` / `band_label`). These helpers exist so the UI can
// (a) colour a score when the server only gave us a number, and (b) animate it.
//
// Bands (from the brief, must match the server):
//   90–100 Power!   ·  75–89 Passed  ·  55–74 Almost  ·  <55 Retry
//   no transcript → no score shown at all.

/** @typedef {'power'|'passed'|'almost'|'retry'} Band */

export const BANDS = [
  { band: 'power', label: 'Power!', min: 90 },
  { band: 'passed', label: 'Passed', min: 75 },
  { band: 'almost', label: 'Almost', min: 55 },
  { band: 'retry', label: 'Retry', min: -Infinity },
];

/**
 * Map a numeric score to its band. Returns null for a missing score so the
 * caller can show nothing at all (the "no transcript" case).
 * @param {number|null|undefined} score
 * @returns {{band: Band, label: string}|null}
 */
export function bandFor(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const n = Number(score);
  return BANDS.find((b) => n >= b.min) ?? BANDS[BANDS.length - 1];
}

/**
 * Band for a turn, preferring whatever the server already decided.
 * @param {{overall_score?: number|null, band?: string|null, band_label?: string|null}} evaluation
 */
export function bandForTurn(evaluation = {}) {
  if (evaluation.band && evaluation.band_label) {
    return { band: evaluation.band, label: evaluation.band_label };
  }
  return bandFor(evaluation.overall_score);
}

/** Encouraging one-liners keyed by band. Roast the situation, never the learner. */
const BAND_FLAVOUR = {
  power: 'Power! Macam orang local dah.',
  passed: 'Boleh! Mesej sampai.',
  almost: 'Hampir — sikit lagi.',
  retry: 'Bahasa Melayu belum give up on you. Cuba lagi.',
};

/** @param {string|null} band */
export function bandFlavour(band) {
  return BAND_FLAVOUR[band] || '';
}

/**
 * Animate a number from 0 to `target` inside an element.
 * Respects prefers-reduced-motion by jumping straight to the value.
 * @param {HTMLElement} el
 * @param {number} target
 * @param {{durationMs?: number, onDone?: () => void}} [options]
 * @returns {() => void} cancel function
 */
export function countUp(el, target, options = {}) {
  const { durationMs = 900, onDone } = options;
  const to = Math.max(0, Math.round(Number(target) || 0));

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced || durationMs <= 0) {
    el.textContent = String(to);
    onDone?.();
    return () => {};
  }

  let raf = 0;
  // Safety net: requestAnimationFrame is throttled to a standstill in a
  // background tab, which would leave the score frozen at 0. Land the final
  // value on a timer no matter what.
  const settle = setTimeout(() => {
    cancelAnimationFrame(raf);
    if (el.textContent !== String(to)) {
      el.textContent = String(to);
      onDone?.();
    }
  }, durationMs + 400);
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / durationMs);
    // easeOutCubic — fast then settles, reads as a "score landing".
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(to * eased));
    if (t < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      clearTimeout(settle);
      el.textContent = String(to);
      onDone?.();
    }
  };
  raf = requestAnimationFrame(tick);
  return () => {
    clearTimeout(settle);
    cancelAnimationFrame(raf);
  };
}
