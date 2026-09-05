// public/js/audio/recorder.js — microphone capture for CAKAP LAH!
//
// Design decisions (already measured, do not re-litigate):
//   * MediaRecorder output is posted straight to /api/stt. No AudioWorklet,
//     no resampling, no WAV encoding. WebM/Opus scored identically to WAV on
//     STT accuracy (0.9563 vs 0.9561) at ~11x smaller (12 KB vs 138 KB).
//   * ONE getUserMedia stream feeds TWO consumers: the MediaRecorder (upload)
//     and an AnalyserNode (visualiser). Never open the mic twice.
//
// NOTE ON DEPLOYMENT: getUserMedia requires a secure context. `localhost` counts,
// so plain HTTP works in local dev — but any hosted deploy MUST be HTTPS or the
// browser refuses the microphone (often silently). Not our problem to solve here.

/** Hard cap: a turn is never longer than this; we auto-stop and still submit. */
export const MAX_RECORDING_MS = 20000;

/**
 * How long stop() will wait for the MediaRecorder's 'stop' event after the 20 s
 * cap has already called the native stop(). Generous next to the 250 ms
 * timeslice; it exists only so a browser that never fires the event cannot hang
 * the turn — on expiry we resolve with whatever chunks we have.
 */
export const STOP_EVENT_TIMEOUT_MS = 1500;

/** Preference order for the recording container/codec. */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4', // Safari -> mp4/aac; the server accepts M4A
  'audio/mpeg',
];

/**
 * @returns {string} the best supported recording MIME type, or '' to let the
 * browser choose its own default (still valid — we read blob.type after).
 */
export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  for (const type of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* isTypeSupported can throw on malformed strings in old browsers */
    }
  }
  return '';
}

/** True if this browser can record at all. */
export function isRecordingSupported() {
  return Boolean(
    typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window !== 'undefined' &&
      typeof window.MediaRecorder !== 'undefined',
  );
}

/** An error whose `.message` is safe to show a player verbatim. */
export class RecorderError extends Error {
  constructor(message, { kind = 'error', cause } = {}) {
    super(message);
    this.name = 'RecorderError';
    this.kind = kind; // 'unsupported' | 'insecure' | 'permission' | 'no-device' | 'busy' | 'error'
    if (cause) this.cause = cause;
  }
}

/**
 * Translate a getUserMedia DOMException into something a human understands,
 * always with a way forward — never a dead end.
 * @param {any} err
 * @returns {RecorderError}
 */
function humaniseMicError(err) {
  const name = err && err.name ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new RecorderError(
        'Microphone access was blocked. Click the padlock (or camera icon) in your browser address bar, allow the microphone for this site, then reload and try again.',
        { kind: 'permission', cause: err },
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new RecorderError(
        'No microphone was found. Plug one in or pick an input device in your system sound settings, then try again.',
        { kind: 'no-device', cause: err },
      );
    case 'NotReadableError':
    case 'AbortError':
      return new RecorderError(
        'Your microphone is busy — another app or browser tab may be using it. Close it and try again.',
        { kind: 'busy', cause: err },
      );
    default:
      return new RecorderError(
        `The microphone could not be started${name ? ` (${name})` : ''}. Try again, or reload the page.`,
        { kind: 'error', cause: err },
      );
  }
}

/**
 * Create a recorder. One instance can be armed/started/stopped repeatedly
 * across a multi-round session; `dispose()` releases the mic entirely.
 *
 * @param {{
 *   maxMs?: number,
 *   fftSize?: number,
 *   onStart?: () => void,
 *   onTick?: (elapsedMs: number) => void,
 *   onAutoStop?: () => void,
 *   onError?: (err: RecorderError) => void,
 * }} [options]
 * @returns {{
 *   arm: () => Promise<{analyser: AnalyserNode, stream: MediaStream}>,
 *   start: () => Promise<void>,
 *   stop: () => Promise<{blob: Blob, mimeType: string, durationMs: number}>,
 *   cancel: () => void,
 *   dispose: () => void,
 *   isRecording: () => boolean,
 *   isArmed: () => boolean,
 *   elapsedMs: () => number,
 *   getAnalyser: () => AnalyserNode|null,
 *   getStream: () => MediaStream|null,
 *   maxMs: number,
 * }}
 */
