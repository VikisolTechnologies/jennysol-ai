# JENNYSOL — END-TO-END MISSION (v2, corrected 2026-09-26)

You are the build team for **JennySol**, the AI brain of the Vikisol ecosystem. The founder (Syam) is the product owner. A separate architect wrote this mission and reviews your blueprint. Read the whole file before touching anything.

**Another agent (Cursor) is rebuilding Arena in parallel.** Work only in the JennySol repo. Anything Arena needs from you, publish as a contract document. Never edit Arena code.

The sequence is **VERIFY → FIX → BLUEPRINT → CHALLENGE → AGREE → BUILD → TEST → DEPLOY**.
There are two **STOP GATES**. Outside them, work continuously. (This run is superseded by `docs/JENNYSOL-FINISH-ALL.md`, which replaces STOP GATE 1 — see that file.)

---

## 0. What JennySol is

> **We don't build another chatbot. We build the AI workforce infrastructure first, then the agents, then the marketplace, and eventually proprietary model intelligence.**

JennySol is the AI execution layer that every Vikisol product calls to **understand, reason, search and act**.

```
USER → CONVERSATION → AGENT RUN → INTENT → MODEL GATEWAY
     → TOOLS / CONNECTORS / EVIDENCE → RESPONSE → MEMORY + AUDIT
```

Target shape (refactor what exists into this; do not rewrite it):

```
                 JENNYSOL
                    │
               AGENT CORE  (AgentRun · tools · approvals · memory · audit)
                    │
              MODEL GATEWAY
        ┌───────────┼───────────┐
     Ollama       Cloud        Future
  (Qwen/DeepSeek) (Gemini,     (GPU fleet,
                  DeepSeek…)   new models)
```

**How the ecosystem uses Jenny**

| Product | Use |
|---|---|
| **Arena** | Ambient intelligence on every surface, not a chatbot tab. Feed ("3 opportunities for you"), Map ("a project nearby matches your skills"), Discover ("possible collaborators"), Work ("interview tomorrow"), + Create ("turn this idea into a Need"). Voice-first navigation, form-fill and conversational onboarding. **Already shipped: real (not draft-only) write actions via propose→approve→execute — see §1a below.** |
| **JennySol app** | Jenny's own home: chat, voice, files, tasks, runs and approvals. |
| **Vikisol One** (later) | An HR assistant that only ever sees what HR's own permissions allow. |

**Data ownership (never blur this)**

| Owner | Owns |
|---|---|
| Arena | users, profiles, posts, jobs, projects, companies, applications, marketplace, rooms |
| Vikisol One | organizations, employees, HR records, roles, policies, tenants |
| **JennySol** | AgentRuns, AI conversations, model routing, AI tools, AI memory, orchestration, audit |

**Non-negotiable principles**

1. Jenny reaches other products **only through their scoped APIs**. It never holds their database credentials.
2. **Identity ≠ authorization.** Jenny can never let a user see or do more than the product itself allows.
3. **Tools are capabilities, not open access.** No unrestricted shell, filesystem, database, network or secrets. Side-effect actions require approval, and everything is audited.
4. **Model-agnostic.** Models are configuration, not code. The fleet is curated with defined roles. No "local Claude": Claude is cloud-only unless that genuinely changes.
5. **Simple, cheap, free, easy.** Local models first, cheap cloud as fallback, premium only with founder approval. Minimal code, one way of doing each thing. Honest failure over fake answers.

---

## 1. System facts, verified 2026-09-26 (supersedes the v2 draft's guesses)

- **Repo and hosting.** Repo `jennysol-ai` (GitHub `VikisolTechnologies`). Backend on Railway (`jennysol-ai-api`, live at `api.jennysol.vikisol.in`), frontend on Vercel. Local env at `jennysol-ai/server/.env`.
- **Already built:** Auth, conversations, AgentRun (streaming), model router, Ollama via an OpenAI-compatible client. Gemini covers text, TTS and images; DeepSeek provider code exists but has **no production key**. Tavily search. RAG with in-process ONNX embeddings (`Xenova/all-MiniLM-L6-v2`). Tool registry, `pendingActions` approvals (now SQLite-durable), guest/user isolation, memory/history. Voice has browser STT, Gemini TTS and barge-in. An Anthropic (Claude) provider exists with Haiku/Sonnet/Opus difficulty tiers, **not enabled in production** (no `ANTHROPIC_API_KEY` set — leave it that way absent founder approval).

### 1a. The Arena ↔ Jenny gateway is LIVE IN PRODUCTION — do not treat this as unbuilt
This is the single most important correction to the v2 draft. **Phase 6 of this mission describes building the Arena contract from scratch against a mock. That work is already done, tested and running in production**, verified end to end against `api-arena.vikisol.in` on 2026-09-26 (a real activity was found, proposed, approved, and the account was actually added to the room).

