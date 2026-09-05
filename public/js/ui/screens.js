// public/js/ui/screens.js — every screen, every transition, all the DOM.
//
// Art policy: the CSS/SVG fallback is the DEFAULT. Real art (if it ever lands
// in public/assets/) is loaded opportunistically and simply replaces the
// fallback; if a file is missing, nothing changes and nothing breaks.

import { bandFlavour, bandForTurn, countUp } from '../game/scoring.js';

const $ = (id) => document.getElementById(id);

/** Level names shown on screen. */
export const LEVEL_NAMES = { 1: 'Santai', 2: 'Biasa', 3: 'Power' };

/** Emoji stand-ins used by the SVG portrait fallback. */
const PORTRAIT_FACE = {
  'abang-mamak': { glyph: '🧔🏽', hue: 28 },
  'abang-guard': { glyph: '👮🏽', hue: 205 },
  makcik: { glyph: '👩🏽', hue: 320 },
  'kak-ana': { glyph: '👩🏽‍💼', hue: 265 },
};

const SCENE_EMOJI = { mamak: '🫖', mall: '🛍️', office: '💼' };


/** Left-to-right order of the visible pipeline. `summary` is not on the rail. */
const PIPELINE_ORDER = ['stt', 'eval', 'tts'];

/** Publish 0..1 mic loudness as a CSS variable — the mic halo breathes on it. */
function publishMicLevel(level) {
  const holder = document.querySelector('.mic-holder');
  if (holder) holder.style.setProperty('--lvl', String(Math.max(0, Math.min(1, Number(level) || 0))));
}

