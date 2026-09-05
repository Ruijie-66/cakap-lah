# Art cutout tools

Used to turn the sourced character art into the transparent 512×512 PNGs in
`public/assets/npc/`. Kept so the assets can be re-cut if the art changes.

This machine has no ImageMagick, PIL or sharp — only ffmpeg. So ffmpeg decodes
to raw RGBA, a Node script edits the alpha, and ffmpeg encodes back.

**Why a flood fill and not a colour key.** Global colour-keying destroyed the
mamak: his skin tone sits ~60 RGB units from the background yellow, so keying
punched holes through his face. `cut.mjs` floods inward from the border, so only
background *connected to the edge* is cleared and interior pixels of the same
colour survive. Two extra passes handle background sealed off by the artwork
(the gap between his raised arm, the poured stream and his head) and shave the
JPEG fringe that otherwise leaves a white halo.

```bash
# 1. decode (crop here if the source is a sprite sheet)
ffmpeg -i src.jpg -vf "crop=223:159:0:11" -pix_fmt rgba -f rawvideo m.raw
# 2. clear the background: <in> <out> <w> <h> <tolerance> <bg hex...>
GLOBAL_TOL=20 node cut.mjs m.raw m.cut.raw 223 159 60 "#FFF685"
# 3. optional: square crop framed on the head+torso (full-body sources only)
node frame.mjs m.cut.raw 223 159 0.52     # -> ffmpeg crop rect
# 4. encode to 512×512 with transparent padding
ffmpeg -f rawvideo -pix_fmt rgba -s 223x159 -i m.cut.raw \
  -vf "scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,\
pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" out.png
```

`bbox.mjs` reports the opaque bounding box and a centred square crop — useful
when a figure should be framed whole rather than head-and-torso.

Check every result composited over a dark background before shipping it; the
halo and pocket problems are invisible against white.