- **Endpoints:** `POST /api/agent/gateway/chat`, `POST /api/agent/gateway/actions/:actionId` (`server/src/routes/agentGateway.ts`).
- **Arena connector:** `server/src/services/productConnectors/arena.ts` — READ tools run immediately (`arena.search`, `arena.nearbyActivities`, `arena.listCommunities`, `arena.searchJobs`); WRITE tools (`arena.createPost`, `arena.joinActivity`, `arena.createProject`, `arena.placeBid`, `arena.applyToJob`) become a **pending action** the user must explicitly approve — never draft-only copy, an actually-executing flow gated on a real tap.
- **Guarantees already tested** (`server/src/agentGateway.http.test.ts`, Arena-BE's `AgentApprovalFlowTest`/`AgentGatewayContractTest`/`PostJoinSafetyTest`): single-use actions, 5-minute expiry, owner-only decisions, a definitive Arena refusal reported as `failed` (422) with the reason, an ambiguous timeout/5xx reported as `unknown` and never presented as safe to retry, and independent scope re-checks on both sides (`AgentServiceTokenAuthenticationFilter`).
- **Your job in this mission is to extend this gateway** (add read tools, richer context, better replies) **and to write the contract tests and doc that lock it down (STEP 1) — never to redesign or replace it.**

- **Local fleet** on the Mac (M1 Pro, 16GB), reached from production over **Tailscale** (`http://100.70.199.75:11434`):
  - `qwen3:8b` (general), `qwen3:4b` (fast/trivial), `qwen2.5-coder:7b` (coding), `deepseek-r1:7b` (reasoning) — **reasoning routing to `deepseek-r1:7b` is already correct**, confirmed by tracing `modelRegistry.ts`'s `pickOllamaModel()`.
  - `qwen3-vl:8b`, `qwen3-vl:4b`, `moondream` — **vision already exists** (`ollamaVision.ts`, the VISION capability in `capabilityRegistry.ts` uses `qwen3-vl:4b`). The v2 draft's "no vision model" is stale.
- **Future hardware:** 1× RTX 5090 (32GB VRAM, 128GB RAM), scalable to 2× (64GB VRAM, 256GB RAM). Design for it; don't build for it yet.
- **Tests and git.** 682 passed, 2 skipped (69 files), current tip `33abb27`, fully pushed. The v2 draft's "378/378" and "commit c2ad83f… may be unpushed" are stale.
- **`OLLAMA_MODEL=llama3.2` in `.env`** is an intentional, unreachable-in-practice fallback string (documented in `modelRegistry.ts`'s own comment) — leave it, it is not a bug to fix.
- **Genuinely still open** (the rest of the v2 draft's "known issues" list is correct):
  1. No cold-start warming / `keep_alive` for **chat** models (the image worker already uses `keep_alive:0`, but that's a different concern — freeing memory for image generation, not warming chat).
  2. No LOCAL / PRIVATE / PUBLIC_CLOUD routing tiers exist.
  3. No production DeepSeek key (so chat has no real fallback provider today; the chain is a single Gemini key).
- **Prior work to reuse, not redo:** `docs/CURRENT-STATE-AUDIT.md` exists (written by Codex, extended by Claude) — start from it, don't rewrite it. No `JennySol_End_to_End_Execution_Plan.docx` was found in this repo; logged in `docs/ACCESS-NEEDED.md`.

---

## 2. Hard limits

1. **Do not edit any Arena repo.** Cursor owns them, and Cursor is actively running its own mission concurrently with this one — treat Arena's repos as a moving target, and pull latest before relying on anything about its current shape.
2. **Keep the existing Arena ↔ Jenny gateway backward-compatible.** New endpoints are additive and versioned (`/v2/...`). Do not rotate `SERVICE_TOKEN_SECRET_ARENA`.
3. **Never touch Vikisol One / HRLMS** (code, DB, or Railway `enchanting-vibrancy`).
4. **Never print, log, commit or paste secrets.** Read them via `.env` / Railway / Vercel CLIs only when needed.
5. **No DNS changes.** Don't expose the Mac to the public internet. **No production cutover** from Railway to the Mac, and no `jennysol.vikisol.in` switch.
6. **No new paid keys or providers** without founder approval. List each with its expected monthly cost. **Do not enable `ANTHROPIC_API_KEY` in production** even though the provider code exists.
7. **No force-push to `main`.** Use branches: `feature/jenny-audit`, `feature/stabilize`, `feature/model-gateway`, `feature/agent-runtime`, `feature/memory-rag`, `feature/voice`, `feature/jenny-ui`. Merge only when green.
8. **Keep the Mac fleet within 16GB.** No model over ~8GB, and no installs "just because they exist".
9. **No redesign of the JennySol app UI** ships to production before founder approval (a Vercel preview is fine).

If something would cross a limit, log it in `docs/BLOCKERS.md` and continue with everything else.

---

*(Sections 3 and Phases 0–10 are unchanged from the v2 draft except where §1/§1a above override them — see `docs/JENNYSOL-FINISH-ALL.md` for the actual step-by-step run plan being executed now, which folds these corrections in as its STEP 0.)*
