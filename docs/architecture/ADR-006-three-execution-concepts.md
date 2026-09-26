# ADR-006 — Reconciling AgentRun, AgentSession, and AgentGoalRun

**Status:** Accepted. Written 2026-09-26, per `docs/AGENT-COLLABORATION-PROTOCOL.md` §5's explicit
requirement to reconcile these three before extending Goal Mode further.

**Why this exists:** three genuinely different things in this codebase are all called some
variant of "agent run/session," and it is easy — I nearly did this myself — to assume two of them
overlap or that one supersedes another, when direct inspection shows they don't. This ADR is the
record of that inspection, so no later agent re-derives it or, worse, guesses wrong.

## The three concepts, verified by direct inspection (not assumed)

### 1. `AgentRun` — one chat turn's transport durability
**File:** `server/src/services/agentRunStore.ts`. **Table:** `agent_runs`.
**Scope:** one HTTP chat request/response in JennySol's own chat UI.
**Purpose:** survive a disconnect/refresh mid-stream. States: `queued → running → streaming →
completed/failed/cancelled`.
**Audience:** invisible infrastructure — no user or admin ever sees "an AgentRun" as a concept.
**Tools/planning:** none. It wraps a single model call, not a sequence of decisions.

### 2. `AgentSession` — the internal AI-engineering orchestrator
**Files:** `server/src/services/agentSessionStore.ts`, `agentScheduler.ts`,
`agentSessionRunner.ts`, `agentToolRegistry.ts`. **Tables:** `agent_sessions`, `agent_tasks`,
`agent_session_events`, `session_memory`, `file_locks`, `user_decisions` (per
`docs/AI_AGENT_SYSTEM_ARCHITECTURE.md` §5, which is itself the authoritative design doc for this
subsystem — this ADR doesn't repeat it, only places it relative to the other two).
**Scope:** many logical sub-agents (roles: Frontend, Security, QA, …) working a **task DAG** to
build or modify **JennySol/Arena's own codebase** — an AI engineering team, not a product feature.
**Purpose:** let multiple LLM-driven "workers" collaborate on real software engineering (file
edits, running tests, audits) with a scheduler arbitrating real execution slots against real
hardware limits, a resource budget, and file locking so two agents never silently clobber the same
file.
**Audience:** founder/admin only (`/admin/AgentSessions`, `RequireAdmin`-gated per the
architecture doc's own explicit correction in its §8 — **not** `/agents` or `/tasks`, which are
ordinary user-facing product pages for something else entirely).
**Tools:** its own `agentToolRegistry.ts`, keyed by `(sessionId, agentId)` + a permissions field —
**deliberately not** `ProductIntegrity`/`ToolRegistry` (the Arena-facing one). The architecture
doc's own §2 already worked through why reusing the product tool registry here would be the same
category of mistake as letting Jenny reach Arena's database directly: internal engineering tool
access and external-product tool access are different trust boundaries, and conflating them was
considered and explicitly rejected before this was built.
**Status:** real, wired in (`resumeInFlightSessionsOnBoot()` runs at server boot, `src/index.ts`),
tested (6 test files: `agentSessionStore`, `agentScheduler`, `agentSessionRunner`,
`agentSessionControl`, `agentToolRegistry`, `adminAgentSessions.http`).

### 3. `AgentGoalRun` — end-user goal execution through real product tools
**Files:** `server/src/services/agentRuntime/` (new, this run — STEP 5 of
`JENNYSOL-FINISH-ALL.md`). **Tables:** `agent_goal_runs`, `agent_goal_run_steps`.
**Scope:** one Arena or JennySol *user's own* multi-step request ("find and join an activity",
"research X"), planned and executed with **real product tools** — the same `ToolRegistry` /
`ProductIdentity` / `pendingActions` Arena's live gateway already uses.
**Purpose:** this is what `VIKISOL-MASTER-CONTEXT.md` §6.3/§6.8 calls "Goal Mode" — plan → execute
→ observe, with budgets and a stoppable, resumable, approval-gated run, for a real product user,
not for an internal engineering session.
**Audience:** the end product user (Arena or JennySol), surfaced eventually through the run/
approval dashboard (`docs/design/run-dashboard-option-a-timeline.html`).
**Tools:** the existing product `ToolRegistry` (Arena's 9 tools + JennySol's own 3 — STEP 5),
scoped by `ProductIdentity`, exactly the same trust boundary the live Arena gateway already uses —
**not** the internal `agentToolRegistry.ts`.
**Status:** real, tested (8 tests), proven live against real Gemini (3/3 scenarios,
`docs/JENNYSOL-EVAL-RESULTS.md`) — but not yet merged to `main`, and missing the re-planning
sophistication and dashboard UI (`docs/BLOCKERS.md`).

