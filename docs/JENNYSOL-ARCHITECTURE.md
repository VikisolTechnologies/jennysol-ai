# JennySol — target architecture (STEP 4)

Written 2026-09-26 on `feature/jenny-audit`, grounded entirely in `JENNYSOL-CURRENT-STATE.md`'s
verified findings — nothing here assumes a gap that audit didn't actually confirm. Per the
addendum's rule: **the master plan decides scope, not stack.** Every section below defaults to
"keep the current stack, add this as a module," and only recommends otherwise where the audit
found real evidence the current approach can't meet the DoD.

---

## 1. What's already true (don't rebuild this)

The single biggest risk in this mission is an agent reading the master plan's roadmap literally
and re-deriving infrastructure that already exists. Per the audit:

| Already built | Where |
|---|---|
| Config-driven model registry, routing by task/health/latency/cost | `models/modelRegistry.ts`, `modelRouter.ts` |
| Per-provider circuit breaker + typed error taxonomy | `providerHealth.ts`, `retryClassifier.ts` |
| Hedged fallback race (built, off by default) | `modelRouter.ts`'s `runHedgedPair` |
| Keep-warm + shadow traffic for the local fleet | `keepWarm.ts`, `shadowTraffic.ts` |
| Scoped RAG (in-process embeddings, per-user) | `embeddings.ts` |
| Tool registry, approval-gated writes, risk ratings | `tools/toolRegistry.ts`, `tools/pendingActions.ts` |
| **A live, production, end-to-end product integration** (Arena) | `routes/agentGateway.ts`, `productConnectors/arena.ts`, `JENNY-ARENA-CONTRACT.md` |

The rest of this document is about what's genuinely missing — the agent-runtime state machine
(Goal Mode) and privacy tiers — built *around* the above, not replacing it.

---

## 2. Target shape

```
                       JENNYSOL
                          │
         ┌────────────────┼────────────────────┐
         │                │                     │
   AGENT GATEWAY    AGENT RUNTIME          MODEL GATEWAY (§4)
  (product entry,   (§3: Task/Run,        ┌────────┬─────────┬──────────┐
   e.g. Arena)       plan→act→observe)   Ollama   Gemini   DeepSeek   (future:
         │                │              (local)  (cloud)  (cloud)    Anthropic,
         │                │                                            GPU fleet)
         └──────► TOOL REGISTRY (§5, risk-rated, approval-gated) ◄──────┘
                          │
              MEMORY / RAG (§6, scoped)  +  AUDIT (every call, every run)
```

This is exactly today's shape with two new boxes: the Agent Runtime sitting between the gateway
and tool dispatch (today, a WRITE tool call goes gateway → propose → approve → dispatch directly;
tomorrow, that becomes one step inside a runtime that can also plan several steps and re-plan),
and privacy tiers threaded through the Model Gateway's existing routing decision.

---

## 3. Agent runtime (Goal Mode) — the real gap

**Today:** one streamed turn per request. A WRITE tool call becomes a pending action; there is no
concept of "plan three steps, do the first, look at the result, decide the second."

**Target — the core contracts, as they'll exist in code** (new module,
`server/src/services/agentRuntime/`, nothing existing moved or renamed):

```ts
// agentRuntime/types.ts
export type RunStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

export interface AgentRun {
  id: string;
  identity: ProductIdentity;      // reuses the existing type — never redefined
  goal: string;
  status: RunStatus;
  steps: TaskStep[];
  budget: { maxSteps: number; maxMs: number; maxCostUsd?: number };
  spentMs: number;
  createdAt: number;
  updatedAt: number;
  stopReason?: StopReason;
}

export type StopReason =
  | "completed" | "budget_exceeded" | "missing_information"
  | "tool_failed_repeatedly" | "policy_violation" | "cancelled_by_user"
  | "insufficient_evidence";

export interface TaskStep {
  id: string;
  index: number;
  kind: "plan" | "tool_call" | "observation" | "approval_wait";
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt?: number;
}
```

**The loop** (a real state machine, not a prompt loop): `queued → running`, then repeat
{ plan (one model call, asked to name the next single tool call or declare the goal done) →
validate the plan against the identity's actual scope (reuses `ToolRegistry.getToolsFor`) →
execute via the **existing** `ToolRegistry.dispatch()` (a WRITE tool still becomes a pending
action exactly as today — Goal Mode doesn't bypass approval, it just means the *next* planned
step waits for that approval before the loop continues) → append the observation → check budget
and stop conditions → decide whether the goal is met or re-plan }.

**Persistence:** SQLite, same engine as `pendingActions.ts` already uses — one new table
(`agent_runs`, `agent_run_steps`), not a new datastore. **Resumable and stoppable**: a run's
`status` and `steps` are the only state a resume needs to reconstruct where it was; "stop" is
just setting `status = "cancelled"` and having the loop check it before every step, the same
pattern `agentCommandTool.ts`'s timeout/kill handling already establishes for a different kind of
long-running operation.

