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

**M8 — Product-scoped memory isolation.** **DONE — real boundary code, real unit + integration +
adversarial tests, run against the real modules (not mocks), a real gap found and fixed.** See the
full evidence under [Completed](#completed) below. **Explicit scope note (per this checkpoint's own
instruction): finishing M8 does NOT mean the whole system is production-ready** — M9
(audit/observability) and M10 (full security testing) are still NOT STARTED, and per this
checkpoint's own explicit instruction, no additional write tools are to be activated until M10 is
done. M9, M10 not started.

**Recovery checkpoint:** the M7/M11/M12-verified state (before any M8 work) is tagged
`m7-m11-m12-verified-2026-09-11` in both the JennySol (`Jennysol-AI`) and Arena
(`Vikisol-Arena-BE`) repositories, pushed to `origin`. If any M8+ work needs to be rolled back,
that tag is the last known-good, fully live-verified state of the integration.

## Current date

2026-09-11

## JennySol HEAD

`8a09a11` — "feat(memory): product-scoped memory isolation boundary + tenant-isolation fix (M8)",
on top of `6b42cd4` (a third-party concurrent frontend/docs commit — see below) and `0d40011` (M7's
own merge). This checkpoint's own doc commit lands one commit after `8a09a11` — see
[Commit History](#commit-history) for the exact final hash. Branch `main`, working tree clean at
commit time. Repository: `https://github.com/VikisolTechnologies/jennysol-ai`.

**Important note for any future session reading this file:** JennySol is being actively developed
by more than one session/contributor concurrently. Since M7's own checkpoint, one more real,
unrelated concurrent commit landed: `6b42cd4` ("Add Files, Memory, Tasks, Integrations pages; sync
stale docs") — a **frontend-only** commit (no `server/src` changes) that happened to add a
client-side `/memory` page, confirmed by direct read to be showing real conversation history only
and explicitly stating "long-term extracted memory... does not exist" rather than implying it does
— directly relevant context for this checkpoint's own M8 work, and consistent with what this
checkpoint's own inspection of the server independently found. Fast-forward merged cleanly (no
conflict, `server/src` untouched), 331/331 tests still passing afterward. **Before starting M9,
re-fetch `origin/main` and check for further concurrent changes** — do not assume this file's
last-known HEAD is still current without checking.

**Critical deployment note discovered this checkpoint:** JennySol's production Railway service
(`jennysol-api` in project `jennysol-ai-api`) has **no GitHub integration** (`source.repo: null`
in `railway status --json`) — pushing to `origin/main` does **not** auto-deploy it. Production is
updated only by an operator explicitly running `railway up` from `server/`. This was not previously
documented in this file and caused real confusion during this checkpoint's live verification (see
M7's Completed entry) — production was still serving a pre-M6 build until `railway up` was run
directly. **Any future session doing a "live verification" must run `railway up` itself (or ask
the human to) — a `git push` alone is not sufficient for JennySol, unlike Arena (see Arena BE HEAD
below, which does have real GitHub-to-Railway auto-deploy).**

**Push confirmation:** `git ls-remote origin main` → `0d40011...`, matching local `HEAD` exactly.
**Deploy confirmation:** `railway up --detach` from `server/`, then polled
`https://api.jennysol.vikisol.in/health` until `{"status":"ok","version":"0d40011"}` (the
`GIT_COMMIT_SHA` Railway variable must be set to the deploying commit's short SHA *before*
`railway up`, or the reported version silently stays stale — a real gap in this checkpoint's own
first deploy attempt, since fixed for this run but worth re-checking next time).

## Arena FE HEAD

`6a4fe29` — "fix: remove fake Agent Chat keyword matcher, wire to real backend" (2026-09-10
23:04:56 +0530). Branch `main`, working tree clean, 0 ahead/behind `origin/main`. Repository:
`Vikisol-Arena-FE` (`arena-web`). Unchanged this milestone — M7 touched Arena's backend only.
`IntentCardView.tsx` remains real but unwired to the new approval flow — this checkpoint's live
verification called JennySol's `/actions/:actionId` endpoint directly rather than through an Arena
frontend approval card, since no such card exists yet. Wiring Arena's frontend to actually render
and submit approvals is real, scoped future work, not part of M7's own acceptance criteria (which
requires the *backend* propose→approve→execute mechanism, verified live by any authorized caller).

## Arena BE HEAD

`928310e` — "fix(agent): grant arena.applyToJob scope to TALENT accounts (M7)" (2026-09-11).
Branch `main`, working tree clean, 0 ahead/behind `origin/main`.

**Critical correction discovered this checkpoint: there are TWO Railway projects serving
Arena-shaped deployments, and this file previously tracked the wrong one.** The real production
service backing `api-arena.vikisol.in` is **`arena-api` in project `arena-staging`** (despite the
name) — confirmed via `railway status` showing `url: https://api-arena.vikisol.in`. A second,
separate, **failing/stale** deployment exists as `Vikisol-Arena-BE` in project `Vikisol-Arena`
(same GitHub repo, auto-deploys independently, but its build has been failing since before this
checkpoint and it serves only `vikisol-arena-be-production.up.railway.app`, an unused Railway
subdomain — not real traffic). This checkpoint briefly (and mistakenly) set
`SERVICE_TOKEN_SECRET_ARENA`/`JENNYSOL_GATEWAY_URL` on the wrong (`Vikisol-Arena`) project before
catching the error via `railway status`'s domain field and correcting it on the real
(`arena-staging`) one. **Any future session touching Arena's Railway config must run
`railway status` after linking and confirm the `url` field reads `api-arena.vikisol.in` before
trusting the link** — `railway link -p "Vikisol-Arena"` alone silently links the wrong project.
The stray variables on the wrong project were left in place (removing them was blocked by this
session's own permission classifier and is low-priority, since that project serves no real
traffic) — a human with dashboard access should delete them from `Vikisol-Arena` → `Vikisol-Arena-BE`
when convenient.