## The verdict: no redundancy, no merge — but three real risks to manage going forward

**These three concepts are not competing implementations of the same thing.** Different audience
(invisible infra / founder-only engineering tool / end product user), different tool boundary
(none / internal file-and-command tools / external product tools), different data model (one row
per turn / a DAG of many tasks across many logical agents / a linear step list for one user's
goal). None of them should be deleted, merged, or have its scope absorbed into another.

**What genuinely needs attention, going forward:**

1. **Naming discipline.** `AgentRun`, `AgentSession`, `AgentGoalRun` are close enough in name that
   a future agent (or a doc, as `VIKISOL-MASTER-CONTEXT.md` itself already does in §6.3/§13,
   conflating "AgentRun" with what this ADR calls `AgentGoalRun`) can easily mean one while reading
   about another. **Rule going forward: any doc or code comment using "AgentRun" for the goal-mode
   concept should be read/written as `AgentGoalRun`.** `VIKISOL-MASTER-CONTEXT.md` §13's glossary
   already carries a note to this effect (added 2026-09-26).
2. **Shared substrate, not shared boundary.** All three ultimately call `routeChatCompletion()` for
   their actual model calls — that's correct and intentional (the model/provider/router layer is
   explicitly "solid, reusable as-is" per the architecture doc's own §1/§2). What must **never**
   be shared is the tool boundary: `AgentSession`'s internal file/command tools must never become
   reachable from an `AgentGoalRun` (an end user must never be able to reach a file-write or
   shell-command tool through a goal), and a product's `ToolRegistry` tools must never become
   reachable from an internal engineering session's task the way `AgentSession`'s own architecture
   doc already independently concluded (§2). This ADR is the second, independent confirmation of
   that same boundary from the goal-mode side — both sides arrived at the same answer separately,
   which is itself a good sign neither is wrong.
3. **A user-facing dashboard collision to avoid.** `AgentSession`'s dashboard is
   `/admin/AgentSessions` (founder-only, watching engineering work). `AgentGoalRun`'s eventual
   dashboard (STEP 5's mockups) is a **product-facing** run/approval view for an ordinary Arena or
   JennySol user watching their *own* goal. These must stay on visibly different routes with
   visibly different framing — a regular user must never land on a screen that looks like it's
   showing "AI engineers editing code," and an admin watching engineering sessions must never see
   it dressed up as if it were a customer-facing feature. Noted here so whoever builds the
   `AgentGoalRun` dashboard for real doesn't accidentally reach for `AgentSessions.tsx` as a
   starting template without re-reading this distinction first.

## What this ADR does NOT decide
- The internal `AgentSession` engineering system's own further development (Phase 2+ of
  `AI_AGENT_IMPLEMENTATION_PLAN.md`) is out of scope for the JennySol product mission
  (`JENNYSOL-NEXT.md`) — it's a separate, founder-tooling track with its own phased plan, and nothing
  in this ADR blocks or accelerates it.
- Whether `AgentGoalRun` should eventually *use* `AgentSession`'s scheduler/Resource Manager
  concept for its own concurrency management (both currently have separate, simpler concurrency
  handling). Worth a future ADR if `AgentGoalRun` usage ever grows enough to need real scheduling
  sophistication — not needed at today's scale (one run at a time, mostly).
