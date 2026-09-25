# Vikisol ecosystem — takeover audit

Reviewed 2026-09-26. Audit and handoff only; no application code, configuration, deployments, commits, or existing work were changed.

## Scope and evidence

Read both supplied conversation transcripts; inspected the six repositories, recent commits, staged/unstaged diffs, architecture/design documents, and representative implementation paths. Also consulted the workspace guide and relevant downloaded Arena/Jenny briefs referenced by the repositories. This is a cross-product architecture and implementation review, not a claim to have inspected every source line or proven every production journey.

Evidence labels used below:

- **Code:** present in the working tree, including uncommitted changes; does not imply deployed.
- **Tested:** exercised locally during this audit.
- **Historical:** reported in earlier documents; not independently reverified today.
- **Unverified:** requires further runtime, product, or deployment evidence.

The attachment referring to a downloadable master DOCX contains a summary and conversation, not that DOCX's full contents. The Claude artifact itself was not retrieved; local architecture documents were used instead. Local `origin/main` references were inspected without fetching, so synchronization statements are relative to the last fetched remote state. Git author fields do not reliably identify which AI wrote a change; “Claude's work” here means the existing work presented for takeover.

## Product understanding to preserve

Vikisol connects people, intelligence, and organizations while retaining separate product ownership.

| Product | Purpose | Owns |
|---|---|---|
| Arena | A living network where people post needs, find people, meet, collaborate, and work | Profiles, posts, activities, jobs, applications, companies, bids, rooms, permissions |
| JennySol | AI execution and assistance, eventually an AI workforce platform | Conversations, runs, sessions, orchestration, model routing, tools, AI memory and RAG |
| Vikisol One / HRLMS | Organization-controlled workforce operations | Employees, HR records, payroll, organizational roles and workflows |
| Website | Public company and ecosystem entrance | Marketing content, product explanations, public navigation |

Arena's north star remains **NEED → RESPONSE → CONVERSATION → OUTCOME → IDENTITY → NEED**. Daily usefulness must extend beyond recruitment. Jenny should help in the context of the user's current task, with visible, explicit approval for consequential actions.

JennySol must use scoped product APIs, never another product's database. Shared identity is a future ecosystem capability; identity must not confer automatic HR access. No fabricated network activity, outcome claims, or autonomous execution claims. Preserve working functionality and use bounded changes instead of another redesign/rewrite.

## Repository snapshot

| Repository | HEAD at review | Working state before audit |
|---|---|---|
| Website | `c292654` | Clean |
| Arena frontend | `b505408` | Untracked `verify-close.mjs` |
| Arena backend | `49aa9ab` | Modified service-token filter and wrapper mode; untracked action entities/repository, V17 migration, scope test |
| JennySol | `ad72148` | Two commits ahead of local `origin/main`; substantial staged and unstaged work plus new untracked provider/tiering files |
| One frontend | `d352e7b` | Clean |
| One backend | `247ec61` | Clean |

Do not reset, clean, stage wholesale, or overwrite the unfinished changes. JennySol's image-worker changes and Arena gateway/provider changes are separate concerns that should be reviewed and completed separately.

## Architecture as implemented

### Website

Next.js 14 / React 18, Pages Router, with the app under `ashley/`. Markdown-driven products, services, projects and posts live under `ashley/src/data`; rendering is under `ashley/src/pages`. Recent work covers entrance animation/Strict Mode behavior, services layout, and spacing. It remains a public front door.

`VIKISOL_WEBSITE_OPEN_REQUIREMENTS.md` records unresolved contact/newsletter configuration and business-copy decisions. These are historical requirements, not freshly verified production failures.

### Arena

Frontend: Next.js 16 / React 19 / TypeScript / Tailwind, App Router. `src/lib/api` contains domain clients; mock implementations still exist behind `NEXT_PUBLIC_API_MODE`. The default in `src/lib/api/mode.ts` is mock unless explicitly set to `real`; this does **not** prove production is in mock mode.

Backend: Java 21 / Spring Boot 3.3 modular monolith, REST controllers, Spring Security/JPA, PostgreSQL, Redis integration and Flyway migrations. Current modules include authentication, profiles, posts, follows/blocks, jobs/applications, projects/bids, companies/enterprise, rooms/messages, search, communities, moderation, notifications and agent integration. This is not the NestJS/GraphQL/Python architecture described in the old frontend `CLAUDE.md`.

