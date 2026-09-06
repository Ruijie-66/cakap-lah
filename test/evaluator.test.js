import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateTurnOutput,
  validateSummaryOutput,
  TURN_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  TURN_SCHEMA,
  SUMMARY_SCHEMA,
  evaluate as liveEvaluate,
  summarise as liveSummarise,
  TURN_COACHING_LANGUAGE_RULE,
  SUMMARY_COACHING_LANGUAGE_RULE,
  withCoachingLanguage,
  isUsefulUpgrade,
  answerKeyPhrases,
  bannedPhrasesFor,
  stripAnswerKeyLeak,
  DEFAULT_REPROMPT,
  filterUpgrades,
  containsEnglish,
  EVAL_TEMPERATURE,
} from '../server/adapters/evaluator.js';
import * as mock from '../server/adapters/mock.js';
import { getScenario, publicScenario, ANSWER_KEY_FIELDS } from '../server/game/scenarios.js';
import { findStep } from '../server/game/branching.js';
import { computeOverall, PARTIAL_BAND } from '../server/game/scoring.js';
import { hasLlmKey, LLM_PROVIDER } from '../server/config.js';

// These two assertions describe the "no key configured" branch. When the
// developer running the suite DOES have a key in .env we skip them rather than
// make a real network call from a unit test.
const skipIfKey = hasLlmKey()
  ? { skip: `LLM_PROVIDER=${LLM_PROVIDER} has a key configured` }
  : {};

const scenario = getScenario('mamak_01');
const step = findStep(scenario, 'order');

const GOOD_TURN = {
  intent_pass: true,
  intent_score: 92,
  semantic_score: 88,
  comprehensibility_score: 90,
  naturalness_score: 82,
  overall_score: 12345, // deliberately wrong — the server recomputes
  result: 'nonsense',
  what_worked: 'Jelas.',
  improvement: 'Tambah "boleh".',
  npc_reply: 'Ok boss.',
  branch: 'success',
};

test('validateTurnOutput accepts a well-formed object and normalises it', () => {
  const out = validateTurnOutput(GOOD_TURN);
  assert.equal(out.intent_score, 92);
  assert.equal(out.npc_reply, 'Ok boss.');
  assert.equal(computeOverall(out), 89); // recomputed, not the model's 12345
  assert.equal('overall_score' in out, false, 'model arithmetic is discarded');
});

test('validateTurnOutput rejects malformed output', () => {
  const bad = [
    null,
    'not an object',
    [],
    { ...GOOD_TURN, intent_pass: 'yes' },
    { ...GOOD_TURN, intent_score: 'high' },
    { ...GOOD_TURN, semantic_score: 140 },
    { ...GOOD_TURN, naturalness_score: NaN },
    { ...GOOD_TURN, npc_reply: '' },
    (() => { const o = { ...GOOD_TURN }; delete o.what_worked; return o; })(),
  ];
  for (const b of bad) assert.throws(() => validateTurnOutput(b), `should reject ${JSON.stringify(b)}`);
});

test('validateSummaryOutput accepts and filters', () => {
  const out = validateSummaryOutput({
    overall_score: 84,
    band: 'mission_passed',
    verdict: 'Dah boleh cakap.',
    summary: 'Bagus.',
    strengths: ['a', '', 3],
    improvements: ['b'],
    bm_upgrades: [{ you_said: 'less sweet', try: 'kurang manis' }, { bogus: 1 }],
  });
  assert.deepEqual(out.strengths, ['a']);
  assert.deepEqual(out.bm_upgrades, [{ you_said: 'less sweet', try: 'kurang manis' }]);
});

test('validateSummaryOutput rejects a missing bm_upgrades array', () => {
  assert.throws(() =>
    validateSummaryOutput({ overall_score: 80, verdict: 'x', summary: 'y', strengths: [], improvements: [] }),
  );
});

test('prompts carry the required rules verbatim', () => {
  assert.match(TURN_SYSTEM_PROMPT, /Never require exact wording/);
  assert.match(TURN_SYSTEM_PROMPT, /\{allowed_code_switch\}/);
  assert.match(TURN_SYSTEM_PROMPT, /Never penalise casual register/);
  assert.match(TURN_SYSTEM_PROMPT, /1–2 sentences/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /bm_upgrades/);
  assert.match(SUMMARY_SYSTEM_PROMPT, /NOT an average/);
});

test('structured-output schemas require every field', () => {
  assert.equal(TURN_SCHEMA.additionalProperties, false);
  assert.equal(TURN_SCHEMA.required.length, Object.keys(TURN_SCHEMA.properties).length);
  assert.equal(SUMMARY_SCHEMA.required.length, Object.keys(SUMMARY_SCHEMA.properties).length);
});

test('live evaluator with no API key falls back deterministically instead of throwing', skipIfKey, async () => {
  const out = await liveEvaluate({
    scenario,
    step,
    level: 1,
    levelConfig: { allowed_code_switch: 'beginner' },
    transcript: 'teh tarik satu kurang manis',
    conversationHistory: [],
  });
  assert.equal(out.fallback, true);
  assert.equal(out.fallback_reason, 'no_api_key');
  const overall = computeOverall(out);
  assert.ok(overall >= PARTIAL_BAND.min && overall <= PARTIAL_BAND.max);
});

