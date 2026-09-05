# CAKAP LAH! — Build Plan

**Team:** Doulou & Kinny (Nezriq — BD, Rui Jie — Engineer)
**Source of truth:** `Doulou_and_Kinny_CAKAP_LAH_FINAL_BUILD_BRIEF.pdf` (19pp). This plan implements that brief. Where it deviates, the deviation is marked **[decision]** with the reason.
**Revised:** 5 Sep 2026. **Deadline:** Sun 6 Sep 2026, 23:59 MYT. **Self-imposed target:** 20:00 MYT Sunday.

> Self-contained. A fresh session should be able to build the whole app from this without reading the PDF.

---

## 0. What this is

A voice-controlled Bahasa Melayu practice mini-game. The player hears a Malaysian scenario through Revolab TTS, answers **freely by speaking**, Revolab STT transcribes it, an LLM judges *meaning* (never exact wording), an NPC branches and replies, TTS speaks the feedback, next turn.

**Pitch:** You do not learn Bahasa Melayu by choosing answers. You survive real Malaysian situations by speaking it.

### Non-negotiables

| Rule | Consequence |
|---|---|
| Must use **both** Revolab STT and TTS | Using only one does not qualify |
| **Do not use RevoCall in any form** | Disqualifying. RevoCall MCP tooling may be present in the dev environment — do not touch it. |
| Do not fork or reuse another internal Revolab codebase | Disqualifying |
| No exact-sentence matching — score meaning first | The core product differentiator |
| No secret API key client-side or committed | Explicit acceptance-criteria check |
| Other frameworks / cloud / non-speech APIs | Allowed — hence OpenAI/Gemini for the evaluator |

---

## 1. VERIFIED API contract

Probed live against the hackathon key on 5 Sep 2026 and **confirmed working**. Do not substitute values from the public docs — several are wrong for this key.

**Auth:** `Authorization: Bearer rvl_live_...` — from `.env` as `REVOLAB_API_KEY`, server-side only.

### ⚠️ The documented default models DO NOT WORK

`GET /v1/models` returns exactly two:

```json
{"object":"list","data":[{"id":"aisyah-1.0-pro"},{"id":"nada-1.0-pro"}]}
```

The docs advertise `nada-1.0-flash`, `nada-1.0-flash-lite`, `aisyah-1.0-flash` — **all 400 with `Model 'x' is not available.`** Because the API's own defaults are the `flash` variants, **omitting `model` fails**. Always send it: STT → `aisyah-1.0-pro`, TTS → `nada-1.0-pro`.

### STT — `POST https://api.revolab.ai/v1/stt`

`multipart/form-data`: `file` (required) · `model=aisyah-1.0-pro` (**must be explicit**) · `language=ms` (optional — auto performs identically) · `denoise`/`diarize`/`language_tags` unused.

Accepts WAV, MP3, M4A, FLAC, OGG, **Opus, WebM**. Max 50 MB / 30 min.

```json
{"text":"Anda di mamak, pesan satu teh tarik kurang manis.",
 "language":"Malay","duration_s":2.9,"confidence":0.9561,"latency_ms":290}
```

`language` returns a human name (`"Malay"`), **not** a BCP-47 code despite the docs. Don't parse it as one.

### TTS — `POST https://api.revolab.ai/v1/tts`

JSON: `model=nada-1.0-pro` (**must be explicit**) · `text` ≤10,000 chars · `voice_id` · `language="ms"` · `output_format="mp3"` **[decision — smaller than wav]** · `speed` 0.5–2.0 · `stream` unused.

Returns audio bytes, 24 kHz mono, plus `X-Duration-S`, `X-Latency-Ms`, `X-Request-Id`.

### Measured latency — no streaming needed

TTS 536 ms · STT 290 ms (WAV) / 385 ms (WebM) / 423–467 ms (6.3 s code-switched). A full turn ≈ TTS 0.5 s + record + STT 0.4 s + eval 1–2 s + TTS 0.5 s. Inside the brief's 20–45 s round.

### Voices

```
ms Male    paan-f695215e    Paan   — Upbeat, Enthusiastic, Friendly
ms Male    ali-13002bfa     Ali    — Energetic and expressive
ms Male    peter-aa4355f2   Peter  — Cinematic, documentary narrator
ms Female  angel-e67ca253   Angel  — Professional, Polite, Clear
ms Female  nur-b184422b     Nur    — Casual, Conversational, Everyday
ms Female  liyana-fb5824d7  Liyana — Sweet, Gentle, Educational
ms Female  salina-d3e1a70d  Salina — Calm, Soothing, Narrative Storyteller
en Male    ahmad-642668a6   Ahmad  — Professional, polite and accommodating
```

