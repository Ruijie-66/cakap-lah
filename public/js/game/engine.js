// public/js/game/engine.js — the turn loop and branching.
//
// The engine owns sequencing only. It never touches the DOM: it emits events
// and the screen layer renders them. Audio capture/playback are injected so
// the loop can be driven headlessly in a test.
//
// The loop, exactly as specified:
//   1 pick scenario + level        (main.js → startMission)
//   2 narrator speaks intro, then the NPC speaks tts_prompt at level speed
//   3 recording arms when the audio ends (manual start also allowed), 20s cap
//   4 stop → blob → POST /api/stt → transcript
//   5 empty transcript → "Tak dengar tadi — cuba lagi." no penalty, back to 3
//   6 POST /api/evaluate → scores + npc_reply + branch + next_step_id
//   7 validation/retry/fallback is the server's job — render what comes back
//   8 show transcript, turn score counting up, one coaching line
//   9 POST /api/tts with npc_reply in the NPC's own voice; portrait state
//  10 append {npc, player, score} to the transcript log
//  11 branch → next step / retry same step / mission end → POST /api/summarise
//
// Branch resolution and level gating live on the SERVER. We follow
// `next_step_id` and treat `__complete__` as mission end. No client-side rules.

import {
  COMPLETE,
  NARRATOR_VOICE,
  COACH_VOICE,
  applyEvaluation,
  closingSpeakerFor,
  dropLastTurn,
  createSession,
  hintFor,
  recordTurn,
  speakerFor,
  stepById,
  summarisePayload,
} from './state.js';

export const NO_INPUT_MESSAGE = 'Tak dengar tadi — cuba lagi.';

/**
 * @param {{
 *   api: typeof import('../api.js'),
 *   player: { play(clip): Promise<{ok:boolean, reason?:string}>, replay(): Promise<{ok:boolean, reason?:string}>, stop(): void, hasClip(): boolean },
 *   emit: (type: string, payload?: object) => void,
 * }} deps
 */
