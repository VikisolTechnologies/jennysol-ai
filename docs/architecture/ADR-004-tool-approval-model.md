# ADR-004: Tool Risk Tiers and Approval Model

**Status:** Accepted (architecture decision; implementation not started — see `PROJECT-PROGRESS.md`, milestone M7)
**Date:** 2026-09-10

## Context

Once JennySol can call Arena tools (ADR-002) on behalf of an identified Arena user (ADR-003), some
of those tools only read data (`arena.searchJobs`) and some cause a real, consequential effect
(`arena.applyToJob`, `arena.unlockCandidateContact`, which spends a real credit and is guarded by
a race-condition fix already shipped in Arena — see `TalentSearchService.unlock()`). The founder's
own instruction is explicit and non-negotiable: "JennySol must never bypass Arena's authorization,"
and Arena's own prior architecture work independently arrived at the same rule ("never silently
perform high-impact actions"). Arena's frontend already has an `IntentCardView.tsx` component built
for exactly this purpose, currently dormant because nothing populates it (confirmed in
`PROJECT-PROGRESS.md` Phase 3 — real, unused code, not a working workflow).

## Decision

Every tool a product connector registers declares a risk tier at registration time:

```
READ        — no side effect, executes immediately, no approval needed
WRITE       — a real, consequential effect, requires explicit user approval before executing
```

For a `WRITE` tool, the flow is:

```
Model decides a WRITE tool is needed
  → JennySol proposes the action, does NOT execute it
  → Frontend shows an approval card (Arena: reuses IntentCardView.tsx)
  → User approves or rejects
  → Only on approval: JennySol calls the tool
  → Arena re-runs its own full authorization/business-rule check
    (exactly as if a human had clicked the equivalent button)
  → Result reported back, truthfully, including failure
```

The model is never trusted to self-authorize a WRITE tool call by simply not calling it carelessly
— the approval gate is enforced in code (JennySol's tool dispatcher refuses to execute an
unapproved WRITE call), not by a system-prompt instruction the model could fail to follow.

## Why

- **Directly satisfies the explicit, repeated instruction** across every specification this
  project has been given: never let the AI perform a high-impact action without approval, never
  let it bypass Arena's own authorization.
- **Arena already re-checks authorization on every call regardless of caller** — `@PreAuthorize`,
  tenant scoping, and (for unlock specifically) the pessimistic-lock credit check all run
  identically whether the caller is a human clicking a button or JennySol calling the wrapping
  tool endpoint. The approval gate on JennySol's side is a *second*, independent safeguard, not
  Arena's only one — a defense-in-depth design, not a single point of failure.
- **Reuses real, existing UI** rather than building a new one. `IntentCardView.tsx`'s approve/
  reject pattern was purpose-built for this exact use case in an earlier round of Arena work and
  simply has nothing to connect it to yet.
- **A model cannot be relied upon to always follow a policy instruction.** JennySol's own
  documented history (`docs/CURRENT_INFORMATION_ARCHITECTURE.md`) records a real, confirmed case
  where a prompt-level instruction (temporal-honesty hedging) worked for one phrasing of a
  question and silently failed for another, nearly-identical phrasing, on the same model, same
  deploy. A code-enforced approval gate cannot have this failure mode; a system-prompt-only
  "please ask before acting" instruction can.

## Consequences

- Every WRITE tool needs a two-phase execution shape (propose, then execute-on-approval) rather
  than a single call — more implementation work per write tool than a read tool, by design.
- An approved-but-then-failed action (e.g., credits ran out between proposal and approval) must be
  reported honestly, not silently retried or hidden — this is a direct extension of Arena's own
  existing "no optimistic lying" rule from its prior remediation work.
- Idempotency (Phase 2, item 16 of `PROJECT-PROGRESS.md` — currently NOT STARTED anywhere in
  JennySol) becomes a real requirement the moment the first WRITE tool ships, since a user could
  in principle approve the same proposed action twice (e.g., a flaky network retry). This should
  be designed alongside the first WRITE tool, not retrofitted after.

## Alternatives considered

- **Trust the model's own judgment about when to ask for approval.** Rejected outright — this is
  the exact "prompt-level policy competing with the model's own behavior" failure mode already
  observed and documented in this codebase's own history, and directly contradicts the founder's
  explicit instruction.
- **Require approval for every tool call, including reads.** Rejected as unnecessary friction —
  reads have no side effect to guard against, and the founder's own design ("JennySol: 'I need
  candidate information.' Arena: 'You are authorized to use getCandidate for candidate X.'")
  describes reads flowing without a manual approval step, gated by authorization rather than
  approval.
