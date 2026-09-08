# Jennysol Security Audit — Cross-User Chat Visibility Incident

Date of investigation: 2026-09-07
Reported by: primary user, via a family member ("my sister") seeing the user's own chats after opening Jennysol separately on the same mobile phone.

## 1. Incident summary

The user reported that their sister could see the user's own conversations after opening Jennysol on the user's mobile phone. This was treated as a CRITICAL-severity report until root-caused, per instruction: never assume the cause, trace the entire request lifecycle from browser to database and back.

## 2. Investigation method

Every layer between "browser" and "database" was read directly (not inferred) and is cited by file/function below. No destructive commands, no schema resets, no production data touched during investigation.

## 3. Findings, in request-lifecycle order

### 3.1 Authentication (`server/src/middleware/auth.ts`, `server/src/services/auth/sessions.ts`)

- IMPLEMENTED, VERIFIED: Sessions are opaque, DB-backed tokens — `randomBytes(32).toString("hex")` (256 bits of entropy), stored as the primary key of a `sessions` table (`id`, `user_id`, `expires_at`). Not a JWT — no signing key exists to be misconfigured, and revocation (`deleteSession`) is a real `DELETE`, not a blocklist.
- `requireAuth` (`middleware/auth.ts`) extracts `Authorization: Bearer <token>`, calls `getSessionUserId(token)`, and only proceeds if that resolves to a real, non-expired session row. `req.userId` is set from this and only this — never from a client-supplied body/query field.
- VERIFIED: every route mount that touches user-owned data applies `requireAuth` at the router-mount level in `server/src/index.ts` (`/api/chat`, `/api/agent/runs`, `/api/conversations`, `/api/documents`, `/api/image`, `/api/speech`); `admin.ts` applies `requireAuth, requireAdmin` internally.
- No hardcoded default/demo user or token exists anywhere in the codebase (grepped for `default.?user`, `demo.?user`, `hardcoded`, `test.?user.?id` — zero matches outside test files).

### 3.2 Guest accounts (`server/src/routes/auth.ts`, `server/src/services/auth/userStore.ts`)

- IMPLEMENTED, VERIFIED: `POST /api/auth/guest` calls `createGuestUser()`, which **always** inserts a brand-new `users` row with a fresh `randomUUID()`, a unique synthetic email (`guest-<uuid>@guest.jennysol.local`), and a unique random password hash — confirmed by reading the function body directly. There is no caching, no IP-keyed reuse, no "return the last guest" fallback. Every call creates a genuinely distinct account.
- `createSession(user.id, ...)` then issues a brand-new random token for that new user. Two different calls to `/api/auth/guest` can never return the same user id or the same token.

### 3.3 Conversation / message ownership (`server/src/services/conversationStore.ts`, `server/src/routes/conversations.ts`)

Every conversation and message query is scoped by `user_id` at the SQL level, not filtered after the fact in application code:

```sql
-- listConversations
SELECT id, title, updated_at FROM conversations WHERE user_id = ?

-- conversationExists (used before any read/write)
SELECT 1 FROM conversations WHERE id = ? AND user_id = ?

-- getConversationMessages
SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
WHERE m.conversation_id = ? AND c.user_id = ?

-- deleteConversation
DELETE FROM conversations WHERE id = ? AND user_id = ?
```

`GET /api/conversations/:id` (the route in question) calls `conversationExists(req.userId!, req.params.id)` and returns 404 if it doesn't match — it never trusts the conversation id alone. VERIFIED by direct code read and by the new automated test suite (Section 6).

### 3.4 AgentRun ownership (`server/src/services/agentRunStore.ts`, `server/src/routes/agentRuns.ts`, `server/src/services/chatRunner.ts`)

