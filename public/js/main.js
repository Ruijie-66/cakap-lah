// public/js/main.js — bootstrap and wiring.
//
// Everything reusable lives elsewhere: api.js (network), audio/* (mic, canvas,
// playback), game/* (state, loop, scoring), ui/screens.js (DOM). This file only
// connects them and owns the microphone lifecycle.

import * as api from '/js/api.js';
import { createRecorder, isRecordingSupported, MAX_RECORDING_MS } from '/js/audio/recorder.js';
import { createVisualiser } from '/js/audio/visualiser.js';
import { createPlayer } from '/js/audio/player.js';
import { createEngine, NO_INPUT_MESSAGE } from '/js/game/engine.js';
import { createUI } from '/js/ui/screens.js';

const ui = createUI();
const player = createPlayer();
// Mamak-neon bars, and the live level fed back into CSS so the mic button
// itself swells with the voice. This is the "we are listening" moment.
const visualiser = createVisualiser(ui.el.viz, {
  style: 'bars',
  color: '#ff3d7f',
  colorLow: '#ffb340',
  colorHigh: '#ff3d7f',
  glow: 'rgba(255, 61, 127, 0.55)',
  idleColor: 'rgba(255, 255, 255, 0.14)',
  onLevel: (level) => ui.setMicLevel(level),
});

let level = 1;
let lastScenarioId = null;
let recorder = null;
let npcRestState = 'idle';
let lastSummary = null;
let armTimer = 0;
let errorAction = null; // what the error panel's "Cuba lagi" should do
let submitting = false; // guards the STOP-click / auto-stop race
// True from the instant the player asks for the mic until the clip is captured.
// `recorder.isRecording()` only flips true several awaits into start(), and the
// cancelled speak() re-emits ready-to-record within a microtask of the stop —
// so the flag, not the recorder, is what makes armMic a no-op on barge-in.
let micHeld = false;

/**
 * True while the player owns the microphone — from the instant they ask for it
 * until the clip is captured.
 *
 * Barge-in makes the engine and the mic run concurrently: the cancelled
 * `speak()` resolves, the engine walks on to the next beat, and its `step` /
 * `speaking` events arrive while the recording is still running. Rendering the
 * engine's idea of the mic state then would disable the STOP button and drop
 * `body[data-mic]` out of `recording` — a dead control and a UI claiming it is
 * not recording while the visualiser is still moving. The live recording always
 * outranks the engine: everything else on those events still renders, only the
 * mic state and the phase text defer.
 */
const micBusy = () => micHeld || !!recorder?.isRecording();

ui.setMockBadge(api.isMockMode());
ui.setLevel(level);

// ─────────────────────────────── engine ────────────────────────────────
const engine = createEngine({ api, player, emit: handleEvent });