export function createEngine({ api, player, emit }) {
  /** @type {ReturnType<createSession>|null} */
  let session = null;
  /** token used to abandon an in-flight sequence when the player quits */
  let runToken = 0;
  let busy = false;
  let lastLine = null; // { text, voiceId, speed, who } — for the replay button
  /** set by stopAudio(): the player cut the voice off on purpose (barge-in) */
  let interrupted = false;
  /** the speaker of the last NPC step — the closing line falls back to them */
  let lastStepSpeaker = null;
  /** a turn is logged but its branch has not been applied yet — undoable */
  let uncommittedTurn = null;

  const alive = (token) => token === runToken && session !== null;

  /** Speak one line. Never throws: a voice outage degrades to text on screen. */
  async function speak(token, { text, voiceId, speed, who }) {
    if (!text || !alive(token)) return { ok: false, reason: 'skipped' };
    lastLine = { text, voiceId, speed, who };
    interrupted = false;
    emit('speaking', { who, text });
    let result = { ok: false, reason: 'unknown' };
    try {
      const clip = await api.tts({ text, voiceId, speed });
      if (!alive(token)) return { ok: false, reason: 'cancelled' };
      // Barged in while the voice was still being fetched: do not start it.
      if (interrupted) {
        emit('speak-end', { who, text, ok: false, interrupted: true });
        return { ok: false, reason: 'Playback stopped.', interrupted: true };
      }
      result = await player.play(clip);
    } catch (err) {
      result = { ok: false, reason: err?.message || 'The voice could not be played.' };
    }
    if (!alive(token)) return { ok: false, reason: 'cancelled' };
    // A stop we asked for is not a failure: the player pressed the mic to cut
    // the NPC off, exactly as the button invited them to.
    if (interrupted) result = { ...result, interrupted: true };
    if (!result.ok && !result.interrupted) emit('voice-warning', { message: result.reason, text, who });
    emit('speak-end', { who, text, ok: result.ok, interrupted: !!result.interrupted });
    return result;
  }

  /** Enter a step: announce it, speak the prompt, then hand the mic over. */
  async function enterStep(token, stepId, { withIntro = false } = {}) {
    const { scenario } = session;
    const step = stepById(scenario, stepId);
    if (!step) {
      // Should be impossible — the server resolves forward — but never hang.
      await finish(token);
      return;
    }
    const speaker = speakerFor(scenario, step);
    lastStepSpeaker = speaker;
    emit('step', {
      step,
      speaker,
      hint: hintFor(scenario, step),
      scenario,
      level: session.level,
      stepNumber: (scenario.steps || []).findIndex((s) => s.id === step.id) + 1,
      stepCount: (scenario.steps || []).length,
      retryCount: session.retryCount,
    });

    if (withIntro && scenario.intro?.text) {
      emit('narrator', { text: scenario.intro.text });
      await speak(token, {
        text: scenario.intro.text,
        voiceId: scenario.intro.voice_id || NARRATOR_VOICE,
        speed: 1,
        who: 'narrator',
      });
      if (!alive(token)) return;
    }

    emit('npc-line', { text: step.tts_prompt, speaker, state: 'idle' });
    await speak(token, {
      text: step.tts_prompt,
      voiceId: speaker.voiceId,
      speed: scenario.speed,
      who: 'npc',
    });
    if (!alive(token)) return;
    emit('ready-to-record', { step, reason: 'prompt-ended' });
  }

  /** Mission end: closing NPC line, then the summary screen. */
  async function finish(token, lastSpeaker = lastStepSpeaker) {
    const { scenario } = session;
    session.finished = true;
    const closing = scenario.complete;
    if (closing?.npc_line) {
      // ONE speaker drives both the voice and the portrait/name on screen.
      const speaker = closingSpeakerFor(scenario, lastSpeaker);
      emit('npc-line', { text: closing.npc_line, speaker, state: 'pleased' });
      await speak(token, {
        text: closing.npc_line,
        voiceId: speaker.voiceId,
        speed: scenario.speed,
        who: 'npc',
      });
      if (!alive(token)) return;
    }

    emit('processing', { stage: 'summary' });
    let summary;
    try {
      summary = await api.summarise(summarisePayload(session));
    } catch (err) {
      // /api/summarise degrades server-side, so this is a network failure.
      // Still never dead-end: build the end screen from what we already hold.
      summary = localSummary(session, err?.message);
    }
    if (!alive(token)) return;
    emit('mission-end', { summary, session });
  }

  return {
    /** @returns {ReturnType<createSession>|null} */
    getSession: () => session,
    getStep: () => (session ? stepById(session.scenario, session.stepId) : null),
    isBusy: () => busy,

    /**
     * Load a scenario at a level and run the opening beat.
     * @param {string} scenarioId
     * @param {1|2|3} level
     */
    async startMission(scenarioId, level) {
      const token = ++runToken;
      session = null;
      busy = true;
      emit('mission-loading', { scenarioId, level });
      let scenario;
      try {
        scenario = await api.getScenario(scenarioId, level);
      } catch (err) {
        busy = false;
        emit('error', { message: err?.message || 'Could not load the scenario.', kind: 'scenario', scenarioId, level });
        return;
      }
      if (token !== runToken) return;
      session = createSession(scenario, level);
      busy = false;
      emit('mission-start', { scenario, level, session });
      await enterStep(token, session.stepId, { withIntro: true });
    },

    /** Re-speak whatever was said last (replay button). */
    async replayLine() {
      if (!session || !lastLine) return { ok: false, reason: 'nothing to replay' };
      const token = runToken;
      emit('speaking', { who: lastLine.who, text: lastLine.text, replay: true });
      let result;
      if (player.hasClip()) {
        result = await player.replay();
      } else {
        result = { ok: false, reason: 'no clip' };
      }
      if (!result.ok) result = await speak(token, lastLine);
      else emit('speak-end', { who: lastLine.who, text: lastLine.text, ok: true });
      return result;
    },

    /** Speak one coaching line in the coach's own voice (on demand). */
    async speakCoach(text) {
      if (!text) return { ok: false };
      const token = runToken;
      return speak(token, { text, voiceId: COACH_VOICE, speed: 1, who: 'coach' });
    },

    /** Stop any playback — used when the player presses record early. */
    stopAudio() {
      interrupted = true;
      player.stop();
    },

    /**
     * Steps 4–11: a recorded blob goes in, the loop comes out the other side.
     * @param {Blob} blob
     * @param {string} [mimeType]
     */
    async submitRecording(blob, mimeType) {
      if (!session) return;
      const token = runToken;
      const { scenario } = session;
      const step = stepById(scenario, session.stepId);
      if (!step) return;
      const speaker = speakerFor(scenario, step);
      busy = true;

      // --- 4. STT
      emit('processing', { stage: 'stt' });
      let heard;
      try {
        heard = await api.stt(blob, mimeType);
      } catch (err) {
        busy = false;
        emit('error', {
          message: err?.message || 'We could not hear that. Please try again.',
          kind: 'stt',
          retryable: true,
        });
        return;
      }
      if (!alive(token)) return;

      const transcript = (heard?.text || '').trim();
      emit('transcript', { text: transcript, confidence: heard?.confidence ?? null });

      // --- 5. Empty transcript: no penalty, straight back to the mic.
      if (!transcript) {
        busy = false;
        emit('no-input', { message: NO_INPUT_MESSAGE, step });
        emit('ready-to-record', { step, reason: 'no-input' });
        return;
      }

      // --- 6. Evaluate
      emit('processing', { stage: 'eval' });
      let evaluation;
      try {
        evaluation = await api.evaluate({
          scenario_id: scenario.id,
          step_id: step.id,
          level: session.level,
          stt_transcript: transcript,
          stt_confidence: heard?.confidence ?? null,
          conversation_history: session.history.map(({ npc, player: p }) => ({ npc, player: p })),
          retry_count: session.retryCount,
        });
      } catch (err) {
        busy = false;
        // A system failure must never cost the learner points: nothing is
        // recorded, retry_count is untouched, the same step is re-offered.
        emit('error', {
          message: err?.message || 'Scoring failed. Your answer was not counted — try again.',
          kind: 'eval',
          retryable: true,
        });
        return;
      }
      if (!alive(token)) return;

      // --- 8. Transcript + score count-up + one coaching line
      emit('turn-result', { evaluation, step, transcript, speaker });

      // --- 10. Log the turn (no_input never scores and never enters history)
      if (evaluation.result !== 'no_input') {
        uncommittedTurn = step.id;
        recordTurn(session, {
          stepId: step.id,
          npc: step.tts_prompt,
          npcName: speaker.name,
          player: transcript,
          evaluation,
        });
      }

      // --- 9. The NPC reacts, in character, in its own voice
      emit('npc-line', {
        text: evaluation.npc_reply,
        speaker,
        state: evaluation.npc_state || 'idle',
        reaction: true,
      });
      await speak(token, {
        text: evaluation.npc_reply,
        voiceId: speaker.voiceId,
        speed: scenario.speed,
        who: 'npc',
      });
      if (!alive(token)) return;

      // --- 11. Branch. next_step_id is authoritative.
      const { isRetry, complete } = applyEvaluation(session, evaluation);
      uncommittedTurn = null;
      busy = false;

      if (complete) {
        await finish(token, speaker);
        return;
      }
      if (isRetry) {
        emit('retry-step', {
          step,
          retryCount: session.retryCount,
          freeRetry: !!evaluation.free_retry,
          hint: evaluation.improvement || step.retry_hint || '',
        });
        emit('ready-to-record', { step, reason: 'retry' });
        return;
      }
      await enterStep(token, session.stepId);
    },

    /**
     * The learner asks to redo the current step (transcript panel Retry).
     * Anything still in flight is abandoned, the turn just logged is undone,
     * and the SAME step is re-offered. retry_count is never touched: this path
     * never reaches applyEvaluation.
     */
    retryCurrentStep() {
      if (!session || session.finished) return false;
      const step = stepById(session.scenario, session.stepId);
      if (!step) return false;
      runToken += 1; // any in-flight evaluate/speak drops out at its next check
      if (uncommittedTurn) {
        dropLastTurn(session, uncommittedTurn);
        uncommittedTurn = null;
      }
      busy = false;
      interrupted = true;
      player.stop();
      emit('step-redo', { step, retryCount: session.retryCount });
      emit('ready-to-record', { step, reason: 'user-retry' });
      return true;
    },

    /** After a system error: re-offer the same step with no penalty. */
    retryAfterError() {
      if (!session) return;
      const step = stepById(session.scenario, session.stepId);
      if (!step) return;
      emit('ready-to-record', { step, reason: 'after-error' });
    },

    /** Re-speak the current step prompt (used by the "no dead end" recovery). */
    async repromptCurrentStep() {
      if (!session) return;
      const token = runToken;
      await enterStep(token, session.stepId);
    },

    /** Abandon the mission (home button). Any in-flight sequence is dropped. */
    abort() {
      runToken += 1;
      busy = false;
      session = null;
      lastLine = null;
      lastStepSpeaker = null;
      interrupted = true;
      player.stop();
      emit('aborted');
    },
  };
}