The meetup implementation lives mainly in `posts/`, particularly `PostService`, `PostMapper` and `PostLifecycleScheduler`. The separately named `activity/ActivityService` records agent activity events; it is not the meetup lifecycle service.

Recent paired frontend/backend commits implemented mixed Home content, guest browsing, activities, media uploads through Cloudinary, global search, discussion voting/threaded replies, communities/moderation and anonymous posts/replies/chats. These are real source implementations, not just a blueprint. Full user-journey correctness remains a separate question.

### JennySol

React 18 / Vite client; Express / TypeScript server; SQLite via `better-sqlite3`. Main implementation families:

- `chatRunner`, `agentRunStore`, `runBus`: chat execution, durable run/event records, streaming.
- `modelRouter`, `models/modelRegistry`, provider adapters: model selection, availability, retries, fallback, timeouts and optional hedging.
- `embeddings`, `chunker`, `vectorStore`, `contextManager`: document retrieval and context.
- `agentSessionStore`, `agentTaskDag`, `agentRegistry`, `agentScheduler`, `agentOrchestrator`, `agentSessionRunner`: multi-agent sessions, dependencies, roles, budgets and execution.
- `agentToolRegistry`, `agentWorkspace`, `agentCommandTool`, `agentFileLocks`: internal development-agent tools and approvals.
- `productIdentity`, `serviceToken`, `tools/toolRegistry`, `productConnectors/arena`, `routes/agentGateway`: external product identity and scoped connector boundary.
- Admin session pages provide a control surface; consumer chat/voice is a distinct experience.

This is much further along than “chat wrapper plus a future agent plan.” The opening “no implementation has started” sentence in `AI_AGENT_IMPLEMENTATION_PLAN.md` is stale even relative to later paragraphs in the same document.

The historical reasoning-routing defect has code fixes in `modelRegistry.ts`, including explicit reasoning classification and specialist selection. Do not reimplement it based solely on the old transcript. Current model availability, actual latency and production routing still require live measurement.

### Vikisol One

React 19 / Vite frontend, Java 21 / Spring Boot backend. It already has substantial employees, onboarding, attendance, leave, payroll, recruitment, offboarding, documents/templates, policies, reporting, assets and settings code. Recent commits cover bulk employee import, configuration backup/restore, preferences and payslips. Describing it as only a repository foundation understates the current source.

`ARCHITECTURE.md` describes domain API modules and page folders, plus a large shared `DataContext`. Multi-tenant SaaS isolation is not certified by this audit. Microsoft sign-in is explicitly an unimplemented backend endpoint, not merely an implemented feature awaiting credentials (`MicrosoftAuthController`). No HR production access or changes were made.

## Current visual and information architecture

The transcripts and several specs conflict with current implementation. Preserve current code until a specific product decision authorizes a change.

| Surface | Current evidence |
|---|---|
| Arena | Dark backgrounds `#09090b`, orange `#ff6b35`, light text. `home-v3/tokens.ts` explicitly records a September 25 founder decision replacing ivory/gold. Local Inter/Space Grotesk work is in recent history. |
| JennySol | Warm near-black, ivory text, champagne/gold accents, Fraunces voice typography and an orb. `JENNYSOL-UI-SPEC.md` documents this separate product identity. |
| Website | Existing public editorial/animated site; preserve its established presentation. |

Arena's actual primary navigation is **Jenny / Nearby / Discuss / Work / Inbox** (`AppShell.tsx`), with profile and other utilities secondary. `/home` now contains a mixed feed, despite its tab being called Jenny and an old shell comment saying “not a feed.” The Home Jenny input is disabled and explicitly says coming soon.

The original Feed/Discover/Map/Agent/Work vision has therefore evolved through several iterations. Mixed feed, local activity and discussions support the daily-network goal, but labeling the feed Jenny while Jenny is disabled creates a comprehension gap. Resolve this explicitly; do not silently restore an older route hierarchy.

## Findings to address before broader implementation

### 1. High — workspace boundary does not contain filesystem access

**Code and isolated reproduction.** `server/src/services/agentWorkspace.ts` checks `path.resolve` plus a string-prefix boundary. It never resolves symlinks. `agentToolRegistry.ts` subsequently reads/writes through the accepted path with filesystem APIs that follow symlinks. A link inside an allowed workspace can reach outside it.

An isolated probe created a harmless file outside a temporary workspace and a link inside it. The current resolver accepted the link, and the file read succeeded. No real private files were accessed.

