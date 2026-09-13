# AI Agent System — Implementation Plan

Written 2026-09-13. Companion to
[AI_AGENT_SYSTEM_ARCHITECTURE.md](AI_AGENT_SYSTEM_ARCHITECTURE.md) — read that first for the *why*
behind each phase below. **No implementation has started; this is the plan to review before Phase 1
begins**, per the founding directive's own instruction.

## How to read this plan

Each phase lists: what gets built, what already-existing code it builds on (never rebuilds), and
what "test, audit, review, document" means concretely for that phase — not a generic checklist
repeated 15 times. Phases are ordered so that every phase after Phase 4 has a real event log to
observe, which is what makes the founding directive's own "never fake autonomy" requirement checkable
from Phase 5 onward rather than promised until the UI exists.

**Realistic sizing**: this is a genuinely large platform. Phases 1-6 (the plumbing) are a solid,
scoped effort. Phases 7-15 (the actual 14 agent roles, the full QA/audit pipeline, the polished
dashboard) are where the real time goes, and are exactly where scope should be cut first if time
runs short — a working 4-role session (Orchestrator, Architect, Coder, QA) with real DAG execution,
real events, and a real dashboard proves the whole architecture; the other 10 roles are additive
from there, not a prerequisite.

**Sequencing decision (build order vs. phase numbers)**: per standing doctrine, the visible surface
gets built before the machinery behind it — but Phase 13 deliberately deferred the *live* dashboard
until real events exist to render, specifically so the UI is never built against invented data
(VIKISOL-BUILD-DOCTRINE.md §1/§3: "never fabricate activity"). Both are honored by splitting Phase
13 in two instead of picking one: the dashboard **shell** (layout, design system, `Agents.tsx`/
`Tasks.tsx` page structure, session/agent/task card components, empty states) is pulled forward to
right after Phase 1, as soon as there's a real (honestly-empty) `agent_sessions` table to query — it
renders "no active session" truthfully rather than a mock. Each phase from 2 onward that adds a real
event type wires that event into the already-built shell immediately, so the UI is never mocked and
never waits until Phase 13 to exist. Phase 13's remaining scope is only the parts that need many
phases' worth of real traffic to test properly (reconnect/replay under load, the full activity-feed
filter set, screenshots of a real Phase-12-scale session).

---

## Phase 1 — Session data model

**Build**: the six new tables from the architecture doc §5 (`agent_sessions`, `session_memory`,
`agents`, `agent_tasks`, `agent_session_events`, `file_locks`, `user_decisions`) via the existing
`addColumnIfMissing`/`CREATE TABLE IF NOT EXISTS` convention in `server/src/db/index.ts` — no new
migration framework. A minimal `agentSessionStore.ts` (create/read/update session, memory
read/write, task CRUD) mirroring `agentRunStore.ts`'s existing shape.

**Builds on**: `db/index.ts`'s existing schema convention; `agentRunStore.ts` as the direct pattern
to mirror (not extend — this is a parallel, session-scoped analog).

**Test**: unit tests on `agentSessionStore.ts` — create a session, write/read memory keys, insert
tasks with dependencies, confirm no cross-session leakage (same discipline as the existing
`conversationBelongsToUser`-style scoping checks elsewhere in this codebase).

**Audit/review**: confirm the `sessions` (auth) vs. `agent_sessions` naming collision risk is
actually avoided everywhere (grep both names through routes/services before this phase closes).

**Document**: schema reference appended to this repo's existing DB documentation location, matching
how `agent_runs`/`agent_events` are already described in the architecture doc rather than a new,
separate schema doc.

---

## Phase 2 — Agent registry

**Build**: CRUD over the `agents` table; a pure-logic "spawn an agent" function that only creates a
row (no model call, no process) — this is the phase that makes the logical-agent/execution-slot
split (architecture doc §6) concrete and testable before the scheduler exists to consume it.

**Builds on**: Phase 1's tables only.