/**
 * Last-resort end screen data if even /api/summarise is unreachable.
 * Mirrors the server's fallback shape so the screen code has one contract.
 */
export function localSummary(session, reason) {
  const scores = session.turnScores.map((t) => t.overall_score).filter((n) => Number.isFinite(n));
  const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 60;
  const band =
    overall >= 90 ? 'power' : overall >= 75 ? 'mission_passed' : overall >= 55 ? 'almost' : 'retry';
  const bandLabel =
    band === 'power' ? 'Power!' : band === 'mission_passed' ? 'Mission Passed' : band === 'almost' ? 'Almost' : 'Try Again';
  return {
    scenario_id: session.scenario.id,
    level: session.level,
    badge: session.scenario.badge || '',
    overall_score: overall,
    band,
    band_label: bandLabel,
    verdict: overall >= 75 ? 'Dah boleh cakap.' : 'Hampir dah — cuba sekali lagi.',
    summary:
      'Anda telah menghabiskan perbualan ini. Skor di atas dikira daripada giliran-giliran anda kerana ringkasan penuh tidak dapat dimuatkan.',
    strengths: ['Anda terus bercakap sehingga habis perbualan.'],
    improvements: ['Cuba sekali lagi untuk maklum balas yang lebih terperinci.'],
    bm_upgrades: [],
    source: 'offline',
    fallback: true,
    offline_reason: reason || null,
  };
}
