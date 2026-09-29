# Arena VNext Mobile + Jenny Active Layer — Blueprint (Gate 0)

**Architect:** Claude · Gate 0 completed 27 Sep 2026, 01:00 IST
**Authority:** third, after `VIKISOL-MASTER-CONTEXT.md` and `ARENA-MISSION.md` (see `CLAUDE.md`).

**Sources:**
- the founder/Codex handoff (kept in the Claude Project; not an active instruction file);
- the 3 approved concept boards on the founder's Mac, inspected by the architect: `~/.codex/generated_images/01a0d9c7-…/exec-f4234256….png` (Concept A), `exec-cfca4870….png` (Jenny layer), `exec-41d6d6db….png` (automation);
- the live code;
- `docs/reviews/AUDIT-2026-09-26.md`.

The earlier `docs/ARENA-VNEXT-BLUEPRINT.md` exists **only on `feature/arena-vnext`**. This document replaces its visual and navigation parts. Its product answers (Sessions = extended ACTIVITY, honest Pulse, v1 scope) still stand.

## 1. Decisions
1. **Navigation.**
   - Mobile bottom bar: **Feed · Discover · (+) · Work · You**.
   - **Map is a List/Map mode inside Discover** (same chips: People / Activities / Needs / Projects). `/map` redirects to Discover's map mode.
   - **Jenny is contextual**, in Feed (brief), Discover (intent → filters), Create (draft), Work (approval queue) and You (plan, automations, reminders, history). A full Jenny detail/history route may exist, but **Jenny is never a primary bottom tab or an always-on chat bubble.**
   - **Inbox/rooms** stays reachable from the signed-in header (icon + unread badge) and the account surface. Guests see **Sign in** in the header.
2. **No match percentages.** Show evidence counts and "Why this?". Remove the existing % displays (the landing LIVE BID, marketplace bids).
3. **Honest AI status.** Show "Jenny available" only when the gateway health check passes. Otherwise show "Jenny is unavailable right now"; **Arena stays fully usable.**
4. **Undo** is shown only for actions the backend can really undo (none today).
5. **No real brand names or logos** unless the company really posted. Fixtures use fictional names.
6. **Fix the concept-board copy errors** during the build.
7. **One progressive identity.** Career mode is a private toggle on the same profile (reuse the job-intent fields). Per-field career visibility is **proposed, not built** (§4).
8. **Demo labelling uses the existing field `demoContent`** (Arena BE `PostResponse`, FE types and cards, JennySol connector, contract doc).
   - If `GET /feed` items don't carry it, the backend adds **`demoContent`** to `FeedItemResponse`.
   - **Never introduce `isDemo`.**
   - Every demo item shows the DEMO badge on every surface.

## 2. Reuse map
| Need | Reuse | Extend | New (FE) |
|---|---|---|---|
| Shell / nav | `src/components/vnext/Shell.tsx`, tokens | Mobile-first 320–430, centre +, safe areas, one shell for all talent routes | — |
| Feed | `FeedScreen`, `GET /feed` | Rich card; `demoContent` in the feed DTO | `JennyBrief` (fixtures until v2 is built) |
| Discover / Map | `DiscoverScreen`, `MapScreen`, `GET /search`, `GET /posts/nearby` | One Discover with List/Map; directory of People / Companies / Projects; default centre on the launch zone | `IntentInterpreter` |
| Create | `CreateSheet`, `POST /posts` (activity/ask/update/offer), projects | Draft + missing fields | `JennyDraftCard` |
| Work | `WorkScreen`, `/posts/joined`, applications, `my-bids`, interviews | Needs your approval / Jenny can handle / In progress / Waiting / Upcoming / Completed | `ActionQueue` |
| Approvals | Live `pendingActions` + Arena `POST /agent/actions/{id}` | Preview of payload, audience and data used | `ApprovalSheet` |
| Jenny thread | Arena `AgentController` → JennySol `/api/agent/gateway/chat` | — | `JennyHome`, `JennyHistory`, `AutomationRecipe`, `OutcomeTimeline` |

**Remove only once safely replaced:**
- the old shell/nav on `/feed/[id]`, `/discuss`, `/companies` and `/auth`;
- duplicate cards (`feed/PostCard`, `FeedItemCard`, `home-v3/FeedCards`);
- `/map` as a tab;
- the match-% UI.

## 3. Security boundary
`Arena mobile UI → Arena BE (BFF: auth, authorization, per-request scoped service token for the current user) → JennySol Agent Gateway → approved Arena tool endpoints → Arena DB`
- The frontend never calls JennySol and never receives raw model output.
- **READ:** within the granted scope.
- **WRITE:** propose → preview → approve → execute once → authoritative result → audit.
- No protected-attribute targeting. Approximate location only. Failures stay failures. No fabricated activity.