export function createRecorder(options = {}) {
  const maxMs = options.maxMs ?? MAX_RECORDING_MS;
  const fftSize = options.fftSize ?? 2048;

  /** @type {MediaStream|null} */
  let stream = null;
  /** @type {AudioContext|null} */
  let audioCtx = null;
  /** @type {AnalyserNode|null} */
  let analyser = null;
  /** @type {MediaStreamAudioSourceNode|null} */
  let sourceNode = null;
  /** @type {MediaRecorder|null} */
  let recorder = null;
  /** @type {Blob[]} */
  let chunks = [];
  let mimeType = '';
  let startedAt = 0;
  let stoppedAt = 0;
  let recording = false;
  let capTimer = null;
  let tickTimer = null;
  let autoStopped = false;
  /** Set once the current recorder has delivered its 'stop' event — which is
   *  also the moment its last buffered `dataavailable` chunk has landed. */
  let stopEventFired = false;
  /** Callbacks waiting for that event (at most one: the pending stop()). */
  let stopWaiters = [];

  function flushStopWaiters() {
    const waiters = stopWaiters;
    stopWaiters = [];
    for (const w of waiters) {
      try { w(); } catch { /* a waiter must never break the others */ }
    }
  }

  function clearTimers() {
    if (capTimer) { clearTimeout(capTimer); capTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  /**
   * Open the mic (if not already open) and wire up the analyser. Safe to call
   * repeatedly — the stream is reused for the whole session.
   */
  async function arm() {
    if (!isRecordingSupported()) {
      throw new RecorderError(
        'This browser cannot record audio. Please use a recent Chrome, Edge, Firefox or Safari.',
        { kind: 'unsupported' },
      );
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      throw new RecorderError(
        'The microphone needs a secure connection. Open this page over HTTPS, or on http://localhost.',
        { kind: 'insecure' },
      );
    }

    if (stream && stream.getAudioTracks().some((t) => t.readyState === 'live')) {
      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
      return { analyser, stream };
    }

    // Any half-dead stream from a previous round goes first.
    releaseStream();

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const e = humaniseMicError(err);
      options.onError?.(e);
      throw e;
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    // Browsers start the context suspended until a user gesture; arm() is
    // always called from a click in this app, so this resolves immediately.
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch { /* visualiser will just be flat */ }
    }
    sourceNode = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0.75;
    sourceNode.connect(analyser);
    // Deliberately NOT connected to destination — that would echo the mic
    // back through the speakers.

    return { analyser, stream };
  }

  /** Begin capturing. Arms the mic first if needed. */
  async function start() {
    if (recording) return;
    await arm();

    chunks = [];
    autoStopped = false;
    stopEventFired = false;
    stopWaiters = [];
    mimeType = pickMimeType();

    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (err) {
      // Some browsers reject the options object; retry bare before giving up.
      try {
        recorder = new MediaRecorder(stream);
        mimeType = '';
      } catch (err2) {
        const e = new RecorderError(
          'Recording could not be started in this browser. Try Chrome or Edge, or reload the page.',
          { kind: 'unsupported', cause: err2 || err },
        );
        options.onError?.(e);
        throw e;
      }
    }

    recorder.addEventListener('dataavailable', (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    });
    // The 'stop' event fires AFTER the final buffered `dataavailable`. Watching
    // it here — not only in stop() — is what lets the 20 s auto-stop path wait
    // for the tail chunk instead of building the Blob without it.
    recorder.addEventListener('stop', () => {
      stopEventFired = true;
      flushStopWaiters();
    }, { once: true });
    recorder.addEventListener('error', (ev) => {
      const e = new RecorderError(
        'Recording stopped unexpectedly. Please try again.',
        { kind: 'error', cause: ev?.error },
      );
      options.onError?.(e);
    });

    try {
      recorder.start(250); // timeslice keeps chunks flowing even if we stop hard
    } catch (err) {
      recorder = null;
      const e = new RecorderError(
        'Recording could not be started — the microphone may have been disconnected. Reload the page and try again.',
        { kind: 'error', cause: err },
      );
      options.onError?.(e);
      throw e;
    }
    recording = true;
    startedAt = performance.now();
    stoppedAt = 0;

    capTimer = setTimeout(() => {
      autoStopped = true;
      // Freeze the clock and the state HERE, at the cap, so the UI timer stops
      // at 20.0s and isRecording() goes false even if the caller takes a while
      // to await stop(). stop() preserves this stoppedAt.
      stoppedAt = performance.now();
      recording = false;
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      options.onTick?.(elapsedMs());
      // Fire the recorder's own stop; whoever awaits stop() still gets the blob.
      if (recorder && recorder.state === 'recording') recorder.stop();
      options.onAutoStop?.();
    }, maxMs);

    tickTimer = setInterval(() => {
      if (recording) options.onTick?.(elapsedMs());
    }, 100);

    options.onStart?.();
  }

  /**
   * Stop capturing and resolve with the recorded audio. If the 20 s cap already
   * fired, this still resolves with everything that was captured.
   * @returns {Promise<{blob: Blob, mimeType: string, durationMs: number}>}
   */
  function stop() {
    return new Promise((resolve, reject) => {
      if (!recorder) {
        reject(new RecorderError('Nothing was recorded. Press record and speak, then stop.', { kind: 'error' }));
        return;
      }

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimers();
        recording = false;
        stoppedAt = stoppedAt || performance.now();
        const type = mimeType || (chunks[0] && chunks[0].type) || 'audio/webm';
        const blob = new Blob(chunks, { type });
        const durationMs = Math.max(0, Math.round(stoppedAt - startedAt));
        const rec = recorder;
        recorder = null;
        if (rec) rec.onstop = null;
        resolve({ blob, mimeType: blob.type || type, durationMs, autoStopped });
      };

      if (recorder.state === 'inactive') {
        // The 20 s cap already called the native stop(). `state` flips to
        // 'inactive' SYNCHRONOUSLY, but the last buffered chunk (up to one
        // 250 ms timeslice of audio) is delivered afterwards, on the task
        // queue. Building the Blob right here would silently truncate the tail
        // — so wait for the 'stop' event, exactly as the manual path does.
        if (stopEventFired) {
          finish();
          return;
        }
        // Timeout guard: a browser that never fires 'stop' must not hang the
        // turn. On expiry we submit whatever was captured — the cap's binding
        // requirement is that it auto-stops AND still submits.
        const guard = setTimeout(() => {
          console.warn('[recorder] no MediaRecorder "stop" event after the cap; submitting what was captured.');
          finish();
        }, STOP_EVENT_TIMEOUT_MS);
        stopWaiters.push(() => {
          clearTimeout(guard);
          finish();
        });
        return;
      }

      // Don't clobber a stoppedAt already set by the 20 s cap.
      if (!stoppedAt) stoppedAt = performance.now();
      recorder.addEventListener('stop', finish, { once: true });
      try {
        recorder.stop();
      } catch (err) {
        clearTimers();
        recording = false;
        recorder = null;
        reject(new RecorderError('Recording could not be stopped cleanly. Please try again.', { kind: 'error', cause: err }));
      }
    });
  }

  /** Abandon the current recording without producing a blob. */
  function cancel() {
    clearTimers();
    recording = false;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* already gone */ }
    }
    recorder = null;
    // Release anyone awaiting the 'stop' event; they resolve with what exists
    // rather than hanging on a recorder that has been thrown away.
    flushStopWaiters();
    chunks = [];
  }

  function releaseStream() {
    if (sourceNode) { try { sourceNode.disconnect(); } catch { /* noop */ } sourceNode = null; }
    analyser = null;
    if (audioCtx) {
      const ctx = audioCtx;
      audioCtx = null;
      try { ctx.close(); } catch { /* already closed */ }
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* noop */ }
      }
      stream = null;
    }
  }

  /** Full teardown: stops tracks and closes the AudioContext, freeing the mic. */
  function dispose() {
    cancel();
    releaseStream();
    chunks = [];
  }

  function elapsedMs() {
    if (!startedAt) return 0;
    return Math.max(0, Math.round((recording ? performance.now() : stoppedAt || performance.now()) - startedAt));
  }

  return {
    arm,
    start,
    stop,
    cancel,
    dispose,
    isRecording: () => recording,
    isArmed: () => Boolean(stream && stream.getAudioTracks().some((t) => t.readyState === 'live')),
    elapsedMs,
    getAnalyser: () => analyser,
    getStream: () => stream,
    maxMs,
  };
}