**[decision] One voice per character, plus a narrator and a coach.** Cheap (one JSON field), and it makes TTS visibly *integral* rather than decorative — which is a judging criterion, and reads instantly on the recording.

| Role | Voice |
|---|---|
| Narrator (scene-setting) | `salina-d3e1a70d` |
| Abang Mamak | `paan-f695215e` |
| Abang Guard (mall) | `ali-13002bfa` |
| Makcik (mall, L3) | `nur-b184422b` |
| Kak Ana (office) | `nur-b184422b` |
| Coach (feedback line) | `liyana-fb5824d7` |

### Verified round trips

1. **TTS → STT** — transcribed verbatim, confidence 0.956.
2. **WebM/Opus** — identical accuracy to WAV (0.9563 vs 0.9561) at **11× smaller** (12 KB vs 138 KB). → **`MediaRecorder` posts straight to STT. No AudioWorklet, no resampling, no WAV encoding, no ffmpeg.**
3. **Code-switching** — *"Boss, saya nak teh tarik satu, less sweet ya. Report tu belum siap lagi, petang ni I hantar."* returned **verbatim**, 0.96, with and without the language hint. The §5A Manglish policy works as written.

---

## 2. Architecture

Express + no-build front end. One process, one `npm install`, no bundler, nothing to rebuild before the demo.

```
cakap-lah/
├─ .env / .env.example / .gitignore   ← .gitignore in the FIRST commit
├─ server/
│  ├─ index.js
│  ├─ routes/{stt,tts,evaluate,summarise,scenarios}.js
│  └─ adapters/
│     ├─ revolab.js      ONLY file that knows the Revolab contract
│     ├─ evaluator.js    per-turn + overall LLM calls, validation, retry, fallback
│     └─ mock.js         stubbed STT/TTS/eval + forced-error modes
├─ public/
│  ├─ index.html  styles.css
│  ├─ assets/
│  │  ├─ scenes/{mamak,mall,office}.jpg
│  │  └─ npc/{abang-mamak,abang-guard,makcik,kak-ana}.png
│  └─ js/
│     ├─ main.js  api.js
│     ├─ audio/{recorder,visualiser,player}.js
│     ├─ game/{state,engine,scoring}.js
│     └─ ui/screens.js
├─ content/scenarios/{mamak_01,mall_01,office_01}.json
└─ scripts/probe.js      npm run probe
```

**Audio graph:** one `getUserMedia` stream, two consumers — `MediaRecorder` (upload) and `AnalyserNode` (visualiser). No conversion anywhere.

---

## 3. The turn loop

1. Player picks scenario + level (1/2/3) on the home screen.
2. Narrator speaks `intro` (Salina), then NPC speaks `tts_prompt` at the level's `speed`.
3. Recording arms on audio end (also manual). Visualiser live, timer, **hard cap 20 s**.
4. Stop → webm → `POST /api/stt` → transcript.
5. **Empty transcript** → "Tak dengar tadi — cuba lagi." No penalty, back to 3.
6. `POST /api/evaluate` (§5.1) → per-turn scores + `npc_reply` + `branch`.
7. Validate → retry once strict → deterministic fallback (§5.3).
8. Show transcript + turn score counting up + one coaching line.
9. `POST /api/tts` ← `npc_reply` in the NPC's voice; NPC portrait switches to the branch's state.
10. Append `{npc, player, score}` to the transcript log.
11. Branch → next step / retry / mission end. On end → `POST /api/summarise` (§5.5) → end screen.

**[decision] Retry cap: after 2 retries on one step, advance with partial credit.** The demo must never dead-end on stage.

---

## 4. Scenario schema

**[decision] `steps[]` instead of the brief's flat §6 fields** — the brief's own worked examples are all multi-turn.

**[decision] 3 scenarios × 3 levels.** Levels change *delivery* and *scoring policy*, not content, except that L3 adds one extra step:

| Level | `speed` | Hint | `allowed_code_switch` |
|---|---|---|---|
| 1 | 0.85 | `task_en` (English) | beginner — Manglish passes |
| 2 | 1.0 | `task_ms` (Malay) | intermediate — passes, costs naturalness |
| 3 | 1.0 | none | advanced — expect mostly BM |

