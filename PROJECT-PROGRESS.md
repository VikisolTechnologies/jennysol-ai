# JennySol × Arena Project Progress

**This file is the canonical, evidence-based progress ledger for the JennySol × Arena
integration.** It exists so any future Claude, ChatGPT, or human session can determine actual
project state without re-deriving it from conversation history. Every status below is backed by a
command, a file path, or a test run recorded in this document — not by narrative claims from a
prior session. If this file and a prior chat summary disagree, this file is correct; re-verify and
update it, don't trust the chat.

**Rule enforced throughout:** a milestone is DONE only if CODE + TESTS + VERIFICATION all exist,
unless explicitly marked documentation/design-only. An interface with no implementation, a mocked
service, or an architecture document is never sufficient evidence of DONE on its own.

## Current milestone

**M0 — Investigation.** Complete. M1 has not started.

## Current date

2026-09-10

## JennySol HEAD

`a86f873aaaa9b4387062cf4135b45670dd9edc79` — "Rearchitect guest identity as browser-session-scoped,
add conversation rename" (2026-09-08 04:47:54 -0700). Branch `main`, working tree clean, 0 commits
ahead/behind `origin/main`. Repository: `https://github.com/VikisolTechnologies/Jennysol-AI`.

## Arena FE HEAD

`6a4fe29` — "fix: remove fake Agent Chat keyword matcher, wire to real backend" (2026-09-10
23:04:56 +0530). Branch `main`, working tree clean, 0 ahead/behind `origin/main`. Repository:
`Vikisol-Arena-FE` (`arena-web`).

## Arena BE HEAD

`6d33023` — "feat: real agent backend boundary, replacing the removed fake keyword-matcher"
(2026-09-10 23:04:53 +0530). Branch `main`, working tree clean, 0 ahead/behind `origin/main`.
Repository: `Vikisol-Arena-BE` (`arena-api`).

## Overall completion

**1 of 13 milestones complete = 7.7% (≈8%).**

