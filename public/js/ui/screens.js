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
  /** The barge-in coach line is shown once per session, then trimmed. */
  let bargeSeen = false;

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
    vizCut: $('vizCut'),
    vizTurn: $('vizTurn'),
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
      // The barge-in and your-turn dressings only ever make sense on top of
      // `ready`. Any other mode clears both, so a state change can never leave
      // "potong je" or "GILIRAN ANDA" shouting at a dead or recording mic.
      if (mode !== 'ready') {
        document.body.dataset.barge = 'off';
        document.body.dataset.turn = 'off';
      }
      // Replay and "Dengar coach" push TTS out of the speakers. With the mic
      // open that is the NPC's voice bleeding into the player's answer —
      // echoCancellation usually saves it on a laptop, but not at demo volume
      // through external speakers. Both are off-limits while recording.
      el.replayBtn.disabled = mode === 'recording';
      el.coachBtn.disabled = mode === 'recording';
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
      if (mode !== 'ready') {
        el.micHint.classList.remove('cut');
        el.micHint.classList.remove('turn');
      }
    },

    /**
     * "You may cut in right now." Barge-in is live during every narrator and
     * NPC line, but a plain amber READY mic is indistinguishable from every
     * other idle moment — testers reported the button looked off. This is the
     * only state that gets its own dressing on top of `ready`; it is never
     * pink and never borrows the recording language.
     *
     * Call AFTER setMic('ready', …) — setMic clears it on every other mode.
     * @param {boolean} on
     */
    setBargeIn(on) {
      const live = !!on && el.micBtn.dataset.mode === 'ready' && !el.micBtn.disabled;
      document.body.dataset.barge = live ? 'on' : 'off';
      // The NPC is talking — it is emphatically NOT the player's turn yet.
      if (live) ui.setTurnCue(false);
      el.micHint.classList.toggle('cut', live);
      // The "tak payah tunggu dia habis cakap" sub-line is a one-off: it
      // teaches the mechanic the first time an NPC speaks, then gets out of
      // the way for the rest of the session.
      if (live && el.vizCut) {
        if (bargeSeen) el.vizCut.dataset.seen = '1';
        bargeSeen = true;
      }
    },

    /**
     * "It is your turn — press CAKAP." The mic no longer arms itself, so this
     * is the ONLY thing standing between a first-time player and a silent,
     * apparently-broken screen. It has to be impossible to miss.
     *
     * Deliberately the same family as the barge-in dressing — amber, the same
     * arrow pointing back at the mic, the same closing instruction ("tekan
     * CAKAP") — because the answer to both moments is the same button. Just as
     * deliberately NOT the same look:
     *   barge-in  · dashed ring collapsing INWARD, small line, "Potong je" —
     *               a permission, offered while someone else is talking.
     *   your turn · SOLID rings pushing outward, the strip given over to
     *               "GILIRAN ANDA" at full display size, plus a badge in the
     *               phase row where RECORDING lives — a summons, and the only
     *               thing happening on screen.
     * Neither borrows the recording language: no neon pink, no REC badge, no
     * STOP glyph. Recording stays the single loudest state.
     *
     * Call AFTER setMic('ready', …) — setMic clears it on every other mode.
     * @param {boolean} on
     */
    setTurnCue(on) {
      const live = !!on && el.micBtn.dataset.mode === 'ready' && !el.micBtn.disabled;
      document.body.dataset.turn = live ? 'on' : 'off';
      if (live) document.body.dataset.barge = 'off';
      el.micHint.classList.toggle('turn', live);
      if (live) el.micHint.classList.remove('cut');
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

      renderThread(el.endTranscript, session);
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

/**
 * The mission transcript, as a chat thread.
 *
 * Grouped per TURN — [scripted line][you][reply] — it read as if the NPC said
 * two different things every turn, and a retry repeated the same scripted line
 * verbatim in consecutive blocks. So: one bubble per utterance, in the order
 * they were actually spoken, NPC left, player right, the turn score on the
 * player's own bubble. `session.thread` is the record of what was really said;
 * `session.turns` is only a fallback for a session built before it existed.
 */
function renderThread(node, session) {
  node.innerHTML = '';
  const entries = threadEntries(session);
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'muted-note';
    li.textContent = '—';
    node.appendChild(li);
    return;
  }
  let lastNpcName = null;
  for (const entry of entries) {
    if (entry.role === 'npc') {
      // Consecutive lines from the same character are one person still
      // talking: name and portrait are shown once, at the top of the run.
      const isNewSpeaker = entry.name !== lastNpcName;
      node.appendChild(npcMessage(entry, isNewSpeaker));
      lastNpcName = entry.name;
    } else {
      node.appendChild(playerMessage(entry));
      // The next NPC line starts a fresh run: re-show who is speaking.
      lastNpcName = null;
    }
  }
}

/** The chat thread, falling back to the per-turn log for older sessions. */
function threadEntries(session) {
  const thread = session?.thread;
  if (Array.isArray(thread) && thread.length) return thread;
  const out = [];
  for (const turn of session?.turns || []) {
    const name = turn.npcName || session?.scenario?.npc_name || 'NPC';
    const portrait = session?.scenario?.portrait || '';
    if (turn.npc) out.push({ role: 'npc', text: turn.npc, name, portrait });
    out.push({
      role: 'player',
      text: turn.player,
      score: turn.score,
      band: turn.band,
      bandLabel: turn.bandLabel,
    });
    if (turn.npcReply) out.push({ role: 'npc', text: turn.npcReply, name, portrait });
  }
  return out;
}

function npcMessage(entry, isNewSpeaker) {
  const li = document.createElement('li');
  li.className = 'msg msg-npc';
  if (!isNewSpeaker) li.classList.add('is-cont');
  const face = PORTRAIT_FACE[entry.portrait] || { glyph: '🧑', hue: 200 };
  li.innerHTML = `
    <span class="msg-avatar" aria-hidden="true"><img alt="" hidden /><span class="msg-emoji"></span></span>
    <div class="msg-body"><b class="msg-who"></b><div class="msg-bubble"></div></div>`;
  const avatar = li.querySelector('.msg-avatar');
  avatar.style.setProperty('--hue', String(face.hue));
  li.querySelector('.msg-emoji').textContent = face.glyph;
  li.querySelector('.msg-who').textContent = entry.name || 'NPC';
  li.querySelector('.msg-bubble').textContent = entry.text;
  if (entry.portrait) {
    const img = li.querySelector('img');
    loadArt(`/assets/npc/${entry.portrait}.png`, (url) => {
      img.src = url;
      img.hidden = false;
      // The avatar is a grid cell: without this both would render at once.
      li.querySelector('.msg-emoji').hidden = true;
    });
  }
  return li;
}

function playerMessage(entry) {
  const li = document.createElement('li');
  li.className = 'msg msg-you';
  li.innerHTML = `<div class="msg-body"><b class="msg-who">Anda</b><div class="msg-bubble"></div></div>`;
  li.querySelector('.msg-bubble').textContent = entry.text;
  const band = bandForTurn({
    overall_score: entry.score,
    band: entry.band,
    band_label: entry.bandLabel,
  });
  const chip = document.createElement('span');
  if (entry.score != null && band) {
    chip.className = 'turn-score';
    chip.dataset.band = band.band;
    chip.textContent = `${entry.score} · ${band.label}`;
  } else {
    chip.className = 'turn-score none';
    chip.textContent = 'tiada skor';
  }
  li.querySelector('.msg-body').appendChild(chip);
  return li;
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