test('forceMalformed (?fail=json) retries then falls back, in both adapters', async () => {
  for (const adapter of [liveEvaluate, mock.evaluate]) {
    const out = await adapter({
      scenario,
      step,
      level: 1,
      levelConfig: { allowed_code_switch: 'beginner' },
      transcript: 'teh tarik satu kurang manis',
      conversationHistory: [],
      forceMalformed: true,
    });
    assert.equal(out.fallback, true);
    assert.equal(out.fallback_reason, 'malformed_output');
    const overall = computeOverall(out);
    assert.ok(overall >= PARTIAL_BAND.min && overall <= PARTIAL_BAND.max, 'never penalised');
  }
});

// The ADAPTER still throws on ?fail=eval; the route no longer turns that into a
// 502 — it degrades to the deterministic fallback (see test/routes.test.js).
test('forceUpstreamError (?fail=eval) throws out of the adapter', async () => {
  await assert.rejects(() => mock.evaluate({ step, transcript: 'x', forceUpstreamError: true }));
  await assert.rejects(() => liveEvaluate({ step, transcript: 'x', forceUpstreamError: true }));
});

test('mock evaluate is varied — not always success', async () => {
  const transcripts = [
    'saya nak teh tarik satu kurang manis',
    'boleh bagi teh tarik kurang gula',
    'teh tarik satu bang jangan manis sangat',
    'bang saya nak minum teh',
    'eh sorry saya order teh tarik tadi bukan milo',
    'nak teh tarik less sweet please',
    'satu teh tarik ya',
    'apa ni',
  ];
  const results = new Set();
  for (const t of transcripts) {
    const out = await mock.evaluate({ step, transcript: t });
    results.add(out.intent_pass ? 'success-ish' : 'not-success');
  }
  assert.ok(results.size > 1, 'mock should not always return the same result');
});

test('mock summarise returns bm_upgrades harvested across the conversation', async () => {
  const out = await mock.summarise({
    conversation: [
      { npc: 'Ya boss, nak minum apa?', player: 'teh tarik one, less sweet' },
      { npc: 'Ni dia! Milo ais satu.', player: 'sorry bang, I order teh tarik' },
    ],
    turnScores: [{ overall_score: 70 }, { overall_score: 88 }],
  });
  assert.ok(Array.isArray(out.bm_upgrades));
  assert.ok(out.bm_upgrades.some((u) => u.try === 'kurang manis'));
  assert.equal(Number.isFinite(out.overall_score), true);
});

test('live summarise with no key falls back with an empty bm_upgrades array', skipIfKey, async () => {
  const out = await liveSummarise({ scenario, level: 1, conversation: [], turnScores: [{ overall_score: 80 }] });
  assert.equal(out.fallback, true);
  assert.deepEqual(out.bm_upgrades, []);
});

test('publicScenario strips every answer-key field at every level', () => {
  for (const id of ['mamak_01', 'mall_01', 'office_01']) {
    for (const level of [1, 2, 3]) {
      const pub = publicScenario(getScenario(id), level);
      const json = JSON.stringify(pub);
      for (const field of ANSWER_KEY_FIELDS) {
        assert.ok(!json.includes(field), `${id} L${level} leaks ${field}`);
      }
      for (const s of pub.steps) {
        assert.ok(s.npc_name && s.voice_id, 'per-step npc overrides resolved');
      }
    }
  }
});

test('publicScenario resolves the mall_01 makcik step override at L3', () => {
  const pub = publicScenario(getScenario('mall_01'), 3);
  const last = pub.steps[pub.steps.length - 1];
  assert.equal(last.id, 'give_directions');
  assert.equal(last.npc_name, 'Makcik');
  assert.notEqual(last.voice_id, pub.voice_id);
});

// --- Fix 1: coaching language follows the level ----------------------------

test('the coaching-language slot is spliced with the ENGLISH rule at L1', () => {
  for (const [prompt, rules] of [
    [TURN_SYSTEM_PROMPT, TURN_COACHING_LANGUAGE_RULE],
    [SUMMARY_SYSTEM_PROMPT, SUMMARY_COACHING_LANGUAGE_RULE],
  ]) {
    assert.ok(prompt.includes('{coaching_language}'), 'prompt has the slot');
    const l1 = withCoachingLanguage(prompt, rules, 1);
    assert.ok(!l1.includes('{coaching_language}'), 'slot filled at L1');
    assert.ok(/\*\*ENGLISH\*\*/.test(l1), 'L1 asks for English coaching');
    assert.ok(!/\*\*BAHASA MELAYU\*\*/.test(l1));

    for (const level of [2, 3]) {
      const out = withCoachingLanguage(prompt, rules, level);
      assert.ok(!out.includes('{coaching_language}'), `slot filled at L${level}`);
      assert.ok(/\*\*BAHASA MELAYU\*\*/.test(out), `L${level} asks for BM coaching`);
      assert.ok(out.includes(`LEVEL ${level}`), 'the level is named in the rule');
      assert.ok(!/\*\*ENGLISH\*\*/.test(out));
    }
  }
});