Calculation: milestones M0–M12 (13 total, defined in [Milestone Model](#milestone-model) below),
equal weight, no partial credit for a milestone unless its own explicit acceptance criteria are
met. Only M0 (Investigation — a documentation/design-only milestone by definition) currently meets
its acceptance criteria. M1–M12 all require CODE + TESTS + VERIFICATION and none has any of the
three yet, so each is 0%. This percentage will not move again until a milestone's full acceptance
criteria are met — not when related code merely starts to exist.

**Pre-existing supporting infrastructure, not counted toward any milestone above:** Arena's
`com.vikisol.arena.agent` package (interface → Noop → real client boundary, real server-side
`AgentConversation`/`AgentMessage` persistence) was built in a prior session, before the real
JennySol repository had been located. It is real, compiled, deployed, and live-verified — but it
implements none of M1–M11's acceptance criteria (there is no tool loop to connect it to, no
service-token issuer, no real client). It is relevant groundwork for M5/M11 once those start, and
is inventoried in detail under [Arena Integration Audit](#arena-integration-audit).

---

## Completed

- **M0 — Investigation.** Real JennySol repository located (`VikisolTechnologies/Jennysol-AI`,
  distinct from an earlier, unrelated, uncommitted local folder). Full architecture audit
  performed via direct source inspection (not documentation alone) — verified auth/isolation
  model, model router, AgentRun execution model, search/current-info architecture, and the
  absence of a tool-calling loop, product identity, or Arena awareness. Target architecture
  proposed and published: https://claude.ai/code/artifact/20ce7dcb-015f-42d8-b925-b10f818b3663.
  Evidence: this document's own [Phase 1](#phase-1--current-git-state) and
  [Phase 2](#phase-2--jennysol-implementation-audit) sections, produced by direct command
  execution on 2026-09-10.
- **Arena-side agent persistence boundary** (supporting infrastructure, not a milestone itself —
  see note above). `AgentServiceClient`/`NoopAgentServiceClient`/`AgentContext`/`AgentReply`/
  `AgentHistoryEntry`/`AgentProviderConfig`, `AgentConversation`/`AgentMessage` entities +
  repositories, `AgentController`/`AgentService`. Commits: Arena BE `6d33023`. Compiled clean
  (`./mvnw -o clean compile` → BUILD SUCCESS), deployed to Railway, live-verified against
  production (a real message persists across a page refresh). No automated tests exist for this
  module (see [Arena Integration Audit](#arena-integration-audit) — TEST STATUS: NONE for every
  row).
- **Arena-side fake-AI removal.** The pre-existing `buildReply()` keyword matcher in
  `arena-web/src/app/agent/page.tsx` was removed and replaced with a real call to the boundary
  above, which honestly reports "temporarily unavailable" since no real client exists yet. Commit:
  Arena FE `6a4fe29`.

## In Progress

Nothing. No M1–M12 work has started as of this checkpoint.

## Not Started

M1 through M12 in full — see [Phase 2](#phase-2--jennysol-implementation-audit),
[Phase 3](#phase-3--arena-integration-audit), and [Phase 4](#phase-4--tool-matrix) below for the
exact, item-by-item evidence behind this. In summary: no tool-calling loop, no product identity
model, no tool registry, no connector framework, no Arena connector, no Arena-callable tools (read
or write), no approval workflow wired to a real tool, no product-scoped memory isolation, no
service-token issuer, no agent-specific audit logging, and no security tests for any of the above
— because none of the systems those tests would exercise exist yet.

## Blocked

- **Real end-to-end verification (Phase 5)** is blocked, not failing — there is no tool-calling
  loop (M1) or connector (M4/M5) to route a request through, so the flow "User → JennySol → Model
  → Tool call → Connector → Arena → Authorization → Business service → Database → Result" cannot
  be executed today at any point past "Model." This is the correct, honest state to report — not
  a test failure.
- **Security verification (Phase 6)** is blocked for the same reason: there is no service token,
  no scope, no audience/issuer, and no cross-product call path yet to attack-test. See
  [Phase 6](#phase-6--security-verification) for the full per-test BLOCKED table.
- **GitHub PR history** is blocked from independent verification: no `gh` CLI is available in this
  environment, and the unauthenticated GitHub REST API returns `404` for this private
  organization repository (`api.github.com/repos/VikisolTechnologies/Jennysol-AI/pulls` → 404,
  which is indistinguishable from "no access" vs. "no PRs" without a token). Git-level evidence
  (zero merge commits across all three repositories' full history) strongly suggests no PR-based
  workflow has ever been used on this project — direct-to-`main` pushes only — but this is
  inferred from git history, not confirmed via the GitHub API itself.

## Regressions

None identified. All three repositories' most recent commits build/compile/test clean (see
[Phase 1](#phase-1--current-git-state) and [Phase 2](#phase-2--jennysol-implementation-audit) for
exact command output).

## Security Status

No integration-specific security posture to report yet — there is no integration. JennySol's own,
unrelated security incident (guest-session bleed on a shared device) was independently found and
fixed prior to this checkpoint (commit history through `a86f873`), and is not part of this
project's scope but is noted since it affects the auth foundation any future service-token design
would build on. Full per-item status: [Phase 6](#phase-6--security-verification).

## Test Status

| Repository | Test files | Tests | Result | Command | Verified |
|---|---|---|---|---|---|
| Jennysol-AI (`server`) | 20 | 196 | 196 passed, 0 failed | `npm test` (vitest) | 2026-09-10, this checkpoint |
| Arena BE (`arena-api`) | 0 | 0 | N/A — no test files exist | `find src/test -type f` → empty | 2026-09-10, this checkpoint |
| Arena FE (`arena-web`) | 0 (unit) | 0 | N/A — no unit test files exist (a separate Playwright E2E suite exists for Arena's own product features, unrelated to the agent/tool integration this document tracks) | `find src -iname "*.test.*"` → empty | 2026-09-10, this checkpoint |

None of JennySol's 196 passing tests exercise anything in scope for this integration (tool
calling, product identity, connectors) — they cover JennySol's own pre-existing chat/auth/router/
memory subsystems, audited in Phase 2 as separate from the M1–M12 milestones.

## Deployment Status

| Service | Platform | URL | State |
|---|---|---|---|
| JennySol client | Vercel | `jennysol.vikisol.in` | Live |
| JennySol server | Railway | `api.jennysol.vikisol.in` | Live |
| Arena web | Vercel | `arena.vikisol.in` | Live, `6a4fe29` deployed |
| Arena API | Railway | `api-arena.vikisol.in` | Live, `6d33023` deployed |

No integration-specific deployment exists — nothing new to deploy until M1 produces code.

## Current Architecture

See the published artifact for full diagrams:
https://claude.ai/code/artifact/20ce7dcb-015f-42d8-b925-b10f818b3663 (sections "Current
Architecture" and "Intended Vikisol Ecosystem Architecture"). Unchanged since publication;
re-verified against source as part of this checkpoint (Phases 1–4 below).

## Tool Matrix

See [Phase 4](#phase-4--tool-matrix) for the full table. Summary: 0 of 14 proposed Arena tools are
implemented, registered, connected, tested, or production-verified as agent-callable tools. All 14
map to Arena REST endpoints that already exist and work for normal (non-agent) product use — that
existing endpoint is not the same claim as an agent tool wrapping it existing.

## Commit History

See [Phase 1](#phase-1--current-git-state) for the last 10 commits of all three repositories,
captured verbatim from `git log`.

## PR History

None found in any of the three repositories (zero merge commits in full history, all branches).
GitHub API access to confirm this independently is blocked in this environment (see
[Blocked](#blocked) above).

## Next Exact Tasks

1. **M1 — Tool-calling engine in JennySol.** Add a `toolDefinitions`-in/`toolCalls`-out capability
   to `LlmProvider` (`server/src/services/llmProvider.ts`), implement it first for
   `providers/gemini.ts` (native function-calling support), wire a dispatch loop in
   `chatRunner.ts`. Acceptance: a real chat turn where the model calls a locally-defined test tool
   (no Arena involvement yet) and the result is incorporated into the final answer, covered by a
   new `chatRunner.toolLoop.test.ts`.
2. **M2 — Product identity model in JennySol.** New `services/productIdentity.ts`,
   `services/serviceToken.ts` (verify externally-issued, short-lived, scoped tokens), new
   `product_identities` table (additive migration, JennySol's existing `addColumnIfMissing`
   idiom). Acceptance: forged/expired/wrong-audience tokens are rejected, covered by tests, with
   no real product connected yet — test against a fake product first, per the original design's
   own instruction.
3. **M3 — Tool registry.** `services/toolRegistry.ts`, a `ProductConnector` interface. Acceptance:
   a second, fake product can register a tool and have it appear correctly scoped in a chat
   session's available tools, with a real test proving product A's tools are invisible to
   product B's identity.
4. **M5 — Arena connector.** Arena issues a real service token (`AgentServiceTokenIssuer.java`,
   new); JennySol's `productConnectors/arena.ts` (new) verifies it. Acceptance: a live round trip
   with a real Arena test account's token, accepted by JennySol, rejected when tampered with.
5. **M6 — First Arena read tool.** Wrap `GET /jobs` as `arena.searchJobs`, registered in the Arena
   connector. Acceptance: a real chat message ("find me React jobs") that triggers the tool and
   returns real Arena data, verified live end-to-end — the first real instance of the Phase 5 flow
   this checkpoint currently reports as BLOCKED.

## Known Risks

See [Phase 2](#phase-2--jennysol-implementation-audit)'s notes and the published architecture
artifact's own Risks section for the full list. Restated briefly: M1/M2 are genuinely new,
non-trivial engineering, not configuration; JennySol's SQLite/single-instance ceiling is a real
future constraint once Arena traffic adds to its own; a carelessly-built service-token design
could be a worse outcome than today's "no integration exists" state, which is exactly why M2 is
sequenced before any real Arena credential touches JennySol.

---

## Phase 1 — Current Git State

### Repository: `VikisolTechnologies/Jennysol-AI`

- Current branch: `main`
- HEAD commit: `a86f873aaaa9b4387062cf4135b45670dd9edc79`
- Commit date: 2026-09-08 04:47:54 -0700
- Working tree: clean
- Uncommitted files: none
- Active branches: `main` only (`origin/HEAD -> origin/main`)
- Ahead/behind `origin/main`: 0 / 0
- Open PRs: unable to verify independently (see [Blocked](#blocked))
- Merged PRs: 0 merge commits found in full history (`git log --all --merges` → empty) — this
  project has never used a PR-based workflow; every commit lands directly on `main`
- Pushed: yes, `origin/main` HEAD matches local HEAD exactly

Latest 10 commits (`git log -10 --format="%h %ci %an %s"`):

```
a86f873 2026-09-08 04:47:54 -0700 vikisoltechnologies Rearchitect guest identity as browser-session-scoped, add conversation rename
9be22c8 2026-09-08 03:39:33 -0700 vikisoltechnologies Extend JennySol's visual identity from the intro into the chat interface
45db65e 2026-09-08 03:16:53 -0700 vikisoltechnologies Add cinematic 5-second JennySol intro, replacing WelcomeAnimation
98a583c 2026-09-08 02:53:18 -0700 vikisoltechnologies Read build version from GIT_COMMIT_SHA at runtime, not baked in at build time
611ab9b 2026-09-08 02:51:25 -0700 vikisoltechnologies Fix build-version reporting "unknown" in production — Railway rebuilds without .git
f3e87f8 2026-09-08 02:48:48 -0700 vikisoltechnologies Add multi-device guest isolation tests, build-version diagnostics, and fix raw-token exposure in sessions list
29d224d 2026-09-08 02:34:34 -0700 vikisoltechnologies Correct stale weather/capability-registry claims in docs, document conversation_summaries hardening
5b68af9 2026-09-08 02:29:55 -0700 vikisoltechnologies Harden conversation_summaries with user_id scoping, add capability registry + config-health endpoint
c81a064 2026-09-07 23:05:06 -0700 vikisoltechnologies Add free-first architecture and cost documentation
77c6516 2026-09-07 23:00:50 -0700 vikisoltechnologies Add free-first weather (Open-Meteo) and self-hosted search (SearXNG) support, browser timezone
```

### Repository: `Vikisol-Arena-FE` (`arena-web`)

- Current branch: `main`
- HEAD commit: `6a4fe29` — "fix: remove fake Agent Chat keyword matcher, wire to real backend"
  (2026-09-10 23:04:56 +0530)
- Working tree: clean
- Uncommitted files: none
- Ahead/behind `origin/main`: 0 / 0
- Open/merged PRs: 0 merge commits in full history — direct-to-`main` only
- Pushed: yes, confirmed matching `origin/main`

Latest 10 commits:

```
6a4fe29 2026-09-10 23:04:56 +0530 fix: remove fake Agent Chat keyword matcher, wire to real backend
8d0fa36 2026-09-10 22:30:12 +0530 fix: remove fabricated data from enterprise dashboard, unlock, and posting flows
6be38ae 2026-09-04 14:44:33 +0530 feat: make the homepage real - live market data, real talent stats, working CTAs
cc3541c 2026-09-02 03:03:16 +0530 docs: record Sentry error-tracking activation on both services
d1e7146 2026-09-02 02:42:44 +0530 docs: record the sign-in-to-signup fallback feature
313000f 2026-09-02 02:34:40 +0530 feat: offer to create an account when sign-in finds none
8918658 2026-09-02 02:18:43 +0530 docs: record Google Maps activation - all three credentials now live
e6ebcd6 2026-09-02 01:34:32 +0530 docs: record Resend/Google activation and the Railway/Vercel dual-deploy fix
58e8384 2026-09-01 20:42:08 +0530 fix: forward NEXT_PUBLIC_GOOGLE_CLIENT_ID/MAPS_API_KEY into the Docker build
697509e 2026-09-01 19:36:16 +0530 docs: record the new MSG91 SMS-OTP provider
```

### Repository: `Vikisol-Arena-BE` (`arena-api`)

- Current branch: `main`
- HEAD commit: `6d33023` — "feat: real agent backend boundary, replacing the removed fake
  keyword-matcher" (2026-09-10 23:04:53 +0530)
- Working tree: clean
- Uncommitted files: none
- Ahead/behind `origin/main`: 0 / 0
- Open/merged PRs: 0 merge commits in full history — direct-to-`main` only
- Pushed: yes, confirmed matching `origin/main`

Latest 10 commits:

```
6d33023 2026-09-10 23:04:53 +0530 feat: real agent backend boundary, replacing the removed fake keyword-matcher
e35cf83 2026-09-10 22:29:59 +0530 fix: expose real unlock status, close credit race condition
a88f690 2026-09-04 14:44:17 +0530 feat: add public landing-page endpoints for real stats and a featured open project
b912efb 2026-09-02 02:34:01 +0530 feat: reveal "no account found" on email sign-in, matching phone sign-in
99875b4 2026-09-01 19:35:53 +0530 feat: add MSG91 SMS provider for phone OTP delivery
0e26e84 2026-09-01 18:07:35 +0530 fix: P3's N+1/unbounded-query findings - rooms, DMs, comments, feed tags/media
387b0e6 2026-09-01 17:54:00 +0530 fix: reset-password and invite links pointed at localhost in production
8ad8ef5 2026-09-01 17:51:03 +0530 fix: NoopEmailProvider only logged subject/recipient, not the body
c1ba1b6 2026-09-01 17:48:24 +0530 feat: forgot/reset password, and WebOTP-compatible SMS format for auto-read
b1d7333 2026-09-01 17:26:49 +0530 fix: Google sign-in's not-configured error leaked GOOGLE_CLIENT_ID's name
```

---

## Phase 2 — JennySol Implementation Audit

Verified by direct `grep`/source inspection against HEAD `a86f873` on 2026-09-10 (this checkpoint;
re-run these commands, don't trust this table blind on a future date since JennySol evolves
roughly daily). Repo-wide searches for `toolregistry|productidentity|servicetoken|productconnector|
arenaconnector` and for `functionDeclarations|tool_calls|toolCalls` (outside Gemini's native
`googleSearch` grounding declaration), `prompt.?injection|sanitiz`, `idempotenc`, and
`pending_confirmation|approval` all returned **zero matches** in `server/src`.

| # | Area | Status | Evidence | Files | Tests | Commit |
|---|---|---|---|---|---|---|
| 1 | Model-directed tool calling | **NOT STARTED** | `grep` for `functionDeclarations\|tool_calls` in provider files: no matches. Only tool-shaped declaration anywhere is Gemini's native `googleSearch` grounding tool, which is a fixed capability the model can only turn on/off per turn, not an arbitrary function-call loop. | — | — | — |
| 2 | Multi-step tool loop | **NOT STARTED** | Same evidence as #1 — there is no loop, single fixed pipeline (RAG retrieval + optional search, both pre-decided by application code, not the model) | `contextManager.ts` | — | — |
| 3 | Tool Registry | **NOT STARTED** | `grep -rli "toolregistry"` → no matches | — | — | — |
| 4 | ProductIdentity | **NOT STARTED** | `grep -rli "productidentity"` → no matches. Only identity concept is a JennySol `User` row (`is_guest` flag) | — | — | — |
| 5 | Service-token verification | **NOT STARTED** | `grep -rli "servicetoken"` → no matches. Auth is opaque session tokens for JennySol accounts only (`services/auth/sessions.ts`) | — | — | — |
| 6 | Product Connector framework | **NOT STARTED** | `grep -rli "productconnector"` → no matches | — | — | — |
| 7 | Arena Connector | **NOT STARTED** | `grep -rli "arena"` across `server/src` → no matches anywhere in source | — | — | — |
| 8 | Arena tool schemas | **NOT STARTED** | Depends on #7, which doesn't exist | — | — | — |
| 9 | Arena read tools | **NOT STARTED** | Same | — | — | — |
| 10 | Arena write tools | **NOT STARTED** | Same | — | — | — |
| 11 | Approval workflow | **NOT STARTED** | `grep -rli "pending_confirmation\|approval"` → no matches. (Note: the *concept* of a confirmation-gated tool exists in this project's own architecture docs/history as a design principle, but no code implements a confirmation state machine today.) | — | — | — |
| 12 | AgentRun integration (for tool calls) | **PARTIAL, unrelated scope** | The AgentRun durability model itself is real and verified (`agentRunStore.ts`, `chatRunner.ts`) — but it has nothing to attach tool-call events to, since no tool loop exists. Counted PARTIAL only insofar as the *chassis* a future tool loop would plug into is real; the tool-call capability itself is NOT STARTED. | `server/src/services/agentRunStore.ts`, `chatRunner.ts` | `agentRunStore.test.ts` (6 tests) | pre-dates this checkpoint |
| 13 | SSE tool events | **NOT STARTED** | Event vocabulary emitted today: `run.started`, `agent.status`, `message.delta`, `guest.progress`, `heartbeat`, `done`, `error`, `cancelled` — confirmed via `grep` in `chatRunner.ts`/`runBus.ts`. No `tool_call`/`tool_result` event type exists. | — | — | — |
| 14 | Cancellation | **DONE (general chat), NOT APPLICABLE (tools)** | `POST /api/agent/runs/:id/cancel` real and verified live in production for a chat generation. No tool call exists yet to cancel. | `server/src/services/runCancellation.ts` | covered in `modelRouter.test.ts` cancellation cases | pre-dates this checkpoint |
| 15 | Retries | **DONE (model calls), NOT APPLICABLE (tools)** | Real, tested retry/circuit-breaker logic for LLM provider calls (`retryClassifier.ts`, `providerHealth.ts`). No tool-call retry policy exists because no tool calls exist. | `server/src/services/retryClassifier.ts`, `providerHealth.ts` | `retryClassifier.test.ts`, `providerHealth.test.ts` | pre-dates this checkpoint |
| 16 | Idempotency | **NOT STARTED** | `grep -rli "idempotenc"` → no matches anywhere in the codebase | — | — | — |
| 17 | Memory isolation (per-user) | **DONE (JennySol accounts only)** | Every table scoped by `user_id`, verified via direct code read and the project's own `security.test.ts` (10 cross-user isolation tests, real SQLite) | `conversationStore.ts`, `vectorStore.ts`, `agentRunStore.ts` | `security.test.ts` (10 tests) | pre-dates this checkpoint |
| 18 | Product-scoped memory isolation | **NOT STARTED** | No concept of "product" exists in the memory layer at all — isolation today is per-`user_id` only, which is a different (necessary but not sufficient) guarantee than "Arena data never crosses into JennySol's own cross-product memory," since no cross-product memory concept exists yet either | — | — | — |
| 19 | Tenant context | **NOT STARTED** | `grep -n "organization" server/src/db/index.ts` → one hit, the bare `organization_id TEXT` column on `users`. Nothing creates, joins, or checks membership. | `server/src/db/index.ts:19` | — | — |
| 20 | Prompt-injection protection | **NOT STARTED** | `grep -rli "prompt.?injection\|sanitiz"` → no matches. Uploaded document content is passed to the model with no sanitization — an acknowledged, undesigned-around risk in JennySol's own `SECURITY_AUDIT.md`/`JENNY_IMPLEMENTATION_STATUS.md` | — | — | — |
| 21 | Auditability (agent actions) | **NOT STARTED (agent-specific)** | `error_logs` table exists for crash/error visibility (unrelated purpose). No `agent_events`-style audit trail exists for "which tool was called, on whose behalf, with what result" — because no tool exists to audit | `server/src/services/errorLog.ts` (different purpose) | — | — |
| 22 | Security logging | **PARTIAL (general), NOT STARTED (agent-specific)** | Real for auth (`login_attempts` table, lockout). No agent/tool-specific security logging exists | `server/src/services/auth/loginAttempts.ts` | — | — |
| 23 | Gemini tool calling | **NOT STARTED (function calling)**, **DONE (search grounding only)** | The only `tools:` array declared to Gemini is `[{ googleSearch: {} }]` — a fixed, single native capability, not arbitrary function declarations the model can invoke | `server/src/services/providers/gemini.ts:27` | — | pre-dates this checkpoint |
| 24 | DeepSeek compatibility | **PARTIAL — coded, never run against real API** | Implemented, unit-tested with mocked HTTP, but per the project's own docs "has still never made one real network call to api.deepseek.com" — no `DEEPSEEK_API_KEY` ever configured | `server/src/services/providers/deepseek.ts` | `modelRouter.test.ts` (mocked) | pre-dates this checkpoint |
| 25 | Ollama compatibility | **PARTIAL — coded, model-serving step unexercised** | Reachability probe, model registry, hardware profiles all real and verified on the actual target Mac; Ollama itself not installed there, so no real local inference has run yet | `server/src/services/providers/ollama.ts`, `models/*` | `models/hardwareProfile.test.ts`, `models/modelRegistry.test.ts` | pre-dates this checkpoint |
| 26 | Test coverage (JennySol overall) | **DONE (for what exists), N/A for what doesn't** | 196/196 tests passing, 20 files, `npm test` re-run live for this checkpoint (see [Test Status](#test-status)) | — | 196 tests | this checkpoint |
| 27 | Integration tests (Arena↔JennySol) | **NOT STARTED — no integration exists** | — | — | — | — |
| 28 | Security tests (Arena↔JennySol) | **NOT STARTED — no integration exists** | — | — | — | — |
| 29 | Production configuration (for integration) | **NOT STARTED** | No `ARENA_*`/agent-related env vars exist in `server/.env.example` — confirmed by direct read | `server/.env.example` | — | — |
| 30 | Deployment readiness (for integration) | **NOT STARTED** | Nothing to deploy; JennySol's own deployment (unrelated to this integration) is live and unaffected | — | — | — |

## Phase 3 — Arena Integration Audit

Verified by direct file read/grep against Arena BE HEAD `6d33023` on 2026-09-10.

| Item | Status | Exact file | Exact class/method | Current behavior | Test status | Commit |
|---|---|---|---|---|---|---|
| `AgentServiceClient` | **DONE (interface only)** | `agent/client/AgentServiceClient.java` | `interface AgentServiceClient { isAvailable(); sendMessage(...) }` | Real interface, documents in its own class-doc exactly why no real implementation exists yet | No unit tests | `6d33023` |
| `NoopAgentServiceClient` | **DONE** | `agent/client/NoopAgentServiceClient.java` | `isAvailable()` always returns `false`; `sendMessage()` throws `UnsupportedOperationException` if ever called | Correct, deliberate fail-loud-if-misused design | No unit tests | `6d33023` |
| `RealAgentServiceClient` | **NOT STARTED** | Does not exist. The only occurrence of the string "RealAgentServiceClient" in the codebase is inside `AgentServiceClient.java`'s own class-doc comment, explaining why it doesn't exist yet | — | — | — | — |
| `AgentContext` | **DONE (generic record)** | `agent/client/AgentContext.java` | `record AgentContext(UUID userId, String role)` | Real, minimal, correctly excludes tenant/tool-scope fields since no tool model exists yet to need them | No unit tests | `6d33023` |
| `AgentReply` | **DONE (generic record)** | `agent/client/AgentReply.java` | `record AgentReply(String content)` | Real, deliberately has no `intent`/tool-call field yet | No unit tests | `6d33023` |
| `AgentHistoryEntry` | **DONE (generic record)** | `agent/client/AgentHistoryEntry.java` | `record AgentHistoryEntry(String role, String content)` | Real | No unit tests | `6d33023` |
| `AgentProviderConfig` | **DONE (Noop-only binding)** | `agent/config/AgentProviderConfig.java` | `@Bean @Primary AgentServiceClient agentServiceClient(NoopAgentServiceClient noop)` | Always returns Noop — no config-driven real/noop switch exists yet since there is no real implementation to switch to | No unit tests | `6d33023` |
| Service-token issuer | **NOT STARTED** | Does not exist. `grep -rli "ServiceToken"` in `arena-api` → no matches | — | — | — | — |
| Agent-tool controller | **NOT STARTED** | Does not exist. `AgentController.java` exposes only conversation/message CRUD (`GET /agent/conversation`, `GET/POST /agent/conversations/{id}/messages`), no tool-invocation endpoints | `agent/controller/AgentController.java` | Real, but scope is chat persistence only, not tools | No unit tests | `6d33023` |
| Arena-side tool authorization (agent-specific) | **NOT STARTED** | No agent tools exist to authorize. Arena's *general* endpoint authorization (`@PreAuthorize`, tenant scoping via `EnterpriseProfileService.getEntityForUser`) is real and would be reused once tools exist, but there is no agent-specific authorization layer today | `config/SecurityConfig.java` (general, pre-existing) | Real for general endpoints | — |
| Tenant enforcement (agent-specific) | **NOT STARTED** | Same as above — Arena's real tenant model (`EnterpriseProfile`/`Membership`) exists and works for human requests; nothing routes an agent-originated call through it yet, because no agent-originated call type exists | `enterprise/service/EnterpriseProfileService.java` (general, pre-existing) | Real for general endpoints | — |
| Audit events (agent-specific) | **NOT STARTED** | Arena's `AuditService` is real and used for unlock/credit events (general, pre-existing) — no agent-tool-call audit event type exists yet | `audit/AuditService.java` (general, pre-existing) | Real for general events | — |
| Approval mechanism | **NOT STARTED (backend), DORMANT (frontend UI only)** | `IntentCardView.tsx` (Arena FE) renders an approve/reject card if a `ChatMessage.intentCard` is ever populated — but `AgentReply` (backend) has no field to populate it with, and the wiring that used to fabricate intents (`buildReply()`) was removed. The component is correct, unused code, not a working workflow. | `arena-web/src/components/agent/IntentCardView.tsx` | No tests | `6a4fe29` (FE) |
| Candidate unlock protection | **DONE (as a general Arena feature, not an agent tool)** | `TalentSearchService.unlock()` uses a pessimistic row lock (`findByIdForUpdate`), closing a real credit-spend race condition. This is the business method a future `arena.unlockCandidateContact` tool would wrap — it is not itself an agent tool. | `enterprise/service/TalentSearchService.java` | No unit tests (verified via live Playwright check against production in a prior session) | `e35cf83` |
| Application tools | **NOT STARTED** | No agent-callable wrapper exists. Underlying `ApplicationService`/`ApplicationController` exist and work for normal frontend use. | `applications/*` (general, pre-existing) | — | — |
| Project/bid tools | **NOT STARTED** | Same pattern — `marketplace/*` exists for normal use, no agent wrapper | `marketplace/*` (general, pre-existing) | — | — |
| Posting tools | **NOT STARTED** | Same pattern — enterprise postings module exists for normal use, no agent wrapper | `enterprise/*` (general, pre-existing) | — | — |

## Phase 4 — Tool Matrix

All 14 tools: **not implemented as agent-callable tools.** The "underlying endpoint" column is
included because it materially affects how much work each future tool actually requires (a thin
wrapper vs. new business logic) — it is not a claim that the tool itself exists.

| Tool | Product | R/W | Implemented? | Registered? | Connected? | Authorized? | Tested? | Approval required? | Prod verified? | Underlying Arena endpoint |
|---|---|---|---|---|---|---|---|---|---|---|
| `arena.searchJobs` | Arena | Read | No | No | No | N/A | No | No | No | `GET /jobs` — exists, public |
| `arena.getJob` | Arena | Read | No | No | No | N/A | No | No | No | `GET /jobs/{id}` — exists |
| `arena.getMyProfile` | Arena | Read | No | No | No | N/A | No | No | No | `GET /profile/me` — exists |
| `arena.getMyApplications` | Arena | Read | No | No | No | N/A | No | No | No | Applications module — exists |
| `arena.getProjects` | Arena | Read | No | No | No | N/A | No | No | No | Marketplace module — exists |
| `arena.getNotifications` | Arena | Read | No | No | No | N/A | No | No | No | Notifications module — exists |
| `arena.searchCandidates` | Arena | Read | No | No | No | N/A | No | No | No | `TalentSearchService.search()` — exists, tenant-scoped |
| `arena.getCandidate` | Arena | Read | No | No | No | N/A | No | No | No | `TalentSearchService.getCandidateDetail()` — exists, respects paywall redaction |
| `arena.getMyPostings` | Arena | Read | No | No | No | N/A | No | No | No | Enterprise postings module — exists |
| `arena.applyToJob` | Arena | **Write** | No | No | No | N/A | No | Yes (design intent) | No | Applications module — exists |
| `arena.placeBid` | Arena | **Write** | No | No | No | N/A | No | Yes (design intent) | No | Marketplace module — exists |
| `arena.createPosting` | Arena | **Write** | No | No | No | N/A | No | Yes (design intent) | No | Enterprise postings module — exists |
| `arena.unlockCandidateContact` | Arena | **Write** | No | No | No | N/A | No | Yes (design intent) | No | `TalentSearchService.unlock()` — exists, race-condition-fixed |
| `arena.sendMessage` | Arena | **Write** | No | No | No | N/A | No | Yes (design intent) | No | Messaging module — exists |

## Phase 5 — Real End-to-End Verification

**BLOCKED.** The flow `USER → JennySol → MODEL → TOOL CALL → CONNECTOR → ARENA → AUTHORIZATION →
BUSINESS SERVICE → DATABASE → RESULT → JennySol → USER` cannot be executed at any point past
"MODEL" — there is no tool-calling capability (Phase 2, item 1), no connector (Phase 2, item 6),
and no agent-tool controller on the Arena side (Phase 3) for a request to reach. This is not a
failed test; it correctly reflects that the prerequisite systems for this flow do not exist yet.
No read flow, safe write flow, or test-environment substitute was run, because there is no code
path for any of them to exercise. This will be re-run and populated with real evidence once M6
("First Arena read tool," see [Next Exact Tasks](#next-exact-tasks)) is complete.

## Phase 6 — Security Verification

All 17 required tests: **BLOCKED**, not PASS/FAIL — there is no service token, connector, or
cross-product call path in existence yet to run any of these tests against. Listed individually
per the instruction not to summarize this away:

| # | Test | Result |
|---|---|---|
| 1 | Valid service token | BLOCKED — no service token system exists |
| 2 | Expired token | BLOCKED |
| 3 | Forged token | BLOCKED |
| 4 | Wrong audience | BLOCKED |
| 5 | Wrong issuer | BLOCKED |
| 6 | Invalid scope | BLOCKED |
| 7 | Wrong tenant | BLOCKED |
| 8 | Wrong user | BLOCKED |
| 9 | Cross-user access (via agent tool) | BLOCKED — no agent tool exists to attempt this through |
| 10 | Cross-tenant access (via agent tool) | BLOCKED |
| 11 | Arena JWT leakage into JennySol | BLOCKED — no call path exists for it to leak across |
| 12 | Refresh-token leakage | BLOCKED |
| 13 | PII leakage (Arena → JennySol memory) | BLOCKED — no memory-write path from Arena data exists |
| 14 | Memory leakage (cross-product) | BLOCKED |
| 15 | Prompt injection through Arena data | BLOCKED — no Arena data ever reaches a JennySol prompt today |
| 16 | Unauthorized write action | BLOCKED — no write tool exists |
| 17 | Approval bypass | BLOCKED — no approval workflow is wired to any real tool |

## Phase 8 — Milestone Model

Each milestone's completion requires CODE + TESTS + VERIFICATION unless marked
documentation/design-only. "Verification" means a real, run, recorded check (a live call, an
end-to-end test, a production observation) — not code review alone.

| Milestone | Acceptance criteria | Status |
|---|---|---|
| **M0 — Investigation** | Real JennySol repo located and distinguished from the unrelated local folder; architecture audited via direct source inspection; target architecture documented and published. *Documentation/design-only — no code required.* | **DONE** |
| **M1 — Tool-calling engine** | `LlmProvider` gains a tool-definitions-in/tool-calls-out capability, implemented for at least one real provider (Gemini); a real chat turn triggers a locally-defined test tool and incorporates its result; covered by a passing automated test. | NOT STARTED |
| **M2 — Product identity/security** | A `ProductIdentity` concept and service-token verifier exist; forged/expired/wrong-audience/wrong-scope tokens are rejected; proven against a fake product connector before any real one exists; covered by passing automated tests. | NOT STARTED |
| **M3 — Tool registry** | A `ToolRegistry` and `ProductConnector` interface exist; a second (fake) product can register tools scoped correctly to its own identity, proven by a test showing product A's tools are invisible under product B's identity. | NOT STARTED |
| **M4 — Connector framework** | The general connector plumbing (registration, tool namespacing, per-connector health/config) is real and reusable by more than one product without code changes to the core. | NOT STARTED |
| **M5 — Arena connector** | Arena mints a real, scoped service token; JennySol's Arena connector verifies it; a live round trip succeeds with a real Arena test account and fails correctly when tampered with. | NOT STARTED |
| **M6 — Arena read tools** | At least one real Arena read tool (e.g. `arena.searchJobs`) is implemented, registered, connected, and triggered by a real chat message end-to-end in a live test, returning real Arena data. | NOT STARTED |
| **M7 — Approval/write tools** | At least one write tool (e.g. `arena.applyToJob`) is gated behind a real approval step the user must explicitly confirm before the tool executes; verified live that a rejected approval never calls the tool and an approved one does, exactly once. | NOT STARTED |
| **M8 — Memory isolation** | Product-scoped memory tagging exists; a test proves Arena tool-call data never appears in JennySol's own cross-product/long-term memory without an explicit, separate "remember this" action. | NOT STARTED |
| **M9 — Audit/observability** | Every agent-originated Arena action is written to Arena's existing `AuditService` (distinguishable from a human-originated action) and to a JennySol-side tool-call log; verified by triggering a real tool call and finding it in both logs. | NOT STARTED |
| **M10 — Security testing** | All 17 tests listed in this document's Phase 6 move from BLOCKED to PASS/FAIL with real evidence, run against the real integration. | NOT STARTED |
| **M11 — Real end-to-end integration** | The full flow in this document's Phase 5 executes for real, for at least one read and one approved write, with recorded evidence at every hop. | NOT STARTED |
| **M12 — Production rollout** | The real client replaces `NoopAgentServiceClient` for at least one production Arena account via configuration only (no code change required to flip it, per the existing interface→Noop→real pattern), verified live. | NOT STARTED |

---

*Generated 2026-09-10 by direct inspection of all three repositories — no status above was carried
forward from a prior conversation without being independently re-verified via a command run during
this checkpoint.*
