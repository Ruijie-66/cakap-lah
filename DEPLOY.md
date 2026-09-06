# Deploying CAKAP LAH!

The app is one Node process. There is no build step, no bundler and no
database: `npm install && npm start` is the whole setup, locally and in
production. Everything below is about getting that process onto a public URL
without giving away the API keys it holds.

---

## Two things that will bite you first

### 1. HTTPS is mandatory — not a nice-to-have

The browser's `getUserMedia()` (the microphone) is a **secure-context-only**
API. On a plain `http://` origin other than `localhost`, Chrome and Safari do
not throw a visible error and do not show a permission prompt — the call simply
never resolves into a working stream. The symptom is a page that looks
completely fine, a mic button that responds, and **no audio, ever**, with
nothing in the console that points at the cause.

Render, Fly and Railway all terminate TLS for you, so as long as you visit the
`https://` URL you are fine. What breaks this is doing something clever: a bare
IP address, a custom domain whose certificate has not finished issuing, or a
reverse proxy in front that serves HTTP. Open the deployed URL and confirm the
padlock **before** you conclude anything is wrong with the microphone.

### 2. Free tiers sleep, and a cold start reads as "broken"

Render's (and Railway's, and Fly's) free tier spins the container down after
about 15 minutes with no traffic. The next request has to boot it again, which
takes **about a minute**.

To be precise about what that looks like, because it is better than it sounds:
Render **holds the request open** and serves connecting browsers its own
loading page while the container starts. Nothing errors, and **nobody needs to
refresh** — when the service is up the request completes and the game renders.
Refreshing does not speed it up (it just restarts the wait against a container
that is already booting), and it does not break anything either.

The risk is therefore not technical, it is human: a judge who opens your link
during judging is, by definition, the first visitor after an idle period, and a
minute of watching someone else's loading page is long enough to conclude the
submission is broken and close the tab.

A cold start and a crash look different, though. A wait that ends in the game
is a cold start; a **502** is a crashed or failing service, and the answer to
that is the Render logs, not patience.

**`render.yaml` ships `plan: free`**, because declaring a paid plan is what
makes Render's Blueprint flow demand a card before it will create anything. Free
works — same HTTPS, same `*.onrender.com` hostname, same everything the app
needs — it just sleeps.

**If you can spend ~$7, do.** Change the one `plan:` line in `render.yaml` to
`starter` and push; Render redeploys and the sleeping stops. It is cancellable
after the weekend.

**Staying on free? Then the cold start is a thing you manage, not a thing you
hope about:**

- **Warm it before you present.** Open the URL yourself 2–3 minutes before the
  demo and leave the tab open. Never hand out a link you have not just loaded.
- **Never let the judges be the ones who wake it.** If you are sending a link
  ahead of time, send it with "give it a minute to wake up, no need to refresh"
  — a stated wait is a quirk, an unexplained one is a broken submission.
- **Keep it awake across the judging window** with a ping from your laptop, for
  as long as you actually need it:

  ```sh
  while true; do curl -s -o /dev/null $URL/api/health; sleep 600; done
  ```

  Any inbound request resets the 15-minute idle timer, and `/api/health` is a
  cheap JSON route. Two caveats: the free tier gives the *workspace* 750
  instance-hours a month, which one continuously-awake service consumes almost
  entirely, so do not leave this running all month; and the ping counts against
  the per-IP rate limit, which at one call per 10 minutes is nothing.

---

## Happy path: Render

`render.yaml` in the repo root is a Render Blueprint. It contains **no secrets**
— the two secret values are marked `sync: false`, so Render prompts for them
and stores them in its own dashboard.

### Step 1 — push the repo to GitHub

```sh
git remote -v          # confirm where you are pushing
git push origin main
```

Before you push, confirm the keys are not in the history:

```sh
git check-ignore -v .env            # must print a .gitignore match
git log --all -p -- .env | head     # must print NOTHING
```

### Step 2 — create the service

1. Go to <https://dashboard.render.com> → **New** → **Blueprint**.
2. Connect the GitHub repo. Render finds `render.yaml` and proposes one web
   service called `cakap-lah` on the free instance type. If it asks for payment
   details at this point, something in the blueprint is declaring a paid
   resource — check the `plan:` line.
3. Render prompts for the values marked `sync: false`. Paste them here:

   | Key                | Value                                              |
   | ------------------ | -------------------------------------------------- |
   | `REVOLAB_API_KEY`  | the hackathon Revolab key (from your local `.env`)  |
   | `OPENAI_API_KEY`   | your OpenAI key (from your local `.env`)            |

   `LLM_PROVIDER=openai`, `TRUST_PROXY=1`, `NODE_VERSION=24` and
   `NODE_ENV=production` are already in `render.yaml` and need no input. Do
   **not** add `MOCK` — it is set in your local `.env`, and copying it across
   ships a game where every voice line is silence.

4. **Apply**. The first deploy takes 2–4 minutes.