test('npc_reply is pinned to Bahasa Melayu at every level in the turn prompt', () => {
  for (const level of [1, 2, 3]) {
    const p = withCoachingLanguage(TURN_SYSTEM_PROMPT, TURN_COACHING_LANGUAGE_RULE, level);
    assert.ok(
      /`npc_reply` IS WRITTEN ENTIRELY IN NATURAL MALAYSIAN BAHASA MELAYU/.test(p),
      `L${level} pins npc_reply to BM`,
    );
    assert.ok(
      /LEVEL 1, LEVEL 2 and LEVEL 3 alike/.test(p),
      `L${level} says the BM rule applies at every level`,
    );
    assert.ok(/ENGLISH TAIL/.test(p), `L${level} names the observed English-tail failure`);
    assert.ok(
      /Two or more English words in a row is an English clause/.test(p),
      `L${level} draws the borrowed-word line`,
    );
  }
});

// --- Fix 2: bm_upgrades must never be an identical pair ---------------------

test('isUsefulUpgrade rejects identical pairs modulo case, punctuation, whitespace', () => {
  assert.equal(isUsefulUpgrade({ you_said: 'less sweet', try: 'kurang manis' }), true);
  assert.equal(isUsefulUpgrade({ you_said: 'kurang manis', try: 'kurang manis' }), false);
  assert.equal(isUsefulUpgrade({ you_said: 'Kurang Manis!', try: 'kurang  manis' }), false);
  assert.equal(isUsefulUpgrade({ you_said: '  ', try: 'kurang manis' }), false);
  assert.equal(isUsefulUpgrade({ you_said: 'less sweet', try: '' }), false);
});

const GOOD_SUMMARY = {
  overall_score: 84,
  band: 'mission_passed',
  verdict: 'Dah boleh cakap.',
  summary: 'Bagus.',
  strengths: ['a'],
  improvements: ['b'],
  bm_upgrades: [],
};

test('validateSummaryOutput drops useless bm_upgrades pairs but keeps real ones', () => {
  const out = validateSummaryOutput({
    ...GOOD_SUMMARY,
    bm_upgrades: [
      { you_said: 'kurang manis', try: 'kurang manis' },
      { you_said: 'less sweet', try: 'kurang manis' },
      { you_said: 'Thanks.', try: 'terima kasih' },
      { you_said: 'Terima kasih', try: 'terima  kasih!' },
    ],
  });
  assert.deepEqual(out.bm_upgrades, [
    { you_said: 'less sweet', try: 'kurang manis' },
    { you_said: 'Thanks.', try: 'terima kasih' },
  ]);
});

test('an empty bm_upgrades array is a valid answer', () => {
  const out = validateSummaryOutput({ ...GOOD_SUMMARY, bm_upgrades: [] });
  assert.deepEqual(out.bm_upgrades, []);
});


// --- D2: the four axes must be DEFINED, and defined as independent ----------

test('the turn prompt defines each of the four axes separately', () => {
  for (const axis of [
    'intent_score',
    'semantic_score',
    'comprehensibility_score',
    'naturalness_score',
  ]) {
    // each axis is named on its own numbered definition line
    assert.match(TURN_SYSTEM_PROMPT, new RegExp('\\d\\. `' + axis + '` \u2014'), axis + ' defined');
  }
});

test('the turn prompt states the wrong-but-fluent shape explicitly', () => {
  assert.match(TURN_SYSTEM_PROMPT, /WRONG-BUT-FLUENT/);
  assert.match(TURN_SYSTEM_PROMPT, /independent of whether the answer was on-task/);
  assert.match(TURN_SYSTEM_PROMPT, /independent of task success/);
  // and it must still forbid punishing casual register
  assert.match(TURN_SYSTEM_PROMPT, /never penalise casual register/i);
});

// --- D3: grading is deterministic -------------------------------------------

test('evaluation temperature is pinned to 0', () => {
  assert.equal(EVAL_TEMPERATURE, 0);
});

// --- D6: no reflexive "use more BM" -----------------------------------------

test('the turn prompt forbids "use more BM" coaching when nothing was code-switched', () => {
  assert.match(TURN_SYSTEM_PROMPT, /use more Bahasa Melayu/);
  assert.match(TURN_SYSTEM_PROMPT, /unless they actually spoke English or Manglish/);
  assert.match(TURN_SYSTEM_PROMPT, /`improvement` MUST be about something the learner ACTUALLY DID/);
});

// --- D1 residual: bm_upgrades must be real code-switches --------------------

const MAMAK_CONVO = [
  { npc: 'Nak minum apa?' },
  { player: 'Saya nak teh ais kurang manis, and one roti canai please.' },
  { npc: 'Ok, sekejap ya.' },
  { player: 'Boleh bungkus? Sorry, I am in a hurry.' },
];

test('filterUpgrades drops the observed BM-to-BM pair', () => {
  // The exact output a live run produced in 3 of 4 runs.
  assert.deepEqual(filterUpgrades([{ you_said: 'kurang manis', try: 'tidak manis' }], MAMAK_CONVO), []);
});

