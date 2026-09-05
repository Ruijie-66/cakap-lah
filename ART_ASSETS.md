# Art Assets — CAKAP LAH!

**7 files. Total budget ~2 MB. Hard deadline: Sunday 14:00.**

Derived from `content/scenarios/*.json` (the `scene` and `portrait` fields), not guessed.

> **These are an upgrade, never a dependency.** The app ships a CSS/SVG fallback and every `<img>`
> falls back on error, so missing art degrades silently. If they are not in by 14:00, we ship the
> fallback and nobody waits. Do not let art block the build.

---

## Why only 7 and not 19

Emotional states (`idle` / `talking` / `pleased` / `annoyed`) are done with **CSS on a single
portrait** — bounce while talking, scale + glow on pleased, shake + warm tint on annoyed.
So each character needs **one** neutral-but-warm image, not four.

Draw each portrait with a **neutral-to-friendly** expression that reads plausibly under all four
states. Avoid a strong smile or a strong frown — a locked-in expression fights the CSS.

---

## Shared art direction (all 7 files)

| Rule | Why |
|---|---|
| **Stylised illustration, not photoreal** | Keeps the game feel; avoids resembling real people |
| **Consistent direction across all 7** | Same line weight, same palette, same rendering style — they appear on screen together |
| **Consistent light direction** | Pick one (e.g. soft key from upper left) and hold it across every asset |
| **Warm and respectful. No caricature.** | Brief §20's rule — humour never targets ethnicity — applies to the art too |
| **Malaysian and specific, not generic-Asian** | These are recognisable Malaysian places and people |
| Warm palette: teh-tarik amber, night-mamak neon, mall cool-white | The game's tone is warm, nocturnal, everyday |

---

## Scenes — 3 files

`public/assets/scenes/` · **1280×720, 16:9, JPG**

**Critical:** UI text and the transcript render on top of these. Keep them
**desaturated or softly blurred**, with no busy detail or high contrast in the centre.
Think *depth-of-field background plate*, not *hero illustration*. If the scene competes with the
text, the screen is unreadable and we fall back to a flat colour anyway.

### 1. `mamak.jpg`
> *It is 10pm. You are at a mamak with friends. You want a teh tarik — but less sweet.*

Night-time Malaysian mamak stall. Roadside, open-air, plastic chairs and steel tables, fluorescent
and neon signage, a teh tarik station with the metal pulling cups, warm amber pools of light
against dark blue night. Cheerful and slightly grubby in the way real mamaks are.

### 2. `mall.jpg`
> *You are in a shopping mall and you cannot find the food court.*

Interior of a Malaysian shopping mall concourse. Polished floor with reflections, glass balustrades
over an atrium, escalators, bright cool-white lighting, distant blurred signage and shopfronts.
Mid-afternoon busy but not crowded. Cooler palette than the other two — the visual contrast between
the three scenes is what sells three distinct missions.

### 3. `office.jpg`
> *Your manager stops by your desk. The report from yesterday is not finished.*

Ordinary Malaysian open-plan office. Desks, monitors, task chairs, a whiteboard, blinds with
afternoon light coming through. Slightly tense, everyday, unglamorous. Not a startup loft, not a
corporate tower — a normal workplace.

---

## Character portraits — 4 files

`public/assets/npc/` · **512×512, PNG with transparent background**

Head-and-shoulders framing, facing the viewer, centred, with a little headroom.
**Transparent background is required** — they composite over the scene art.
Same framing and scale across all four so nobody jumps when the portrait switches.

### 4. `abang-mamak.png` — Abang Mamak · *Mamak Mission*
The man taking your order at the mamak. Friendly, brisk, seen-it-all. Mid-30s to 40s.
Working clothes, maybe a cloth over the shoulder or an apron. Approachable, a bit of a joker.

### 5. `abang-guard.png` — Abang Guard · *Mall Rescue*
Mall security guard. Uniform shirt with epaulettes, radio or lanyard. Calm, helpful, professional.
Reads as *"the person you'd actually ask for directions."*

### 6. `makcik.png` — Makcik · *Mall Rescue, level 3 only*
An older Malaysian auntie who stops **you** to ask for directions — she is the one who flips the
mission around at L3. Warm, chatty, a little lost. Tudung, handbag, shopping bag. Kind-faced.

### 7. `kak-ana.png` — Kak Ana · *Office Panic*
Your manager. Professional office wear, early 30s. **Not angry** — expectant, slightly impatient,
mid-question. This is the hardest expression to land: she has to look like someone applying real
social pressure without being hostile, and it has to survive the `annoyed` CSS tint without tipping
into scary.

---

## Delivery checklist

- [ ] `public/assets/scenes/mamak.jpg` — 1280×720
- [ ] `public/assets/scenes/mall.jpg` — 1280×720
- [ ] `public/assets/scenes/office.jpg` — 1280×720
- [ ] `public/assets/npc/abang-mamak.png` — 512×512, transparent
- [ ] `public/assets/npc/abang-guard.png` — 512×512, transparent
- [ ] `public/assets/npc/makcik.png` — 512×512, transparent
- [ ] `public/assets/npc/kak-ana.png` — 512×512, transparent

Exact filenames and paths — the code reads them straight from the scenario JSON's `scene` and
`portrait` fields, so a rename means a silent fallback, not an error.

Compress before committing: total under ~2 MB. Scenes are backgrounds, so JPG quality ~75 is
plenty; run the PNGs through a lossy optimiser (pngquant / TinyPNG).

Drop them at those paths and they appear. Nothing to rebuild, nothing to wire up.
