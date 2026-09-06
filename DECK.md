# CAKAP LAH! — deck outline

**For:** Nezriq, to build the ~10-slide PDF
**From:** the build. Every number below was measured against the live APIs, not estimated —
where something is unverified it says so.

**Team:** Doulou & Kinny · Nezriq (BD) · Rui Jie (Engineer)
**Live:** https://cakap-lah.onrender.com · **Repo:** run instructions in `README.md`

> **How to use this.** Each slide has the headline, what goes on the slide, and speaker notes.
> Numbers in **bold** are verified and safe to say out loud. Anything marked ⚠️ is not yet proven —
> do not claim it on stage.
>
> Keep slides sparse. The screen recording does the persuading; the deck frames it.

---

## Slide 1 — Title

# CAKAP LAH!
### You don't learn Bahasa Melayu by choosing answers.
### You survive real Malaysian situations by speaking it.

Doulou & Kinny — Nezriq · Rui Jie

**Notes:** Say the second line out loud and stop. It is the whole pitch and it lands better in
silence than with a build-up.

---

## Slide 2 — The problem

**Language apps test recognition. Speaking is production.**

- Tapping the right answer from four options is a different skill from opening your mouth
- The hard part of BM isn't vocabulary — it's the half-second where you have to *produce* a sentence at a mamak while someone waits
- Multiple choice can never fail you for the thing that actually fails you in real life

**Notes:** Everyone in the room has used a language app and still can't order food. That shared
experience is the setup — don't over-explain it.

---

## Slide 3 — What we built

**Three Malaysian situations. Three difficulty levels. One microphone.**

| Mission | The situation | What makes it hard |
|---|---|---|
| **Mamak Mission** | 10pm, ordering teh tarik — less sweet | He brings the wrong drink. Now complain, politely |
| **Mall Rescue** | Lost, looking for the food court | You must repeat the directions back. At L3 a makcik asks *you* |
| **Office Panic** | Your manager wants yesterday's report | She has a 4pm meeting — so "petang ni" is no longer good enough |

| Level | Delivery | Hint |
|---|---|---|
| 1 · Santai | Slower speech | English |
| 2 · Biasa | Normal | Malay |
| 3 · Power | Normal, extra step | None |

**Notes:** Levels change *delivery and scoring policy*, not politeness. Nobody is ever asked to speak
like a government form — the register stays casual at every level. That's a deliberate design line:
"advanced" means *less English crutch*, not *more formal*.

---

## Slide 4 — The loop

**Hear it → say it → be understood → get answered.**

```
Revolab TTS  →  you speak freely  →  Revolab STT  →  meaning evaluated
      ↑                                                      ↓
      └──────────  NPC reacts in character  ←───────  branch chosen
```

- **Both** Revolab STT and TTS, every single turn
- **Six** distinct voices — narrator, four characters, and the coach
- Measured: TTS **~320 ms** · STT **~290–320 ms** · evaluation **1.8 s mean, 2.8 s worst**

**Notes:** The voices are the point worth dwelling on. One voice per character means TTS is
*integral* rather than decorative — you can hear the makcik take over from the guard mid-mission.
It costs one JSON field and it's the thing a judge notices immediately on the recording.

---

## Slide 5 — Meaning, never matching ⭐ *the differentiator*

**An answer we never wrote down still scores 96.**

> *"Bang, bagi satu teh tarik tapi jangan letak gula banyak sangat ya"* → **96 · Success**

- Five completely novel phrasings, live: **95, 96, 97, 97, 97**
- Scored on four independent axes — intent 40% · semantics 25% · comprehensibility 20% · naturalness 15%
- A clear, natural, **off-topic** answer scores *high* on comprehensibility and *low* on intent. The axes measure different things on purpose.

**Notes:** This is the slide to slow down on. The example answers appear nowhere in our content —
the evaluator is told the sample answers illustrate *range* and are explicitly never a match list.
If a judge asks "so it's keyword matching?", the honest answer is: keyword rules exist *only* as an
offline fallback when the model is unreachable, and even then they can never push a score below the
"Almost" band.

---

## Slide 6 — Difficulty that actually tests comprehension

**Office Panic, level 3: Kak Ana mentions a 4pm meeting.**

| You say | Score |
|---|---|
| "Petang ni lah kak." *(vague, grammatical)* | **27 · Retry** |
| "Pukul satu petang." *(specific, before the meeting)* | **99 · Success** |
| "Pukul lima kak." *(specific, but too late)* | **43 · Retry** |

