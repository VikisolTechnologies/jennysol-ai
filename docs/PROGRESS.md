# JennySol mission — progress log

Any agent resuming this should read this file top-to-bottom, then the latest entry, before doing anything. Do not restart from Step 0 if this file shows later steps in progress.

---

## 2026-09-26 — STEP 0 done, starting STEP 1

**Branch:** `feature/jenny-audit`
**Phase:** STEP 0 complete. Starting STEP 1 (contract tests + `JENNY-ARENA-CONTRACT.md`).

**Done:**
- Corrected mission docs committed: `docs/JENNYSOL-MISSION-2.md`, `docs/JENNYSOL-MISSION-ADDENDUM.md`, `docs/JENNYSOL-FINISH-ALL.md`, `docs/VIKISOL-MASTER-CONTEXT.md`.
- Key correction folded in: the Arena↔Jenny gateway (`routes/agentGateway.ts`, `productConnectors/arena.ts`) is **already live in production**, not a Phase-6 deliverable to build. Verified end to end against `api-arena.vikisol.in` on 2026-09-26 (see prior session's live-check transcript — a real activity was found, proposed, approved, and the room opened).
- Baseline verified before starting: `npx vitest run` → 682 passed, 2 skipped, 69 files. `npx tsc --noEmit -p .` clean (server + client). Tip `33abb27`, fully pushed to `main`.

**Next:** STEP 1 — write/extend contract tests for the live gateway (propose→approve→execute, single-use, 5-min expiry, scope checks, forged/expired/reused rejection), rate the 5 write tools (High: `placeBid`, `applyToJob`; Medium: `createPost`, `createProject`), and write `docs/JENNY-ARENA-CONTRACT.md` for Cursor.

**Open questions for the founder:** none yet — nothing has been blocking so far. Anything that blocks goes to `docs/BLOCKERS.md`, not here.

**Note to Cursor:** I am not touching any Arena repo. If you need something from JennySol's side (a new gateway field, a new tool, a contract change), it goes in `docs/JENNY-ARENA-CONTRACT.md` as a proposal — I'll pick it up from there, not from your repo.

---

## 2026-09-26 — STEP 1 done, starting STEP 2

**Branch:** `feature/jenny-audit` (same branch — STEP 1 is small and additive; will still be committed separately from STEP 0).

**Done:**
- Added a `risk: "low" | "medium" | "high" | "critical"` field to every `RegisteredTool` (`services/tools/productConnector.ts`), rated all 9 Arena tools, and made `ToolRegistry.registerConnector` refuse to register any WRITE tool rated "low" or unrated — a structural guard against a future tool silently under-rating itself.
- Added 2 new HTTP-layer contract tests to `agentGateway.http.test.ts`:
  - a forged (wrong-secret, well-formed) Arena JWT is rejected through the real route, not just at the `serviceToken.ts` unit level;
  - the 5-minute pending-action TTL is enforced through the real `/actions/:actionId` route (previously only unit-tested in `pendingActions.test.ts`), including that it reports `code: "expired"` and never dispatches.
- Added 1 new test to `productConnectors/arena.test.ts` locking every tool's risk rating against the published contract table (a tool that's missing or wrongly rated fails this test, not just a later audit).
- Fixed 3 existing test fixtures (`toolRegistry.test.ts` ×2 READ tools + 1 intentionally-bad fixture, `agentGateway.memoryIsolation.test.ts`'s `acme.deleteEverything` → rated `critical`) that needed the new field to keep passing under the stricter registration check.
- Wrote `docs/JENNY-ARENA-CONTRACT.md`: the full contract (endpoints, request/response shapes, the identity/authorization model, the 9-tool risk table, what Cursor must never break, which tests guard it, and an open "proposed additions" section for Cursor to write into).
- Full suite: **687 tests (685 passed, 2 skipped), 69 files, clean tsc** — up from the 684/2 baseline (+2 new contract tests, +1 risk-table test).

**Next:** STEP 2 — finish `docs/CURRENT-STATE-AUDIT.md` (Codex's audit, already substantial): the 20-prompt routing table with cold/warm latency, an active attempt to break cross-user isolation, a cost pass, dead-code sweep, and the gap against the master plan's v1 DoD.

**Note to Cursor:** `docs/JENNY-ARENA-CONTRACT.md` is now the reference for anything you need from JennySol's side. Section 6 is where to write a proposal if something's missing — I'll pick it up from there.

---

## 2026-09-26 — STEP 2 done, starting STEP 3

**Branch:** `feature/jenny-audit` (docs-only step, no code changes).

**Done:** wrote `docs/JENNYSOL-CURRENT-STATE.md`. Key findings, all verified rather than assumed:
- **Codex's 8 earlier findings (`CURRENT-STATE-AUDIT.md`) are 7/8 already fixed** — only #8 (privacy/scale/identity architecture) is still genuinely open, and that's the same gap the DoD table already tracks.
- **Cold-start mitigation is more built than the mission draft assumed:** `keepWarm.ts` (pings the "general" model every 4 min), `shadowTraffic.ts` (5% shadow sampling to Ollama), and a hedging race in `modelRouter.ts` all already exist and are wired into `index.ts` — but hedging is **off by default** in production (`LLM_HEDGE_ENABLED` unset), and only one of the four local models is proactively kept warm.
- **Real measured latency** (not fabricated): local models cold 5.5–14s, warm 192ms–6s (qwen3:4b/8b's warm latency is surprisingly still 5-6s — a real, previously-undocumented finding, likely their default "thinking" preamble). Gemini 2.9–10.6s first-token, already observed live this session.
- **Two separate classifiers exist and are easy to conflate:** JennySol's own chat uses `classifyTask()`/`modelRegistry.ts`; the Arena gateway uses a completely different `classifyDifficulty()`/`modelTiers.ts` for Claude tiering (dormant today, no Anthropic key).
- Active isolation-break attempt (re-running M8's suite live + manually tracing `ToolRegistry`/`consumeAction`): **no break found.**
- Dead code: none found beyond what's already documented as deliberately kept.
- DoD gap table: the model-routing and Arena-integration halves of "v1 core" are substantially done; the real remaining work is the agent-runtime state machine (Goal Mode) and privacy tiers.

**Next:** STEP 3 — stabilize. Given the audit's findings, the real remaining work here is smaller than the mission assumed: turn on hedging in production behind its existing flag (already built and tested, just off), and decide whether to expand keep-warm beyond just the "general" model given the 16GB budget. Provider resilience (circuit breaker, timeouts, retries) is already built (`providerHealth.ts`, `retryClassifier.ts`) — verify it rather than rebuild it.
