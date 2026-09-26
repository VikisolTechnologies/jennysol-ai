# Blockers

Format: date, what's blocked, why, the option taken, and what it would take to unblock properly.

---

## 2026-09-26 — STEP 2b / 3 / 4

1. **The unbounded local hang is closed.** Thinking tokens no longer keep an Ollama request alive, and a wall-clock deadline aborts it. Re-measure: p95 12,005ms → 18,885ms, 1 error, no multi-minute run. `LLM_LOCAL_FIRST_ENABLED` stays off. Turning it on is a founder decision; the new p95 is 1.57× today's, past the review's about-1.5× line.
2. **Privacy tiers exist in shadow mode.** `PRIVACY_TIER_ENFORCE` is unset, so private traffic is logged and still uses today's chain. Enforce stays off until a shadow log has been read. Arena gateway traffic is marked `PUBLIC_CLOUD`. A chat turn that retrieved documents, and memory summarization, are marked `PRIVATE`.
3. **Workflow (c) is the Agency scorecard**, not a developer sandbox PR. The scorecard drafts must-haves and a search strategy. The recruiter decides. Candidate coordination and database rediscovery wait for paid pilots.
4. **Workflow (b) cites search hits and refuses an empty search.** It does not fetch the page behind a URL.
5. **The 20 goal scenarios in `goalScenarios.test.ts` do not call a live model.** Budget exceeded, WRITE pause, and failure recovery are covered with a mocked router. No live-model pass count is claimed.
6. **Goal Mode is not complete.** Restart recovery, continuing an approval after a process restart, and goal-run observability are still open.

---

## 2026-09-26 — STEP 2b v2: the 2.5s first-token timeout was itself miscalibrated, and local-first now fails outright instead of hanging

Re-verifying item 1 above (a fresh pass, not written by whoever wrote item 1) found the first pass's
own 2,500ms `LLM_LOCAL_FIRST_TOKEN_TIMEOUT_MS` default was too tight to ever let a real attempt
finish: direct curl timing against the real Ollama host showed 3.15–3.82s to first answer token
with thinking off, so the timer tripped before generation had a chance almost every time. Raised
the default to 8,000ms (`modelRouter.ts`) and re-measured: p95 ratio improves to **1.15×** (from
1.57×), local share rises to 30% (6/20, from 5/20). Full numbers:
`docs/JENNYSOL-PROVIDER-ORDER-MEASUREMENT.md` ("STEP 2b re-measure v2").

That re-measurement surfaces a real, previously-hidden reliability problem: **3 of 20 requests
(15%) now fail outright** rather than falling back to Gemini, because the router won't retry a
request after it's already streamed partial answer content — correct for `PRIVATE`-tier traffic
(must never leak to the cloud), but for `general`/`trivial` `PUBLIC_CLOUD`-eligible traffic it
means a real user sees a hard failure where today they'd just get a normal (if slower) Gemini
reply. `LLM_LOCAL_FIRST_ENABLED` stays off — the reason has shifted from "latency" to
"reliability." Unblocking this for real needs a decision: should a non-private local attempt that's
already streamed be allowed to hand off to Gemini with a fresh "let me answer that again" rather
than failing, since (unlike `PRIVATE` traffic) it was never barred from the cloud in the first
place? Not built this session — a real product decision (does the user see a visible redo, or does
it silently restart) rather than a quick patch.

---

## 2026-09-26 — STEP 5/6 deferrals (not blocking, honestly scoped out of this run)

These aren't "stuck" in the sense of needing outside input — they're real work this single
continuous run didn't reach, given the actual size of the mission's roadmap. Listed here per
FINISH-ALL's own instruction ("log it in BLOCKERS.md... take the most reasonable option... and
keep going") rather than silently skipped or falsely claimed done.

1. **Privacy tiers (LOCAL/PRIVATE/PUBLIC_CLOUD) are designed (`JENNYSOL-ARCHITECTURE.md` §4),
   not built.** Reasonable option taken: don't guess the founder's real decision (which surfaces
   default to which tier) in shipped code — flag it for a real decision instead.
2. **Full Goal-Mode re-planning** (a dedicated "observe, then deliberately re-plan" call, distinct
   from the existing multi-round tool-calling inside one `routeChatCompletion` call) — the
   simpler version built in STEP 5 proves the persistence/stop/budget layer for real, but isn't
   the final sophistication.
3. **A real task/run dashboard UI.** Two mockup options exist (`docs/design/`); neither was built
   as working frontend code.
4. **Vikisol One connector (mock only, per the hard limit)** — not started.
5. **The research workflow** ((b) in `JENNYSOL-EVAL-RESULTS.md` §3) and **the developer
   sandbox-PR workflow** ((c)) — not attempted. The tools workflow (b) would need
   (`jennysol.webSearch`) already exist and are tested in isolation; workflow (c) needs a new
   sandboxed tool that doesn't exist yet.
