# AI Agent System Architecture

Written 2026-09-13, by direct inspection of the current codebase — not assumed. Answers the 15
investigation questions the founding directive posed, in order, then lays out the concrete design.
Companion document: [AI_AGENT_IMPLEMENTATION_PLAN.md](AI_AGENT_IMPLEMENTATION_PLAN.md) (phased build
order). **No implementation has started.** Per the founding directive's own instruction, this and
the plan document are for review before Phase 1 begins.

## 0. The one-sentence framing

This is **not** N models talking to each other over a socket. It's a scheduler that runs many
independent LLM-call loops (one per logical agent), coordinates them through durable shared state
and an event log, and gates how many are *actually* inferring at once against real hardware/API
limits. "Multi-agent" describes the orchestration and the UI, not the transport — no two models ever
talk directly.

## 1. What already exists (verified by direct inspection, not assumed)

| Layer | Status | Where |
|---|---|---|
| Provider abstraction (Gemini, DeepSeek, Ollama) | **Solid, reusable as-is** | `server/src/services/providers/*`, `llmProvider.ts` |
| Model router (chain, health, hedging, tiered timeouts, warm/cold) | **Solid, reusable as-is** | `modelRouter.ts` |
| Hardware-aware model registry + capability routing | **Solid, reusable as-is** | `models/modelRegistry.ts`, `models/hardwareProfile.ts` |
| Per-request observability (token usage, fallback rate, latency percentiles) | **Solid, reusable as-is** | `requestMetrics.ts`, `providerHealth.ts` |
| Local-model concurrency gate (1 slot on this Mac) | **Solid — the seed of the Resource Manager below** | `providers/ollama.ts`'s `activeRuns`/`atCapacity()` |
| Tool registry, READ/WRITE tiers, cross-product isolation | **Solid, reusable as-is** | `services/tools/toolRegistry.ts`, `productConnector.ts` |
| WRITE-tool approval flow (propose → approve → execute) | **Solid, reusable as-is** | `services/tools/pendingActions.ts` (ADR-004) |
| Correlation-scoped audit log | **Solid, reusable as-is** | `services/agentAuditLog.ts`, `agent_audit_log` table |
| Single-agent run durability (SQLite row + append-only event log + in-process pub/sub + AbortController) | **Solid pattern — generalize, don't reuse verbatim** | `agentRunStore.ts`, `runBus.ts`, `runCancellation.ts`, `chatRunner.ts` |
| SSE streaming to the client (raw `fetch` + `ReadableStream`, hand-rolled frame protocol) | **Solid, reusable pattern** | `client/src/lib/api.ts`, `server/src/routes/chat.ts` |
| Admin dashboard visual language (stat tiles, list breakdowns, no chart lib) | **Reusable template** | `client/src/pages/admin/AdminDashboard.tsx` |
| Job queue / worker pool / scheduler | **Does not exist. Zero matches, confirmed by grep.** | — |
| Multi-agent grouping concept ("session" spanning several runs) | **Does not exist.** `conversation_id` is single-agent, single-user. | — |
| Git worktree usage | **Does not exist anywhere in this repo.** | — |
| File/resource locking | **Does not exist.** | — |
| Live multi-agent dashboard UI | **Does not exist**, but `pages/Agents.tsx` and `pages/Tasks.tsx` are *already* inert placeholders whose own source comments say exactly that — the natural landing spot. | `client/src/pages/Agents.tsx`, `Tasks.tsx` |

**Conclusion**: the model/tool/audit layer this whole engagement already built is exactly the
foundation a multi-agent system needs — it is not being replaced. What's missing is entirely the
orchestration layer above it: sessions, a task DAG, a scheduler, a resource manager, shared memory,
and the UI to watch it. That's four-to-six genuinely new subsystems, not a rewrite.

## 2. What can be reused vs. what's new

**Reused directly, no changes:**
- The entire model/provider/router layer. An agent's "LLM call" is a call to `routeChatCompletion()`
  with a capability hint, exactly as today.
- SQLite as the durability layer. No Postgres, no Redis — see §4 for why.
- `redactSecrets()` (from `memoryScope.ts`) for scrubbing captured tool output before it's ever
  written to an event row — the function, not the table it's used for elsewhere.