export function createUI() {
  const el = {
    screens: {
      home: $('screen-home'),
      play: $('screen-play'),
      end: $('screen-end'),
    },
    mockBadge: $('mockBadge'),
    quitBtn: $('quitBtn'),
    againBtn: $('againBtn'),
    homeBtn: $('homeBtn'),
    verdictSpeakBtn: $('verdictSpeakBtn'),
    cards: $('scenarioCards'),
    levelBtns: [...document.querySelectorAll('.level-btn')],

    scene: $('scene'),
    sceneArt: $('sceneArt'),
    playTitle: $('playTitle'),
    playContext: $('playContext'),
    playLevel: $('playLevel'),
    stepDots: $('stepDots'),
    narratorBox: $('narratorBox'),
    narratorText: $('narratorText'),
    portrait: $('portrait'),
    portraitImg: $('portraitImg'),
    portraitFallback: $('portraitFallback'),
    npcName: $('npcName'),
    npcLine: $('npcLine'),
    taskHint: $('taskHint'),
    replayBtn: $('replayBtn'),

    phaseLabel: $('phaseLabel'),
    micBtn: $('micBtn'),
    micHint: $('micHint'),
    micLabel: $('micLabel'),
    timer: $('timer'),
    viz: $('viz'),
    pipeline: $('pipeline'),

    transcriptPanel: $('transcriptPanel'),
    transcriptText: $('transcriptText'),
    transcriptRetryBtn: $('transcriptRetryBtn'),
    resultPanel: $('resultPanel'),
    scoreNum: $('scoreNum'),
    bandLabel: $('bandLabel'),
    coachLine: $('coachLine'),
    coachBtn: $('coachBtn'),
    subScores: $('subScores'),
    noticePanel: $('noticePanel'),
    errorPanel: $('errorPanel'),
    errorText: $('errorText'),
    errorRetryBtn: $('errorRetryBtn'),
    errorHomeBtn: $('errorHomeBtn'),

    endRing: $('endRing'),
    endScore: $('endScore'),
    endBand: $('endBand'),
    endVerdict: $('endVerdict'),
    endBadge: $('endBadge'),
    endSummary: $('endSummary'),
    endStrengths: $('endStrengths'),
    endImprovements: $('endImprovements'),
    endUpgrades: $('endUpgrades'),
    endUpgradesPanel: $('endUpgradesPanel'),
    endTranscript: $('endTranscript'),
  };

  let cancelCount = null;
  // Art loads asynchronously; a stale probe must never paint over a newer
  // speaker's portrait.
  let speakerToken = 0;

  const ui = {
    el,

    /** @param {'home'|'play'|'end'} name */
    showScreen(name) {
      for (const [key, node] of Object.entries(el.screens)) {
        node.classList.toggle('is-active', key === name);
      }
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    },

    setMockBadge(on) {
      el.mockBadge.hidden = !on;
    },

    // ── Home ────────────────────────────────────────────────────────────
    renderScenarioCards(scenarios, onPick) {
      el.cards.removeAttribute('aria-busy');
      el.cards.innerHTML = '';
      scenarios.forEach((s, i) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'card-btn';
        card.dataset.scene = s.scene;
        card.dataset.id = s.id;
        card.innerHTML = `
          <span class="card-art" aria-hidden="true">${SCENE_EMOJI[s.scene] || '🎙️'}</span>
          <span class="card-body">
            <span class="card-no">Misi ${i + 1}</span>
            <span class="card-title"></span>
            <span class="card-context"></span>
            <span class="card-npc"></span>
          </span>`;
        card.querySelector('.card-title').textContent = s.title;
        card.querySelector('.card-context').textContent = s.context;
        card.querySelector('.card-npc').textContent = `${s.npc_name} · ${s.badge}`;
        loadArt(`/assets/scenes/${s.scene}.jpg`, (url) => {
          card.querySelector('.card-art').style.backgroundImage = `url("${url}")`;
          card.querySelector('.card-art').classList.add('has-art');
        });
        card.addEventListener('click', () => onPick(s.id));
        el.cards.appendChild(card);
      });
    },

    renderCardsError(message, onRetry) {
      el.cards.removeAttribute('aria-busy');
      el.cards.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'panel error-panel is-shown';
      const p = document.createElement('p');
      p.className = 'err-text';
      p.textContent = message;
      const btn = document.createElement('button');
      btn.className = 'primary-btn';
      btn.textContent = 'Cuba lagi';
      btn.addEventListener('click', onRetry);
      box.append(p, btn);
      el.cards.appendChild(box);
    },

    setLevel(level) {
      el.levelBtns.forEach((b) => {
        const on = Number(b.dataset.level) === Number(level);
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    },

    // ── Play: scene + character ─────────────────────────────────────────
    setScenario(scenario, level) {
      el.scene.dataset.scene = scenario.scene || 'mamak';
      el.sceneArt.style.backgroundImage = '';
      loadArt(`/assets/scenes/${scenario.scene}.jpg`, (url) => {
        el.sceneArt.style.backgroundImage = `url("${url}")`;
        el.sceneArt.classList.add('has-art');
      });
      el.playTitle.textContent = scenario.title;
      el.playLevel.textContent = `Tahap ${level} · ${LEVEL_NAMES[level] || ''}`;
      el.playContext.hidden = !scenario.context;
      el.playContext.textContent = scenario.context || '';
    },

    /**
     * Blank the stage between missions: the previous mission's scene art and
     * portrait must not sit there while the next one loads.
     */
    resetStage() {
      speakerToken += 1;
      el.scene.removeAttribute('data-scene');
      el.sceneArt.style.backgroundImage = '';
      el.sceneArt.classList.remove('has-art');
      el.playTitle.textContent = '—';
      el.playContext.hidden = true;
      el.playContext.textContent = '';
      el.stepDots.innerHTML = '';
      el.npcName.textContent = '';
      el.portrait.style.setProperty('--hue', '210');
      el.portrait.dataset.state = 'idle';
      el.portraitImg.hidden = true;
      el.portraitImg.removeAttribute('src');
      el.portraitFallback.hidden = false;
      el.portraitFallback.textContent = '…';
      el.taskHint.hidden = true;
      el.taskHint.textContent = '';
    },

    setSteps(count, index) {
      el.stepDots.innerHTML = '';
      for (let i = 0; i < count; i += 1) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        if (i < index) dot.classList.add('done');
        if (i === index) dot.classList.add('now');
        el.stepDots.appendChild(dot);
      }
    },

    setSpeaker(speaker) {
      el.npcName.textContent = speaker?.name || '';
      const key = speaker?.portrait || '';
      const face = PORTRAIT_FACE[key] || { glyph: '🧑', hue: 200 };
      const token = ++speakerToken;
      el.portrait.style.setProperty('--hue', String(face.hue));
      el.portraitFallback.textContent = face.glyph;
      // Emoji first, always. Real art replaces it — .portrait is a grid, so the
      // fallback must go away or both would render side by side.
      el.portraitFallback.hidden = false;
      el.portraitImg.hidden = true;
      el.portraitImg.removeAttribute('src');
      if (key) {
        loadArt(`/assets/npc/${key}.png`, (url) => {
          if (token !== speakerToken) return; // a newer speaker won the race
          el.portraitImg.src = url;
          el.portraitImg.hidden = false;
          el.portraitFallback.hidden = true;
        });
      }
    },

    /** @param {'idle'|'talking'|'pleased'|'annoyed'} state */
    setPortraitState(state) {
      el.portrait.dataset.state = state || 'idle';
    },

    setNarrator(text) {
      el.narratorBox.hidden = !text;
      el.narratorText.textContent = text || '';
    },

    setNpcLine(text) {
      el.npcLine.textContent = text || '';
    },

    setHint(hint) {
      if (!hint) {
        el.taskHint.hidden = true;
        el.taskHint.textContent = '';
        return;
      }
      el.taskHint.hidden = false;
      el.taskHint.dataset.lang = hint.lang;
      el.taskHint.textContent = hint.text;
    },

    // ── Play: dock ──────────────────────────────────────────────────────
    setPhase(text) {
      el.phaseLabel.textContent = text;
    },

    /** @param {'wait'|'ready'|'recording'|'busy'} mode */
    setMic(mode, hintText) {
      const map = {
        wait: { label: 'MIC', disabled: true, hint: hintText ?? 'Tunggu…' },
        ready: { label: 'CAKAP', disabled: false, hint: hintText ?? 'Tekan bila sedia' },
        recording: { label: 'STOP', disabled: false, hint: hintText ?? 'Cakap sekarang…' },
        busy: { label: '…', disabled: true, hint: hintText ?? 'Memproses…' },
      };
      const cfg = map[mode] || map.wait;
      // The button holds an SVG icon — never overwrite its content.
      el.micLabel.textContent = cfg.label;
      el.micBtn.disabled = cfg.disabled;
      el.micBtn.dataset.mode = mode;
      el.micBtn.setAttribute('aria-label', cfg.hint);
      // The recording state is the loudest thing in the app: the dock, the
      // visualiser frame and the REC badge all key off this one attribute.
      document.body.dataset.mic = mode;
      if (mode !== 'recording') {
        publishMicLevel(0);
        // A stale "21.0s" sitting under an idle mic reads like a bug.
        if (mode === 'ready' || mode === 'wait') {
          el.timer.textContent = '0.0s';
          el.timer.classList.remove('near-cap');
        }
      }
      el.micHint.textContent = cfg.hint;
      el.micHint.classList.toggle('live', mode === 'recording');
    },

    setTimer(ms) {
      el.timer.textContent = `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
      el.timer.classList.toggle('near-cap', ms >= 16000);
    },

    /**
     * The STT → evaluate → TTS pipeline, shown as it happens. Stages already
     * passed are ticked off so a viewer can see the work move along the rail
     * rather than watching one anonymous spinner.
     * @param {'stt'|'eval'|'tts'|'summary'|null} stage
     */
    setPipeline(stage) {
      el.pipeline.hidden = !stage;
      const at = PIPELINE_ORDER.indexOf(stage);
      [...el.pipeline.querySelectorAll('.pipe-step')].forEach((node) => {
        const i = PIPELINE_ORDER.indexOf(node.dataset.stage);
        node.classList.toggle('is-on', stage != null && i === at);
        node.classList.toggle('is-done', at > -1 && i > -1 && i < at);
      });
    },

    /** 0..1 mic loudness, published to CSS so the mic glow breathes with it. */
    setMicLevel(level) {
      publishMicLevel(level);
    },

    /** Clear only the previous turn's transcript + score, keeping notices. */
    clearTurnResult() {
      el.transcriptPanel.hidden = true;
      el.resultPanel.hidden = true;
      el.transcriptText.textContent = '';
    },

    /**
     * The transcript panel's Retry control.
     * @param {'on'|'busy'|'off'} state
     */
    setTranscriptRetry(state) {
      el.transcriptRetryBtn.hidden = state === 'off';
      el.transcriptRetryBtn.disabled = state !== 'on';
    },

    clearTurnPanels() {
      el.transcriptPanel.hidden = true;
      el.resultPanel.hidden = true;
      el.noticePanel.hidden = true;
      el.errorPanel.hidden = true;
      el.transcriptText.textContent = '';
      el.transcriptRetryBtn.hidden = true;
    },

    showTranscript(text) {
      // Nothing heard: the "Tak dengar tadi" notice says it. An empty panel
      // showing "—" beside it is just noise.
      if (!text) {
        el.transcriptPanel.hidden = true;
        el.transcriptText.textContent = '';
        el.transcriptRetryBtn.hidden = true;
        return;
      }
      el.transcriptPanel.hidden = false;
      el.transcriptText.textContent = `“${text}”`;
      el.transcriptRetryBtn.hidden = false;
      el.transcriptRetryBtn.disabled = true; // enabled once the mic is free
    },

    /** Turn score counting up + band label + one coaching line. */
    showTurnResult(evaluation) {
      el.errorPanel.hidden = true;
      const band = bandForTurn(evaluation);
      // No transcript → no score shown at all.
      if (!evaluation?.scored || !band) {
        el.resultPanel.hidden = true;
        return;
      }
      el.resultPanel.hidden = false;
      el.resultPanel.dataset.band = band.band;
      el.bandLabel.textContent = band.label;
      cancelCount?.();
      el.scoreNum.textContent = '0';
      // The band only stamps in once the number has landed — that ordering is
      // the beat: number climbs, verdict hits.
      el.resultPanel.classList.remove('is-landed');
      cancelCount = countUp(el.scoreNum, evaluation.overall_score, {
        durationMs: 900,
        onDone: () => el.resultPanel.classList.add('is-landed'),
      });

      const coaching =
        evaluation.result === 'success'
          ? evaluation.what_worked || bandFlavour(band.band)
          : evaluation.improvement || evaluation.what_worked || bandFlavour(band.band);
      // ONE coaching line — the band flavour is only a stand-in when the
      // evaluator gave us nothing of its own.
      el.coachLine.textContent = coaching;
      el.coachBtn.dataset.text = coaching || '';

      el.subScores.innerHTML = '';
      const parts = [
        ['Maksud', evaluation.intent_score],
        ['Isi', evaluation.semantic_score],
        ['Jelas', evaluation.comprehensibility_score],
        ['Natural', evaluation.naturalness_score],
      ];
      for (const [label, value] of parts) {
        if (value == null) continue;
        const chip = document.createElement('span');
        chip.className = 'sub-chip';
        chip.innerHTML = `<b></b><i></i>`;
        chip.querySelector('b').textContent = label;
        chip.querySelector('i').textContent = String(value);
        el.subScores.appendChild(chip);
      }
      if (evaluation.retry_capped) {
        const chip = document.createElement('span');
        chip.className = 'sub-chip warn';
        chip.textContent = 'Jom teruskan — separuh markah';
        el.subScores.appendChild(chip);
      }
      if (evaluation.fallback) {
        const chip = document.createElement('span');
        chip.className = 'sub-chip warn';
        chip.textContent = 'Penilai simpanan';
        el.subScores.appendChild(chip);
      }
    },

    /** @param {'info'|'warn'} [tone] */
    showNotice(text, tone = 'info') {
      el.noticePanel.hidden = !text;
      el.noticePanel.dataset.tone = tone;
      el.noticePanel.textContent = text || '';
    },

    hideNotice() {
      el.noticePanel.hidden = true;
    },

    showError(message) {
      el.errorPanel.hidden = false;
      el.errorText.textContent = message;
    },

    hideError() {
      el.errorPanel.hidden = true;
    },

    // ── Mission end ─────────────────────────────────────────────────────
    renderEnd(summary, session) {
      const score = Number(summary?.overall_score ?? 0);
      el.endRing.dataset.band = summary?.band || 'almost';
      cancelCount?.();
      el.endScore.textContent = '0';
      cancelCount = countUp(el.endScore, score, { durationMs: 1200 });
      el.endBand.textContent = summary?.band_label || '';
      el.endVerdict.textContent = summary?.verdict || '';
      const badge = summary?.badge || session?.scenario?.badge;
      el.endBadge.hidden = !badge;
      el.endBadge.textContent = badge ? `🏅 ${badge}` : '';
      el.endSummary.textContent = summary?.summary || '';

      fillList(el.endStrengths, summary?.strengths);
      fillList(el.endImprovements, summary?.improvements);

      const upgrades = Array.isArray(summary?.bm_upgrades) ? summary.bm_upgrades : [];
      el.endUpgrades.innerHTML = '';
      if (!upgrades.length) {
        const p = document.createElement('p');
        p.className = 'muted-note';
        p.textContent = 'Tiada tukaran bahasa dikesan — bagus!';
        el.endUpgrades.appendChild(p);
      } else {
        for (const u of upgrades) {
          const row = document.createElement('div');
          row.className = 'upgrade-row';
          row.innerHTML =
            `<span class="idx"></span><span class="said"></span>` +
            `<span class="arrow" aria-hidden="true">→</span><span class="better"></span>`;
          row.querySelector('.idx').textContent = String(el.endUpgrades.childElementCount + 1);
          row.querySelector('.said').textContent = u.you_said ?? '';
          row.querySelector('.better').textContent = u.try ?? '';
          el.endUpgrades.appendChild(row);
        }
      }

      el.endTranscript.innerHTML = '';
      for (const turn of session?.turns || []) {
        const li = document.createElement('li');
        li.className = 'log-turn';
        const band = bandForTurn({ overall_score: turn.score, band: turn.band, band_label: turn.bandLabel });
        li.innerHTML = `
          <div class="log-npc"><b class="who"></b><span class="line"></span></div>
          <div class="log-you"><b class="who">Anda</b><span class="line"></span></div>
          <div class="log-reply"><b class="who"></b><span class="line"></span></div>`;
        const npcName = turn.npcName || session?.scenario?.npc_name || 'NPC';
        li.querySelector('.log-npc .who').textContent = npcName;
        li.querySelector('.log-npc .line').textContent = turn.npc;
        li.querySelector('.log-you .line').textContent = turn.player;
        li.querySelector('.log-reply .who').textContent = npcName;
        li.querySelector('.log-reply .line').textContent = turn.npcReply || '—';
        if (turn.score != null && band) {
          const chip = document.createElement('span');
          chip.className = 'turn-score';
          chip.dataset.band = band.band;
          chip.textContent = `${turn.score} · ${band.label}`;
          li.querySelector('.log-you').appendChild(chip);
        } else {
          const chip = document.createElement('span');
          chip.className = 'turn-score none';
          chip.textContent = 'tiada skor';
          li.querySelector('.log-you').appendChild(chip);
        }
        el.endTranscript.appendChild(li);
      }
      if (summary?.fallback) {
        const note = document.createElement('li');
        note.className = 'muted-note';
        note.textContent =
          'Nota: ringkasan ini dijana secara tempatan kerana penilai penuh tidak dapat dihubungi. Markah anda tidak terjejas.';
        el.endTranscript.appendChild(note);
      }
    },
  };

  return ui;
}

function fillList(node, items) {
  node.innerHTML = '';
  for (const item of Array.isArray(items) ? items : []) {
    const li = document.createElement('li');
    li.textContent = item;
    node.appendChild(li);
  }
  if (!node.childElementCount) {
    const li = document.createElement('li');
    li.className = 'muted-note';
    li.textContent = '—';
    node.appendChild(li);
  }
}

/**
 * Try to load an optional art file. The callback only fires if it decodes.
 * Missing art is silent by design — the CSS/SVG fallback is already on screen.
 */
const artProbes = new Map(); // url -> Promise<boolean>, so each file is asked for once

function loadArt(url, onLoad) {
  if (!artProbes.has(url)) {
    artProbes.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
      }),
    );
  }
  artProbes.get(url).then((ok) => {
    if (ok) onLoad(url);
  });
}
