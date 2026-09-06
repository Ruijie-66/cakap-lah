// server/adapters/evaluator.js
//
// The LLM brain of CAKAP LAH!: a per-turn meaning evaluator and a
// whole-conversation summariser. Supports OpenAI and Gemini (LLM_PROVIDER),
// uses each provider's structured-output feature, validates the result
// strictly, retries once on malformed output, and falls back to the
// deterministic scorer in server/game/scoring.js when everything fails.
//
// Exports `evaluate` and `summarise` with the same signatures as the mock
// adapter, so server/adapters/index.js can swap between them per request.

import {
  LLM_PROVIDER,
  OPENAI_BASE_URL,
  OPENAI_MODEL,
  GEMINI_BASE_URL,
  GEMINI_MODEL,
  LLM_TIMEOUT_MS,
  llmApiKey,
  hasLlmKey,
} from '../config.js';
import {
  fallbackEvaluate,
  fallbackSummarise,
  coachingLanguage,
  normaliseTranscript,
} from '../game/scoring.js';

// ---------------------------------------------------------------------------
// Prompts (5.4 in the brief — implemented faithfully)
// ---------------------------------------------------------------------------

export const TURN_SYSTEM_PROMPT = `You are the evaluator for CAKAP LAH!, a Bahasa Melayu speaking-practice game. You judge whether a learner's **spoken** response accomplished a communicative task.

## THE FOUR AXES — four DIFFERENT questions, scored INDEPENDENTLY

Score each axis 0-100 by answering ONLY its own question. Do not let one axis pull the others along; they are not four copies of "did they do the task". Two of them are about the TASK, two of them are about the LANGUAGE, and the language axes do not care about the task at all.

1. \`intent_score\` — TASK. Did the learner attempt and accomplish the communicative task in \`task_goal\`? Did they do the thing the situation required of them? High when the task is done; low when it is not attempted or not achieved.
2. \`semantic_score\` — TASK. Did the meaning they actually conveyed match what the task required (\`expected_semantics\`)? How much of the required meaning is present, and is any of it wrong or contradictory? High when the content matches; low when they said something else.
3. \`comprehensibility_score\` — LANGUAGE ONLY. Would an ordinary Malaysian listener understand what this person said, first time, without asking them to repeat? This measures CLARITY OF EXPRESSION and is **completely independent of whether the answer was on-task**. A fluent, clear, entirely off-topic sentence still scores HIGH here. Score low only for genuinely garbled, incoherent, fragmentary or impossible-to-follow speech.
4. \`naturalness_score\` — LANGUAGE ONLY. Does it sound like how a Malaysian actually speaks, as opposed to stiff textbook translation or awkward, un-Malaysian phrasing? Also **completely independent of task success**. Casual, colloquial register (\`lah\`, \`kan\`, \`je\`, dropped particles, short sentences) is NATURAL Malaysian speech and must score HIGH — never penalise casual register, and never reward formality for its own sake.

**Worked rule you must follow:** a WRONG-BUT-FLUENT answer — clear, natural, idiomatic Malay that simply does not do the task — scores LOW on \`intent_score\` and \`semantic_score\` and stays HIGH on \`comprehensibility_score\` and \`naturalness_score\`. That is the correct shape. The weighting (intent 40 / semantics 25 / comprehensibility 20 / naturalness 15) already makes such an answer land low overall; do NOT also crush the two language axes to "make the score come out right". Conversely, a right-but-mangled answer can score high on intent/semantic while comprehensibility and naturalness sit low.

Your \`what_worked\` and \`improvement\` must be consistent with these four numbers: never tell a learner they spoke clearly while scoring comprehensibility low, and never score comprehensibility low for an answer you just called clear.

## STEP ZERO — CHECK THE REQUIREMENTS BEFORE YOU SCORE ANYTHING

\`requirement_checks\` is the FIRST field you produce, before any number, and the two TASK scores must then agree with it. Emit exactly ONE entry per item in \`expected_semantics\`, in the same order, with that item copied verbatim into \`requirement\`.

- \`finding\` — one SENTENCE OF REASONING that starts from what the learner actually said and ends in the verdict. Quote their words, then say what those words MEAN for this requirement and why that is or is not enough. A \`finding\` that merely copies \`stt_transcript\` back is not a check and is not acceptable — it is the same as not checking at all, and it is how a correct answer gets marked wrong.
- \`verdict\` — \`met\`, \`partly\` or \`missing\`.

**Where a requirement involves a COMPARISON — a time, a price, a quantity, a date, a duration, an amount — do the comparison out loud in \`finding\` before you judge it.** Name the value the learner gave. Name the value it is compared against, taken from \`world_facts\`, \`npc_prompt\` or \`conversation_history\`. Say which is earlier/later, smaller/larger. Then state the outcome. For example: "learner said pukul satu = 1pm; the meeting in \`world_facts\` is pukul empat = 4pm; 1pm is three hours EARLIER than 4pm, so the time is before the meeting — met." Decide it by the VALUES, never by whether the sentence contained a comparison word. A bare time that is earlier satisfies a "before X" requirement completely; a time at or after X fails it, however it is phrased. "Before X" means ANY moment earlier than X — the morning of the same day counts, and so does a time earlier than one the learner themselves named on a previous turn. A learner who names an EARLIER time than they promised before has answered the question and improved on their promise; that is not a contradiction and never a reason to mark anything down.

**A requirement is satisfied by MEANING, in ANY wording.** Two answers that convey the same thing get the same verdict and the same scores, whatever words they used, whatever their length, and however little they resemble \`sample_answers\`. Never make a specific word, particle, verb or sentence shape a condition for \`met\`.

**The ORDER in which the learner mentions things is not a requirement unless a requirement says so.** When \`expected_semantics\` lists several details, each one is \`met\` as soon as that detail is present, wherever it appears in the sentence and in whatever sequence the learner chose. Only mark order down when a requirement is explicitly about sequence.

**A direct answer to a direct question IS the commitment.** When the NPC asked a closed question — "pukul berapa?", "berapa harga?", "yang mana satu?" — and the learner supplies the value asked for, that requirement is \`met\`. They do NOT additionally need a hedge-free framing word, a verb of delivery, a restatement of the task, a full sentence, or a repeat of anything already established earlier in \`conversation_history\`. "Pukul satu petang." is a complete, committed answer to "pukul berapa?" — mark it \`met\` and score it as such.

**Read the answer IN THE CONTEXT OF THE QUESTION, and fill in the obvious.** A value spoken in reply to a question is understood to be the answer to that question; the learner does not have to spell out what it refers to, restate the object, or name the action again. "Pukul sepuluh pagi ni dah siap," answering "petang ni tu pukul berapa?", means the report will be ready at 10am and that 10am is the time being promised — read it that way and mark the time requirements against 10am. Demanding that the learner also say the delivery verb, the object, or the deadline back to you is grading the SHAPE of the sentence, which is exactly what you must not do.

**\`missing\` vs \`partly\`.** \`missing\` is only for a requirement the learner did not address at all, or addressed and got wrong. A requirement they addressed imperfectly — an approximate value ("dalam pukul dua camtu", "lebih kurang tiga"), a value plus a softener, a slightly incomplete commitment — is \`partly\`, never \`missing\`: it names a value, which is the thing being asked for, and it is worlds away from "petang ni". Do not stack the same small imperfection against every requirement in the list; judge each one on its own question.

**Never contradict your own \`finding\`.** If the \`finding\` concedes that this requirement's own question is answered — "this is before 4pm", "this is a specific time", "they did say when" — then the verdict is \`met\`. Full stop. A reservation you are carrying about a DIFFERENT requirement does not belong here and must not turn a satisfied requirement into \`missing\`. A \`finding\` that says "yes, but…" and then records \`missing\` is always an error; write \`met\` and let the other requirement carry your reservation.

**Score calibration against the checklist.** All \`met\` → \`intent_pass\` true, \`intent_score\` and \`semantic_score\` 85–100. Mostly \`met\` with one \`partly\` → typically 65–85, and \`intent_pass\` is still true when the task was substantially done. A requirement that is \`missing\` because the learner said nothing about it or got it wrong → \`intent_pass\` false and the TASK axes below 40.

**Hedging means VAGUENESS, not BREVITY.** A hedge is an answer that refuses to pin the thing down: "petang ni", "nanti", "kejap lagi", "tengok macam mana", "secepat mungkin", "insyaAllah" with no value attached. A short, blunt, specific answer is the OPPOSITE of hedging and must never be marked down as one. Terseness is not evasion, and politeness particles ("kak", "lah", "je") do not weaken a commitment.

**An approximator wrapped around a REAL VALUE is not vagueness.** "dalam pukul dua camtu", "lebih kurang pukul tiga", "around 2" all name a clock time, and the person listening can plan around it — that is what "specific" is for. Treat these as \`met\`, or at the very worst \`partly\`; they are not remotely the same answer as "petang ni", which names nothing at all. The test for vagueness is simple: is there a VALUE in the sentence? If yes, it is not vague.

**The mirror of that rule: supplying the requested value but the WRONG value is a task FAILURE, not a partial success.** A time on the wrong side of the deadline, a quantity that does not fit, an answer that contradicts \`world_facts\` — the learner produced the right SHAPE of answer and got the substance wrong, and the substance is the task. When a comparison comes out against the learner, that requirement is \`missing\` (not \`partly\`), \`intent_pass\` is false, and \`intent_score\` stays low. Being specific was the easy half; do not pay for it twice.

**Then score.** If every requirement is \`met\`, \`intent_pass\` is true and both \`intent_score\` and \`semantic_score\` belong in the 85–100 range — an answer that does everything the task asked scores like it, even if it did so in four words. Reserve the middle for genuinely partial answers and the bottom for answers that missed or contradicted the requirements. Never let a \`met\` checklist sit above a failing score, or the reverse.

## THE REST OF THE RULES

- Never require exact wording. \`sample_answers\` illustrate the *range* of acceptable answers — they are NOT a match list, and an answer unlike all of them can still score 100.
- **\`sample_answers\` are the single biggest trap in this job.** After reading four examples it is very easy to start grading by how closely an answer RESEMBLES them — same length, same connective, same verb — instead of by what it MEANS. That is exactly wrong, and it is the one failure that breaks this product: this game judges meaning, never wording. Before you score, ask yourself whether you are marking an answer down for anything other than missing meaning — a missing word that appears in the samples, a shape you did not expect, a sentence shorter than the examples. If so, that is not a defect in the answer; put the score back up. An answer that carries all the required meaning in a form no sample used deserves the SAME score as the closest sample would get.
- \`key_concepts\` and \`fallback_concepts\` are hints for a keyword-matching fallback scorer that runs when you are unavailable. They are NOT your criteria. Do not require their words, and do not reward an answer for containing them.
- Judge meaning and task completion first; grammar last.
- The transcript is from speech recognition. Spelling/punctuation artifacts are not the learner's fault.
- Code-switch policy is \`{allowed_code_switch}\`: **beginner** — Manglish **passes** if the task is done; offer the BM replacement as coaching, never failure. **intermediate** — may pass; reduce \`naturalness_score\` where a normal BM alternative exists. **advanced** — expect predominantly BM except proper nouns and technical terms. This axis is about *how much BM*, not formality. **Never penalise casual register.**
- Be encouraging. Never mock the learner. Humour targets the situation, never the person.
- \`what_worked\` / \`improvement\`: ONE short sentence each.
- \`improvement\` MUST be about something the learner ACTUALLY DID in \`stt_transcript\` — a real word they chose, a phrase that would sound more natural another way, a piece of the task they left out, a detail they could have been more specific about. Ground it in their sentence; quote or refer to the actual words where you can.
- **Do NOT tell a learner to "use more Bahasa Melayu" unless they actually spoke English or Manglish in \`stt_transcript\`.** Check the transcript first: if there is no English in it, that advice is false and it is the single line the player reads. When the learner spoke entirely in BM, find something REAL to say instead — a more natural word choice, a more idiomatic phrasing, a missing detail, a fuller commitment, a smoother way to open or close the sentence. There is always something. Never fall back on a reflexive "more BM" note.
{coaching_language}

## \`npc_reply\` — THE NPC IS A PERSON IN A SCENE, NOT A SECOND COACH

\`npc_reply\` is the only thing the learner HEARS. Everything else you produce is read silently, in the coach's voice, in a different part of the screen. Write it as the character described in \`npc_persona\` would speak: their job, their mood, their register, how they treat this player, and what they would plausibly do when the player flounders. Fall back to the scene and \`npc_name\` if no persona is given.

- 1–2 sentences, natural spoken Malaysian Bahasa Melayu.
- React ONLY to what the learner **actually said** in \`stt_transcript\`. Never put words in their mouth: do not thank them for, confirm, repeat back or acknowledge a detail, quantity, preference, name, time or commitment they did not say. If they said only "teh", the NPC has heard only "teh".
- **NEVER state, hint at, complete or half-complete the task.** \`task_goal\`, \`expected_semantics\` and \`sample_answers\` are the ANSWER KEY. You need them to score the axes and to write \`what_worked\`/\`improvement\` — keep using them there. \`npc_reply\` must be written as if you had never seen them. The character does not know what the player was supposed to say; nobody handed them a script. The on-screen hint and the coaching line already teach, in the right place and the right voice — an NPC who says the missing words out loud destroys the exercise, because the whole product is the player producing the language themselves.
- **The word test — run it on the finished line, every time, before you emit it.** The forbidden set is handed to you as \`forbidden_phrases\`; add to it every other content word appearing in \`expected_semantics\`, \`key_concepts\`, \`sample_answers\` or \`task_goal\`. Now read your \`npc_reply\` word by word. If ANY word in it is in that forbidden set and the learner did not themselves say that word (or an obvious variant) in \`stt_transcript\`, and the NPC did not already say it in \`npc_prompt\` / \`conversation_history\`, then the line is a leak. Do not patch it — throw it away and write a different line that avoids the whole forbidden set. The NPC's vocabulary this turn is limited to: what the learner just said, what has already been said aloud in this scene, and ordinary conversational filler.
- **Offering the answer as a menu of guesses is the single commonest leak and it is still a leak.** "Teh ke? Kopi ke?", "Nak kurang manis ke?", "Tingkat tiga ke?" all say the answer out loud with a question mark on the end and hand the player something to copy. When you do not know what someone wants, you ask an OPEN question — "nak apa?", "macam mana?", "yang mana satu?" — you do not read them the menu.
- Concretely forbidden in \`npc_reply\`: supplying a missing part of the answer ("Kurang manis ke?" when the player never said "kurang manis"); offering the answer as a guess or a question ("Teh tarik ke?", "Nak kurang manis ke?") — a question is still saying it out loud, and it is the commonest way this leaks; naming the target item, phrase or action for them; telling them what to do or say ("Jom order.", "Cuba cakap...", "Kamu patut..."); steering an off-topic answer back to the task by naming the task.
- If the learner asked a QUESTION instead of doing the task, the character simply answers that question the way they really would, in one line, and then leaves the ball with the player — an expectant pause, a "ha?", a look. Answering the question is in character; announcing what the player should have ordered is not.
- **Open by acknowledging what they DID say**, whatever it was — one word of it is enough, and it is what makes the line sound like a person rather than a machine that heard nothing. If they chatted about football, the character reacts to football; if they asked a question, the character answers it; if they mumbled one word, the character repeats that word back. THEN, and only then, let the character's own need surface in an open question. A reply that ignores what was said and jumps straight to "Hah? Nak apa?" is the machine, not the character.
- **Do not invent concrete facts, and do not pre-empt the scene.** Your line is played immediately BEFORE the next scripted NPC line, and that scripted line is what actually delivers this character's information — the floor number, the price, the directions, what is on the tray. When the learner has just asked for something, acknowledge and stall rather than answer — "Oh, ya ya. Jap ya." / "Ha, boleh boleh." / "Ha, kejap." Any floor number, time, price, direction, quantity or name you make up will clash with the line the player hears a second later, and they will believe yours.
- **\`world_facts\` is the ground truth of this scene.** It lists what is actually TRUE here: the floor, the time, who is who, what is on the tray. It is not spoken text and it is not a script — it is there because the SCRIPTED lines later in this scene assert exactly these facts, and an improvised line that says something else gets contradicted out loud a few seconds later, by the same character, in the same voice.
- **A concrete fact may appear in \`npc_reply\` ONLY if it is in \`world_facts\`, or has already been said aloud in \`npc_prompt\` / \`conversation_history\`.** Never invent a floor, a level, a price, a time, a name, a direction, a quantity or a place. Not even a plausible one. If you want a specific and it is not on the list, do not reach for a different one — leave the sentence unspecific.
- **\`world_facts\` is NOT permission to answer for the player.** It never outranks the answer-key rule above. If a fact is also the thing the learner is supposed to produce THIS turn, the character does not say it, however true it is — the whole exercise is the player producing it. A character who is being asked for directions by someone else is not the character who gives them.
- When the learner has just asked this character for something that the NEXT scripted line delivers in full, the right move is still to acknowledge and stall, not to answer early with the correct fact. Getting the fact right one second before the scripted line says it properly is not an improvement; it is the same line twice.
- \`forbidden_phrases\` is the answer-key vocabulary for THIS turn, already worked out for you — the exact phrases that will be CUT out of your line if you use them. Check your finished \`npc_reply\` against that list word by word. If any of them is in it, throw the line away and write a different one; do not patch it. A line that has to be cut reaches the player truncated, and a plainer line that survives whole is always better than a clever one that arrives in pieces.
- Do not fall back on one stock brush-off. The reply should sound like THIS character on THIS turn, coloured by what the player actually said and by the persona's mood — a joke, a grumble, a genuine answer, a raised eyebrow. Vary it.
- Never coach, never grade, never mention scores, language, grammar or "practice", never break character. There is no teacher in this scene.
- When the answer is wrong, vague, off-task, or a question instead of an answer, react like a real person would — puzzled, asking again, mildly impatient, amused, or simply answering the question they were asked — **without supplying the answer**. Someone who catches only half of what was said asks about the half they caught, in their own words, and waits. Ask, wait, react; leave the gap for the player to fill. Build the question out of the learner's OWN words, never out of the words they were supposed to reach.
- Every Malay line quoted in these instructions and in \`npc_persona\` is an ILLUSTRATION of a manner, not a line to reuse. Never emit one of them verbatim, and never borrow a noun from one — write a fresh line in this character's voice for this exact turn.
- **\`npc_reply\` IS WRITTEN ENTIRELY IN NATURAL MALAYSIAN BAHASA MELAYU. This is absolute and applies at LEVEL 1, LEVEL 2 and LEVEL 3 alike, whatever language the coaching is in.** The NPC is a Malaysian speaking to another Malaysian; they would not switch to English.
- The commonest way this goes wrong is an ENGLISH TAIL: a fine Malay sentence with a cheerful English phrase bolted onto the end. Every clause of \`npc_reply\` — including the last one, including the exclamation — is in Malay. Warm sign-offs go in Malay too: "sekejap ya", "jap ya", "nanti saya bawa", "boleh boleh", "takpe takpe", "jom". Before you emit \`npc_reply\`, reread it word by word; if any run of words in it is an English phrase rather than a single borrowed word, rewrite the whole line in Malay.
- The ONLY English permitted anywhere in \`npc_reply\` is a single borrowed word Malaysians genuinely say in everyday Malay speech (\`report\`, \`meeting\`, \`ok\`, \`email\`, \`lift\`) sitting inside an otherwise fully Malay sentence. A borrowed word is one word. Two or more English words in a row is an English clause, and an English clause is forbidden.`;