A vague-but-grammatical answer scores **72 points below** a specific one — and a specific answer
that misses the deadline still fails.

**Notes:** This is the one that earns technical respect. The evaluator has to hold the conversation
in mind — it only knows "petang ni" is insufficient because Kak Ana said "pukul empat" a turn
earlier. And Mall Rescue tests listening comprehension *through production*: repeating directions
back is the only way speech recognition can verify you understood them.

---

## Slide 7 — Coaching a learner can actually use

**`bm_upgrades` — every English word you reached for, with the BM you could have said.**

> you said **"less sweet"** → try **"kurang manis"**

- Harvested from the whole conversation, not one turn
- Only words you actually said — verified in code, not just asked for in a prompt
- At level 1, Manglish **passes** if the task is done. You get the BM word as coaching, never as a penalty.
- Coaching language follows the level: **English at L1, Bahasa Melayu at L2 and L3** — it weans off the crutch as you improve

**Notes:** Beginners get coached in a language they can read; that's a deliberate choice against
"immersion at all costs". The mission-end screen also gives an overall verdict from a second pass
that reads the *whole* conversation — it can see that you recovered after a bad turn, which no
per-turn average could.

---

## Slide 8 — Built so it can't embarrass us

**A system failure must never cost the learner points.**

- Evaluator returns malformed output → retry once → deterministic fallback, **clamped so it can never score you below "Almost"**
- Silence or a misheard sentence → free retry, no penalty, no score recorded
- Two retries on one step → advance with partial credit. **The demo can never dead-end on stage.**
- Speech synthesis down → the reply is still on screen to read
- **122 automated tests**, all passing with no API keys required

**Notes:** If Revolab or the network dies during judging, say so and play the recording — do not fake
a live result. Everything here is reachable on demand with the built-in failure toggles, so the error
handling can be *shown* rather than described.

---

## Slide 9 — Live, and safe to share

**https://cakap-lah.onrender.com** — HTTPS, real keys, verified working end to end.

- No API key ever reaches the browser; the answer key is stripped server-side so it isn't readable in the network tab
- `/api/tts` only speaks lines the game itself produced — it can't be used as a free speech proxy
- Rate limited in three layers, sized so **five players behind one venue NAT don't knock each other out**

**Notes:** ⚠️ It's on the free tier, which sleeps after ~15 minutes idle — a cold visitor waits
30–50 seconds. **Warm the URL a couple of minutes before anyone opens it.** Don't make the recording
depend on the hosted version; record against the local run.

---

## Slide 10 — Close

### Real Malaysian situations. Real speech. No multiple choice.

**What's next:** more scenarios · pronunciation feedback · progress across sessions

**Notes:** End on the same line you opened with. The demo did the work.

---

# Appendix — for questions, not slides

**"How do you stop the AI just telling the player the answer?"**
We had exactly that bug. The NPC was crediting players with words they never said — you'd mumble
"teh" and it would reply "teh tarik, kurang manis?", handing over the answer. Fixed at the prompt
*and* in code: **0 leaks across 70 live turns**, measured by an automated audit.

**"Isn't the LLM inconsistent?"**
It was — the same sentence once scored 58 and once scored 1. Grading now runs at temperature 0 and
the model must write out a per-requirement finding *before* it produces any number. Repeat runs are
byte-identical on the scores.

**"What if the model just pattern-matches your examples?"**
It did, and we caught it: an answer that was literally one of our own sample answers scored 59
because it lacked the word "sebelum". Fixing it lifted valid answers across *all three* scenarios —
one mall answer went 55 → 96 — while the vague-answer trap got *stronger*, not weaker.

**Honest gaps** — say these plainly if asked:
- ⚠️ Art assets are sourced images, not commissioned work
- Scenario content is three missions; this is a demo, not a curriculum
- The rate limiter holds state in memory, so it assumes a single instance

---

## Recording the demo — see `BUILD_PLAN.md` §15

The 90-second beat sheet is there: hook → Mamak L1 with two voices → an unscripted valid answer →
transcript, score and coaching → NPC reacts → jump to Office Panic L3 → mission-end screen with
`bm_upgrades` → closing line.

**One change since it was written:** the mic no longer starts by itself. Press **CAKAP** when
"GILIRAN ANDA" appears, speak, then press **STOP**. Budget a beat for it — it reads fine on camera
and it means the recording never catches the app listening when you didn't intend it to.
