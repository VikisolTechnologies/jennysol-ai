# VIKISOL ECOSYSTEM — MAC HANDOFF

**READ THIS BEFORE MODIFYING THE REPOSITORY.**

This is an engineering continuity document for a Claude session picking up this project on a new
machine (Windows → Mac transfer, 2026-09-11). It exists so you do not need to rediscover
architecture, security decisions, milestone history, or unfinished work from scratch. Trust the
evidence in this document and in `PROJECT-PROGRESS.md` over any narrative summary — both are
backed by commit SHAs, test counts, and commands actually run, not by claims.

**If this document and `PROJECT-PROGRESS.md` disagree, re-verify against the actual repositories
and fix whichever one is wrong — neither is infallible, but both should always be re-derivable
from the code.** `PROJECT-PROGRESS.md` (in the `Jennysol-AI` repo) is the detailed, evidence-level
ledger for the JennySol×Arena integration specifically; this document is the wider-angle map of
the whole ecosystem, written once at a hand-off point rather than updated every milestone.

---

## CURRENT STATE (2026-09-11, at hand-off)

- **The JennySol↔Arena AI-agent integration is 100% complete against its own defined milestone
  model (M0–M12), live in real production, for real Arena users, today.** A real Gemini model can
  search Arena jobs and apply to one on a user's explicit behalf, gated by a real approval step,
  isolated from JennySol's own memory, logged to a real audit trail, and hardened by a dedicated
  adversarial security pass that found and fixed a real vulnerability.
