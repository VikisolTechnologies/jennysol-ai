# Claude Code Mission J1 — Arena ↔ Jenny v2 contracts (read-only first)

**Issued by:** the architect (Claude), 27 Sep 2026. Read `docs/ARENA-VNEXT-MOBILE-JENNY-BLUEPRINT.md` (§4–§5) first.
**Contract status:** every v2 item is listed as **PROPOSED, NOT BUILT** in `docs/JENNY-ARENA-CONTRACT.md` §6.1. When you build one, change it to **BUILT (SHA)** there. Never change the v1 endpoints or bodies.
**Note:** the handoff file `CLAUDE_ARENA_JENNYSOL_MOBILE_HANDOFF.md` was addressed to the architect, who has done Gate 0. Don't produce a second architecture; implement this mission.

**Branch:** `feature/arena-jenny-agent-gateway` from `main` @ `ca5ec1c`. Never implement on `main`.
**Gemini is down (402, prepaid credit):** build and test with mocked providers and fixtures. Live-model evals are marked blocked, never faked.
**You own:** `jennysol-ai` only. Never edit the Arena repos; propose Arena-side needs in `docs/JENNY-ARENA-CONTRACT.md` §6.

1. **Contract spec:** `docs/contracts/ARENA-JENNY-V2.md`, plus JSON Schemas under `server/src/contracts/v2/`, for:
   - `ContextualBrief`, `InterpretedIntent`, `StructuredDraft`, `ExplainedRecommendation`;
   - `ProposedAction`, `ActionResult`, `AutomationRecipe`, `QueueItem`, `OutcomeEvent`, `AuditEntry`.

   Each carries `schemaVersion`, `requestId`, `generatedAt`; every write carries an `idempotencyKey`. **No numeric match score.** Add examples.
2. **Dev fixtures:** `server/src/contracts/v2/fixtures/*.json`. Fictional names only. Every fixture is marked `"fixture": true`, so the Arena UI can show a visible DEV label. Cursor uses these for Gate 2.
3. **Read-only endpoints behind flag `GATEWAY_V2_ENABLED` (default off):**
   - `POST /api/agent/gateway/v2/brief`
   - `POST /api/agent/gateway/v2/interpret`
   - `POST /api/agent/gateway/v2/explain`

   Requirements:
   - same service-token auth and scope checks as v1;
   - model output **validated against the schema** (one repair retry, then an honest error);
   - timeouts and cancellation; PUBLIC_CLOUD tier for Arena traffic (ADR-007);
   - Arena data only through the existing Arena read tools, with the user's scope;
   - an **empty brief is a valid answer**.
4. **Write proposals:** extend the existing `pendingActions` so the proposal returns `ProposedAction` metadata (payloadPreview, audience, dataShared, reversible=false unless truly undoable, expiresAt), and add `idempotencyKey` handling to `/actions/:actionId` (a duplicate returns `status: duplicate`, never re-executes). **v1 behaviour and the live contract tests must stay green.**
5. **Tests:**
   - schema validation, auth/scope and cross-user denial;
   - timeout → honest error;
   - duplicate approval → no second execution;
   - expired → `expired`;
   - no protected-attribute filters accepted in `interpret`.

   Live-model evals are **blocked until Gemini credit is restored**. Mark them blocked; don't fake them.
6. **Deploy with the flag OFF.** Confirm `/health`, re-run the v1 gateway contract checks against production, update `docs/PROGRESS.md`, and mark the delivered items BUILT (SHA, flag off) in `docs/JENNY-ARENA-CONTRACT.md` §6.1, and stop for architect review.