**Test**: creating 50 agent rows costs no measurable resources beyond the DB write (a direct,
assertable test of the founding directive's own §31/§48 requirement) — this is a real regression
guard against ever conflating "agent count" with "model load count."

**Audit/review**: confirm `permissions` (architecture doc's per-role read/write scopes, §5) are
enforced by *something* even at this stage, even if only a static role→permission map for now — do
not let a permission field exist in the schema without a real enforcement point once tools are
wired (Phase 7).

**Document**: the role→capability→default-permission table, since this is what every later role
definition (Phase 9) will extend.

---

## Phase 3 — Task DAG

**Build**: `agent_tasks` dependency resolution — a task becomes `ready` when every task in
`depends_on` is `completed`; cycle detection on insert (reject, don't silently loop); a pure
function `readyTasks(sessionId)` with no side effects, directly unit-testable.

**Builds on**: Phase 1's `agent_tasks` table.

**Test**: the exact worked example from the founding directive's own §9 (`TASK-006` depending on
`TASK-004`+`TASK-005`, `TASK-012` depending on six upstream tasks) as a literal test fixture —
insert it, assert the readiness order matches the founding directive's own expected sequence exactly.

**Audit/review**: a task with a dependency on itself, or a genuine cycle (A→B→A), must be rejected
at insert time with a clear error — test this explicitly, don't just assume the topological check
handles it.

**Document**: the DAG's actual invariants (what "ready" means, what happens to a task whose
dependency fails — does it block forever, or does the Phase 12 correction-task mechanism reopen it)
— this is a real design decision to write down, not defer silently.

---

## Phase 4 — Event bus (session-scoped)

**Build**: `agent_session_events` writer (durable-first, matching `runBus.ts`'s own documented
discipline: SQLite write before publish, never the reverse) + an in-process `EventEmitter` keyed by
`sessionId` for live subscribers, with the exact same single-process caveat already honestly
documented for `runBus.ts`/`runCancellation.ts` — not a new architectural decision, the same one,
applied here.

**Builds on**: `runBus.ts` as the direct template (event log is authoritative; the emitter is a
convenience for live tailing, never a requirement for correctness).

**Test**: a subscriber that connects *after* several events were already written can replay them
from the DB (`?after=<id>`, mirroring `agent_events`'s existing pattern exactly) and see the
identical sequence a live subscriber saw — this is the concrete test of "the event log, not the
emitter, is truth."

**Audit/review**: confirm zero live subscribers never causes an event to be dropped (kill the one
subscriber mid-session, confirm events keep accumulating in the DB) — this is the single most
important property for the founding directive's own §42 "never fake autonomy" requirement, so it
gets its own explicit test, not an assumption.

**Document**: the event taxonomy actually implemented (a real list, not the founding directive's
illustrative one verbatim) — `session.created`, `task.ready/started/progress/completed/failed`,
`agent.spawned/status_changed`, `tool.exec.started/finished`, `file.locked/changed/unlocked`,
`memory.updated`, `checkpoint.started/completed`, `decision.raised/answered`, `audit.started/result`.

---

## Phase 5 — LLM provider abstraction touch-point

**Build**: nothing new in the provider layer itself (it's already solid, architecture doc §1/§2) —
this phase is exactly one integration function, `runAgentTask(task, agent)`, that assembles a
prompt from the agent's memory-read-scope (architecture doc §5) and calls the *existing*
`routeChatCompletion()`, writing progress/completion as `agent_session_events`.

**Builds on**: `modelRouter.ts`, `models/modelRegistry.ts` — used, not modified.

**Test**: a real, live call (not mocked) — one agent task, real model, confirm the resulting
`agent_session_events` rows match what actually happened (same "real end-to-end, not assumed"
standard this whole engagement has held to throughout). This is the first phase with something
genuinely worth a live-fire test.

**Audit/review**: confirm a failed model call (real provider error, or `AllProvidersUnavailableError`)
correctly marks the task `failed` with the real error attached, not silently retried or swallowed.

**Document**: the exact prompt-assembly rule (which `session_memory` keys a given role reads) as a
concrete table, since this is what makes context-bounding (architecture doc §5) auditable rather
than aspirational.

---

## Phase 6 — Model router integration (capability-aware task routing) + Resource Manager

**Build**: the Scheduler loop (architecture doc §6) and the Resource Manager: generalize
`ollama.ts`'s concurrency gate into a manager tracking local slots (from `HardwareProfile`),
per-provider health (from the *existing* `providerHealth.ts`, unmodified), a priority wait-queue for
`ready`-but-unslotted tasks, and hard budget counters (`max_token_budget`, `max_cost`,
`max_session_time_ms`) read from `agent_sessions`.

**Builds on**: `providerHealth.ts`, `hardwareProfile.ts`, `modelRegistry.ts` capability routing — all
reused unmodified; this phase is pure new orchestration logic sitting above them.

**Test**: the concrete scenario the founding directive itself describes (§48) — spin up far more
`ready` tasks than local concurrency allows, confirm only the hardware-permitted number ever reach
`running` with a real model call in flight simultaneously, the rest sit `queued` and are picked up
as slots free, in priority order. Also test hard-budget cutoff: a session at its token/cost/time
limit stops granting slots even with `ready` tasks waiting, and this is visible as a real event, not
a silent stall.

**Audit/review**: this is the phase where the "many logical agents, few real executions" claim
either holds up under real concurrent load or doesn't — treat any surprise here as a real finding to
fix before Phase 7, not a known limitation to document around.

**Document**: real measured numbers from the test above (how many concurrent tasks this Mac
actually sustains under real routing, not the theoretical `maxConcurrentLocalRuns: 1` figure alone —
cloud-routed tasks change the real achievable concurrency).

---

## Phase 7 — Tool system integration

**Build**: a new, small `agentToolRegistry.ts` — **not** `toolRegistry.ts`/`pendingActions.ts`,
corrected in the architecture doc §2 after inspection showed those are hard-wired to
`ProductIdentity` for Arena-style external callers; reusing them here would mean faking a product
identity for an internal agent, the exact cross-boundary shortcut this codebase already guards
against. The new module implements the same READ/WRITE-tier + propose→approve→execute *shape*, keyed
by `(sessionId, agentId)` + the `agents.permissions` field (Phase 2) instead: file read/write tools
gated by `file_locks` (architecture doc §7), command-execution tools, and a first real WRITE-tier
flow exercised by an actual agent task, not a test fixture standing in for one.

**Builds on**: `agents.permissions` (Phase 2), `file_locks` (Phase 1). Reuses only
`redactSecrets()` (the function) from the cross-product path, not its table or approval map.

**Test**: two agents both requesting a lock on the same file — one gets it, the other transitions to
`WAIT` (a real, visible status, not a silent block) and acquires it the moment the first releases —
this is the literal test of the founding directive's own §12 requirement ("never allow silent
overwriting").

**Audit/review**: every tool call an agent makes must produce a real `agent_session_events` row of
type `tool.exec.*` — confirm this holds for every tool path added in this phase, and that no such
event ever reaches `agent_audit_log` (that table stays cross-product-only, per the corrected §2).

**Document**: the exact locking state machine (`UNLOCKED → held by agent → {released | requested by
another agent → WAIT → transferred}`).

---

## Phase 8 — Code execution (command running, output capture)

**Build**: a real command-execution tool (bounded, output-capturing, secret-redacting — reusing
`redactSecrets()` from the memory-scope module already used by the audit log) usable by any agent
with the right permission tier, writing `tool.exec.*` events with exit code, duration, and captured
output.

**Builds on**: `agentAuditLog.ts`'s existing redaction utility.

**Test**: run a real command (`npm test` against a real, small fixture project — not this repo's own
codebase as the target, to keep this phase's tests isolated from JennySol's own build), confirm the
event stream shows real start/end/duration/exit-code/output matching what actually happened.

**Audit/review**: confirm no secret/env-var value ever appears in a captured-output event — test
this directly (a command that would echo a fake "secret" env var), don't just trust the redaction
utility works here because it works elsewhere.

**Document**: the exact allow-list/bounding rules for what a command-execution tool may run (this is
a real security surface — the founding directive's own §36/§37 apply directly).

---

## Phase 9 — Parallel agents (the first 4 real roles)

**Build**: real role definitions — system prompts, tool grants, memory read/write scopes — for
**Orchestrator, Architect, Coder, QA** only (per this document's own "realistic sizing" note above).
The Orchestrator role is the one that actually decomposes a user request into `agent_tasks` (the
founding directive's own §9 worked example, made real instead of a fixture).

**Builds on**: everything from Phases 1-8.

**Test**: a real, small, end-to-end request ("add a health-check endpoint" or similarly bounded —
not "build the homepage" yet) run through all four roles for real, producing a real diff, a real
test run (Phase 8's tool), and a real completed session — the first phase where the whole stack is
exercised together.

**Audit/review**: this is the natural point to re-read the founding directive's §42 ("do not fake
autonomy") against the *actual* running system, since it's the first phase where there's a real
system to check it against rather than a plan.

**Document**: whatever real gaps this first end-to-end run surfaces — expect some; this phase is
where the architecture doc's assumptions get their first real test.

---

## Phase 10 — Shared memory (full structured model)

**Build**: the rest of the `SessionMemory` shape from the architecture doc §5 that Phase 9's four
roles didn't already need (rejected_decisions, blocked_tasks, open_questions as a first-class
queryable set, user_feedback log) — and the memory read/write-scope enforcement (Phase 2 flagged
this as a gap to close by this point, not before).

**Builds on**: Phase 1's `session_memory` table.

**Test**: an agent attempting to write outside its declared scope is rejected, not silently allowed
— a real permission-boundary test, same category as the existing `CrossProductToolAccessError` test
already proven for the product-connector system.

**Audit/review**: confirm memory reads stay bounded per agent (architecture doc §5's whole point) —
measure actual prompt sizes for each role on a real session, not assumed.

**Document**: the final memory read/write-scope table, superseding Phase 2's draft version.

---

## Phase 11 — Audit system (checkpoints)

**Build**: checkpoint tasks (architecture doc §9) — real LLM calls asking the founding directive's
own §21 checklist questions against real `session_memory`/`git diff`, producing a real PASS/FAIL
plus reasoning, written as an event.

**Builds on**: Phase 3's DAG (checkpoints are just tasks with a special type) and Phase 9's roles.

**Test**: deliberately engineer a real scope-drift scenario in a test session (have a fixture task
add something unrelated to the stated objective) and confirm the checkpoint actually catches it —
not a checkpoint that always passes because nothing has ever been tested against a real failure case.

**Audit/review**: a FAIL result must produce real correction `agent_tasks` (§25), not just a log
line — test that the correction subgraph actually gets scheduled and executed.

**Document**: the real checkpoint cadence chosen (the founding directive's own §21 list is
illustrative — decide and record the actual trigger conditions used).

---

## Phase 12 — QA system (the remaining specialist roles + full QA pipeline)

**Build**: Security, Performance, Code Reviewer, Product Analyst, UX, UI, Backend, Database, Visual
QA, Final Judge roles — each backed by real tool calls appropriate to its function (Security runs
real dependency/pattern checks, Performance runs real build-size/timing checks, Visual QA needs a
real screenshot mechanism — flagged here as needing its own small design pass when reached, not
assumed solvable by prompting alone).

**Builds on**: Phase 9's role-definition pattern, extended to the remaining ten.

**Test**: the founding directive's own §28 worked example (PRODUCT/UX/UI/CODE/FUNCTIONAL/SECURITY/
PERFORMANCE/REGRESSION/ARCHITECTURE QA, aggregated by Final Judge into one verdict) run for real
against a real small feature.

**Audit/review**: every QA verdict must cite real evidence (a test result, a diff, a build output —
per the founding directive's own §27) — reject any role definition that lets a model assert "this
passes" without a tool-call result backing it.

**Document**: the `FINAL_SESSION_REPORT.md` template (founding directive §29/§47), generated from
real session data — not hand-written per session.

---

## Phase 13 — Live UI

**Build**: the dashboard described in architecture doc §8, on `client/src/pages/Agents.tsx`/
`Tasks.tsx`. This is deliberately Phase 13, not Phase 1 — by this point there are eleven phases'
worth of real events to render, which is the only way to build this UI against real data instead of
mocked shapes that quietly diverge from reality.

**Builds on**: `client/src/lib/api.ts`'s SSE pattern, `AdminDashboard.tsx`'s visual components.

**Test**: open the dashboard during a real Phase 12-style session and confirm every rendered
element traces to a real event — the founding directive's own §42 test, now checkable end-to-end
against a UI that exists.

**Audit/review**: a UI review specifically hunting for any element that could plausibly show stale
or invented state (a status that didn't update on disconnect/reconnect, a count computed
client-side instead of from real rows) — fix before calling this phase done.

**Document**: screenshots/recording of a real session in the dashboard, since this is the artifact
most worth showing rather than describing.

---

## Phase 14 — Human steering

**Build**: the message-classification step (architecture doc §10), the `user_decisions` queue UI
panel, pause/resume/cancel/reassign/change-model/change-priority/add-instruction/rollback controls
(founding directive §34) wired to real scheduler operations, not placeholder buttons.

**Builds on**: Phase 6's Scheduler (pause = stop granting new slots + mark affected tasks;
resume = the reverse), Phase 13's UI.

**Test**: mid-session, send a real steering message of each impact level (LOW/MEDIUM/HIGH/CRITICAL)
and confirm the *actual* scheduling behavior matches architecture doc §10's stated rule for each —
this is a real behavioral test per level, not one generic "steering works" check.

**Audit/review**: confirm a CRITICAL decision genuinely blocks every transitively-dependent task
(walk the real DAG, don't eyeball it) and nothing else.

**Document**: the impact-classification prompt and its real observed accuracy on a sample of test
messages — this is exactly the kind of classifier this engagement's own recent work (the reasoning
vs. general routing bug, fixed this same session) already showed is easy to get subtly wrong; test
it with the same rigor.

---

## Phase 15 — Final integration

**Build**: whatever seams Phases 1-14 leave between them once used together for real, plus the
`FINAL_SESSION_REPORT.md` generator (Phase 12) wired to session completion, plus session archival
(export a completed session's full state — architecture doc's implicit requirement from the founding
directive's own archival ask).

**Builds on**: everything.

**Test**: the founding directive's own §47 target scenario, run for real, start to finish, on a
real (still modestly-scoped) feature request — including a mid-session steering message and at
least one checkpoint-triggered correction, since a run with neither doesn't actually exercise the
parts of this system that are hardest to get right.

**Audit/review**: a full read of the resulting `FINAL_SESSION_REPORT.md` against what actually
happened (cross-check a few claims against the raw event log) — the same standard this whole
engagement has applied to every "verified vs. assumed" claim throughout.

**Document**: this phase's own report *is* the documentation — no separate write-up needed beyond
noting what, if anything, didn't work as designed and would need a Phase 16.

---

## What happens after Phase 15

Not planned here, deliberately: multi-instance/horizontal scaling (architecture doc §4's explicit
non-goal), the git-worktree-per-parallel-track upgrade (architecture doc §7's explicit Phase 2+
item, only if real contention is observed), and scaling past the initial 14 roles into whatever the
founding directive's "50-100 logical agents" ceiling actually requires in practice — each is a real
future decision, not a gap in this plan.
