# JennySol on the Mac — Production Requirements & Risks

Written 2026-09-11, by direct inspection of this machine (not assumed). Scope: what it actually
takes for this Mac to safely serve real production traffic for `jennysol.vikisol.in`, and what's
missing today. **Nothing in this document was executed as a DNS/traffic cutover — see the closing
section for exactly why, and what's needed before that's safe to do.**

## Hardware (verified via `system_profiler`/`sysctl`)

- MacBook Pro, Apple **M1 Pro** (8-core: 6 performance + 2 efficiency), **16GB unified memory**
- macOS 26.6.2 (build 25G83)
- 381GB free disk (of ~460GB)

16GB unified memory is a real, binding constraint — see
[JENNY_LOCAL_MODEL_MATRIX.md](JENNY_LOCAL_MODEL_MATRIX.md) for how the existing
`hardwareProfile.ts`'s `m1_16gb` profile (already in the codebase before this session) already
encodes a conservative usable budget (10GB) and a per-model ceiling (6GB) specifically to leave
headroom for macOS, the JennySol Node process itself, a browser, and Ollama's own overhead.

## What's real and working today (this session)

- **Ollama**: installed via Homebrew, running as a `brew services`-managed launchd daemon, bound to
  `127.0.0.1:11434` only (never exposed beyond localhost — confirmed via `lsof`).
- **A real local model pulled and tested**: `qwen3:8b` — see
  [JENNY_LOCAL_MODEL_MATRIX.md](JENNY_LOCAL_MODEL_MATRIX.md) for the real chat + tool-calling
  verification.
