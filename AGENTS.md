# JennySol agent entry point

Before changing code, read in this order:

1. `docs/VIKISOL-MASTER-CONTEXT.md`
2. `docs/AGENT-COLLABORATION-PROTOCOL.md`
3. `docs/JENNYSOL-MISSION-2.md`
4. `docs/JENNYSOL-MISSION-ADDENDUM.md`
5. `docs/PROGRESS.md`
6. `docs/BLOCKERS.md`
7. `docs/JENNY-ARENA-CONTRACT.md` when Arena is involved

The master context defines the product, the collaboration protocol defines ownership and review,
and the current mission defines the implementation sequence. Older reports are evidence, not active
instructions. Observed code and production behavior override stale claims; update the source-of-truth
documents when they drift.

Claude Code owns JennySol implementation during the current parallel mission. Cursor owns Arena.
Do not edit an active repository owned by another agent. Publish cross-product changes through a
reviewed contract and contract tests.

Before extending Goal Mode, write and accept an ADR defining the boundaries between `AgentRun`,
`AgentGoalRun`, and `AgentSession`. Do not describe Goal Mode as complete until restart recovery,
approval continuation, a user-facing API/UI, privacy routing, and observability are implemented and
tested.