function handleEvent(type, payload = {}) {
  switch (type) {
    case 'mission-loading':
      ui.showScreen('play');
      ui.clearTurnPanels();
      // The previous mission's scene and portrait must not linger here.
      ui.resetStage();
      ui.setNarrator('');
      ui.setNpcLine('Memuatkan misi…');
      ui.setPhase('Memuatkan…');
      ui.setMic('wait', 'Tunggu…');
      break;

    case 'mission-start':
      ui.setScenario(payload.scenario, payload.level);
      ui.setSpeaker({ name: payload.scenario.npc_name, portrait: payload.scenario.portrait });
      break;

    case 'step':
      cancelArm();
      // A new step: the previous turn's transcript can no longer be redone.
      ui.setTranscriptRetry('off');
      // The previous turn's score and transcript stay up while the next prompt
      // plays — they only clear when the player starts speaking again.
      ui.hideError();
      ui.setSpeaker(payload.speaker);
      ui.setPortraitState('idle');
      npcRestState = 'idle';
      ui.setHint(payload.hint);
      ui.setSteps(payload.stepCount, payload.stepNumber - 1);
      ui.setNpcLine(payload.step.tts_prompt);
      if (!micBusy()) {
        ui.setPhase(`Giliran ${payload.stepNumber} / ${payload.stepCount}`);
        ui.setMic('wait', 'Dengar dulu…');
      }
      break;

    case 'narrator':
      ui.setNarrator(payload.text);
      break;

    case 'npc-line':
      ui.setSpeaker(payload.speaker);
      ui.setNpcLine(payload.text);
      npcRestState = payload.state || 'idle';
      ui.setPortraitState(npcRestState);
      break;

    case 'speaking':
      ui.setPortraitState(payload.who === 'npc' ? 'talking' : npcRestState);
      if (!micBusy()) {
        ui.setPhase(
          payload.who === 'narrator'
            ? 'Narrator bercakap…'
            : payload.who === 'coach'
              ? 'Coach bercakap…'
              : `${ui.el.npcName.textContent || 'NPC'} bercakap…`,
        );
        if (payload.who !== 'coach') ui.setMic('ready', 'Tekan untuk potong & cakap');
      }
      ui.setPipeline(payload.who === 'npc' ? 'tts' : null);
      break;

    case 'speak-end':
      ui.setPortraitState(npcRestState);
      ui.setPipeline(null);
      // The intro is scene-setting, said once. Left up it costs ~62px of
      // vertical space for the whole mission, which pushes the score chips
      // below a 720p fold. Clear it as soon as it has actually been HEARD; if
      // the voice failed, the text is the only copy of the intro, so it stays
      // until the player starts speaking (see startRecording).
      if (payload.who === 'narrator' && payload.ok) ui.setNarrator('');
      break;

    case 'voice-warning':
      ui.showNotice(`Suara tak dapat dimainkan — baca teksnya di atas. (${payload.message || 'ralat audio'})`, 'warn');
      break;

    case 'ready-to-record':
      armMic(payload.reason);
      break;

    case 'processing':
      ui.setTranscriptRetry('busy');
      ui.setPipeline(payload.stage === 'summary' ? null : payload.stage);
      ui.setMic('busy', payload.stage === 'stt' ? 'Menghantar suara…' : 'Memproses…');
      ui.setPhase(
        {
          stt: '🎧 Mendengar suara anda…',
          eval: '🧠 Menilai maksud anda…',
          summary: '📋 Menyiapkan laporan misi…',
        }[payload.stage] || 'Memproses…',
      );
      break;

    case 'transcript':
      ui.showTranscript(payload.text);
      break;

    case 'no-input':
      ui.showNotice(payload.message, 'warn');
      ui.setPhase('Tiada suara dikesan — tiada penalti.');
      break;

    case 'turn-result':
      ui.showTurnResult(payload.evaluation);
      // Misheard? The learner can redo this same step from here, free.
      ui.setTranscriptRetry('on');
      break;

    case 'step-redo':
      ui.clearTurnResult();
      ui.showNotice('Cuba lagi giliran ini — tiada penalti.', 'info');
      break;

    case 'retry-step':
      ui.showNotice(payload.hint ? `Cuba lagi: ${payload.hint}` : 'Cuba sekali lagi.', 'info');
      break;

    case 'error':
      cancelArm();
      stopRecordingSilently();
      ui.setPipeline(null);
      ui.setMic('wait', 'Tekan “Cuba lagi”');
      ui.setPhase('Ada masalah teknikal — markah anda tidak terjejas.');
      ui.showError(payload.message);
      // A scenario that failed to load is the one error a cold-start network
      // hiccup actually produces, and it is retryable: reload the same mission
      // at the same level. "Balik menu" beside it is the way out.
      errorAction = payload.kind === 'scenario' ? 'reload-mission' : 'retry-turn';
      break;

    case 'mission-end':
      ui.setTranscriptRetry('off');
      // The mission is over: hand the microphone back to the OS. Holding one
      // getUserMedia stream open for the whole session leaves the browser and
      // system recording indicators lit and makes the next mission reuse a
      // stale stream. The next mission builds a fresh recorder.
      disposeRecorder();
      lastSummary = payload.summary;
      ui.renderEnd(payload.summary, payload.session);
      ui.showScreen('end');
      speakVerdict(payload.summary);
      break;

    case 'aborted':
      cancelArm();
      stopRecordingSilently();
      break;

    default:
      break;
  }
}

