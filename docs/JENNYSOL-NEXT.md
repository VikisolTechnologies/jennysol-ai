# JENNYSOL — NEXT RUN (after the FINISH-ALL run)

Written by the architect (Claude, linked to the founder's Mac) on 26 Sep 2026, after reading `JENNYSOL-REPORT.md`, `JENNYSOL-EVAL-RESULTS.md`, `BLOCKERS.md` and `JENNYSOL-ARCHITECTURE.md`. Read it with `docs/VIKISOL-MASTER-CONTEXT.md`, `docs/JENNYSOL-MISSION-2.md` and `docs/PROGRESS.md`.

**Don't restart. Work continuously and don't stop to ask.** Log anything blocked in `BLOCKERS.md`, take the most reasonable option, and record it in `docs/DECISIONS.md`. Branches only; update `PROGRESS.md` after every step.

## The founder's decisions (made 26 Sep 2026 on the architect's recommendation)

1. **Dashboard:** build **Option A, the timeline** (`docs/design/run-dashboard-option-a-timeline.html`). It's mobile-first, shows the plan step by step, and has a working Stop button.
2. **Privacy defaults:**
   - Arena gateway traffic: `PUBLIC_CLOUD`. It carries public posts only; the user's own context text is minimal.
   - JennySol's own documents, memory and uploaded files: `PRIVATE`, meaning local Ollama only. It fails honestly if local isn't available and never falls back to the cloud silently.
   - Ship in **shadow mode** first (log only), then enforce once the log looks clean.
3. **Provider order (cost).** The report shows almost all live chat is paid Gemini because Ollama is last in the chain. That goes against local-first. The plan:
   - (a) Turn on `OLLAMA_KEEP_WARM_CAPABILITIES` for the general and fast models.
   - (b) Put local first for `general` and `fast` tasks, with Gemini as the fallback on timeout or error (hedging as needed).
   - (c) Measure p50/p95 latency and the local share before and after on the 20-prompt routing set, and write down the result.
   - If local-first makes the p95 clearly worse for users, keep it behind a flag and report the numbers instead.
4. **Paid keys:** still none. `DEEPSEEK_API_KEY` is approved *in principle* as a cheap backup, but only the founder adds it, in Railway. Don't ask for it in chat.
5. **The execution plan** `JennySol_End_to_End_Execution_Plan.docx` exists. Its content is summarized in `VIKISOL-MASTER-CONTEXT.md` §6.12–6.13, which is the authoritative proxy. You don't need the .docx.

## Steps

### STEP 1 — Independent review of `feature/jenny-audit`
The architect is doing a code review of this branch from the linked session. Also start a **fresh Claude Code session (or Codex)** with no memory of writing the code. Have it review `git diff main...feature/jenny-audit` and re-run the tests and the 3 live eval scenarios. Fix what it finds. When everything is green, merge to `main`, deploy, and confirm `/health` shows the new commit. Re-run the gateway contract tests against production.

### STEP 2 — Provider order and keep-warm
Decision 3 above, behind flags, measured before and after.

### STEP 3 — Privacy tiers
Decision 2 above: shadow mode → review the logs → enforce.

### STEP 4 — Finish the v1 Definition of Done gaps
- **Goal Mode re-planning:** an explicit observe → re-plan step, with stop conditions and budgets.
- **Run dashboard UI**, Option A: real frontend with a working Stop button. It ships to production because it's new, not a redesign.
- **Workflow (b):** research question → cited report, using `jennysol.webSearch` and page extraction.
- **Workflow (c):** developer flow on a **disposable sandbox repo only**: inspect → run tests → draft a PR, with approval before the PR is created.
- **At least 10 safe tools**, all risk-rated and audited. List them in the report.
- **20 deterministic scenarios** against real models: include budget-exceeded, a WRITE approval pause, and failure recovery.

### STEP 5 — Vikisol One connector (mock only)
Design and test it against a mock. Never touch Vikisol One code, its database or `enchanting-vibrancy`.

### STEP 6 — Voice, then the UI preview
Make voice reliable on mobile, with local whisper.cpp/Kokoro only if they fit in 16GB. Then put the chat, voice and settings mockups on a **Vercel preview** (not merged) for the founder.

### STEP 7 — Report
Update `docs/JENNYSOL-REPORT.md`:
- what's live, with `/health`;
- flags on/off;
- latency and cost before/after, including the local share;
- evals;
- the 3 workflows;
- the preview URL;
- blockers;
- 5 things to try on the phone.

Then stop.

## Hard limits (unchanged)
- Never edit the Arena repos (Cursor owns them). Proposals go in `JENNY-ARENA-CONTRACT.md` §6.
- Never break the live gateway.
- Never touch Vikisol One.
- No secrets in chat, git or logs.
- No DNS changes and no Mac exposure or cutover.
- No new paid keys.
- No models over ~8GB.
- No force-push to `main`.
