# LOCAL-INFRA.md

Written 2026-09-13, as part of `JENNYSOL-LOCAL-CUTOVER.md` / `JENNYSOL-CONTINUE.md`. Documents the
real, currently-live state of this Mac as production-adjacent infrastructure — measured directly on
the machine, not assumed. Two sections: Phase 2.2 (power/sleep, below) and Phase 4 (tunnel/security,
appended once that phase runs in this same session).

## Phase 2.2 — Power and sleep (real, measured — not assumed)

### Urgent finding: this Mac is running on battery right now, not plugged in

Checked directly (`pmset -g batt`, `system_profiler SPPowerDataType`) while writing this document:

```
Now drawing from 'Battery Power'
-InternalBattery-0: 41%; discharging; 3:18 remaining
AC Charger Information: Charging: No
```

If this machine is meant to be always-on infrastructure serving real Ollama traffic through the
Railway↔Tailscale↔`railtail` path, **it needs to be on AC power continuously**. Running on battery
means it can die outright (battery depletion) with zero warning to the app layer beyond requests
starting to fail, and Apple's own low-power-mode behavior (`lowpowermode: 1`, confirmed active right
now) throttles performance specifically while unplugged.

**Syam action — P0, do this first:** keep this Mac's power adapter connected at all times it's
expected to serve traffic. Nothing else in this section matters if it's not plugged in.

### Current sleep settings (real, via `pmset -g`)

| Setting | Current value | Real-world effect |
|---|---|---|
| `sleep` | `1` (enabled) | System sleeps after idle timeout on **both** AC and battery |
| `standby` | `1` (enabled) | Deeper sleep (RAM saved to disk) after regular sleep |
| `displaysleep` | `180` min | Display (not system) sleeps after 3h idle |
| `lowpowermode` | `1` on battery, `0` on AC | Throttles CPU/network on battery — another reason to stay plugged in |
| `powernap` | `1` (enabled) | Limited background activity during sleep — does not keep Ollama's HTTP server reachable |

At the moment this was checked, sleep was being held off only by two **temporary** assertions (a
background Address Book sync, and "display is currently on") — neither is a durable guarantee. Once
those clear and the machine sits idle, it will sleep under the current configuration, and Ollama's
HTTP server stops answering entirely while asleep (`railtail`'s forwarded connections would just
hang/time out — this is exactly what a keep-warm ping failing, Phase 2.1, would first reveal).

**Syam action — P0:** disable sleep specifically while on AC power (leaves battery-power behavior
untouched, so a battery-power sleep policy still protects the machine if it's ever unexpectedly
unplugged):

```
sudo pmset -c sleep 0 disksleep 0 standby 0
```

`-c` scopes this to "when charging/on AC power only" — deliberately not `-a` (all power sources),
so the machine still behaves like a normal laptop and protects its battery if the P0 "stay plugged
in" action above is ever not followed.

### Lid-close behavior — a real constraint, not a settings toggle

**A MacBook cannot be configured, via `pmset` alone, to ignore lid-close and stay awake, unless an
external display is connected.** This is deliberate Apple platform behavior (thermal/safety), not a
gap in the settings above — no `pmset` flag disables it on a clamshell-only MacBook. Two real options,
Syam's call:

1. **Leave the lid open.** Simplest, zero cost, but means physically not closing this laptop for as
   long as it's serving traffic.
