# JennySol — Model Fleet Strategy

Written 2026-09-11. This is the decision document: what JennySol's model fleet is today, what's
being added and why, what's deliberately being skipped and why, and the design for making JennySol
genuinely model-agnostic behind one router. For the full per-model license research this leans on,
see [JENNY_MODEL_LICENSE_MATRIX.md](JENNY_MODEL_LICENSE_MATRIX.md). For what's actually wired into
code today, see [JENNY_LOCAL_MODEL_MATRIX.md](JENNY_LOCAL_MODEL_MATRIX.md) (kept in sync with
`server/src/services/models/modelRegistry.ts` — that file is the source of truth if this one drifts).
For the router/provider shape and the Mac→GPU-server migration story, see
[JENNY_AI_INFRASTRUCTURE.md](JENNY_AI_INFRASTRUCTURE.md). For the verified hardware constraints and
production gaps (reverse proxy, backup, firewall), see
[JENNY_MAC_PRODUCTION_REQUIREMENTS.md](JENNY_MAC_PRODUCTION_REQUIREMENTS.md) — that document already
covers what a `JENNY_LOCAL_AI_HARDWARE.md` would, so a duplicate wasn't created (see the governing
directive's own instruction to create such a file only "if an equivalent document does not already
exist").

## The principle

The user talks to **JennySol**, never to "Gemini" or "Qwen" or "DeepSeek" by name. JennySol's model
router picks the right model/provider for the task, the data sensitivity, and the hardware
available. This document is about making that fleet small, license-safe, and reliable — not large.

## Model categories in play

| Category | Status |
|---|---|
| General chat | **Live** — `qwen3:8b` (local), Gemini + DeepSeek (cloud) |
| Fast / small | Registered, pull in progress this session — `qwen3:4b` |
| Coding | Registered, pull in progress this session — `qwen2.5-coder:7b` |
| Reasoning | Registered, pull in progress this session — `deepseek-r1:7b` |
| Tool calling | **Live** — Gemini (native), Ollama + DeepSeek (via the shared OpenAI-compatible client, implemented and unit-tested last session) |
| Embeddings | **Live**, but not via Ollama — see below |
| Long context | Gemini (1M tokens, cloud); Qwen3 (256K, local) — no dedicated long-context-only model needed at current scale |
| Vision / OCR | **Not implemented** — recommendation below, not built this session |
| STT | **Live client-side only** (Web Speech API); no server-side model |
| TTS | **Live cloud-only** (Gemini TTS); local recommendation below, not built this session |
| Agentic tasks | **Live** — the tool-calling/agent-gateway path (`agentGateway.ts`) is provider-agnostic already |

## Current fleet (as of this session)

| Role | Model | Provider | License | Pulled? |
|---|---|---|---|---|
| General (primary) | `qwen3:8b` | Ollama | Apache 2.0 | Yes (prior session) |
| General (cloud) | `gemini-3.5-flash-lite` | Gemini API | Proprietary | N/A (API) |
| General (cloud fallback) | `deepseek-v4-flash` | DeepSeek API | Proprietary | N/A (API), key not yet configured in production |
| Fast/small | `qwen3:4b` | Ollama | Apache 2.0 | **Pull started this session** (background, in progress at time of writing — verify with `ollama list` before relying on it) |
| Coding | `qwen2.5-coder:7b` | Ollama | Apache 2.0 | **Pull started this session** (same caveat) |
| Reasoning | `deepseek-r1:7b` | Ollama | MIT (DeepSeek) + Apache 2.0 (Qwen2.5 base) — corrected this session, was previously mislabeled plain "MIT" in the registry | **Pull started this session** (same caveat) |
| Embedding | `Xenova/all-MiniLM-L6-v2` | In-process ONNX (`@huggingface/transformers`) | Apache 2.0 (base model) | Yes, predates this session — **this is the real RAG embedder**, not `nomic-embed-text` |
| Embedding (registered, unused) | `nomic-embed-text` | Ollama | Apache 2.0 | No — registered for future use/CLI visibility only; RAG does not call it |

