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
