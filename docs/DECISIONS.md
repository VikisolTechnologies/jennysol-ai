# Decisions log

Format: date, what was decided, who/what decided it, why. Founder decisions come from
`VIKISOL-MASTER-CONTEXT.md` §11 or `JENNYSOL-NEXT.md`; "reasonable option taken" entries are ones
an agent picked while continuing without stopping, per the collaboration protocol §5's instruction
to consolidate founder-only questions rather than interrupt for routine ones.

---

## 2026-09-26 — Reconciled AgentRun / AgentSession / AgentGoalRun (ADR-006)

**Decided by:** Claude Code, per `AGENT-COLLABORATION-PROTOCOL.md` §5's explicit requirement to do
this before extending Goal Mode further.
**What:** all three are legitimate, non-redundant, and stay separate — different audiences,
different tool boundaries, different data models. No merge, no deletion. Naming discipline going
forward: "AgentRun" used for the goal-mode concept (as `VIKISOL-MASTER-CONTEXT.md` §6.3/§13
sometimes does) should be read as `AgentGoalRun`.
**Why it mattered:** my own STEP 2 audit (`JENNYSOL-CURRENT-STATE.md`) missed `AgentSession`
entirely — a real, substantial, already-built, tested, wired-in internal AI-engineering
orchestrator (6 test files, admin routes, resumes in-flight sessions on boot) that I never
discovered before building `AgentGoalRun`. Full reasoning in `docs/architecture/ADR-006-*.md`.

## 2026-09-26 — Founder decisions incorporated from `JENNYSOL-NEXT.md`

1. **Dashboard:** build Option A (the timeline), not Option B.
2. **Privacy defaults:** Arena traffic `PUBLIC_CLOUD`; JennySol's own documents/memory `PRIVATE`
   (local Ollama only, fails honestly if unavailable). Shadow mode first, enforce after review.
3. **Provider order:** turn on `OLLAMA_KEEP_WARM_CAPABILITIES` for general+fast, put local first
   for those two task types with Gemini as the timeout/error fallback, measure p50/p95 and local
   share before/after on the 20-prompt routing set, keep behind a flag if p95 gets clearly worse.
4. **Paid keys:** still none added. `DEEPSEEK_API_KEY` approved in principle but only the founder
   adds it in Railway — not requested in chat.
5. **The execution plan `.docx`:** confirmed not needed; `VIKISOL-MASTER-CONTEXT.md` §6.12–6.13 is
   the authoritative proxy.

## 2026-09-26 — Provider order measured for real, kept off (STEP 2)

**Decided by:** Claude Code, per decision #10's own explicit fallback clause ("if local-first makes
p95 clearly worse, keep it behind a flag and report the numbers").
**What:** built `LLM_LOCAL_FIRST_ENABLED` (off by default, fully tested, dormant in production) but
recommend **not** turning it on. Real measurement: p95 went from 11s to 121s (over 2 minutes on one
request, one request had to be manually killed). Full numbers and root cause in
`docs/JENNYSOL-PROVIDER-ORDER-MEASUREMENT.md`.
**Why it matters beyond this one decision:** found a genuine robustness gap while measuring — the
router's first-token timeout doesn't cap a "thinking" local model's total response time, only
whether it's shown *any* sign of life. Logged in `BLOCKERS.md` as real follow-up work, not fixed
this session.

## 2026-09-26 — STEP 2b re-measure, flag still off

**What:** the hang fix is in. Thinking tokens do not count as answer progress. Ollama has a 30s
deadline (60s for reasoning). qwen3 general/trivial requests send `think: false`. Re-measure on the
same 20 prompts: p50 1,523ms → 7,027ms, p95 12,005ms → 18,885ms (1.57×), local share 25%,
errors 0. That is inside the review's 1.5× band, so turning local-first on is proposed. The flag
stays off until the founder says otherwise.
**Why:** five trivial prompts finished locally; one hit the 30s cap. The
p95 improvement versus the 121s run is the deadline, not evidence that local answers are fast.