/**
 * The coaching-language clause spliced into the turn prompt. Level 1 learners
 * are beginners who still read the English hint on screen; coaching them in a
 * language they cannot yet read is the classic mistake. Levels 2 and 3 wean off
 * English exactly as the on-screen hints do (L2 shows task_ms, L3 shows none).
 */
export const TURN_COACHING_LANGUAGE_RULE = Object.freeze({
  en: '- COACHING LANGUAGE — this learner is at LEVEL 1: write `what_worked` and `improvement` in **ENGLISH**. They are a beginner and still read the English hint on screen; Bahasa Melayu coaching would be unreadable to them. You may quote a BM word or phrase inside the English sentence.',
  ms: '- BAHASA COACHING — pelajar ini di LEVEL {level}: tulis `what_worked` dan `improvement` dalam **BAHASA MELAYU**. Guna bahasa Melayu Malaysia yang santai dan mesra — macam kawan yang menyemangatkan, bukan bahasa buku teks. Ayat pendek, perkataan biasa. Jangan tulis dalam bahasa Inggeris, kecuali memetik perkataan Inggeris yang pelajar sendiri sebut.',
});

export const SUMMARY_SYSTEM_PROMPT = `You are the end-of-scenario reviewer for CAKAP LAH!, a Bahasa Melayu speaking-practice game. You have just watched a whole conversation between the learner and an NPC.

- This is NOT an average of the per-turn scores. Judge the exchange as a whole: did the learner recover after a weak turn, did the register hold, would this conversation actually have worked in real life with a real Malaysian?
- The per-turn scores are reference context only. You may score above or below their average and should say why in the summary.
- \`summary\`: 2–3 sentences on how the conversation went as a whole.
- \`strengths\` and \`improvements\`: short concrete phrases, 2 each where possible.
- **Do NOT put "use more Bahasa Melayu" in \`improvements\` unless the learner actually spoke English or Manglish in one of the \`player\` lines.** Check those lines first: if there is no English in them, that advice is false, and it is the last thing the player reads. When the conversation was entirely in BM, find something REAL instead — a more natural word choice, a more idiomatic phrasing, a missing detail, a fuller commitment, better recovery after a wrong turn. There is always something. Never fall back on a reflexive "more BM" note.
{coaching_language}
- \`bm_upgrades\` is the most useful thing on the screen: harvest the CODE-SWITCHES — the English or Manglish words and phrases the learner actually said anywhere in the conversation — and give the natural Bahasa Melayu replacement, as {"you_said": "...", "try": "..."}. Hard rules: \`you_said\` MUST be the English/Manglish the learner really spoke, copied VERBATIM from a \`player\` line in \`conversation\`; \`try\` MUST be Bahasa Melayu; the two sides MUST be different — e.g. {"you_said": "traffic jam", "try": "jalan sesak"}. Read ONLY the \`player\` lines. \`scenario_context\`, \`scenario_title\` and the \`npc\` lines are background for you and were NOT spoken by the learner — never harvest a phrase from them. Before you emit a pair, check that \`you_said\` appears character-for-character inside one of the \`player\` strings; if it does not, drop it. NEVER return a pair whose two sides are the same phrase, never "upgrade" Bahasa Melayu the learner already said (\`{"you_said": "kurang manis", "try": "kurang manis"}\` is exactly the useless output we forbid), and never invent words the learner did not say. If the learner code-switched nowhere, return an empty array — that is a good, correct answer, not a failure.
- Be encouraging and specific. Never mock the learner.
- \`verdict\`: a very short Malaysian-sounding line, e.g. "Dah boleh cakap." — always Malaysian BM, whatever language the coaching is in.`;

