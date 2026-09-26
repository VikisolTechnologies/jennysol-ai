# Blockers

Format: date, what's blocked, why, the option taken, and what it would take to unblock properly.

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

## 2026-09-26 — real robustness gap found while measuring provider order (STEP 2 of JENNYSOL-NEXT.md)

The router's first-token timeout is satisfied by *any* provider activity, including a local
"thinking" model's trace tokens — a deliberate design for telling cold-vs-hung apart, not for
capping total response time. Real measurement (`docs/JENNYSOL-PROVIDER-ORDER-MEASUREMENT.md`)
found this lets a single request run for **over two minutes** (once needing a manual kill) while
technically staying "alive" the whole time. Needs: an overall wall-clock cap on a single attempt,
independent of the first-token/activity check, so a genuinely runaway local generation is aborted
rather than left running indefinitely. Not fixed this session — a real design decision (how long
is too long, and what does the user see while it's happening) that deserves its own look rather
than a quick patch.

**Finding #3 — investigated and closed, not just left open:** checked every provider that
implements tool-calling at all (`gemini.ts`, `anthropic.ts` — `deepseek.ts` and `ollama.ts` don't
implement `onToolCall` currently, confirmed by grep). Both call `onToolCall` inside a plain
`for (const call of calls) { output = await onToolCall(...) }` / `for (const use of toolUses)`
loop — strictly sequential, never `Promise.all` or otherwise concurrent. The step-budget check's
lack of a lock is therefore not reachable today. Re-open this if a future provider (or a change to
an existing one) ever parallelizes tool-call dispatch.
