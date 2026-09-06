// public/js/game/state.js — session state for one mission run.
//
// Deliberately a plain data object plus pure helpers: the engine mutates it,
// the screens read it, and nothing here touches the DOM or the network.
//
// Privacy: this lives in memory for the duration of the page only. Audio blobs
// are never stored here; transcripts die with the tab. No storage, no telemetry.

/** Narrator voice — scene-setting only. */
export const NARRATOR_VOICE = 'salina-d3e1a70d';
/** Coach voice — the feedback line. */
export const COACH_VOICE = 'liyana-fb5824d7';
/** The server's mission-end sentinel. */
export const COMPLETE = '__complete__';
/** Server-enforced cap; the client tracks the count and sends it. */
export const RETRY_CAP = 2;

/**
 * @param {object} scenario the /api/scenarios/:id?level=N payload
 * @param {1|2|3} level
 */
export function createSession(scenario, level) {
  return {
    scenario,
    level: Number(level),
    stepId: scenario.first_step_id,
    /** retries already taken on the CURRENT step (what /api/evaluate wants) */
    retryCount: 0,
    /** [{npc, player}] — exactly the shape /api/evaluate + /api/summarise want */
    history: [],
    /** richer per-turn log, kept for the summary payload and as a fallback */
    turns: [],
    /**
     * The mission as it was ACTUALLY heard and spoken, in order:
     *   [{role: 'npc', text, name, portrait} | {role: 'player', text, score, …}]
     * This — not `turns` — is what the end-of-mission transcript renders, so a
     * scripted line that was never spoken can never appear in it.
     */
    thread: [],
    /** [{step_id, overall_score}] for /api/summarise */
    turnScores: [],
    startedAt: Date.now(),
    finished: false,
  };
}

/**
 * @param {object} scenario
 * @param {string} id
 * @returns {object|undefined}
 */
export function stepById(scenario, id) {
  return (scenario.steps || []).find((s) => s.id === id);
}

/**
 * The on-screen instruction for this level.
 * L1 → task_en (English), L2 → task_ms (Malay), L3 → nothing.
 * @param {object} scenario
 * @param {object} step
 * @returns {{text: string, lang: 'en'|'ms'}|null}
 */
export function hintFor(scenario, step) {
  const hint = scenario.hint;
  if (hint === 'en' && step.task_en) return { text: step.task_en, lang: 'en' };
  if (hint === 'ms' && step.task_ms) return { text: step.task_ms, lang: 'ms' };
  return null;
}

/**
 * Who is speaking this step. The server already resolves per-step overrides
 * (the makcik in mall_01 L3), but we fall back to the scenario defaults so a
 * hand-written step without overrides still works.
 * @param {object} scenario
 * @param {object} step
 */
export function speakerFor(scenario, step) {
  return {
    name: step?.npc_name || scenario.npc_name,
    voiceId: step?.voice_id || scenario.voice_id,
    portrait: step?.portrait || scenario.portrait,
  };
}

/**
 * Who speaks (and is shown for) the mission's closing line.
 *
 * The `complete` block may name its own character, or only a voice. A voice on
 * its own used to play under the scenario's default portrait/name — the makcik
 * talking out of Abang Guard's face. Resolve ONE speaker and use it for both
 * the audio and the screen:
 *   1. an explicit character on the `complete` block, else
 *   2. the step at this level whose voice matches `complete.voice_id`, else
 *   3. whoever spoke last (the scenario default if we have nobody).
 * @param {object} scenario
 * @param {{name?: string, voiceId?: string, portrait?: string}} [lastSpeaker]
 */
export function closingSpeakerFor(scenario, lastSpeaker) {
  const closing = scenario?.complete || {};
  if (closing.npc_name || closing.portrait) {
    return {
      name: closing.npc_name || scenario.npc_name,
      voiceId: closing.voice_id || scenario.voice_id,
      portrait: closing.portrait || scenario.portrait,
    };
  }
  if (closing.voice_id && closing.voice_id !== scenario.voice_id) {
    const match = (scenario.steps || []).find((s) => s.voice_id === closing.voice_id);
    if (match) return speakerFor(scenario, match);
  }
  if (lastSpeaker?.voiceId) return lastSpeaker;
  return speakerFor(scenario, null);
}

