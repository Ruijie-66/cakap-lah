// server/middleware/rate-limit.js
//
// A small in-memory sliding-window rate limiter. No new npm dependency: the
// app is a single Node process, so a Map of timestamp arrays is the whole
// implementation. (If this ever runs as more than one instance the per-IP
// budget silently multiplies by the instance count — see DEPLOY.md.)
//
// Why this exists: /api/tts, /api/stt, /api/evaluate and /api/summarise all
// spend a finite, hackathon-issued upstream quota. A public URL with no limit
// is a free speech-synthesis and transcription proxy for anyone who finds it.
//
// Reading the client IP correctly matters more than the limit numbers:
//   * trusting nothing behind a platform proxy makes EVERY visitor look like
//     the proxy's single IP, so the first player exhausts everybody's budget;
//   * trusting the whole X-Forwarded-For chain lets a caller prepend any IP
//     they like and reset their own budget on every request.
// Express's numeric `trust proxy` setting is the right shape: `1` means "one
// proxy sits in front of me, believe only the hop it appended", which is
// exactly the Render/Fly/Railway topology. server/index.js applies it.

/**
 * Prune a timestamp array in place to the entries inside the window.
 * @param {number[]} times ascending timestamps
 * @param {number} cutoff
 * @returns {number[]}
 */
function prune(times, cutoff) {
  let i = 0;
  while (i < times.length && times[i] <= cutoff) i += 1;
  return i === 0 ? times : times.slice(i);
}

/**
 * One named sliding window over a keyspace.
 *
 * `check(key)` is the whole API: it either records a hit and returns
 * `{ ok: true }`, or refuses and says how long until the oldest hit falls out
 * of the window.
 *
 * @param {{windowMs: number, max: number, maxKeys?: number}} options
 */
export function createWindow({ windowMs, max, maxKeys = 5000 }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  function sweep(now = Date.now()) {
    const cutoff = now - windowMs;
    for (const [key, times] of hits) {
      const kept = prune(times, cutoff);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }

  const api = {
    /**
     * Would this hit be allowed? Records nothing — so a request refused by a
     * LATER window never burns budget in an earlier one.
     * @param {string} key
     * @param {number} [now]
     * @returns {{ok: true, remaining: number} | {ok: false, retryAfterS: number}}
     */
    peek(key, now = Date.now()) {
      const times = prune(hits.get(key) || [], now - windowMs);
      hits.set(key, times);
      if (times.length >= max) {
        const retryAfterMs = times[0] + windowMs - now;
        return { ok: false, retryAfterS: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }
      return { ok: true, remaining: max - times.length };
    },

    /**
     * Record one hit. Only called once every window has said yes.
     * @param {string} key
     * @param {number} [now]
     */
    charge(key, now = Date.now()) {
      const times = prune(hits.get(key) || [], now - windowMs);
      times.push(now);
      hits.set(key, times);

      // Unbounded key growth is its own denial of service: a caller rotating
      // a session id every request would otherwise grow this map forever.
      // Sweeping first is cheap and usually enough; a hard cap catches the
      // pathological case.
      if (hits.size > maxKeys) {
        sweep(now);
        if (hits.size > maxKeys) {
          let excess = hits.size - maxKeys;
          for (const k of hits.keys()) {
            if (k === key) continue;
            hits.delete(k);
            excess -= 1;
            if (excess <= 0) break;
          }
        }
      }
    },

    /** peek + charge, for callers that consult exactly one window. */
    check(key, now = Date.now()) {
      const verdict = api.peek(key, now);
      if (verdict.ok) api.charge(key, now);
      return verdict;
    },

    /** Test/introspection helpers. */
    size: () => hits.size,
    count(key, now = Date.now()) {
      return prune(hits.get(key) || [], now - windowMs).length;
    },
    reset() {
      hits.clear();
    },
    sweep,
  };

  return api;
}

/**
 * The client's IP as a limiter key.
 *
 * `req.ip` already honours the app's `trust proxy` setting, so this is mostly
 * about never returning an empty key (which would bucket every unknown caller
 * together) and about normalising the IPv4-mapped IPv6 form so that
 * `::ffff:1.2.3.4` and `1.2.3.4` are one client rather than two budgets.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
export function clientKey(req) {
  const raw = req.ip || req.socket?.remoteAddress || '';
  const ip = String(raw).replace(/^::ffff:/, '');
  return ip || 'unknown';
}

/**
 * The caller-supplied session id, or '' when there is none.
 * A hostile client can rotate this freely — it is a fairness mechanism for
 * honest players, never a security boundary. The per-IP window is the backstop.
 * @param {import('express').Request} req
 * @returns {string}
 */
export function sessionKey(req) {
  const raw = req.get?.('x-session-id') || (req.query && req.query.session) || '';
  return String(raw).slice(0, 64).replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * The 429 body. One human-readable sentence plus the wait, because the client
 * renders `error` verbatim into the on-screen error panel next to Retry — a
 * rate-limited player must see a normal retry state, never a dead end.
 * @param {number} retryAfterS
 * @param {string} [what] what specifically ran out, for the log
 */
export function tooManyRequestsBody(retryAfterS) {
  return {
    error:
      `Terlalu banyak permintaan. Tunggu ${retryAfterS} saat, kemudian tekan "Cuba lagi". ` +
      `(Too many requests — wait ${retryAfterS}s and try again.)`,
    retry_after_s: retryAfterS,
  };
}

/**
 * Build an express middleware from one or more windows.
 *
 * Every window is consulted before any is charged, so a request refused by the
 * global ceiling does not also burn the caller's own per-IP budget.
 *
 * @param {Array<{window: ReturnType<createWindow>, key: (req) => string, label: string, skip?: (req) => boolean}>} rules
 */
export function limiter(rules) {
  return function rateLimit(req, res, next) {
    const now = Date.now();
    /** @type {Array<{window: any, key: string}>} */
    const pending = [];

    for (const rule of rules) {
      if (rule.skip && rule.skip(req)) continue;
      const key = rule.key(req);
      if (!key) continue;
      const verdict = rule.window.peek(key, now);
      if (verdict.ok) {
        pending.push({ window: rule.window, key });
        continue;
      }
      console.warn(
        `[rate-limit] ${rule.label} tripped for "${key}" on ${req.method} ${req.originalUrl || req.path} ` +
          `— retry in ${verdict.retryAfterS}s`,
      );
      res.set('Retry-After', String(verdict.retryAfterS));
      res.status(429).json(tooManyRequestsBody(verdict.retryAfterS));
      return;
    }

    for (const { window, key } of pending) window.charge(key, now);
    next();
  };
}