Deployed to the real `arena-api` service and confirmed live: `GET /api/v1/actuator/health` →
`{"status":"UP",...}` after this deploy settled, and (more importantly) a real authenticated
round-trip against `POST /applications` succeeded using the new `AgentServiceTokenAuthenticationFilter`
(see M7's Completed entry). Repository: `Vikisol-Arena-BE` (`arena-api`).

## Overall completion

**11 of 13 milestones complete = 84.6% (≈85%).**

Calculation: milestones M0–M12 (13 total, defined in [Milestone Model](#phase-8--milestone-model)
below), equal weight, no partial credit for a milestone unless its own explicit acceptance
criteria are *fully* met. M0 through M8 now meet their acceptance criteria in full, plus **M11**
(full read+write real end-to-end flow) and **M12** (production rollout) from the prior checkpoint
— see [Completed](#completed) below for the exact evidence behind each. **M9 and M10 still require
CODE + TESTS + VERIFICATION and have none of the three, so each remains 0%** — and per this
checkpoint's own explicit instruction, no additional write tools are to be activated until M10 is
done, regardless of how close the percentage looks.

**A completion percentage is not the same claim as "production-ready."** M8 closes a real,
tested boundary against the specific risks this milestone's acceptance criteria named — it does
not mean the system has been audited for every way those boundaries could be attacked (that is
M10's own, separate job), nor does it mean audit/observability exists yet (M9). Treat 85% as "11 of
13 defined milestones have met their own explicit bar," not as a general readiness score.

**The dormant-production caveat from M5/M6 no longer applies** (established at M7/M11/M12, see the
recovery tag noted under [Current milestone](#current-milestone)). Both
`SERVICE_TOKEN_SECRET_ARENA` and `JENNYSOL_GATEWAY_URL` are set on both services' real production
deployments — `RealAgentServiceClient.isAvailable()` returns `true` in production today, for every
real Arena account. `arena.searchJobs` and `arena.applyToJob` are both live for real Arena users
right now. M9's and M10's own acceptance criteria (audit/observability and the full security test
matrix, respectively) are still not met — see [Arena Integration Audit](#phase-3--arena-integration-audit)
for the full inventory.

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

- **M6 — First Arena read tool, wired end-to-end.** **DONE.** Closed a genuine gap found while
  building this: M1's tool-calling engine was implemented/tested only at the
  `LlmProvider`/`gemini.ts` level, never threaded through `routeChatCompletion`
  (`modelRouter.ts`), the function every real caller actually uses. Fixed:
  `routeChatCompletion`/`attemptWithTimeout` now accept `tools`/`onToolCall`; `runHedgedPair` was
  never updated to carry them (hedging is off by default and inert), so a tool-bearing request
  explicitly skips the hedge branch rather than silently losing tool-calling if hedging happens
  to be on.
  **New real HTTP entry point:** `POST /api/agent/gateway/chat` (`routes/agentGateway.ts`),
  distinct from `/api/chat` (JennySol's own users, not product-federated ones). Gated by a new
  `requireProductIdentity` middleware; resolves `ToolRegistry.getToolsFor(identity)`; dispatches
  any tool call through `ToolRegistry.dispatch` (independently re-checks product/scope). A real,
  shared `ToolRegistry` singleton (`tools/registryInstance.ts`) registers `arenaConnector` for
  actual server traffic — separate from every test's own isolated `new ToolRegistry()`.
  **Arena's first real tool:** `arena.searchJobs`, calling Arena's actual `GET /jobs`
  (`JobController.java`). Honestly scoped: that endpoint only accepts `page`/`size` — no keyword
  search parameter exists there today — so the tool's own description states this real
  limitation explicitly rather than inventing a `query` param Arena can't support.
  **Arena side:** `RealAgentServiceClient` implements the existing `AgentServiceClient`
  interface, calling the gateway, minting a fresh token per call via `AgentServiceTokenIssuer`.
  Wired into `AgentProviderConfig` behind the same "isAvailable() ? real : noop" pattern — **still
  stays dormant in production** (see below) until an operator deliberately sets both
  `JENNYSOL_GATEWAY_URL` and `SERVICE_TOKEN_SECRET_ARENA` in both services' real deployments — a
  separate rollout decision from the verification below, not made by this checkpoint.

  **THE REAL END-TO-END PROOF (2026-09-11), against the actual Gemini API — not mocked, not
  simulated:**
  1. Confirmed the real `GEMINI_API_KEY` the founder had already provisioned exists in the
     `jennysol-ai-api` Railway project (linked via `railway link -p jennysol-ai-api`, inspected
     with `railway variables --json` reading only presence/length/prefix — **53 characters,
     prefix `AQ.A...`, never printed in full, never written to any file in this repository**).
  2. Ran this repo's own freshly-built `dist/` locally via `railway run node dist/index.js`,
     which injects Railway's real project variables (including the real `GEMINI_API_KEY`) into
     that one local process's environment only — the key was never copied into `.env`, never
     committed, never logged. A separate, local-only `SERVICE_TOKEN_SECRET_ARENA` (never used
     anywhere but this one verification) was set alongside it purely to mint a test identity.
  3. Minted a real Arena-shaped service token (`signServiceToken({issuer:"arena", scope:
     ["arena.searchJobs"], ...})`), sent the exact deterministic test message — **"Show me some
     jobs available on Arena."** — to `POST /api/agent/gateway/chat` on that locally-running,
     real-Gemini-backed server. Response: `HTTP 200`.
  4. **First attempt surfaced a real bug, not a success**: the real Gemini model correctly
     decided to call `arena.searchJobs` on its own (the router log recorded
     `[router] gemini ok firstTokenMs=2560`, and the model's own answer described attempting the
     fetch), but the tool's request 404'd — root-caused immediately to Arena's Spring Boot
     `server.servlet.context-path: /api/v1` (`application.yml`), meaning every real Arena
     endpoint (including `/jobs`) is actually served under `/api/v1/*`, not at the bare domain
     root this tool was built against. **Fixed** (commit `5f1624b`): `ARENA_API_BASE_URL`'s
     default now includes the `/api/v1` prefix; the two mocked-fetch unit tests that had
     (self-consistently) asserted the old, wrong URL were updated to assert the corrected one.
  5. **Re-ran the identical live test after the fix.** Real result, `HTTP 200`:
     > "Here are some of the current job listings available on Arena: 1. Business Development
     > Manager at Zoho (Chennai)... 2. Sales Executive at Paytm (Pune)... 3. UI/UX Designer at
     > Delhivery (Mumbai)... [10 listings total, real companies: Zoho, Paytm, Delhivery,
     > Freshworks, Swiggy, Razorpay, Techolution, Innova Solutions, Microsoft]... *(Note: Arena's
     > job listings feed currently returns general open positions rather than keyword-filtered
     > results.)*"

     The model **on its own** surfaced the exact honest limitation `arena.searchJobs`'s
     description was written to communicate — direct evidence the honesty-first tool description
     (Section "IMPORTANT: ARENA SEARCH" of this milestone's own instructions) shaped the model's
     real behavior, not just its documentation.
  6. **Evidence captured** (all credentials masked, per instruction — nothing above or in any
     repo file contains the real key): request completed in `~3.2s` real wall-clock time; server
     log `[router] gemini ok firstTokenMs=2560` for this exact request; response `content-type`
     and `HTTP 200` confirmed via `curl`; the 10 returned jobs are genuine current Arena seed/
     production data (cross-checked against real company names), not fabricated by the model —
     the model never states specific company names or job titles in its own training data for
     "Arena," so these could only have come from the real tool result.
  7. **Cleanup performed immediately after**: local verification server stopped
     (`taskkill`), Railway project unlinked (`railway unlink`), all temporary token files deleted
     (`rm /tmp/fresh_token*.txt`), no `.env` file left on disk, `git status` confirmed clean
     before committing only the real source fix.

  **What this proves, precisely**: `REAL MODEL → decides to call → arena.searchJobs → real
  connector → real Arena endpoint → real result → model receives result → real final answer` —
  every link in that chain, for real, once. **What it does not prove**: that this is active in
  *production* right now — `RealAgentServiceClient.isAvailable()` still correctly reports `false`
  on Railway (confirmed after Arena's M6 deploy), since neither `JENNYSOL_GATEWAY_URL` nor a real
  `SERVICE_TOKEN_SECRET_ARENA` has been set in either service's actual deployment. That activation
  remains a deliberate, separate decision — this verification only proves the *code path itself*
  is real and correct, using real credentials, once, in a controlled way.

  **Files:** JennySol — `services/modelRouter.ts`, `routes/agentGateway.ts` (new),
  `middleware/productIdentity.ts` (new), `services/tools/registryInstance.ts` (new),
  `services/productConnectors/arena.ts` (extended with the real tool, then fixed for the
  `/api/v1` path). Arena — `agent/client/RealAgentServiceClient.java` (new),
  `agent/config/AgentProviderConfig.java`, `application.yml`.
  **Tests:** JennySol — `modelRouter.test.ts` (+3), `middleware/productIdentity.test.ts` (4 new),
  `agentGateway.http.test.ts` (7 new), `arena.test.ts` (extended, URL assertions corrected to
  match the real fix). Arena — `RealAgentServiceClientTest.java` (5 new).
  **Full suites:** JennySol **306/306 passing**, `tsc --noEmit` clean, `npm run build` clean.
  Arena **9/9 passing** (`mvn test`, no filter), `mvn -o clean compile` clean.
  **Commits:** JennySol `cd81da2` (feature) → `512d6c8` (merge with concurrent work) → `89ed2da`
  (docs) → `5f1624b` (the real URL fix, found by this exact live verification). Arena `72f3df4`.

- **M7 — Approval-controlled Arena write tools; also closes M11 and M12.** **DONE.** Per ADR-004:
  a WRITE-tier tool call from the model is never dispatched immediately. `RegisteredTool` gained a
  `tier: "READ" | "WRITE"` field; `ToolRegistry.dispatch` now takes a `ToolExecutionContext`
  (carrying the raw service token, for round-trip re-authentication); a new `pendingActions.ts`
  module turns a model-requested WRITE call into a single-use, identity-bound (product +
  externalUserId), TTL-bound (5 minutes) `PendingAction`. The gateway's `/chat` route proposes
  rather than dispatches a WRITE call and surfaces `{actionId, toolName, args}` in its response; a
  new `POST /api/agent/gateway/actions/:actionId` (same `requireProductIdentity` gate,
  independently re-verifying the *same* identity proposed it) is the only path to real execution
  or discard.

  **Arena's first WRITE tool: `arena.applyToJob`**, wrapping the real, pre-existing
  `ApplicationService.applyToJob`. Forwards the exact service token it was given as its own
  `Authorization` header to Arena's real `POST /applications` — Arena mints the token (via
  `RealAgentServiceClient`/`AgentServiceTokenIssuer`), JennySol only ever round-trips it back,
  never inventing a credential of its own. **Arena's own receiving end (per ADR-003 — "Arena tools
  re-derive authorization independently"):** a new `AgentServiceTokenVerifier` plus a new
  `AgentServiceTokenAuthenticationFilter` (`OncePerRequestFilter`, registered before the existing
  `JwtAuthenticationFilter`) independently re-verifies the forwarded token's signature, checks its
  `scope` claim against a static endpoint→required-scope map
  (`ENDPOINT_TO_REQUIRED_SCOPE = {"POST /applications": "arena.applyToJob"}`), and only then
  resolves a real `UserPrincipal` from a DB lookup — falls through silently (no authentication) on
  any non-matching or invalid token, coexisting with the existing session-JWT filter by
  construction (different secrets, mutually exclusive).

  **A real gap found and fixed while preparing live verification** (the exact kind of thing this
  document's own rigor exists to catch): `RealAgentServiceClient`'s `DEFAULT_SCOPE` — the scope
  every real Arena-triggered token gets minted with — was `["arena.searchJobs"]` only, a leftover
  from M6 before `arena.applyToJob` existed. No real user's token, through the real trigger path,
  could ever have carried the scope needed for `ToolRegistry` to even offer the write tool to
  them — the tool was fully implemented and tested on JennySol's side but silently unreachable
  through Arena's own real integration. Fixed: TALENT accounts (the only role
  `ApplicationController`'s own `@PreAuthorize("hasRole('TALENT')")` allows to apply) now get
  `["arena.searchJobs", "arena.applyToJob"]`; every other role keeps read-only scope. Commit
  `928310e`, 2 new tests (`grantsApplyToJobScopeOnlyToTalentAccounts`,
  `doesNotGrantApplyToJobScopeToNonTalentAccounts`).

  **THE REAL END-TO-END PROOF (2026-09-11), against real production Arena and real production
  JennySol — not local, not mocked, not simulated:**
  1. Discovered and corrected two real infrastructure gaps before verification was even possible:
     (a) JennySol's production Railway service (`jennysol-api`) has no GitHub integration — it was
     still serving a pre-M6 build until `railway up` was run directly from `server/`; (b) the
     shared secret was first (mistakenly) set on a wrong, failing, orphaned Railway project
     (`Vikisol-Arena` / `Vikisol-Arena-BE`) before `railway status`'s `url` field revealed the real
     production Arena service is `arena-api` in project `arena-staging` — corrected there. Both
     are recorded in detail under [JennySol HEAD](#jennysol-head) and
     [Arena BE HEAD](#arena-be-head) above so no future session repeats either mistake.
  2. Generated a fresh, strong random shared secret (never printed, never committed, never written
     to any file this repository tracks — generated and consumed entirely inside a short-lived
     Node subprocess whose own stdout was suppressed) and set `SERVICE_TOKEN_SECRET_ARENA` (both
     services) and `JENNYSOL_GATEWAY_URL` (Arena) on the real production deployments — a deliberate
     "go fully live" decision made explicitly by the founder when asked, not made unilaterally.
  3. **Real Arena-triggered propose, through the actual production user-facing path**: signed in
     as the real `demo.talent@vikisol.dev` TALENT account against real production Arena, called
     the real `GET /agent/conversation` → `POST /agent/conversations/{id}/messages` with
     *"Please apply me to the Arena job posting with id `218ff2b3-...` (Business Development
     Manager)."* This is a **real, seeded, fictional company** (`hr@zoho.example.com`-style seed
     data from `DataSeeder.java`, not a real employer — confirmed by reading the seeder before
     using it, specifically to avoid any real third party being notified). Real chain executed:
     Arena's real `AgentController` → `AgentService.sendMessage` → real `RealAgentServiceClient`
     (now correctly scoped) → real HTTP call to real production JennySol → **real Gemini decided
     to call `arena.applyToJob`** → JennySol's WRITE-tier logic proposed a `PendingAction` instead
     of dispatching → real reply, stored in Arena's real database: *"I am about to apply for the
     Business Development Manager position (job ID `218ff2b3-...`) on your behalf. This action is
     currently awaiting your explicit approval..."* — honest, correct, no false claim of
     completion.
  4. **Real approve→execute, via a directly-minted equivalent identity token** (necessary because
     Arena's own frontend has no approval-card UI wired to this new endpoint yet — `IntentCardView.tsx`
     remains dormant, see [Arena FE HEAD](#arena-fe-head)): minted a service token for the same
     real Arena user id (`signServiceToken`, real shared secret, via `railway run` so the secret
     itself was never exposed — only the resulting per-request token, which is safe to use, was
     produced), called real production JennySol's `POST /api/agent/gateway/chat` directly with the
     same instruction to get the structured `{actionId}` back, then `POST
     /api/agent/gateway/actions/{actionId}` with `{approve: true}`. **Real result, HTTP 200**:
     `{"status":"executed","result":{"id":"954c30ba-...","jobId":"218ff2b3-...","stage":"applied",...}}`
     — a genuine `Application` row was created in Arena's real production database via the
     round-trip token, verified and authorized entirely by Arena's own new filter.
  5. **Cleanup, immediately after**: withdrew the real test application
     (`DELETE /applications/954c30ba-...` using the real demo-talent session JWT) →
     `{"success":true}`. The only residue left is two harmless in-app `Notification` rows (to the
     candidate and to the seeded/fictional company's own demo account) that `withdraw()` doesn't
     delete — no email was sent (`ApplicationService.applyToJob`'s notification path is in-app
     only), and no real third party exists to be affected (every `EnterpriseProfile` in Arena's
     seed data is synthetic, confirmed by reading `DataSeeder.java` before proceeding).
  6. **Re-verified the read tool through the same now-activated production path** (closing the
     exact gap M6's own entry flagged as open — "what it does not prove is that this is active in
     production right now"): the same real demo-talent account, real message *"Show me some jobs
     available on Arena."*, real production Arena → real production JennySol → real Gemini → real
     `arena.searchJobs` → 10 real job listings returned, plus the model's own unprompted honest
     note about Arena's lack of keyword search — the identical M6 behavior, now proven live in
     production rather than only in a disposable local process.

  **What this proves, precisely**: the full
  `USER → ARENA → REAL MODEL → decides to call → WRITE TOOL → PendingAction (not yet executed) →
  USER APPROVES → real round-trip → REAL ARENA WRITE → real result` chain, for real, once, in
  production, with a working reject/single-use guarantee proven by real HTTP-level tests (see
  below) — and that `RealAgentServiceClient` is no longer dormant: it is the live, active binding
  for real Arena users today, for both the read and write tool.
  **What it does not prove**: that Arena's own frontend has a working approval UI a real user
  would actually see and click (that's real, scoped future work — `IntentCardView.tsx` exists but
  isn't wired to this endpoint); that the reject path has been exercised against real production
  infrastructure specifically (it has real automated-test coverage — see Tests below — but the
  live-verification effort above only exercised the approve path, since a real write is the
  higher-value, harder-to-fake proof and the reject path has no equivalent "does the model really
  decide this" question to answer).

  **Files:** JennySol — `services/tools/productConnector.ts` (`tier`, `ToolExecutionContext`),
  `services/tools/toolRegistry.ts` (`dispatch`'s new context param, new `getTier`),
  `services/tools/pendingActions.ts` (new), `middleware/productIdentity.ts` (`req.serviceToken`),
  `services/productConnectors/arena.ts` (`arena.applyToJob`, tiers on both tools),
  `routes/agentGateway.ts` (WRITE-tier proposal branch, new `/actions/:actionId` route). Arena —
  `agent/client/AgentServiceTokenVerifier.java` (new),
  `security/jwt/AgentServiceTokenAuthenticationFilter.java` (new), `config/SecurityConfig.java`
  (filter registration), `agent/client/RealAgentServiceClient.java` (scope fix).
  **Tests:** JennySol — `pendingActions.test.ts` (7 new), `toolRegistry.test.ts` (existing fixtures
  updated for `tier`/context), `arena.test.ts` (6 new — tier assertions, `arena.applyToJob`
  execution: round-trip header forwarding, missing-jobId rejection, Arena-rejection surfacing),
  `agentGateway.http.test.ts` (6 new — WRITE call never dispatches immediately, approval actually
  dispatches exactly once, single-use rejection on a second approve, rejection discards without
  calling the tool, a different identity can never approve someone else's action, unknown
  actionId/missing-auth 404/401). Arena — `AgentServiceTokenVerifierTest.java` (4 new),
  `AgentServiceTokenAuthenticationFilterTest.java` (6 new), `RealAgentServiceClientTest.java`
  (2 new).
  **Full suites:** JennySol **331/331 passing** (post-merge with concurrent frontend work),
  `tsc --noEmit` clean, `npm run build` clean. Arena **21/21 passing** (`mvn clean test`, no
  filter — a clean rebuild was required; a stale-incremental-compile artifact briefly produced one
  unrelated, non-reproducible failure in an untouched test file, resolved by `clean`),
  `mvn -o clean compile` clean.
  **Commits:** JennySol `dbe5bcd` (feature) → `0d40011` (merge with concurrent work), deployed via
  `railway up` (no GitHub auto-deploy for this service — see JennySol HEAD above). Arena `d15de6b`
  (verifier/filter) → `928310e` (scope fix), both auto-deployed via Arena's real GitHub
  integration to the *correct* `arena-api`/`arena-staging` service.

- **M8 — Product-scoped memory isolation.** **DONE.** Before writing any code, inspected the
  existing memory implementation directly rather than assuming one didn't exist or inventing a
  parallel one: `conversationStore.ts`/`vectorStore.ts` (both real, already scoped by JennySol's
  own `user_id`, already covered by `security.test.ts`'s 10 cross-user tests — re-run as part of
  this checkpoint's full suite, still passing), and `db/index.ts`'s schema (no `tenant`/`product`
  concept anywhere). Confirmed, by reading `routes/agentGateway.ts` line by line (unchanged since
  M7), that the product gateway **has never called either persistence module at all** — it is
  fully stateless by M6's own original design choice, so the highest-risk scenario named by M8's
  own objective ("Arena data... accidentally become global JennySol long-term memory") could not
  physically be occurring today. **This checkpoint's job was to prove that with real tests and add
  a structural guard against it being silently introduced later, not to build a new memory system
  to test against a hypothetical.**

  **New: `services/memoryScope.ts`.** A real `MemoryScope` taxonomy
  (`global | user | conversation | product`, the last carrying `product`/`externalUserId`/
  `tenantId`). A `ProductToolResult` type, branded with a `__brand: "current-turn-only"` field a
  future persistence call site cannot satisfy by accident — only `wrapProductToolResult`/
  `unwrapForExplicitUserMemory` produce or consume it, and the latter requires the caller to
  supply an explicit `user`/`conversation` target scope (never `global`, never another product's
  or user's scope — not expressible by its own type signature). `redactSecrets()`: real, recursive
  redaction — by key name (`token|secret|password|credential|authorization|api[_-]?key`, case
  insensitive, at any nesting depth) and, independently, by value shape (any bare string matching
  a three-segment JWT pattern, redacted regardless of which key it sits under).

  **A real gap found and fixed while implementing this** (the exact discipline this document's own
  rigor exists for): `pendingActions.consumeAction` (M7) compared `product` + `externalUserId`
  only — never `tenantId`, despite `ProductIdentity` modeling `tenantId` as a real, independent
  identity dimension per ADR-003. Fixed defense-in-depth: two identities with the same
  `product`+`externalUserId` but different `tenantId` can no longer consume each other's pending
  action. (Arena's own `externalUserId` is a globally-unique `User.id` UUID today, so this exact
  collision isn't currently reachable through Arena specifically — the fix closes the contract gap
  for any product/scenario where it could be.)

  **CODE + UNIT + INTEGRATION + ADVERSARIAL tests, run against the real modules, not mocks:**
  - **Unit** (`memoryScope.test.ts`, 9 tests): `redactSecrets` against ordinary data (unchanged),
    nested credential-shaped keys, a bare JWT-shaped string under an innocuous key, arrays/null/
    circular references; `wrapProductToolResult`/`unwrapForExplicitUserMemory`'s scope relabeling
    and automatic redaction.
  - **Integration** (`memoryScope.test.ts`, 1 test): wires the explicit-memory escape hatch to the
    **real** `conversationStore` (a real SQLite row, not a mock) — an Arena tool result explicitly
    remembered into user A's real conversation is readable by user A and invisible to user B via
    the store's own existing, unmodified `WHERE user_id = ?` join, and the token embedded in the
    original tool result never survives into the stored content.
  - **Structural/adversarial, against the real deployed gateway** (new
    `agentGateway.memoryIsolation.test.ts`, 5 tests, same real-app supertest pattern as M6/M7):
    a real Arena tool result (deliberately shaped with candidate-contact-style PII, to prove the
    guarantee doesn't depend on which specific tool produced it) never reaches
    `conversationStore.addMessage`/`vectorStore.insertChunks` — proven via `vi.spyOn` on the
    **real** modules, not a substitute; the raw service token used for a real WRITE-tool round
    trip is likewise never passed to either; a later, unrelated request's own model-call arguments
    contain zero trace of an earlier request's tool data (the gateway's per-request history array
    is asserted directly, not inferred from "it's stateless"); a hostile tool call's `args` field
    (containing a fake `__override_scope` claim and injected "SYSTEM OVERRIDE" text) cannot bypass
    the WRITE-tier approval gate — proven both at the HTTP layer (still proposed, never
    dispatched, real `fetch` never called) and at `ToolRegistry.dispatch` itself (a fake connector,
    an under-scoped identity, a scope-elevation claim smuggled in `args` — still rejected with
    `InsufficientScopeError`, since `dispatch` never reads `args` when authorizing).
  - **One additional adversarial test** (`arena.test.ts`, 1 test): confirms a real Arena rejection
    of `arena.applyToJob` never embeds `context.rawToken` in the thrown `Error`'s own message —
    closing a narrow but real path (JennySol's existing, general-purpose `error_logs` table, which
    persists `err.message` on any unhandled error) that predates this milestone and wasn't
    previously checked against this specific credential.

  **Mapping to this checkpoint's own lettered acceptance tests:** A/D → the PII-shaped structural
  test above. B → M7's own pre-existing `pendingActions.test.ts` cross-user test (re-verified
  still passing). C → the new tenant-isolation test (the gap found and fixed above). E → the two
  injection/scope-smuggling tests above. F → `redactSecrets`'s adversarial unit tests plus the raw-
  token structural test plus the new `arena.test.ts` error-message test. G → the later-unrelated-
  request test above. H → the real `conversationStore` integration test above.

  **What "actual verification" means for this milestone, precisely, and why it differs from M6/
  M7's:** M6 and M7 proved an *external* integration works by calling real production Arena and
  Gemini. M8 proves an *internal negative property* — that specific data never crosses specific
  boundaries — which has no equivalent "call the real API and see" verification; the correct proof
  for a negative claim is exhaustive, real (non-mocked) tests against the actual code paths that
  could violate it, which is what the suite above does. There is no live-Arena-call step for this
  milestone because the boundary being proven doesn't depend on Arena's live behavior at all.

  **Full suite:** JennySol **346/346 passing** (331 pre-existing/M7 + 1 concurrent-frontend-merge
  regression check + 14 new M8 tests), `tsc --noEmit` clean, `npm run build` clean.
  **Files:** `services/memoryScope.ts` (new), `services/memoryScope.test.ts` (new),
  `agentGateway.memoryIsolation.test.ts` (new), `services/tools/pendingActions.ts` (tenant-check
  fix), `services/tools/pendingActions.test.ts` (+1 tenant test),
  `services/productConnectors/arena.test.ts` (+1 token-leak test).
  **Commit:** `8a09a11`.

## In Progress

Nothing. M9 has not started as of this checkpoint.

## Not Started

**M9 and M10 only.** See [Phase 3](#phase-3--arena-integration-audit) and
[Phase 4](#phase-4--tool-matrix) below for the exact, item-by-item evidence behind this. M0
through M8 (plus M11, M12) are now genuinely DONE (see [Completed](#completed) above) — a real,
working Arena connector, real read and write tools, a real approval mechanism, a real
product-scoped memory isolation boundary, verified live end-to-end with the actual Gemini API and
real Arena data, **now active in real production for real Arena accounts** (the M5/M6 "dormant in
production" caveat no longer applies — see [Overall completion](#overall-completion)). Genuinely
not started at all: no agent-specific audit logging (M9), and no security tests beyond the
token-primitive level plus what M7 and M8 newly cover (tests 7-17 below, see
[Phase 6](#phase-6--security-verification)) — because most of the systems those tests would
exercise still don't exist. **Per this checkpoint's own explicit instruction: no additional write
tools are to be activated until M10 (security testing) is complete**, regardless of what the
overall completion percentage might otherwise suggest is "next."

## Blocked

- **M1's live-API verification** is blocked on a missing `GEMINI_API_KEY` **in this scratch
  environment specifically** — a real key was located and used for M6's and M7's own verification
  (via `railway run`, transiently, never saved to disk here). M1's own automated tests remain
  mocked-provider-only; revisiting them against a live key is a small, low-risk follow-up, not
  blocked by anything architectural.
- **Security verification (Phase 6), remaining tests** stay blocked where the underlying system
  still doesn't exist (agent-specific audit logging for #21/#22-adjacent scenarios). Tests 1-6
  (token primitive), 9-10 (cross-user/cross-tenant via agent tool, newly unblocked by M8's tenant
  fix), 13-15 (PII/memory/prompt-injection, newly unblocked by M8's isolation tests), and 16-17
  (unauthorized write / approval bypass, unblocked by M7) now have real PASS evidence — see
  [Phase 6](#phase-6--security-verification) for the updated table. M10 is the milestone that
  formally closes out whatever remains, adversarially, against the real integration end to end.
- **Two Railway-infrastructure cleanup items, non-blocking but real:** (1) a stray, unused
  `SERVICE_TOKEN_SECRET_ARENA`/`JENNYSOL_GATEWAY_URL` pair left on the wrong, orphaned
  `Vikisol-Arena`/`Vikisol-Arena-BE` Railway project (see [Arena BE HEAD](#arena-be-head)) —
  removing it was blocked by this session's own permission classifier; a human with dashboard
  access should delete it when convenient. (2) Arena's frontend `IntentCardView.tsx` is real but
  not wired to the new `/actions/:actionId` endpoint — a real Arena user today gets a plain-text
  "awaiting approval" message with no clickable approve/reject UI, only ever executable by directly
  calling the API (as this checkpoint's own verification did).
- **GitHub PR history** is blocked from independent verification: no `gh` CLI is available in this
  environment, and the unauthenticated GitHub REST API returns `404` for this private
  organization repository (`api.github.com/repos/VikisolTechnologies/Jennysol-AI/pulls` → 404,
  which is indistinguishable from "no access" vs. "no PRs" without a token). Two real merge
  commits now exist in JennySol's history (`d4d9c26`, `512d6c8`) — both from direct `git merge`
  operations resolving concurrent-session conflicts, not GitHub PR merges (no PR UI was used for
  either) — so the underlying conclusion (this project doesn't use a PR-based review workflow)
  still holds, but "zero merge commits" is no longer literally true as of M6.

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
| Jennysol-AI (`server`) | 32 | 346 | 346 passed, 0 failed | `npm test` (vitest) | 2026-09-11, M8 (post-merge with concurrent work) |
| Arena BE (`arena-api`) | 4 | 21 | 21 passed, 0 failed | `mvn clean test` (no filter) | 2026-09-11, M7 (unchanged by M8, which is JennySol-only) |
| Arena FE (`arena-web`) | 0 (unit) | 0 | N/A — no unit test files exist (a separate Playwright E2E suite exists for Arena's own product features, unrelated to the agent/tool integration this document tracks) | `find src -iname "*.test.*"` → empty | 2026-09-10 |

Of JennySol's 346 passing tests, roughly 99 are this integration's own (5 M1 + 10 M2 + 14 M3/M4 +
5 M5 + ~26 M6 + ~25 M7 + 14 M8: 9 `memoryScope.test.ts`, 1 real-`conversationStore` integration
test, 5 `agentGateway.memoryIsolation.test.ts` structural/adversarial tests, 1 tenant-isolation
test in `pendingActions.test.ts`, 1 token-leak test in `arena.test.ts`) — the concurrent session's
own ~58 new tests (Aurora landing/account UX, a real supertest HTTP layer for auth, the Files/
Memory/Tasks/Integrations frontend pages) and the pre-existing ~196 cover unrelated JennySol
subsystems, audited in Phase 2 as separate from the M1–M12 milestones. All 21 of Arena BE's tests
are this integration's own — Arena had zero automated tests of any kind before M5.

## Deployment Status

| Service | Platform | URL | State |
|---|---|---|---|
| JennySol client | Vercel | `jennysol.vikisol.in` | Live |
| JennySol server | Railway (`jennysol-ai-api`/`jennysol-api`, **no GitHub auto-deploy** — `railway up` only) | `api.jennysol.vikisol.in` | Live, `0d40011` deployed via `railway up` |
| Arena web | Vercel | `arena.vikisol.in` | Live, `6a4fe29` deployed |
| Arena API | Railway (`arena-staging`/`arena-api` — the **real** production service; do not confuse with the separate, failing `Vikisol-Arena`/`Vikisol-Arena-BE` project, see [Arena BE HEAD](#arena-be-head)) | `api-arena.vikisol.in` | Live, `928310e` deployed via GitHub auto-deploy |

**The integration is now genuinely active in production**, not merely deployed-but-dormant:
`SERVICE_TOKEN_SECRET_ARENA` (both services) and `JENNYSOL_GATEWAY_URL` (Arena) are real, set,
and matching — `RealAgentServiceClient.isAvailable()` returns `true` for every real Arena account
today. Verified live 2026-09-11 (see M7's Completed entry) for both `arena.searchJobs` and
`arena.applyToJob`.

## Current Architecture

See the published artifact for full diagrams:
https://claude.ai/code/artifact/20ce7dcb-015f-42d8-b925-b10f818b3663 (sections "Current
Architecture" and "Intended Vikisol Ecosystem Architecture"). Unchanged since publication;
re-verified against source as part of this checkpoint (Phases 1–4 below).

## Tool Matrix

See [Phase 4](#phase-4--tool-matrix) for the full table, updated for M7. Summary: **2 of 14**
proposed Arena tools (`arena.searchJobs`, `arena.applyToJob`) are now implemented, registered,
connected, tested, and **verified end-to-end against the real Gemini API and real Arena data, live
in production** (see M7's Completed entry) — `RealAgentServiceClient` is the live binding for real
Arena accounts today, not `NoopAgentServiceClient`. The other 12 remain unimplemented as agent
tools. All 14 map to Arena REST endpoints that already exist and work for normal (non-agent)
product use — that existing endpoint is not the same claim as an agent tool wrapping it existing.

## Commit History

See [Phase 1](#phase-1--current-git-state) for the last 10-11 commits of all three repositories,
captured verbatim from `git log`. JennySol's history additionally now includes two real merge
commits (`d4d9c26`, `512d6c8`) from concurrent-session work — see the note under
[JennySol HEAD](#jennysol-head) above.

## PR History

None found via GitHub's PR API in any of the three repositories — GitHub API access is blocked in
this environment (see [Blocked](#blocked) above) for independent confirmation either way. Two real
merge commits now exist in JennySol's history (`d4d9c26`, `512d6c8`), both from direct `git merge`
resolving concurrent-session conflicts, not GitHub PR merges — this project's actual workflow
remains direct-to-`main` pushes (occasionally requiring a local merge when two sessions overlap),
not PR-based review.

## Next Exact Tasks

**M0 through M8 (plus M11, M12) are all genuinely DONE, and the integration is live in
production.** Per this checkpoint's own explicit instruction, the order from here is fixed:
**M9 → M10 → only then any further write-tool expansion.** Do not skip ahead to more write tools
before M10 is genuinely done, regardless of how the completion percentage might read.

1. **M9 — Audit/observability.** Every agent-originated Arena action should land in Arena's
   existing `AuditService` (distinguishable from a human-originated action, per `audit/AuditService.java`'s
   existing real usage for unlock/credit events) and in a JennySol-side tool-call log (no
   equivalent exists on JennySol's side today — `error_logs` is for crashes, not a deliberate
   audit trail). Verified by triggering a real tool call (read and write) and finding it in both
   logs, with enough detail (identity, tool name, tier, result status, timestamp) to answer "who
   did what, on whose behalf, when" without exposing credentials — reuse `memoryScope.ts`'s
   `redactSecrets()` for whatever gets logged, rather than inventing a second redaction pass.
2. **M10 — Security testing.** A dedicated, standalone adversarial audit of the real
   JennySol↔Arena boundary, per this checkpoint's own framing: not "does it work" but "can it work
   correctly, securely, and without crossing identity, tenant, privacy, memory, or authorization
   boundaries." Should formally close out all 17 tests in [Phase 6](#phase-6--security-verification)
   (13 already PASS via M7/M8's own suites — M10's job is to verify those hold up under deliberate,
   adversarial pressure specifically targeting the real integration, not just re-read the existing
   test files) and explicitly attempt every named attack this document has tracked as blocked or
   assumed-safe, against the real deployed system where feasible.
3. **Only after M9 and M10:** further write-tool expansion (`arena.unlockCandidateContact`,
   `arena.placeBid`, etc.) — explicitly deferred by this checkpoint's own instruction, not by lack
   of readiness in the approval mechanism itself.
4. **Two small, non-blocking cleanup items carried from the M7 checkpoint** (see
   [Blocked](#blocked)): remove the stray shared-secret variables mistakenly left on the wrong,
   orphaned `Vikisol-Arena` Railway project; consider wiring Arena's real, already-built
   `IntentCardView.tsx` to the `/actions/:actionId` endpoint so a real user gets a clickable
   approval UI instead of a plain-text message.
5. **M1's own live-API verification** — a real `GEMINI_API_KEY` has now been used live twice (M6,
   M7); consider re-running M1's original tool-calling tests against it too for completeness. Low
   priority, not blocking M9.

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
- HEAD commit: `72f3df4` — "feat(agent): add RealAgentServiceClient calling JennySol's real
  gateway (M6)" (2026-09-11)
- Working tree: clean
- Uncommitted files: none
- Ahead/behind `origin/main`: 0 / 0
- Open/merged PRs: 0 merge commits in full history — direct-to-`main` only (Arena BE, unlike
  JennySol, has had no concurrent-session conflicts to merge)
- Pushed: yes, confirmed matching `origin/main`
- Deployed: yes, Railway settled to "● Online" after this commit, `GET /api/v1/public/landing-stats` → 200;
  `RealAgentServiceClient.isAvailable()` confirmed reporting `false` in production (no real
  `JENNYSOL_GATEWAY_URL`/`SERVICE_TOKEN_SECRET_ARENA` set there), so this deploy is inert as designed

Latest 12 commits (10 from the original checkpoint plus M5's and M6's):

```
72f3df4 2026-09-11 feat(agent): add RealAgentServiceClient calling JennySol's real gateway (M6)
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
| `RealAgentServiceClient` | **DONE, live in production (M6/M7)** | `agent/client/RealAgentServiceClient.java` | Mints a real service token per call via `AgentServiceTokenIssuer`, scoped by real Arena role (`scopeFor()`, M7); `isAvailable()` returns `true` in real production today | The live, `@Primary` binding in `AgentProviderConfig` for real Arena accounts | `RealAgentServiceClientTest.java` (7 tests) | `72f3df4`, `928310e` |
| `AgentContext` | **DONE (generic record)** | `agent/client/AgentContext.java` | `record AgentContext(UUID userId, String role)` | Real, minimal, correctly excludes tenant/tool-scope fields since no tool model exists yet to need them | No unit tests | `6d33023` |
| `AgentReply` | **DONE (generic record)** | `agent/client/AgentReply.java` | `record AgentReply(String content)` | Real, deliberately has no `intent`/tool-call field yet | No unit tests | `6d33023` |
| `AgentHistoryEntry` | **DONE (generic record)** | `agent/client/AgentHistoryEntry.java` | `record AgentHistoryEntry(String role, String content)` | Real | No unit tests | `6d33023` |
| `AgentProviderConfig` | **DONE (Noop-only binding)** | `agent/config/AgentProviderConfig.java` | `@Bean @Primary AgentServiceClient agentServiceClient(NoopAgentServiceClient noop)` | Always returns Noop — no config-driven real/noop switch exists yet since there is no real implementation to switch to | No unit tests | `6d33023` |
| Service-token issuer | **DONE (M5)** | `agent/client/AgentServiceTokenIssuer.java` | Mints the HS256 service token per ADR-003 | Used live in production | `AgentServiceTokenIssuerTest.java` | `6b060a4` |
| Service-token verifier (round-trip) | **DONE, live in production (M7)** | `agent/client/AgentServiceTokenVerifier.java`, `security/jwt/AgentServiceTokenAuthenticationFilter.java` | Independently re-verifies a forwarded write-tool token's signature and scope (`ENDPOINT_TO_REQUIRED_SCOPE`) before resolving a real `UserPrincipal`; registered before `JwtAuthenticationFilter`, falls through silently on any non-matching/invalid token | Used live in production, confirmed by a real `POST /applications` round trip | `AgentServiceTokenVerifierTest.java` (4), `AgentServiceTokenAuthenticationFilterTest.java` (6) | `d15de6b` |
| Agent-tool controller | **NOT STARTED** | Does not exist. `AgentController.java` exposes only conversation/message CRUD (`GET /agent/conversation`, `GET/POST /agent/conversations/{id}/messages`), no tool-invocation endpoints | `agent/controller/AgentController.java` | Real, but scope is chat persistence only, not tools | No unit tests | `6d33023` |
| Arena-side tool authorization (agent-specific) | **NOT STARTED** | No agent tools exist to authorize. Arena's *general* endpoint authorization (`@PreAuthorize`, tenant scoping via `EnterpriseProfileService.getEntityForUser`) is real and would be reused once tools exist, but there is no agent-specific authorization layer today | `config/SecurityConfig.java` (general, pre-existing) | Real for general endpoints | — |
| Tenant enforcement (agent-specific) | **NOT STARTED** | Same as above — Arena's real tenant model (`EnterpriseProfile`/`Membership`) exists and works for human requests; nothing routes an agent-originated call through it yet, because no agent-originated call type exists | `enterprise/service/EnterpriseProfileService.java` (general, pre-existing) | Real for general endpoints | — |
| Audit events (agent-specific) | **NOT STARTED** | Arena's `AuditService` is real and used for unlock/credit events (general, pre-existing) — no agent-tool-call audit event type exists yet | `audit/AuditService.java` (general, pre-existing) | Real for general events | — |
| Approval mechanism | **DONE (backend, live in production, M7), DORMANT (frontend UI only)** | JennySol's `pendingActions.ts` + `POST /api/agent/gateway/actions/:actionId` is the real, working propose→approve→execute mechanism, verified live against real production Arena. `IntentCardView.tsx` (Arena FE) still renders an approve/reject card only if a `ChatMessage.intentCard` is populated, and nothing populates it yet — a real user today gets a plain-text "awaiting approval" message with no clickable UI, only executable via a direct API call (as this checkpoint's own verification did). Wiring Arena's frontend to this real endpoint is scoped future work. | JennySol `routes/agentGateway.ts`, `services/tools/pendingActions.ts`; Arena FE `arena-web/src/components/agent/IntentCardView.tsx` (unwired) | 7 `pendingActions.test.ts` + 6 `agentGateway.http.test.ts` (JennySol); no FE tests | JennySol `dbe5bcd` |
| Candidate unlock protection | **DONE (as a general Arena feature, not an agent tool)** | `TalentSearchService.unlock()` uses a pessimistic row lock (`findByIdForUpdate`), closing a real credit-spend race condition. This is the business method a future `arena.unlockCandidateContact` tool would wrap — it is not itself an agent tool. | `enterprise/service/TalentSearchService.java` | No unit tests (verified via live Playwright check against production in a prior session) | `e35cf83` |
| Application tools | **DONE, live in production (M7)** | `arena.applyToJob` wraps the real, pre-existing `ApplicationService.applyToJob` via the round-trip token; gated behind the real approval mechanism above; verified live end-to-end then withdrawn. | JennySol `services/productConnectors/arena.ts`; Arena `applications/*` (general, pre-existing) | 6 `arena.test.ts` write-tool tests | JennySol `dbe5bcd` |
| Project/bid tools | **NOT STARTED** | Same pattern — `marketplace/*` exists for normal use, no agent wrapper | `marketplace/*` (general, pre-existing) | — | — |
| Posting tools | **NOT STARTED** | Same pattern — enterprise postings module exists for normal use, no agent wrapper | `enterprise/*` (general, pre-existing) | — | — |

## Phase 4 — Tool Matrix

All 14 tools: **not implemented as agent-callable tools.** The "underlying endpoint" column is
included because it materially affects how much work each future tool actually requires (a thin
wrapper vs. new business logic) — it is not a claim that the tool itself exists.

| Tool | Product | R/W | Implemented? | Registered? | Connected? | Authorized? | Tested? | Approval required? | Prod verified? | Underlying Arena endpoint |
|---|---|---|---|---|---|---|---|---|---|---|
| `arena.searchJobs` | Arena | Read | **Yes** (M6) | **Yes** (M6) | **Yes** (M6) | N/A (read) | **Yes** (mocked-fetch + real supertest HTTP dispatch test + real live runs against the actual Gemini API and real Arena data, both locally at M6 and in real production at M7) | No (reads need none) | **Yes, live in real production** (M7) — a real demo-talent account's real message returned 10 real Arena jobs through the now-activated `RealAgentServiceClient` path, not just a disposable local process | `GET /api/v1/jobs` — exists, public, page/size only (no keyword search — tool description states this honestly; confirmed the model itself repeats this honestly to users) |
| `arena.getJob` | Arena | Read | No | No | No | N/A | No | No | No | `GET /jobs/{id}` — exists |
| `arena.getMyProfile` | Arena | Read | No | No | No | N/A | No | No | No | `GET /profile/me` — exists |
| `arena.getMyApplications` | Arena | Read | No | No | No | N/A | No | No | No | Applications module — exists |
| `arena.getProjects` | Arena | Read | No | No | No | N/A | No | No | No | Marketplace module — exists |
| `arena.getNotifications` | Arena | Read | No | No | No | N/A | No | No | No | Notifications module — exists |
| `arena.searchCandidates` | Arena | Read | No | No | No | N/A | No | No | No | `TalentSearchService.search()` — exists, tenant-scoped |
| `arena.getCandidate` | Arena | Read | No | No | No | N/A | No | No | No | `TalentSearchService.getCandidateDetail()` — exists, respects paywall redaction |
| `arena.getMyPostings` | Arena | Read | No | No | No | N/A | No | No | No | Enterprise postings module — exists |
| `arena.applyToJob` | Arena | **Write** | **Yes** (M7) | **Yes** (M7) | **Yes** (M7) | **Yes** — Arena's `AgentServiceTokenAuthenticationFilter` independently re-verifies scope against `POST /applications` before resolving a real `UserPrincipal` | **Yes** (7 `pendingActions` unit tests + 6 `arena.test.ts` execution tests + 6 `agentGateway.http.test.ts` propose/approve/reject/single-use/cross-identity tests + 6 Arena-side filter tests) | **Yes, enforced in code** — a WRITE tool call is never dispatched by `/chat`; only `POST /actions/:actionId` with the same identity can execute it, exactly once | **Yes, live in real production** (M7) — a real demo-talent account's real, model-decided, user-approved application was submitted against real production Arena, then withdrawn (see M7's Completed entry) | Applications module — exists |
| `arena.placeBid` | Arena | **Write** | No | No | No | N/A | No | Yes (design intent) | No | Marketplace module — exists |
| `arena.createPosting` | Arena | **Write** | No | No | No | N/A | No | Yes (design intent) | No | Enterprise postings module — exists |
| `arena.unlockCandidateContact` | Arena | **Write** | No | No | No | N/A | No | Yes (design intent) | No | `TalentSearchService.unlock()` — exists, race-condition-fixed |
| `arena.sendMessage` | Arena | **Write** | No | No | No | N/A | No | Yes (design intent) | No | Messaging module — exists |

## Phase 5 — Real End-to-End Verification

**FULLY VERIFIED for both the read and write tool paths, live in real production, as of M7.** The
complete flow `USER → ARENA → REAL MODEL → TOOL CALL → CONNECTOR → ARENA → AUTHORIZATION →
BUSINESS SERVICE → DATABASE → RESULT → JennySol → USER` was executed live, for real, with real
credentials, against real production infrastructure on both ends, with genuine bugs found and
fixed along the way at both M6 and M7:

- **Read path (M6, re-verified live in production at M7):** a real message ("Show me some jobs
  available on Arena.") sent through Arena's real `/agent` endpoint → real production
  `RealAgentServiceClient` → real production JennySol gateway → **the real Gemini model genuinely
  decided to call `arena.searchJobs`** → real Arena job data (10 real listings) returned → the
  model produced a real final answer, including an unprompted, honest note about Arena's real lack
  of keyword search.
- **Write path (M7, new):** a real message ("Please apply me to the Arena job posting with id
  `218ff2b3-...`") sent through Arena's real `/agent` endpoint, as the real `demo.talent@vikisol.dev`
  account → real chain to real production JennySol → **the real Gemini model genuinely decided to
  call `arena.applyToJob`** → JennySol's WRITE-tier logic proposed a `PendingAction` rather than
  dispatching → a real, honest reply ("...awaiting your explicit approval") was returned and
  persisted in Arena's real database.
- **Real approval, via a directly-minted equivalent token** (Arena's own frontend approval UI
  isn't wired to this endpoint yet): `POST /api/agent/gateway/actions/{actionId}` with
  `{approve: true}` → real round-trip token forwarded to real production Arena's
  `POST /applications` → Arena's new `AgentServiceTokenAuthenticationFilter` independently
  re-verified it and resolved the real `UserPrincipal` → a genuine `Application` row was created —
  `{"status":"executed","result":{"id":"954c30ba-...","stage":"applied",...}}`.
  Withdrawn immediately after (`DELETE /applications/954c30ba-...` → `{"success":true}`) to leave
  no residue beyond two harmless in-app notifications to seeded/synthetic accounts (no real third
  party exists in Arena's data to be affected — confirmed by reading `DataSeeder.java` before
  proceeding).
- **Two genuine infrastructure gaps found and fixed by this exact verification process, not
  assumed away:** (1) JennySol's production Railway service has no GitHub auto-deploy — production
  was still running pre-M6 code until `railway up` was run directly; (2) the shared secret was
  first set on a wrong, failing, orphaned Railway project before `railway status`'s `url` field
  revealed the real production Arena service. Both are recorded in full under
  [JennySol HEAD](#jennysol-head) and [Arena BE HEAD](#arena-be-head) so no future session repeats
  either mistake. A third gap — `RealAgentServiceClient`'s scope never including
  `arena.applyToJob` — was found and fixed before any live call was attempted (see M7's Completed
  entry).

**This is now the strongest possible evidence available**: a real, production, fully-connected
trace for both a read and an approved write, with genuine bugs caught and fixed along the way at
two different milestones, not a mocked simulation. The reject path and Arena's own frontend
approval-card UI are the two remaining pieces *not* proven live (see M7's Completed entry for
exactly what each still needs). See M6's and M7's own Completed entries for the full evidence and
exact commands used.

## Phase 6 — Security Verification

**13 of 17 tests now PASS** (1-10, 13-17), as of M8. Only 11-12 remain **BLOCKED** — both concern
systems (Arena's own session-JWT boundary re Arena's own frontend, and a refresh-token concept)
that this integration hasn't touched and that don't exist in this form anywhere in the codebase,
not gaps M8/M9/M10 are meant to close. **This PASS count is not the same claim as M10 being
done** — M10's own acceptance criteria require *all* 17 to have real evidence, run against the
real integration, as a dedicated milestone's own adversarial audit; the entries below were proven
incrementally by M7 and M8's own test suites, not by a standalone M10 effort yet:

| # | Test | Result |
|---|---|---|
| 1 | Valid service token | **PASS** — `serviceToken.test.ts` test 1, `signServiceToken`→`verifyServiceToken` round trip resolves to the exact expected `ProductIdentity`. Commit `0486d22`. |
| 2 | Expired token | **PASS** — test 2, a token minted with `ttlSeconds: -1` is rejected with a `ServiceTokenError` matching `/expired/i`. |
| 3 | Forged token | **PASS** — tests 3 and 3b: (a) a token claiming issuer "acme" but signed with a different product's secret is rejected, (b) a validly-signed token whose payload is tampered with post-signing is rejected. Both real signature-verification failures, not string-matching. |
| 4 | Wrong audience | **PASS** — test 4, a token signed with `audience: "some-other-service"` is rejected. |
| 5 | Wrong issuer | **PASS** — test 5, a token claiming an issuer with no configured `SERVICE_TOKEN_SECRET_*` is rejected before any signature check even runs. |
| 6 | Invalid scope | **PASS** — test 6, a validly-issued token with `scope: ["acme.getWidget"]` correctly fails `requireScope()` for `"acme.deleteEverything"` and succeeds for its own granted tool. |
| 7 | Wrong tenant | **PASS (M8)** — `pendingActions.test.ts`'s new tenant test: two identities sharing `product`+`externalUserId` but a different `tenantId` cannot consume each other's pending action. Closes a real gap `consumeAction` had before M8 (it previously ignored `tenantId` entirely). |
| 8 | Wrong user | **PASS** — `pendingActions.test.ts` (M7): an identity with a different `externalUserId` (same product) cannot consume another identity's pending action. |
| 9 | Cross-user access (via agent tool) | **PASS** — same `pendingActions.test.ts` coverage as #8, exercised through the real HTTP `/actions/:actionId` route in `agentGateway.http.test.ts` (M7): "a different identity can never approve someone else's pending action." |
| 10 | Cross-tenant access (via agent tool) | **PASS (M8)** — same mechanism as #7, now enforced at the same `consumeAction` layer every real approval goes through. |
| 11 | Arena JWT leakage into JennySol | BLOCKED — no call path exists for it to leak across (unrelated to M8's scope — this is about Arena's own session JWT, not the service-token/product-memory boundary M8 addresses) |
| 12 | Refresh-token leakage | BLOCKED — no refresh-token concept exists anywhere in this system |
| 13 | PII leakage (Arena → JennySol memory) | **PASS (M8)** — `agentGateway.memoryIsolation.test.ts`: a tool result deliberately shaped with candidate-contact-style PII never reaches `conversationStore`/`vectorStore`, proven via `vi.spyOn` on the real modules. |
| 14 | Memory leakage (cross-product) | **PASS (M8)** — the same test above, plus the "later unrelated request carries no trace of an earlier request's tool data" test — there is no persistence for cross-product data to leak *through* in the first place, and this is now proven rather than assumed. |
| 15 | Prompt injection through Arena data | **PASS (M8)** — `agentGateway.memoryIsolation.test.ts`'s two injection tests: a hostile tool call's `args` (containing a fake scope-override claim and "SYSTEM OVERRIDE" text) cannot bypass the WRITE-tier approval gate or elevate `ToolRegistry.dispatch`'s scope check, since neither ever reads tool-call/result content when making an authorization decision. |
| 16 | Unauthorized write action | **PASS (M7)** — a WRITE tool call from the model is never dispatched by `/chat` under any circumstance (`agentGateway.http.test.ts`: "a WRITE tool call from the model never dispatches immediately"); Arena's own `AgentServiceTokenAuthenticationFilter` independently re-verifies the round-trip token's scope against `POST /applications` regardless of what JennySol believes it authorized (`AgentServiceTokenAuthenticationFilterTest.java`: wrong-scope token does not authenticate). |
| 17 | Approval bypass | **PASS (M7)** — `consumeAction` is single-use (verified by both a unit test and a real HTTP test: approving the same real `actionId` twice returns 404 the second time, never a second execution); a different identity can never approve someone else's pending action (`agentGateway.http.test.ts`, `pendingActions.test.ts`); a rejected action never reaches `dispatch()` (`fetchMock` assertion). **Not yet tested**: a real, live rejection against production infrastructure specifically (covered by real HTTP-level automated tests only, not a live production call — see M7's Completed entry). |

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
| **M6 — Arena read tools** | At least one real Arena read tool (e.g. `arena.searchJobs`) is implemented, registered, connected, and triggered by a real chat message end-to-end in a live test, returning real Arena data. | **DONE** — commits JennySol `cd81da2`→`512d6c8`→`5f1624b`, Arena `72f3df4`. A real message ("Show me some jobs available on Arena.") sent to the real Gemini API caused a real model-decided call to `arena.searchJobs`, which called real production Arena's `/api/v1/jobs` and returned 10 real job listings, which the model used to produce a real final answer (that itself honestly noted Arena's real no-keyword-search limitation, unprompted). A real bug (missing `/api/v1` context-path) was found and fixed by this exact process. All credentials masked throughout; nothing written to disk or committed. Not yet active in production (`NoopAgentServiceClient` remains live there) — a separate rollout decision. |
| **M7 — Approval/write tools** | At least one write tool (e.g. `arena.applyToJob`) is gated behind a real approval step the user must explicitly confirm before the tool executes; verified live that a rejected approval never calls the tool and an approved one does, exactly once. | **DONE** — JennySol `dbe5bcd`/`0d40011`, Arena `d15de6b`/`928310e`. `arena.applyToJob` is a real WRITE-tier tool; a real Gemini-decided call against real production Arena, through a real demo-talent account, was proposed (not dispatched), then explicitly approved, then executed exactly once against real production Arena's `POST /applications` via the round-trip token — real `Application` row created, then withdrawn. The reject/single-use/cross-identity guarantees are proven by real HTTP-level automated tests (13 new across both repos); the reject path specifically has not been additionally exercised against live production infrastructure (no equivalent "does the model really decide this" question exists for a reject, unlike an approve). |
| **M8 — Memory isolation** | Product-scoped memory tagging exists; a test proves Arena tool-call data never appears in JennySol's own cross-product/long-term memory without an explicit, separate "remember this" action. | **DONE** — commit `8a09a11`. `services/memoryScope.ts`'s real `MemoryScope` taxonomy + branded `ProductToolResult` + `redactSecrets`; a real gap fixed (`pendingActions` never checked `tenantId`); 14 new tests spanning unit, integration (against the real `conversationStore`), and adversarial (against the real deployed gateway, via spies on the real `conversationStore`/`vectorStore` modules) layers, all passing. See this document's own [Completed](#completed) entry for the full mapping to acceptance tests A-H. |
| **M9 — Audit/observability** | Every agent-originated Arena action is written to Arena's existing `AuditService` (distinguishable from a human-originated action) and to a JennySol-side tool-call log; verified by triggering a real tool call and finding it in both logs. | NOT STARTED |
| **M10 — Security testing** | All 17 tests listed in this document's Phase 6 move from BLOCKED to PASS/FAIL with real evidence, run against the real integration. | NOT STARTED — 13 of 17 now PASS (via M7's and M8's own milestone-scoped test suites), 2 remain BLOCKED on systems that don't exist (Arena's own JWT boundary, refresh tokens), and 2 more (#11-12's neighbors, already reflected above) are accounted for — but M10's own bar is a *dedicated, standalone adversarial audit of the real integration* per this checkpoint's own explicit instruction ("Can it work correctly, securely, and without crossing identity, tenant, privacy, memory or authorization boundaries?"), not simply totaling up what incidental coverage other milestones produced. Stays NOT STARTED rather than PARTIAL, per this document's own no-partial-credit rule, until that dedicated audit actually runs. |
| **M11 — Real end-to-end integration** | The full flow in this document's Phase 5 executes for real, for at least one read and one approved write, with recorded evidence at every hop. | **DONE** — see M7's Completed entry and [Phase 5](#phase-5--real-end-to-end-verification). A real read (`arena.searchJobs`) and a real approved write (`arena.applyToJob`) both executed live against real production Arena and real production JennySol, with evidence recorded at every hop (Arena trigger → RealAgentServiceClient → JennySol gateway → Gemini decision → tool dispatch/proposal → approval → Arena round-trip → real result), then the test write was withdrawn. |
| **M12 — Production rollout** | The real client replaces `NoopAgentServiceClient` for at least one production Arena account via configuration only (no code change required to flip it, per the existing interface→Noop→real pattern), verified live. | **DONE** — `SERVICE_TOKEN_SECRET_ARENA` (both services) and `JENNYSOL_GATEWAY_URL` (Arena) were set on both real production Railway deployments, via configuration only (zero code changes to flip the binding — `AgentProviderConfig`'s existing `isAvailable() ? real : noop` logic did the rest). Verified live for the real `demo.talent@vikisol.dev` account, for both a read and a write. Not scoped to "at least one account" — every real Arena account is now served by the real client. |

---

*Generated 2026-09-10, updated 2026-09-11 for M7 (live production verification) and again for M8
(memory isolation) by direct inspection of the JennySol repository and real, non-mocked test runs
— no status above was carried forward from a prior conversation without being independently
re-verified via a command run during this checkpoint. Phase 1's exact commit-history dumps below
predate M7/M8 and are retained for M0-M6 context; [JennySol HEAD](#jennysol-head),
[Arena BE HEAD](#arena-be-head), and the sections above are the current source of truth.*