- Every `agent_runs` query is scoped by `(id, user_id)` — `getRun`, `markSeen` — or by `user_id` alone — `listActiveOrUnseenRuns`, `getActiveRunForConversation`.
- Critically: `chatRunner.ts`'s `startChatRun()` checks `conversationExists(params.userId, params.conversationId)` *before* using a client-supplied `conversationId`. If it belongs to someone else (or doesn't exist), the code does **not** error or attach to it — it silently starts a **new** conversation instead. A malicious/confused client sending someone else's conversation id can never write into it, and the response doesn't reveal whether that id belonged to another user or simply didn't exist (satisfies "return an appropriate response without leaking whether another user's resource exists" without an explicit 403 path being necessary for this particular flow — the fallback-to-new-conversation behavior already achieves it).

### 3.5 Memory / document RAG (`server/src/services/vectorStore.ts`, `server/src/routes/documents.ts`)

- `insertDocument`, `listDocuments`, `deleteDocument`, `documentBelongsToUser` are all scoped by `user_id`.
- `searchSimilarChunks(userId, ...)` joins `chunks` to `documents` and filters `WHERE d.user_id = ?` **before** scoring/ranking — a user's semantic search can only ever rank against their own uploaded chunks. There is no cross-tenant vector index; SQLite + brute-force cosine similarity per user, scoped by the join.

### 3.5a Conversation summaries hardening (added 2026-09-08, `server/src/services/conversationStore.ts`)

`conversation_summaries` (the rolling compression cache `contextManager.ts` uses to bound how much raw history is resent per turn — see Section 3.7) was previously keyed only by `conversation_id`, not `user_id`. This was **not exploitable in practice**: every real call path reaches it only after `conversationExists(userId, conversationId)` has already validated ownership upstream, and `conversation_id` is an unguessable UUID — but it meant this one table relied on caller discipline rather than being self-defending the way every other user-scoped table in this app is.

Hardened as defense-in-depth: `conversation_summaries` now has a `user_id` column, and both `getConversationSummary`/`saveConversationSummary` require and filter on it — `SELECT ... WHERE conversation_id = ? AND user_id = ?`. Additive migration (`addColumnIfMissing`, the same idiom already used for `documents`/`conversations`), non-destructive: pre-migration rows get `user_id = NULL` and simply stop matching, which just means that one conversation's summary regenerates on its next turn rather than leaking or erroring. VERIFIED by `server/src/services/conversationStore.test.ts` (real SQLite, asserts a summary is invisible when looked up with the wrong `user_id` even given the correct `conversation_id`).

### 3.6 Image / speech generation (`server/src/routes/image.ts`, `server/src/routes/speech.ts`)

- Stateless — nothing is persisted per-user, so there is no cross-user storage to leak from. Both routes require `requireAuth` at the mount level (Section 3.1), meaning an authenticated session is needed to invoke them, but generation itself doesn't read or write anything scoped to `req.userId`.

### 3.7 Caching / shared state

- No caching layer exists anywhere in the codebase — no Redis, no in-memory response cache, no CDN caching of API responses. Vercel serves only the static frontend build (`jennysol.vikisol.in`); every API call goes directly, cross-origin, to Railway (`api.jennysol.vikisol.in`) — Vercel never proxies or caches API responses, so "Vercel cache returning another user's response" is not architecturally possible in this deployment.
- The only in-memory, cross-request shared state in the whole backend is `providerHealth.ts`'s circuit-breaker stats (keyed by *provider name*, e.g. `"gemini"`, never by user) and `runBus.ts`'s per-runId event-subscriber map (keyed by `runId`, a random UUID scoped to one run/one user). Neither is keyed in a way that could conflate two users.
- SQLite is a single file on a single Railway instance, shared by every user of the app — this is a **scaling** limitation (documented in the architecture handoff), not a **data-isolation** one: every query is still scoped by `user_id`/ownership joins regardless of how many users share the file.

### 3.8 Client-side session storage (`client/src/lib/auth.ts`, `client/src/lib/AuthContext.tsx`)

**This is where the actual root cause was found.**

