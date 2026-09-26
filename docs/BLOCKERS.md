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
