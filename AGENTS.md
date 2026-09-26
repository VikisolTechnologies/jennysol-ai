# JennySol agent entry point

Before changing code, read in this order:

1. `docs/VIKISOL-MASTER-CONTEXT.md`
2. `docs/AGENT-COLLABORATION-PROTOCOL.md`
3. `docs/JENNYSOL-NEXT.md` (the current mission; it builds on `JENNYSOL-MISSION-2.md` and the addendum)
4. The newest file in `docs/reviews/` (the architect's instructions)
5. `docs/PROGRESS.md`
6. `docs/BLOCKERS.md`
7. `docs/JENNY-ARENA-CONTRACT.md` when Arena is involved

The master context defines the product, the collaboration protocol defines ownership and review,
and the current mission defines the implementation sequence. Older reports are evidence, not active
instructions. Observed code and production behavior override stale claims; update the source-of-truth
documents when they drift.

Claude Code normally owns JennySol implementation. **On 26 Sep 2026 at 14:30 IST the founder temporarily transferred ownership to a separate Cursor window**, because Claude Code is out of tokens. Only one agent works here at a time. The current owner records every commit SHA in `docs/PROGRESS.md` and in the review file's Response section. When Claude Code returns, it resumes from `PROGRESS.md`. Cursor also owns Arena, in its own separate window.
Do not edit an active repository owned by another agent. Publish cross-product changes through a
reviewed contract and contract tests.

Before extending Goal Mode, write and accept an ADR defining the boundaries between `AgentRun`,
`AgentGoalRun`, and `AgentSession`. Do not describe Goal Mode as complete until restart recovery,
approval continuation, a user-facing API/UI, privacy routing, and observability are implemented and
tested.
