# JENNYSOL — FINISH EVERYTHING IN ONE RUN

**Don't restart.** Continue from `docs/PROGRESS.md`. This replaces STOP GATE 1 in the JennySol mission. Everything else still applies: the mission, the addendum, and `docs/VIKISOL-MASTER-CONTEXT.md`.

The founder is away. **Work continuously to the end. Don't stop to ask.** If something is blocked, log it in `docs/BLOCKERS.md`, take the most reasonable option, note which one you took, and keep going.

**Release rules for this run:**
- **Backend and runtime work may go to production** only when all of these hold:
  - tests are green,
  - the eval gates pass,
  - the live Arena gateway is proven unchanged,
  - new behaviour ships behind a flag with a one-step rollback.
- **The JennySol app UI redesign goes to a private preview only.** Production keeps the current UI until the founder approves.
- **Feature branches only.** Small PRs, merged when green. Never force-push `main`.

---

## STEP 0 — Correct the facts first
Do the corrections you proposed. Update the mission to match the verified state:
- The Arena gateway is live, so extend it and never redesign it.
- Reasoning routing is fixed.
- Vision (`qwen3-vl:4b`) is wired.
- Tests are at 682/2 skipped; the tip is `33abb27`.
- The fleet includes the vision models.
- `OLLAMA_MODEL=llama3.2` is an intentional dead fallback; leave it.

Update `docs/VIKISOL-MASTER-CONTEXT.md` §6.14 and §10 if anything else differs. Commit the result as `docs/JENNYSOL-MISSION-2.md`.

## STEP 1 — Lock the live contract before touching anything
- Write **contract tests** for the live Arena gateway: `/api/agent/gateway/chat`, `/actions/:actionId`, and the tools `arena.createPost`, `joinActivity`, `createProject`, `placeBid`, `applyToJob`.
- The tests must cover:
  - propose → approve → execute,
  - single-use actions,
  - 5-minute expiry,
  - scope checks on both sides,
  - rejection of a forged, expired or reused action.
- These tests must stay green through the whole run.
- Risk ratings:
  - `placeBid` and `applyToJob` are **High**: always explicit approval.
  - `createPost` and `createProject` are **Medium**: user confirmation.
- Document the contract as it exists in `docs/JENNY-ARENA-CONTRACT.md`, and note which Arena endpoints it depends on, for Cursor.

## STEP 2 — Finish the audit
Complete `docs/JENNYSOL-CURRENT-STATE.md` from the mission's Phase 1, including:
- the real routing table (20 prompts, cold/warm latency),
- security (actively try to break cross-user isolation),
- cost,
- dead code,
- the gap against the plan's v1 Definition of Done.

## STEP 3 — Stabilize → production
- **Cold start:**
  - warm the default chat models on boot and on a light schedule;
  - use `keep_alive`;
  - stream a "warming up" state instead of timing out;
  - if the model isn't ready in time, fall back to `qwen3:4b` or cloud.
- **Provider resilience:** timeouts, retries, a circuit breaker per provider, and an honest message when everything is down.
- **Cleanup:** remove dead code and archive stale docs.
- Deploy when green. Confirm the live `/version`, and re-run the gateway contract tests against production.

## STEP 4 — Architecture blueprint
Write `docs/JENNYSOL-ARCHITECTURE.md` using the strongest model. Include:
- everything in mission Phase 3 and addendum §5;
- a table mapping the v1 Definition of Done to code, tests and status;
- the conflicts with the master plan (stack, repo layout, vector store, Vikisol One) with a recommendation for each. **The default is to keep the current stack.**
- the core contracts in code: Agent, Tool, Task, Run, Memory, Approval, Model.

## STEP 5 — Build the v1 core → production (behind flags)
Refactor what exists into the plan's components as modules inside `jennysol-ai`. Don't rewrite.

1. **Model Gateway.**
   - A config registry: role, context, local/cloud, privacy tier, cost, health.
   - One interface for chat, stream, embed and vision.
   - Routing by task, privacy, health, latency and cost.
   - Prove the same run works on Ollama and on Gemini by changing config only.
