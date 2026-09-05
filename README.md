# CAKAP LAH!

**You do not learn Bahasa Melayu by choosing answers. You survive real Malaysian situations by speaking it.**

A voice-controlled Bahasa Melayu practice mini-game. You hear a Malaysian scenario through **Revolab
text-to-speech**, answer **freely by speaking** — no multiple choice, no scripted lines — **Revolab
speech-to-text** transcribes you, and an LLM judges what you *meant*, never how you worded it. The NPC
reacts in character, branches, and speaks back.

Team: **Doulou & Kinny** — Nezriq (BD) · Rui Jie (Engineer)

---

## Run it

Needs **Node 24+**. Nothing to build — no bundler, no framework, no compile step.

```bash
npm install
cp .env.example .env      # then fill in the keys
npm start
```

Open **http://localhost:3000/**.

`.env` needs:

| Variable | Notes |
|---|---|
| `REVOLAB_API_KEY` | Speech-to-text and text-to-speech. Server-side only — never sent to the browser. |
| `LLM_PROVIDER` | `openai` or `gemini`. Both paths are implemented. |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | Whichever provider you chose. |

**Use `localhost`, not an IP or a hostname.** `localhost` is a secure context, so the microphone works
over plain HTTP. Any hosted deployment must be HTTPS or `getUserMedia` silently refuses — no error, the
mic simply never opens.

### Check the API is alive first

```bash
npm run probe
```

Verifies the key, lists the models, synthesises a Malay line, feeds those bytes straight back into
speech-to-text, and prints the transcript and latency for each leg. If this passes, the pipeline works.

### Play without burning credits

```bash
MOCK=1 npm start
```

Then open **http://localhost:3000/?mock=1**. Speech-to-text, text-to-speech and both LLM calls are
stubbed. Failure states are reachable deterministically with `?fail=stt`, `?fail=tts`, `?fail=eval`
and `?fail=json` — useful for demonstrating the error handling without waiting for something to
actually break.

```bash
npm test          # 70 tests: 68 pass, 2 skipped, no API keys required
```

The two skipped tests assert that the evaluator falls back deterministically when **no** LLM key is
configured; they self-skip when a key is present in `.env`. Run `OPENAI_API_KEY= npm test` to see
all 70 run and pass.

---

## How to play

Pick a mission and a level, listen, then **speak your answer out loud** when the mic arms.

| Mission | You are | It gets hard because |
|---|---|---|
| **Mamak Mission** | Ordering teh tarik at 10pm — less sweet | Then he brings the wrong drink |
| **Mall Rescue** | Lost, looking for the food court | You must read the directions back. At level 3 a makcik asks *you* |
| **Office Panic** | Your manager wants yesterday's report | She mentions a 4pm meeting, so "petang ni" is no longer good enough |

| Level | Delivery | Hint | Code-switching |
|---|---|---|---|
| **1 · Santai** | Slower speech | English | Manglish passes — you get the BM word as coaching, never a penalty |
| **2 · Biasa** | Normal | Malay | Passes, but costs you on naturalness |
| **3 · Power** | Normal, extra step | None | Mostly BM expected |

Levels change *delivery and scoring policy*, not politeness. Nobody is ever asked to speak like a
government form.

---

## What it scores

Each turn is judged on four independent axes — **intent 40%, semantics 25%, comprehensibility 20%,
naturalness 15%** — and banded: **90+ Power!** · **75–89 Passed** · **55–74 Almost** · **under 55 Retry**.

A clear, natural, completely off-topic answer scores *high* on comprehensibility and naturalness and
*low* on intent. The axes measure different things on purpose.

At the end of a mission a second pass reads the **whole conversation** — not an average of turns — and
returns a verdict, a summary, strengths, improvements, and **`bm_upgrades`**: every English phrase you
reached for, paired with the Bahasa Melayu you could have said instead.

```
you said  "less sweet"   →  try  "kurang manis"
```

That list is the most useful thing on the screen, and it only ever contains words you actually said.

---

## Design decisions worth knowing

**Meaning, never matching.** `sample_answers` in the scenario files are shown to the evaluator as
*illustrations of range*, explicitly never a match list. An answer resembling none of them can still
score 100 — verified live with five novel phrasings scoring 95–97.

**A system failure never costs you points.** If the evaluator returns malformed output, it retries once,
then falls back to deterministic concept-group rules whose scores are clamped inside the *partial*
band and never below it. Broken infrastructure is not the learner's fault.

**No dead ends.** Silence, a misheard sentence, a network timeout, a dead API — every failure shows
readable text and a Retry, with the scenario still on screen. After two retries on one step the game
advances with partial credit rather than trapping you.

**One voice per character.** Narrator, Abang Mamak, Abang Guard, Makcik, Kak Ana and the coach each
have their own Revolab voice, so text-to-speech is part of the game rather than decoration.

**Answers never reach the browser.** `sample_answers`, `expected_semantics`, `fallback_concepts` and
`key_concepts` are stripped server-side — the answer key is not readable in the network tab.

**No secret client-side.** The browser only ever talks to `/api/*`. Keys stay on the server.

**Privacy.** Audio and transcripts live for the session only. No analytics, no telemetry, no
performance monitoring. This is language practice, not staff evaluation.

---

## Layout

```
server/
  adapters/revolab.js     the only file that knows the Revolab contract
  adapters/evaluator.js   per-turn + whole-conversation LLM calls, validation, retry, fallback
  adapters/mock.js        stubbed speech + evaluation, forced-error modes
  game/branching.js       level gating and forward branch resolution
  routes/                 stt · tts · evaluate · summarise · scenarios
public/
  js/audio/               recorder · visualiser · player
  js/game/                state · engine · scoring
  js/ui/screens.js        rendering and transitions
content/scenarios/        mamak_01 · mall_01 · office_01
scripts/probe.js          npm run probe
```

Art assets are optional: the game ships a CSS/SVG fallback and swaps in real files if they appear at
the paths in `ART_ASSETS.md`. Nothing to rebuild.