test('filterUpgrades drops a pair the learner never said', () => {
  // "traffic jam" is textbook-correct and entirely invented here.
  assert.deepEqual(filterUpgrades([{ you_said: 'traffic jam', try: 'jalan sesak' }], MAMAK_CONVO), []);
});

test('filterUpgrades keeps the real code-switches', () => {
  const kept = filterUpgrades(
    [
      { you_said: 'and one roti canai please', try: 'dan satu roti canai' },
      { you_said: 'I am in a hurry', try: 'saya tergesa-gesa' },
      { you_said: 'kurang manis', try: 'tidak manis' },
      { you_said: 'teh ais', try: 'teh sejuk' },
    ],
    MAMAK_CONVO,
  );
  assert.deepEqual(kept, [
    { you_said: 'and one roti canai please', try: 'dan satu roti canai' },
    { you_said: 'I am in a hurry', try: 'saya tergesa-gesa' },
  ]);
});

test('filterUpgrades survives a pure-BM conversation with an empty list', () => {
  const pureBm = [
    { npc: 'Wei, report semalam dah siap ke?' },
    { player: 'Belum siap lagi kak, saya tengah buat sekarang.' },
    { npc: 'Petang ni tu pukul berapa?' },
    { player: 'Sebelum pukul tiga saya hantar, sempat untuk meeting kak.' },
  ];
  const proposed = [
    { you_said: 'tengah buat', try: 'sedang membuat' },
    { you_said: 'sempat', try: 'ada masa' },
    { you_said: 'belum siap lagi', try: 'masih belum siap' },
  ];
  assert.deepEqual(filterUpgrades(proposed, pureBm), []);
});

test('containsEnglish says no to Malay and yes to English', () => {
  assert.equal(containsEnglish('kurang manis'), false);
  assert.equal(containsEnglish('belum siap lagi'), false);
  assert.equal(containsEnglish('petang ni lah kak'), false);
  assert.equal(containsEnglish('sebelum pukul tiga saya hantar'), false);
  assert.equal(containsEnglish('less sweet'), true);
  assert.equal(containsEnglish('traffic jam'), true);
  assert.equal(containsEnglish('coming right up'), true);
  assert.equal(containsEnglish('I want to send it'), true);
});

test('validateSummaryOutput applies the code-switch filter against the conversation', () => {
  const out = validateSummaryOutput(
    {
      ...GOOD_SUMMARY,
      bm_upgrades: [
        { you_said: 'kurang manis', try: 'tidak manis' },
        { you_said: 'please', try: 'tolong' },
      ],
    },
    MAMAK_CONVO,
  );
  assert.deepEqual(out.bm_upgrades, [{ you_said: 'please', try: 'tolong' }]);
});


// --- npc_reply: personas in, answer key out --------------------------------

test('every scenario gives its NPC a persona, and the makcik step overrides it', () => {
  for (const id of ['mamak_01', 'mall_01', 'office_01']) {
    const s = getScenario(id);
    assert.ok(s.npc_persona && s.npc_persona.length > 80, `${id} needs an npc_persona`);
    assert.ok(s.npc_reprompt, `${id} needs an npc_reprompt safety line`);
  }
  const makcik = getScenario('mall_01').steps.find((st) => st.id === 'give_directions');
  assert.equal(makcik.npc_name, 'Makcik');
  assert.ok(makcik.npc_persona, 'the makcik step carries its own persona override');
  assert.notEqual(makcik.npc_persona, getScenario('mall_01').npc_persona);
});

test('npc_persona is stripped from everything the browser can see', () => {
  assert.ok(ANSWER_KEY_FIELDS.includes('npc_persona'));
  assert.ok(ANSWER_KEY_FIELDS.includes('npc_reprompt'));
  for (const id of ['mamak_01', 'mall_01', 'office_01']) {
    for (const level of [1, 2, 3]) {
      const json = JSON.stringify(publicScenario(getScenario(id), level));
      assert.ok(!json.includes('npc_persona'), `${id} L${level} leaks npc_persona`);
      assert.ok(!json.includes('npc_reprompt'), `${id} L${level} leaks npc_reprompt`);
      // The persona TEXT, not just the key name, must be absent.
      assert.ok(
        !json.includes(getScenario(id).npc_persona.slice(0, 40)),
        `${id} L${level} leaks persona text`,
      );
    }
  }
});

test('every scenario states the world facts its scripted lines assert', () => {
  const required = {
    // mall_01's whole mission is directions, so its facts ARE the directions.
    mall_01: ['tingkat empat', 'eskalator', 'belok kiri', 'papan tanda'],
    mamak_01: ['Milo'],
    office_01: ['pukul empat'],
  };
  for (const [id, needles] of Object.entries(required)) {
    const facts = getScenario(id).world_facts;
    assert.ok(Array.isArray(facts) && facts.length >= 3, `${id} needs world_facts`);
    const joined = facts.join(' ').toLowerCase();
    for (const n of needles) {
      assert.ok(joined.includes(n.toLowerCase()), `${id} world_facts must pin down "${n}"`);
    }
  }
  // Every fact must be traceable to something the script already asserts: the
  // scripted NPC lines are the source of truth, world_facts only restates them.
  const mall = getScenario('mall_01');
  const scripted = [
    mall.intro.text,
    ...mall.steps.map((s) => s.tts_prompt),
    ...mall.complete.map((c) => c.npc_line),
  ]
    .join(' ')
    .toLowerCase();
  for (const n of required.mall_01) {
    assert.ok(scripted.includes(n), `"${n}" must come from a scripted line, not be invented`);
  }
});