**On the fast/small pull**: this directly targets a documented, real problem — `qwen3:8b`'s
measured warm first-token latency (~9s) and >10s cold starts. A 2.5GB model has materially lower
first-token latency for simple queries; the router doesn't yet route "simple" requests to it
specifically (see [Router changes](#router-changes-recommended-not-implemented) below) but having it
pulled is the prerequisite for that.

## Models evaluated and NOT recommended

| Model | Why not |
|---|---|
| Llama 3.x / Llama 4 | Meta's own roadmap has moved past it (see Muse Spark/Glimmer in the license matrix); the 700M-MAU clause, mandatory "Built with Llama" attribution, and Llama-prefixed derivative-naming rule are all real compliance surface with zero benefit over Qwen3/Mistral/Granite, which offer comparable-or-better small models under plain Apache 2.0. Not worth the license overhead. |
| Qwen2.5-VL-**3B** | Non-commercial Qwen Research License as shipped — do not deploy for a commercial product without a separate license from Alibaba. (The 7B sibling is Apache 2.0 and is the vision recommendation below — don't confuse the two.) |
| Mistral Small 3.x, Devstral, Devstral-2-123B, Qwen3-30B-A3B/235B, Qwen2.5-Coder-32B, Gemma 3/4 12B+ | All real Apache-2.0 candidates, but too large for the M1 Pro's 6GB single-model ceiling. Reserved for the RTX 5090 server — see [Future RTX-5090 migration](#future-rtx-5090-migration). |
| Coqui XTTS-v2 | Coqui Public Model License is non-commercial only, and Coqui Inc. shut down in 2024 — no vendor exists to grant a commercial exception. Do not use for any customer-facing TTS. |
| LLaVA | Llama 2 Community License base plus a research-use restriction in its own README; also measurably weaker at OCR/document tasks than Qwen2.5-VL or Moondream2 at a comparable size. No reason to prefer it. |
| Gemma 3 (as opposed to Gemma 4) | Superseded — Gemma 4 (Apache 2.0, native tool-calling) is a strict upgrade over Gemma 3's custom Terms-of-Use license at the same or smaller sizes. If Gemma is ever added to the fleet, add Gemma 4, not 3. |
| Any DeepSeek-R1-Distill-**Llama** variant | The Qwen-based distill (already in the fleet) gives the same reasoning capability without inheriting the Llama Community License's attribution/naming/MAU conditions on top of DeepSeek's own MIT terms. |
| Full DeepSeek-R1 (671B) | ~404GB — not realistic on the M1 Pro and likely not on the planned RTX 5090 (32GB VRAM + 128GB RAM) server either. If frontier DeepSeek reasoning is ever needed at that scale, that's a cloud/API decision, not a local one. |

## Specialized models — recommended, not yet installed or wired in

These require real integration code (a new provider/route, not just a model pull), so none were
built this session — the governing directive's own scope ("add model metadata," "configure local
models") stops short of "build a new capability," and vision/STT/TTS pipelines are each a real
feature. Recorded here as the concrete next step for whoever picks this up:

| Category | Recommendation | Why | Memory | Effort to add |
|---|---|---|---|---|
| Embeddings | Keep the current ONNX pipeline; no change needed | Already local, already free, already working — `nomic-embed-text` would be a lateral move, not an improvement, unless a reason to prefer Ollama's embedding path specifically emerges | already resident | none |
| Vision / OCR | `Moondream2` (Apache 2.0, ~1.7GB) for lightweight OCR now; `Qwen2.5-VL-7B` (Apache 2.0, ~6GB) once on the GPU server | Moondream2 is purpose-tuned for document OCR/DocVQA and fits the Mac's spare budget without crowding out the chat LLM; Qwen2.5-VL-7B is clearly stronger but its footprint doesn't coexist with a loaded chat model in a 6-8GB budget | 1.7GB (Mac) / 6GB (GPU server) | New route + provider method to send image input; `capabilityRegistry.ts`'s `VISION` entry currently honestly reports `implemented: false` — flip only once real code exists |
| STT | `whisper.cpp` (Core ML + Metal), `small` tier by default, `large-v3-turbo` for on-demand higher-accuracy runs | MIT-licensed, Metal-accelerated on Apple Silicon (faster-whisper has no Metal backend and falls back to CPU on Mac) | 0.85GB (small) / ~2GB (turbo) | Not an Ollama model — needs a separate runtime process, audio upload handling, and a new server route; real feature work |
| TTS | `Kokoro-82M` (Apache 2.0) | Best quality-for-size of the commercially-safe options; explicitly **not** Coqui/XTTS (non-commercial, defunct vendor) | ~1-2GB | Replaces/supplements `geminiTts.ts`'s cloud call with a local runtime; real feature work, and should keep Gemini TTS as a fallback rather than a hard cutover |

## Privacy model — LOCAL / PRIVATE / PUBLIC_CLOUD (design, not implemented)

**Confirmed via the codebase audit: no data-sensitivity-based routing exists today.**
`ModelEntry.localOrCloud` and `DEPLOYMENT_MODE` are hardware/ordering concerns only — nothing in
`modelRouter.ts` currently asks "is this data allowed to leave this machine" before picking a
provider. This is genuine new design surface, not a rename of something that already exists, and per
the governing directive's own instruction ("Do not implement excessive routing complexity
immediately" / major architecture changes need founder input), it's documented here as a concrete,
ready-to-build design rather than partially implemented tonight:

```
Request classification (new, three values):
  LOCAL        -> Ollama only, no cloud fallback even if Ollama is unavailable
                  (fail with a clear "local-only, no local model available" error
                  rather than silently sending sensitive data to Gemini/DeepSeek)
  PRIVATE      -> Ollama preferred; a specifically-approved cloud provider allowed
                  as fallback only if the founder designates one as vetted for
                  this data class (none are today — this is a policy decision,
                  not a technical default)
  PUBLIC_CLOUD -> today's existing behavior, unchanged (current LLM_PROVIDER_CHAIN)
```

Concrete hook point: `modelRouter.ts`'s `routeChatCompletion()` already takes a per-request options
object (`StreamOptions`) — a `privacyClass?: "local" | "private" | "public_cloud"` field there,
defaulting to `"public_cloud"` (today's behavior, so nothing breaks for existing callers), is the
minimal-diff way to add this without redesigning the router. The chain-selection logic
(`defaultChainFor`) would need one new branch: `privacyClass === "local"` forces the chain to
`["ollama"]` regardless of `LLM_PROVIDER_CHAIN`. This is a small, mechanical change once the founder
confirms the policy (which data counts as PRIVATE vs PUBLIC_CLOUD is a business decision, not
something to infer from code) — **not implemented this session**, flagged as the top recommended
next step.

## API keys — what's actually valuable, ranked

Distinguishing **free local model** (no key, hardware cost only) from **cloud API** (key required,
usage cost) per the governing directive's own framing:

| Path | Key needed? | Cost model |
|---|---|---|
| Qwen3 / DeepSeek-R1-distill / Qwen2.5-Coder, local | No | Hardware only (already owned) |
| Gemini API | Yes — configured in production | Usage-based |
| DeepSeek API | Yes — **not configured in production** | Usage-based |
| Claude / Anthropic API | Yes — not currently integrated in code at all | Usage-based |
| OpenAI API | Yes — not currently integrated in code at all | Usage-based |

**REQUIRED FOUNDER INPUT — see the final report for the full P0/P1/P2 breakdown.** Summary: the
highest-value gap is `DEEPSEEK_API_KEY` in Railway's production environment (P0) — it's fully
implemented in code and already declared in `.env.example`, this is a configuration-only gap that
currently leaves production with a single point of failure (Gemini alone). Adding Anthropic or
OpenAI as cloud providers is architecturally straightforward (~15 lines each, matching
`deepseek.ts`'s pattern) but is a **P2, build-when-needed** item, not something to request keys for
speculatively — see Section 26/27 of the governing directive ("do not add APIs merely for a provider
count").

## Router changes recommended, not implemented

1. **Privacy-class routing** (above) — the main gap the governing directive asks about that this
   session did not build, pending a founder policy decision on what counts as PRIVATE data.
2. **Installed-model check before routing** — a real gap the codebase audit found:
   `pickOllamaModel()` doesn't consult `isModelInstalled()` before selecting a tag. If a registry
   entry is `enabled: true` but not actually pulled (true of the three models pulled this session
   until the background download finishes), a real request would hit a runtime error from Ollama
   rather than falling back cleanly to the next provider in the chain. Worth fixing, but it's a
   behavior change to core routing — flagged, not changed unilaterally this session.
3. **Fast-path routing for simple queries** — now that `qwen3:4b` exists in the fleet, a cheap
   heuristic (very short message, no code/current-info signal) could route to it instead of
   `qwen3:8b` specifically to cut first-token latency, mirroring how `classifyTask()` already
   detects coding/current-info. Not implemented — would need real latency measurement to justify
   the added routing complexity, not just intuition.

## Future RTX-5090 migration

No change to this session's guidance in `JENNY_AI_INFRASTRUCTURE.md` — restated briefly for
completeness: `hardwareProfile.ts` gets one new profile (e.g. `dedicated_2x5090_256gb`) with real
measured `usableMemoryGb`/`maxSingleModelGb` once that hardware exists; nothing in `modelRouter.ts`
or `chatRunner.ts` changes. What actually becomes installable there per this session's research:
Qwen3-30B-A3B/235B-A22B, Qwen2.5-Coder-32B, Qwen3-Coder-30B-A3B, Mistral Small 3.x, Devstral(-2),
Gemma 4 26B-MoE/31B, Granite 4.2 30B-MoE, DeepSeek-R1-Distill-Qwen-32B, and Qwen2.5-VL-7B for real
vision workloads without crowding a chat model out of memory.

## What this document is not

Not a claim that vision, local STT, or local TTS exist in JennySol today — `capabilityRegistry.ts`
honestly reports each as not implemented (vision) or cloud/client-only (STT/TTS), and this document
doesn't change that; it records what to build next and why, per model, with license groundwork
already done.