The workspace defaults to the application repository itself; file reads have no explicit secret-file restriction. `agentCommandTool.ts` permits `npm run/install/ci/test` and uses inherited process environment. That is a command allowlist and approval gate, not an OS sandbox: project scripts/dependency hooks can execute arbitrary code with host privileges. Treat development-agent execution as trusted-admin functionality until isolation, minimal environment, secret handling and filesystem containment are hardened.

### 2. High — activity approval does not bind the join request to its post

**Source-confirmed missing check; not exploited against production.** Arena `PostService.decideJoin` checks ownership of `postId`, then independently loads `joinRequestId`. It does not check `joinRequest.getPost().getId()` against `postId` before changing status and applying room/participant side effects.

The controller passes both route IDs directly to this service. Someone who owns one post and obtains another post's pending join-request ID could attempt to act on that request using their owned post as the authorization anchor. Bind the request to the post at lookup and add cross-owner regression coverage.

### 3. High — activity capacity and lifecycle approval gates are incomplete

`decideJoin` does not reject approval because a post is full/cancelled/expired, or because capacity has been reached. `onJoinApproved` increments the count and only then marks the post full. Existing pending requests can therefore be approved after capacity is exhausted, even sequentially.

The inspected path also uses ordinary repository reads without an optimistic version/pessimistic lock or atomic capacity update. Concurrency needs an integration test against the database. `PostJoinStatus` currently has only PENDING/APPROVED/DECLINED; the proposed withdrawal, attendance, no-show and outcome/reputation lifecycle is not complete.

### 4. High product gap — Arena/Jenny action integration is unfinished

JennySol's working changes add history/context, difficulty tiers, an Anthropic adapter, connector instructions, search/nearby/community tools and post/join/project/bid actions.

Arena `RealAgentServiceClient.java` still:

- sends only `{message}`;
- issues only `arena.searchJobs` and, for TALENT, `arena.applyToJob` scopes;
- extracts only response `content`, dropping `pendingActions`.

New `AgentAction` entities, repository and V17 SQL exist as untracked work, but no service/controller uses that repository yet. Home's conversational input is disabled. Backend token-filter expansion alone cannot complete the product flow.

Complete request context/history, scoped tool exposure, pending-action persistence/DTOs, explicit approve/decline APIs, UI cards, authoritative result reporting and failure/expiry behavior together. A passing connector unit test does not prove this cross-repository contract works.

### 5. Medium — pending approvals are volatile and wrong-owner attempts consume them

JennySol `tools/pendingActions.ts` stores executable actions in an in-process Map with a five-minute TTL. Restarting the process loses them; adding an Arena SQL row does not make the executable proposal durable across services.

`consumeAction` deletes an action **before** checking requester ownership. An isolated probe confirmed that another identity is rejected but the rightful owner can no longer use the action afterwards. This is denial of approval if an ID is learned, not unauthorized execution. Validate identity before destructive consumption and define durable/idempotent action semantics before scaling.

### 6. Medium — data failures are rendered as empty feed lanes

`HomeContent.tsx` catches post/job/project fetch failures and replaces results with empty arrays. This can make failed loading look like a quiet network or silently remove one content type. Distinguish loading, empty, partial failure and retry states.

Home also composes a bounded set of posts plus jobs and projects on the client using round-robin mixing. That provides variety, but is not a unified ranked/paginated feed covering the whole network.

### 7. Medium — demo provenance is lost at the AI boundary

Arena has explicit demo content flags and a visible post badge. `DemoActivityRefresher` deliberately rolls demo activities forward when demo mode is enabled. This is gated demo behavior, not evidence of fabricated real activity in production.

However, JennySol's new `slimPost`, `slimJob` and `slimProject` tool-result shapes drop `demoContent`. If the API returns seeded results, Jenny cannot reliably distinguish them from real opportunities. Preserve and explain provenance or exclude demo content from real recommendations. Verify badges on every relevant surface; the presence of one badge component is insufficient.

### 8. Architecture gaps — privacy, scale and identity

- The inspected router/provider request contract does not enforce the target LOCAL / PRIVATE / PUBLIC_CLOUD sensitivity policy. Local-first fallback is not a privacy guarantee.
- SQLite persistence and in-memory runners/approvals/event fanout have single-process assumptions. A working local suite is not distributed-worker readiness.
- Agent marketplace, independently deployable customer agents, enterprise policy, and full cross-product SSO are not established by the inspected implementation.
- One's Microsoft OAuth flow remains a stub; no One connector is present alongside JennySol's Arena connector.
- Arena session tokens remain explicitly pinned HS256. The later proposed asymmetric migration is not implemented. Pinning is good; the absence of migration should not be misreported as the previously fixed algorithm-confusion bug.