If Render rejects the region, the free instance type is not offered in
`singapore` for your workspace — change `region:` to one it does offer
(`oregon`, `ohio`, `virginia`, `frankfurt`) and re-apply. Latency to a judge in
the room is a rounding error next to the cold start you are already managing.

> Prefer clicking through instead of the Blueprint — or blocked by it? Create a
> **Web Service**, connect the repo, then set: runtime **Node**, instance type
> **Free**, build command `npm ci --omit=dev`, start command `npm start`, health
> check path `/api/health`. Then add every environment variable by hand:
> `REVOLAB_API_KEY`, `OPENAI_API_KEY`, `LLM_PROVIDER=openai`,
> `NODE_ENV=production`, `NODE_VERSION=24`, and `TRUST_PROXY=1` — the last one
> is not optional, the rate limiter reads it (see "Getting the client IP right").
> Do **not** add `MOCK`; it is in your local `.env` and it would ship a silent
> game.

### Step 3 — verify

Replace `$URL` with your `https://cakap-lah-xxxx.onrender.com`.

```sh
# 1 the process is up and NOT stuck in mock mode
curl -s $URL/api/health
# → {"ok":true,"mock":false}
#   "mock":true here means MOCK=1 leaked into the environment — remove it.

# 2 the real Revolab key works (a scenario line comes back as audio)
curl -s -o /tmp/line.mp3 -w '%{http_code} %{content_type} %{size_download}\n' \
  -X POST $URL/api/tts \
  -H 'content-type: application/json' \
  -H 'x-session-id: smoketest' \
  -d '{"text":"Ya boss, nak minum apa?"}'
# → 200 audio/mpeg <a few thousand bytes>
#   502 means the key is wrong or the quota is gone — check the Render logs,
#   where the real provider error is written (it is deliberately NOT returned
#   to the browser).
```

Then open `$URL` in a browser, confirm the padlock, pick a mission, and check
the microphone prompt appears and a recording scores.

---

## Verifying the guardrails from outside

The point of the guardrails is that a public URL is not a free speech-synthesis
and transcription service. Prove it from your laptop:

### The TTS allowlist

`/api/tts` only speaks lines the game itself produces — scenario content, plus
lines this server generated for your session.

```sh
# Authored content → 200 and audio
curl -s -o /dev/null -w '%{http_code}\n' -X POST $URL/api/tts \
  -H 'content-type: application/json' -H 'x-session-id: check' \
  -d '{"text":"Ya boss, nak minum apa?"}'
# → 200

# Anything else → 403, no upstream call, nothing spent
curl -s -X POST $URL/api/tts \
  -H 'content-type: application/json' -H 'x-session-id: check' \
  -d '{"text":"Please read my blog post out loud."}'
# → {"error":"Suara ini tidak tersedia untuk teks tersebut. (This voice only speaks lines from the game.)"}
```

Every rejection is logged server-side with the text that was refused, so if a
legitimate line is ever blocked (the player would hear silence) it shows up in
the Render logs as `[tts] REJECTED text not in the game's allowlist`.

### The rate limiter

```sh
for i in $(seq 1 60); do
  curl -s -o /dev/null -w '%{http_code} ' $URL/api/health
done; echo
# → 200 repeated, then 429 once the per-IP budget is spent
```

A rate-limited response looks like this — note it is **JSON with a readable
sentence**, plus a `Retry-After` header, because the client renders that text
verbatim next to its Retry button:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 43
Content-Type: application/json

