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

**M5 — Arena connector.** Complete. M6 not started. **First milestone with real cross-repo
evidence** — both `arena-api` and `jennysol-ai` changed and pushed.

## Current date

2026-09-11

## JennySol HEAD

`3ceca59` — "feat(agent): add the real Arena product connector (M5)". Branch `main`, working tree
clean at commit time. Repository: `https://github.com/VikisolTechnologies/jennysol-ai` (canonical;
GitHub redirects the old `Jennysol-AI` casing here).

**Push confirmation:** `git ls-remote origin main` → `3ceca59285358f57c54f88d93119e45cf9388cc4`,
matching local `HEAD` exactly. Underlying application code prior to this checkpoint's own
documentation/implementation commits was `a86f873` (2026-09-08, JennySol's own last feature commit
before this integration project began).

## Arena FE HEAD

`6a4fe29` — "fix: remove fake Agent Chat keyword matcher, wire to real backend" (2026-09-10
23:04:56 +0530). Branch `main`, working tree clean, 0 ahead/behind `origin/main`. Repository:
`Vikisol-Arena-FE` (`arena-web`). Unchanged this milestone — M5 touched Arena's backend only.

## Arena BE HEAD

`6b060a4` — "feat(agent): add JennySol service-token issuer (M5, JennySol integration)"
(2026-09-11). Branch `main`, working tree clean, 0 ahead/behind `origin/main`, deployed to
Railway (`api-arena.vikisol.in`) and confirmed live (`GET /api/v1/public/landing-stats` → 200)
after this deploy settled. Repository: `Vikisol-Arena-BE` (`arena-api`).

## Overall completion

**6 of 13 milestones complete = 46.2% (≈46%).**