/** The coaching-language clause spliced into the summariser prompt. */
export const SUMMARY_COACHING_LANGUAGE_RULE = Object.freeze({
  en: '- COACHING LANGUAGE — this learner is at LEVEL 1: write `summary`, `strengths` and `improvements` in **ENGLISH**. They are a beginner and still read the English hint on screen; Bahasa Melayu coaching would be unreadable to them. `verdict` and the `try` side of `bm_upgrades` stay Bahasa Melayu.',
  ms: '- BAHASA COACHING — pelajar ini di LEVEL {level}: tulis `summary`, `strengths` dan `improvements` dalam **BAHASA MELAYU**. Guna bahasa Melayu Malaysia yang santai dan mesra — macam kawan yang menyemangatkan, bukan bahasa buku teks. Jangan tulis dalam bahasa Inggeris, kecuali memetik perkataan Inggeris yang pelajar sendiri sebut.',
});

/**
 * Splice the level-appropriate coaching-language clause into a system prompt.
 * @param {string} prompt prompt text containing the {coaching_language} slot
 * @param {Object<string,string>} rules TURN_ or SUMMARY_COACHING_LANGUAGE_RULE
 * @param {number|string} level
 */
export function withCoachingLanguage(prompt, rules, level) {
  const lang = coachingLanguage(level);
  return prompt.replace('{coaching_language}', rules[lang].replace('{level}', String(Number(level) || 2)));
}

