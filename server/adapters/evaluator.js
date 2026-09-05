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

## THE REST OF THE RULES

- Never require exact wording. \`sample_answers\` illustrate the *range* of acceptable answers — they are NOT a match list, and an answer unlike all of them can still score 100.
- Judge meaning and task completion first; grammar last.
- The transcript is from speech recognition. Spelling/punctuation artifacts are not the learner's fault.
- Code-switch policy is \`{allowed_code_switch}\`: **beginner** — Manglish **passes** if the task is done; offer the BM replacement as coaching, never failure. **intermediate** — may pass; reduce \`naturalness_score\` where a normal BM alternative exists. **advanced** — expect predominantly BM except proper nouns and technical terms. This axis is about *how much BM*, not formality. **Never penalise casual register.**
- Be encouraging. Never mock the learner. Humour targets the situation, never the person.
- \`what_worked\` / \`improvement\`: ONE short sentence each.
- \`improvement\` MUST be about something the learner ACTUALLY DID in \`stt_transcript\` — a real word they chose, a phrase that would sound more natural another way, a piece of the task they left out, a detail they could have been more specific about. Ground it in their sentence; quote or refer to the actual words where you can.
- **Do NOT tell a learner to "use more Bahasa Melayu" unless they actually spoke English or Manglish in \`stt_transcript\`.** Check the transcript first: if there is no English in it, that advice is false and it is the single line the player reads. When the learner spoke entirely in BM, find something REAL to say instead — a more natural word choice, a more idiomatic phrasing, a missing detail, a fuller commitment, a smoother way to open or close the sentence. There is always something. Never fall back on a reflexive "more BM" note.
{coaching_language}
- \`npc_reply\`: in character, 1–2 sentences, reacting to what the learner **actually said**.
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
    npc_prompt: step?.tts_prompt,
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
  return { ...ok, source: 'llm', fallback: false };
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