**Correction (found by inspection before Phase 7, not assumed): `toolRegistry.ts` / `pendingActions.ts`
/ `agentAuditLog.ts` are NOT reusable for internal agent tool calls.** All three are hard-wired to
`ProductIdentity` (product + externalUserId + tenantId) — built specifically for an *external*
product (Arena) calling *into* JennySol, per ADR-002. `Agents.tsx`'s own existing source comment
already says this plainly: bridging JennySol's own internal execution into that system would be new
cross-boundary architecture, which is exactly the Arena-boundary rule this whole engagement has held
to elsewhere. Making an internal agent masquerade as a `ProductIdentity` to reuse these modules would
be that same mistake. **The correction**: internal agent tool access (Phase 7) gets its own small,
new `agentToolRegistry.ts` — keyed by `(sessionId, agentId)` and the `agents.permissions` field
(Phase 2), not by product identity — implementing the same READ/WRITE-tier + propose/approve/execute
*shape* as `pendingActions.ts` because that shape is sound, but as new, parallel code, not a shared
module with the cross-product path. `agent_audit_log` (the table) stays exclusively for cross-product
traffic; internal tool calls are logged as `agent_session_events` rows of type `tool.exec.*` instead
(§8), which is what the rest of this document already assumed — only the "reuse toolRegistry.ts
itself" claim above was wrong, not the eventing design.

**Reused as a pattern, generalized:**
- `agentRunStore.ts` + `runBus.ts` + `runCancellation.ts`: today this is "one durable row + one
  append-only event log + one in-process EventEmitter + one AbortController, per chat turn." The
  multi-agent system needs the identical shape, one level up: one durable row + one event log per
  **agent-task**, grouped under a new **session** id. Same durability guarantee (event log is
  authoritative, not the in-memory bus), same single-process caveat already honestly documented in
  the existing code (explicitly not solving multi-instance scaling here either — see §4).
- `providers/ollama.ts`'s concurrency gate: today it's "1 concurrent local generation." The Resource
  Manager (§6) is this same idea generalized to arbitrate *every* model call from *every* agent, not
  just Ollama's.
- The SSE protocol in `api.ts`/`chat.ts`: today it multiplexes nothing (one run per connection). The
  live dashboard needs one connection multiplexing many agents' event streams under one session id.

**New, does not exist today:**
- Session data model (§5), shared session memory (§5), task DAG + scheduler (§6), Resource Manager
  (§6), file locking (§7), git isolation (§7), the live dashboard UI (§8), checkpoint/audit
  automation (§9), the user decision queue (§10).

## 3. Biggest technical risks, named plainly

1. **Resource contention on this Mac.** One local concurrency slot (`maxConcurrentLocalRuns: 1` on
   the `m1_16gb` profile) means "20 agents working in parallel" can only ever mean 20 agents whose
   *cloud*-routed calls run concurrently — local-routed calls queue, always, on this hardware. The
   UI must show this honestly (a queued agent is "WAITING," not silently slow) rather than implying
   false parallelism.
2. **Runaway cost/token usage.** N logical agents each capable of making LLM calls, some via paid
   cloud APIs, is a real, un-bounded cost surface without a hard per-session budget enforced by the
   scheduler itself — not left to individual agents to self-police.