2. **Privacy tiers** LOCAL / PRIVATE / PUBLIC_CLOUD, with **no silent escalation to cloud**. Run in shadow mode first (log the decision, don't enforce it). Enforce only after the eval gates pass.
3. **Agent runtime (Goal Mode).**
   - Plan → execute → observe → re-plan.
   - Tasks, TaskSteps and AgentRun as a state machine: queued → running → awaiting_approval → completed / failed / cancelled.
   - The addendum's stop conditions.
   - Step, time and cost budgets, with usage logged per run.
4. **Tools.**
   - At least 10 safe tools, each typed, scoped to the **user's** permissions, and risk-rated (Low / Medium / High / Critical).
   - Approvals through `pendingActions`.
   - Trace IDs and an audit event on every call.
   - Recovery from common failures, with no silent success.
5. **Memory and RAG.**
   - Scoped by user + product + tenant + purpose.
   - Users can see, export and delete their memory.
   - Keep the in-process embeddings.
   - Prompt-injection defence: retrieved content is data, never instructions.
6. **Task/run dashboard** in the app. It is new, not a redesign, so it can ship. It shows the plan, the steps, the tool calls and the approvals, and has a working **Stop** button.
7. **Vikisol One connector:** design and test it against a **mock only**. Never touch One.

## STEP 6 — Prove it: evals and 3 workflows
- **Evals:** 20 deterministic agent scenarios plus the 50-prompt routing set. Targets:
  - routing accuracy ≥ 95%,
  - task success,
  - first-pass success,
  - tool success,
  - recovery rate,
  - human-intervention rate,
  - cost per successful task,
  - p50/p95 latency (warm and cold),
  - local share of traffic,
  - **zero** safety violations.
- **Three real workflows, end to end:**
  - (a) Arena, via the live gateway: find an activity or opportunity, propose, approve, executed. Use test accounts only; label and clean up any content they create.
  - (b) A research question → a cited report.
  - (c) Developer: inspect a **sandbox** repo → run tests → draft a PR, with approval before it's created.
- **Isolation:** user A can never reach B's runs, memory or files.
- **Independent review:** a fresh agent that didn't write the code reviews the diff and re-runs the evals.
- **Switching features on:** enable each production flag only once its gates pass. Keep a one-step rollback for each.

## STEP 7 — Voice (only after the text core is green)
- Make barge-in and streaming reliable on mobile, with browser STT + Gemini TTS.
- Add local whisper.cpp and Kokoro behind flags, **only if** they fit in 16GB alongside the fleet. Otherwise document that and skip them.

## STEP 8 — JennySol app redesign → private preview
- Produce mockups in `docs/design/`: chat, voice mode, run/approval view, memory & privacy settings.
- Where there's a real choice, pick one and show the alternative beside it.
- Build the chosen design on `feature/jenny-ui` and deploy it to a **Vercel preview**, protected and not indexed. **Do not merge it.**

## STEP 9 — Report, then stop
Open the PR for the UI (green, not merged). Write `docs/JENNYSOL-REPORT.md`:
1. What's live in production now, with `/version` and which flags are on or off.
2. Eval numbers before and after, latency, cost, and the local/cloud split.
3. The 3 workflows: results and evidence.
4. The gateway contract status for Cursor.
5. The preview URL and where the test logins are (never in git).
6. `BLOCKERS.md` and `ACCESS-NEEDED.md`, with a monthly cost for any paid key requested.
7. **The top 5 things to try on the phone.**
8. The exact steps to approve the UI, and the rollback steps for every production flag.

Update `docs/PROGRESS.md`, then stop.

---

## Hard limits
- Never edit the Arena repos (Cursor owns them). If Arena needs a change, write it in the contract doc.
- Never touch Vikisol One / HRLMS or `enchanting-vibrancy`.
- Never print, log or commit secrets.
- No DNS changes.
- No Mac exposure and no production cutover to the Mac.
- No new paid keys (list them instead).
- No models over ~8GB on the Mac.
- Never break the live Arena gateway.
- The UI redesign doesn't reach production without founder approval.