- The session token is stored under a single fixed key, `jennysol-auth-token`, in `localStorage`. `localStorage` is scoped to the browser **origin + profile**, not to a person — it is shared by anyone who opens that same browser app on that same device, indefinitely, until something explicitly clears it.
- `AuthContext.tsx`'s boot effect (`useEffect`, runs once per page load) calls `fetchMe()` first. If a token is already present in `localStorage` and it resolves to a valid session, that user is used — **there is no prompt, no "is this you?" check, nothing that distinguishes the physical person now holding the device from whoever last used that browser.**
- **The concrete gap**: for a full (signed-up) account, there was already an escape hatch — a visible "Log out" button (`Sidebar.tsx`) that deletes the session and clears the token, after which the next person sees the login screen and can create/use their own account. **For a guest account, no such control existed.** The code comment removed in this fix read verbatim: *"Guests have no real credentials to log back in with, so there's no logout button here — logging out a guest would just orphan their chat history with no way back in."* That tradeoff prioritized not losing an anonymous guest's history over giving a second person on the same device any way to leave that guest's session.

## 4. Root cause

**Not a backend authorization bypass.** Every conversation, message, AgentRun, and document/RAG query in the backend is correctly scoped to the authenticated `user_id`, verified above by direct code reading and by a new automated test suite (Section 6) — no missing `WHERE user_id = ?` clause was found anywhere in the codebase.