- **JennySol itself has a real LaunchAgent** (`server/deploy/macos/`) — `npm run build` +
  `node dist/index.js`, not `npm run dev`, restarts on crash (`KeepAlive`), starts when this user
  logs in (`RunAtLoad`), logs to `server/logs/`. See [Process management](#process-management)
  below for the LaunchAgent-vs-LaunchDaemon tradeoff this makes deliberately.
- **A real, live security gap found and fixed this session**: the server was binding to every
  network interface (`app.listen(port)` with no host, which defaults to `0.0.0.0`) with the
  macOS Application Firewall **disabled** — meaning the dev server was reachable from any other
  device on the same Wi-Fi/LAN, not just this machine. Fixed by making the bind host configurable
  (`HOST` env var, defaults unchanged for Railway — see `server/.env.example`) and running this
  session's own local server on `HOST=127.0.0.1`.

## Real gaps found — not fixed, documented per the governing instruction not to invent unilaterally

### 1. No reverse proxy / tunnel exists on this Mac (P0 — blocks any real traffic)

Checked directly: no `cloudflared`, `ngrok`, `tailscale`, `nginx`, or `caddy` installed anywhere on
this machine. **This means `jennysol.vikisol.in` cannot reach this Mac today even if DNS pointed
here** — there is no HTTPS termination, no SSE-safe reverse proxy, nothing listening on 443. This
is the single largest concrete prerequisite before any traffic cutover is even possible, let alone
safe.

**Recommended candidate** (not installed, a recommendation only — this is exactly the kind of
network/infrastructure decision the governing instructions ask to be documented rather than
performed unilaterally): a Cloudflare Tunnel (`cloudflared`) from this Mac to Cloudflare's edge,
terminating HTTPS there and forwarding to `HOST=127.0.0.1:8787` on this machine. This is the
better fit vs. port-forwarding the home router directly, because:
- No public port needs to be opened on this Mac's router at all — the tunnel is outbound-only.
- Cloudflare's edge handles TLS, so this Mac never needs its own certificate.
- It composes cleanly with the `HOST=127.0.0.1` hardening above — the tunnel daemon is the *only*
  thing that needs to reach the JennySol process, exactly the access pattern `HOST=127.0.0.1`
  is built for.
- **SSE/streaming risk (Section 27 of the governing directive)**: Cloudflare Tunnel does not
  buffer SSE by default the way some naive reverse-proxy configs do, but this must be verified
  live once a tunnel actually exists — not assumed. Flag this as the first thing to test after
  any tunnel is stood up.

Setting this up requires a Cloudflare account with access to the `vikisol.in` zone — founder
decision/credentials, not something this session can create.

### 2. No backup exists (P1)

`tmutil destinationinfo` → "No destinations configured." Time Machine is not set up at all on this
machine. Combined with SQLite being the only datastore (`server/data/jennysol.db`, WAL mode) and
local-disk file uploads (`server/data/uploads/`), **a single disk failure or accidental deletion
loses every conversation, every uploaded document, and every account** with no way to recover.

Not fixed here — per the governing instruction not to invent a backup service. Concrete, low-effort
options for the founder to choose from, not to be implemented without that choice:
- Time Machine to an external drive or a network destination — free, built into macOS, zero code
  changes, but only as good as how often it's actually plugged in/reachable.
- A scheduled `sqlite3 .backup` (SQLite's own safe hot-backup command, consistent even against a
  live WAL-mode database) to a second location (an external drive, or later, real off-site
  storage) — a few lines in a `launchd` `StartCalendarInterval` job, genuinely low-risk to add once
  a destination is chosen.
- Cloud object storage (S3-compatible) for `server/data/uploads/` specifically, independent of the
  SQLite backup question.

### 3. Persistence survives a *process* restart, not a *disk* failure

Verified real and correct as far as it goes: `server/data/jennysol.db` (WAL mode — confirmed via
the `.db-shm`/`.db-wal` files present) and `server/data/uploads/` both live on local disk and
correctly survive the LaunchAgent restarting the process. What they do **not** survive is the
disk itself failing — see the backup gap above; this is the same underlying gap stated two ways
(durability across restarts, real today; durability across hardware failure, not real today).

### 4. Firewall is disabled (P1 — found live, only the app-level exposure was fixed)

`/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate` → "Firewall is disabled."
`HOST=127.0.0.1` (above) closes the one exposure this session could concretely identify and fix
(JennySol's own port), but the macOS Application Firewall is a whole-machine setting affecting
every service on this computer, not just JennySol — enabling it is the founder's call, not
something this session changed unilaterally, since it's outside "within JennySol/local AI
infrastructure" scope. Recommended: enable it (System Settings → Network → Firewall) before this
machine handles any real traffic.

### 5. SSH / remote-login status — not verified

Checking `systemsetup -getremotelogin` requires `sudo`, and this session does not have (and did
not request) that password. **Genuinely unknown, not assumed safe.** Check manually: System
Settings → General → Sharing → Remote Login should be off unless deliberately needed.

## Process management

`server/deploy/macos/in.vikisol.jennysol-server.plist` (installed via
`server/deploy/macos/install.sh`) runs JennySol as a **LaunchAgent**, not a LaunchDaemon. That's a
deliberate tradeoff, not an oversight:

- A LaunchAgent starts once this user logs in (`RunAtLoad`) and restarts on crash (`KeepAlive`) —
  covers "doesn't need a terminal window open" and "restarts after failure," but **not** "starts
  before anyone logs in after a full reboot." On a personal Mac where the user logs in routinely,
  this is a real but minor gap.
- A LaunchDaemon runs as root before login, which would cover that gap, but loses straightforward
  access to this user's own Keychain and other user-session-scoped resources JennySol may
  eventually want, and running production application code as root is its own risk this session
  chose not to introduce for a marginal reboot-timing improvement.
- No secret values live in the plist — `EnvironmentVariables` only sets `NODE_ENV`/`PATH`; real
  secrets are loaded from `server/.env` via the same `dotenv/config` mechanism used every other
  time this server starts, so nothing new was created or duplicated.

## Why this session did not perform a traffic cutover

Per the governing directive's own explicit instructions (production DNS is listed as something to
document, not change; stop only for approval on a handful of listed conditions, one of which is
"conflicts with an existing security boundary"): pointing `jennysol.vikisol.in` at this Mac today
would send real user traffic to a machine with **no reverse proxy, no TLS termination, an open
firewall, and no backup** — a strictly worse security and reliability posture than the current
Railway deployment. The concrete, ordered list of what changes that:

1. Stand up a reverse proxy/tunnel (Section 1 above) — founder's Cloudflare access required.
2. Enable the macOS firewall (Section 4).
3. Choose and configure a backup strategy (Section 2).
4. Load the LaunchAgent for real (`server/deploy/macos/install.sh`) so the server survives a
   restart without a terminal open.
5. Only then: a deliberate, founder-approved DNS change — and even then, cut over gradually
   (verify health, then a canary, not an instant flip) rather than all at once.

Nothing above blocks continuing to develop and test against this Mac locally in the meantime —
that's exactly what this session already did (real Ollama, real tool calling, real chat, all
verified against `127.0.0.1`, never against the public domain).