test('world_facts never reach the browser', () => {
  assert.ok(ANSWER_KEY_FIELDS.includes('world_facts'));
  for (const id of ['mamak_01', 'mall_01', 'office_01']) {
    const facts = getScenario(id).world_facts;
    for (const level of [1, 2, 3]) {
      const json = JSON.stringify(publicScenario(getScenario(id), level));
      assert.ok(!json.includes('world_facts'), `${id} L${level} leaks the world_facts key`);
      for (const fact of facts) {
        assert.ok(!json.includes(fact), `${id} L${level} leaks a world fact verbatim`);
      }
    }
  }
  // A per-step override, should anyone ever author one, is stripped too.
  const scenario = getScenario('mall_01');
  const patched = {
    ...scenario,
    steps: scenario.steps.map((s) =>
      s.id === 'ask' ? { ...s, world_facts: ['SECRET-STEP-FACT'] } : s,
    ),
  };
  assert.ok(!JSON.stringify(publicScenario(patched, 1)).includes('SECRET-STEP-FACT'));
});

test('the turn prompt binds npc_reply to world_facts without licensing a leak', () => {
  const p = TURN_SYSTEM_PROMPT;
  assert.match(p, /`world_facts` is the ground truth of this scene/);
  assert.match(p, /ONLY if it is in `world_facts`/);
  assert.match(p, /NOT permission to answer for the player/);
  assert.match(p, /`forbidden_phrases`/);
});

test('the answer-key guard still wins over world_facts at mall_01 give_directions', () => {
  // The L3 hand-off is the delicate case: "tingkat empat / eskalator / belok
  // kiri" are true, are in world_facts, and are exactly what the PLAYER must
  // now produce. Makcik does not know the way and must not say them.
  const scenario = getScenario('mall_01');
  const step = scenario.steps.find((s) => s.id === 'give_directions');
  const banned = bannedPhrasesFor({
    step,
    scenario,
    transcript: 'errr makcik, ikut saja',
    conversationHistory: [{ npc: step.tts_prompt, player: 'errr makcik, ikut saja' }],
  });
  for (const phrase of ['tingkat empat', 'eskalator', 'belok kiri']) {
    assert.ok(banned.includes(phrase), `${phrase} must be forbidden to Makcik`);
  }
  const out = stripAnswerKeyLeak('Naik eskalator sampai tingkat empat, lepas tu belok kiri ya dik?', {
    step,
    scenario,
    transcript: 'errr makcik, ikut saja',
    conversationHistory: [{ npc: step.tts_prompt }],
    fallbackLine: step.npc_reprompt,
  });
  assert.equal(out.reply, step.npc_reprompt);
  assert.ok(out.leaked.length);
});

test('bannedPhrasesFor exempts what has already been said aloud', () => {
  const scenario = getScenario('mamak_01');
  const step = scenario.steps.find((s) => s.id === 'wrong_order');
  // The learner just said "teh tarik", so echoing it back is not a leak.
  const banned = bannedPhrasesFor({
    step,
    scenario,
    transcript: 'Bang, saya pesan teh tarik tadi.',
    conversationHistory: [],
  });
  assert.ok(!banned.includes('teh tarik'));
  assert.ok(banned.includes('kurang manis'), 'the half they did not say stays banned');
});

test('the turn prompt forbids the NPC from speaking or completing the task', () => {
  const p = TURN_SYSTEM_PROMPT;
  assert.match(p, /npc_persona/);
  assert.match(p, /NEVER state, hint at, complete or half-complete the task/);
  assert.match(p, /React ONLY to what the learner \*\*actually said\*\*/);
  assert.match(p, /word test/);
});

test('answerKeyPhrases pools the whole scenario and drops pure function phrases', () => {
  const scenario = getScenario('mamak_01');
  const step = scenario.steps.find((s) => s.id === 'wrong_order');
  const phrases = answerKeyPhrases(step, scenario);
  // `kurang manis` belongs to the PREVIOUS step and still counts here.
  assert.ok(phrases.includes('kurang manis'));
  assert.ok(phrases.includes('teh tarik'));
  // office_01 lists "boleh"/"tapi" as key concepts; alone they teach nothing.
  const office = getScenario('office_01');
  const cover = office.steps.find((s) => s.id === 'cover_me');
  const officePhrases = answerKeyPhrases(cover, office);
  assert.ok(!officePhrases.includes('boleh'));
  assert.ok(!officePhrases.includes('tapi'));
  // One content word is enough to ban the whole phrase...
  assert.ok(officePhrases.includes('tak sempat'));
  assert.ok(officePhrases.includes('macam mana kalau'));
  // ...but a phrase made ENTIRELY of function words carries no answer, so it
  // is not a leak. This is what gives Abang Guard back "nak cari apa ya?":
  // `nak cari` is in mall_01's question-word fallback group for the
  // deterministic scorer, and reveals nothing — `food court` is the answer.
  const mall = getScenario('mall_01');
  const ask = mall.steps.find((s) => s.id === 'ask');
  const mallPhrases = answerKeyPhrases(ask, mall);
  assert.ok(!mallPhrases.includes('nak cari'));
  assert.ok(!mallPhrases.includes('kat mana'));
  assert.ok(mallPhrases.includes('food court'), 'the actual answer stays banned');
  assert.ok(mallPhrases.includes('tingkat empat'));
  assert.ok(mallPhrases.includes('belok kiri'));
});