3. **Fake autonomy (the founding directive's own §42 concern).** If the UI's agent-status feed is
   allowed to drift from `agent_events`, it will drift. The architectural answer is structural, not
   a promise: the UI has **no other source of state** — every pixel comes from a row in the events
   table, full stop, exactly the discipline `runBus.ts` already enforces for single-agent chat.
4. **File-edit collisions.** Multiple agents with file-write tools and no lock is silent data loss.
   §7 makes this a hard gate, not a convention.
5. **Context/memory bloat.** Dumping the full multi-agent transcript into every agent's prompt
   degrades quality and burns tokens/latency. §5's structured `SessionMemory` (per the founding
   directive's own outlined shape) is a hard requirement, not a nice-to-have.
6. **Scope creep of the platform itself.** This spec is enormous — a full distributed-systems-style
   orchestrator, a live observability UI, a resource scheduler, and a QA/audit pipeline. Treated as
   one project, it doesn't ship. §-by-§ of the implementation plan is the actual defense here.

## 4. Core architectural decision: single-process, SQLite-durable, no new infrastructure dependency

The existing codebase has already made and repeatedly documented this exact tradeoff three times
(`runBus.ts`, `runCancellation.ts`, `pendingActions.ts`) — each is explicitly "correct for this app's
real deployment (one Railway instance), not a permanent architecture decision," with the same honest
caveat: "would need Redis/a shared store if this ever runs as more than one instance." This document
makes the same call for the same reason: **JennySol runs as one process today, and a job
queue/message broker (Redis, BullMQ, Kafka) would be solving a scaling problem that doesn't exist
yet, at the cost of a new operational dependency that does.** The Resource Manager, the scheduler,
and the event bus are all in-process. SQLite (already the durability layer for everything else in
this app) gets the new tables. If JennySol is ever horizontally scaled, this is the one part of the
design that would need revisiting — flagged now rather than discovered later, same as the existing
code already does for its own in-process mechanisms.

## 5. Session model & shared memory

### Data model (new tables, SQLite)

```
agent_sessions
  id, user_id, objective (text), status (planning|running|paused|completed|cancelled|failed),
  max_session_time_ms, max_token_budget, max_cost, max_agent_count, max_concurrent_agents,
  created_at, completed_at

session_memory
  session_id (FK), key (text), value (JSON), updated_at, updated_by_agent_id
  -- one row per top-level SessionMemory field (requirements, constraints, architecture,
  -- decisions, current_plan, changed_files, tests, audit_results, open_questions, ...),
  -- not one giant blob — lets an agent update ONE section without a read-modify-write
  -- race on the whole object, and makes "what changed and when" a real query.

agents
  id, session_id (FK), role, display_name, model_provider, model_id, status
  (idle|planning|working|waiting|blocked|reviewing|auditing|failed|completed|cancelled),
  capabilities (JSON), permissions (JSON), current_task_id, tokens_used, created_at, updated_at

agent_tasks
  id, session_id (FK), agent_id (FK, nullable until assigned), title, description,
  depends_on (JSON array of agent_tasks.id — the DAG edges), status
  (pending|ready|queued|running|blocked|completed|failed|cancelled),
  priority, started_at, completed_at, result (JSON)

agent_session_events   -- generalizes agent_events' proven append-only pattern to session scope
  id, session_id (FK), agent_id (FK, nullable — some events are session-level, e.g. checkpoints),
  task_id (FK, nullable), type, payload (JSON), created_at
  -- reuses the exact §type discriminator idea from agent_events; new types for this system:
  -- see §11's event taxonomy.

file_locks
  session_id (FK), file_path, agent_id (FK), acquired_at, released_at (nullable)

user_decisions
  id, session_id (FK), question, options (JSON), impact (low|medium|high|critical),
  affected_agents (JSON), status (open|answered), answer, answered_at
```

Naming note: `agent_sessions` is deliberately not named `sessions` — that name is already taken by
JennySol's own auth-session table (`sessions`), a real collision the investigation surfaced.

### SessionMemory access pattern

An agent never receives "the whole session." Each role has a declared **memory read scope**
(e.g., the Frontend agent reads `architecture`, `current_plan`, `changed_files`; it does not read
`security.audit_findings` unless a task explicitly hands it that). Prompt assembly for any given
agent-task is: role system prompt + the specific `session_memory` rows in that role's read scope +
the specific task's own inputs — never a raw event-log dump. This is what keeps context bounded as
the session grows, and it's the direct answer to the founding directive's own instruction not to
"simply dump the entire conversation into every model."

## 6. Task DAG, scheduler, and the Resource Manager (the logical-agents vs. execution-slots split)

This is the answer to the founding directive's central design constraint: *many logical agents,
few concurrent model executions.*

- **`agent_tasks` is the DAG.** `depends_on` are edges. A task becomes `ready` the instant every task
  in its `depends_on` list is `completed`. This is a plain topological check on write, not a
  separate graph library — the existing SQLite table is the graph.
- **The Scheduler** is an in-process loop (no new infra, per §4) that: (a) finds all `ready` tasks,
  (b) asks the Resource Manager for an available execution slot, (c) if granted, marks the task
  `queued→running`, resolves which agent/model handles it (via the *existing* `modelRegistry.ts`
  capability routing — a reasoning-tagged task still resolves to `deepseek-r1:7b` the same way a
  chat message does today), and executes it through `routeChatCompletion()`.
- **The Resource Manager** generalizes `ollama.ts`'s existing concurrency gate: it tracks (1) the
  local concurrency slot(s) from the active `HardwareProfile` (today: 1), (2) per-cloud-provider
  health/availability from the *existing* `providerHealth.ts` circuit breaker, (3) a
  priority-ordered wait queue for tasks that are `ready` but have no slot yet, and (4) hard budget
  counters (`max_token_budget`, `max_cost`, `max_session_time_ms`) checked before granting a slot at
  all — a session that's out of budget stops handing out slots, full stop, regardless of how many
  tasks are `ready`.
- **A logical agent that isn't executing costs one SQLite row and its slice of session memory** — not
  a loaded model, not a thread, not a process. This is the literal mechanism behind "100 logical
  agents, a handful of concurrent model executions": `agents`/`agent_tasks` rows scale freely;
  `routeChatCompletion()` calls in flight are what's bounded.

## 7. Code isolation: file locks first, worktrees as an upgrade path

Per the founding directive's own **Minimal Change Principle** (§38): start with the smaller
mechanism that actually solves the stated problem ("never allow silent overwriting"), not the larger
one that's available. **Phase 1**: single shared working tree, `file_locks` table enforced by every
WRITE-tier file tool — an agent must hold the lock for a path before writing it; a second agent
requesting a held lock gets `WAIT`/`BLOCKED` status, surfaced in the dashboard, never a silent queue.
This alone satisfies §12's requirement completely for realistic concurrency on one Mac (a handful of
truly-parallel local/cloud agent tasks at a time, per §6's resource limits — not 20 simultaneous
writers). **Phase 2+ upgrade path, not Day 1**: `git worktree add agent/<task-slug>` per genuinely
independent parallel workstream, integrated by the orchestrator inspecting `git diff`/`git
status`/`git log` before merge (per §13) — worth building once real contention on the simpler
mechanism is actually observed, not before. Neither phase ever force-pushes, resets, or discards a
worktree/branch without the same explicit-confirmation discipline this whole engagement has already
held to for destructive git operations.