**Why this doesn't touch the Arena gateway:** Arena's flow is genuinely single-step per user
message today (one tool call, one approval) and stays exactly as it is — Goal Mode is additive,
for a *future* "give Jenny a goal" surface (the JennySol app's own chat, first), not a replacement
for how Arena's existing, tested, live integration works.

---

## 4. Model Gateway: formalizing what exists, adding privacy tiers

**Recommendation: keep `modelRouter.ts`/`modelRegistry.ts` as the implementation.** Wrap them in
one new stable interface the plan asks for (`generate()`, `stream()`, `route()`), rather than
replacing the routing logic that's already correct and tested:

```ts
// modelGateway/types.ts
export type PrivacyTier = "LOCAL" | "PRIVATE" | "PUBLIC_CLOUD";

export interface RouteRequest {
  task: TaskCapability;      // reuses the existing type
  privacyTier: PrivacyTier;
  // ...existing routeChatCompletion params carry through unchanged
}
```

`route()` becomes the one new decision point: **before** today's chain resolution runs, filter
out any provider whose `localOrCloud` doesn't satisfy the requested tier (`LOCAL` → Ollama only;
`PRIVATE` → Ollama or a future Vikisol-controlled cloud instance, never a third-party API;
`PUBLIC_CLOUD` → anything). If nothing in the chain satisfies the tier, **fail honestly** (a
clear "this needs a level of privacy no available model can currently provide" error) — never
silently answer with a lower-privacy model.

**Rollout, exactly as the addendum specifies:** ship in **shadow mode** first — tag every real
request with its tier and log what *would* have been filtered, without actually filtering
anything, for one real observation window. Only flip enforcement on once that log shows it
wouldn't have broken anything unexpected (an existing pattern already established in this
codebase by `shadowTraffic.ts` — same idea, different subject).

**Where does a tier come from?** Every product connector declares a default (Arena: today's
traffic is `PUBLIC_CLOUD` — nothing Arena sends through Jenny today is sensitive enough to need
LOCAL); JennySol's own personal-assistant surface (documents, calendar) defaults to `PRIVATE` for
anything touching an uploaded file. This is a real design decision the founder should see before
STEP 5 builds it — flagged here, not decided unilaterally.

---

## 5. Tools: reaching 10, keeping every one typed and risk-rated

