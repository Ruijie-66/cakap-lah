// public/js/audio/visualiser.js — canvas waveform + level meter.
//
// This is the "the app is listening" signal. It is driven by the live
// AnalyserNode from recorder.js (same single getUserMedia stream — we never
// open a second one) and must visibly react to the voice.
//
// devicePixelRatio is handled so the line is crisp on retina displays.

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   color?: string,
 *   idleColor?: string,
 *   glow?: string,
 *   lineWidth?: number,
 *   background?: string,
 * }} [options]
 * @returns {{
 *   start: (analyser: AnalyserNode) => void,
 *   stop: () => void,
 *   clear: () => void,
 *   isRunning: () => boolean,
 *   getLevel: () => number,
 *   destroy: () => void,
 * }}
 */
export function createVisualiser(canvas, options = {}) {
  const color = options.color || '#3ddc97';
  const idleColor = options.idleColor || 'rgba(255,255,255,0.18)';
  const glow = options.glow || 'rgba(61,220,151,0.45)';
  const lineWidth = options.lineWidth ?? 2.5;
  const background = options.background || 'transparent';

  const ctx = canvas.getContext('2d');
  /** @type {AnalyserNode|null} */
  let analyser = null;
  /** @type {Uint8Array|null} */
  let timeData = null;
  let rafId = 0;
  let running = false;
  let level = 0; // smoothed 0..1 RMS
  let cssW = 0;
  let cssH = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width || canvas.clientWidth || 300));
    cssH = Math.max(1, Math.round(rect.height || canvas.clientHeight || 96));
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  }

  const onResize = () => { resize(); if (!running) drawIdle(); };
  window.addEventListener('resize', onResize);

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(onResize);
    ro.observe(canvas);
  }

  function paintBackground() {
    ctx.clearRect(0, 0, cssW, cssH);
    if (background !== 'transparent') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, cssW, cssH);
    }
  }

  /** Flat centre line for the not-recording state. */
  function drawIdle() {
    resize();
    paintBackground();
    ctx.save();
    ctx.strokeStyle = idleColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(0, cssH / 2);
    ctx.lineTo(cssW, cssH / 2);
    ctx.stroke();
    ctx.restore();
  }

  function frame() {
    if (!running || !analyser) return;
    rafId = requestAnimationFrame(frame);

    analyser.getByteTimeDomainData(timeData);

    // RMS -> level, smoothed so the meter breathes rather than flickers.
    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = (timeData[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / timeData.length);
    level = level * 0.7 + Math.min(1, rms * 3.2) * 0.3;

    paintBackground();

    const mid = cssH / 2;
    // Amplify the waveform so a normal speaking voice fills the box.
    const gain = (cssH / 2) * 0.92 * 2.2;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = glow;
    ctx.shadowBlur = 8 + level * 18;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();

    const n = timeData.length;
    const step = Math.max(1, Math.floor(n / Math.max(1, cssW)));
    let x = 0;
    const dx = cssW / Math.ceil(n / step);
    for (let i = 0; i < n; i += step) {
      const v = (timeData[i] - 128) / 128;
      const y = Math.max(1, Math.min(cssH - 1, mid + v * gain));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += dx;
    }
    ctx.stroke();
    ctx.restore();

    // Level bar along the bottom edge.
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, cssH - 3, cssW * level, 3);
    ctx.restore();
  }

  return {
    /** @param {AnalyserNode} node */
    start(node) {
      if (!node) return;
      analyser = node;
      timeData = new Uint8Array(analyser.fftSize);
      level = 0;
      resize();
      if (!running) {
        running = true;
        rafId = requestAnimationFrame(frame);
      }
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      analyser = null;
      timeData = null;
      level = 0;
      drawIdle();
    },
    clear() {
      resize();
      paintBackground();
    },
    isRunning: () => running,
    getLevel: () => level,
    destroy() {
      this.stop();
      window.removeEventListener('resize', onResize);
      if (ro) { try { ro.disconnect(); } catch { /* noop */ } ro = null; }
    },
  };
}
