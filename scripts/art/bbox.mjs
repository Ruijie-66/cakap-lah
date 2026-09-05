// Report the opaque bounding box of a raw RGBA buffer, plus a square crop
// centred on it (clamped to the canvas) so the figure sits centred in the
// game's circular portrait slot.
// usage: node bbox.mjs <raw> <w> <h> [padFrac]

import { readFileSync } from 'node:fs';

const [, , p, wArg, hArg, padArg] = process.argv;
const W = +wArg;
const H = +hArg;
const PAD = padArg ? +padArg : 0.06;
const buf = readFileSync(p);

let x0 = W;
let y0 = H;
let x1 = -1;
let y1 = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (buf[(y * W + x) * 4 + 3] !== 0) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
}

const bw = x1 - x0 + 1;
const bh = y1 - y0 + 1;
const pad = Math.round(Math.max(bw, bh) * PAD);
let side = Math.max(bw, bh) + pad * 2;
const cx = x0 + bw / 2;
const cy = y0 + bh / 2;
side = Math.min(side, Math.min(W, H));
let sx = Math.round(cx - side / 2);
let sy = Math.round(cy - side / 2);
sx = Math.max(0, Math.min(sx, W - side));
sy = Math.max(0, Math.min(sy, H - side));

console.log(JSON.stringify({ bbox: [x0, y0, bw, bh], square: [side, side, sx, sy] }));