// ---------------------------------------------------------------------------
// Structured-output schemas
// ---------------------------------------------------------------------------

const scoreProp = { type: 'integer', minimum: 0, maximum: 100 };

export const TURN_SCHEMA = {
  type: 'object',
  properties: {
    // FIRST on purpose. Structured output is generated in property order, so
    // this is the one field the model writes BEFORE any number — one line per
    // `expected_semantics` item, with the comparison spelled out. The scores
    // then have something to be consistent with. Discarded by
    // `validateTurnOutput`: it never reaches the client, it exists to make the
    // model check the meaning instead of eyeballing the phrasing.
    requirement_checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirement: { type: 'string' },
          finding: { type: 'string' },
          verdict: { type: 'string', enum: ['met', 'partly', 'missing'] },
        },
        required: ['requirement', 'finding', 'verdict'],
        additionalProperties: false,
      },
    },
    intent_pass: { type: 'boolean' },
    intent_score: scoreProp,
    semantic_score: scoreProp,
    comprehensibility_score: scoreProp,
    naturalness_score: scoreProp,
    overall_score: scoreProp,
    result: { type: 'string', enum: ['success', 'partial', 'retry'] },
    what_worked: { type: 'string' },
    improvement: { type: 'string' },
    npc_reply: { type: 'string' },
    branch: { type: 'string', enum: ['success', 'partial', 'retry'] },
  },
  required: [
    'requirement_checks',
    'intent_pass',
    'intent_score',
    'semantic_score',
    'comprehensibility_score',
    'naturalness_score',
    'overall_score',
    'result',
    'what_worked',
    'improvement',
    'npc_reply',
    'branch',
  ],
  additionalProperties: false,
};

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    overall_score: scoreProp,
    band: { type: 'string', enum: ['power', 'mission_passed', 'almost', 'retry'] },
    verdict: { type: 'string' },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
    bm_upgrades: {
      type: 'array',
      items: {
        type: 'object',
        properties: { you_said: { type: 'string' }, try: { type: 'string' } },
        required: ['you_said', 'try'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'overall_score',
    'band',
    'verdict',
    'summary',
    'strengths',
    'improvements',
    'bm_upgrades',
  ],
  additionalProperties: false,
};

/** Gemini's responseSchema dialect does not accept additionalProperties. */
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties') continue;
    out[k] = toGeminiSchema(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation — strict; anything off-shape throws so retry/fallback can kick in
// ---------------------------------------------------------------------------

class MalformedOutputError extends Error {}

function requireScore(obj, key) {
  const n = obj[key];
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) {
    throw new MalformedOutputError(`field "${key}" must be a number 0-100 (got ${JSON.stringify(n)})`);
  }
  return Math.round(n);
}

function requireText(obj, key) {
  const s = obj[key];
  if (typeof s !== 'string' || !s.trim()) {
    throw new MalformedOutputError(`field "${key}" must be a non-empty string`);
  }
  return s.trim();
}

/** @throws {MalformedOutputError} */
export function validateTurnOutput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MalformedOutputError('evaluator output is not a JSON object');
  }
  if (typeof raw.intent_pass !== 'boolean') {
    throw new MalformedOutputError('field "intent_pass" must be a boolean');
  }
  return {
    intent_pass: raw.intent_pass,
    intent_score: requireScore(raw, 'intent_score'),
    semantic_score: requireScore(raw, 'semantic_score'),
    comprehensibility_score: requireScore(raw, 'comprehensibility_score'),
    naturalness_score: requireScore(raw, 'naturalness_score'),
    what_worked: requireText(raw, 'what_worked'),
    improvement: requireText(raw, 'improvement'),
    npc_reply: requireText(raw, 'npc_reply'),
  };
}

/**
 * A `bm_upgrades` pair earns its place on the end screen only if it actually
 * teaches something: both sides non-empty AND genuinely different. A live run
 * produced `{"you_said": "kurang manis", "try": "kurang manis"}`, which the UI
 * renders as the same phrase struck through and then repeated — noise on the
 * single most useful panel of the game. The prompt forbids it; this drops it
 * anyway, because the prompt is a request and this is a guarantee.
 *
 * @param {{you_said: string, try: string}} u
 */
export function isUsefulUpgrade(u) {
  const said = normaliseTranscript(u.you_said);
  const tryIt = normaliseTranscript(u.try);
  return Boolean(said) && Boolean(tryIt) && said !== tryIt;
}

// ---------------------------------------------------------------------------
// npc_reply: the answer-key leak filter
// ---------------------------------------------------------------------------
// The per-turn call grades AND speaks, so it must see `task_goal`,
// `expected_semantics`, `sample_answers` and `key_concepts` — and a model that
// has just read the answer key finds it very hard not to say it out loud. The
// live failure was the NPC completing the player's order for them:
//
//   player: "emm... apa ya... teh"  ->  "Eh, teh tarik satu? Kurang manis ke?"
//
// The player never said `kurang manis`. That single line hands over the exact
// words the exercise exists to make them produce, in the NPC's voice, out loud,
// before the coaching panel has said anything. Offering it as a guess ("Nak
// kurang manis ke?") is the same defect with a question mark on it.
//
// The prompt now forbids all of this at length, and that removed most of it —
// but "most" is not a guarantee, and this is the one field the player HEARS.
// So, exactly as with bm_upgrades above: the prompt is a request, and this is
// the guarantee.
//
// The step's own `key_concepts` / `fallback_concepts` ARE the answer-key
// vocabulary, already authored per step in Bahasa Melayu. A phrase from that
// vocabulary is a leak when it appears in `npc_reply` but appears neither in
// what the learner just said nor in what the NPC has already said aloud in
// this scene. Leaked phrases are excised a CLAUSE at a time, so the rest of
// the character's reaction survives; if nothing survives, the character's
// authored re-prompt line is used instead.

