// Given a cut raw RGBA, print an ffmpeg crop rect for a square framed on the
// TOP portion of the figure (head + torso), so a full-body source still reads
// as a portrait in the game's circular slot.
import { readFileSync } from 'node:fs';
const [,,p,wArg,hArg,fracArg]=process.argv;
const W=+wArg,H=+hArg,FRAC=+(fracArg||0.55);
const b=readFileSync(p);
let x0=W,y0=H,x1=-1,y1=-1;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(b[(y*W+x)*4+3]!==0){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}}
const bh=y1-y0+1;
const keep=Math.round(bh*FRAC);           // vertical slice of the figure to keep
// horizontal extent of just that slice, so we centre on the head/torso not the legs
let sx0=W,sx1=-1;
for(let y=y0;y<y0+keep;y++)for(let x=0;x<W;x++){if(b[(y*W+x)*4+3]!==0){if(x<sx0)sx0=x;if(x>sx1)sx1=x;}}
const sw=sx1-sx0+1;
const pad=Math.round(Math.max(sw,keep)*0.08);
let side=Math.min(Math.max(sw,keep)+pad*2, Math.min(W,H));
const cx=sx0+sw/2, cy=y0+keep/2;
let cropX=Math.max(0,Math.min(Math.round(cx-side/2), W-side));
let cropY=Math.max(0,Math.min(Math.round(cy-side/2), H-side));
console.log(`${side}:${side}:${cropX}:${cropY}`);