- **This does NOT mean the Vikisol ecosystem or even Arena itself is "done."** Two real, separate,
  significant gaps were found in Arena's own product this same checkpoint (not part of the AI
  integration): its web frontend defaults to mock/localStorage data in real production, and its
  file storage is not durable across redeploys. See [Known Limitations](#known-limitations) —
  these are very likely the highest-value next work, independent of anything else below.
- **Recovery tags exist** in both repos: `m7-m11-m12-verified-2026-09-11` and
  `m8-m9-m10-verified-2026-09-11` (the latter created at the end of this same checkpoint — see
  [Exact Current State](#exact-current-state) for the precise commit each points at). Never delete
  these.
- **JennySol's Railway service has no GitHub auto-deploy.** Pushing to `origin/main` does not
  update `api.jennysol.vikisol.in` — you must run `railway up --detach` from `server/` after
  setting `GIT_COMMIT_SHA` to the commit you're deploying. Arena's Railway service (the real one —
  see below) DOES auto-deploy from GitHub. This asymmetry has caused real confusion twice already;
  don't assume either behavior without checking `railway status`'s `source.repo` field.
- **There are two Railway "Arena" projects and only one is real.** `arena-staging`/`arena-api`
  (despite the name) serves `api-arena.vikisol.in` and is the actual production backend. A
  separate `Vikisol-Arena`/`Vikisol-Arena-BE` project shares the same GitHub repo, auto-deploys
  independently, has been failing for a while, and serves nothing real
  (`vikisol-arena-be-production.up.railway.app`, not a domain anyone uses). Always run
  `railway status` after linking and confirm the `url` field before trusting a link.

---

## 1. Ecosystem Vision

One large Vikisol ecosystem, four major components, one architectural principle:

```
                    JENNY SOL
                 CENTRAL AI LAYER
                       |
                 AGENT GATEWAY
                 /            \
             ARENA            HRLMS
              |                 |
        Arena authority    HRLMS authority
```

- **Vikisol** — the main company/public-facing site and umbrella brand.
- **Vikisol Arena** — a talent/work/needs platform: jobs, hiring, projects, freelance/contract
  work, technical challenges, applications/bids/responses, professional identity, companies,
  conversations/rooms, marketplace, community/social features, location/map-based needs, and
  (this integration's own subject) AI-agent workflows. Core philosophy, repeat this to yourself
  before adding any feature: **"NEED → RESPONSE → CONVERSATION → OUTCOME → IDENTITY → NEED."**
  Arena is not, and must not become, a LinkedIn/Naukri clone — it's a place where someone posts
  what they need and the right people show up.
- **JennySol** — the central AI platform: an assistant/agent layer for the whole ecosystem, meant
  to become the shared intelligence layer across products rather than an unrelated chatbot.
- **HRLMS** — an HR/workforce management system, authoritative for its own domain, eventually
  connected to JennySol the same controlled way Arena is. **Not touched by this checkpoint** — see
  [HRLMS Responsibilities](#4-hrlms-responsibilities) for what's known about it.

**Non-negotiable architectural rule**: JennySol must never directly access Arena's or HRLMS's
database. Each product stays authoritative over its own business data. JennySol only ever talks to
them through controlled connectors/tools, per product, per ADR-002/ADR-003 (see
[ADR References](#adr-references)).

---

## 2. Repository Map

| Repo | GitHub | Local path (this machine) | Purpose |
|---|---|---|---|
| `Jennysol-AI` | `VikisolTechnologies/jennysol-ai` | scratchpad clone (see below) | JennySol server (Node/Express) + client (React/Vite) |
| `Vikisol-Arena-BE` | `VikisolTechnologies/Vikisol-Arena-BE` | `Vikisol-Arena/arena-api` | Arena backend (Spring Boot) — **the real production one is deployed as `arena-api` in the Railway project named `arena-staging`, not the project named `Vikisol-Arena`** |
| `Vikisol-Arena-FE` | (same repo name pattern, see `git remote -v`) | `Vikisol-Arena/arena-web` | Arena frontend (Next.js) |
| HRLMS backend | not directly worked on this session | `../HRLMS-BE` (sibling of this checkout, per this session's own git status) | Spring Boot, per prior-session memory — not verified fresh this checkpoint |
| HRLMS frontend | `vikisol-one-fe` (Vercel project name) | not located locally this session | Serves `hrlms.vikisol.in` per Vercel project listing — not investigated |
| (unknown) | — | not located | `arena-recruiter-frontend` Vercel project exists (`arena-recruiter-frontend.vercel.app`) — no local clone found, purpose unconfirmed. Investigate before assuming it's stale or irrelevant. |

**Important**: this Windows session ran `Jennysol-AI` from a temp scratchpad directory (not
`Vikisol-Arena`'s sibling on disk) because of how the session's environment was set up — on Mac,
clone it wherever makes sense for your own workflow; there is nothing special about the scratchpad
path itself, it is not referenced by any code.

## 3. Production Domains

| Domain | Serves | Platform/project |
|---|---|---|
| `jennysol.vikisol.in` | JennySol client | Vercel, project `jennysol-ai` |
| `api.jennysol.vikisol.in` | JennySol server | Railway, project `jennysol-ai-api`, service `jennysol-api` — **`railway up` only, no auto-deploy** |
| `arena.vikisol.in` | Arena web | Vercel, project `arena-web` |
| `api-arena.vikisol.in` | Arena API (the real one) | Railway, project `arena-staging`, service `arena-api` — auto-deploys from GitHub |
| `hrlms.vikisol.in` | (presumed HRLMS frontend) | Vercel, project `vikisol-one-fe` — unconfirmed this session |
| `vikisol.in` | Main Vikisol site | Vercel, project `vikisol-website-9ewo` |

---

## 4. Product Responsibilities

### JennySol
- AI execution: model/provider routing (Gemini primary, DeepSeek/Ollama compatibility layers,
  circuit breakers, retry classification).
- Durable, cancellable `AgentRun` with SSE streaming, for its own logged-in/guest users
  (`/api/chat`, unrelated to the product gateway).
- Its own conversation history, RAG/document store, voice (STT/TTS/barge-in) — all real, all
  pre-dating this integration, all still user_id-scoped and tested (`security.test.ts`, 10
  cross-user tests, re-verified passing this checkpoint).
- The product-federated Agent Gateway (`/api/agent/gateway/*`) — this is what Arena talks to. See
  [Connector Architecture](#5-connector-architecture).
- Tool orchestration and AI workflow state for connected products' agent traffic specifically.

### Arena
- Authoritative for: users, roles, tenants (`EnterpriseProfile`/`Membership`), jobs, applications,
  companies, candidate profiles, marketplace data, rooms/posts, every other Arena business entity.
- Its own real, independent auth (session JWTs via `JwtTokenProvider`), completely separate from
  the service-token mechanism JennySol uses (see [Service-Token Architecture](#7-service-token-architecture)).
- Its own audit system (`AuditService`/`AuditActions`), now also recording agent-originated actions
  (M9).
- **Not** authoritative for AI execution, model routing, or agent conversation state — that's
  JennySol's job, reached only through the gateway.

### HRLMS
- Authoritative for its own HR/workforce domain. Per prior-session memory (not re-verified this
  checkpoint): a Spring Boot backend exists with 17+ modules, a data seeder, file upload, email
  service, scheduled jobs (commit history visible via `git log` in that sibling directory if you
  need to check). **No agent/connector work has started for HRLMS** — when it does, it should
  follow the exact same pattern Arena did (M2→M3→M5→M6→M7→M8→M9→M10), not a shortcut.

---

## 5. Connector Architecture

```
JennySol
    ↓
Agent Gateway (routes/agentGateway.ts)
    ↓
Product Connector (services/productConnectors/arena.ts — the ONLY file allowed to know "Arena" exists, per ADR-002)
    ↓
Arena Agent API (real Arena REST endpoints — /jobs, /applications, etc.)
    ↓
Arena authorization (Spring Security filters, independently re-derived — see below)
    ↓
Arena business service (ApplicationService, etc. — unmodified, same code real human users hit)
    ↓
authoritative Arena database
```

- **`ToolRegistry`** (`services/tools/toolRegistry.ts`) is the one place JennySol's core asks "what
  tools can this identity use" / "run this tool call." It has zero knowledge of any concrete
  product — only of the generic `ProductConnector` interface. A tool from product A is
  structurally invisible to an identity from product B (proven in `toolRegistry.test.ts` against
  two independent fake products, `acme`/`widgetco`, before Arena ever touched this code).
- **`RegisteredTool`** now carries a `tier: "READ" | "WRITE"` (M7). READ tools dispatch
  immediately; WRITE tools are proposed, never dispatched, until an explicit separate approval
  (see [Approval Architecture](#9-approval-architecture)).
- **Adding a second product (HRLMS or otherwise)**: write a new connector implementing
  `ProductConnector`, register it in `services/tools/registryInstance.ts`, done — the registry,
  gateway, and approval mechanism need zero changes. This was explicitly designed and tested this
  way at M3/M4, before Arena (the first real product) existed.
- **Arena's current real tools**: `arena.searchJobs` (READ, `GET /api/v1/jobs`, page/size only —
  Arena has no keyword search yet; the tool's own description says so honestly, and the model
  repeats that honestly rather than pretending it filtered) and `arena.applyToJob` (WRITE, wraps
  the real `ApplicationController`/`ApplicationService.applyToJob`). See
  `PROJECT-PROGRESS.md`'s Phase 4 (Tool Matrix) for the other 12 proposed-but-unbuilt tools and
  their underlying (already-real) Arena endpoints.

---

## 6. Authentication Architecture

Three, deliberately separate, never-interchangeable identity systems exist. Confusing them is
exactly the kind of mistake this architecture was built to make structurally impossible, not just
policy-forbidden:

1. **JennySol's own session** (`sessions.ts`) — for JennySol's own logged-in/guest users hitting
   `/api/chat`. Opaque, DB-backed. Never accepted by the product gateway.
2. **Arena's own session JWT** (`JwtTokenProvider`) — for real human users of Arena's own frontend
   hitting Arena's own normal endpoints. Never accepted by JennySol at all, anywhere.
3. **The service token** (`serviceToken.ts` on JennySol's side, `AgentServiceTokenIssuer`/
   `AgentServiceTokenVerifier` on Arena's side) — the only credential that crosses the JennySol↔Arena
   boundary. See below.

## 7. Service-Token Architecture

- A short-lived (max 300s), HS256-signed JWT, one shared secret **per issuing product**
  (`SERVICE_TOKEN_SECRET_ARENA`, etc. — never one global secret).
- Claims: `sub` (external user id in the issuing product — never a JennySol id), `iss` (issuing
  product — "arena"), `aud` (always "jennysol"), `role`, `tenantId` (optional), `scope` (explicit
  tool-name allow-list — empty means no tool access, never "trust everything").
- **Minted by Arena** (`AgentServiceTokenIssuer.java`, via `RealAgentServiceClient` when a real
  Arena user sends a message through Arena's own `/agent` endpoint) — JennySol never mints a
  token for itself; it only ever verifies one Arena already signed.
- **Round-trip design for writes (M7)**: a WRITE tool doesn't get a new credential. It forwards
  the *exact same* token Arena gave it for that turn back to Arena's own protected endpoint (e.g.
  `POST /applications`) as its own `Authorization` header. Arena's
  `AgentServiceTokenAuthenticationFilter` independently re-verifies the signature AND re-checks the
  scope claim against a static endpoint→required-scope map, before resolving a real
  `UserPrincipal` — Arena never trusts that JennySol already checked this correctly.
- **Algorithm pinning matters — a real vulnerability was found and fixed here (M10)**: both sides
  must explicitly restrict to exactly HS256. JennySol's `jwt.verify(token, secret, {algorithms:
  ["HS256"]})` was already correct. Arena's `Jwts.parser().verifyWith(key)` was NOT — it accepted
  any HMAC variant compatible with the key's byte length (HS384 with the correct secret verified
  successfully) until this checkpoint's dedicated adversarial pass found it and added an explicit
  post-parse algorithm check. **If you ever touch either verifier again, re-run
  `security.adversarial.test.ts` / `AgentServiceTokenVerifierTest.java`'s algorithm-confusion tests
  first** — this class of bug has now recurred twice in this exact codebase (once on the issuing
  side at M5, once on the verifying side at M10).
- **Never**: log the raw token, persist it anywhere, put it in a `.env` committed to git, or
  forward it anywhere other than the one round-trip call it was minted for.

## 8. Tenant Isolation Rules

- `ProductIdentity.tenantId` is a real, independent field — always compare it explicitly, never
  assume `product` + `externalUserId` alone is enough.
- **A real gap was found and fixed here (M8)**: `pendingActions.consumeAction` originally didn't
  check `tenantId` at all. Fixed — now compares all three. Arena's own `externalUserId` (a
  globally-unique `User.id` UUID) can't currently trigger this specific collision, but the fix
  closes the *contract* gap for any future product/scenario where it could.
- `agentAuditLog`'s read path (`getAuditTrailForCorrelation`, M9) requires the exact same
  three-way identity match — audit logs are not exempt from tenant isolation just because they're
  "only logs."

## 9. Memory Isolation Rules (M8)

- **Arena tool results are current-turn context by default and do NOT automatically enter any of
  JennySol's own persistent memory.** This is true today by construction, not by policy: the
  product gateway (`routes/agentGateway.ts`) has never called `conversationStore`/`vectorStore` at
  all — proven by `vi.spyOn` tests against the *real* modules, not assumed from reading the code.
- `services/memoryScope.ts` is the real, tested guard against this being silently broken later: a
  `MemoryScope` taxonomy (`global | user | conversation | product`), a `ProductToolResult` type
  branded `__brand: "current-turn-only"` that a future persistence call site can't satisfy by
  accident, and `redactSecrets()` (real recursive redaction by key name AND by JWT-shaped string
  value — reused by M9's audit log rather than reinvented).
- **If you ever wire the gateway into real persistence** (multi-turn context, an explicit
  "remember this" feature): go through `unwrapForExplicitUserMemory()`, which requires the caller
  to supply an explicit `user`/`conversation` target scope — there is no path from a
  `ProductToolResult` to global memory, or to a different user's/product's scope, expressible by
  its own types.
- JennySol's own pre-existing memory (`conversationStore.ts`, `vectorStore.ts`) was already
  correctly `user_id`-scoped before this integration touched anything — don't "fix" what wasn't
  broken; `security.test.ts`'s 10 cross-user tests already cover it.

## 10. Approval Architecture (M7, ADR-004)

- A WRITE-tier tool call from the model is **never** dispatched by `/chat`. It becomes a
  `PendingAction` (`services/tools/pendingActions.ts`) — single-use, identity-bound (product +
  externalUserId + tenantId), TTL-bound (5 minutes) — and the gateway surfaces
  `{actionId, toolName, args}` in its response.
- The **only** path to real execution or discard is `POST /api/agent/gateway/actions/:actionId`
  with `{approve: boolean}`, gated by the same `requireProductIdentity` and independently
  re-verifying the *same* identity proposed it.
- Proven, including under real concurrency: `Promise.all` of two simultaneous approvals of the
  same real `actionId` — exactly one executes, the other 404s (M10).
- **Arena's frontend has no UI for this yet.** `IntentCardView.tsx` (`arena-web`) is real,
  already-built, and completely unwired — a real Arena user today gets a plain-text "awaiting your
  approval" message with nothing to click. This session's own live verification called
  `/actions/:actionId` directly. Wiring the frontend is real, valuable, currently-open work.

## 11. Audit Architecture (M9)

- JennySol: `agent_audit_log` table + `services/agentAuditLog.ts`. One `correlationId` per
  gateway request (assigned in `requireProductIdentity`, before auth even succeeds or fails).
  Records the full chain: request received → tool decided → (scope violation / cross-product
  attempt / dispatched / failed) → pending action created/approved/rejected → dispatched/failed →
  request completed → provider failures. Read path requires the exact identity that generated the
  events — audit logs respect the same tenant/user boundaries as the data they describe.
- Arena: `AgentServiceTokenAuthenticationFilter` calls the existing `AuditService` directly
  (`AGENT_ACTION_AUTHORIZED` / `AGENT_ACTION_DENIED`) — the one durable record distinguishing an
  AI-agent-originated action from a human one in Arena's own pre-existing audit system.
- **Never logged**: passwords, refresh/access tokens, service-token secrets, API keys,
  `Authorization` header values, raw tool-call payloads that might carry any of the above
  unredacted. Both sides run everything through a redaction step before persisting
  (`redactSecrets()` on JennySol; Arena's own audit rows only ever carry action/target/metadata
  strings the calling code composes deliberately, never a raw request/response dump).

---

## 12. Milestone Table

All from `PROJECT-PROGRESS.md` (the detailed ledger — read that file for full evidence per
milestone). Summarized here:

| # | Milestone | Status | One-line evidence |
|---|---|---|---|
| M0 | Investigation | DONE | Real repos located, architecture audited, published |
| M1 | Tool-calling engine | DONE | Real Gemini function-calling, mocked-network tests (live-API re-run still low-priority-open) |
| M2 | Product identity/security | DONE | Service-token verify/sign, 10 attack-scenario tests, real HS256 JWT |
| M3 | Tool registry | DONE | Two fake products prove cross-product invisibility |
| M4 | Connector framework | DONE | Reusable registration/health reporting |
| M5 | Arena connector | DONE | Real cross-language token round trip; found+fixed HS384 auto-upgrade bug (issuing side) |
| M6 | Arena read tool | DONE | Real Gemini call → real `arena.searchJobs` → real Arena data; found+fixed missing `/api/v1` path |
| M7 | Approval/write tools | DONE | Real propose→approve→execute against real Arena, live, then withdrawn |
| M8 | Memory isolation | DONE | Real boundary code + unit/integration/adversarial tests; found+fixed tenant-check gap |
| M9 | Audit/observability | DONE | Real audit trail, both sides, deployed, live-verified |
| M10 | Security testing | DONE | Dedicated adversarial pass; found+fixed HS384 verification bug (verifying side) |
| M11 | Real E2E integration | DONE | Read+write, full chain, evidence at every hop |
| M12 | Production rollout | DONE | Real shared secrets set on both real production services, config-only |

**All 13 are genuinely DONE as of this checkpoint.** No partial credit was given anywhere — every
DONE above has real code + real tests + a real run behind it, per this document's own repeatedly-
enforced rule.

---

## 13. Exact Current State

**JennySol (`Jennysol-AI`)**
- HEAD: `0fdc1080273803b3fa3647a33175c615271cf8ad` (`0fdc108`), branch `main`, pushed, working
  tree clean at time of writing.
- Deployed to production (`railway up`, commit `715b64e` — the docs commit `0fdc108` on top is
  docs-only and wasn't separately deployed since it changes no runtime code).
- Tags: `m7-m11-m12-verified-2026-09-11`.

**Arena backend (`Vikisol-Arena-BE`)**
- HEAD: `95bf156f7553f88cabb19dc2380520ca4524cdef` (`95bf156`), branch `main`, pushed, working
  tree clean.
- Deployed to production via GitHub auto-deploy to `arena-staging`/`arena-api` — commit hash
  confirmed matching via `railway status --json`.
- Tags: `m7-m11-m12-verified-2026-09-11`.

**Arena frontend (`Vikisol-Arena-FE`)**
- HEAD: `6a4fe2900282d1498c2835e3cf5a76cc6ae99a9b` (`6a4fe29`), branch `main` — **unchanged this
  entire checkpoint**; the mock-mode finding below is a discovery, not a regression introduced now.

**A new tag, `m8-m9-m10-verified-2026-09-11`, is created on both the JennySol and Arena-BE repos
at the very end of this checkpoint (after this handoff document and the final `PROJECT-PROGRESS.md`
update are committed and pushed) — check `git tag -l` / `git show m8-m9-m10-verified-2026-09-11`
for the exact commits it points at, since it necessarily lands one or two commits after the SHAs
listed above.**

**Test counts** (all confirmed by actually running the commands, not estimated):
- JennySol: 365/365 passing (`npm test`, vitest), confirmed stable across 3 repeated runs.
  `tsc --noEmit` clean. `npm run build` clean.
- Arena backend: 26/26 passing (`mvn clean test`, no filter — use `clean`, a stale-incremental-
  compile artifact caused one flaky, unrelated failure earlier this session that a clean rebuild
  resolved). `mvn -o clean compile` clean.
- Arena frontend: no unit test files exist (confirmed: `find src -iname "*.test.*"` → empty). A
  separate Playwright E2E suite exists for Arena's own product features — not run this checkpoint,
  not part of what M0–M12 above track.

---

## 14. Known Limitations

**Inside the JennySol×Arena integration (M0–M12), all closed except these low-priority items:**
- M1's live-Gemini-API test re-run is still open (low priority — real API calls have since been
  proven live three separate times through M6/M7/M9, just not through M1's own original test
  file).
- Phase 6 security tests #11 (Arena session-JWT leakage into JennySol) and #12 (refresh-token
  leakage) remain genuinely BLOCKED — not because of missed work, but because neither mechanism
  exists anywhere in this integration's real call paths to test against.
- `IntentCardView.tsx` (Arena FE) is real but unwired to `/actions/:actionId` — approvals today
  only work via direct API call, not a real user-facing button.
- A stray, unused `SERVICE_TOKEN_SECRET_ARENA`/`JENNYSOL_GATEWAY_URL` pair sits on the wrong,
  orphaned `Vikisol-Arena` Railway project (harmless — that project serves no real traffic — but
  should be cleaned up by someone with dashboard access; this session's own permission classifier
  blocked the CLI delete).

**Outside the integration — real Arena product gaps, found this checkpoint, NOT fixed (per this
checkpoint's own instruction not to fake a fix):**

1. **Arena's web frontend defaults to mock mode in real production.** `arena-web/src/lib/api/mode.ts`'s
   `isRealMode()` returns `process.env.NEXT_PUBLIC_API_MODE === "real"`. Pulled Vercel's real
   Production env for the `arena-web` project (`vercel env pull --environment=production`):
   `NEXT_PUBLIC_API_MODE=""` and `NEXT_PUBLIC_API_BASE_URL=""` — both empty (confirmed against a
   correctly-populated control value in the same pull, `VERCEL_ENV="production"`, ruling out a
   pull-mechanism artifact). **26 of 31 files in `arena-web/src/lib/api/` branch on this flag** and
   serve `localStorage`-backed mock data to real visitors today: `applicationsStore.ts` (shared by
   candidate + enterprise application views), `messages.ts`, `myBids.ts`, `interviews.ts`,
   `companies.ts`, `follows.ts`, `blocks.ts`, `companyPosts.ts`, `companyAdmin.ts`, `enterprise.ts`,
   and others. Only `apiHealth.ts`, `httpClient.ts`, `paged.ts`, `shared.ts` don't reference the
   flag (infrastructure, not features). Arena's real backend for these features is fully
   functional — this same integration's own M7/M11 verification used
   `ApplicationController`/`ApplicationService` directly and it worked correctly, repeatedly.
   **Priority: very high** — this is very likely the single most consequential piece of product
   work available, and it's a real, live discrepancy between "what the backend can do" and "what
   real users actually see."
   **Recommended next step**: do NOT flip the flag globally in one shot — pick one feature (jobs
   listing is the safest starting candidate, since it's read-only and the tool-calling integration
   already proves the underlying endpoint works), verify its real API contract shape matches what
   the frontend expects, convert just that one file, and expand from there.
2. **Arena's uploaded-file storage is not durable in production.** `LocalDiskFileStorageService`
   is the only `FileStorageService` implementation; its own comment says "not durable across
   redeploys, which is fine since this phase never deploys anywhere" — stale, since `arena-api` is
   genuinely live on Railway today. No Cloudinary dependency exists anywhere (`grep -rn
   "cloudinary"` → no matches in `pom.xml`/`application.yml`), and `railway.toml` declares no
   volume mount for the uploads directory. Every CV/profile photo is lost on the next redeploy or
   restart. `FileStorageService`'s interface is deliberately built for a one-class swap to
   Cloudinary — the swap itself needs real Cloudinary credentials this environment didn't have.
   **Priority: high**, but blocked on credentials, not on architecture.
3. **Two Vercel projects exist under this account with no local clone and unconfirmed purpose**:
   `arena-recruiter-frontend` and `vikisol-one-fe` (presumably HRLMS's frontend, serving
   `hrlms.vikisol.in`). Confirm what they are before assuming either is stale, abandoned, or
   safe to ignore.

---

## 15. Important Bugs Found and Fixed (chronological, across all milestones)

1. **M5**: jjwt's bare `signWith(key)` on Arena's issuing side silently upgraded HS256→HS384 for a
   sufficiently long key, which would have made every Arena-issued token unverifiable by
   JennySol's strict `algorithms: ["HS256"]` allowlist. Fixed: explicit `signWith(key,
   Jwts.SIG.HS256)`.
2. **M6**: `arena.searchJobs`'s default base URL was missing Arena's real
   `server.servlet.context-path: /api/v1` — a real Gemini call correctly decided to call the tool,
   but the HTTP request 404'd. Found by running the real flow, not by unit-testing in isolation.
3. **M7 (found while preparing live verification)**: `RealAgentServiceClient`'s `DEFAULT_SCOPE`
   only ever granted `arena.searchJobs`, never `arena.applyToJob` — meaning no real user's
   real-trigger-path token could ever have reached the write tool at all, despite it being fully
   implemented and tested. Fixed: TALENT accounts now get both scopes.
4. **M7 (infrastructure, not code)**: JennySol's production Railway service has no GitHub
   integration; production was still running pre-M6 code until `railway up` was run directly. Also:
   the shared secret was first (mistakenly) set on the wrong, orphaned `Vikisol-Arena` Railway
   project before `railway status`'s `url` field revealed the real production service.
5. **M8**: `pendingActions.consumeAction` compared `product`+`externalUserId` only, never
   `tenantId`, despite `ProductIdentity` modeling `tenantId` as a real, independent dimension.
   Fixed defense-in-depth.
6. **M10**: Arena's `AgentServiceTokenVerifier` (`Jwts.parser().verifyWith(SecretKey)`) accepted a
   token signed with HS384 using the correct secret — the verifying-side counterpart to the M5
   issuing-side bug, found by a dedicated adversarial test, not by normal test-suite maintenance.
   Fixed: explicit post-parse algorithm check against `"HS256"`.
7. **M10 (test infrastructure, not product code)**: a test-ordering bug in
   `agentGateway.audit.test.ts` sorted correlation IDs by their own random UUID string instead of
   real request order, occasionally interleaving two separate requests' audit trails in the test's
   own assertions. Fixed by ordering on each correlation ID's first row.

---

## ADR References

Five ADRs exist under `docs/architecture/` in the JennySol repo (published early in this
integration, before Arena was a real connector):
- **ADR-002**: why a generic `ProductConnector`/`ToolRegistry` exists rather than the chat loop
  knowing about individual products directly.
- **ADR-003**: why `ProductIdentity`/service tokens exist as their own concept, never reusing
  JennySol's own session mechanism or a product's real session JWT; "a token whose scope doesn't
  include the tool being called is rejected server-side, not merely hidden in the UI"; "Arena
  tools re-derive authorization independently" (the principle behind the round-trip token design
  and Arena's own `AgentServiceTokenAuthenticationFilter`).
- **ADR-004**: the propose→approve→execute design for WRITE-tier tools.
- Two more ADRs exist covering earlier architecture decisions — read them directly, don't take this
  summary as a substitute.

A full architecture diagram was also published as a Claude artifact early in this integration:
`https://claude.ai/code/artifact/20ce7dcb-015f-42d8-b925-b10f818b3663` (sections "Current
Architecture" and "Intended Vikisol Ecosystem Architecture") — may be stale relative to this
document by now; prefer this document and `PROJECT-PROGRESS.md` for anything that conflicts.

---

## Environment / Configuration Expectations (no secret values)

**JennySol server**, real env vars in use (see `server/.env.example` for the full documented set):
`GEMINI_API_KEY`, `SERVICE_TOKEN_SECRET_ARENA` (shared with Arena — must match exactly),
`GIT_COMMIT_SHA` (set manually before every `railway up`, or the reported build version goes
stale), `TAVILY_API_KEY`, `GEMINI_MODEL`/`GEMINI_IMAGE_MODEL`/`GEMINI_TTS_MODEL`, `LLM_PROVIDER`/
`LLM_PROVIDER_CHAIN`, `CORS_ORIGIN`, `FRONTEND_URL`.

**Arena backend**, real env vars relevant to the agent integration: `SERVICE_TOKEN_SECRET_ARENA`
(must be the exact same value as JennySol's), `JENNYSOL_GATEWAY_URL` (JennySol's real gateway base
URL, e.g. `https://api.jennysol.vikisol.in`). Both are currently set and matching in real
production — do not regenerate either without also updating the other side, or the whole
integration goes dark (fails closed, not open — `isAvailable()`/`isConfigured()` checks everywhere
mean a missing/mismatched secret silently disables the feature rather than breaking auth).

**Arena frontend**, real env vars: `NEXT_PUBLIC_API_MODE` (currently empty in production — see
[Known Limitations](#known-limitations) item 1), `NEXT_PUBLIC_API_BASE_URL` (also empty),
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `JWT_SECRET`/`JWT_ISSUER`/
`JWT_AUDIENCE` (Arena FE's own, unrelated to the service-token secret above), Sentry vars.

**Never** put any of the above secret *values* in a commit, a doc, or a log line. Presence/length/
prefix only, when you need to report on them at all.

---

## Railway / Vercel Project Names (safe to document — no secrets)

| Project | Platform | Real service name | Notes |
|---|---|---|---|
| `jennysol-ai-api` | Railway | `jennysol-api` | JennySol server. No GitHub auto-deploy. |
| `arena-staging` | Railway | `arena-api` | **The real Arena backend**, despite the project name. |
| `Vikisol-Arena` | Railway | `Vikisol-Arena-BE` | **Orphaned/failing** — do not confuse with the above. |
| `jennysol-ai` | Vercel | — | JennySol client. |
| `arena-web` | Vercel | — | Arena frontend. |
| `vikisol-one-fe` | Vercel | — | Presumed HRLMS frontend — unconfirmed. |
| `arena-recruiter-frontend` | Vercel | — | Unconfirmed purpose. |
| `vikisol-website-9ewo` | Vercel | — | Main `vikisol.in` site. |

---

## What the Next Claude MUST Do First

1. **Read this document fully, then `PROJECT-PROGRESS.md` fully** — don't start coding from a
   partial read of either.
2. **`git fetch` both `Jennysol-AI` and `Vikisol-Arena-BE` (and `Vikisol-Arena-FE` if touching the
   frontend), inspect `origin/main` for anything past the SHAs in
   [Exact Current State](#exact-current-state)**, and integrate/preserve any concurrent work before
   changing anything — this happened multiple times during this very checkpoint (three separate
   times on the JennySol repo alone) and is a normal, expected occurrence, not a crisis.
3. **Confirm the recovery tags still exist** (`git tag -l`) before doing anything destructive.
4. **Decide, with the user, whether to tackle the Arena frontend mock-mode gap or continue
   expanding the AI-agent write-tool surface** — both are legitimate next steps; the mock-mode gap
   is almost certainly higher product value, but it's the user's call, not an assumption to make
   unilaterally.
5. **If touching either service-token verifier again, run the algorithm-confusion adversarial
   tests first** (`security.adversarial.test.ts`, `AgentServiceTokenVerifierTest.java`) before and
   after your change — this bug class has recurred twice already.

## What the Next Claude MUST NOT Do

- **Must not** invent a parallel memory system, tool registry, approval mechanism, or audit log —
  all four already exist, are real, and are tested. Extend them.
- **Must not** flip `NEXT_PUBLIC_API_MODE` to `"real"` for all 26 files in one commit without
  verifying each feature's real API contract first — a blanket flip risks shipping broken UI
  against endpoints whose shape doesn't match what the mock layer promised.
- **Must not** activate additional write tools (`arena.unlockCandidateContact`, `arena.placeBid`,
  etc.) as a "quick win" without going through the same rigor M7 did (propose→approve→execute,
  real live verification, real tests) — the infrastructure is ready, but each new write tool is a
  new real consequential action and deserves the same care.
- **Must not** force-push, delete the recovery tags, or assume a stale local `git status` — always
  fetch first.
- **Must not** log, persist, or paste a raw service token, JWT secret, or API key anywhere,
  including into this document or `PROJECT-PROGRESS.md`. Mask if you need to report presence.
- **Must not** mark a milestone or a fix "DONE" without CODE + TESTS + a real, run VERIFICATION —
  this document and `PROJECT-PROGRESS.md` have enforced this rule from the very first milestone;
  don't be the session that breaks it.

## Recommended Development Order

1. Fix or at least triage the Arena frontend mock-mode gap (highest product value found this
   checkpoint) — OR continue AI-agent write-tool expansion, per the user's actual priority.
2. If expanding write tools: `arena.unlockCandidateContact` is the next-safest candidate (spends a
   real credit, already has a pessimistic-lock race-condition fix from a prior session) — follow
   the exact M7 pattern.
3. Wire `IntentCardView.tsx` to `/actions/:actionId` so approvals have a real UI, not just an API.
4. Address the Arena file-storage durability gap once Cloudinary credentials are available.
5. Investigate the two uninvestigated Vercel projects.
6. When HRLMS work begins: repeat the exact M2→M12 sequence Arena went through, don't shortcut it.

---

*This document was written at the end of a Windows→Mac engineering handoff checkpoint,
2026-09-11, by direct inspection of both repositories, real test runs, and real (masked)
production configuration checks — not from memory or a prior conversation summary. Keep it
updated at the next major hand-off point; don't let it silently go stale the way this checkpoint
found `LocalDiskFileStorageService`'s own comment had.*