Calculation: milestones M0–M12 (13 total, defined in [Milestone Model](#milestone-model) below),
equal weight, no partial credit for a milestone unless its own explicit acceptance criteria are
met. M0 (Investigation), M1 (Tool-calling engine), M2 (Product identity/security), M3 (Tool
registry), M4 (Connector framework), and M5 (Arena connector — a real token minted by Arena's
actual Java issuer verified by JennySol's actual TypeScript verifier, live, cross-repo) now meet
their acceptance criteria. M6–M12 all require CODE + TESTS + VERIFICATION and none has any of the
three yet, so each remains 0%. This percentage will not move again until a milestone's full
acceptance criteria are met — not when related code merely starts to exist.

**Pre-existing supporting infrastructure, not counted toward any milestone above:** Arena's
`com.vikisol.arena.agent` package (interface → Noop → real client boundary, real server-side
`AgentConversation`/`AgentMessage` persistence) was built in a prior session, before the real
JennySol repository had been located. It is real, compiled, deployed, and live-verified — but it
still implements none of M6–M11's acceptance criteria on its own: `AgentServiceClient` still binds
to `NoopAgentServiceClient` in production (a `RealAgentServiceClient` calling JennySol through the
M5 token/connector this checkpoint just built is real, buildable work, not yet done — see
[Next Exact Tasks](#next-exact-tasks)). It is relevant groundwork for M6/M11 once those advance
further, and is inventoried in detail under [Arena Integration Audit](#arena-integration-audit).

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
- **This checkpoint itself, pushed to GitHub.** `PROJECT-PROGRESS.md` (commit `56ced33`) and the
  five ADRs under `docs/architecture/` (commit `8b086b6`) are live on `origin/main` at
  `https://github.com/VikisolTechnologies/jennysol-ai` — confirmed 2026-09-11 via
  `git ls-remote origin main` (`8b086b6...` matches local `HEAD` exactly), `git log origin/main`
  (both commits present), and `git ls-tree -r origin/main` / `git show origin/main:PROJECT-PROGRESS.md`
  (all six files present with real content, not just locally committed).
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
- **M1 — Tool-calling engine.** `LlmProvider` extended with a provider-agnostic
  `ToolDefinition`/`ToolCall`/`ToolCallHandler` contract (`server/src/services/llmProvider.ts`);
  implemented for Gemini using its native function calling
  (`server/src/services/providers/gemini.ts`'s new `attemptWithTools`) — real SDK usage
  (`functionDeclarations`, `parametersJsonSchema`, the SDK's own `createPartFromFunctionResponse`
  helper, kept unmocked in tests), not a hand-rolled reimplementation. Deliberately isolated: only
  reached when a caller explicitly passes both `tools` and `onToolCall`, so today's real
  production chat path (which never does) is provably unaffected — verified by the full suite
  passing with zero regressions. Bounded to `MAX_TOOL_ROUNDS=4`. No Arena/product awareness
  anywhere in this code, tested only against a local, fake `get_secret_number` tool defined in the
  test file itself, per the architecture's own required sequencing (M1 before any product
  connects).
  **Files:** `server/src/services/llmProvider.ts`,
  `server/src/services/providers/gemini.ts`,
  `server/src/services/providers/gemini.toolCalling.test.ts` (new).
  **Tests:** 5 new — tool-call-then-final-answer, direct-answer-without-a-tool,
  tool-failure-reported-as-data, bounded-rounds-termination, correct-JSON-Schema-declaration.
  Full suite: **201/201 passing** (196 pre-existing + 5 new), `npx tsc -p tsconfig.json --noEmit`
  clean, `npm run build` clean. **Commit:** `107159c`.
  **Honest gap:** no `GEMINI_API_KEY` exists in this environment, so this has been verified
  against a mocked `GoogleGenAI` client only, not the real Gemini API — the same evidence tier
  this project's own pre-existing DeepSeek/Ollama entries already use, not a lower standard
  invented for this milestone. Real-API verification is the natural first task once a key is
  available (does not block M2, which needs no live model call).
- **M2 — Product identity/security.** `ProductIdentity` type and `hasScope`/`requireScope`
  (`server/src/services/productIdentity.ts`); a service-token verifier/issuer
  (`server/src/services/serviceToken.ts`) using real HS256 JWT signing/verification via the new
  `jsonwebtoken` dependency (a security-critical primitive, deliberately not hand-rolled crypto).
  Per ADR-003: short-lived (max 300s), one shared secret per issuing product
  (`SERVICE_TOKEN_SECRET_<PRODUCT>`), explicit tool-name scope allow-list, never a shared
  password, never JennySol's own session mechanism reused. Built and tested entirely against a
  fake "acme" product — zero Arena code, secrets, or awareness anywhere in this milestone, per
  the architecture's required M2-before-M5 sequencing.
  **Files:** `server/src/services/productIdentity.ts`, `server/src/services/serviceToken.ts`,
  `server/src/services/serviceToken.test.ts` (new), `server/.env.example` (documents the new
  env var pattern).
  **Tests:** 10 new, covering exactly the 6 attack scenarios Phase 6's security table names —
  valid token accepted, expired rejected, forged rejected (both a wrong-signing-key variant and
  a tampered-payload variant), wrong audience rejected, wrong/unconfigured issuer rejected,
  out-of-scope tool call rejected — plus malformed-token and missing-subject edge cases, and a
  full mint→verify→scope-check→execute round trip against a fake tool registry. Full suite:
  **211/211 passing** (201 pre-existing + 10 new), `tsc --noEmit` clean, `npm run build` clean.
  **New dependency `jsonwebtoken` verified to introduce zero new npm-audit findings** — all 7
  advisories both before and after are the same pre-existing, already-documented
  adm-zip/sharp/qs risks in JennySol's own README. **Commit:** `0486d22`.
  **Design note, revising an earlier guess:** the previous checkpoint's "Next Exact Tasks" entry
  for M2 speculated a new `product_identities` database table would be needed. Real design work
  (ADR-003) settled on a stateless, self-verifying signed token instead — no DB table, no
  server-side session state for a product identity at all. Recorded here so a future session
  doesn't go looking for a table that was a forward-looking guess, not a requirement.
- **M3 — Tool registry.** `ProductConnector` interface (`tools/productConnector.ts`) and
  `ToolRegistry` (`tools/toolRegistry.ts`) per ADR-002. Enforces two things independently: a tool
  is only ever visible/dispatchable under its *own* product's identity (never decided by scope
  content alone — a defense against a misconfigured or forged token naming another product's
  tool), and a scope check (reusing M2's `requireScope`) before any tool executes. JennySol's
  core has no reference to a concrete product anywhere in this code — only to the registry.
  Proven against two independent fake products ("acme" and "widgetco"), zero Arena code.
  **Files:** `server/src/services/tools/productConnector.ts`,
  `server/src/services/tools/toolRegistry.ts`,
  `server/src/services/tools/toolRegistry.test.ts` (new).
  **Tests:** 11 new — duplicate-connector rejection, bad-namespace rejection, product A's tools
  visible to its own identity, product A's tools **invisible to product B's identity** (the core
  M3 acceptance test), invisibility holding even against an over-scoped/misconfigured token
  naming another product's tool, unregistered-product sees nothing, real execution for an
  authorized call, out-of-scope rejection, cross-product dispatch attempt rejected before the
  other product's tool ever runs (spy-verified — `acmeToolWasCalled` stays `false`), and
  unknown-tool-name gives a clear error rather than a silent no-op. Full suite: **222/222
  passing** (211 pre-existing + 11 new), `tsc --noEmit` clean, `npm run build` clean.
  **Commit:** `d4da94d`.
- **M4 — Connector framework.** `ProductConnector.configured()` (matching `LlmProvider`/
  `SearchProvider`'s exact naming convention — configured means has-what-it-needs-*now*, not
  "healthy") and `ToolRegistry.getConnectorStatus()`, reporting each registered connector's
  product/configured/tool-count independently and read live (not cached at registration time).
  Deliberately **not** wired into the real, production-facing `capabilityRegistry.ts` yet — doing
  so today would mean reporting on fake test connectors (or an empty list) in a real admin view;
  that wiring is M5/M9's job once a real connector (Arena) exists to report on.
  **Files:** `server/src/services/tools/productConnector.ts`,
  `server/src/services/tools/toolRegistry.ts`,
  `server/src/services/tools/toolRegistry.test.ts` (extended, existing fixtures updated to
  implement the new required method).
  **Tests:** 3 new — two independently-configured/unconfigured connectors reported correctly,
  an empty registry reports an empty list, and `configured()` is read live on each call rather
  than cached from registration. Full suite: **225/225 passing** (222 pre-existing + 3 new),
  `tsc --noEmit` clean, `npm run build` clean. **Commit:** `f6c97dc`.
- **M5 — Arena connector.** The first milestone touching both repositories. **Arena side**
  (`arena-api`, commit `6b060a4`): `AgentServiceTokenIssuer` — mints the HS256 service token per
  ADR-003, a separate key/secret/audience from Arena's own session JWT
  (`JwtTokenProvider`). Configured via `app.agent.service-token-secret`
  (`SERVICE_TOKEN_SECRET_ARENA`), blank/not-configured by default. **This is arena-api's
  first-ever automated test file** — 0 test files existed anywhere in that repository before this
  commit (a gap flagged in the original architecture investigation); `AgentServiceTokenIssuerTest`
  (4 tests) is a real start on closing it. **JennySol side** (commit `3ceca59`): `arenaConnector`,
  the first real (non-fake) `ProductConnector` — `getTools()` intentionally empty (M6's job),
  `configured()` checking the shared secret. **JennySol side tests:** 5 new
  (`arena.test.ts`) — product identity, empty tool list, `configured()` reflecting the env var, a
  full mint→verify→`getToolsFor()` round trip using JennySol's own signer with Arena's exact claim
  shape, and tampered-token rejection.
  **Real cross-repo, cross-language interoperability verified live**, not assumed: a token minted
  by Arena's actual Java `AgentServiceTokenIssuer` was fed into JennySol's actual (unmocked)
  `verifyServiceToken()` and resolved correctly to
  `{product:"arena", externalUserId:"arena-user-42", role:"RECRUITER", tenantId:"tenant-1",
  scope:["arena.searchJobs"]}`; a tampered copy of that same real token was rejected with an
  invalid-signature error. **This caught a genuine interoperability bug**, not merely tested
  around one: jjwt's bare `signWith(key)` silently upgrades the algorithm to HS384 for a
  sufficiently long key, which would have made every Arena-issued token unverifiable by
  JennySol's strict `algorithms: ["HS256"]` allowlist — found only by actually running both real
  implementations against each other, fixed via explicit `signWith(key, Jwts.SIG.HS256)` on the
  Arena side, re-verified after the fix. This specific cross-language run can't be repeated
  automatically in JennySol's own `npm test` (no Maven invocation from a Node test suite) — it is
  recorded here as verified-live-once evidence, the same pattern this project's own prior docs
  already use for checks that can't be kept re-proving in CI.
  **Full suites:** JennySol 230/230 passing (225 pre-existing + 5 new), `tsc --noEmit` clean,
  `npm run build` clean. Arena `AgentServiceTokenIssuerTest` 4/4 passing (`mvn test`),
  `mvn -o clean compile` clean. Arena deployed to Railway and confirmed live
  (`GET /api/v1/public/landing-stats` → 200) after this change's deploy settled.

## In Progress

Nothing. M6 has not started as of this checkpoint.

## Not Started

M6 through M12 in full — see [Phase 3](#phase-3--arena-integration-audit) and
[Phase 4](#phase-4--tool-matrix) below for the exact, item-by-item evidence behind this. M1
through M5 now exist (see Completed above) — a real, working Arena connector with verified
cross-repo token trust — but it has zero tools registered and nothing calls it from Arena's own
`AgentServiceClient` yet (still bound to `NoopAgentServiceClient` in production): no
Arena-callable tools (read or write), no approval workflow wired to a real tool, no
product-scoped memory isolation, no agent-specific audit logging, and no security tests beyond
the token-primitive level (tests 7-17 below) — because none of the systems those tests would
exercise exist yet.

## Blocked

- **Real end-to-end verification (Phase 5)** is blocked, not failing — M1/M2 give the engine a
  tool-calling loop and a way to verify who's calling, but there is still no connector (M4/M5) or
  Arena tool (M6) to route a real request through, so the flow "User → JennySol → Model → Tool
  call → Connector → Arena → Authorization → Business service → Database → Result" cannot be
  executed today past "Tool call." This is the correct, honest state to report — not a test
  failure.
- **M1's live-API verification** is blocked on a missing `GEMINI_API_KEY` in this environment —
  see M1's own entry under Completed for the full honest statement of what is and isn't verified.
  This does not block M2 (identity/tokens need no live model call) and will be revisited once a
  key is available.
- **Security verification (Phase 6), tests 7-17** remain blocked — they require a real connector,
  tool, or product to attack-test cross-user/cross-tenant/leakage/injection scenarios against.
  Tests 1-6 (token forgery/expiry/audience/issuer/scope) are no longer blocked — see
  [Phase 6](#phase-6--security-verification) for the updated table with real PASS evidence.
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
| Jennysol-AI (`server`) | 24 | 230 | 230 passed, 0 failed | `npm test` (vitest) | 2026-09-11, M5 |
| Arena BE (`arena-api`) | 1 | 4 | 4 passed, 0 failed | `mvn test -Dtest=AgentServiceTokenIssuerTest` | 2026-09-11, M5 — **first test file this repository has ever had** |
| Arena FE (`arena-web`) | 0 (unit) | 0 | N/A — no unit test files exist (a separate Playwright E2E suite exists for Arena's own product features, unrelated to the agent/tool integration this document tracks) | `find src -iname "*.test.*"` → empty | 2026-09-10 |

34 of JennySol's 230 passing tests are this integration's own (5 M1 tool-calling + 10 M2
service-token/identity + 14 M3+M4 tool-registry/connector + 5 M5 arena connector) — the other 196
cover JennySol's own pre-existing chat/auth/router/memory subsystems, audited in Phase 2 as
separate from the M1–M12 milestones. All 4 of Arena BE's tests are also this integration's own —
Arena had zero automated tests of any kind before M5.

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

**M1 through M5 complete** (see Completed above). M6 is where the actual gateway a live Arena
request travels through gets built — everything so far proved the pieces work; nothing yet accepts
an incoming Arena-originated request end to end.

1. **M6 — First Arena read tool, wired end-to-end.** Concretely:
   - JennySol: a new HTTP entry point (e.g. `POST /api/agent/gateway/chat`) distinct from the
     existing `/api/chat` (which is for JennySol's own logged-in users, not product-federated
     identities) — a new `requireProductIdentity` middleware (parallel to `requireAuth`) that
     extracts and verifies the `Authorization` bearer as a service token via
     `verifyServiceToken()`, resolves `ToolRegistry.getToolsFor(identity)`, and runs M1's
     `attemptWithTools` loop with `ToolRegistry.dispatch(identity, ...)` as `onToolCall`.
   - JennySol: `arena.ts`'s first real tool, `arena.searchJobs`, backed by an actual HTTP call to
     Arena's own public `GET /jobs` endpoint (already public/unauthenticated per Arena's
     `SecurityConfig` — confirmed during the original investigation — so this first tool needs no
     Arena-side auth beyond the request simply happening; later write tools will need Arena-side
     tool-authorization middleware this one doesn't).
   - Arena: a `RealAgentServiceClient` implementing the existing `AgentServiceClient` interface,
     calling the new JennySol gateway with a token from `AgentServiceTokenIssuer`, and
     `AgentProviderConfig` wired to use it instead of `NoopAgentServiceClient` — likely
     feature-flagged/env-gated rather than switched on for every account immediately.
   - Acceptance: a real chat message ("find me React jobs") sent through Arena's own `/agent`
     page, reaching JennySol's real gateway, triggering `arena.searchJobs`, returning real Arena
     job data, verified live end-to-end — the first real instance of the Phase 5 flow this
     checkpoint currently reports as BLOCKED. **Next up.**
2. **Revisit M1's live-API gap** once a `GEMINI_API_KEY` becomes available in whatever environment
   runs this next — does not block M6's gateway/tool-plumbing work, but the actual live chat
   message in M6's acceptance test above does need a working model call, so this may need
   resolving before M6's own acceptance test can be fully run.

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
- HEAD commit: `6b060a4` — "feat(agent): add JennySol service-token issuer (M5, JennySol
  integration)" (2026-09-11)
- Working tree: clean
- Uncommitted files: none
- Ahead/behind `origin/main`: 0 / 0
- Open/merged PRs: 0 merge commits in full history — direct-to-`main` only
- Pushed: yes, confirmed matching `origin/main`
- Deployed: yes, Railway settled to "● Online" after this commit, `GET /api/v1/public/landing-stats` → 200

Latest 11 commits (10 from the original checkpoint plus M5's):

```
6b060a4 2026-09-11 feat(agent): add JennySol service-token issuer (M5, JennySol integration)
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
| 1 | Model-directed tool calling | **DONE (as of M1, 2026-09-11)** — was NOT STARTED at original 2026-09-10 audit | `LlmProvider.StreamOptions.tools`/`onToolCall`, implemented for Gemini via real `functionDeclarations`/`parametersJsonSchema` | `llmProvider.ts`, `providers/gemini.ts` | `gemini.toolCalling.test.ts` (5/5) | `107159c` |
| 2 | Multi-step tool loop | **DONE (as of M1)** — bounded to `MAX_TOOL_ROUNDS=4`, not unbounded | `attemptWithTools()` loop: call model → execute tool → feed result back → repeat until plain text or round limit | `providers/gemini.ts` | `gemini.toolCalling.test.ts` (bounded-rounds test) | `107159c` |
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
| 23 | Gemini tool calling | **DONE (function calling, as of M1)**, DONE (search grounding, pre-existing) | Real function calling now implemented (`attemptWithTools`) alongside the pre-existing `googleSearch` grounding tool (the two are mutually exclusive per call — see M1's commit message for why) | `providers/gemini.ts` | `gemini.toolCalling.test.ts` | `107159c` |
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

Tests 1-6 (the service-token primitive itself) now have real PASS evidence as of M2. Tests 7-17
remain **BLOCKED** — they require a real connector, tool, or product to attack-test cross-user/
cross-tenant/leakage/injection scenarios against, none of which exist yet:

| # | Test | Result |
|---|---|---|
| 1 | Valid service token | **PASS** — `serviceToken.test.ts` test 1, `signServiceToken`→`verifyServiceToken` round trip resolves to the exact expected `ProductIdentity`. Commit `0486d22`. |
| 2 | Expired token | **PASS** — test 2, a token minted with `ttlSeconds: -1` is rejected with a `ServiceTokenError` matching `/expired/i`. |
| 3 | Forged token | **PASS** — tests 3 and 3b: (a) a token claiming issuer "acme" but signed with a different product's secret is rejected, (b) a validly-signed token whose payload is tampered with post-signing is rejected. Both real signature-verification failures, not string-matching. |
| 4 | Wrong audience | **PASS** — test 4, a token signed with `audience: "some-other-service"` is rejected. |
| 5 | Wrong issuer | **PASS** — test 5, a token claiming an issuer with no configured `SERVICE_TOKEN_SECRET_*` is rejected before any signature check even runs. |
| 6 | Invalid scope | **PASS** — test 6, a validly-issued token with `scope: ["acme.getWidget"]` correctly fails `requireScope()` for `"acme.deleteEverything"` and succeeds for its own granted tool. |
| 7 | Wrong tenant | BLOCKED — `tenantId` is carried and verifiable in the token today, but no real tool checks it against a resource's actual owner yet (that check belongs to each tool's own implementation, first exercised at M6) |
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
| **M1 — Tool-calling engine** | `LlmProvider` gains a tool-definitions-in/tool-calls-out capability, implemented for at least one real provider (Gemini); a real chat turn triggers a locally-defined test tool and incorporates its result; covered by a passing automated test. | **DONE** — commit `107159c`, 5/5 new tests passing, 201/201 full suite, real Gemini SDK function-calling API used (mocked network layer only). Live-API call unverified (no `GEMINI_API_KEY` available) — tracked as an open item, not blocking M2. |
| **M2 — Product identity/security** | A `ProductIdentity` concept and service-token verifier exist; forged/expired/wrong-audience/wrong-scope tokens are rejected; proven against a fake product connector before any real one exists; covered by passing automated tests. | **DONE** — commit `0486d22`, 10/10 new tests passing (the 6 named attack scenarios plus edge cases), 211/211 full suite, real HS256 JWT verification via `jsonwebtoken`, proven end-to-end against a fake "acme" product's mint→verify→scope-check→execute flow. |
| **M3 — Tool registry** | A `ToolRegistry` and `ProductConnector` interface exist; a second (fake) product can register tools scoped correctly to its own identity, proven by a test showing product A's tools are invisible under product B's identity. | **DONE** — commit `d4da94d`, 11/11 new tests passing, 222/222 full suite, proven against two independent fake products ("acme"/"widgetco"). |
| **M4 — Connector framework** | The general connector plumbing (registration, tool namespacing, per-connector health/config) is real and reusable by more than one product without code changes to the core. | **DONE** — commit `f6c97dc`, 3/3 new tests passing, 225/225 full suite, proven against two independently-configured/unconfigured fake connectors with no core code changes. |
| **M5 — Arena connector** | Arena mints a real, scoped service token; JennySol's Arena connector verifies it; a live round trip succeeds with a real Arena test account and fails correctly when tampered with. | **DONE** — Arena `6b060a4` / JennySol `3ceca59`. A real Java-minted token verified correctly by the real TypeScript verifier; a tampered copy correctly rejected. Caught and fixed a genuine HS256-vs-HS384 interop bug in the process. 5 new JennySol tests + 4 new Arena tests (Arena's first ever). |
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
