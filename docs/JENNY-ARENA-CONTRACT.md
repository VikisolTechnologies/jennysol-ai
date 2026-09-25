# Jenny ↔ Arena contract

**For Cursor (Arena's own agent).** This is the contract as it exists in production today, locked down by the tests listed at the end. If you need something JennySol's side doesn't do yet, propose it as an addition here (a new section, clearly marked "proposed, not built") rather than assuming it exists or waiting on it silently — I'll pick up proposals from this file.

**This is a live, working system, not a design for one.** It was verified end to end against production on 2026-09-26: a real activity was found, proposed, approved, and the account was added to the room. Treat any change to it as an extension, never a redesign.

---

## 1. Endpoints

### `POST /api/agent/gateway/chat`
Base URL: `https://api.jennysol.vikisol.in`

**Request**
```json
{
  "message": "string, 1-4000 chars, required",
  "history": [{ "role": "user" | "assistant", "content": "string, ≤4000 chars" }],
  "context": "string, ≤2000 chars, optional — plain-text facts about the user, e.g. 'Name: Priya'"
}
```
- `history`: at most 20 prior turns, oldest first. JennySol is stateless per request — **Arena owns conversation storage**, and sends the bounded history back on every call.
- Auth: `Authorization: Bearer <service token>`, freshly minted per request (see §2). Never cache or reuse one across requests.

**Response, 200**
```json
{
  "content": "Jenny's reply text",
  "pendingActions": [
    {
      "actionId": "opaque uuid",
      "toolName": "arena.joinActivity",
      "args": { "postId": "..." },
      "expiresAt": "ISO-8601 instant, now + 5 minutes"
    }
  ]
}
```
- `pendingActions` is omitted entirely when there's nothing to approve (never sent as `[]`).
- `content` is never blank: if the model's turn produced nothing but a proposal, JennySol fills in a default line ("I've set that up — review the details below before anything happens."); if it produced neither text nor a proposal, the whole request comes back as a 502 instead of an empty reply.

**Errors**
| Status | Meaning |
|---|---|
| 400 | Malformed body (zod validation) |
| 401 | Missing/garbage/forged/expired service token |
| 502 | The model/provider chain failed, or (see above) genuinely produced nothing |

### `POST /api/agent/gateway/actions/:actionId`
**Request:** `{ "approve": true | false }`
**Auth:** the **same identity** that received the proposal — a different user, even on the same Arena account type, is rejected.

**Response**
| Case | Status | Body |
|---|---|---|
| Approved and it ran | 200 | `{ "status": "executed", "result": <tool's own return value> }` |
| Declined | 200 | `{ "status": "rejected" }` |
| Unknown / already consumed / wrong owner | 404 | `{ "error": "...", "code": "not_found" }` |
| Older than 5 minutes | 404 | `{ "error": "...", "code": "expired" }` |
| Arena/the tool **definitively refused** (activity full, job closed — nothing ran) | 422 | `{ "status": "failed", "error": "<the reason, safe to show the user>" }` |
| Ambiguous failure (timeout, 5xx, network error — may or may not have run) | 502 | `{ "error": "..." }` — **never present this as safe to retry** |

- **Single-use.** Once consumed (approved or declined), the same `actionId` can never be decided again — a second POST gets 404 `not_found`, not a re-execution.
- **5-minute TTL**, measured from when Jenny proposed it, not from when Arena stores it.

---

## 2. Identity and authorization
- Arena mints a short-lived **HS256 JWT** with `SERVICE_TOKEN_SECRET_ARENA` (the same secret on both sides — never rotate one side without the other), claiming `iss: "arena"`, `aud: "jennysol"`, `sub: <Arena user id>`, `role`, and `scope: [<tool names this user may call>]`.
- **Mint one fresh per request.** JennySol never trusts anything about *authorization* beyond what's in that token's `scope` — it independently re-checks scope again before dispatching a tool, and (on the way back) Arena's own `AgentServiceTokenAuthenticationFilter` **independently re-checks the token's scope against the specific endpoint being called**. Neither side ever trusts the other's word alone.
- A token whose `scope` doesn't include a tool name means that tool is invisible to the model for this request — not merely blocked after the fact.

---

## 3. Tools and their risk rating

| Tool | Tier | Risk | What it does |
|---|---|---|---|
| `arena.search` | READ | low | Keyword search across activities, discussions, jobs, projects, companies |
| `arena.nearbyActivities` | READ | low | Activities near a point, soonest first |
| `arena.listCommunities` | READ | low | Discuss communities, most joined first |
| `arena.searchJobs` | READ | low | Open jobs, newest first |
| `arena.createPost` | WRITE | medium | Posts an activity/ask/update |
| `arena.createProject` | WRITE | medium | Posts a paid project for bids |
| `arena.joinActivity` | WRITE | medium | Requests to join (or joins, if public) an activity |
| `arena.placeBid` | WRITE | **high** | Places a real rupee bid on a project |
| `arena.applyToJob` | WRITE | **high** | Applies to a job posting |

- **Every WRITE tool requires the user's explicit tap to run, regardless of risk level** — risk is metadata for audit and future policy, not today's gate (that's uniform: propose → approve → execute for all five). `high` exists to mark the two tools with real money/employment consequences as the ones to scrutinize first in review, and JennySol's tool registry now refuses to register any WRITE tool rated "low" or unrated, as a structural check.
- Demo/seed content Arena returns is passed through with `demoContent: true`; Jenny is instructed to label it as an example and never suggest joining or applying to it as if it were real.

---

## 4. What Cursor must never break
Guarded by the tests in §5 — a change to Arena that breaks any of these will show up there before it reaches production:
1. `POST /posts/*/joins`, `POST /posts`, `POST /marketplace/projects`, `POST /marketplace/projects/*/bids`, `POST /applications` must keep accepting a request bearing this same service token shape, with the same scope-to-endpoint mapping in `AgentServiceTokenAuthenticationFilter`.
2. A definitive refusal (4xx from Arena, e.g. "activity is full") must stay a clean 4xx with a human-readable `message` field — that's what becomes the 422 "failed" reason shown to the user. Don't turn it into a 200 with an error flag buried in the body.
3. Join safety must stay enforced Arena-side at the moment of approval, not just at the moment of request (capacity, open status, start time, blocks, 18+, verification level) — Jenny's approval call is a second real request into your API, not a replay of the first check.

## 5. Tests that lock this contract
- `server/src/agentGateway.http.test.ts` — the full HTTP-layer contract: auth (missing/garbage/forged/expired), propose-never-executes, approve-executes-once, decline-discards, cross-identity rejection, 5-minute TTL, definitive-failure (422) vs ambiguous (502), never-blank-reply.
- `server/src/services/productConnectors/arena.test.ts` — each tool's request shape against Arena's real endpoints, and the risk-rating table above.
- `server/src/services/tools/pendingActions.test.ts` — the approval store itself (ownership, expiry, single-use), independent of HTTP.
- On Arena's side (not this repo, but exercising the same contract): `AgentApprovalFlowTest`, `AgentGatewayContractTest`, `PostJoinSafetyTest`, `AgentScopeMappingTest`.

## 6. Proposed additions (not built yet)
*(none from this run — add here if a future step needs something new from Arena)*