## 8. Live dashboard UI

Lands on the already-stubbed `client/src/pages/Agents.tsx` / `Tasks.tsx` — both currently inert
placeholders whose own source comments already say no backend exists yet, which is exactly true
today and exactly what this build fills in. Architecture:

- **One SSE connection per open session** (extending, not replacing, `chat.ts`'s existing pattern),
  streaming `agent_session_events` rows as they're written — the event log is the only source of
  truth the client ever renders from, per §3's fake-autonomy defense.
- **Session header**: objective, elapsed time, phase, progress (= completed / total `agent_tasks`),
  reusing `AdminDashboard.tsx`'s stat-tile component directly.
- **Agent roster**: one card per `agents` row — role, model, status, current task, tokens, elapsed —
  live-updated from the same event stream, not a separate poll.
- **Activity feed**: human-readable line per event (`"Frontend Agent modified HeroSection.tsx"`),
  filterable by agent, expandable to the raw event payload — matches §15/§40's message-level taxonomy
  (INFO/PROGRESS/DECISION/WARNING/ERROR/QUESTION/AUDIT/SUCCESS) as a client-side filter, not a
  server concept.
- **Command/file panels**: rendered straight from `agent_session_events` rows of type `tool.exec`
  (command, agent, start/end, duration, exit code, stdout/stderr — secrets redacted server-side by
  the same `redactSecrets()` already used for the audit log) and `file.changed` (path, diff, agent).
- **User decision queue**: a dedicated panel reading `user_decisions` where `status='open'`; an
  answer POSTs back, is written to `session_memory`, and the scheduler's next tick re-evaluates any
  task that was blocked on it.

## 9. Checkpoints & audits

Checkpoints (§21 of the founding directive) are `agent_tasks` of a special `type: "checkpoint"` that
the DAG makes dependent on reaching a real milestone (e.g., "all Phase-2 implementation tasks
completed"), whose own execution is a real LLM call — asking the *actual* project-analyst/architect
agent role the founding directive's own checklist questions ("are we still solving the original
problem," "has scope expanded," etc.) against the real current `session_memory` and `git diff`, not
a canned response. A `FAIL` result creates new `agent_tasks` (a "correction" subgraph) rather than
blocking the whole session — matching §25's self-correction flow exactly.

## 10. User steering & the decision queue

Every inbound user message during an active session is classified (LOW/MEDIUM/HIGH/CRITICAL, per
§19) by a real LLM call against current `session_memory`, not a keyword rule. LOW/MEDIUM write to
`session_memory.open_questions` and let the scheduler continue; HIGH pauses only the specific
`agent_tasks` that depend on the affected area (computed from the DAG, not "everything"); CRITICAL
creates a `user_decisions` row and pauses every task that (transitively) depends on it. This mirrors
exactly how `classifyTask()` already turns free-text into a routing decision today — same technique,
new classification target.

## 11. What this document deliberately does not decide yet

- The exact LLM prompt/role definitions for each of the 14 agent roles (Phase 9+ work, downstream of
  the plumbing existing here).
- Whether a "Final Judge" role's verdict is itself just another `agent_tasks` row (this document's
  working assumption) or a special-cased scheduler behavior — revisit once the QA pipeline (Phase
  11-12 of the implementation plan) is real enough to test both against.
- Multi-instance/horizontal scaling (see §4) — explicitly out of scope until JennySol itself needs
  it, matching the rest of this codebase's own stated position.

See [AI_AGENT_IMPLEMENTATION_PLAN.md](AI_AGENT_IMPLEMENTATION_PLAN.md) for the phased build order,
what gets tested at each phase, and where the realistic stopping points are.
