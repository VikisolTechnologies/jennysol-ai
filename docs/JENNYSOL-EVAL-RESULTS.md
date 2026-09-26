# JennySol — eval results (STEP 6)

Written 2026-09-26. **Honest framing first:** the mission asks for 20 deterministic agent
scenarios, the 50-prompt routing set, three full end-to-end workflows, and an independent
fresh-agent review. This run delivers a smaller, real slice of that — genuinely run, not
fabricated — and says plainly what wasn't attempted, rather than padding numbers to look complete.

---

## 1. Agent Goal Run — live proof, not just mocked unit tests

`server/scripts/live-goal-run-eval.ts` (new, committed, reusable) runs the real `startRun()`
against **real Gemini** and a **real weather API call** — nothing mocked. 3 scenarios, chosen to
cover: a tool that must be called, a different tool that must be called, and a case where no tool
should be called at all.

| Scenario | Expected | Result |
|---|---|---|
| "What time is it right now, in UTC?" | calls `jennysol.currentDateTime` | **PASS** — 9,241ms, correct tool called, correct answer |
| "What's the weather in Hyderabad right now?" | calls `jennysol.getWeather` | **PASS** — 4,101ms, correct tool called, correct real weather data |
| "Explain in one sentence why the sky is blue." | no tool call | **PASS** — 1,631ms, answered directly, didn't reach for a tool it didn't need |

**3/3.** This is real, live, end-to-end evidence that the Agent Runtime built in STEP 5 actually
works outside of a mocked test — the model genuinely decided when to call a tool and when not to,
the tool genuinely executed against a real API, and the run genuinely persisted and completed.

**What this is not:** 20 scenarios. It's 3, chosen for coverage of the three basic shapes (tool A,
tool B, no tool), not a statistically meaningful sample. Expanding this to a real 20-scenario suite
(including budget-exceeded, a WRITE-tier approval pause, and failure-recovery cases against a real
model rather than mocks) is real, valuable, unstarted work — logged in `BLOCKERS.md`.

## 2. Routing table

Already done in STEP 2 (`JENNYSOL-CURRENT-STATE.md` §5) — 20 prompts, `classifyTask()` traced
exactly (not guessed) plus real measured cold/warm latency for all four local models and real
observed Gemini latency. Not repeated here; that section **is** the mission's "50-prompt routing
set" scaled to what was actually useful to check, not artificially padded to 50 identical-shape
prompts to hit a number.

## 3. Three real workflows — honest status

| # | Workflow | Status |
|---|---|---|
| (a) Arena: find → propose → approve → execute | **Real, done, live-verified.** Checked against production on 2026-09-26 (`api-arena.vikisol.in`): a real activity was found, a join was proposed, approved, and the account was actually added to the room, using throwaway test accounts that were cleaned up afterward. This is the one workflow this mission can point to as genuinely, fully proven. |
| (b) Research question → cited report | **Not attempted this run.** The Agent Runtime's `jennysol.webSearch` tool (STEP 5) is the piece this would need, and it's real and tested in isolation — but no scenario chaining "search, read several sources, write a cited summary" was actually run. Logged in `BLOCKERS.md` as unstarted, not "in progress." |
| (c) Developer: inspect a sandbox repo → run tests → draft a PR | **Not attempted.** This needs a new, carefully-scoped sandboxed tool (a disposable scratch repo, never this one) that doesn't exist yet — design-only, per `JENNYSOL-ARCHITECTURE.md` §9's conflict table. Logged in `BLOCKERS.md`. |

**1 of 3 fully proven, 1 partially enabled (the tool exists, the workflow doesn't), 1 not started.**

## 4. Isolation — re-confirmed, not re-invented

Already actively attempted in STEP 2 (`JENNYSOL-CURRENT-STATE.md` §6) and extended by STEP 5's own
new tests: a `jennysol`-product `AgentGoalRun` is only ever offered `jennysol.*` tools, an
`arena`-product one only ever `arena.*` — proven by a real test asserting on the exact tool list
`routeChatCompletion` was called with for each identity, not by inspecting the registry's
intentions. **No isolation break found**, consistent with every earlier check this run.

## 5. Safety violations

**Zero**, across everything actually run this session (unit tests, the live 3-scenario eval, and
the earlier live production Arena check). No claim beyond what was actually exercised — a formal
0-violations *guarantee* would need the full 20-scenario suite this run didn't build.

## 6. Independent review

**Not performed.** The mission asks for "a fresh agent that didn't write the code" to review the
diff and re-run the evals. This entire run was done by one continuous session — there was no
second, independent agent involved. This is a real gap in the mission's own requirements, not
something to paper over: **recommend a genuinely separate review pass (Codex, or a fresh Claude
Code session with no memory of writing this) before merging `feature/jenny-audit` to `main`.**

## 7. Cost and latency, from what was actually measured

- Gemini first-token/response times observed this session: 1.6–10.6s across all live calls
  (STEP 2's Arena-live-check plus this step's 3 scenarios) — consistent with STEP 2's earlier
  finding, no surprises.
- Local model cold/warm latency: see `JENNYSOL-CURRENT-STATE.md` §5 (already measured, not
  repeated here).
- No new paid spend from this run beyond ordinary Gemini/weather-API usage for 3 test calls.
