// Background remover for flat-colour cartoon art.
//
// Global colour-keying fails on this art: the figures' skin tones sit close to
// the background yellow, so a global key punches holes through faces. This
// flood-fills inward from the border instead, so only background CONNECTED to
// the edge is removed and interior pixels of the same colour survive.
//
// Works on raw RGBA (ffmpeg decodes/encodes either side) so it needs no image
// library.
//
// usage: node cut.mjs <raw-in> <raw-out> <w> <h> <tol> <hex...>

import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath, wArg, hArg, tolArg, ...hexes] = process.argv;
const W = +wArg;
const H = +hArg;
const TOL = +tolArg;

const targets = hexes.map((h) => {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
});

const buf = readFileSync(inPath);
const idx = (x, y) => (y * W + x) * 4;

/** Squared distance to the nearest background colour. */
function bgDist(p) {
  let best = Infinity;
  for (const [r, g, b] of targets) {
    const d = (buf[p] - r) ** 2 + (buf[p + 1] - g) ** 2 + (buf[p + 2] - b) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// ---- pass 1: flood fill from every border pixel -----------------------------
const seen = new Uint8Array(W * H);
const stack = [];
for (let x = 0; x < W; x++) {
  stack.push([x, 0], [x, H - 1]);
}
for (let y = 0; y < H; y++) {
  stack.push([0, y], [W - 1, y]);
}

while (stack.length) {
  const [x, y] = stack.pop();
  if (x < 0 || y < 0 || x >= W || y >= H) continue;
  const c = y * W + x;
  if (seen[c]) continue;
  const p = c * 4;
  if (bgDist(p) > TOL) continue;
  seen[c] = 1;
  buf[p + 3] = 0;
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}

// ---- pass 1b: enclosed background pockets -----------------------------------
// Background sealed off by the artwork (e.g. the gap between a raised arm, the
// poured stream and the head) is never reached from the border. Clear it with a
// GLOBAL match, but at a tighter tolerance: the loose border tolerance reaches
// skin tones, while a real pocket sits within a few units of the background.
const GLOBAL_TOL = +(process.env.GLOBAL_TOL || 0);
if (GLOBAL_TOL > 0) {
  for (let c = 0; c < W * H; c++) {
    const p = c * 4;
    if (buf[p + 3] !== 0 && bgDist(p) <= GLOBAL_TOL) buf[p + 3] = 0;
  }
}

// ---- pass 2: shave the JPEG halo -------------------------------------------
// Compression leaves a fringe of near-background pixels hugging every edge.
// Anything still opaque, touching a cleared pixel, and within a looser
// tolerance of the background is fringe, not art. Two passes: the fringe is
// ~2px wide at this scale.
const HALO_TOL = TOL * 1.9;
for (let pass = 0; pass < 2; pass++) {
  const kill = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      const p = c * 4;
      if (buf[p + 3] === 0) continue;
      const touchesCleared =
        (x > 0 && buf[(c - 1) * 4 + 3] === 0) ||
        (x < W - 1 && buf[(c + 1) * 4 + 3] === 0) ||
        (y > 0 && buf[(c - W) * 4 + 3] === 0) ||
        (y < H - 1 && buf[(c + W) * 4 + 3] === 0);
      if (touchesCleared && bgDist(p) <= HALO_TOL) kill.push(p);
    }
  }
  if (!kill.length) break;
  for (const p of kill) buf[p + 3] = 0;
}

writeFileSync(outPath, buf);

let opaque = 0;
for (let c = 0; c < W * H; c++) if (buf[c * 4 + 3] !== 0) opaque++;
console.log(`kept ${((opaque / (W * H)) * 100).toFixed(1)}% opaque`);