{"error":"Terlalu banyak permintaan. Tunggu 43 saat, kemudian tekan \"Cuba lagi\". (Too many requests — wait 43s and try again.)","retry_after_s":43}
```

In the game this surfaces as the normal error panel: the message above, a
**Cuba lagi** button and a **Balik menu** button, with the scenario still on
screen. It is a retry state, never a dead end, and it never costs the learner
points.

### The limits, and why they are what they are

Three layers, deliberately sized in that order:

| Scope                                   | Budget            | Why                                                                                              |
| --------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| **per session**, tts/stt/evaluate/summarise | **30 / minute**   | The tight one. A turn costs ~5 calls and takes 20s at the fastest, so ~15/min is flat-out human play. |
| **per session**, `/api/evaluate`        | 60 turns / hour   | A mission is 3–6 scored turns, so ~10 missions an hour                                             |
| **per session**, the four costly routes | 400 / hour        | Long-horizon ceiling on one browser tab                                                            |
| **per IP**, the four costly routes      | 150 / minute      | The backstop for a client rotating its session id — see the NAT note below                         |
| **per IP**, all `/api/*`                | 300 / minute      | Includes the cheap JSON routes                                                                     |
| **global**, the four costly routes      | 300 / minute      | The hard ceiling on upstream spend per minute, whatever else happens                               |
| **global**, all `/api/*`                | 1500 / minute     | A whole room at once, and a stop on a scripted flood                                               |

**Why the per-IP layer is loose on purpose.** At a hackathon a whole room —
judges included — sits behind one venue NAT and therefore one IP. A per-IP
limit tight enough to stop a single abuser would trip the moment two judges
opened the link from the same wifi, and the demo would look broken to exactly
the people it is for. So the *session* layer is the tight one (a rate no human
can exceed), the *IP* layer is sized for about five simultaneous players, and
the *global* ceiling is what actually bounds the spend.

**A hostile client can rotate the session id.** The session budgets are
fairness for honest players, not a security boundary — the per-IP and global
windows are the real backstop, and the TTS allowlist above is what makes the
most expensive endpoint worthless to an abuser in the first place. All seven
numbers live in one file, `server/middleware/limits.js`; if the logs show a
sustained flood, lower `COSTLY_GLOBAL` there and redeploy.

Also tightened: JSON bodies are capped at **64 KB** (was 1 MB) and audio
uploads at **4 MB** (was 50 MB — a 20-second recording is about 30 KB).

### Getting the client IP right

The limiter keys off `req.ip`, which depends entirely on `trust proxy`:

- `TRUST_PROXY=1` (the default, and what `render.yaml` sets) means "one proxy
  in front of me, believe only the hop it appended to `X-Forwarded-For`". That
  last entry is the one entry a caller cannot forge.
- `TRUST_PROXY=0` behind a platform proxy makes **every visitor look like the
  proxy's single IP**, so the first player burns everyone's budget.
- Trusting the whole chain would let anyone prepend a fake IP and reset their
  own budget on every request.

If you deploy somewhere with two proxies in front (a CDN plus the platform),
set `TRUST_PROXY=2`. If the process is exposed directly, set `0`.

---

## Mock mode, if the quota runs out

Mock mode still works in production and needs no keys — append `?mock=1` to the
URL:

```
https://cakap-lah-xxxx.onrender.com/?mock=1
```

Every voice line comes back as a short silent clip and the evaluator uses the
deterministic scorer, so the whole loop — scenario, scoring, branching,
end-screen summary — still demonstrates end to end with the quota at zero.

Mock requests are still counted by the rate limiter. That is deliberate: a
`?mock=1` exemption would be a bypass that keeps the counters empty while
someone probes for other holes. Mock calls spend no upstream quota, so they are
cheap against the budgets they consume.

---

## Docker (any other platform)

The `Dockerfile` is there so this is not Render-specific. It reads `PORT` from
the environment and binds `0.0.0.0`, so it works anywhere.

```sh
docker build -t cakap-lah .

# Keys come from the environment at run time — never baked into the image.
docker run --rm -p 3000:3000 \
  -e REVOLAB_API_KEY="$REVOLAB_API_KEY" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e LLM_PROVIDER=openai \
  -e TRUST_PROXY=0 \
  cakap-lah
```

Then open <http://localhost:3000> — `localhost` is a secure context, so the
microphone works there even without TLS. On any other host it will not; put the
container behind something that terminates HTTPS.

`.dockerignore` excludes `.env`, so a key can never end up in an image layer.
`TRUST_PROXY=0` is right for a directly-exposed container; set it to the number
of proxies actually in front of the process.

---

## Environment variables, in full

| Variable          | Required            | Default                | Notes                                                        |
| ----------------- | ------------------- | ---------------------- | ------------------------------------------------------------ |
| `REVOLAB_API_KEY` | yes (unless mock)   | —                      | **Secret.** Speech-to-text and text-to-speech.                |
| `OPENAI_API_KEY`  | yes (unless mock)   | —                      | **Secret.** The evaluator. Without it the fallback scorer runs. |
| `LLM_PROVIDER`    | no                  | `openai`               | `openai` or `gemini`. A typo warns loudly and falls back.     |
| `PORT`            | no (platform sets)  | `3000`                 |                                                              |
| `HOST`            | no                  | `0.0.0.0`              | `127.0.0.1` to bind local-only.                              |
| `TRUST_PROXY`     | **yes in prod**     | `1`                    | Number of proxies in front. See above — getting it wrong breaks rate limiting in one direction or the other. |
| `MOCK`            | no                  | unset                  | `MOCK=1` forces mock mode server-wide. Do not set in production — `?mock=1` per request is enough. |
| `NODE_ENV`        | no                  | —                      | `production`.                                                |

**No key ever reaches the browser.** The client only ever calls `/api/*`; the
server signs every upstream request. Do not add a key to `Dockerfile`,
`render.yaml`, or anything else that gets committed.

---

## Rolling a key

If a key is ever exposed, it is faster to rotate than to reason about:

1. Revoke and reissue at the provider.
2. Render dashboard → the service → **Environment** → update the value → save.
   Render redeploys automatically.
3. Update your local `.env` too.

---

## Known limitation: one instance only

The rate limiter is in-memory. If this is ever scaled to more than one
instance, each instance keeps its own counters and the effective per-IP budget
multiplies by the instance count. For a hackathon demo that is fine and the
config above keeps it at one instance. Scaling out would mean moving the
windows into a shared store — do not scale the service and assume the limits
still hold.