2. **True clamshell mode**: connect an external display, keyboard, and mouse/trackpad, then the lid
   can close and the Mac stays fully awake (Apple's supported clamshell-mode configuration). Needs
   real hardware sitting next to this Mac.

Neither was set up during this session — this is recorded as a decision for Syam, not performed
unilaterally, since it's a real physical/hardware choice about this specific machine's location and
setup.

### What Phase 2.1's keep-warm gives you here

The keep-warm ping (every 4 minutes, see `keepWarm.ts`) will start failing the moment this Mac
actually sleeps — that failure is logged as `{"event":"keep_warm","ok":false,...}` and is the
earliest automated signal available today that the machine has dropped off. It is not a substitute
for actually preventing sleep; it only tells you sleep happened, after the fact.

## Phase 4 — Security of the local path

Written 2026-09-13. Every claim below was checked directly on this Mac/this Railway project — not
assumed — and the two real gaps are stated plainly, per the instruction not to silently leave them.

### The real path, end to end

```
Railway (jennysol-api, public HTTPS: api.jennysol.vikisol.in)
    │  OLLAMA_BASE_URL=http://railtail.railway.internal:11434
    ▼
Railway Private Network (internal to the jennysol-ai-api project only —
    never traverses the public internet; Railway's own network boundary)
    ▼
railtail (2nd Railway service, joined to the tailnet as node "railtail-jennysol")
    │  WireGuard-encrypted (Tailscale's own transport)
    ▼
This Mac's Tailscale interface (100.70.199.75:11434)
    ▼
Ollama (bound to 100.70.199.75:11434 ONLY — confirmed live: refuses
    127.0.0.1, was never bound to 0.0.0.0 or the LAN interface)
```

### What's confirmed genuinely correct today

- **Ollama's own bind is correctly scoped.** Checked live (`lsof`): listening only on
  `100.70.199.75:11434` (the Tailscale interface). Connections to `127.0.0.1:11434` are refused.
  It is not reachable from this Mac's regular Wi-Fi/LAN interface, and never was at any point this
  session — the earlier rebind (Phase 2.3-adjacent work) went straight from localhost-only to
  Tailscale-only, with no `0.0.0.0` step in between.
- **The Tailscale auth key (the one real secret in this whole path) never leaked anywhere on disk.**
  Checked directly: absent from `git log --all -p` (full history, not just the current tree),
  absent from the working tree, absent from both `~/.zsh_history` and `~/.bash_history`. It was
  entered once, directly into Railway's own secret-storage web form by the founder — exactly the
  intended, secure path — and never passed through this session's own shell commands as a literal
  value (one earlier attempt to do so was correctly blocked by the sandbox's own credential-leakage
  guard before it ever ran).
- **No prompt/message content is logged to disk.** Checked every `console.log`/`console.error` call
  in the real chat path (`chatRunner.ts`, `modelRouter.ts`, `keepWarm.ts`) — the structured
  `chat_timing` and `keep_warm` log lines that persist to `server/logs/` on this Mac carry only
  metadata (provider, model, capability, timing, token *counts*), never raw message text. The one
  residual, generic caveat: a few places log a raw caught error object as-is
  (`console.error("...", err)`) — if a provider SDK's own error object ever happened to echo request
  content into its message/stack, that would leak through this generic pattern. No instance of this
  actually happening was found; it's a structural risk common to this logging style, not a known bug.

### Two real gaps, not silently left

**1. The Tailscale ACL policy could not be independently verified this session — and the honest
assumption should be that it's still permissive.** Checking the actual ACL requires either the
Tailscale admin console (a browser action) or a Tailscale API credential, neither of which this
session has. Tailscale's own default policy for a new tailnet (unless someone has deliberately
written a custom one) is "any device on the tailnet can reach any other device on any port" — under
that default, **every device ever added to this tailnet in the future** (a phone, another laptop,
anything) — not just `railtail` — would be able to reach `100.70.199.75:11434` directly, with
nothing else in this path stopping it. This is a real gap against the stated requirement ("only the
JennySol backend identity can reach it").

**Proposed fix (Syam action — requires the Tailscale admin console, which this session cannot
reach):**

1. Tag both real nodes in the admin console (Settings → or via `tailscale up --advertise-tags=...`
   run once on each): the Mac as `tag:jennysol-mac`, `railtail` as `tag:railtail` (railtail's own
   `TS_HOSTNAME` already identifies it; tags are a separate, additional label).
2. Replace the default ACL policy (Access Controls in the admin console) with:
   ```json
   {
     "tagOwners": {
       "tag:jennysol-mac": ["autogroup:admin"],
       "tag:railtail": ["autogroup:admin"]
     },
     "acls": [
       { "action": "accept", "src": ["tag:railtail"], "dst": ["tag:jennysol-mac:11434"] }
     ]
   }
   ```
   This denies everything by default and allows only `railtail` → the Mac's port 11434 — not even
   the founder's own other devices could reach it once this is in place, which is the correct,
   tightest version of "only the JennySol backend identity."
3. **Verify before trusting it**: re-run the real end-to-end test this session already used (a real
   chat request through the full Railway→railtail→Mac path) after applying the ACL, to confirm
   `railtail` still works — and, ideally, temporarily join a second test device to the tailnet to
   confirm it's genuinely denied.

Not applied by this session — it's a real access-control change to a live account, exactly the kind
of thing that risks locking out the very connectivity just built if a tag or rule is slightly wrong,
and it needs the admin console this session cannot reach anyway.

**2. The macOS Application Firewall is still disabled.** Checked directly
(`socketfilterfw --getglobalstate` → "Firewall is disabled") — this is not new, a prior session
already found and documented this same gap, and it remains unresolved. It does not directly expose
Ollama (which isn't bound to any LAN/public-reachable address regardless), but it does mean every
other service on this Mac listening on `*` (confirmed live: macOS's own `ControlCenter` on ports
5000/7000, `rapportd` — both standard macOS services, not anything JennySol introduced) is reachable
from the local Wi-Fi/LAN. **Syam action, unchanged from the prior session's finding:** enable it via
System Settings → Network → Firewall.