## What the unfinished image work actually changes

Committed JennySol `39bae51` added image-provider fallback; `ad72148` contains phone UI fixes. Staged work replaces the Qwen-specific local-image wrapper with generic `sdCli` / `localImage` modules and defaults to `z-image-turbo`, retaining an optional Qwen preset. Image generation shares a local inference slot with Ollama and has cloud fallback.

The source/docs record performance and licensing reasons for this switch. Those are historical measurements/claims; no model download, image benchmark or independent license determination was performed in this audit. Complete and validate this work as its own batch, including actual worker availability and memory contention.

## Blockers: current facts versus historical reports

| Item | Audit disposition |
|---|---|
| Enterprise path blocked by 2FA | Later Arena `GROUND-TRUTH.md` §0.3 records successful authenticated dashboard, talent and postings verification. Historical gap closed in that report; no new live verification today. |
| Production “all mock” claim | Already corrected in supplied history. Local mock default is not production evidence. |
| Missing DeepSeek production key | Historical JennySol blocker; current production variables not inspected. |
| Mac power/sleep, firewall, Tailscale ACL | Historical operational blockers requiring fresh inspection; no machine settings changed. |
| Sentry ingest rejection | Arena `BLOCKERS.md` records it; current ingest not tested. |
| Retired Railway database billing/credentials | Historical infrastructure cleanup item; no deletion or credential changes authorized/performed. |
| Website forms/newsletter | Existing requirements document records missing configuration; production not retested. |
| App-store/legal/account deletion requirements | Earlier JennySol document lists work; no release readiness or legal conclusion made here. |
| Shared identity/One authorization | Future ecosystem architecture, not a toggle or frontend login change. |

## Validation performed today

| Check | Result |
|---|---|
| JennySol full backend Vitest suite | **68 files passed; 676 tests passed, 2 skipped** |
| JennySol backend `tsc --noEmit` | Passed |
| Arena frontend `tsc --noEmit --incremental false` | Passed |
| Arena targeted backend tests: RealAgentServiceClientTest, AgentScopeMappingTest, AgentServiceTokenVerifierTest | **15 tests passed**, Maven exit 0 |
| Temporary symlink containment probe | Reproduced boundary escape using harmless fixture |
| Temporary pending-action ownership probe | Reproduced action loss following rejected wrong-owner request |

JennySol tests ran in a temporary copy of `server/src`, package and TypeScript config, with existing dependencies linked in. This protects the real `server/data/jennysol.db`: `db/index.ts` otherwise hardcodes that location and tests write real SQLite rows. No production model calls or full browser/phone acceptance suite were intentionally run. No full Arena backend suite, migration validation, Website/One builds, or production deployment parity check was performed.

Audit test log: `/tmp/vikisol-jenny-audit-tests.log`. Targeted Java test log: `/tmp/vikisol-arena-audit-tests.log`. Logs and temporary fixtures are local, non-versioned evidence.

## Proposed continuation, without a rewrite

1. Establish a reviewed baseline of the existing staged/unstaged work; reconcile stale architecture/status references and record the actual current visual/navigation decisions. Do not discard the current changes.
2. Close the concrete authorization, capacity and agent containment defects above with focused regression tests. Make approval lifecycle semantics explicit.
3. Finish one end-to-end Arena/Jenny journey: find a real relevant activity → propose joining → show explicit approval → call Arena → confirm actual result → open its room. Include denied, cancelled, full, expired, duplicate and unavailable-service cases.
4. Make Home's Jenny/feed labeling and input behavior match the agreed experience. Preserve mixed feed and the existing brand; report partial network failures honestly.
5. Audit the complete activity/outcome lifecycle against the original goal: withdrawal, attendance, no-show, cancellation, room state, location privacy and trustworthy identity outcomes. Build only verified missing pieces.
6. Complete image-worker work separately; then measure real chat/voice latency, provider costs and local-resource contention. Implement privacy routing before promising private-only processing.
7. Validate deployed journeys and build parity on candidate and enterprise accounts and a real phone. Only then label a batch shipped.
8. Treat shared identity, One multi-tenancy/AI access and public AI workforce offerings as later explicit architecture milestones, preserving each product's authorization/data boundary.

The ecosystem has substantial reusable implementation. It has not covered everything in the vision. The next useful work is completing and securing the existing user journeys, with evidence, rather than adding another architecture or design system.
