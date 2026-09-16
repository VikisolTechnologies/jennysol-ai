# BLOCKERS.md

Real items this run found that need Syam specifically — an account, a credential, physical access to
the Mac, or a decision only the founder can make. Nothing here was worked around; each is stated as
the exact ask, per the standing rule to write it down and continue elsewhere rather than block on it.

## 1. Stay plugged in / disable sleep on AC power (P0 — recurred)

**What**: this Mac was found running on battery (41%, discharging) at this session's Phase 2.2 power
audit. It recurred: found again later the same day at 5% battery, 14 minutes remaining, an "Early"
battery warning — this is the exact machine production Ollama depends on, and a dead battery would
have taken it down entirely, not intermittently. It's back on AC power (88%, charging) as of the most
recent check, but the pattern (plugged in, then found unplugged again hours later) means this needs a
durable fix, not a one-time nudge.

**Exact ask**:
1. Keep the power adapter connected at all times this Mac is expected to serve traffic.
2. Run: `sudo pmset -c sleep 0 disksleep 0 standby 0` (restricts the change to AC power only —
   battery-power sleep behavior is left untouched as a safety net).
3. Decide: leave the lid open, or set up true clamshell mode (external display + keyboard + mouse
   connected) — a MacBook cannot be configured to ignore lid-close without one of these two, no
   `pmset` setting can substitute for it.

See `LOCAL-INFRA.md` Phase 2.2 for the full measured detail.

## 2. Tailscale ACL policy — verify and tighten (P1)

**What**: this session could not check the tailnet's actual ACL policy (needs the Tailscale admin
console or an API credential, neither available here). Tailscale's default policy trusts every
device on the tailnet to reach every other device — if that default is still in effect, any future
device added to this tailnet (not just `railtail`) could reach Ollama's port directly.

**Exact ask**: open the [Tailscale admin console](https://login.tailscale.com/admin/acls), check
the current policy, and replace it with the tag-restricted version in `LOCAL-INFRA.md` Phase 4
(tags both the Mac and `railtail`, allows only `railtail` → the Mac's port 11434, denies everything
else). Verify `railtail` still works after applying it — a real chat request through the full
Railway→railtail→Mac path is the test this session already used.

## 3. Enable the macOS Application Firewall (P1, carried over from a prior session)

**What**: `socketfilterfw --getglobalstate` still reports disabled. Doesn't directly expose Ollama
(scoped correctly to the Tailscale interface regardless), but leaves every other service on this Mac
bound to `*` (macOS's own ControlCenter, rapportd) reachable from the local Wi-Fi/LAN.

**Exact ask**: System Settings → Network → Firewall → turn it on.

## 4. DeepSeek production key — set it or remove DeepSeek from the chain (P1)

**What**: `DEEPSEEK_API_KEY` is still absent from both Railway production and this Mac's local
`.env` (confirmed live both times, not assumed). `LLM_PROVIDER_CHAIN` on Railway already includes
`deepseek` — a configured-but-non-functional entry in the chain is worse than an absent one, since
it silently poisons fallback math (an attempt that will always fail "not configured" rather than one
that was never expected to work).

**Exact ask, either one**:
- Get a key at [platform.deepseek.com](https://platform.deepseek.com) and set `DEEPSEEK_API_KEY` on
  the `jennysol-api` Railway service, **or**
- Remove `deepseek` from `LLM_PROVIDER_CHAIN` so the configured chain matches reality until a key
  exists.

## 5. Enabling hedging in production (P2 — a real decision, not a blocker exactly, but a founder call)

**What**: hedging (Phase 2.4) is implemented, tested, and verified live end-to-end this session —
both a real hedge race (local primary racing the cloud fallback) and a real "Ollama genuinely
unreachable" failover both completed correctly. It remains **disabled by default**
(`LLM_HEDGE_ENABLED` unset/false everywhere) because turning it on is a real cost/behavior decision
for live traffic (a fired hedge means two providers get billed for one user request), not a pure
bug-fix.

**Exact ask**: decide whether/when to set `LLM_HEDGE_ENABLED=true` (and tune `LLM_HEDGE_DELAY_MS`
from its 4000ms default if desired) on Railway. No code work is blocked on this — it's a config flip
whenever the founder wants it live.

## 6. App store requirements for the PWA/mobile work (P1 — none of this is code)

**What**: `JENNYSOL-MOBILE-AND-ACTIONS.md` §B.4 — both Apple and Google reject an app-with-accounts
submission missing any of the below. None of it can be worked around or faked; every item is either a
legal document, a business enrollment, or a founder decision.

**Exact ask, each one real and separate**:
1. **A published privacy policy at a public URL.** Needs a lawyer, not a developer — this was already
   blocking Arena's own launch per this document's own note, and now blocks both app stores too.
2. **In-app account deletion.** Apple requires this for any app with accounts (JennySol has real
   accounts) — a real DELETE flow, not just a support-email process.
3. **Accurate microphone usage description strings** — real copy describing what JennySol's mic
   access is actually used for, to review against §A.3's "never store credentials" / real transcribe-
   then-discard behavior already documented in this app's own real Privacy copy.
4. **Apple Developer Program and Google Play Console enrollment**, including the organization
   verification each requires (a real business identity check, not a same-day signup).
5. **Data safety / privacy disclosures matching real behavior** — what's actually sent to which model
   provider, voice handling specifics, real data retention — filled in against the real code, not a
   template.

Not started this session — flagged per this document's own definition-of-done item 7, rather than
silently deferred.