## 4. Jenny contract: LIVE vs PROPOSED
| Item | Status |
|---|---|
| `POST /api/agent/gateway/chat`, `POST /api/agent/gateway/actions/:actionId` | **LIVE** |
| Per-request scoped service tokens; Arena BFF `AgentController` (`/agent/conversation`, `/conversations/{id}/messages`, `/actions/{id}`) | **LIVE** |
| 9 Arena tools: search, nearbyActivities, listCommunities, searchJobs (read); createPost, createProject, joinActivity, placeBid, applyToJob (write) | **LIVE** |
| propose → approve → execute; 5-minute pending-action expiry; single-use approval | **LIVE** |
| `ContextualBrief`, `InterpretedIntent`, `StructuredDraft`, `ExplainedRecommendation` | **PROPOSED, NOT BUILT** |
| Expanded `ProposedAction` preview (payloadPreview, audience, dataShared, reversible) | **PROPOSED, NOT BUILT** |
| `AutomationRecipe`, `QueueItem`, `OutcomeEvent`, `AuditEntry` | **PROPOSED, NOT BUILT** |
| `schemaVersion` / `requestId` / `generatedAt` envelope; client-supplied `idempotencyKey` | **PROPOSED, NOT BUILT** |
| Per-field career visibility | **PROPOSED, NOT BUILT** (Arena BE) |

**Migration:**
- v2 is **additive and versioned** under `/api/agent/gateway/v2/*`, behind a flag, default off.
- v1 endpoints and bodies are unchanged and stay covered by the existing contract tests.
- A v2 field is relied on by Cursor only after JennySol marks it **BUILT** in `jennysol-ai/docs/JENNY-ARENA-CONTRACT.md` §6.
- Until then, Cursor builds against the **dev fixtures only**, labelled DEV.

## 5. Automation safety
Recipes automate **monitoring, drafting, organizing and reminding** only. They **never** automatically:
- apply for a job;
- publish a post;
- send a message;
- invite users;
- change profile visibility;
- share candidate information;
- reveal exact location;
- schedule external meetings.

Every consequential action stays approval-bound. Every recipe can be paused, edited, revoked and inspected.

## 6. Gemini outage: what is blocked
Production Gemini returns **402 (prepaid credit depleted)** on key `…vteQ`. That's a FOUNDER action.

**Continues without credit:**
- the mobile shell;
- typed UI components;
- schemas;
- deterministic dev fixtures;
- contract tests;
- mocked-provider tests;
- Jenny-unavailable states;
- timeout and error handling;
- feature flags;
- backend authorization tests.

**Blocked until a paid key works:**
- live Gemini end-to-end validation;
- real contextual generation;
- the real Agency scorecard eval;
- provider latency and cost validation;
- enabling any new AI capability in production.

## 7. Branches and deployment
- **One owner per repo; feature branches only; never implement on `main`.**
- **P0 audit fixes:**
  - branch `fix/p0-security-honesty` in Arena FE and BE (carry the current uncommitted P0 work over with `git switch -c`);
  - tests plus an architect review, then merge;
  - they follow their own release path.
- **M1…M8:**
  - branch `feature/arena-vnext-mobile-jenny`, created from `origin/feature/arena-vnext` @ **`f310ee6`**;
  - deployed only to the **existing protected preview** `preview-arena.vikisol.in`.
- **Never:**
  - merge PR #1;
  - deploy VNext to production;
  - change DNS;
  - create a second hosting project.
- **Production promotion requires all of:**
  - green required checks;
  - architect review;
  - founder visual approval;
  - a verified commit stamp;
  - a mobile smoke test.

## 8. Missions
| Mission | Owner | Content |
|---|---|---|
| P0 | Cursor | Audit P0-1 (credentials, SEED off, admin 2FA, role chips) and P0-2 (honest counts, fictional seed companies, DEMO badges using `demoContent`) |
| M1 | Cursor | Mobile shell, tokens, nav, rich Feed card, lint green (`docs/missions/CURSOR-M1.md`) |
| J1 | Claude Code | v2 contract, schemas, dev fixtures; read-only v2 endpoints behind a flag (`jennysol-ai/docs/missions/CLAUDE-CODE-J1.md`) |
| M2–M8 | Cursor (+ BE only for verified gaps) | Discover + map mode · Create draft · Why-this · Work queue + ApprovalSheet (live pendingActions) · Jenny home/recipes/history · career toggle + tracker · integration, a11y, performance, cleanup |

Each mission stops for architect review before the next one is issued.
