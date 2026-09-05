# BM Review Sheet — interface copy

**For:** Nezriq (BM content QA owner)
**From:** hand-maintained. `BM_REVIEW.md` is generated from `content/scenarios/*.json` and only
covers scenario content, so it has no place for the game's own **interface** strings. Those live here.

Every line below is 👁 **shown on screen only** — none of it is ever spoken by TTS. It is the game
talking to the player, not a character talking to the player, so the register is different from the
scenario sheet: short, direct, spoken-Malay signage. Think of the words on a mamak menu board or a
self-service kiosk, not a textbook.

Mark anything that reads as stiff, wrong, or simply not what a Malaysian would put on a button, and
write the version you'd use. Two constraints to keep in mind when correcting:

- **"CAKAP" is the label printed on the microphone button** and must survive verbatim in any
  rewrite — every one of these lines is telling the player to press that specific button.
- **The strip lines (1 and 2) are size-constrained.** Line 1 is set at 24–28px; roughly 14 characters
  is the comfortable maximum before it crowds the strip at 1280×720.

All strings live in `public/js/main.js`, `public/js/ui/screens.js` and `public/index.html`.

---

## A. "Your turn" — the state that replaces the old auto-starting mic

The microphone used to arm and start recording by itself ~350 ms after the NPC finished. It now waits
for a deliberate press, so this cue is the **only** thing telling a first-time player that the game is
waiting for them. If any line here is unclear, a new player stares at a silent screen. It is the most
load-bearing copy in the interface.

### 1. Strip headline — the big amber banner across the visualiser

> **GILIRAN ANDA**

_Set in caps at 24–28px. Appears the moment the NPC stops talking and stays until the player presses._

- [ ] Approved  ·  Correction: `________________________________`

### 2. Strip sub-line — directly under the headline

> tekan CAKAP, lepas tu cakap

- [ ] Approved  ·  Correction: `________________________________`

### 3. Badge in the phase row — the amber pill top-right of the dock

> **GILIRAN ANDA**

_Sits in the same slot the pink `RECORDING` badge uses while recording. Caps, 11px, letterspaced._

- [ ] Approved  ·  Correction: `________________________________`

### 4. Mic hint — the small line under the microphone button

> Tekan CAKAP untuk mula

_Also used as the button's `aria-label`, so it is what a screen reader announces._

- [ ] Approved  ·  Correction: `________________________________`

### 5. Phase line — normal turn

> Giliran anda — tekan CAKAP dan jawab.

- [ ] Approved  ·  Correction: `________________________________`

### 6. Phase line — after a capture with nothing in it

> Tak dengar apa-apa — tekan CAKAP dan cuba lagi. Tiada penalti.

_Shown when the player stopped almost immediately, or said nothing. It costs no marks and no score is
shown — the "tiada penalti" has to land, or the player thinks they were punished._

- [ ] Approved  ·  Correction: `________________________________`

### 7. Phase line — the server asked for another attempt at the same step

> Cuba sekali lagi — tekan CAKAP bila anda sedia.

- [ ] Approved  ·  Correction: `________________________________`

### 8. Phase line — after a technical error, offering the same step again

> Tekan CAKAP untuk cuba giliran ini sekali lagi.

- [ ] Approved  ·  Correction: `________________________________`

---

## B. "You may cut in" — barge-in, while the NPC is still talking

The player does not have to wait for the NPC to finish; pressing CAKAP mid-line cuts the voice off and
starts recording. These three lines exist to teach that. They are deliberately in the **same family**
as section A — same amber, same "tekan CAKAP" ending — because both moments are answered by the same
button. If a correction to A changes the phrasing of "tekan CAKAP", please carry it through here too so
the two states keep sounding like one idea.

### 9. Strip headline while the NPC speaks

> Potong je — tekan CAKAP

_Set at 21px. "Potong" as in cutting into someone's speech — please confirm this reads as
interrupting, not as queue-cutting or literal cutting._

- [ ] Approved  ·  Correction: `________________________________`

### 10. Mic hint while the NPC speaks

> Boleh potong — tekan CAKAP

_Also the button's `aria-label` in that state._

- [ ] Approved  ·  Correction: `________________________________`

### 11. Strip sub-line — shown once per session, the first time an NPC speaks

> tak payah tunggu dia habis cakap

- [ ] Approved  ·  Correction: `________________________________`

---

## C. Pre-existing line, re-checked because it is now more visible

### 12. Visualiser idle text

> tekan mic bila anda sedia bercakap

_Shown when the dock is idle and neither cue above is up. It says "mic" while the button now reads
"CAKAP" — worth deciding whether to align it._

- [ ] Approved as-is  ·  Correction: `________________________________`

---

## Anything missing?

If you spot a Bahasa Melayu string on screen that is not listed here and not in `BM_REVIEW.md`,
please note it below — it means the interface grew a line nobody wrote down.

`________________________________________________________________`