6. **A full 20-scenario eval suite** — only 3 real, live scenarios were run (STEP 6). Reasonable
   option taken: 3 genuine, live-verified scenarios covering the three basic shapes (tool A, tool
   B, no tool) rather than a padded 20 that would include mocked repeats.
7. **Independent review by a fresh agent that didn't write this code** — didn't happen; this was
   one continuous session. Recommend a real second-agent review before merging to `main`.
8. **STEP 7 (voice) and STEP 8 (an actual Vercel preview deploy of the UI, beyond the static
   mockups already produced)** — not reached this run, given the size of what came before them.

## 2026-09-26 — independent review of `feature/jenny-audit` (`docs/reviews/74ad94c.md`)

Verdict: **CHANGES REQUIRED**, found real issues, nothing catastrophic (the runtime isn't reachable
by any real route yet, so nothing was at production risk). Findings #1 (rawToken hardcoded to `""`)
and #2 (a second WRITE proposal within one paused run could orphan the first) were fixed the same
day with real tests — see `git log`. Finding #4 (a stale DoD-table claim) was corrected in
`JENNYSOL-ARCHITECTURE.md`. Finding #5 was already honestly disclosed in `PROGRESS.md`/`BLOCKERS.md`
as "no approval continuation yet" — re-confirmed by direct code inspection rather than taken on
faith.

## 2026-09-26 — local deadline fixed (STEP 2b); local-first still off

The wall-clock cap and "thinking tokens are not answer progress" fix are in. Re-measure on the same
20 prompts: p95 12,005ms → 18,885ms (1.57×), local share 25%, 1 error.
`LLM_LOCAL_FIRST_ENABLED` stays off until the founder decides. See
`docs/JENNYSOL-PROVIDER-ORDER-MEASUREMENT.md`.

## 2026-09-26 — real robustness gap found while measuring provider order (STEP 2 of JENNYSOL-NEXT.md)

The router's first-token timeout is satisfied by *any* provider activity, including a local
"thinking" model's trace tokens — a deliberate design for telling cold-vs-hung apart, not for
capping total response time. Real measurement (`docs/JENNYSOL-PROVIDER-ORDER-MEASUREMENT.md`)
found this lets a single request run for **over two minutes** (once needing a manual kill) while
technically staying "alive" the whole time. Needs: an overall wall-clock cap on a single attempt,
independent of the first-token/activity check, so a genuinely runaway local generation is aborted
rather than left running indefinitely. Fixed in STEP 2b (see the entry above): 30s/60s wall-clock
cap, thinking tokens do not count as answer progress, thinking off for general/fast qwen3.

**Finding #3 — investigated and closed, not just left open:** checked every provider that
implements tool-calling at all (`gemini.ts`, `anthropic.ts` — `deepseek.ts` and `ollama.ts` don't
implement `onToolCall` currently, confirmed by grep). Both call `onToolCall` inside a plain
`for (const call of calls) { output = await onToolCall(...) }` / `for (const use of toolUses)`
loop — strictly sequential, never `Promise.all` or otherwise concurrent. The step-budget check's
lack of a lock is therefore not reachable today. Re-open this if a future provider (or a change to
an existing one) ever parallelizes tool-call dispatch.

---

## 2026-09-26 — Agency scorecard (workflow (c)), rebuilt per docs/reviews/d27386b.md

1. **The regex stub is replaced with the real thing**: model-driven structured output
   (`agency/scorecard.ts`, one repair retry), a protected-attribute guardrail
   (`agency/guardrail.ts`, tested against 6 categories), SQLite persistence with
   draft/edit/approve (`agency/scorecardStore.ts`, audited), REST endpoints
   (`routes/agencyScorecards.ts`), and a minimal mobile-friendly UI (`/agency`). Only an approved
   scorecard is meant to be used downstream (`requireApproved()`), though nothing downstream calls
   it yet — there is no "use an approved scorecard" consumer built this batch.
2. **10-JD live eval, synthetic/public JDs only**: field accuracy 10/11 (91%), contradiction
   detection 2/2, protected-attribute leakage **0/4** attempts leaked (verified with an
   independent keyword check, not the same regex the guardrail itself uses). Full numbers and the
   JD set: `docs/JENNYSOL-EVAL-RESULTS.md`.