> **"Advanced" ≠ formal.** It means *less English crutch*, not *formal register*. All three scenarios stay casual — nobody is ever asked to speak like a government form. Register is set per-scenario by the NPC's lines; the code-switch axis is independent.

```json
{ "id": "mamak_01", "title": "Mamak Mission", "order": 1,
  "badge": "Can Survive at Mamak",
  "context": "English scene description shown on screen",
  "npc_name": "Abang Mamak", "voice_id": "paan-f695215e",
  "scene": "mamak", "portrait": "abang-mamak",
  "intro": { "text": "...", "voice_id": "salina-d3e1a70d" },
  "levels": { "1": {...}, "2": {...}, "3": {...} },
  "steps": [
    { "id": "order", "levels": [1,2,3],
      "tts_prompt": "what the NPC says, in character",
      "task_en": "on-screen instruction (L1)",
      "task_ms": "on-screen instruction (L2)",
      "expected_semantics": ["concepts, not keywords"],
      "key_concepts": ["..."], "sample_answers": ["..."],
      "fallback_concepts": [["variant","variant"], ["..."]],
      "retry_hint": "...",
      "npc_states": { "success": "pleased", "partial": "idle", "retry": "annoyed" },
      "branches": { "success": "next_step_id", "partial": "...", "retry": "same_id" } }
  ],
  "complete": { "npc_line": "...", "voice_id": "..." } }
```

**[decision] `tts_prompt` and `task` are separate.** The brief's §7 mixes NPC dialogue with player instructions in one spoken line. Splitting them keeps the NPC in character, makes the player *notice* the problem rather than be told about it, and matches the brief's own §8 screen list.

Steps may override `npc_name` / `voice_id` / `portrait` — used in `mall_01` when the makcik appears.

### ⚠️ Engine rule: resolve branches forward

`steps[].levels` gates inclusion. At L1/L2 a branch may point to a step excluded at that level (e.g. `wrong_order.success → upsell`, which is L3-only). **If a branch target is not included at the current level, advance to the next included step; `__complete__` if there is none.** Three lines of code, and a very confusing bug if nobody writes them.

`sample_answers` go to the evaluator as **illustrations of range, explicitly never a match list.**

---

## 5. Scoring — two tiers

**[decision] XP is dropped.** It's a retention mechanic and nothing in a three-minute demo retains. Brief §3 lists XP as must-have and §16 has a checkbox, but §16's wording is *"XP **or progress** updates"* — visible per-turn scores accumulating into an overall satisfies it honestly. **Tell Nezriq**, since the brief is the shared contract and he's writing the deck against it.

### 5.1 Per-turn — input

```json
{ "scenario_id": "...", "level": 2, "allowed_code_switch": "intermediate",
  "scenario_context": "...", "npc_prompt": "...", "task_goal": "...",
  "expected_semantics": ["..."], "sample_answers": ["..."],
  "stt_transcript": "...", "stt_confidence": 0.95,
  "conversation_history": [{"npc":"...","player":"..."}] }
```

`conversation_history` is **required**. The brief's own example: *"Boleh, sebelum pukul lima saya hantar"* only parses if the evaluator knows what was just asked.

### 5.2 Per-turn — output

```json
{ "intent_pass": true, "intent_score": 92, "semantic_score": 88,
  "comprehensibility_score": 90, "naturalness_score": 82, "overall_score": 88,
  "result": "success",
  "what_worked": "one short learner-friendly sentence",
  "improvement": "one short actionable sentence",
  "npc_reply": "in-character BM, 1–2 sentences",
  "branch": "success" }
```

Weights **intent 40 · semantics 25 · comprehensibility 20 · naturalness 15**.
`overall = round(.40*intent + .25*semantic + .20*comprehensibility + .15*naturalness)`
Bands: 90–100 Power! · 75–89 Passed · 55–74 Almost · <55 Retry · no transcript → no score.
`result`: `success` if `overall ≥ 75 && intent_pass`; `partial` if 55–74; else `retry`.

Use provider structured output (OpenAI `response_format: json_schema` strict / Gemini `responseSchema`). **Build the retry-and-fallback path anyway** — it's a required test case.

### 5.3 Fallback

The brief requires *deterministic scenario-meaning rules*, **not literal keyword matching**. Hence `fallback_concepts`: concept *groups* of variant phrasings; a group is satisfied if any variant appears in the normalised transcript; all groups satisfied → `partial`.

