# JennySol mission — final report (STEP 9)

Written 2026-09-26, end of the `JENNYSOL-FINISH-ALL.md` run. Branch `feature/jenny-audit`, 7
commits (`c88cc25`…`f13b841`), **nothing here merged to `main` or deployed** — see §1 and §8.

---

## 1. What's live in production right now

**Unchanged by this run.** Everything below predates STEP 0 and is unaffected:

| Service | Version | Confirmed |
|---|---|---|
| JennySol API (`api.jennysol.vikisol.in`) | `33abb27` | `/health` checked live this morning |
| Arena API (`api-arena.vikisol.in`) | `b3370f4` | Flyway V17/V18 applied, healthy |
| Arena web (`arena.vikisol.in`) | `82bb8b8` | live |

**Flags:** `ANTHROPIC_API_KEY` and `DEEPSEEK_API_KEY` are **not set** in production — per Hard
Limit #6, this run never enabled either. `LLM_HEDGE_ENABLED` and the new
`OLLAMA_KEEP_WARM_CAPABILITIES` are both **off/unset** in production (STEP 3's own decision).

**This run's own 7 commits are on `feature/jenny-audit`, not merged, not deployed.** Per this
run's own release rule (production only after eval gates pass) and §6's honest eval results
(a partial eval pass, not a full one), that's the correct state to leave things in — merging and
deploying is a decision for the founder, informed by this report, not something to do
unilaterally on a partial eval pass.

## 2. Eval numbers, latency, cost, local/cloud split

See `docs/JENNYSOL-EVAL-RESULTS.md` in full. Summary:
- **3/3** real, live scenarios passed against the new Agent Runtime (real Gemini, real weather
  API, no mocks) — not the mission's full 20.
- Routing table: 20 prompts traced through real code (`classifyTask()`), 4 local models measured
  live (cold 5.5–14s, warm 192ms–6s), Gemini observed at 1.6–10.6s first-token.
- Cost: almost all real chat traffic today pays for Gemini (Ollama is last in the chain, hedging
  off); image generation is effectively not working in production (Gemini's zero-quota tier, no
  fal.ai key, local worker built but not wired in) — unchanged by this run.
- Zero safety violations across everything actually run — not a guarantee from a full suite,
  since a full suite wasn't run.

## 3. The three workflows

| # | Workflow | Status |
|---|---|---|
| (a) Arena find→propose→approve→execute | **Proven, live, in production**, 2026-09-26 |
| (b) Research question → cited report | Not attempted; the tool it needs (`jennysol.webSearch`) exists and is tested alone |
| (c) Developer → sandbox → tests → draft PR | Not attempted; needs a new sandboxed tool that doesn't exist yet |

## 4. Gateway contract status, for Cursor

`docs/JENNY-ARENA-CONTRACT.md` is the reference. **Nothing about the live contract changed this
run** — STEP 1 only added tests and risk ratings around the existing, live behavior. Cursor's
Arena work can keep depending on it exactly as documented; nothing here requires an Arena-side
change, and §6 of that doc (proposed additions) is still empty.

## 5. Preview URL and test logins

**None — STEP 8 (an actual Vercel preview deploy of the UI) wasn't reached this run.** What exists
instead: 5 static HTML mockups in `docs/design/` (chat, voice mode, memory & privacy settings, and
2 real options for the new run/approval dashboard) — open them directly in a browser, no deploy or
login needed. See §7 for the explicit approval note on these.

## 6. Blockers and access needed

- `docs/BLOCKERS.md`: 8 logged items, all genuine scope not reached in one continuous run (privacy
  tiers, full re-planning, dashboard UI, One connector, 2 of 3 workflows, the fuller eval suite,
  independent review, voice + preview deploy) — not a single one silently dropped without a note.
- `docs/ACCESS-NEEDED.md`: unchanged from STEP 0 — `JennySol_End_to_End_Execution_Plan.docx` was
  never found in this repo or attached to this session (worth asking the founder for it directly,
  since several mission docs treat it as authoritative); `DEEPSEEK_API_KEY` recommended (cheap);
  `ANTHROPIC_API_KEY`/`FAL_KEY` deliberately not requested for enabling without explicit approval.

## 7. Top 5 things to try (once this branch is reviewed and merged — nothing here is live yet)

1. **Ask Jenny to join an activity in Arena** — unchanged from what's already live, but worth
   re-confirming after any merge: propose → approve → the room opens.
2. **Export your JennySol documents**: `GET /api/documents/export` — every uploaded document's
   text, never the embedding vectors.
3. **Delete all your JennySol documents in one action**: `DELETE /api/documents`.
4. **Run the live eval yourself**: `JENNYSOL_DB_PATH=/tmp/eval.db npx tsx
   scripts/live-goal-run-eval.ts` from `server/` — watch a real goal get planned, a real tool get
   called, and a real answer come back.
5. **Look at the two dashboard mockup options** in `docs/design/` and say which one (or neither)
   you want built for real.

## 8. Approving and rolling back

**Nothing in this run is live, so there is nothing to roll back yet.** Before anything here
reaches production:

1. **Read this report and `JENNYSOL-EVAL-RESULTS.md` §6** — this run had no independent second-
   agent review. Get one (Codex, or a fresh Claude Code session with no memory of writing this)
   before merging.
2. **Decide the 2 open, real design questions this run surfaced rather than decided unilaterally:**
   - Which of the two run/approval dashboard mockups (`docs/design/run-dashboard-option-a-*.html`
     / `-option-b-*.html`), if either.
   - Privacy tier defaults per surface (Arena traffic vs JennySol's own document-touching surface)
     — `JENNYSOL-ARCHITECTURE.md` §4.
3. **Merge `feature/jenny-audit` to `main`** only once (1) and (2) are settled.
4. **Deploy JennySol** the normal way (`railway variables --set GIT_COMMIT_SHA=... && railway up`
   from `server/`), confirm `/health` matches the new commit.
5. **Flags stay off by default** — `LLM_HEDGE_ENABLED` and `OLLAMA_KEEP_WARM_CAPABILITIES` are
   both opt-in env vars; turning either on in production is a one-line Railway variable, and
   turning it back off is the same one line reverted. Nothing in this run needs a code rollback,
   only an env-var one, if either is ever turned on and needs to come back off.

---

Updating `docs/PROGRESS.md` one last time, then stopping, per this mission's own last instruction.
