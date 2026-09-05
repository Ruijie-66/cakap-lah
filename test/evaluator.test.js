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

test('the turn prompt forbids the NPC from speaking or completing the task', () => {
  const p = TURN_SYSTEM_PROMPT;
  assert.match(p, /npc_persona/);
  assert.match(p, /NEVER state, hint at, complete or half-complete the task/);
  assert.match(p, /React ONLY to what the learner \*\*actually said\*\*/);
  assert.match(p, /word test/);
});

test('answerKeyPhrases pools the whole scenario and drops bare function words', () => {
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
  assert.ok(officePhrases.includes('tak boleh'), 'multi-word phrases stay banned');
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
