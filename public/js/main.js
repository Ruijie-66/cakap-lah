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
import { COACH_VOICE } from '/js/game/state.js';
import { createUI, LEVEL_NAMES } from '/js/ui/screens.js';

const ui = createUI();
const player = createPlayer();
const visualiser = createVisualiser(ui.el.viz);

let level = 1;
let lastScenarioId = null;
let recorder = null;
let npcRestState = 'idle';
let lastSummary = null;
let armTimer = 0;
let errorAction = null; // what the error panel's "Cuba lagi" should do

ui.setMockBadge(api.isMockMode());
ui.setLevel(level);

// ─────────────────────────────── engine ────────────────────────────────
const engine = createEngine({ api, player, emit: handleEvent });

function handleEvent(type, payload = {}) {
  switch (type) {
    case 'mission-loading':
      ui.showScreen('play');
      ui.clearTurnPanels();
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
      // The previous turn's score and transcript stay up while the next prompt
      // plays — they only clear when the player starts speaking again.
      ui.hideError();
      ui.setSpeaker(payload.speaker);
      ui.setPortraitState('idle');
      npcRestState = 'idle';
      ui.setHint(payload.hint);
      ui.setSteps(payload.stepCount, payload.stepNumber - 1);
      ui.setNpcLine(payload.step.tts_prompt);
      ui.setPhase(`Giliran ${payload.stepNumber} / ${payload.stepCount}`);
      ui.setMic('wait', 'Dengar dulu…');
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
      ui.setPhase(
        payload.who === 'narrator'
          ? 'Narrator bercakap…'
          : payload.who === 'coach'
            ? 'Coach bercakap…'
            : `${ui.el.npcName.textContent || 'NPC'} bercakap…`,
      );
      if (payload.who !== 'coach') ui.setMic('ready', 'Tekan untuk potong & cakap');
      ui.setPipeline(payload.who === 'npc' ? 'tts' : null);
      break;

    case 'speak-end':
      ui.setPortraitState(npcRestState);
      ui.setPipeline(null);
      break;

    case 'voice-warning':
      ui.showNotice(`Suara tak dapat dimainkan — baca teksnya di atas. (${payload.message || 'ralat audio'})`, 'warn');
      break;

    case 'ready-to-record':
      armMic(payload.reason);
      break;

    case 'processing':
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
      errorAction = payload.kind === 'scenario' ? 'home' : 'retry-turn';
      break;

    case 'mission-end':
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
  if (!isRecordingSupported()) {
    handleEvent('error', {
      message: 'This browser cannot record audio. Try Chrome or Edge on a desktop, over https or localhost.',
      kind: 'mic',
    });
    return;
  }
  ui.setMic('ready', 'Bersedia… mic akan buka');
  ui.setPhase(reason === 'retry' ? 'Cuba sekali lagi — cakap bila sedia.' : 'Giliran anda.');
  armTimer = setTimeout(() => startRecording(), 350);
}

async function startRecording() {
  cancelArm();
  const rec = ensureRecorder();
  if (rec.isRecording()) return;
  engine.stopAudio();
  ui.hideError();
  ui.clearTurnResult();
  // The last notice ("Tak dengar tadi…", the retry hint) stays up while the
  // player speaks — it is the instruction for the attempt they are making.
  ui.setMic('busy', 'Membuka mic…');
  try {
    await rec.start();
  } catch (err) {
    ui.setMic('ready', 'Tekan untuk cuba lagi');
    handleEvent('error', { message: err?.message || 'The microphone could not be started.', kind: 'mic' });
    return;
  }
  const analyser = rec.getAnalyser();
  if (analyser) visualiser.start(analyser);
  ui.setTimer(0);
  ui.setMic('recording');
  ui.setPhase('Cakap sekarang… (maksimum 20 saat)');
}

async function stopAndSubmit() {
  const rec = recorder;
  if (!rec) return;
  visualiser.stop();
  ui.setMic('busy', 'Menghantar…');
  let captured;
  try {
    captured = await rec.stop();
  } catch (err) {
    ui.setMic('ready', 'Tekan untuk cuba lagi');
    handleEvent('error', { message: err?.message || 'Nothing was recorded. Try again.', kind: 'mic' });
    return;
  }
  // A blip of a recording (fumbled button, mic opened and closed) is not a
  // system error and must not read like one: same friendly path as silence.
  if (!captured.blob || captured.blob.size < 1200 || captured.durationMs < 400) {
    ui.showTranscript('');
    handleEvent('no-input', { message: NO_INPUT_MESSAGE });
    armMic('no-input');
    return;
  }
  await engine.submitRecording(captured.blob, captured.mimeType);
}

function stopRecordingSilently() {
  visualiser.stop();
  if (recorder?.isRecording()) recorder.cancel();
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

ui.el.replayBtn.addEventListener('click', () => engine.replayLine());

ui.el.coachBtn.addEventListener('click', () => {
  const text = ui.el.coachBtn.dataset.text || ui.el.coachLine.textContent;
  engine.speakCoach(text);
});

ui.el.errorRetryBtn.addEventListener('click', () => {
  ui.hideError();
  if (errorAction === 'home') {
    goHome();
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
  stopRecordingSilently();
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

// Handy for verification from the console; harmless in production.
window.CAKAP = {
  engine,
  ui,
  api,
  startMission,
  setLevel: (n) => {
    level = Number(n);
    ui.setLevel(level);
  },
  getLevel: () => level,
  levelName: (n) => LEVEL_NAMES[n],
  coachVoice: COACH_VOICE,
  recorder: () => recorder,
};
