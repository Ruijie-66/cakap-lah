// public/js/audio/player.js — plays TTS audio blobs, one at a time.
//
// The turn loop needs to know exactly when the voice has finished so it can
// re-arm the microphone, so play() returns a promise that settles on `ended`.
//
// It must NEVER throw the game into a dead end: if playback fails (codec,
// autoplay policy, empty blob), play() resolves with { ok: false, reason }
// and the caller simply shows the text instead.

/**
 * @param {{ onPlay?: (info: object) => void, onEnded?: (info: object) => void,
 *           onError?: (err: Error) => void }} [options]
 * @returns {{
 *   play: (blobOrObj: Blob|{blob: Blob, contentType?: string, durationS?: number}) => Promise<{ok: boolean, reason?: string, durationMs?: number}>,
 *   replay: () => Promise<{ok: boolean, reason?: string, durationMs?: number}>,
 *   stop: () => void,
 *   isPlaying: () => boolean,
 *   hasClip: () => boolean,
 *   getElement: () => HTMLAudioElement,
 *   dispose: () => void,
 * }}
 */
export function createPlayer(options = {}) {
  const audio = new Audio();
  audio.preload = 'auto';

  /** @type {Blob|null} */
  let lastBlob = null;
  /** @type {string} */
  let lastUrl = '';
  let playing = false;
  /** @type {null | ((result: object) => void)} */
  let settle = null;

  function revoke() {
    if (lastUrl) {
      try { URL.revokeObjectURL(lastUrl); } catch { /* noop */ }
      lastUrl = '';
    }
  }

  function finish(result) {
    playing = false;
    const done = settle;
    settle = null;
    if (done) done(result);
  }

  audio.addEventListener('ended', () => {
    options.onEnded?.({ ok: true });
    finish({ ok: true, durationMs: Math.round((audio.duration || 0) * 1000) });
  });

  audio.addEventListener('error', () => {
    const reason = 'The reply audio could not be played.';
    options.onError?.(new Error(reason));
    finish({ ok: false, reason });
  });

  /**
   * Play a TTS clip. Always resolves — check `.ok`.
   * Accepts either a raw Blob or the object api.tts() returns.
   */
  async function play(input) {
    const blob = input instanceof Blob ? input : input && input.blob;
    if (!blob || !blob.size) {
      const reason = 'No audio came back from the voice service.';
      options.onError?.(new Error(reason));
      return { ok: false, reason };
    }

    stop();
    revoke();
    lastBlob = blob;
    lastUrl = URL.createObjectURL(blob);
    audio.src = lastUrl;

    return startPlayback();
  }

  /** Replay the last clip. Resolves { ok:false } if there is nothing to replay. */
  async function replay() {
    if (!lastBlob || !lastUrl) {
      return { ok: false, reason: 'There is nothing to replay yet.' };
    }
    stop();
    audio.currentTime = 0;
    return startPlayback();
  }

  function startPlayback() {
    const promise = new Promise((resolve) => { settle = resolve; });
    playing = true;
    options.onPlay?.({});
    audio.play().catch((err) => {
      // Autoplay policy is the usual culprit — the caller falls back to text.
      const reason =
        err && err.name === 'NotAllowedError'
          ? 'Your browser blocked audio playback. Tap the page once, then press replay.'
          : 'The reply audio could not be played.';
      options.onError?.(new Error(reason));
      finish({ ok: false, reason });
    });
    return promise;
  }

  /** Halt playback immediately; a pending play() promise settles as not-ok. */
  function stop() {
    if (!audio.paused) {
      try { audio.pause(); } catch { /* noop */ }
    }
    if (playing) finish({ ok: false, reason: 'Playback stopped.' });
  }

  function dispose() {
    stop();
    revoke();
    lastBlob = null;
    audio.removeAttribute('src');
    try { audio.load(); } catch { /* noop */ }
  }

  return {
    play,
    replay,
    stop,
    isPlaying: () => playing,
    hasClip: () => Boolean(lastBlob),
    getElement: () => audio,
    dispose,
  };
}