test('the guard may ask "nak cari apa" but may not say where the food court is', () => {
  const scenario = getScenario('mall_01');
  const step = scenario.steps.find((s) => s.id === 'ask');
  const open = stripAnswerKeyLeak('Ha, encik nak cari apa ya?', {
    step,
    scenario,
    transcript: 'errr',
    conversationHistory: [{ npc: step.tts_prompt }],
    fallbackLine: scenario.npc_reprompt,
  });
  assert.equal(open.reply, 'Ha, encik nak cari apa ya?');
  assert.deepEqual(open.leaked, []);
});

test('stripAnswerKeyLeak excises the answer the learner never said', () => {
  const scenario = getScenario('mamak_01');
  const step = scenario.steps.find((s) => s.id === 'order');
  const out = stripAnswerKeyLeak('Eh, teh tarik satu? Kurang manis ke? Jom!', {
    step,
    scenario,
    transcript: 'emm apa ya teh',
    conversationHistory: [{ npc: step.tts_prompt }],
  });
  assert.ok(!/kurang manis/i.test(out.reply), 'the missing half of the answer is gone');
  assert.ok(out.leaked.includes('kurang manis'));
});

test('stripAnswerKeyLeak leaves words the learner or the NPC already said', () => {
  const scenario = getScenario('mamak_01');
  const step = scenario.steps.find((s) => s.id === 'order');
  const line = 'Teh tarik kurang manis, ya? Jap ya!';
  const out = stripAnswerKeyLeak(line, {
    step,
    scenario,
    transcript: 'Saya nak teh tarik satu, kurang manis.',
    conversationHistory: [],
  });
  assert.equal(out.reply, line);
  assert.deepEqual(out.leaked, []);
});

test('stripAnswerKeyLeak falls back to the character re-prompt when nothing survives', () => {
  const scenario = getScenario('mamak_01');
  const step = scenario.steps.find((s) => s.id === 'order');
  const out = stripAnswerKeyLeak('Teh tarik kurang manis ke?', {
    step,
    scenario,
    transcript: 'hmm',
    conversationHistory: [],
    fallbackLine: scenario.npc_reprompt,
  });
  assert.equal(out.reply, scenario.npc_reprompt);
  const bare = stripAnswerKeyLeak('Teh tarik kurang manis ke?', {
    step,
    scenario,
    transcript: 'hmm',
    conversationHistory: [],
  });
  assert.equal(bare.reply, DEFAULT_REPROMPT);
});

test('stripAnswerKeyLeak does not leave a dangling connective behind', () => {
  const scenario = getScenario('mall_01');
  const step = scenario.steps.find((s) => s.id === 'confirm');
  const out = stripAnswerKeyLeak('Oh, kasut baru? Tapi, food court kat tingkat berapa?', {
    step,
    scenario,
    transcript: 'saya baru beli kasut',
    conversationHistory: [],
  });
  assert.equal(out.reply, 'Oh, kasut baru?');
});

test('stripAnswerKeyLeak does not leave an orphaned vocative behind', () => {
  // Observed live at mall_01 L3: cutting the body of the line left "Hah? dik?",
  // a term of address hanging off nothing.
  const scenario = getScenario('mall_01');
  const step = scenario.steps.find((s) => s.id === 'give_directions');
  const out = stripAnswerKeyLeak('Aduh, tak tahu ke? Hah? Macam mana nak pergi tu, dik?', {
    step,
    scenario,
    transcript: 'saya pun tak tahu makcik',
    conversationHistory: [{ npc: step.tts_prompt }],
    fallbackLine: step.npc_reprompt,
  });
  assert.equal(out.reply, 'Aduh, tak tahu ke? Hah?');
});

test('stripAnswerKeyLeak does not emit a half-finished sentence', () => {
  // Live at mamak_01: cutting the tail of "Hah? Nak teh tarik, kurang manis?"
  // left "Hah? Nak teh tarik" — a sentence stopped mid-word-order. The clause
  // that ended on a comma goes too, and the character's own line carries it.
  const scenario = getScenario('mamak_01');
  const step = scenario.steps.find((s) => s.id === 'order');
  const out = stripAnswerKeyLeak('Hah? Nak teh tarik, kurang manis?', {
    step,
    scenario,
    transcript: 'can i have one teh tarik less sweet',
    conversationHistory: [],
    fallbackLine: scenario.npc_reprompt,
  });
  assert.equal(out.reply, scenario.npc_reprompt);
  // And a comma left in front of a fresh sentence is promoted to a full stop.
  const mall = getScenario('mall_01');
  const gd = mall.steps.find((s) => s.id === 'give_directions');
  const tidy = stripAnswerKeyLeak('Aduh, naik eskalator tu, betul ke dik? Makcik tak faham.', {
    step: gd,
    scenario: mall,
    transcript: 'naik je makcik',
    conversationHistory: [],
    fallbackLine: gd.npc_reprompt,
  });
  assert.ok(!/,\s+[A-Z]/.test(tidy.reply), `stray comma in ${JSON.stringify(tidy.reply)}`);
});