// ───────────────────────────── microphone ──────────────────────────────
function ensureRecorder() {
  if (recorder) return recorder;
  recorder = createRecorder({
    maxMs: MAX_RECORDING_MS,
    onTick: (ms) => ui.setTimer(ms),
    onAutoStop: () => {
      ui.setPhase('Had 20 saat — kami hantar apa yang ada.');
      stopAndSubmit();
    },
    onError: (err) => handleEvent('error', { message: err.message, kind: 'mic' }),
  });
  return recorder;
}

function cancelArm() {
  clearTimeout(armTimer);
  armTimer = 0;
}

/** Auto-arm shortly after the audio ends; a manual press also works. */
function armMic(reason) {
  cancelArm();
  // Barge-in: the cancelled `speak` still emits ready-to-record, and the player
  // is already recording. Re-arming here would overwrite the phase text and
  // leave the button reading CAKAP while the mic is live.
  if (micHeld || recorder?.isRecording()) return;
  if (!isRecordingSupported()) {
    handleEvent('error', {
      message: 'This browser cannot record audio. Try Chrome or Edge on a desktop, over https or localhost.',
      kind: 'mic',
    });
    return;
  }
  ui.setMic('ready', 'Bersedia… mic akan buka');
  ui.setPhase(reason === 'retry' ? 'Cuba sekali lagi — cakap bila sedia.' : 'Giliran anda.');
  ui.setTranscriptRetry(ui.el.transcriptPanel.hidden ? 'off' : 'on');
  armTimer = setTimeout(() => startRecording(), 350);
}

async function startRecording() {
  cancelArm();
  const rec = ensureRecorder();
  if (micHeld || rec.isRecording()) return;
  micHeld = true;
  ui.setTranscriptRetry('off');
  engine.stopAudio();
  ui.hideError();
  ui.clearTurnResult();
  // Belt and braces for the narrator box: once the player is speaking, the
  // intro has served its purpose whether or not its audio ever played.
  ui.setNarrator('');
  // The last notice ("Tak dengar tadi…", the retry hint) stays up while the
  // player speaks — it is the instruction for the attempt they are making.
  ui.setMic('busy', 'Membuka mic…');
  try {
    await rec.start();
  } catch (err) {
    micHeld = false;
    ui.setMic('ready', 'Tekan untuk cuba lagi');
    handleEvent('error', { message: err?.message || 'The microphone could not be started.', kind: 'mic' });
    return;
  }
  const analyser = rec.getAnalyser();
  if (analyser) visualiser.start(analyser);
  ui.setTimer(0);
  submitting = false;
  ui.setMic('recording');
  ui.setPhase('Cakap sekarang… (maksimum 20 saat)');
}

async function stopAndSubmit() {
  const rec = recorder;
  if (!rec) return;
  // The 20 s auto-stop and a STOP click can land together; the disabled button
  // makes the window small, not zero.
  if (submitting) return;
  submitting = true;
  visualiser.stop();
  ui.setMic('busy', 'Menghantar…');
  let captured;
  try {
    captured = await rec.stop();
  } catch (err) {
    submitting = false;
    micHeld = false;
    ui.setMic('ready', 'Tekan untuk cuba lagi');
    handleEvent('error', { message: err?.message || 'Nothing was recorded. Try again.', kind: 'mic' });
    return;
  }
  micHeld = false;
  // A blip of a recording (fumbled button, mic opened and closed) is not a
  // system error and must not read like one: same friendly path as silence.
  if (!captured.blob || captured.blob.size < 1200 || captured.durationMs < 400) {
    ui.showTranscript('');
    handleEvent('no-input', { message: NO_INPUT_MESSAGE });
    submitting = false;
    armMic('no-input');
    return;
  }
  await engine.submitRecording(captured.blob, captured.mimeType);
}