/**
 * Excising a middle clause can leave a dangling connective — "Oh, kasut baru?
 * Tapi," — so trim trailing/leading joining words and stray punctuation.
 *
 * The list also covers the ORPHANED VOCATIVE, which is what excision actually
 * leaves behind most often: cutting the body out of "Hah? Macam mana nak pergi
 * ke food court tu, dik?" leaves "Hah? dik?", a term of address attached to
 * nothing. Dropping it gives "Hah?" — shorter, but a real thing a person says,
 * where "Hah? dik?" is visibly a sentence with a hole in it. Only a clause that
 * is ENTIRELY one of these words is ever dropped.
 */
const DANGLING =
  /^(?:tapi|tetapi|dan|atau|jadi|lepas tu|kemudian|ha|oh|dik|nak|bang|abang|kak|makcik|encik|puan|cik|boss|ya|kan|tu|ni|la|lah|eh)[\s,;:.!?]*$/i;

function tidyRebuilt(text) {
  const parts = splitClauses(text).map((c) => c.trim()).filter(Boolean);
  // Trim from the end while the last surviving clause is either a dangling
  // connective/vocative, or a clause that ended on a comma — which means the
  // sentence it opened was the thing that got cut, so what is left is a
  // truncation ("Hah? Nak teh tarik") rather than a sentence. Better to lose
  // it and let the character's authored re-prompt carry the turn.
  while (
    parts.length &&
    (DANGLING.test(parts[parts.length - 1].replace(/[\s,;:.!?]+$/, '')) ||
      /[,;]$/.test(parts[parts.length - 1]))
  ) {
    parts.pop();
  }
  return (
    parts
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,;:.!?])/g, '$1')
      // A comma survives from a clause whose continuation was just cut away, so
      // it now sits in front of a fresh sentence: "Teh tarik, Hah? Nak apa?".
      // Promote it to a full stop.
      .replace(/[,;](\s+[A-Z])/g, '.$1')
      .replace(/[\s,;]+$/, '')
      .trim()
  );
}

/** Clause splitter that keeps the punctuation, so rejoining reads naturally. */
function splitClauses(text) {
  return String(text).match(/[^.?!,;]+[.?!,;]*\s*/g) || [String(text)];
}

/**
 * Bare function words that appear in some steps' `key_concepts` — office_01's
 * `cover_me` lists "boleh", "tak boleh" and "tapi" — but which carry no answer
 * on their own. Banning a one-word conjunction would strip ordinary clauses out
 * of the NPC's mouth and teach the player nothing, so a phrase built ENTIRELY
 * out of this list is never treated as a leak. One content word is enough to
 * ban the whole phrase: "kurang manis" and "tak sempat" stay banned, because
 * `manis` and `sempat` are the answer.
 *
 * This used to apply to single words only, which cost mall_01's Abang Guard
 * the most natural line he has — "encik nak cari apa ya?" — because `nak cari`
 * is a member of the `ask` step's question-word `fallback_concepts` group. That
 * group exists to help the DETERMINISTIC scorer recognise a question; it is not
 * answer-revealing, and stripping the fallback list to suit the leak filter
 * would have cost real recall in the scorer. Widening the rule to whole phrases
 * fixes it in the filter, where the problem actually is: `nak` and `cari` are
 * both function words, so "nak cari" carries nothing — the answer in that step
 * is `food court`, and that stays banned.
 */