Two hard rules: fallback scores are **capped in the `partial` band and never below**, and coaching text stays generic. A system failure must never cost the learner points.

### 5.4 Per-turn prompt sketch

> You are the evaluator for CAKAP LAH!, a Bahasa Melayu speaking-practice game. You judge whether a learner's **spoken** response accomplished a communicative task.
>
> - Never require exact wording. `sample_answers` illustrate the *range* of acceptable answers — they are NOT a match list, and an answer unlike all of them can still score 100.
> - Judge meaning and task completion first; grammar last.
> - The transcript is from speech recognition. Spelling/punctuation artifacts are not the learner's fault.
> - Code-switch policy is `{allowed_code_switch}`: **beginner** — Manglish **passes** if the task is done; offer the BM replacement as coaching, never failure. **intermediate** — may pass; reduce `naturalness_score` where a normal BM alternative exists. **advanced** — expect predominantly BM except proper nouns and technical terms. Note: this axis is about *how much BM*, not formality. Never penalise casual register.
> - Be encouraging. Never mock the learner. Humour targets the situation, never the person.
> - `what_worked` / `improvement`: ONE short sentence each.
> - `npc_reply`: in character, natural Malaysian BM, 1–2 sentences, reacting to what the learner **actually said**.

### 5.5 Overall — judged on the whole conversation

**[decision]** A second LLM call at mission end. **Not** an average of turn scores — it sees things turns cannot: whether the player recovered after a bad turn, whether register held, whether the exchange would have worked in real life. Turn scores go in as reference context.

Input: scenario meta, level, full transcript (NPC + player turns), per-turn scores.

```json
{ "overall_score": 84, "band": "mission_passed",
  "verdict": "Dah boleh cakap.",
  "summary": "2–3 sentences on how the conversation went as a whole.",
  "strengths": ["...", "..."],
  "improvements": ["...", "..."],
  "bm_upgrades": [ { "you_said": "less sweet", "try": "kurang manis" } ] }
```

`bm_upgrades` harvests every code-switch across the conversation and hands back the BM replacement. It is the §5A coaching policy made concrete, the most genuinely *useful* thing on screen, and the best single demo artifact.

---

## 6. Mock mode — build early, it pays for itself

`?mock=1` (browser) and `MOCK=1` (server) stub STT, TTS and both LLM calls, with forced-error toggles `?fail=stt|tts|eval|json`.

Three payoffs: UI work burns no credits; the brief's failure-state tests become **deterministic** rather than hoped-for; and a Revolab outage doesn't stop the build.

---

## 7. Screens

| Screen | Must show |
|---|---|
| Home | Title, 3 scenario cards, **level picker (1/2/3)** |
| Scenario intro | Scene art, title, context, narrator + NPC prompt, replay |
| Listening | Big record/stop, live visualiser, timer, "Cakap sekarang…" |
| Processing | Clear STT/AI activity — **never look frozen** |
| Transcript | What the system heard + Retry |
| Turn result | Turn score counting up, band, one coaching line |
| NPC reaction | Branching reply, displayed and spoken, portrait state changes |
| **Mission end** | **Full conversation transcript** (NPC + player, per-turn scores), overall score, verdict, summary, strengths, improvements, `bm_upgrades` |
| Error | Human-readable + Retry — **no dead ends** |

Tone: bold mission cards, readable transcript, one obvious mic action. "Mini voice game", not "corporate training portal". The STT → evaluation → TTS loop must be obvious on screen.

**Game feel:** canvas mic visualiser; NPC portrait with `idle / talking / pleased / annoyed`; score count-up; screen transitions.

---

## 8. Art assets — optional upgrade, never a dependency

**Build the CSS/SVG fallback first.** Wire `<img onerror>` to fall back, so missing art degrades silently. Assets are then pure upgrade with zero rework.

**Needed — 7 files total:**

```
public/assets/scenes/{mamak,mall,office}.jpg     1280×720, 16:9
public/assets/npc/{abang-mamak,abang-guard,makcik,kak-ana}.png   512×512, transparent
```

Spec: **stylised illustration, not photoreal** — keeps the game feel and avoids resembling real people. Consistent art direction across all seven. Head-and-shoulders framing, consistent light direction. Backgrounds **desaturated or softly blurred** so UI text stays readable over them. Warm and respectful — no caricature; brief §20's rule that humour never targets ethnicity applies to the art too. Keep the total under ~2 MB.

