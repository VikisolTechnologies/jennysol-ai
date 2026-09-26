# Goal Mode eval (STEP 4)

26 Sep 2026. This is what was actually run. It does not include a live 20-prompt pass against real models for goal execution. That pass was not run. The 20-prompt provider-order measurement is a separate latency check and is recorded in `JENNYSOL-PROVIDER-ORDER-MEASUREMENT.md`.

## What is in the product

- After a tool step, and only while the run is still `running` and inside its budget, `startRun` makes one observe → re-plan call with no tools. A WRITE pause, a budget stop, or a cancellation does not re-plan.
- `/runs` is the Option A timeline. It lists the signed-in user's goal runs, and a running run has a Stop button that calls `POST /api/goal-runs/:id/stop`.
- Workflow (b) formats a cited report from search hits (`citedReport`). A hit with no URL or no snippet is dropped. No hits means no report. Page fetching is not built.
- Workflow (c) is the Agency scorecard (`draftAgencyScorecard`). A pasted requirement becomes must-haves, nice-to-haves, and a search strategy. The recruiter decides. It does not contact candidates, scrape, or write to an ATS.
- Goal Mode is not complete. Restart recovery, approval continuation after a process restart, privacy routing inside the goal loop, and production observability of goal runs are still open.

## Tools, with the risk already on each one

| Tool | Tier | Risk |
|---|---|---|
| jennysol.currentDateTime | READ | low |
| jennysol.getWeather | READ | low |
| jennysol.webSearch | READ | low, only when a search provider is configured |
| arena.search | READ | low |
| arena.nearbyActivities | READ | low |
| arena.listCommunities | READ | low |
| arena.searchJobs | READ | low |
| arena.createPost | WRITE | medium |
| arena.createProject | WRITE | medium |
| arena.joinActivity | WRITE | medium |
| arena.placeBid | WRITE | high |
| arena.applyToJob | WRITE | high |

## Deterministic coverage

`server/src/services/goalScenarios.test.ts` runs 20 cases with no model: privacy shadow and enforce, the scorecard, and cited reports.

These runtime cases use a mocked router and the real tool registry:

- budget exceeded: `stops calling tools once the step budget is spent`
- WRITE approval pause: `a WRITE tool call pauses the run at awaiting_approval`
- second WRITE refused: `refuses a second WRITE proposal while a run is already awaiting approval`
- failure recovery: `a provider failure ends that run and the next run still completes`
- user stop: `a real call to stopRun() aborts an in-flight run`

No live-model pass count is claimed for those five.
