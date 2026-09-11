# JennySol AI Infrastructure — Current (Mac) and Future (Dedicated GPU Server)

Written 2026-09-11. This is the map a future engineer should be able to read to move JennySol's
inference layer to new hardware **without understanding the whole application** — the provider
abstraction (`server/src/services/modelRouter.ts`, `providers/*.ts`,
`services/models/{hardwareProfile,modelRegistry}.ts`) already exists specifically so that move is
a config change, not a rewrite. This document explains what that abstraction is, what runs where
today, and exactly what changes (and what doesn't) when the RTX 5090 server arrives.

## The shape of it

```
BROWSER
   |
JENNYSOL (Node/Express) — owns: auth, sessions, conversations, RAG, tool orchestration,
   |                              AgentRun, the Arena/HRLMS agent gateway
MODEL ROUTER (modelRouter.ts)
   |
   +-- ordered, health-gated provider chain (LLM_PROVIDER_CHAIN)
   |
   +---- CLOUD: Gemini, DeepSeek (each ~15 lines of provider code,
   |            see providers/deepseek.ts as the template)
   |
   +---- LOCAL: Ollama -> whatever model modelRegistry.ts picks for
                the task, bounded by the active HardwareProfile
```

JennySol never talks to Arena's or HRLMS's databases directly — see
`VIKISOL-ECOSYSTEM-MAC-HANDOFF.md` for that boundary; it's unrelated to and unaffected by anything
in this document.

## Today: this Mac

- **Production traffic today is NOT on this Mac** — it's on Railway (`jennysol-ai-api` project,
  `jennysol-api` service, `railway up`-deployed, no GitHub auto-deploy). This document treats "the
  Mac is our current server" as the founder's stated *direction*, prepared and verified this
  session, not yet the live traffic path — see
  [JENNY_MAC_PRODUCTION_REQUIREMENTS.md](JENNY_MAC_PRODUCTION_REQUIREMENTS.md) for exactly what's
  still missing before that cutover is safe (a reverse proxy/tunnel, chiefly), and why this session
  didn't perform it.
- **Hardware profile**: `m1_16gb` (Apple M1 Pro, 16GB unified memory) — see
  [JENNY_LOCAL_MODEL_MATRIX.md](JENNY_LOCAL_MODEL_MATRIX.md) for the exact budget this drives.
- **Local model**: `qwen3:8b` via Ollama, running as a `brew services` launchd daemon on
  `127.0.0.1:11434` (never exposed beyond localhost).
- **Cloud fallback**: Gemini (configured), DeepSeek (implemented, not yet configured — see
  [JENNY_REQUIRED_PROVIDER_CONFIGURATION.md](JENNY_REQUIRED_PROVIDER_CONFIGURATION.md)).
- **To actually prefer local-first on this Mac**: `DEPLOYMENT_MODE=local` in `server/.env` — the
  router's own `defaultChainFor()` then resolves to `ollama,gemini,deepseek` automatically, no
  other code change. Railway's production `.env` deliberately keeps `DEPLOYMENT_MODE=cloud` (its
  actual current value) — Ollama is unreachable from Railway's container regardless, so this
  setting has zero effect there today; it only matters once JennySol itself runs somewhere that
  can reach Ollama.

## Tomorrow: the dedicated GPU server

Not purchased yet, per the founder's own framing of this checkpoint. What's already built for it:

- `hardwareProfile.ts` already has a second profile, `dedicated_rtx5060ti_16gb` — named for an
  earlier-discussed spec (Ryzen 5 9600X / 64GB RAM / RTX 5060 Ti 16GB). **The founder's message
  this checkpoint describes a different, larger eventual target — two RTX 5090 32GB cards plus
  256GB system RAM.** That's a real, separate hardware profile this document is NOT inventing
  today (per the instruction not to build speculative infrastructure ahead of the real hardware) —
  when that machine exists, add a new entry to `HARDWARE_PROFILES` (e.g. `dedicated_2x5090_256gb`)
  with real, measured `usableMemoryGb`/`maxSingleModelGb`/`maxConcurrentLocalRuns` values, the same
  way `dedicated_rtx5060ti_16gb` already models a single-GPU box. The registry's own `fitsHardware()`
  check is VRAM/GPU-memory-bounded by design (see its comment: "a quantized model that doesn't fit
  the GPU spills to CPU and loses the entire point of having a dedicated GPU box"), so a two-GPU
  profile's `maxSingleModelGb` should reflect *one* GPU's usable VRAM unless/until the app also
  gains real multi-GPU model-sharding support — that's new work, not assumed here.
- `qwen2.5-coder:14b` and `deepseek-r1:32b` are already registered, license-verified, and marked
  `requiresDedicatedServer: true` — ready to enable the moment a profile they fit exists.
- **What changes to move inference to that machine**: install Ollama there, pull the same curated
  tags, set `OLLAMA_BASE_URL` to wherever it's reachable from wherever JennySol's own process runs
  (localhost if JennySol runs on the same box; otherwise a private network address — never a
  public one, same "never expose Ollama publicly" rule as today), set `LOCAL_HARDWARE_PROFILE` to
  the new profile id. **Nothing in `modelRouter.ts`, `chatRunner.ts`, or any route changes.**
- **What does NOT move automatically**: JennySol's own server process. Whether JennySol itself
  runs on the GPU box, on this Mac, or stays on Railway with `OLLAMA_BASE_URL` pointed at the GPU
  box over a private network are three independent decisions — the provider abstraction supports
  all three without code changes, but which one is right is an infrastructure/cost/latency
  decision for the founder, not something to assume here.

## Specialized capabilities — status, not aspiration

Per the instruction to distinguish available-now from future rather than implying more exists than
does (cross-checked against `capabilityRegistry.ts`, the app's own live-computed source of truth):

| Capability | Status |
|---|---|
| Text generation (local) | **AVAILABLE NOW** — `qwen3:8b`, verified this session (chat + tool calling) |
| Text generation (cloud) | **AVAILABLE NOW** — Gemini configured; DeepSeek implemented, needs a key |
| Coding-specialized local | **SUPPORTED, NOT PULLED** — `qwen2.5-coder:7b` registered, license-verified, not downloaded this session (start small) |
| Reasoning-specialized local | **SUPPORTED, NOT PULLED** — `deepseek-r1:7b` registered, same as above; no tool calling (by design — see the model matrix) |
| Embeddings | **AVAILABLE NOW** — already local (`@huggingface/transformers`, ONNX, in-process), predates this session, unrelated to Ollama |
| Vision | **NOT SUPPORTED** — no code path exists; `capabilityRegistry.ts` reports `implemented: false` honestly today |
| STT | **AVAILABLE NOW**, but client-side only — browser Web Speech API, nothing server-side |
| TTS | **AVAILABLE NOW**, cloud-only — Gemini TTS, consumes quota; a self-hosted path (Kokoro/Piper) is a documented future option in `JENNYSOL_FREE_FIRST_ARCHITECTURE.md`, not built |

## Provider debugging

Two ways to inspect live router/provider state, both secret-free by construction:
- `npm run models -- health` (from `server/`) — hardware snapshot, per-provider configured status,
  Ollama reachability + installed-model status, circuit-breaker state. Pre-existing tooling, not
  new this session (the `ensureOllamaChecked` fix this session made its `reachable` line
  trustworthy for a short-lived CLI process — see the Final Report for the exact bug).
- `GET /api/admin/provider-health` (admin-authenticated) — new this session, the same
  circuit-breaker/hardware/installed-model data as a JSON endpoint for the running server process
  itself, alongside the pre-existing `GET /api/admin/config-health` (per-capability
  configured/available status).

## What this document is not

Not a claim that inference has moved to this Mac in production — see
[JENNY_MAC_PRODUCTION_REQUIREMENTS.md](JENNY_MAC_PRODUCTION_REQUIREMENTS.md) for that gap. Not a
cost/pricing document — see `docs/JENNYSOL_FREE_FIRST_ARCHITECTURE.md` for the free-vs-paid
provider framing this document deliberately doesn't repeat.