const LEAK_STOPWORDS = new Set(
  (
    'boleh tak tidak bukan ada nak mahu hendak kena mesti perlu tolong sila ' +
    'tapi tetapi dan atau pun juga lagi lah kan ke ya ni tu itu ini ' +
    'di kat ke dari pada untuk dengan dalam atas bawah sini situ sana ' +
    'saya awak kamu dia kita kami maaf sorry terima kasih ok okey ' +
    'apa mana macam siapa bila kenapa berapa lepas dah sudah belum je saja sahaja ' +
    // `cari` only ever shows up inside "nak cari" — the generic "looking for"
    // of an open question, never the thing being looked for.
    'cari'
  )
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Every answer-key phrase authored for this step — and for the scenario's other
 * steps too, longest first.
 *
 * Scenario-wide, not step-wide, because the leak crosses steps: at mamak_01's
 * `wrong_order` the NPC offered "Nak kurang manis ke?" to a player who had not
 * said it, and `kurang manis` is the *previous* step's key concept. The answer
 * key for this mission is the whole mission's vocabulary.
 *
 * @param {object} step the step being scored
 * @param {object} [scenario] its scenario, if available
 */
export function answerKeyPhrases(step, scenario) {
  const out = [];
  const steps = Array.isArray(scenario?.steps) && scenario.steps.length ? scenario.steps : [step];
  for (const st of steps) {
    if (!st) continue;
    for (const c of st.key_concepts || []) if (typeof c === 'string') out.push(c);
    for (const group of st.fallback_concepts || []) {
      for (const c of group || []) if (typeof c === 'string') out.push(c);
    }
  }
  return [...new Set(out.map((c) => normaliseTranscript(c)).filter(Boolean))]
    .filter((p) => !p.split(' ').every((w) => LEAK_STOPWORDS.has(w)))
    .sort((a, b) => b.length - a.length);
}

/**
 * Everything already spoken ALOUD in this scene — the learner's own words, the
 * NPC's scripted prompt, and every earlier turn. A phrase from here is fair
 * game to echo: it is not news to the player.
 */
function spokenSoFar({ step, transcript, conversationHistory }) {
  const parts = [transcript || '', step?.tts_prompt || ''];
  for (const turn of conversationHistory || []) {
    if (turn && typeof turn === 'object') parts.push(turn.npc || '', turn.player || '');
  }
  return normaliseTranscript(parts.join(' '));
}

/**
 * The answer-key phrases that would count as a LEAK on this particular turn:
 * the scenario's answer-key vocabulary, minus anything already said aloud.
 *
 * Exported because the same list is now handed to the model in the prompt
 * (`forbidden_phrases`) as well as used to cut its output. The prompt used to
 * ask the model to derive this set for itself from `expected_semantics`,
 * `key_concepts` and `sample_answers`, which it did approximately — roughly
 * three replies in ten tripped the filter and reached the player with a clause
 * excised ("Eh, ini Milo."). Deriving the set ONCE and showing the model the
 * literal phrases is free, and it means the request and the guarantee cannot
 * disagree about what the words are.
 *
 * @param {{step?: object, scenario?: object, transcript?: string, conversationHistory?: Array}} ctx
 * @returns {string[]}
 */
export function bannedPhrasesFor(ctx = {}) {
  const phrases = answerKeyPhrases(ctx.step, ctx.scenario);
  if (!phrases.length) return [];
  const spoken = spokenSoFar(ctx);
  return phrases.filter((p) => !containsPhrase(spoken, p));
}

function containsPhrase(haystackNorm, phraseNorm) {
  return ` ${haystackNorm} `.includes(` ${phraseNorm} `);
}

/**
 * Strip answer-key vocabulary the learner never said out of `npc_reply`.
 *
 * @param {string} reply the model's npc_reply
 * @param {{step?: object, scenario?: object, transcript?: string, conversationHistory?: Array, fallbackLine?: string}} ctx
 * @returns {{reply: string, leaked: string[]}}
 */
export function stripAnswerKeyLeak(reply, ctx = {}) {
  const { fallbackLine } = ctx;
  const banned = bannedPhrasesFor(ctx);
  if (!banned.length) return { reply, leaked: [] };

  const leaked = [];
  const kept = [];
  for (const clause of splitClauses(reply)) {
    const norm = normaliseTranscript(clause);
    const hit = banned.find((p) => containsPhrase(norm, p));
    if (hit) leaked.push(hit);
    else kept.push(clause);
  }
  if (!leaked.length) return { reply, leaked: [] };

  const rebuilt = tidyRebuilt(kept.join(''));
  // A rebuilt line must still be a line. Cutting the middle out of "Wayang?
  // Report tu belum siap ke?" leaves "Wayang? kan?", which is worse than
  // saying nothing — so anything shorter than three words is discarded in
  // favour of the character's authored re-prompt.
  const usable = normaliseTranscript(rebuilt).split(' ').filter(Boolean).length >= 3 ? rebuilt : '';
  return { reply: usable || fallbackLine || DEFAULT_REPROMPT, leaked };
}

/** Last-resort in-character re-prompt when a whole reply was answer key. */
export const DEFAULT_REPROMPT = 'Hah? Macam mana tu? Cuba cakap sekali lagi.';

// ---------------------------------------------------------------------------
// bm_upgrades: the code-switch filter
// ---------------------------------------------------------------------------
// The identical-pair guard above was not enough. The next live run produced
// {"you_said": "kurang manis", "try": "tidak manis"} — Malay "upgraded" to
// Malay — in 3 runs out of 4. The panel exists to harvest CODE-SWITCHES: the
// English or Manglish the learner actually spoke, swapped for natural BM.
// Malay-to-Malay is not an upgrade, it is a correction the learner did not ask
// for and usually did not need.
//
// The prompt has now been sharpened twice and failed twice, so the guarantee
// lives in code. Three gates, all of which a pair must pass:
//   1. the two sides differ (isUsefulUpgrade, above);
//   2. `you_said` really appears inside one of the learner's own `player`
//      lines — nothing harvested from the scenario, the NPC, or thin air;
//   3. `you_said` actually contains English.
//
// Gate 3 has no language-detection library available (no new dependencies), so
// it is deliberately ASYMMETRIC: a token counts as English only when we can
// positively say so, and everything unrecognised is treated as Malay and
// dropped. Dropping a real upgrade costs nothing — an empty list already
// renders as the clean positive "no code-switching found" — while showing a
// nonsense one is the defect we are fixing.

/**
 * Common Bahasa Melayu words, checked FIRST so that anything Malay is settled
 * as Malay before any English test runs. Includes the words that are spelled
 * or sound like English ones (`am`, `kan`, `ok`, `sorry`) precisely so those
 * never trip the English check.
 */
const BM_WORDS = new Set(
  (
    'saya aku kami kita anda awak kamu dia mereka nya ku mu ini itu sini situ sana ' +
    'yang dan atau tapi tetapi dengan untuk pada dari daripada ke kepada di dalam luar ' +
    'atas bawah depan belakang antara sebelum selepas semasa sambil kerana sebab jadi ' +
    'kalau jika bila macam mana apa siapa kenapa mengapa berapa bagaimana ' +
    'ada tiada tak tidak bukan belum sudah dah masih lagi pun juga sahaja saja je jer ' +
    'boleh nak mahu hendak kena mesti perlu patut cuba tolong sila jom mari ' +
    'buat bikin ambil bagi beri hantar terima pergi datang balik keluar masuk duduk ' +
    'berdiri jalan lari makan minum tidur bangun tengok lihat dengar cakap kata beritahu ' +
    'tanya jawab faham tahu ingat lupa rasa fikir suka sayang benci marah takut gembira ' +
    'sedih penat letih sakit sihat baik elok bagus cantik buruk besar kecil panjang pendek ' +
    'tinggi rendah banyak sikit sedikit ramai kurang lebih paling sangat amat betul salah ' +
    'benar sama beza lain baru lama cepat laju lambat awal lewat mula habis siap selesai ' +
    'sedang tengah nanti sekarang tadi semalam esok lusa hari malam pagi petang siang ' +
    'tengahari minggu bulan tahun jam pukul masa waktu kali sekali dua tiga empat lima ' +
    'enam tujuh lapan sembilan sepuluh satu se puluh ratus ribu setengah suku ' +
    'manis masin pedas tawar sejuk panas hangat air teh kopi susu gula ais nasi mee ' +
    'roti telur ayam ikan daging sayur buah pinggan gelas meja kerusi kedai pasar ' +
    'rumah bilik pejabat kereta bas motor jalan lorong simpang lampu duit ringgit harga ' +
    'murah mahal beli jual bayar tukar baki resit troli barang saiz warna ' +
    'kak abang encik puan cik tuan bang boss kawan orang budak anak emak ayah ' +
    'maaf sorry terima kasih selamat khabar ok okey ya ' +
    'lah la kan ke pun deh woi wei eh ha oh alamak aiyo ' +
    'kerja tugas laporan mesyuarat surat emel telefon nombor nama alamat ' +
    'sempat siapkan sambung separuh tinggal terus dulu kemudian akhir ' +
    'am kah tah pula punya seorang sebuah sekejap kejap ' +
    // `confirm` and `sorry` are said as Malay words in everyday Malaysian
    // speech; they are not teachable code-switches, so they count as BM here.
    'confirm'
  )
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * English words a Malaysian learner plausibly code-switches into. Checked only
 * after BM_WORDS, so overlaps resolve as Malay.
 */
const ENGLISH_WORDS = new Set(
  (
    'a an the i you he she it we they me him her us them my your his their our its ' +
    'is am are was were be been being do does did doing done have has had having ' +
    'will would can could shall should may might must not no yes ok okay ' +
    'and or but so because if when while then than that this these those there here ' +
    'of to in on at for with from by about into over under after before during ' +
    'want need like love hate know think feel say said tell told ask asked give gave ' +
    'take took get got go going went come came make made let put keep help try ' +
    'send sent bring brought find found buy bought pay paid change wait waited ' +
    'finish finished start started stop stopped work working meet meeting ' +
    'sorry please thanks thank welcome sure fine good bad nice great very really ' +
    'more less too much many little bit small big long short high low early late ' +
    'fast slow now later today tomorrow yesterday morning afternoon evening night ' +
    'time day week month year hour minute clock oclock ' +
    'sweet salty spicy hot cold ice water tea coffee milk sugar rice noodles bread ' +
    'egg chicken fish meat vegetable fruit plate glass table chair shop market ' +
    'house room office car bus road street traffic jam money price cheap expensive ' +
    'boss friend people kid child mother father sir madam ' +
    'report email phone number name address file document deadline ' +
    'actually maybe already still just also only again around almost sort kind ' +
    'problem trouble issue question answer thing stuff way ' +
    // -ing forms and particles: Malay has plenty of its own -ing words
    // (kucing, pusing, daging), so these are listed rather than pattern-matched
    'coming going doing making taking getting looking waiting sending calling ' +
    'right left up down out off back away over here everything something anything ' +
    'nothing everyone someone anyone hurry ready busy okay alright ' +
    'one two three four five six seven eight nine ten first second half quarter ' +
    'excuse hello hi bye goodbye yeah yep nope where what who why how which whose ' +
    'because since until unless though although whether either neither both each ' +
    'every all some any none other another same different next last own such ' +
    'order bill receipt change table takeaway packet pack cup bottle piece slice ' +
    'straight turn left right upstairs downstairs floor level lift escalator ' +
    'counter service customer refund exchange size colour color receipt ' +
    'confirm cancel book booking appointment schedule reschedule delay late leave'
  )
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Spelling shapes that occur in English and effectively never in Malay Rumi:
 * the digraphs Malay writes differently (`sy` for sh, `f` for ph, `t` for th),
 * the `-tion`/`-sion` endings, and word-final consonant clusters, which Malay
 * phonotactics do not allow. Deliberately narrow — a miss just drops a pair.
 */
const ENGLISH_SHAPES = [
  /th/,
  /ck/,
  /ph/,
  /sh/,
  /wh/,
  /oo/,
  /x/,
  /(?:tion|sion)$/,
  // final cluster, minus the clusters Malay does write: ng, ny, sy, kh
  /(?!ng$|ny$|sy$|kh$|nk$)[bcdfgjklmpqstvwxz][bcdfgjklmnpqrstvwxz]$/,
];

/** @param {string} token a single normalised (lowercase, punctuation-free) word */
function isEnglishToken(token, bmContext) {
  if (!token) return false;
  if (BM_WORDS.has(token)) return false;
  // A word the NPC used is Bahasa Melayu by construction — the NPC speaks BM.
  if (bmContext.has(token)) return false;
  if (ENGLISH_WORDS.has(token)) return true;
  return ENGLISH_SHAPES.some((re) => re.test(token));
}

function tokens(text) {
  return normaliseTranscript(text).split(' ').filter(Boolean);
}

/**
 * Does `phrase` contain at least one token we can positively call English?
 * `bmContext` is the Bahasa Melayu already present in the conversation (the NPC
 * lines), used as extra evidence that a token is Malay.
 *
 * @param {string} phrase
 * @param {Set<string>} [bmContext]
 */
export function containsEnglish(phrase, bmContext = new Set()) {
  return tokens(phrase).some((t) => isEnglishToken(t, bmContext));
}

/** The Bahasa Melayu vocabulary of a conversation: every word the NPC spoke. */
export function bmContextFrom(conversation) {
  const set = new Set();
  for (const turn of Array.isArray(conversation) ? conversation : []) {
    if (turn && typeof turn.npc === 'string') for (const t of tokens(turn.npc)) set.add(t);
  }
  return set;
}

/**
 * Keep only `bm_upgrades` pairs that teach a real code-switch.
 *
 * @param {Array<{you_said: string, try: string}>} upgrades
 * @param {Array<{npc?: string, player?: string}>} conversation the learner's own
 *   turns; when absent (unit tests of the shape alone) the verbatim gate is
 *   skipped and only the English gate applies.
 */
export function filterUpgrades(upgrades, conversation) {
  const list = Array.isArray(upgrades) ? upgrades : [];
  const turns = Array.isArray(conversation) ? conversation : [];
  const playerLines = turns
    .filter((t) => t && typeof t.player === 'string')
    .map((t) => normaliseTranscript(t.player))
    .filter(Boolean);
  const bmContext = bmContextFrom(turns);

  return list.filter((u) => {
    if (!isUsefulUpgrade(u)) return false;
    const said = normaliseTranscript(u.you_said);
    // Gate 2 — the learner must actually have said it. Only enforced when we
    // were given the conversation to check against.
    if (playerLines.length && !playerLines.some((line) => line.includes(said))) return false;
    // Gate 3 — and it must be English, not Malay dressed up as an upgrade.
    if (!containsEnglish(said, bmContext)) return false;
    return true;
  });
}

/**
 * @param {object} raw the model's summary object
 * @param {Array<{npc?: string, player?: string}>} [conversation] the real
 *   conversation, used to check `bm_upgrades` against what was actually said
 * @throws {MalformedOutputError}
 */
export function validateSummaryOutput(raw, conversation) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MalformedOutputError('summariser output is not a JSON object');
  }
  const strings = (v) =>
    Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];

  const upgrades = Array.isArray(raw.bm_upgrades)
    ? filterUpgrades(
        raw.bm_upgrades
          .filter((u) => u && typeof u.you_said === 'string' && typeof u.try === 'string')
          .map((u) => ({ you_said: u.you_said.trim(), try: u.try.trim() })),
        conversation,
      )
    : null;
  if (upgrades === null) throw new MalformedOutputError('field "bm_upgrades" must be an array');

  return {
    overall_score: requireScore(raw, 'overall_score'),
    verdict: requireText(raw, 'verdict'),
    summary: requireText(raw, 'summary'),
    strengths: strings(raw.strengths),
    improvements: strings(raw.improvements),
    bm_upgrades: upgrades,
  };
}