3. **A real, separate finding from the eval, not a scorecard bug**: `LLM_FIRST_TOKEN_TIMEOUT_MS`
   (10,000ms, the router's existing PRIMARY-provider timeout — unrelated to STEP 2b's Ollama-only
   tuning) is sometimes too tight for this specific workload — a heavy structured-JSON-extraction
   prompt against Gemini, called back-to-back. Two live eval runs saw 2/10 and 4/10 requests fail
   with "All configured AI providers are currently unavailable" — a genuine first-token timeout on
   the only configured provider in this environment, not a hang and not a scorecard defect (the
   repair retry doesn't help, since both attempts hit the same timeout on the same sole provider).
   Not fixed this session — needs either a longer, capability-specific timeout for heavy
   structured-extraction work, or a real second configured provider to fall back to.
4. **The chat-callable `jennysol.draftAgencyScorecard` tool and the persisted `/agency` UI flow
   are two separate paths that both call the same drafter** — the tool's draft is never persisted
   or guardrail-audited the way the UI flow's is. Fine for now (the tool is a low-risk READ
   preview, not the approval-gated path), but worth a real decision later on whether the tool
   should be retired in favor of always going through the persisted flow.

## 2026-09-26 — Goal Mode approval continuation, built but not reachable via any real WRITE tool yet

Built `resumeAfterApproval()` (`agentRuntime/runtime.ts`) and a session-authenticated
`POST /api/goal-runs/:id/actions/:actionId` — the second entry point the review asked for into the
SAME `consumeAction`/`toolRegistry.dispatch` primitives `routes/agentGateway.ts`'s own approve
route already uses (not a second approval mechanism). Fully tested at the service layer
(18 tests, real Arena WRITE-tool dispatch via a mocked `fetch`) and at the route layer (auth,
validation, ownership, wrong-run/wrong-action edges).

**Real, honest limitation**: `goalRunsRouter.ts`'s `identityFor()` only ever grants
`jennysol.*` scope, and the `jennysol` connector has zero WRITE-tier tools today (all four —
`currentDateTime`, `getWeather`, `webSearch`, `draftAgencyScorecard` — are READ). That means a
real JennySol-app goal run can never actually reach `awaiting_approval` in production right now —
this endpoint is correct, tested, and ready, but currently dead code from the route's own
perspective until JennySol's own connector gets its first real WRITE tool (or a goal run's
identity is ever given `arena.*` scope, which nothing does today). Logged here rather than
claimed as a closed loop end-to-end in production.

## 2026-09-26 — Run dashboard: Option A's structural elements are live, not a pixel-perfect port

`/runs` (`GoalRuns.tsx`) now has a colored status pill per run state (running/awaiting/completed/
failed/cancelled — matching `docs/design/run-dashboard-option-a-timeline.html`'s color scheme),
colored step dots (green = ended, red = errored, grey = pending), and — new this batch — real
Approve/Reject buttons wired to the endpoint above, alongside the existing Stop button. It is not
a pixel-for-pixel rebuild of the mockup file (no per-run step counts like "step 2 of ~4", no
distinct "Plan" vs "Tool" step icons) — a reasonable, real, working timeline rather than a
from-scratch redesign.

## 2026-09-26 — Not reached this batch, honestly scoped out given the size of what came before

1. **Workflow (b) (research → cited report) was not enhanced.** It remains what it was before
   this batch: a deterministic snippet-stitcher (`research/citedReport.ts`), not a
   model-synthesized answer. Real, valuable, unstarted work for the next batch.
2. **Vikisol One connector (mock only)** — not started.
3. **Voice reliability and the Vercel UI preview** — not started.
4. **A stale git stash** (`stash@{0}`, "privacy wiring") is confirmed superseded — its content is
   already on `main` (verified by diffing it against the current `agentGateway.ts`/
   `chatRunner.ts`) — but dropping it was refused by this session's own sandbox as an
   "irreversible local destruction." The founder can drop it directly: `git stash drop stash@{0}`.

---

## 2026-09-26 (evening) — URGENT: production chat is down tonight. Two separate incidents, neither caused by ADR-007 code, both need founder action

### 1. Gemini (CONTROLLED_CLOUD / primary provider): paid project's prepayment credits are depleted (HTTP 402)

Confirmed live, twice, against production's own real `GEMINI_API_KEY` (via `railway run`, key value
never printed):

```
{"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio at
https://ai.studio/projects to manage your project and billing. Learn more at
https://ai.google.dev/gemini-api/docs/billing#prepay. ","status":"RESOURCE_EXHAUSTED"}}
```

Also visible live in `jennysol-api`'s own logs (`[router] gemini failed (other): ... code":402`),
alongside earlier same-night `429` quota-exceeded errors on the *free-tier* metric name
(`generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15`) — meaning
this key has been intermittently falling back to (or was never fully off) the free tier's rate
limit before the prepaid balance ran out entirely. Both are billing-account states only Google
Cloud/AI Studio access can fix — no code change here helps.