Emotional states come from **CSS on a single portrait** (bounce while talking, scale/glow on pleased, shake/tint on annoyed) — not four images per character. That's 7 assets instead of 19.

**Hard deadline: Sunday 14:00.** Not in by then → ship the fallback. Nezriq or Rui Jie generates these in parallel; the build session never waits on them.

---

## 9. Error handling

| Case | Behaviour |
|---|---|
| Silence / no capture | Retry, no penalty |
| STT nonsense | Show transcript, offer Retry, don't punish |
| Mixed BM-English | Passes at L1 if task done; coach toward BM |
| Alternative valid phrasing | Must pass — this is the product |
| Very long response | Cap at 20 s, evaluate what was captured |
| Profanity / nonsense | NPC responds lightly, score on task completion |
| STT/TTS error | Visible retry, scenario text stays on screen |
| Network slow | Processing indicator + timeout + retry |
| Evaluator invalid JSON | Retry once strict → fallback → never penalise |
| TTS unavailable | Show the text reply, offer Retry TTS, never crash |

**Privacy:** minimum audio/transcript retention for the session only. No performance monitoring. This is language practice, not staff evaluation.

---

## 10. Content

Written and validated — `content/scenarios/*.json`. **All BM needs Nezriq's review** (see `BM_REVIEW.md`); the structure is right, the idiom needs his ear.

| # | Scenario | L1/L2 steps | L3 adds | Why it's harder |
|---|---|---|---|---|
| 1 | **Mamak Mission** | order → wrong_order | `upsell` — decline politely | Formulaic; you control the agenda |
| 2 | **Mall Rescue** | ask → confirm | `give_directions` — makcik asks *you* | Comprehension + spatial sequencing |
| 3 | **Office Panic** | status → pin_down | `cover_me` — take her call, or don't | Social pressure; explain *and* commit |

Two design notes worth keeping: **Mall Rescue's `confirm` step tests listening comprehension through production** — reading directions back is the only way STT can verify understanding. And **Office Panic's `pin_down` contains a trap** — Kak Ana mentions a 4pm meeting, so "petang ni" is no longer good enough; the evaluator must catch a vague-but-grammatical answer. Good thing to show a judge.

**Humour:** roast the situation, never the learner. Success — "Malaysia has accepted your application." Retry — "Bahasa Melayu belum give up on you. Cuba lagi." Never joke about ethnicity, nationality, intelligence, or accent.

---

## 11. Schedule

**Saturday 5 Sep, evening.** ~26 hours to the 20:00 Sunday target. The loop must work before anything is made pretty.

- [ ] **P0 · 30 min** — Scaffold: `git init`, **`.gitignore` in the first commit**, `.env`, express, static serving
- [ ] **P0 · 20 min** — `npm run probe`: key → models → voices → TTS → STT (values in §1; should pass immediately)
- [ ] **P0 · 45 min** — `adapters/revolab.js` + `/api/stt` + `/api/tts`
- [ ] **P0 · 60 min** — Recorder + visualiser + player. 🎯 **Speak → see your BM transcript → hear TTS.**
- [ ] **P0 · 45 min** — Scenario loader, level gating, **resolve-forward branching** (§4)
- [ ] **P0 · 60 min** — `adapters/evaluator.js`: per-turn call, validation, retry, fallback
- [ ] **P0 · 45 min** — `game/engine.js`: turn loop, branching, transcript log
- [ ] 🎯 **Saturday gate: ONE COMPLETE MISSION END TO END.** If this slips, cut scope Sunday — don't add features tonight.

**Sunday morning — breadth**

- [ ] **P0 · 60 min** — Scenarios 2 and 3 wired, all three levels playable
- [ ] **P0 · 45 min** — Overall scoring call + mission-end transcript screen
- [ ] **P1 · 60 min** — All error/retry states (use the mock failure toggles)

**Sunday midday — the design pass**

- [ ] **P1 · 2–3 h** — Visualiser, NPC states, transitions, score count-up, typography. **Only after the loop is stable.**
- [ ] **14:00** — Art assets in, or ship the fallback. No waiting.

**Sunday 16:00 — freeze**

- [ ] **P0 · 60 min** — Full test plan (§12)
- [ ] **P0** — Freeze. Copy to a backup location. **No new features.**
- [ ] **P0** — Screen recording (Nezriq) — mandatory deliverable
- [ ] **P0** — Deck + demo narration (Nezriq)
- [ ] 🎯 **20:00 — submit.** 23:59 is the deadline, not the upload strategy.