// ---------------------------------------------------------------------------
// Meaning, not wording — the scoring-correctness regression (office_01/pin_down)
// ---------------------------------------------------------------------------
// A live player hit this: at office_01/pin_down Kak Ana asks "petang ni tu
// pukul berapa?" with a 4pm meeting in `world_facts`, and "Pukul satu petang."
// scored 40/retry while "Sebelum pukul tiga saya hantar." scored 100. The
// evaluator had drifted onto the SHAPE of `sample_answers` — the literal word
// "sebelum" and an explicit delivery verb — instead of the meaning. 1pm is
// specific and three hours before the meeting; it is a pass. Worse,
// "Pukul dua setengah kak." is very nearly `sample_answers[1]` and scored 59.
//
// The fix is in the prompt contract, not in code and not in a special case for
// this step: the model now emits a `requirement_checks` checklist BEFORE any
// number, one entry per `expected_semantics` item, spelling the comparison out
// against `world_facts`; plus explicit rules that a direct answer to a direct
// question IS a commitment, that hedging means vagueness rather than brevity,
// and that resembling a sample answer is never a criterion.

test('the turn prompt makes the model check the requirements before it scores', () => {
  const p = TURN_SYSTEM_PROMPT;
  assert.match(p, /STEP ZERO/);
  assert.match(p, /`requirement_checks` is the FIRST field you produce, before any number/);
  // one entry per expected_semantics item, in order
  assert.match(p, /ONE entry per item in `expected_semantics`, in the same order/);
  // and the comparison is spelled out from world_facts, not inferred from phrasing
  assert.match(p, /do the comparison out loud/);
  assert.match(p, /Decide it by the VALUES, never by whether the sentence contained a comparison word/);
});

test('the turn prompt separates commitment from wording, and hedging from brevity', () => {
  const p = TURN_SYSTEM_PROMPT;
  assert.match(p, /A direct answer to a direct question IS the commitment/);
  assert.match(p, /Hedging means VAGUENESS, not BREVITY/);
  assert.match(p, /An approximator wrapped around a REAL VALUE is not vagueness/);
  // the mirror: right shape, wrong value is a failure, not a partial
  assert.match(p, /supplying the requested value but the WRONG value is a task FAILURE/);
  // and a satisfied requirement cannot be voted down by a different one
  assert.match(p, /Never contradict your own `finding`/);
});

test('the turn prompt forbids grading by resemblance to sample_answers', () => {
  const p = TURN_SYSTEM_PROMPT;
  assert.match(p, /`sample_answers` are the single biggest trap in this job/);
  assert.match(p, /this game judges meaning, never wording/);
  assert.match(p, /the SAME score as the closest sample would get/);
  // key_concepts belong to the fallback scorer, not to the model's criteria
  assert.match(p, /They are NOT your criteria/);
});

test('requirement_checks is generated first and never reaches the client', () => {
  // Structured output is emitted in property order, so the checklist must be
  // the first property for it to function as reasoning-before-scoring.
  assert.equal(Object.keys(TURN_SCHEMA.properties)[0], 'requirement_checks');
  assert.equal(TURN_SCHEMA.required[0], 'requirement_checks');
  // It is the answer key restated. `validateTurnOutput` drops it on the floor.
  const out = validateTurnOutput({
    ...GOOD_TURN,
    requirement_checks: [{ requirement: 'gives a time', finding: '1pm < 4pm', verdict: 'met' }],
  });
  assert.equal('requirement_checks' in out, false);
  assert.ok(!JSON.stringify(out).includes('1pm < 4pm'));
});

// --- Live regression: the four reported cases, plus the vague-answer trap ----
//
// These call the real provider, so they are skipped unless a key is configured
// — the inverse of `skipIfKey` above, and the reason `npm test` stays hermetic
// and green with no API key.

const skipIfNoKey = hasLlmKey()
  ? {}
  : { skip: `no ${LLM_PROVIDER} API key configured — live grading assertions skipped` };

const PIN_DOWN_HISTORY = [
  {
    npc: 'Wei, report semalam dah siap ke?',
    player: 'Belum siap lagi kak, saya tengah buat. Petang ni saya hantar.',
  },
];

/** Score one transcript through the real evaluator, exactly as the route does. */
async function gradeLive({ scenarioId, stepId, level, history, transcript }) {
  const sc = getScenario(scenarioId);
  const st = findStep(sc, stepId);
  const raw = await liveEvaluate({
    scenario: sc,
    step: st,
    level,
    levelConfig: { allowed_code_switch: sc.levels[String(level)].allowed_code_switch },
    transcript,
    sttConfidence: 0.9,
    conversationHistory: history,
  });
  const overall = computeOverall(raw);
  return { overall, intentPass: raw.intent_pass, success: overall >= 75 && raw.intent_pass, raw };
}