**Key identity, without ever printing the key itself:** production's `GEMINI_API_KEY` is 53
characters and ends in `...vteQ`. The 402 response body does not include a project ID or name —
Google's public error format for this endpoint never discloses it. The founder needs to log into
whichever Google account owns AI Studio project(s) at https://ai.studio/projects and match by the
API key whose last 4 characters are `vteQ`, then add prepaid billing credit there. **Do not
switch production to a free-tier key** (per founder instruction tonight, and because ADR-007
explicitly requires a paid, no-training tier for any Class B agency data).

### 2. Ollama fallback: NOT down, but too slow to make the 8s first-token deadline for ordinary chat

Diagnosed live tonight, with production's real `railtail` (Railway↔Tailscale sidecar) logs and
`jennysol-api`'s own router/keep-warm logs — **ruled out** "Tailscale down," "Ollama not running,"
and "Mac asleep" as the cause:

- `railtail` logs show `railtail` continuously and successfully forwarding TCP connections from
  Railway to the Mac's real tailnet IP (`100.70.199.75:11434`) throughout the incident window —
  dozens of successful forwards, only 2 `broken pipe` errors in ~17 minutes (those are the
  *caller* giving up first, not a connection failure).
- `keepWarm.ts`'s own background ping (every 4 min, no timeout enforced) succeeded on every single
  attempt across the incident window, with `totalMs` ranging **4,863ms–20,393ms** for a trivial
  `"hi"` completion on `qwen3:8b`.
- Real chat requests in the same window show the actual failure mode:
  `ollama timed out waiting for an answer token (8000ms)` — repeated many times — with two
  successes landing at `firstTokenMs=7807` and `firstTokenMs=7927`, i.e. right at the edge of the
  timeout, not comfortably under it.

**Root cause: a real latency regression, not an outage.** `modelRouter.ts`'s own comment
(`firstTokenTimeoutMs`) records that this 8,000ms non-reasoning local budget was tuned on
2026-09-15 against a measured 3.15–3.82s worst case. Tonight's real numbers (5–20s) are 2–5×
worse than that measurement, on the same code path. Ollama is answering every request; it is
simply running slower right now than when the timeout was set, or the Tailscale relay hop is
slower right now than it was. Nothing in `LLM_LOCAL_FIRST_TOKEN_TIMEOUT_MS`, the 8s local
non-reasoning deadline, or the 60s reasoning deadline was changed tonight, per instruction ("keep
the 30s/60s deadlines").

**What the founder needs to check on the Mac tonight** (no SSH access exists into either the
Railway container or the Mac from this session, so this can't be verified further remotely):

1. Run `tailscale status` on the Mac — confirm the peer connection to Railway's `railtail` service
   shows as **direct**, not `relay` (DERP). A relayed connection alone can add multiple extra
   seconds versus a direct one; if it shows `relay`, try `tailscale up` again, or a `tailscaled`
   restart, to attempt re-establishing a direct path.
2. Open Activity Monitor and check for anything competing with Ollama for CPU/GPU right now (a
   browser doing heavy work, a video call, a build/compile job, thermal throttling on battery) —
   the whole 8s budget is spent if the Mac isn't free to respond immediately.
3. Confirm the Mac isn't sleeping and won't sleep mid-session (plug in, disable auto-sleep, or
   `caffeinate`) as a safety margin — current data doesn't show full sleep (a fully asleep Mac
   would fail every connection, not just run slow), but it's worth locking down given how load-bearing
   this fallback is tonight.
4. Optionally confirm via `ollama ps` locally that `qwen3:8b` stays resident and isn't being
   reloaded between requests (a repeated cold-load would show up as exactly this kind of
   inconsistent multi-second latency).

Until either (1) Gemini's billing is restored or (2) the Ollama round-trip comes back under ~8s
reliably, real user-facing chat requests will continue to fail intermittently — confirmed by
hitting the live production gateway (`/api/agent/gateway/chat`) directly tonight and getting a
real `502 {"error":"All configured AI providers are currently unavailable"}`.

### Scorecard eval status

The live 10-case eval against `docs/evals/agency-scorecard-eval-set.md` (via
`server/scripts/eval-agency-scorecard-adr007.ts`) **could not be completed with real numbers**
tonight because of incident #1 above — every CONTROLLED_CLOUD call the eval needs goes to Gemini
specifically (Ollama is never a permitted CONTROLLED_CLOUD processor under ADR-007; PRIVATE-tier
fallback would defeat the point of the eval). Marked **blocked-pending-credits** in
`docs/JENNYSOL-EVAL-RESULTS.md` rather than fabricated. All 827 unit/integration tests pass on
mocks, and the code itself (redaction, tenant isolation, guardrail escalation, audit schema) is
independently verified — see `docs/reviews/d27386b.md`'s response section for the full evidence.