/**
 * Log a line the NPC ACTUALLY said, at the moment it is said.
 *
 * The mission-end transcript is built from this, so nothing may be logged
 * here speculatively: a scripted `tts_prompt` is logged when it is spoken and
 * on no other occasion. Two identical lines back to back collapse into one —
 * that is one utterance as far as the player is concerned.
 *
 * @param {ReturnType<createSession>} session
 * @param {{text: string, name?: string, portrait?: string}} line
 * @returns {object|null} the thread entry, or null if nothing was logged
 */
export function logNpcSaid(session, { text, name, portrait } = {}) {
  const said = String(text || '').trim();
  if (!session || !said) return null;
  const speakerName = name || session.scenario?.npc_name || '';
  const last = session.thread[session.thread.length - 1];
  if (last && last.role === 'npc' && last.text === said && last.name === speakerName) return last;
  const entry = {
    role: 'npc',
    text: said,
    name: speakerName,
    portrait: portrait || session.scenario?.portrait || '',
  };
  session.thread.push(entry);
  return entry;
}

/**
 * Append a completed turn. `evaluation` may be a no_input turn, in which case
 * no score is recorded anywhere (a system/silence turn never costs points).
 *
 * `npc` is the line the player actually HEARD before answering — on a retry
 * that is not necessarily the step's scripted prompt — and it is what goes
 * into the evaluator's conversation history.
 *
 * @param {ReturnType<createSession>} session
 * @param {{stepId: string, npc: string, player: string, npcName?: string, evaluation: object}} turn
 */
export function recordTurn(session, { stepId, npc, player, npcName, evaluation }) {
  session.history.push({ npc, player });
  session.thread.push({
    role: 'player',
    stepId,
    text: player,
    score: evaluation?.scored ? evaluation.overall_score : null,
    band: evaluation?.band ?? null,
    bandLabel: evaluation?.band_label ?? null,
    result: evaluation?.result ?? null,
  });
  session.turns.push({
    stepId,
    npcName: npcName || session.scenario.npc_name,
    npc,
    player,
    npcReply: evaluation?.npc_reply || '',
    score: evaluation?.scored ? evaluation.overall_score : null,
    band: evaluation?.band ?? null,
    bandLabel: evaluation?.band_label ?? null,
    result: evaluation?.result ?? null,
    whatWorked: evaluation?.what_worked ?? null,
    improvement: evaluation?.improvement ?? null,
  });
  if (evaluation?.scored && evaluation.overall_score != null) {
    session.turnScores.push({ step_id: stepId, overall_score: evaluation.overall_score });
  }
  return session;
}

/**
 * Undo the most recent recorded turn — used when the learner asks to redo a
 * turn they can see was misheard, before the branch has been applied. The
 * attempt must leave no trace: no history line, no score, no retry counted.
 * @param {ReturnType<createSession>} session
 * @param {string} stepId
 */
export function dropLastTurn(session, stepId) {
  const last = session.turns[session.turns.length - 1];
  if (!last || last.stepId !== stepId) return false;
  session.turns.pop();
  session.history.pop();
  // The chat thread has to lose the same attempt: the player's line and any
  // NPC line that came after it (the reaction to the attempt being undone).
  while (session.thread.length && session.thread[session.thread.length - 1].role === 'npc') {
    session.thread.pop();
  }
  if (session.thread.length && session.thread[session.thread.length - 1].role === 'player') {
    session.thread.pop();
  }
  const lastScore = session.turnScores[session.turnScores.length - 1];
  if (lastScore && lastScore.step_id === stepId) session.turnScores.pop();
  return true;
}

/**
 * Advance bookkeeping after an evaluation.
 * - `free_retry` (no_input) must NOT increment retry_count.
 * - staying on the same step is a retry; moving on resets the counter.
 * @param {ReturnType<createSession>} session
 * @param {object} evaluation
 * @returns {{next: string, isRetry: boolean, complete: boolean}}
 */
export function applyEvaluation(session, evaluation) {
  const next = evaluation?.next_step_id || COMPLETE;
  const complete = next === COMPLETE || evaluation?.complete === true;
  const isRetry = !complete && next === session.stepId;

  if (isRetry && !evaluation?.free_retry) session.retryCount += 1;
  if (!isRetry) session.retryCount = 0;

  session.stepId = complete ? COMPLETE : next;
  session.finished = complete;
  return { next: session.stepId, isRetry, complete };
}

/** Payload for POST /api/summarise. */
export function summarisePayload(session) {
  return {
    scenario_id: session.scenario.id,
    level: session.level,
    conversation: session.history.map(({ npc, player }) => ({ npc, player })),
    turn_scores: session.turnScores,
  };
}