**Hosting is local-first.** `localhost` is a secure context so the mic works without HTTPS. Deploy only if everything above is done — and **any hosted demo must be HTTPS or `getUserMedia` silently refuses.**

---

## 12. Test plan

| Test | Pass condition |
|---|---|
| Happy path | Correct branch, sensible score, TTS feedback plays |
| **Different valid wording** | A phrasing absent from `sample_answers` still passes |
| Mixed language | L1 passes with BM coaching |
| Wrong intent | Low score, retry branch |
| Silence | Retry, no penalty |
| Fast speech | Handled, or visible retry |
| Noisy room | Fails gracefully |
| API failure | Retry state, no crash |
| TTS failure | Text reply still visible |
| Three-round session | State persists, no reset bug |
| Malformed evaluator JSON | Retries once, then fallback, learner not penalised |
| Multi-turn context | Short context-dependent answer interpreted correctly |
| **Level gating** | L1/L2 skip the L3 step via resolve-forward; L3 plays all three |
| **Office `pin_down` trap** | A vague "petang ni" scores lower than a specific "sebelum pukul tiga" |
| **Secret exposure** | No key in page source, network tab, or committed source |
| Demo browser + mic | Fresh session: permission, record, playback, TTS all work |

---

## 13. Definition of done

- [ ] Team registration confirmed in `#hacki-hacki-thon` (closed 20 Aug — **verify now**; no amount of code fixes this)
- [x] Model IDs recorded — `aisyah-1.0-pro` / `nada-1.0-pro` *(§1)*
- [ ] No secret client-side or committed
- [ ] ≥3 missions end to end, with multi-turn context
- [ ] **Two different valid phrasings both pass**
- [ ] BM content reviewed by Nezriq (`BM_REVIEW.md`)
- [ ] Player hears a BM prompt via Revolab TTS
- [ ] Player answers by mic, freely
- [ ] Revolab STT transcript visibly shown
- [ ] Turn score + one coaching point
- [ ] NPC response varies by success/partial/retry
- [ ] Feedback spoken via Revolab TTS
- [ ] Progress visible across the mission *(replaces XP — see §5)*
- [ ] Mission-end transcript + overall score + `bm_upgrades`
- [ ] 3 scenarios run consecutively
- [ ] Silence/API failure → retry, not crash
- [ ] Screen recording shows the real working app

---

## 14. Submission

Email **all four**: `shen@revolab.ai`, `daniel.gun@revolab.ai`, `cheelam@revolab.ai`, `dania.hassin@revolab.ai`
Subject: **`Revolites Hackathon - Doulou & Kinny`**
Attach: deck (PDF, ~10 slides) · screen recording (mandatory) · run instructions / demo link · team + member names + one-line description. Body in brief §22A.

**Backup:** tested local run · pre-tested browser + a spare · scenarios bundled locally · evaluator retry-then-fallback · **if Revolab is down during judging, do not fake a live result** — explain and play the recording · recording, deck and build all on the laptop before Sunday evening.

---

## 15. Demo script — 90 seconds

| Time | Beat | What judges notice |
|---|---|---|
| 0:00 | "You don't learn BM by choosing answers. You survive by speaking it." | The hook |
| 0:10 | Mamak Mission, L1. Narrator then NPC — two voices | TTS is integral |
| 0:20 | Give an **unscripted but valid** BM answer | Open-ended voice control |
| 0:30 | Transcript + turn score + coaching | STT + semantic evaluation |
| 0:40 | NPC reacts, TTS speaks back | A loop, not an API test |
| 0:55 | Jump to Office Panic at L3 — no hint, answer differently | Difficulty levels, random answers |
| 1:10 | Mission-end screen: transcript, overall score, `bm_upgrades` | Real coaching, not a toy |
| 1:20 | "Real Malaysian situations. Real speech. No multiple choice." | Differentiation |

---

## 16. Open items for Rui Jie

1. **Confirm team registration** — nothing else matters if this is wrong.
2. **Pick OpenAI or Gemini**, key into `.env`. Both do strict structured output; one env var.
3. **Rotate `REVOLAB_API_KEY` after the hackathon** — pasted into a chat transcript 5 Sep.
4. **Send `BM_REVIEW.md` to Nezriq now** — his review is the long pole, and he's also doing the deck and recording.