**Today: 9** (Arena's 5 write + 4 read, all now risk-rated per `JENNY-ARENA-CONTRACT.md`).

**To reach 10 with tools that are genuinely useful and already have working capabilities behind
them** (never a tool that's just a thin wrapper invented to hit a number):
1. `jennysol.webSearch` — wraps the existing `searchRouter.ts` (Tavily), risk **low**.
2. `jennysol.getWeather` — wraps the existing weather capability, risk **low**.
3. `jennysol.currentDateTime` — wraps `dateTime.ts`, risk **low**.

Any of these three alone reaches 10; all three are trivial to add since the underlying capability
is already live and tested — this is genuinely an afternoon of wrapping, not new capability work,
and is left for STEP 5 rather than done speculatively here in the blueprint step.

**Risk levels, formalized** (already built in STEP 1 — `ToolRisk` in `productConnector.ts`):
Low → automatic (READ tools). Medium → the WRITE tier's default (today's `createPost`,
`createProject`, `joinActivity`). High → `placeBid`, `applyToJob` (real money/employment stakes).
**Critical** doesn't exist yet in this codebase — reserved for a tool that doesn't exist yet
either (e.g. a future destructive-delete or bulk-outreach tool), and per §6.6 of the master
context, should require **strong authorization on top of approval**, not just a tap — a real
design point for whoever builds the first Critical-risk tool, not solved speculatively now.

---

## 6. Memory and RAG: the real gap is tenant/purpose scoping, not the store

**Keep the in-process ONNX embeddings.** The audit found no evidence the current store can't do
tenant-scoped retrieval at this scale — the plan's pgvector suggestion is **not adopted**, per the
addendum's own default.

**What's actually missing:** memory is scoped per-user today; it needs **user + product + tenant
+ purpose**. Concretely: a document JennySol embedded for a user's own personal-assistant use must
never surface when the same person's Arena identity asks Jenny something — those are the same
Vikisol person, but two different `ProductIdentity`s (different `product`, different `scope`),
and memory lookups need to key on that same tuple `ToolRegistry` already uses for tool
visibility, not just on a raw user id. **Export and delete:** two small new endpoints
(`GET/DELETE /api/memory`, scoped to the caller's own identity), backed by the existing store —
no new infrastructure, a real self-service gap to close in STEP 5.

**Prompt-injection defence:** already the codebase's convention (every tool result is passed to
the model as `content`, never concatenated into the system/instruction prompt) — formalize it as
a rule new tools must follow, not a new mechanism to build.

---

## 7. Extension points (designed here, not built)

- **Agent teams.** A `TaskStep` already carries a `toolName` — a specialist agent is, in this
  design, just a named bundle of {system prompt, allowed tool subset, budget}. The runtime (§3)
  needs one more field (`agentId`) to route a step to a specific bundle instead of the general
  Jenny persona; a supervisor is simply a run whose steps delegate to other runs. No rewrite.
- **Browser/computer use.** Would register as a tool like any other (`jennysol.browserAct`),
  risk **critical**, sandboxed execution the same way `agentCommandTool.ts` already sandboxes
  shell commands (throwaway HOME, minimal env, explicit opt-in flag) — same pattern, new tool.
- **Agent marketplace.** Agent definitions as data (a JSON row: system prompt, tool allowlist,
  risk ceiling) rather than code — the runtime already treats an "agent" as configuration, not a
  class, so a marketplace is "let a non-engineer author that JSON row," not new runtime work.
- **Per-tenant/per-org JennySol deployments.** `ProductIdentity` already carries `tenantId` —
  every new table this blueprint adds (`agent_runs`, memory) must include it in its key from day
  one, so a future multi-tenant JennySol never needs a retrofit migration.
- **Vikisol One connector.** Build and test it against a mock, exactly like Arena's own
  `arena.test.ts` proves the contract without a live dependency — same shape as `arena.ts`, a
  second file in `productConnectors/`, registered the same way. **Never connect it to real One
  data or production this mission** (hard limit).
- **GPU fleet.** `ModelEntry.requiresDedicatedServer` already exists in the registry schema for
  exactly this — a future RTX 5090 entry is a new registry row plus a new provider adapter
  pointing at that box's own endpoint, not a schema change.

---

## 8. v1 Definition of Done — mapped to code, tests and status

| DoD item | Code | Tested by | Status |
|---|---|---|---|
| Config-driven Model Gateway | `modelRegistry.ts`, `modelRouter.ts` | `modelRouter.test.ts` | **Done** |
| Privacy tiers, no silent escalation | *(new, §4)* | *(new)* | **Designed, not built** |
| Durable, resumable, cancellable AgentRun (Goal Mode) | *(new, §3)* | *(new)* | **Designed, not built** |
| ≥10 typed, risk-rated tools | `productConnectors/arena.ts` (9) + §5's 3 candidates | `arena.test.ts`'s risk-table test | **9/10, trivial to close** |
| Memory scoped by user+product+tenant+purpose, exportable/deletable | `embeddings.ts` (user-scoped only) | — | **Partially done, real gap identified (§6)** |
| Arena contract published, backward-compatible, live | `agentGateway.ts`, `productConnectors/arena.ts` | `agentGateway.http.test.ts`, Arena-BE's own suite | **Done, verified live** |
| Extension points designed | This document, §7 | — | **Done (this step)** |
| Provider independence (same run, config-only model swap) | `modelRouter.ts`'s chain | `modelRouter.test.ts` | **Done for chat; not yet proven for Goal Mode (doesn't exist yet)** |
| 3 real workflows end to end | Arena's flow only | live production check (2026-09-26) | **1 of 3** |

## 9. Conflicts with the master plan — recommendation for each

| Conflict | Recommendation |
|---|---|
| Plan implies Java/Spring Boot + pgvector + React | **Keep the current Node/TypeScript + SQLite/ONNX stack.** No evidence in the audit that it can't meet the v1 DoD — the gaps found are missing modules, not a stack limitation. |
| Plan's 14 sub-modules as separate services | **Folders inside `jennysol-ai/server/src/services/`**, matching every existing module's own pattern (`agentRuntime/`, `modelGateway/` alongside today's `tools/`, `models/`). One process, one deploy, per the founder's own "start lean" principle. |
| Vikisol One endpoint in the 30-day list | **Mock only, this mission.** Real connection needs a scoped One API on staging and founder approval — neither exists yet. |
| Which 3 workflows prove v1 | (a) Arena — **already real**. (b) Research → cited report — buildable from the existing web-search tool + Goal Mode once §3 exists. (c) Developer → sandbox repo → tests → draft PR — needs a sandboxed git/test-runner tool (a new, carefully-scoped addition, similar in spirit to `agentCommandTool.ts` but pointed at a disposable scratch repo, never this one). |

---

## 10. Mockups
Chat, voice mode, the run/approval dashboard, and memory/privacy settings — see `docs/design/`
(added alongside this document, STEP 8 territory pulled forward slightly since a static mockup
carries no production risk and is cheap to produce alongside the architecture it illustrates).