function stopRecordingSilently() {
  visualiser.stop();
  submitting = false;
  micHeld = false;
  if (recorder?.isRecording()) recorder.cancel();
}

/**
 * Release the microphone entirely: stop the media tracks, close the
 * AudioContext, and drop the recorder so the next mission builds a new one and
 * calls getUserMedia again.
 *
 * Call this only at mission boundaries. WITHIN a mission the single stream is
 * deliberately kept open and shared by the MediaRecorder and the visualiser's
 * AnalyserNode — reopening the mic between turns would add latency and, in
 * some browsers, a fresh permission prompt mid-conversation.
 */
function disposeRecorder() {
  cancelArm();
  visualiser.stop();
  submitting = false;
  micHeld = false;
  const rec = recorder;
  recorder = null;
  if (rec) {
    try {
      rec.dispose();
    } catch {
      /* teardown must never block leaving the mission */
    }
  }
  ui.setMicLevel(0);
  ui.setTimer(0);
}

// ───────────────────────────── UI wiring ───────────────────────────────
ui.el.micBtn.addEventListener('click', () => {
  const mode = ui.el.micBtn.dataset.mode;
  if (mode === 'recording') stopAndSubmit();
  else startRecording();
});

ui.el.levelBtns.forEach((btn) =>
  btn.addEventListener('click', () => {
    level = Number(btn.dataset.level) || 1;
    ui.setLevel(level);
  }),
);

// Retry beside the transcript: re-record the SAME step. It is not a scored
// retry — retry_count is only touched by the server's branch decision, and this
// path never reaches applyEvaluation, so the attempt costs the learner nothing.
ui.el.transcriptRetryBtn.addEventListener('click', () => {
  if (micHeld || recorder?.isRecording()) return;
  ui.setTranscriptRetry('off');
  if (!engine.retryCurrentStep()) return;
  ui.setPhase('Cuba sekali lagi — tiada penalti.');
});

ui.el.replayBtn.addEventListener('click', () => engine.replayLine());

ui.el.coachBtn.addEventListener('click', () => {
  const text = ui.el.coachBtn.dataset.text || ui.el.coachLine.textContent;
  engine.speakCoach(text);
});

ui.el.errorRetryBtn.addEventListener('click', () => {
  ui.hideError();
  if (errorAction === 'reload-mission') {
    if (lastScenarioId) startMission(lastScenarioId);
    else goHome();
    return;
  }
  engine.retryAfterError();
});

ui.el.errorHomeBtn.addEventListener('click', goHome);
ui.el.quitBtn.addEventListener('click', goHome);
ui.el.homeBtn.addEventListener('click', goHome);
ui.el.againBtn.addEventListener('click', () => {
  if (lastScenarioId) startMission(lastScenarioId);
});
ui.el.verdictSpeakBtn.addEventListener('click', () => {
  if (lastSummary) engine.speakCoach(`${lastSummary.verdict} ${lastSummary.summary || ''}`.trim());
});

function goHome() {
  cancelArm();
  // Quitting a mission releases the mic too — the home screen never records.
  disposeRecorder();
  engine.abort();
  ui.setPipeline(null);
  ui.clearTurnPanels();
  ui.showScreen('home');
}

function startMission(scenarioId) {
  lastScenarioId = scenarioId;
  engine.startMission(scenarioId, level);
}

async function speakVerdict(summary) {
  if (!summary?.verdict) return;
  await engine.speakCoach(summary.verdict);
}

// Closing or backgrounding the tab must not leave the OS recording indicator
// lit. `pagehide` fires for navigation, reload and bfcache alike.
window.addEventListener('pagehide', () => disposeRecorder());

// ────────────────────────────── boot ───────────────────────────────────
async function loadHome() {
  try {
    const { scenarios } = await api.getScenarios();
    ui.renderScenarioCards(scenarios, startMission);
  } catch (err) {
    ui.renderCardsError(err?.message || 'Could not load the missions.', loadHome);
  }
}

loadHome();