**The actual mechanism**: the reported phone is a shared device. The user opened Jennysol first, which (per the no-login-wall guest design) silently created a guest session and stored its token in the phone browser's `localStorage`. When the sister opened Jennysol "separately" on the same phone/browser, the app's boot sequence found that same token already present, treated it as a returning session (correctly, from the server's point of view — it *is* a valid, unexpired token), and the sister was transparently continuing the user's own guest session. Guest mode had no button, link, or prompt of any kind to end that session and start a distinct one. Every subsequent request from the sister's screen legitimately carried the user's own `user_id` — the backend's ownership checks worked exactly as designed, on the wrong assumption about who the request was from.

## 5. Fix implemented

Client-side only; **no backend code changed** (the backend was already correct).

1. **`client/src/lib/AuthContext.tsx`** — added `startNewGuestSession()`: calls the existing `logout()` (deletes the current session server-side via `POST /api/auth/logout`, clears the local token — a pre-existing, already-correct mechanism that was simply never exposed for guests), clears the locally-persisted `jennysol-active-conversation` id, then does a full `window.location.reload()`. The reload re-runs the boot effect with no token present, which creates a brand-new, genuinely distinct guest account via the same `guestLogin()` path a first-time visitor takes — no new backend logic needed, this is 100% composition of existing, already-tested primitives.
2. **`client/src/components/Sidebar.tsx`** — added a low-emphasis "Not you? Start a new session" control under the existing guest banner, gated by a native `confirm()` warning that the current guest's chat history becomes unreachable unless they've already signed up. Deliberately not a custom modal — this is a rare, high-stakes action, not a place to add polish.
3. **`client/src/lib/storageKeys.ts`** (new, small) — hoisted the `jennysol-active-conversation` localStorage key name out of `MainApp.tsx` into a shared module so both it and `AuthContext.tsx` reference the same constant without an import cycle between `lib/` and `components/`.

No conversations, messages, or accounts were deleted or reset. A guest's prior conversations remain in the database (orphaned from that browser once "start new session" is used, exactly as before if that guest never signs up) — nothing about data retention changed, only who a given browser is treated as.

## 6. Verification

### 6.1 Automated regression suite (new: `server/src/services/security.test.ts`)

Real SQLite (no mocks), following this codebase's existing test convention (see `agentRunStore.test.ts`). 10 tests, all passing:

| # | Test | Result |
|---|---|---|
| 1 | User B listing conversations never includes User A's | PASS |
| 2/3 | User B cannot load User A's conversation or its messages (`conversationExists`, `getConversationMessages` both correctly empty/false); User A's own access unaffected | PASS |
| 4 | User B sending a chat message with User A's `conversationId` creates a new conversation instead of writing into A's | PASS |
| 5 | User B's document/vector search never returns User A's chunks; `documentBelongsToUser` correctly false | PASS |
| 6 | User A retains full access to their own conversation/messages throughout | PASS |
| 7 | Concurrent AgentRuns for A and B remain independently readable/addressable, neither visible to the other | PASS |
| + | User B cannot delete User A's conversation or document by guessing the id (no-op) | PASS |
| + | A non-owner `addMessage` call does not mutate the conversation's `updated_at` (defense-in-depth check on the query itself) | PASS |
| + | User B's `listActiveOrUnseenRuns`/`getRun` round-trip never surfaces a run it doesn't own | PASS |

Full suite result: **87/87 tests passing** (77 pre-existing + 10 new), TypeScript strict-mode clean, both client and server build clean.

### 6.2 Live production verification of the actual fix

Scripted against `https://api.jennysol.vikisol.in` (not localhost), reproducing the exact reported scenario:

```
Person A (guest) created: 94ecf489-d65a-4ba2-ab16-b3e7a370a9a1
Person A's conversation: f6af9e84-bd49-4ee3-97b0-2aeb8f0dd280
Logout old guest session status: 204
Using OLD token after logout -> 401 (conversations field absent from error body)
Person B (fresh guest) created: 42f92e1f-1e74-498b-bb56-e37151b8c18a (different from A: true)
Person B's conversation list: []
Person B can see Person A's conversation: false
```

This is the literal sequence the new UI button performs (logout, then a fresh guest login) executed directly against production. Confirmed: the old token is dead immediately after logout, the new guest is a genuinely distinct account, and it starts with zero visibility into the previous guest's conversation.

## 7. Security status

**BEFORE FIX**: CRITICAL (real-world user impact: one person's private conversation content was visible to another person).

**ROOT CAUSE**: Not a backend authorization bug — every ownership-sensitive query was already correctly scoped. The cause was a client-side gap: guest sessions (the default, no-login-wall mode) had no mechanism to end a session on a shared device, so a `localStorage`-persisted token silently carried over to the next physical person who opened the same browser.

**FIX**: Added a guest-only "start a new session" action (`AuthContext.startNewGuestSession`) wired into the sidebar, composing the pre-existing, already-correct `logout()` primitive with a fresh `guestLogin()` and a full page reload — no backend changes.

**VERIFIED**: 87/87 automated tests (10 new, cross-user-isolation-specific), both builds clean, TypeScript strict-mode clean, and a live scripted reproduction against production confirming a "new session" genuinely starts with zero access to the prior guest's data.

**REMAINING RISK** (see also Known Limitations in the architecture handoff):
- MEDIUM: A shared-device user still has to *notice* and *use* the new "Not you? Start a new session" control — it's not automatic. Nothing detects "a different person is now holding this device" (that would require biometrics/re-auth-on-resume, out of scope for this fix). The mitigation is a visible, low-friction affordance, not an automatic guarantee.
- LOW, NOT CURRENTLY EXPLOITABLE: `getConversationSummary`/`saveConversationSummary` (`conversationStore.ts`) take a `conversationId` but no `userId`, scoped only by `conversation_id` in SQL. Every current call path passes a `conversationId` that was already validated against the caller's `userId` upstream (in `chatRunner.ts`, itself gated by `startChatRun`'s `conversationExists` check — Section 3.4), so this is not reachable by an attacker-controlled id today. Flagged as defense-in-depth hardening for a future change, deliberately not modified now, per "smallest safe fix" — adding `userId` scoping here would touch `contextManager.ts` and its existing mocked test suite for a path that isn't the root cause of this incident.
- LOW: A full (non-guest) account already had a working logout button before this incident — the same shared-device risk exists in principle for a signed-up account whose owner forgets to log out, exactly as it would for any web app using persistent client-side sessions (Gmail, banking apps, etc.). This is standard, expected behavior for token-based persistent login, not unique to Jennysol, and is not something this fix changes.