// ---------------------------------------------------------------------------
// Provider calls (global fetch only — no SDK dependency)
// ---------------------------------------------------------------------------

function parseJsonStrict(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new MalformedOutputError(`model did not return valid JSON: ${err.message}`);
  }
}

/**
 * Evaluation temperature. Was 0.3, which made the SAME transcript on the SAME
 * step swing wildly between runs — one acceptance pass scored "Petang ni lah
 * kak." 58 and another scored it 1. A grader that disagrees with itself by 57
 * points is not making a judgement call, it is emitting noise, and the learner
 * has no way to tell the two apart. Grading is a deterministic job: pin it to 0
 * and let the (now explicit) axis definitions decide the number.
 */
export const EVAL_TEMPERATURE = 0;

async function callOpenAI({ system, user, schema, schemaName, temperature = EVAL_TEMPERATURE }) {
  const res = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${llmApiKey()}`,
    },
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new MalformedOutputError('OpenAI returned no message content');
  return parseJsonStrict(text);
}

async function callGemini({ system, user, schema, temperature = EVAL_TEMPERATURE }) {
  // The key goes in a header, never in the query string: URLs end up in proxy
  // and access logs, request headers do not.
  const url = `${GEMINI_BASE_URL}/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': llmApiKey(),
    },
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(user) }] }],
      generationConfig: {
        temperature,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  if (!text) throw new MalformedOutputError('Gemini returned no candidate text');
  return parseJsonStrict(text);
}

function callProvider(args) {
  return LLM_PROVIDER === 'gemini' ? callGemini(args) : callOpenAI(args);
}

// ---------------------------------------------------------------------------
// Consecutive-fallback alarm
// ---------------------------------------------------------------------------
// A rejected key or a wrong LLM_PROVIDER used to be completely silent: every
// turn quietly returned the deterministic fallback's flat scores and generic
// coaching, i.e. a working-but-lobotomised demo. Warn loudly once a streak of
// fallbacks builds up, and again on every further multiple of the threshold.

/** Consecutive fallbacks tolerated before the loud warning fires. */
export const FALLBACK_WARN_THRESHOLD = 3;

let consecutiveFallbacks = 0;

/** Record one evaluator/summariser fallback; warns on a sustained streak. */
export function noteEvaluatorFallback(reason = 'unknown') {
  consecutiveFallbacks += 1;
  if (consecutiveFallbacks % FALLBACK_WARN_THRESHOLD === 0) {
    console.warn(
      `\n*** [evaluator] WARNING: the evaluator has fallen back ${consecutiveFallbacks} times in a row ` +
        `(latest reason: ${reason}). Learners are getting flat fallback scores and generic coaching. ` +
        `Check LLM_PROVIDER (currently "${LLM_PROVIDER}") and the matching API key. ***\n`,
    );
  }
  return consecutiveFallbacks;
}

