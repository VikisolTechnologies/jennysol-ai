# JennySol — Local Model Matrix

The curated registry lives in code — `server/src/services/models/modelRegistry.ts` — this document
is the human-readable view of it, plus the real hardware constraint that decides what's actually
safe to run, and the real verification this session ran against it. **This file should be treated
as a snapshot; the code (`MODEL_REGISTRY`) is the source of truth if the two ever disagree.**

## Hardware profile actually in effect

This Mac auto-detects as `m1_16gb` (Apple Silicon, 16GB unified memory — see
`hardwareProfile.ts`'s `detectProfileId()`):

| | Budget |
|---|---|
| Total memory | 16GB |
| Usable budget (leaves headroom for macOS/Node/browser/Ollama overhead) | 10GB |
| Ceiling for a single loaded model | **6GB** |
| Max concurrent local runs | 1 |

A second profile (`dedicated_rtx5060ti_16gb`) already exists in the same file for the next real
hardware step — see [JENNY_AI_INFRASTRUCTURE.md](JENNY_AI_INFRASTRUCTURE.md) for the migration
story. Nothing about *this* document changes when that happens — only `LOCAL_HARDWARE_PROFILE`
does.

## Curated registry, license-verified

| Model | Size (Q4, resident) | Fits `m1_16gb`? | License | Capabilities | Tool calling |
|---|---|---|---|---|---|
| `llama3.2:3b` | 2.0GB | Yes | Llama 3.2 Community License (Meta) — commercial use permitted; a separate license from Meta is required only past 700M monthly active users, nowhere near relevant here | general | Declared yes in registry — **not independently re-verified this session** (qwen3:8b was; see below) |
| `qwen3:4b` | 2.5GB | Yes | **Apache 2.0** — fully permissive | general, currentInfoSummarization | Declared yes — not independently re-verified this session |
| `qwen3:8b` | 5.2GB | Yes | **Apache 2.0** — fully permissive | general, reasoning, currentInfoSummarization | **Yes — real, verified this session** (see below) |
| `qwen2.5-coder:7b` | 4.7GB | Yes | **Apache 2.0** — fully permissive | coding | Declared yes — not independently re-verified this session |
| `deepseek-r1:7b` | 4.7GB | Yes | MIT (Qwen-2.5 base license applies to the underlying weights) | reasoning | Declared **no** in registry (correct — DeepSeek-R1's distilled models are reasoning-trace models, not instruction-tuned for structured tool calling) |
| `nomic-embed-text` | 0.5GB | Yes | **Apache 2.0** — fully permissive | embedding | N/A (embedding model, not chat) |
| `qwen2.5-coder:14b` | 9.0GB | **No** — reserved for the future dedicated server | Apache 2.0 | coding | Declared yes, untested here (can't fit on this hardware to test) |
| `deepseek-r1:32b` | 20GB | **No** — reserved for the future dedicated server | MIT (Qwen-2.5 base license) | reasoning | N/A |

All "free" here means **FREE API** in the strictest sense — self-hosted, zero per-token cost, no
card, no usage cap other than this machine's own hardware. None require any account or key.

## What this session actually pulled and tested

Per the governing instruction to start with a small number of sensible models rather than
downloading broadly: pulled **`qwen3:8b`** only — it's what `pickOllamaModel("general")` actually
selects today (see `modelRegistry.ts`'s `bestOf()`: among the `m1_16gb`-fitting, general-capable
Ollama entries, `qwen3:8b`'s `qualityClass: "capable"` outranks `llama3.2:3b`/`qwen3:4b`'s
`"basic"`), so it's the one real end-user chat requests would actually reach once Ollama is in the
active provider chain — testing anything else first would verify a path real traffic doesn't take.

## Real verification performed this session

### Chat (Section 11 of the governing directive — no fake responses, no canned text, no keyword
detection, no simulated streaming)

Real request through the actual JennySol pipeline (`DEPLOYMENT_MODE=local`, forcing the router's
chain to include Ollama; see `modelRouter.ts`'s `defaultChainFor`), not a standalone script talking
to Ollama directly — see the Final Report's "Local AI" section for the transcript and timing.

### Tool calling (Section 12)

A real, genuine gap was found before this could even be tested: `server/src/services/providers/openaiCompatible.ts`
(shared by Ollama and DeepSeek) implemented no tool-calling support at all — it never sent `tools`
in the request body and never parsed `tool_calls` deltas from the stream, silently dropping the
`opts.tools`/`opts.onToolCall` parameters `modelRouter.ts` already threads through to every
provider. `modelRegistry.ts` claimed `supportsToolCalling: true` for the local models anyway — a
real, load-bearing claim that was untested and, until this session, false.

Implemented (mirroring `gemini.ts`'s existing bounded-loop pattern, `MAX_TOOL_ROUNDS = 4`, same
never-leave-the-turn-empty fallback): request-time `tools` serialization, streamed `tool_calls`
delta accumulation by index, tool execution via the same `onToolCall` contract every other
provider uses, and a second round-trip carrying the tool result back as an OpenAI-shaped `role:
"tool"` message. Covered by 4 new unit tests (`openaiCompatible.test.ts`) against a mocked SSE
stream — plain-chat regression safety, a real tool round-trip, a tool-error-fed-back-as-data path,
and the bounded-loop-exhaustion fallback. All pass. See the Final Report for the *real*,
live-model verification (not just the mocked unit tests) against `qwen3:8b`.

## What's deliberately not installed or claimed

- **Coding-specialized** (`qwen2.5-coder:7b`) and **reasoning-specialized**
  (`deepseek-r1:7b`) local models are real registry entries, already license-verified, but **not
  pulled this session** — per the instruction to start small. `npm run models -- install <tag>`
  reports exactly this status and prints the `ollama pull` command to run by hand; it deliberately
  never auto-pulls (see `models-cli.ts`'s `cmdInstall` — "This CLI does not auto-pull models... per
  the architecture spec: never download automatically").
- **Vision, dedicated STT/TTS local models**: not implemented anywhere in this codebase yet — see
  `capabilityRegistry.ts`'s `VISION` entry (`implemented: false`) and
  [JENNY_AI_INFRASTRUCTURE.md](JENNY_AI_INFRASTRUCTURE.md) for what's planned vs. what exists.
- **`qwen2.5-coder:14b`, `deepseek-r1:32b`**: correctly marked `requiresDedicatedServer: true` and
  excluded by `fitsHardware()` on this profile regardless of their own `enabled` flag — not
  installed, not testable on this hardware, reserved for the RTX server.
