# Jennysol Architecture Handoff

Written 2026-09-07 for any engineer/AI picking up this project without prior context. Terminology used throughout: **IMPLEMENTED** (built and shipped), **VERIFIED** (built, shipped, and directly tested — unit test, live production test, or both), **PARTIALLY IMPLEMENTED**, **CONFIGURED** / **NOT CONFIGURED** (an env var/credential state), **PLANNED** (described in a past spec, not built), **KNOWN LIMITATION**, **SECURITY RISK**. Nothing below claims planned functionality as implemented.

## 1. Executive summary

Jennysol is a personal AI chat assistant (Node/Express + React, TypeScript throughout) deployed at jennysol.vikisol.in (Vercel, frontend) / api.jennysol.vikisol.in (Railway, backend + SQLite). Its core architectural property: **the AgentRun, not the HTTP request or the browser tab, is the unit of execution** — a chat generation is a durable, SQLite-backed state machine that survives a closed browser, a dropped connection, or a page reload, and is independently addressable/cancellable per run. The backend is model-agnostic (Gemini, DeepSeek, and Ollama share one provider interface with real health-based failover), and is being extended toward local-first operation (Ollama on the user's own hardware) without disturbing that AgentRun core.

A critical cross-user data-visibility incident was investigated and fixed this session — see `docs/SECURITY_AUDIT.md` for the full writeup. Root cause: a client-side guest-session gap (no way to end a guest session on a shared device), not a backend authorization bug. Fixed, tested (87/87 passing, 10 new cross-user isolation tests), verified live in production.

## 2. Current architecture (real, not intended)

```
Browser (React, Vite)  ──HTTPS──>  Express (Railway)  ──>  SQLite (single file, WAL mode)
     jennysol.vikisol.in              api.jennysol.vikisol.in         server/data/jennysol.db
                                             │
                                    AgentRun / chatRunner
                                             │
                                       Model Router
                                    ┌────────┼────────┐
                                 Gemini   DeepSeek   Ollama (opt-in, local only)
                                             │
                                    Search Router (provider-independent)
                                             │
                                          Tavily (if configured)
```

No Redis, no queue, no Postgres, no pgvector, no Next.js, no Python anywhere in this codebase — confirmed by inspecting both `package.json` files and grepping the source tree.

## 3. Security incident (see `docs/SECURITY_AUDIT.md` for full detail)

- **What happened**: reporter's sister saw the reporter's own conversations after opening Jennysol on the reporter's phone.
- **Root cause**: guest sessions (the default no-login-wall mode) persist their token in `localStorage`, shared by anyone using the same browser on the same device; guests had no UI action to end a session and start a new one.
- **Fix**: `AuthContext.startNewGuestSession()` (composes the pre-existing, already-correct `logout()` with a fresh `guestLogin()` and a reload) + a "Not you? Start a new session" control in `Sidebar.tsx`. No backend code changed — every backend ownership query was already correct.
- **Verified**: 10 new cross-user isolation tests (real SQLite, no mocks) + a live scripted reproduction against production.

## 4. Authentication architecture

- IMPLEMENTED, VERIFIED: opaque, DB-backed session tokens (`server/src/services/auth/sessions.ts`) — `randomBytes(32).toString("hex")` as the primary key of a `sessions` table. Not JWT.
- `requireAuth` middleware (`server/src/middleware/auth.ts`) reads `Authorization: Bearer <token>`, resolves it via `getSessionUserId`, sets `req.userId`. Every user-data route mounts this (`server/src/index.ts`).
- Login methods: password (bcrypt via `password.ts`, with `loginAttempts.ts` rate-limiting/lockout), Google Sign-In (`google.ts`, ID-token verification server-side), and guest (`createGuestUser`).
- Guests are real `users` rows (`is_guest` flag) — every existing user-scoped query works for them with zero special-casing. Upgrading a guest to a full account (`upgradeGuestToFullAccount`) updates the same row in place, preserving the same id/session/history.
- Admin role checked fresh from the DB on every request (`requireAdmin`), not baked into the session token, so revocation is immediate.

## 5. Authorization architecture

Every user-owned resource is scoped by a `user_id` column, checked via SQL `WHERE`/`JOIN`, never trusted from a client-supplied field:

| Resource | Scoping mechanism | File |
|---|---|---|
| Conversations | `WHERE user_id = ?` | `conversationStore.ts` |
| Messages | `JOIN conversations ... WHERE c.user_id = ?` | `conversationStore.ts` |
| AgentRuns | `WHERE id = ? AND user_id = ?` | `agentRunStore.ts` |
| Documents/chunks (RAG memory) | `JOIN documents ... WHERE d.user_id = ?` | `vectorStore.ts` |

A client-supplied conversation id that doesn't belong to the caller is never attached to or errored on distinctly — it silently causes a new conversation to be created (`chatRunner.startChatRun`), which both prevents cross-user writes and avoids leaking whether the id belonged to someone else or didn't exist at all.

## 6. Database architecture

- **Technology**: SQLite via `better-sqlite3`, WAL mode, foreign keys on. Single file (`server/data/jennysol.db`) on a Railway-attached volume.
- **Migrations**: additive-only, via a small `addColumnIfMissing` helper in `db/index.ts` — no destructive schema changes, existing rows preserved (orphaned with `NULL` owner columns where a column was added after data existed, never deleted).
- **Tables**: `users`, `sessions`, `password_reset_tokens`, `email_verification_tokens`, `login_attempts`, `documents`, `chunks`, `conversations`, `messages`, `error_logs`, `conversation_summaries`, `agent_runs`, `agent_events`. Full DDL is in `server/src/db/index.ts`.
- **KNOWN LIMITATION**: single SQLite file = single-process, single-instance. Cannot horizontally scale to multiple Railway instances without moving to a networked database (Postgres) — this is a scaling constraint, not a data-isolation one (Section 5's scoping is independent of how many instances exist).

## 7. AgentRun architecture

IMPLEMENTED, VERIFIED (including live production testing).

- **Unit of execution**: `chatRunner.executeChatRun(runId, requestId, userId, conversationId, message)` — takes no reference to the HTTP `res` object at all. Kicked off via `void executeChatRun(...)` from `routes/chat.ts` so the HTTP handler returns immediately.
- **Persistence**: `agent_runs` (one row per run: status, provider, response text accumulated live via `appendResponseText`, timestamps) + `agent_events` (append-only replay log: `run.started`, `agent.status`, `message.delta`, `done`/`error`/`cancelled`). Every event is written to SQLite *before* being published to any live listener (`runBus.ts`'s own comment) — a run with zero live subscribers loses nothing.
- **Status values actually implemented**: `queued`, `running`, `streaming`, `completed`, `failed`, `cancelled`. (`thinking`, `tool_running`, `waiting_for_dependency`, `paused` from the original spec are **PLANNED, NOT IMPLEMENTED** — there is no real tool-execution loop or multi-step dependency system yet to make those states meaningful; adding unused enum values was deliberately avoided.)
- **Concurrency**: VERIFIED, no global locks. Grepped every service file for module-level mutable state — the only two hits are `embeddings.ts`'s lazily-loaded model singleton (a shared resource, not a lock) and `providerHealth.ts`'s health-stats map (keyed by provider name, informs routing, never blocks/serializes). Each `attemptWithTimeout` call creates its own `AbortController`. Proven live: a slow run and a fast run submitted concurrently do not block each other (see Section 11's test log).
- **Cancellation**: IMPLEMENTED, VERIFIED. `POST /api/agent/runs/:id/cancel` → `runCancellation.ts`'s per-runId `AbortController` registry (a Map, not a lock — cancelling run A only ever touches run A's entry). Verified live in production: a run cancelled mid-stream (after already streaming real partial text) correctly persisted as `cancelled` (not `failed`, not silently dropped), while a concurrent second run for the same user completed normally, untouched. Re-cancelling an already-finished run returns 409, not a crash or state corruption.
- **Reconnect/recovery**: `GET /api/agent/runs/:id` (current state) and `GET /api/agent/runs/:id/events?after=<id>` (replay missed events) — this is what lets a closed/refreshed browser recover an in-progress or just-finished run. `GET /api/agent/runs/active` powers "Jenny finished while you were away."

## 8. Chat/streaming architecture

- Hand-rolled SSE (`data: {json}\n\n` over `fetch()` + `ReadableStreamDefaultReader`, not native `EventSource`) — chosen so `POST` with an `Authorization` header works, which native `EventSource` doesn't support.
- Event types actually emitted: `run.started`, `agent.status` (`thinking`/`streaming`), `message.delta`, `guest.progress`, `heartbeat`, `done`, `error`, `cancelled`. (The larger event vocabulary from the original spec — `run.provider_selected`, `run.tool_started`, `run.reasoning_delta`, etc. — is **PLANNED, NOT IMPLEMENTED**; there's no tool-execution or reasoning-token surface yet to justify those events.)
- Heartbeat: a `heartbeat` SSE frame every `SSE_HEARTBEAT_MS` (default 10s) so an idle-but-alive connection isn't mistaken for dead by an intermediary (mobile carrier NAT, proxy).
- The frontend never learns which provider/model answered — `RouteResult.providerUsed`/`.model` are logged server-side only (`chat_timing` structured JSON log), never sent over SSE.

## 9. Model provider architecture

IMPLEMENTED, VERIFIED. `server/src/services/llmProvider.ts` defines `LlmProvider { streamChatCompletion(systemPrompt, history, onDelta, onWebSources?, opts?) }`. Each provider implements it independently:

| Provider | File | Local/Cloud | Auth | Notes |
|---|---|---|---|---|
| Gemini | `providers/gemini.ts` | Cloud | `GEMINI_API_KEY` | Native Google Search grounding tool (used only when no external search provider is configured — see Section 12); soft-timeout-then-plain-fallback if search is slow; retry-once on a zero-output stream (a real production bug found and fixed this session). |
| DeepSeek | `providers/deepseek.ts` | Cloud | `DEEPSEEK_API_KEY` | OpenAI-compatible streaming via the shared `openaiCompatible.ts` helper. |
| Ollama | `providers/ollama.ts` | Local | none | Concurrency-gated (see Section 13), per-request model override, real `/api/tags` model listing. |

`StreamOptions` carries `signal` (abort/cancellation/timeout) and `model` (per-request override, used by Ollama).

## 10. Model Router architecture (what's actually in code, not the intended diagram)

`server/src/services/modelRouter.ts`, function `routeChatCompletion(systemPrompt, history, onDelta, onWebSources?, taskCapability?, outerSignal?)`.

- **Chain resolution**: `LLM_PROVIDER_CHAIN` (comma-separated, e.g. `gemini,deepseek,ollama`) → falls back to singular `LLM_PROVIDER` → falls back to `defaultChainFor(DEPLOYMENT_MODE)` (`"ollama,gemini,deepseek"` if `DEPLOYMENT_MODE=local`, else plain `"gemini"`).
- **Per-entry gating**: each entry tried only if `configured()` (has credentials/is reachable) **and** `isHealthy()` (not in circuit-breaker cooldown).
- **Task classification** (`models/modelRegistry.ts`'s `classifyTask`): two real, cheap heuristics — `currentInfoSummarization` (reuses `needsCurrentInfo`) and `coding` (regex for code fences/coding verbs) — everything else is `general`. This **only** affects which Ollama model is requested (via `pickOllamaModel`); it does not reorder or filter cloud providers. Deliberately narrow — no fake "hard reasoning" or vision classifier exists, since there's no real signal to distinguish it with only 2 cloud providers configured.
- **Timeouts**: primary entry gets `LLM_FIRST_TOKEN_TIMEOUT_MS` (default 10000ms), any fallback entry gets the shorter `LLM_FALLBACK_FIRST_TOKEN_TIMEOUT_MS` (default 6000ms) — deliberately not the same budget serialized 3x, so a full Gemini→DeepSeek→Ollama failure bounds at ~22s worst case, not 45s.
- **Empty-response handling**: Gemini retries once internally on zero output; `chatRunner.ts` has a provider-agnostic last-resort fallback that guarantees a non-empty, honest message is always persisted rather than an empty assistant turn.
- **Circuit breaker interaction (a real bug found and fixed this session)**: a self-imposed timeout only counts against a provider's health if there's actually a healthy fallback to move to — otherwise a burst of merely-slow-but-would-have-succeeded requests could trip the breaker and lock out the *only* configured provider for a 30s cooldown with nothing to fall back to. A real 503/429/quota/auth failure always counts regardless.
- **Cancellation is per-chain-attempt-aware**: an `outerSignal` abort rejects with `code: "cancelled"`, which the router's catch block rethrows immediately — cancellation never triggers a fallback attempt ("try DeepSeek instead" is never the right response to "the user asked this to stop").
- **What happens for each scenario** (all VERIFIED this session, several against a real, live Gemini capacity outage — not simulated):
  1. Normal chat → Gemini (primary), ~500-900ms first token typical.
  2. Coding → Ollama, if in the active chain, gets `qwen2.5-coder:7b`; cloud path unaffected.
  3. Current-info query ("today's gold rate") → provider-independent search runs first (Section 12), result injected into context for whichever provider answers.
  4. Ollama unavailable → skipped as "not configured" (no health penalty), next entry tried.
  5. Gemini unavailable (real 503 observed live) → circuit breaker trips after 3 consecutive failures, DeepSeek/Ollama (if configured) take over automatically.
  6. DeepSeek unavailable → same mechanism, next entry.
  7. Empty model response → retried once (Gemini-specific), then the chatRunner-level guaranteed-non-empty fallback.
  8. Cancellation → immediate stop, no fallback, marked `cancelled` not `failed`.
  9. Concurrent requests → fully independent (Section 7).

## 11. Ollama / local model system

**CURRENTLY IMPLEMENTED**:
- Real provider (`providers/ollama.ts`): live `/api/tags` reachability probe (cached, background-refreshed), `listInstalledOllamaModels()`, `isModelInstalled()`, per-request model override, concurrency gate (`MAX` derived from the active hardware profile, not a fixed constant), normalized `at_capacity` error that does **not** count against Ollama's circuit-breaker health.
- Model registry (`models/modelRegistry.ts`): curated catalog with verified (checked against ollama.com/library at write time, not invented) tags and sizes — `llama3.2:3b`, `qwen3:4b`, `qwen3:8b`, `qwen2.5-coder:7b`, `deepseek-r1:7b`, `nomic-embed-text`, plus two larger models (`qwen2.5-coder:14b`, `deepseek-r1:32b`) marked `requiresDedicatedServer: true, enabled: false`.
- Hardware profiles (`models/hardwareProfile.ts`): `m1_16gb` (16GB total, 6GB single-model ceiling, 1 concurrent local run) and `dedicated_rtx5060ti_16gb` (64GB total, VRAM-bounded 13GB ceiling, 2 concurrent). `LOCAL_HARDWARE_PROFILE` env var overrides; otherwise auto-detected from `os.platform()/arch()/totalmem()`.
- **VERIFIED live on the actual target machine** (this session ran on it): `Jennifers-MacBook-Pro.local`, Apple M1 Pro, 16GB RAM, arm64 — auto-detected correctly as `m1_16gb`. `npm run models -- list/health/benchmark/install` all run and produce real output.
- CLI (`server/scripts/models-cli.ts`, `npm run models --`): `list` (catalog + hardware-fit), `health` (reachability, installed-model diff against the curated fleet, circuit-breaker snapshot), `benchmark` (real per-provider latency, not simulated — ran live: Gemini 828ms first-token), `install <tag>` (never auto-pulls; prints the exact `ollama pull` command after verifying the tag is curated and hardware-appropriate).

**NOT CONFIGURED / NOT YET DONE**:
- Ollama itself is **not installed** on the M1 Mac at the time of writing (`which ollama` → not found). Everything above the actual inference call is proven; the model-serving step itself hasn't been exercised end-to-end yet.

**PLANNED, NOT IMPLEMENTED**:
- The dedicated RTX 5060 Ti server doesn't exist yet — `dedicated_rtx5060ti_16gb` profile numbers are principled estimates (VRAM-bounded), not measured on real hardware.
- Local Computer Agent (Windows-side keyboard/mouse/file/terminal control) — no code exists. The architectural boundary (never couple it to Ollama specifically, never expose Ollama/terminal/filesystem to the public internet, scope every action to a specific user+device) is documented as a requirement, not built.

## 12. Search / current-information architecture

IMPLEMENTED, VERIFIED (unit-tested; live end-to-end pending a `TAVILY_API_KEY`, which is not yet configured).

- `SearchProvider` interface (`services/search/searchProvider.ts`): `{ name, configured(), search(query, opts?) }`. One concrete implementation today, `tavily.ts` — chosen since it's purpose-built for "give an LLM current results," but the interface makes adding Serper/Bing a new file + one registry line, not a redesign.
- `searchRouter.ts` mirrors `modelRouter.ts`'s pattern exactly: ordered chain (`SEARCH_PROVIDER_CHAIN`, default `"tavily"`), health-gated via the *same* `providerHealth.ts` functions (namespaced `search:<name>` to avoid key collision with LLM provider names).
- `contextManager.ts`'s `buildContext()` runs the search step **before any model is chosen**, alongside the existing document-RAG retrieval, and injects results into the system prompt as a labeled `LIVE WEB RESULTS` section — the exact same pattern already used for uploaded-document context. This is what makes it provider-independent: Gemini, DeepSeek, and Ollama all receive identical injected text; none has special access.
- Gemini's own native Google Search grounding tool is **only** attempted when `hasAnySearchProviderConfigured()` is false — i.e., it's the interim fallback for "no external search provider configured yet," not a competing mechanism once one exists.
- Citations: web sources are attached to the final assistant message's `sources` array (same shape as document citations) — real URLs from actual search/grounding results, never fabricated.
- **When search is unavailable** (no provider configured, or the configured one fails): the persona (`llm.ts`) explicitly instructs every provider to say plainly it can't verify a current fact rather than guessing a stale/invented number — this is prompt-level guidance, not a hard code-level block, so it depends on model compliance (documented as a limitation, not a guarantee).
- **API key required**: `TAVILY_API_KEY` — **NOT CONFIGURED** as of this writing. Until it is, current-info queries fall back to Gemini's native tool (if Gemini is healthy) or the honest "can't verify" persona instruction (if not).

## 13. Tool architecture

**PARTIALLY IMPLEMENTED.** The only two "tools" that exist today are document RAG retrieval (`vectorStore.ts`) and web search (Section 12) — both are deterministic, pre-fetch/context-injection steps decided by the application, not a model-directed function-calling loop where the model decides mid-generation to invoke an arbitrary tool and receive a result back into the same turn. Calendar, email-send-on-behalf-of-user, Zoom/Teams, places/weather/hotels/restaurants, filesystem, browser, and computer-control tools **do not exist in this codebase** — they are PLANNED only, per the target-architecture spec provided this session, not built.

## 14. Memory architecture

- **Short-term (conversation) memory**: `contextManager.ts` — bounded sliding window (`CONTEXT_RECENT_WINDOW`, default 12 messages) + a rolling, background-generated summary of everything older (`conversation_summaries` table, regenerated in batches of `CONTEXT_SUMMARY_BATCH`, default 5). Never sends the full unbounded transcript.
- **Long-term (document) memory**: `vectorStore.ts` — SQLite-stored embeddings (BLOB column), brute-force cosine similarity scoring in JS, scoped by `user_id` via join (Section 5/6). Embeddings generated locally (`@huggingface/transformers`, in-process ONNX), not via a cloud embedding API.
- **NOT pgvector, NOT Postgres** — a real limitation for scaling to very large per-user document sets, not a correctness one at current scale.
- No separate "long-term conversational memory" (facts remembered across conversations, distinct from the rolling summary) exists — PLANNED only, if ever wanted.

## 15. Frontend architecture

- Vite + React 18 + TypeScript, React Router (`client/src/App.tsx`) — not Next.js.
- **Auth UI**: `RequireAuth.tsx`/`RequireAdmin.tsx` route guards, `AuthContext.tsx` (session state, guest auto-login, the new `startNewGuestSession`), pages for login/signup/forgot-reset-password/verify-email.
- **Chat UI**: `ChatWindow.tsx` (send/stream/cancel/reconnect/status-escalation timers), `MessageBubble.tsx` (streaming-vs-finished-empty distinction — a real bug fixed this session), `Sidebar.tsx` (conversation list, document upload, guest banner + new session-switch control, admin link).
- **Streaming**: hand-rolled `fetch()` + `ReadableStreamDefaultReader` parsing (`lib/api.ts`'s `sendChatMessage`), not `EventSource`.
- **Reconnect/recovery**: `useAgentRunRecovery.ts` (polls `GET /api/agent/runs/active` on load/visibility-return), `ChatWindow.tsx`'s own resume-on-load logic using `localStorage`-persisted `activeConversationId`.
- **Cancellation**: a stop button (`Square` icon) replaces the send button while a run is in flight, calling `cancelChatRun(runId)`.
- **Error handling**: `ErrorBoundary.tsx` (render-time crash isolation), per-request error messages surfaced as assistant-style bubbles rather than raw fetch errors, a dedicated `ChatError` class carrying a `code` for special-cased UI behavior (e.g. guest nudges).
- **State management**: React state + Context (AuthContext) — no Redux/Zustand/etc.

## 16. API inventory

All routes are Express, JSON in/out unless noted. `AUTH` = requires `Authorization: Bearer <token>` via `requireAuth`.

| Method | Path | Auth | Ownership check | Notes |
|---|---|---|---|---|
| POST | `/api/auth/signup` | no | n/a | rate-limited |
| POST | `/api/auth/guest` | no | n/a | always creates a new user, rate-limited |
| POST | `/api/auth/login` | no | n/a | rate-limited, lockout after repeated failures |
| POST | `/api/auth/google` | no | n/a | rate-limited |
| POST | `/api/auth/upgrade` | AUTH | current user must be a guest | |
| POST | `/api/auth/logout` | AUTH | own session only | |
| POST | `/api/auth/logout-all` | AUTH | own sessions only | |
| GET | `/api/auth/sessions` | AUTH | own sessions only | |
| GET | `/api/auth/me` | AUTH | self | |
| PATCH | `/api/auth/profile` | AUTH | self | |
| POST | `/api/auth/change-password` | AUTH | self | |
| POST | `/api/auth/forgot-password` | no | n/a | generic response regardless of account existence |
| POST | `/api/auth/reset-password` | no | token-scoped | invalidates all sessions on success |
| POST | `/api/auth/verify-email` | no | token-scoped | |
| POST | `/api/chat` | AUTH | conversation ownership verified/created per-user | SSE streaming response |
| GET | `/api/agent/runs/active` | AUTH | `WHERE user_id = ?` | |
| GET | `/api/agent/runs/:id` | AUTH | `WHERE id = ? AND user_id = ?` | 404 if not owner |
| GET | `/api/agent/runs/:id/events` | AUTH | ownership checked before replay | |
| POST | `/api/agent/runs/:id/seen` | AUTH | ownership checked | |
| POST | `/api/agent/runs/:id/cancel` | AUTH | ownership checked, 409 if already finished | |
| GET | `/api/conversations` | AUTH | `WHERE user_id = ?` | |
| GET | `/api/conversations/:id` | AUTH | `conversationExists(userId, id)` | 404 if not owner |
| DELETE | `/api/conversations/:id` | AUTH | `WHERE id = ? AND user_id = ?` | no-op if not owner |
| GET | `/api/documents` | AUTH | `WHERE user_id = ?` | |
| POST | `/api/documents` | AUTH | inserted with `req.userId` | multipart upload, 20MB limit |
| DELETE | `/api/documents/:id` | AUTH | `WHERE id = ? AND user_id = ?` | no-op if not owner |
| POST | `/api/image` | AUTH | n/a (stateless) | |
| POST | `/api/speech` | AUTH | n/a (stateless) | |
| POST/GET | `/api/errors` | optional | n/a | crash-report intake |
| * | `/api/admin/*` | AUTH + admin role | admin-only, cross-user by design (support/ops tooling) | role checked fresh from DB every request |

No route was found lacking authentication where user-owned data is involved. `/api/errors` intentionally allows unauthenticated crash reports (a client can crash before login).

## 17. Environment variables

Server (`server/.env.example`) — secrets never printed, only presence/absence:

| Name | Purpose | Required? | Secret? |
|---|---|---|---|
| `GEMINI_API_KEY` | Gemini chat + image + TTS | Required today (only cloud provider active) | Secret |
| `GEMINI_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_TTS_MODEL` | model selection | Optional (defaults set) | Non-secret |
| `LLM_PROVIDER_CHAIN` / `LLM_PROVIDER` | provider fallback order | Optional | Non-secret |
| `DEEPSEEK_API_KEY` | DeepSeek fallback | Optional, **NOT CONFIGURED** | Secret |
| `DEEPSEEK_MODEL` | model selection | Optional | Non-secret |
| `OLLAMA_BASE_URL` | where Ollama is reachable **from this process** | Optional (default `http://127.0.0.1:11434`) | Non-secret |
| `OLLAMA_MODEL` | fallback default model | Optional | Non-secret |
| `LOCAL_HARDWARE_PROFILE` | `m1_16gb` / `dedicated_rtx5060ti_16gb` | Optional (auto-detects) | Non-secret |
| `DEPLOYMENT_MODE` | `local` / `cloud` — affects default chain order | Optional (default `cloud`) | Non-secret |
| `TAVILY_API_KEY` | provider-independent web search | Optional, **NOT CONFIGURED** | Secret |
| `FRONTEND_URL` | email link generation | Required for real emails | Non-secret |
| `CONTEXT_RECENT_WINDOW`, `CONTEXT_SUMMARY_BATCH` | memory tuning | Optional | Non-secret |
| `LLM_FIRST_TOKEN_TIMEOUT_MS`, `LLM_FALLBACK_FIRST_TOKEN_TIMEOUT_MS` | router failover speed | Optional | Non-secret |
| `LLM_HEDGE_ENABLED`, `LLM_HEDGE_DELAY_MS` | hedged requests | Optional, off by default | Non-secret |
| `SSE_HEARTBEAT_MS` | keepalive interval | Optional | Non-secret |
| `GOOGLE_CLIENT_ID` | Sign in with Google | Optional | Non-secret (public by design) |
| `PORT` | server port | Optional | Non-secret |
| `GUEST_PROMPT_LIMIT` | guest nudge cadence | Optional (default 10) | Non-secret |
| `SEARCH_PROVIDER_CHAIN` | search fallback order | Optional (default `tavily`) | Non-secret |

Client (`client/.env.example`): `VITE_API_BASE_URL` (cross-origin API base, e.g. Railway URL), `VITE_GOOGLE_CLIENT_ID` (same value as server's, public by design).

`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SERPER_API_KEY`, `BING_SEARCH_API_KEY`, `DATABASE_URL`, `REDIS_URL` — **NOT CONFIGURED, NOT REFERENCED ANYWHERE IN CODE** (no OpenAI/Anthropic provider files exist yet; no Postgres/Redis in this stack).

## 18. Deployment architecture

- **Frontend**: Vercel, static build (`vite build`) of `client/`, served at `jennysol.vikisol.in`. No server-side rendering, no Vercel functions/API routes in use — it's a pure static SPA.
- **Backend**: Railway, one service (`jennysol-api`), Node process running `dist/index.js` (built via `tsc`), attached volume for the SQLite file. Served at `api.jennysol.vikisol.in`.
- **No shared state between Vercel and Railway** — the frontend calls Railway directly, cross-origin (CORS configured via `CORS_ORIGIN`). Vercel never proxies or caches API responses.
- **Local dev**: `npm run dev` in both `client/` and `server/` (Vite dev server + `tsx watch`), Vite proxies `/api` to the local server.
- **Can Railway be removed today?** No — it is the only place the deployed app currently runs; `DEPLOYMENT_MODE=local` (Section 10) lets the same codebase run entirely locally for development/testing, but production still depends on Railway until an explicit migration is done. Not removed in this task per instruction.

## 19. Test results (this session)

```
Server:  npx tsc -p tsconfig.json --noEmit   → clean
Server:  npm test (vitest)                    → 9 test files, 87 tests, 87 passed, 0 failed
Client:  npx tsc -b --force                   → clean
Client:  npm run build (vite)                 → clean, ~429KB JS / ~60KB CSS gzipped
```

New this session: `server/src/services/security.test.ts` (10 tests, cross-user isolation, real SQLite).
Full breakdown of the 87: `retryClassifier.test.ts`, `providerHealth.test.ts`, `contextManager.test.ts`, `modelRouter.test.ts` (now includes cancellation + DEPLOYMENT_MODE tests), `agentRunStore.test.ts`, `security.test.ts` (new), `search/searchRouter.test.ts`, `models/hardwareProfile.test.ts`, `models/modelRegistry.test.ts`.

## 20. Files changed this session (security fix)

`client/src/lib/AuthContext.tsx`, `client/src/components/Sidebar.tsx`, `client/src/components/MainApp.tsx`.

## 21. Files added this session (security fix + regression suite)

`client/src/lib/storageKeys.ts`, `server/src/services/security.test.ts`, `docs/SECURITY_AUDIT.md`, `docs/JENNYSOL_ARCHITECTURE_HANDOFF.md` (this file).

(Model-router/local-first/search-layer files from earlier in this session — `services/models/*`, `services/search/*`, `services/currentInfo.ts`, `services/runCancellation.ts` — are documented in full above as part of the current architecture; not re-listed as "new" here since this handoff's file-change sections refer specifically to the security-incident work.)

## 22. Database schema (full)

See `server/src/db/index.ts` for exact DDL. Summary:

| Table | Owner column | Key relationships |
|---|---|---|
| `users` | (is the owner) | — |
| `sessions` | `user_id` | → `users`, cascade delete |
| `password_reset_tokens`, `email_verification_tokens` | `user_id` | → `users`, cascade delete |
| `login_attempts` | (by email, not user_id — pre-account) | — |
| `documents` | `user_id` | → `users`, cascade delete |
| `chunks` | (via `document_id`) | → `documents`, cascade delete |
| `conversations` | `user_id` | → `users`, cascade delete |
| `messages` | (via `conversation_id`) | → `conversations`, cascade delete |
| `conversation_summaries` | (via `conversation_id`, PK) | → `conversations`, cascade delete |
| `agent_runs` | `user_id` **and** `conversation_id` | → `users`, `conversations`, both cascade delete |
| `agent_events` | (via `run_id`) | → `agent_runs`, cascade delete |
| `error_logs` | `user_id` (nullable, `SET NULL` on delete) | → `users` |

All foreign keys use `ON DELETE CASCADE` except `error_logs.user_id` (`SET NULL`, so deleting a user doesn't destroy diagnostic history). No table was found missing an owner column that needed one for correctness — the one theoretical hardening opportunity (`conversation_summaries` lookups not also checking `user_id`) is documented in the Security Audit as low-severity and not currently reachable.

## 23. Known limitations

**CRITICAL**: none open — the reported incident is fixed and verified (Section 3).

**HIGH**: none currently identified beyond what's listed below.

**MEDIUM**:
- Shared-device guest sessions still require the user to notice and use the new "start a new session" control — nothing detects a change of physical user automatically.
- Single SQLite/single-Railway-instance ceiling — cannot horizontally scale without a networked DB.
- In-process health state (`providerHealth.ts`) and in-process cancellation registry (`runCancellation.ts`) are single-instance-only, same caveat as SQLite.

**LOW**:
- `conversation_summaries` queries aren't `user_id`-scoped (not currently reachable by an attacker; see Security Audit).
- Hedging (`LLM_HEDGE_ENABLED`) doesn't wire cancellation through — off by default, so dormant.
- Task classifier is intentionally narrow (coding/current-info/general only) — no real signal exists for a broader "hard reasoning"/vision classifier yet.
- Ollama isn't installed on the M1 dev machine yet — the provider/registry/CLI layer is proven, the actual local-inference path is not yet exercised end-to-end.
- No OpenAI/Anthropic provider files exist — no keys, nothing to route to yet; the registry pattern makes adding one small.
- `TAVILY_API_KEY` not configured — current-info queries fall back to Gemini's native grounding or an honest "can't verify" response.

**PLANNED** (described in specs given this session, not built): real tool-calling/function-calling loop, calendar/email-send/Zoom/Teams/places/weather/hotels/restaurants tools, Local Computer Agent, voice sharing the AgentRun runtime (today TTS is a separate stateless call, not a competing "brain" but also not unified), Postgres/pgvector migration, Redis/queue-backed workers, the full `queued→acknowledged→running→thinking→tool_running→streaming→waiting_for_dependency→paused→completed→failed→cancelled` status vocabulary (only the subset that has real meaning today is implemented).

## 24. Recommended next steps (priority order)

1. Confirm the security fix in real usage — ask the reporter to verify the "Not you? Start a new session" control resolves the shared-device scenario in practice, not just in scripted tests.
2. Install Ollama on the M1 Mac and run `npm run models -- health`/`benchmark` against real local inference to close that verification gap.
3. Decide on `DEEPSEEK_API_KEY` / `TAVILY_API_KEY` — both are coded, tested, and waiting on credentials only.
4. If/when real tool-calling or computer-control work begins, design idempotency keys and permission scopes *before* wiring any side-effecting tool (calendar/email-send) — today there is nothing that could double-fire, but that changes the moment such a tool exists.
5. Revisit the SQLite/single-instance ceiling only if/when real multi-instance scaling pressure appears — not before (avoid a speculative Postgres migration with nothing forcing it yet).

## Commands reference

```bash
# Development
npm run dev --prefix server        # http://localhost:8787
npm run dev --prefix client        # http://localhost:5173, proxies /api

# Local-first mode
DEPLOYMENT_MODE=local npm run dev --prefix server   # prefers Ollama first when configured

# Testing
npm test --prefix server           # vitest, all suites including security.test.ts
npx tsc -p server/tsconfig.json --noEmit
npx tsc -b --force --prefix client  # (run from client/)

# Model management (from server/)
npm run models -- list
npm run models -- health
npm run models -- benchmark
npm run models -- install <ollama-tag>

# Production deploy (manual, no CI — direct from working tree)
railway up --detach                # from server/
vercel --prod --yes                # from repo root
```