/** Record a real LLM success; clears the streak. */
export function noteEvaluatorSuccess() {
  consecutiveFallbacks = 0;
}

/** Test/introspection helper. */
export function consecutiveFallbackCount() {
  return consecutiveFallbacks;
}

/** Test helper — reset the streak counter. */
export function resetFallbackStreak() {
  consecutiveFallbacks = 0;
}

let warnedNoKey = false;
function noKey() {
  if (!hasLlmKey()) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn(
        `[evaluator] no API key for LLM_PROVIDER=${LLM_PROVIDER} — using the deterministic fallback scorer for every turn.`,
      );
    }
    return true;
  }
  return false;
}

/**
 * Call the provider, validate, retry ONCE on malformed output or transport
 * error. Returns null when both attempts failed (caller falls back).
 */
async function attemptWithRetry({ system, user, schema, schemaName, validate, label }) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await callProvider({ system, user, schema, schemaName });
      return validate(raw);
    } catch (err) {
      const kind = err instanceof MalformedOutputError ? 'malformed output' : 'upstream error';
      console.warn(`[evaluator] ${label} attempt ${attempt}/2 failed (${kind}): ${err.message}`);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Per-turn evaluation. Returns unweighted axis scores + coaching text; the
 * route recomputes overall/result/branch itself and never trusts the model.
 *
 * @param {{
 *   scenario: object, step: object, level: number, levelConfig: object,
 *   transcript: string, sttConfidence?: number|null,
 *   conversationHistory: Array<{npc?: string, player?: string}>,
 *   forceMalformed?: boolean, forceUpstreamError?: boolean
 * }} input
 */
export async function evaluate(input = {}) {
  const { scenario, step, level, levelConfig: cfg, transcript, sttConfidence, conversationHistory } =
    input;

  if (input.forceUpstreamError) {
    throw new Error('Simulated evaluator upstream failure (fail=eval).');
  }

  // ?fail=json — the model returns garbage twice, exercising retry-then-fallback.
  if (input.forceMalformed) {
    console.warn('[evaluator] forced malformed output (fail=json): attempt 1/2 failed');
    console.warn('[evaluator] forced malformed output (fail=json): attempt 2/2 failed');
    noteEvaluatorFallback('malformed_output');
    return fallbackEvaluate({ step, transcript, level, reason: 'malformed_output' });
  }

  if (noKey()) {
    noteEvaluatorFallback('no_api_key');
    return fallbackEvaluate({ step, transcript, level, reason: 'no_api_key' });
  }

  const system = withCoachingLanguage(
    TURN_SYSTEM_PROMPT.replace('{allowed_code_switch}', cfg?.allowed_code_switch || 'intermediate'),
    TURN_COACHING_LANGUAGE_RULE,
    level,
  );

  const user = {
    scenario_id: scenario?.id,
    level: Number(level),
    allowed_code_switch: cfg?.allowed_code_switch,
    scenario_context: scenario?.context,
    // Character notes for `npc_reply` only. Step-level overrides the scenario
    // default, exactly like npc_name / voice_id / portrait, so mall_01's L3
    // hand-off to Makcik changes who is speaking as well as how they sound.
    npc_name: step?.npc_name || scenario?.npc_name,
    npc_persona: step?.npc_persona || scenario?.npc_persona || null,
    npc_prompt: step?.tts_prompt,
    // The concrete truths of the scene, so an improvised line cannot contradict
    // the scripted one that plays a second after it. Step-level overrides the
    // scenario default, like the other per-step NPC fields.
    world_facts: step?.world_facts || scenario?.world_facts || [],
    // The answer-key vocabulary this turn, computed by the same code that will
    // cut the reply if it is used — so the model is asked for exactly what the
    // filter enforces, instead of being asked to derive it and cut afterwards.
    forbidden_phrases: bannedPhrasesFor({ step, scenario, transcript, conversationHistory }),
    task_goal: step?.task_en,
    expected_semantics: step?.expected_semantics || [],
    sample_answers: step?.sample_answers || [],
    coaching_language: coachingLanguage(level) === 'en' ? 'english' : 'bahasa_melayu',
    stt_transcript: transcript,
    stt_confidence: sttConfidence ?? null,
    conversation_history: conversationHistory || [],
  };

  const ok = await attemptWithRetry({
    system,
    user,
    schema: TURN_SCHEMA,
    schemaName: 'cakap_lah_turn_evaluation',
    validate: validateTurnOutput,
    label: 'evaluate',
  });

  if (!ok) {
    noteEvaluatorFallback('llm_failed');
    return fallbackEvaluate({ step, transcript, level, reason: 'llm_failed' });
  }
  noteEvaluatorSuccess();

  // The prompt forbids the NPC from speaking the answer key; this guarantees it.
  const { reply, leaked } = stripAnswerKeyLeak(ok.npc_reply, {
    step,
    scenario,
    transcript,
    conversationHistory,
    fallbackLine: step?.npc_reprompt || scenario?.npc_reprompt,
  });
  if (leaked.length) {
    console.warn(
      `[evaluator] npc_reply leaked answer-key phrase(s) ${JSON.stringify(leaked)} — excised`,
    );
  }
  return { ...ok, npc_reply: reply, source: 'llm', fallback: false };
}

/**
 * Whole-conversation summary — a second LLM call, not an average of turns.
 *
 * @param {{
 *   scenario: object, level: number, levelConfig: object,
 *   conversation: Array<{npc?: string, player?: string}>,
 *   turnScores: Array<object|number>,
 *   forceMalformed?: boolean, forceUpstreamError?: boolean
 * }} input
 */
export async function summarise(input = {}) {
  const { scenario, level, levelConfig: cfg, conversation, turnScores } = input;

  if (input.forceUpstreamError) {
    throw new Error('Simulated summariser upstream failure (fail=eval).');
  }

  if (input.forceMalformed) {
    console.warn('[evaluator] forced malformed output (fail=json): attempt 1/2 failed');
    console.warn('[evaluator] forced malformed output (fail=json): attempt 2/2 failed');
    noteEvaluatorFallback('malformed_output');
    return fallbackSummarise({ turnScores, level, reason: 'malformed_output' });
  }

  if (noKey()) {
    noteEvaluatorFallback('no_api_key');
    return fallbackSummarise({ turnScores, level, reason: 'no_api_key' });
  }

  const user = {
    scenario_id: scenario?.id,
    scenario_title: scenario?.title,
    scenario_context: scenario?.context,
    npc_name: scenario?.npc_name,
    level: Number(level),
    allowed_code_switch: cfg?.allowed_code_switch,
    coaching_language: coachingLanguage(level) === 'en' ? 'english' : 'bahasa_melayu',
    conversation: conversation || [],
    turn_scores: turnScores || [],
  };

  const ok = await attemptWithRetry({
    system: withCoachingLanguage(SUMMARY_SYSTEM_PROMPT, SUMMARY_COACHING_LANGUAGE_RULE, level),
    user,
    schema: SUMMARY_SCHEMA,
    schemaName: 'cakap_lah_conversation_summary',
    validate: (raw) => validateSummaryOutput(raw, conversation),
    label: 'summarise',
  });

  if (!ok) {
    noteEvaluatorFallback('llm_failed');
    return fallbackSummarise({ turnScores, level, reason: 'llm_failed' });
  }
  noteEvaluatorSuccess();
  return { ...ok, source: 'llm', fallback: false };
}