// band, not exact number: the grader is an LLM and ±5 is within its noise.
const PIN_DOWN_CASES = [
  // A bare specific time that is plainly before the meeting. This is the bug:
  // it scored 40/retry because it lacked the word "sebelum" and a delivery verb.
  { transcript: 'Pukul satu petang.', band: 'success' },
  // Almost verbatim `sample_answers[1]` — it scored 59/partial.
  { transcript: 'Pukul dua setengah kak.', band: 'success' },
  // The one that always worked, kept as the control.
  { transcript: 'Sebelum pukul tiga saya hantar.', band: 'success' },
  // Specific, committed, and on the WRONG SIDE of the 4pm meeting. Getting the
  // shape of the answer right does not earn a pass when the value is wrong.
  { transcript: 'Pukul lima kak.', band: 'fail' },
];

for (const { transcript, band } of PIN_DOWN_CASES) {
  test(`live: office_01/pin_down "${transcript}" -> ${band}`, skipIfNoKey, async () => {
    const g = await gradeLive({
      scenarioId: 'office_01',
      stepId: 'pin_down',
      level: 2,
      history: PIN_DOWN_HISTORY,
      transcript,
    });
    if (band === 'success') {
      assert.ok(g.intentPass, `expected intent_pass for "${transcript}"`);
      assert.ok(g.success, `expected success, got ${g.overall} for "${transcript}"`);
    } else {
      assert.ok(!g.success, `expected NOT success, got ${g.overall} for "${transcript}"`);
      assert.ok(g.overall < 75, `expected below the pass band, got ${g.overall}`);
    }
  });
}

test('live: the vague-answer trap still costs more than a specific time', skipIfNoKey, async () => {
  // The fix must not be "make everything pass". "Petang ni lah kak." names no
  // time at all — it is the answer Kak Ana just refused — and must land clearly
  // below a bare specific time, which is the answer she asked for.
  const vague = await gradeLive({
    scenarioId: 'office_01',
    stepId: 'pin_down',
    level: 2,
    history: PIN_DOWN_HISTORY,
    transcript: 'Petang ni lah kak.',
  });
  const specific = await gradeLive({
    scenarioId: 'office_01',
    stepId: 'pin_down',
    level: 2,
    history: PIN_DOWN_HISTORY,
    transcript: 'Pukul satu petang.',
  });
  assert.ok(!vague.success, `vague answer must not pass (got ${vague.overall})`);
  assert.ok(vague.overall < 55, `vague answer belongs in the retry band (got ${vague.overall})`);
  assert.ok(
    specific.overall - vague.overall >= 20,
    `a specific time must score clearly higher than "petang ni" (${specific.overall} vs ${vague.overall})`,
  );
});

// --- The same trap in the other two scenarios -------------------------------
// The general defect is grading by resemblance to `sample_answers`. Each of
// these says exactly what its step asks for, in a form no sample answer uses.

const OFF_SAMPLE_CASES = [
  {
    name: 'mamak_01/order — "jangan manis sangat" instead of "kurang manis"',
    scenarioId: 'mamak_01',
    stepId: 'order',
    history: [],
    transcript: 'Teh tarik satu bang, jangan manis sangat ya.',
  },
  {
    name: 'mall_01/confirm — the directions read back in a different order',
    scenarioId: 'mall_01',
    stepId: 'confirm',
    // Only the PREVIOUS turn. The directions themselves are this step's own
    // `tts_prompt`, which the evaluator receives as `npc_prompt` — putting them
    // in the history too would be a turn the game never sends.
    history: [
      { npc: 'Ya? Boleh saya tolong?', player: 'Maaf bang, food court kat mana ya?' },
    ],
    transcript: 'Belok kiri lepas naik eskalator sampai atas, tingkat empat kan bang?',
  },
];

for (const c of OFF_SAMPLE_CASES) {
  test(`live: ${c.name} passes on meaning`, skipIfNoKey, async () => {
    const g = await gradeLive({ ...c, level: 2 });
    assert.ok(g.intentPass, `expected intent_pass, got ${JSON.stringify(g.raw)}`);
    assert.ok(g.success, `expected success, got ${g.overall}`);
  });
}

test('live: a fluent off-task answer still fails the task axes', skipIfNoKey, async () => {
  // The control for the two above: this must NOT pass, or the scenarios are
  // simply grading everything as correct.
  const g = await gradeLive({
    scenarioId: 'mamak_01',
    stepId: 'order',
    level: 2,
    history: [],
    transcript: 'Bang, panas gila hari ni kan.',
  });
  assert.ok(!g.success, `expected NOT success, got ${g.overall}`);
  // ...while the two LANGUAGE axes stay high — they never depended on the task.
  assert.ok(g.raw.comprehensibility_score >= 60, 'comprehensibility must not be crushed');
  assert.ok(g.raw.naturalness_score >= 60, 'naturalness must not be crushed');
});
