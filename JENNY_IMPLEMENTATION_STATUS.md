# Jenny — Master Implementation Audit & Living Checklist

**Last updated:** 2026-09-03
**Audited by:** Claude, via direct repository inspection (file listing, dependency
manifests, source reading, grep for auth/Postgres/Redis/test markers) — not from memory of
having written the code, even though the same session wrote nearly all of it. Where a claim
below is backed by something more than reading source (an actual test run, a live API call,
a screenshot), it says so under **Evidence**.

**Methodology note on scope:** this file covers all 41 categories from the audit request,
using the required status format (Status / Implementation / Evidence / Missing / Problems /
Next action) for every category. For a category with real substance, that's a full writeup.
For a category that is simply **NOT STARTED** — which is most of them — the writeup is
short by design: padding "NOT STARTED, nothing exists" out to a six-field template per
sub-bullet would bury the categories that actually matter. Nothing is skipped; the depth is
proportional to what there is to say.

**The single most important fact in this document:** the repository contains one product —
a single-user, unauthenticated, local-SQLite RAG chat application called Jennysol AI, with
multi-provider chat, image generation, and a genuinely well-built voice conversation UX.
It does not contain, in any form, the multi-tenant Vikisol Arena platform, its role-specific
AI agents, its memory/search system, or its real-world integrations (calendar, email,
Teams, Zoom, food/travel booking, device control) described across the many prior
specification messages. That gap is not a matter of interpretation — it's confirmed by
`grep` finding zero auth/session code, zero Postgres/Redis/pgvector references, and zero
test files anywhere in the repository.

---

## PHASE 1 — Repository Audit

```
jennysol-ai/
  client/   React 18 + Vite + TypeScript + Tailwind (single-page app, no router)
    src/components/  ChatWindow, MessageBubble, Sidebar, VoiceOrb, VoicePicker
    src/lib/          api client, speech recognition hooks, TTS, theme, voice list
  server/   Node + Express + TypeScript, single process
    src/routes/       chat, conversations, documents, image, speech
    src/services/      llm router + 4 providers, embeddings, chunker, vector store,
                        conversation store
    src/db/           better-sqlite3, one file (jennysol.db), 4 tables total
  Dockerfile, server/Dockerfile, render.yaml(removed)/Vercel/Railway deploy config
```

**Frontend applications:** one — a React web SPA. No mobile app, no desktop app (no
Electron/Tauri/React Native anywhere in the repo).

**Backend/API:** one Express process, one SQLite file. No separate agent service, no
worker processes, no queue.

**Database:** SQLite (`better-sqlite3`), 4 tables: `documents`, `chunks`, `conversations`,
`messages`. No PostgreSQL, no pgvector, no Redis, no object storage — confirmed via
`grep -rli "postgres|redis|pgvector"` returning nothing.

**Authentication/authorization:** none. Confirmed via `grep -rli "auth|login|jwt|session|passport"`
— the only hit is the literal substring "Authorization" in an HTTP header name
(`server/src/services/providers/deepseek.ts`), not an auth system. There are no user
accounts, so there is nothing to authenticate.

**AI providers:** Gemini (chat, image, TTS), DeepSeek (chat), Ollama (chat), behind a real
`LlmProvider` interface. No Claude provider (removed earlier in this project's history at
user request), no model router beyond a static env-var switch.

**Tools/integrations:** none beyond the app's own document store (RAG) and the three model
providers. No web search, Places, Calendar, Email, Teams, Zoom, food/travel, or device
control code exists anywhere.

**Testing:** zero test files in the repository (`find . -iname "*.test.*" -o -iname "*.spec.*"`
returns nothing). All verification in this project's history has been manual — TypeScript
compilation, real API calls via curl, and Playwright-driven browser sessions run ad hoc and
not committed as a test suite.

**Observability/billing/notifications/marketplace/role-specific functionality:** none.

---

## PHASE 2 — Master Requirement Categories

### 1. Jenny Core Agent

**Status:** PARTIAL

**Implementation:**
- `server/src/routes/chat.ts` — request handling, conversation loading/persistence
- `server/src/services/llm.ts` — provider selection (`LLM_PROVIDER` env var)
- `server/src/services/llmProvider.ts` — the `LlmProvider` interface, now also carrying an
  optional `onWebSources` callback and a `WebSource` type
- `server/src/services/providers/gemini.ts` — chat requests now declare Gemini's native
  `googleSearch` grounding tool; Gemini itself decides per-turn whether a query actually
  needs a live search (guided by a persona instruction in `llm.ts` telling it when to use
  search vs. answer from general knowledge) — this isn't a hand-built intent classifier,
  it rides on the model's own tool-selection judgment, which is both less code and more
  reliable than a bespoke keyword/regex layer would be
- Streaming: SSE (`text/event-stream`) from server to client, real token streaming
- Real sources are now unified: `Source` is a discriminated union of `{type:"document"}`
  (existing RAG chunks) and `{type:"web", title, url, domain}` (from Gemini's
  `groundingMetadata.groundingChunks[].web`) — web sources render as real clickable link
  chips in `MessageBubble.tsx`, not the old fake-looking truncated-text pills; document
  sources keep their original rendering
- A real provider-fallback path: if the `googleSearch` tool call fails before any text has
  streamed, `gemini.ts` transparently retries the same request without the tool and the
  user sees a normal answer with no visible error — a working, narrow instance of what
  section 13 of the intelligence-upgrade spec calls "provider fallback," not the general
  cross-provider version (see category 3)

**Evidence:** live Gemini chat responses via curl and browser testing throughout this
project's history; TypeScript build passes. **Grounding specifically:** confirmed via a
direct, isolated REST call to `generateContent` that the exact same prompt succeeds
without the `googleSearch` tool and returns 429 `RESOURCE_EXHAUSTED` with it, on this
project's current (free-tier) API key — i.e. grounding is a separate quota bucket from
plain chat on this key, currently exhausted/unavailable, not a bug in the wiring. Verified
the fallback handles this correctly: with the tool declared, a plain "say hello" request
now succeeds (falls back silently) instead of failing chat entirely, which is what
happened before the fallback was added — this was caught and fixed in the same work
session, not shipped broken. **Not yet verified:** an actual successful grounded answer
with real returned sources, since this key currently can't complete a grounded request at
all. The code path (extracting `groundingChunks`, deduping by URL, rendering as link
chips) is type-checked and reviewed against the SDK's real type definitions, but has not
been exercised end-to-end with an actual search result.

**Missing:** no separate "agent runtime" distinct from the Express route handler — there is
still no planner and no general structured tool-call loop (grounding is the one tool
Gemini can reach for; there's no way to add a second one, like a real image-search or
maps tool, without deciding whether to build that generic loop or hand-wire each one).
No task/session persistence beyond one conversation's message history, no
retry/timeout/cancellation logic around the LLM call itself (a hung provider call hangs the
request), no agent-level state machine. "High-level activity reporting" exists only for
voice (the orb states) — plain-text chat has no equivalent ("Searching the web…"-style
status) even though grounding can now genuinely happen mid-answer.

**Problems (found and fixed the same session):** the first version of the grounding-
availability check ran inline on a real request — the very first chat message after any
server restart would attempt the tool, wait for Gemini's 429 (measured directly at
**17.159s** in an isolated back-to-back test, vs. 930ms with the tool skipped), and only
then fall back. Since this is a `tsx watch` dev server that restarts on every file save,
this meant real messages were intermittently taking 17+ seconds — reported directly by the
user as "the responses are very slow." Fixed by moving the availability check to a
one-time background probe at module load (`probeGroundingAvailability` in `gemini.ts`):
it defaults to *not* using the tool until the probe explicitly confirms it works, so no
real request ever waits on that discovery. Re-measured after the fix: first request after
a restart 5.1s, second 2.7s, third 1.3s — normal Node/network warmup, not a stuck 17s
floor. The per-request try/fallback logic was kept as defense-in-depth for the rare case
grounding looks available but a specific call still fails.

**Next action:** get grounding actually exercised on a key/tier where it isn't
quota-exhausted, to confirm real sources render correctly end-to-end rather than just in
code review. Beyond that, if this direction is pursued further, a real tool-calling loop
(structured function calling, not just "one tool Gemini decides on its own to use") is the
next step before anything else in this category can move past PARTIAL.

---

### 2. Multi-User / Vikisol Arena Architecture

**Status:** PARTIAL — user accounts, sessions, and per-user tenant isolation are now
TESTED and real; organizations and role-specific experiences are not started.

**Update 2026-09-11:** a real frontend now exists for account/security/sessions, closing
the "no settings UI" gap this category's evidence originally described for the backend-only
`GET /api/auth/sessions`/`logout-all`/`change-password` endpoints below. `client/src/pages/
account/` — Profile, Security, Sessions (including a new per-device revoke,
`deleteSessionByFingerprint`), Appearance (a real Dark/Light/System preference), and Privacy.
Also added: a public landing page (`/welcome`), Privacy Policy and Terms of Service pages
(marked pending legal review, not finalized), and honest product-boundary pages for Agents
(no catalog exists), Files (a second view onto the same RAG backend this document already
describes, not a new system), Memory (separates real conversation history from the
non-existent long-term memory this document is right to call out below), Tasks and
Integrations (both correctly still NOT STARTED — see categories 19–26/31–32 — now with an
honest UI boundary instead of no UI at all). Account deletion, organizations, and
role-specific experiences remain exactly as described below — genuinely not built.

**Implementation:**
- `server/src/services/auth/` — `password.ts` (scrypt hashing, no new dependency),
  `sessions.ts` (opaque DB-backed tokens, not stateless JWT — chosen specifically so
  "logout everywhere" is a real `DELETE`, not a blocklist), `userStore.ts`,
  `loginAttempts.ts` (brute-force lockout)
- `server/src/routes/auth.ts` — signup, login, logout, logout-all, sessions list, me,
  profile update, change-password, forgot/reset-password, verify-email,
  resend-verification
- `server/src/middleware/auth.ts` — `requireAuth`, applied to every existing feature route
  (chat, conversations, documents, image, speech)
- `server/src/services/email.ts` + `emailProviders/console.ts` — pluggable
  `EmailProvider` interface, same pattern as `LlmProvider`; currently logs
  verification/reset links to the server console since no real email-sending credentials
  exist (honestly labeled dev-mode, not silently faked)
- `client/src/lib/auth.ts`, `AuthContext.tsx` — token storage, every existing API call now
  goes through `authFetch` (adds the `Authorization` header, handles 401 by logging out)
- `client/src/pages/` — Login, Signup, ForgotPassword, ResetPassword, VerifyEmail;
  `RequireAuth` gates the main app, `react-router-dom` added for real page navigation
- `conversations`/`documents`/`chunks` tables migrated to carry `user_id`; every query in
  `conversationStore.ts` and `vectorStore.ts` scoped by it

**Evidence:** extensively tested, both layers. Backend via curl: signup → session issued;
duplicate signup rejected without revealing which field collided; weak password rejected;
`/me` and every protected route correctly 401 with no token; login with wrong password
401, with unknown email the *same* generic 401 (no account-enumeration leak);
**tenant isolation directly verified with two real accounts** — user2 got a 404 (not data)
fetching user1's conversation by ID, and user2's own conversation list came back empty
rather than showing user1's; forgot-password gives the same response for an existing vs.
nonexistent email; password reset works end-to-end, **revokes every existing session**
(verified: the pre-reset token 401s immediately after), old password stops working, the
reset token is single-use (a second attempt with the same token is rejected);
change-password rejects a wrong current password; multi-session logout-all verified with
two simultaneous logins, confirmed both die together. Frontend via Playwright: visiting `/`
while logged out redirects to `/login`; full signup → landed in app with the right
name/role showing; a real authenticated chat message round-tripped correctly (proving the
auth header actually reaches the existing routes); logout redirects to `/login` and `/`
redirects again afterward; **the forgot-password → email-logged link → reset page →
new-password login flow was driven through the real UI end to end**, not just the API.
Also caught and fixed a real bug during this testing: the strict rate limiter was
initially applied to the whole `/api/auth` router, which would have throttled routine
calls like `/me` on every page load — narrowed to just the abuse-prone endpoints
(signup/login/forgot-password/reset-password).

**Also added this session — Google Sign-In:**
- `server/src/services/auth/google.ts` — verifies a Google Identity Services ID token
  server-side (`google-auth-library`'s `OAuth2Client.verifyIdToken`) against Google's own
  public keys; never trusts a client-supplied profile.
- `POST /api/auth/google` — three real paths, all exercised in code: existing Google user
  logs in directly; an email that already has a password account gets Google *linked* to
  it (not rejected as a duplicate); a genuinely new email creates an account, taking the
  display name straight from the Google profile (no separate "what should we call you"
  prompt — the name is editable afterward via the existing profile settings, same as any
  account).
- `client/src/components/GoogleSignInButton.tsx` renders Google's own hosted button (not a
  custom lookalike) on Login and Signup; hidden entirely, with no dangling UI, when
  `VITE_GOOGLE_CLIENT_ID` isn't configured — verified via Playwright screenshot that the
  "or" divider correctly disappears along with the button rather than floating with
  nothing under it (this was a real bug, caught and fixed the same session).
- **Not yet verifiable end-to-end:** this requires an actual Google OAuth client ID, which
  isn't configured in this environment — the verification path, DB linking logic, and UI
  are implemented and type-checked but a real Google account has not signed in through it.
  Setup instructions are in `server/.env.example` and `client/.env.example`.

**Also added this session — admin dashboard (scoped as a protected area of the same app,
not a second deployed application — see below):**
- `server/src/services/adminStore.ts`, `server/src/routes/admin.ts` — stats (user/role/
  provider counts, signups and messages by day, active-user counts from real session
  activity), a searchable paginated user list, a per-user detail + conversation list, and a
  **read-only conversation transcript viewer** for support triage — gated by a new
  `requireAdmin` middleware that re-checks the role from the DB on every request (not
  baked into the session token, so revoking admin access is immediate).
- `client/src/pages/admin/` — Dashboard, Users, User detail, Errors, all behind
  `RequireAdmin` (client-side convenience only; real enforcement is server-side).
- `server/scripts/promote-admin.ts` — a one-off CLI script to grant the first admin (`npx
  tsx scripts/promote-admin.ts you@example.com`), since there's no in-app way to grant the
  first admin without one already existing.
- **Real privacy tradeoff, stated plainly, not hidden:** the conversation-transcript
  viewer gives admins read access to any user's private chat content. This is what "chat
  support" requires, but it's worth the user knowing this exists and deciding who gets
  the admin role.
- **Scoping decision:** built as `/admin/*` routes inside the existing deployed app rather
  than a second, separately-hosted application. Same functionality, without doubling
  hosting/deployment surface for an app that doesn't have its *primary* backend deployed
  yet (Railway is still pending). If a genuinely separate admin app is wanted later, this
  is straightforward to split out since the API layer is already a clean, separate route
  group.
- **Evidence:** tested end-to-end with curl and Playwright, not just code review — created
  a real account, promoted it via the script, confirmed the *existing* session token
  gained admin access immediately (no re-login needed, proving the fresh-DB-check design
  works as intended); confirmed a non-admin token gets 403 on every `/api/admin/*` route;
  confirmed a transcript request for a conversation that doesn't belong to the given user
  ID returns 404 rather than another user's data; screenshotted the dashboard and users
  table rendering real data (5 users, 14 conversations, 40 messages at the time of
  testing).

**Missing:** organizations (the `organization_id` column exists on `users` but nothing
creates, joins, or manages membership in one — no invite flow, no org-level roles, no org
switching); all 8 role-specific *experiences* (the role is captured at signup and stored,
but nothing in the app currently behaves differently based on it — see category 30);
audit logging of security events beyond the error log; CSRF-specific protection (mitigated
in practice by Bearer-token auth rather than cookies — tokens aren't auto-sent by the
browser the way cookies are, which sidesteps classic CSRF, but this wasn't independently
pen-tested); account deletion / data export (categories 79–80 in the original spec) have
no endpoint; no admin tooling yet to suspend/disable a user (only view).

**Problems:** none currently known in what was built — this is the most rigorously tested
addition in the project's history, specifically because it's securit­y-critical. The
honest remaining risk is the same class as anywhere else in this app: nothing here has
been reviewed by anyone other than the author.

**Next action:** organizations, if genuinely needed, is the natural next slice — the schema
already has a place for `organization_id` to avoid a second migration.

---

### 3. AI Model Providers

**Status:** IMPLEMENTED + TESTED (Gemini), IMPLEMENTED + UNIT-TESTED but **not yet run
against a real API** (DeepSeek), IMPLEMENTED + gracefully self-disabling when unreachable
(Ollama)

**Implementation:**
- `server/src/services/llmProvider.ts` — the interface
- `server/src/services/providers/gemini.ts`, `deepseek.ts`, `ollama.ts` —
  implementations
- `server/src/services/providers/openaiCompatible.ts` — shared streaming client for
  DeepSeek/Ollama
- Provider selection is no longer a single static choice — see category 4, the
  `ModelRouter`, which now owns this.
- `ollama.ts` now also exports `isOllamaAvailable()` — a background reachability probe
  (`GET /api/tags`, 1.5s timeout, cached 60s, defaults to unavailable until proven
  otherwise) so the router can skip it instantly rather than let every chat request pay for
  a doomed connection attempt on a host with no Ollama running.

**Evidence:** Gemini chat verified live repeatedly (curl + browser) throughout this
project, most recently through the new router in production (`https://jennysol.vikisol.in`
— real signup, real message "What is the capital of France?", real 200 response, real
answer "That's Paris!", `[router] gemini ok` observed in Railway logs). DeepSeek's routing
logic (credential detection, fallback ordering, circuit breaker interaction) is covered by
real automated tests with a mocked HTTP layer — see category 39 — but **DeepSeek has still
never made one real network call to `api.deepseek.com`**, because no `DEEPSEEK_API_KEY` has
ever been available in this environment. That is the one honest gap left: the router will
correctly *try* DeepSeek the moment a key is set, but "the code is right" and "it's been
proven against the real API" are different claims, and only the first one is true today.

**Missing:** cost tracking, token usage tracking, no Claude provider (intentionally
removed), no real DeepSeek API key to verify against.

**Next action:** get a real `DEEPSEEK_API_KEY` and set `LLM_PROVIDER_CHAIN=gemini,deepseek`
in Railway, send one real message, confirm the response and check Railway logs for
`[router] deepseek ok`. Fast, low-risk verification, not new implementation.

---

### 4. Model Router / Provider Resilience

**Status:** IMPLEMENTED + TESTED (unit/integration level, mocked providers) — built in
direct response to a real Gemini 503 ("high demand") observed live in production during
this project's own testing.

**Implementation:**
- `server/src/services/retryClassifier.ts` — turns a raw provider error into one of
  `503 | 429 | quota | auth | invalid_request | timeout | other`. `isRetryableNow()` says
  whether it's worth a same-provider retry right now (503/timeout only — a 429/quota won't
  clear by immediately hammering it again, an auth/invalid-request error will never clear
  by retrying at all). `affectsProviderHealth()` excludes `invalid_request` from counting
  against a provider's health, since a malformed request is this app's fault, not the
  provider being unreliable.
- `server/src/services/providerHealth.ts` — an in-memory (single-instance, not shared
  across processes — see Missing) circuit breaker per provider: 3 consecutive
  transient-looking failures trips a 30s cooldown; a single auth failure trips a 1-hour
  cooldown instead (retrying a bad key every 30s is pure waste — the real fix is someone
  updating the env var). Cooldown expiry is a half-open trial: the next request through is
  a live test of recovery, and one success clears the breaker.
- `server/src/services/modelRouter.ts` — `routeChatCompletion()` walks an ordered provider
  chain (`LLM_PROVIDER_CHAIN`, comma-separated; falls back to the old single-provider
  `LLM_PROVIDER` env var unchanged if that's all that's set), skipping any provider that
  isn't configured (no key / Ollama unreachable) or is currently in cooldown, and tries the
  next one automatically on a failure — *except* when the failed provider already streamed
  part of a reply, in which case it surfaces the failure rather than stitching two
  providers' output into one answer or sending a second independent reply after a partial
  one the user already saw. Throws a typed `AllProvidersUnavailableError` (listing every
  attempt and why) when nothing in the chain could handle the request.
- `server/src/routes/chat.ts` — catches `AllProvidersUnavailableError` specifically and
  gives a natural message ("I can't reach any AI engine right now...") distinct from a
  single provider's own transient failure; never leaks raw provider error bodies either
  way, extending the pattern from category 41 to the router level.
- `server/src/services/providers/gemini.ts` — a real, evidence-backed addition: a single
  automatic retry specifically for Gemini's 503 "high demand" response (Google's own error
  message says to retry shortly), only when nothing has streamed yet.

**Evidence:** 20 automated tests across `retryClassifier.test.ts` and
`providerHealth.test.ts` (error classification, circuit breaker tripping/recovery/
independence-per-provider, auth vs. transient cooldown length) plus 9 in
`modelRouter.test.ts` covering the actual chaos scenarios this category asks for: fallback
on failure, no-fallback-after-partial-stream, skipping unconfigured/cooling-down providers,
all-providers-down, and a provider staying excluded across multiple subsequent requests
after an auth failure — all with mocked providers (`vi.mock`), so this is real behavioral
coverage, not just "the code compiles." `npm test` in `server/` (vitest, newly added — this
project had zero test infrastructure before this). Separately confirmed live in production
that the happy path (single healthy Gemini provider, the overwhelmingly common case) still
works exactly as before through the new router.

**Missing, deliberately deferred (see the request that prompted this category for the full
reasoning):**
- Request queue + concurrency limits + P0–P3 priority scheduling — real infrastructure not
  yet justified by this app's actual traffic; sizing it before there's real concurrent-load
  data to size it against would be guessing.
- Cost budgets / spend tracking per user or org — needs token-usage accounting wired to a
  real per-model pricing table, plus somewhere to configure and view it. A genuine follow-up
  feature once the router is producing real usage data to track.
- Complexity-based "cheap/local model first, escalate if it's not good enough" quality
  routing — a real NLU/classification problem, not a resilience fix. What exists instead is
  the same *heuristic* pattern already used for Gemini's search-grounding decision (category
  1): keyword/shape-based, not learned or verified for quality.
- Health/circuit-breaker state is in-memory and per-process — correct for this app's actual
  deployment (one Railway instance) but would need to move to something shared (Redis etc.)
  if that ever changes.
- No Retry-After header parsing for 429s — currently a flat 30s cooldown regardless of what
  the provider actually says to wait.
- Ollama is real and wired into the chain, but genuinely cannot run on Railway itself (no
  GPU/persistent host for it there) — it's correctly detected as unavailable and skipped,
  not a shortfall in the code.

**Problems:** none observed in what's built; the honest gap is DeepSeek's live-API
verification (category 3) and the deferred items above.

---

### 5. Continuous Voice-First Experience

**Status:** TESTED

**Implementation:** `client/src/lib/useVoiceConversation.ts`, `speak.ts`,
`useSpeechRecognition.ts`, `speechRecognitionTypes.ts`; wired in `ChatWindow.tsx`.

**Evidence:** this is the most rigorously tested part of the entire codebase. Verified via
a deterministic test rig (a fake `SpeechRecognition` injected through
`page.addInitScript`, since headless browsers have no real microphone):
- Clicking start goes directly to `listening` — no wake-word gate on the default path.
- Two *consecutive* spoken commands, no wake word between them, both correctly answered
  (the actual "continuous conversation" claim, not just a first-turn demo).
- Automatic return to listening after each answer (state never leaves `listening`
  throughout a normal turn).
- Real voice barge-in: speech detected while Jenny is speaking stops her immediately.
- Click-to-interrupt as a guaranteed-reliable fallback to barge-in.
- A defensive timeout so a hung TTS playback can't permanently wedge the conversation
  (this was found and fixed *because* testing hit it — see the geminiTts entry below).

**Missing:** local wake-word detection (the spec's "don't send raw audio to the cloud just
to detect a wake word" — this app's wake-word matching runs client-side against the
browser's own STT, which itself may or may not be cloud-backed depending on the browser;
there's no dedicated local wake-word model). No background/lock-screen activation (not
achievable from a web app regardless). No configurable silence/timeout settings UI (the
spec's "10s/30s/1min/Never" timeout options don't exist — the session just stays listening
until paused/stopped). No settings UI at all, in fact, for any of this — the wake-word
opt-in (`start(true)`) exists in code but has no UI toggle to reach it.

**Problems:** barge-in's *real-world reliability* depends on the browser's own echo
cancellation, which cannot be verified without real speakers/microphone hardware — this is
documented as a known, honest limitation in the README, not silently assumed to work.

**Next action:** a settings panel exposing the wake-word-required toggle and a
timeout/session-duration control would close the gap to the spec's "configurable" language
without needing new architecture — the hook already supports both.

---

### 6. Voice State Machine

**Status:** PARTIAL

**Implementation:** `VoiceConversationState = "off" | "sleeping" | "listening" | "paused"`
in `useVoiceConversation.ts`; a separate, richer `OrbState` (`idle | sleeping | paused |
listening | thinking | tool | speaking`) in `VoiceOrb.tsx` composed in `ChatWindow.tsx`
from `voiceConv.state` + `sending` + `assistantSpeaking`.

**Evidence:** all reachable states screenshot-verified (see prior session's testing);
transitions confirmed via the fake-recognition test rig.

**Missing:** the spec's exact named states (`STARTING`, `USER_SPEAKING`, `TOOL_EXECUTION`,
`STOPPING`, `ERROR` as a first-class state) don't exist 1:1 — the actual implementation
covers the same *behavior* with fewer, coarser states. There's no explicit `ERROR` state
visible in the UI if, say, the microphone permission is denied — that currently just fails
silently (the button does nothing observable).

**Problems:** no visible error state for mic-permission-denied is a real, if minor, UX gap.

**Next action:** add an explicit error affordance for permission-denied / recognition
unavailable.

---

### 7. Barge-In

**Status:** TESTED (code path), UNVERIFIED (real-world acoustic reliability)

See category 5 — same implementation, same evidence, same honestly-stated limitation
(depends on browser echo cancellation this project cannot inspect or improve on, and
cannot be verified without real audio hardware).

---

### 8. Jenny Orb / Premium Voice UI

**Status:** IMPLEMENTED, TESTED

**Implementation:** `client/src/components/VoiceOrb.tsx`.

**Evidence:** all 7 states screenshot-verified except "tool," which was exercised without
error but not caught mid-screenshot (see prior session notes — image generation fails
against quota too fast to reliably screenshot the transient state). Real audio-reactive
scaling verified via a live `AnalyserNode` on actual Gemini TTS playback (not simulated).

**Missing:** the orb is **not** the primary interaction surface the spec repeatedly
demands ("do NOT create a ChatGPT-like screen," "chat should be secondary," "no permanent
chat input at center"). The actual app is chat-first with the orb as a secondary indicator
(large in the empty state, compact above the composer during an active voice session) —
the opposite information hierarchy from what multiple spec messages explicitly required.
This was a deliberate, stated tradeoff in this project's history (preserving the
just-built, explicitly-requested chat-history feature rather than discarding it for a
voice-only redesign), not an oversight — but it means this category cannot honestly be
marked complete against the spec as written.

**Problems:** this is the clearest, most direct contradiction between what was specified
and what exists. Flagged explicitly rather than glossed over.

**Next action:** a genuine "voice-first" redesign (orb as the primary screen, chat as a
secondary mode reachable via a toggle) is a real, scoped UI project — worth a dedicated
decision, not a silent retrofit.

---

### 9. Voice Identity

**Status:** NOT STARTED

**Implementation:** none. `GEMINI_API_KEY`-gated TTS/chat exist; nothing about *who is
speaking* exists.

**Missing:** enrollment flow, speaker verification, "only recognize my voice," unknown-
speaker handling, voice profile storage.

**Problems:** none (nothing to be broken).

**Next action:** explicitly evaluated and **not recommended to fake**. Real speaker
verification needs either a paid cloud API or a Python ML microservice (SpeechBrain/
pyannote/Wespeaker) — genuinely new infrastructure, not a code addition to the existing
Node app. This was already researched and explained in this project's history (Azure's
speaker recognition API retired 2025, AWS's in 2026; the free/open alternatives need real
model inference a browser can't do). The one thing that *is* implemented correctly per
this category's actual safety requirement: nothing in this app currently uses any identity
signal to authorize sensitive actions, because there are no sensitive actions (no
payments, no destructive operations) — so the "voice ≠ authorization" rule isn't violated,
it's just moot.

---

### 10. Memory System

**Status:** PARTIAL (raw conversation history only)

**Implementation:** `server/src/services/conversationStore.ts`,
`server/src/db/index.ts` (`conversations`, `messages` tables).

**Evidence:** tested end-to-end — create on first message, appear in sidebar, switch
between threads with correct history reload, delete. A real race condition (switching
conversations mid-stream) was found and fixed during this testing.

**Missing:** every memory type *except* raw history: semantic memory (extracted
preferences/facts), episodic memory (event-level retrieval — "what did we decide about
X"), project memory, document memory (uploaded files aren't linked to memory/entities
beyond being retrievable by RAG similarity), image memory, video memory (no image/video
upload exists at all beyond documents). No confidence/source/importance/recency metadata
on anything. No "remember this" / "forget this" voice commands — these phrases would just
be sent to the LLM as a normal chat message with no special handling. No "what do you
remember about me" structured response — again, would just be an ordinary LLM turn with no
real data behind it, meaning **the model could plausibly hallucinate an answer to this
exact question**, which the spec explicitly and repeatedly forbids ("never fabricate
personal memory").

**Problems:** this is the second-clearest gap after voice-first UI, and the one with the
most acute honesty risk — if a user asks Jenny "what do you remember about me," the
current system prompt has no guardrail against the model inventing a plausible-sounding
answer, because there's no real memory store to ground a truthful "I don't have that"
response. This should be treated as a real, if narrow, correctness bug worth a one-line
system-prompt fix even without building full memory: instruct the model to explicitly say
it doesn't have persistent memory beyond the current conversation when asked.

**Next action:** short-term, fix the honesty gap above. Long-term, semantic memory
extraction (even a simple "detect explicit preference statements, store as key-value,
inject relevant ones into future system prompts") would be the highest-value next slice —
everything else in this category (episodic/project/image/video memory) depends on data
types (photos, videos, calendar, projects) that don't exist in this app yet either.

---

### 11. Hybrid Memory Retrieval

**Status:** PARTIAL

**Implementation:** `server/src/services/vectorStore.ts` — cosine similarity over
locally-computed embeddings (`@huggingface/transformers`), no metadata/date/keyword
filtering layered on top.

**Evidence:** retrieval tested and working for document RAG (confirmed via the `[1] [2]
[3] [4]` source citations appearing in real chat responses throughout testing) — but
**purely semantic, no threshold**. This was directly observed as a real quality issue
during testing: an unrelated test message ("say the word banana") retrieved four
irrelevant document chunks as "sources" purely because they scored highest among whatever
was in the store, with no minimum-relevance cutoff. The model itself correctly ignored the
irrelevant context in its answer, but the UI still displayed it as if it were relevant.

**Missing:** keyword search, structured date filtering (there's no date-aware query path
at all — "photos from July 24th" has no photos to query in the first place), entity
matching, relationship traversal, recency/importance weighting.

**Problems:** the no-threshold retrieval issue above is a real, fixable bug, independent
of the larger missing-features gap.

**Next action:** add a minimum cosine-similarity cutoff before including a chunk as a
"source" — small, contained fix.

---

### 12–14. File / Document Memory, Image Memory, Video Memory

**Status:** PARTIAL (documents only — PDF/TXT/MD), NOT STARTED (images, video)

**Implementation:** `server/src/routes/documents.ts`, `services/chunker.ts` — upload,
extract text (PDF via `pdf-parse`, plain text/markdown natively), chunk, embed, store.

**Evidence:** tested end-to-end repeatedly (upload → chunk → embed → store → retrieve).

**Missing:** DOC/DOCX, spreadsheets — not handled (no library for them; a `.docx` upload
would either fail extraction or be read as garbled raw bytes, unverified which). No OCR.
No image upload/storage/indexing at all (image *generation* exists — a completely
different feature — image *understanding/memory* does not). No video support in any form.
No metadata extraction beyond filename, no entity/date extraction, no project association
(there are no projects), no "compare documents" workflow beyond asking the model to do it
ad hoc against retrieved chunks.

**Next action:** DOCX/XLSX support (via a library like `mammoth`/`xlsx`) is the most
realistic near-term addition given the existing pipeline already handles the
chunk/embed/store/retrieve mechanics — everything else in these three categories is a
much larger, separate build (object storage, OCR, video frame sampling).

---

### 15. Global Personal Search

**Status:** NOT STARTED

**Missing:** everything — there is exactly one searchable data source (uploaded documents,
via RAG). No conversations search, no cross-source unified results, no grouped-by-category
UI. (Conversation history *can* be scrolled/found in the sidebar list, but there is no
search-within-conversations feature.)

**Next action:** blocked on most of categories 12–14 and 22–26 existing first — there's
nothing to search across yet beyond documents.

---

### 16. Device / App Control

**Status:** NOT STARTED

**Missing:** everything. No OS integration, no deep links, no accessibility API usage, no
screenshot capability, no file-system operations beyond the app's own document uploads.

**Problems:** none (nothing exists to violate the "never bypass OS security" rule, which
is good — but also means the rule is untested, not proven-safe).

**Next action:** genuinely out of scope for a web app without a native companion —
flagged, not attempted, consistent with this project's stance throughout.

---

### 17–18. Tool Permission System, Action Risk Levels

**Status:** NOT STARTED

**Missing:** there are no tools with side effects in this app (RAG retrieval and image/
speech generation are all read-only from the user's perspective — nothing purchases,
deletes, sends, or modifies external state), so there has been nothing to gate. No
permission levels, no risk-level classification, no confirmation-before-execution flow
exist because nothing in the app currently needs one.

**Next action:** this becomes necessary the moment any real-world-effecting tool (email
send, calendar write, booking, purchase) is added — build the permission layer *with* the
first such tool, not speculatively ahead of it.

---

### 19–26. Restaurant Search, Food Ordering, Reservations, Hotel/Travel, Calendar, Email,
Messaging/Contacts, Teams/Zoom

**Status:** NOT STARTED (all eight)

**Implementation:** none. No `PlacesProvider`, `CalendarProvider`, `EmailProvider`,
`MeetingProvider`, or any provider abstraction for these domains exists in the codebase.

**Missing:** everything in every one of these categories — no API integrations, no
credentials configured, no provider interfaces, no UI.

**Next action:** each of these needs a real third-party API/credential decision before any
code is worth writing (Google Places API key, a food-delivery partner API, Microsoft Graph
app registration, Zoom OAuth app, etc.) — none of that groundwork has happened. Not
attempted here, consistent with "do not fake integrations."

---

### 27. Computer Agent

**Status:** NOT STARTED

Same as category 16 — no OS-level automation exists in this repository at all.

---

### 28. Multimodal AI

**Status:** PARTIAL

**Implementation:** text ✓, voice input/output ✓ (categories 5–8), image *generation* ✓
(`services/providers/geminiImage.ts`, tested), documents ✓ (RAG, category 12).

**Missing:** image *understanding* (uploading a photo and asking "what is this" — the app
can generate images, it cannot look at one you send it), video in any form, screen
understanding, location. No task-adaptive UI beyond documents-as-RAG-context and generated
images-as-inline-pictures — there's no gallery/timeline/table/map rendering, because there's
no data that would populate them (no photos, no calendar, no places).

**Next action:** image *understanding* (Gemini already supports multimodal input — this is
a real, near-term, low-effort addition using infrastructure that already exists) is the
highest-value next step in this category.

---

### 29. Project / Software Requirement Agent

**Status:** NOT STARTED

**Missing:** entirely — no BRD generation, no requirement-to-architecture pipeline, no
vendor/company matching. This is one of Vikisol Arena's stated major differentiators and
has zero implementation.

---

### 30. Role-Specific AI

**Status:** NOT STARTED

Depends entirely on category 2 (users/roles) existing first, which it does not. All eight
role-specific experiences (candidate/recruiter/business/software company/freelancer/
university/training institute/admin) are unimplemented.

---

### 31–32. Notifications/Proactive AI, Long-Running Tasks

**Status:** NOT STARTED

**Missing:** no scheduling, no background jobs, no task persistence, no notification
system of any kind. The app only ever responds to a request it's currently handling; it
has no concept of state that outlives one HTTP request/SSE stream.

---

### 33–35. Database, Storage, Redis

**Status:** NOT STARTED (as specified) — PARTIAL in spirit (SQLite exists and works for
what it's asked to do)

**Implementation:** SQLite via `better-sqlite3`, 4 tables (see Phase 1). Uploaded document
files are written to local disk (`server/data/uploads/`), not object storage.

**Missing:** PostgreSQL, pgvector, Redis, and object storage as specified — none exist.
SQLite is doing real, working double duty as both the relational store and (via a BLOB
column + application-level cosine similarity) the vector store, which functions correctly
at this app's current scale but would not scale to the spec's multi-tenant, multi-media
vision.

**Next action:** a database migration to Postgres+pgvector is a real, non-trivial
undertaking that should happen *if and when* the multi-user/multi-tenant direction
(category 2) is actually committed to — not before, since SQLite is genuinely sufficient
for everything the app currently does.

---

### 36. Security

**Status:** PARTIAL

**Implementation:**
- CORS locked to a specific origin via `CORS_ORIGIN` when deployed split (client/server on
  different domains) — confirmed via a direct preflight test during this project's history.
- `.env` files gitignored; verified no secrets ever committed (checked before every push).
- Input validation via `zod` schemas on every route.
- better-sqlite3 uses parameterized queries throughout (`vectorStore.ts`,
  `conversationStore.ts`) — no string-concatenated SQL anywhere, so no SQL injection
  surface exists in the code that's there.

**Missing:** ~~no authentication~~ / ~~no rate limiting~~ — both stale as of this update,
this section wasn't revised when categories 2's own entry was (see category 2 and the
Critical Security Issues section below for the real, tested state: every data route now
requires auth, tenant-isolated, with global + per-route rate limiting). Still genuinely
missing: no SSRF protection (moot — no tool fetches arbitrary URLs on the user's behalf),
no prompt-injection-specific defenses beyond the system prompt's general instructions
(uploaded document content is passed to the model as context with no sanitization against
embedded instructions — untested whether a malicious PDF could influence model behavior),
no CSRF protection (moot for a Bearer-token API with no cookies/sessions), no secrets
manager (env vars only, appropriate at this scale), no encryption at rest for the SQLite
file, no account-suspension/disable tooling (the new admin dashboard can view users but
not act on them yet).

**Problems:** the untested prompt-injection surface via uploaded documents is worth
flagging as a real, unverified risk, not a theoretical one — this app explicitly puts
untrusted user-uploaded text directly into the LLM's context.

**Next action:** rate limiting (e.g. `express-rate-limit`) is a small, high-value,
near-zero-risk addition given the app is now publicly deployed. Prompt-injection testing
(deliberately upload a document containing "ignore previous instructions…" and see what
happens) would be cheap and informative.

---

### 37. Observability

**Status:** PARTIAL (was NOT STARTED)

**Implementation:** a real `error_logs` table (`server/src/services/errorLog.ts`) now
captures every uncaught exception, unhandled promise rejection, unhandled Express route
error, and reported frontend crash, each with a message/stack/path/user — visible in the
new admin dashboard's Errors tab, not just server console output.

**Evidence:** directly triggered a real uncaught exception against the running server
(a temporary test route, removed immediately after) and confirmed via the admin API that
it was caught, logged with a full stack trace, and — critically — that the server kept
running and answered `/health` immediately afterward, rather than crashing.

**Missing:** still no metrics, no traces, no token/cost tracking, no latency tracking, no
alerting (someone has to open the admin dashboard to notice; nothing pages anyone). This
is crash/error visibility, not full observability.

---

### 38. Usage / Billing

**Status:** NOT STARTED

**Missing:** entirely — no request/token/cost tracking, no subscriptions, no quotas. Worth
noting: Gemini TTS's free tier was empirically discovered during this project's testing to
cap at **10 requests/day** (not documented anywhere obvious in advance — found by hitting
it) — a concrete illustration of why usage tracking matters before this app has any real
user base, since there's currently no way to know quota consumption short of the API
erroring.

---

### 39. Testing

**Status:** PARTIAL — real automated suite now exists, but scoped to one subsystem
(provider resilience); everything else is still manual-only.

**Implementation:** `vitest` added as a dev dependency in `server/` (this project had zero
test runner configured before this). 29 tests across `retryClassifier.test.ts`,
`providerHealth.test.ts`, and `modelRouter.test.ts` — see category 4 for what they cover.
`npm test` runs them; `*.test.ts` is excluded from the production `tsc` build so nothing
test-only ships in `dist/`.

**Evidence of manual verification for everything else:** this project's history includes
real, repeated verification via TypeScript compilation, live curl requests against every
endpoint, and Playwright-driven browser sessions (including a deterministic fake-
`SpeechRecognition` rig used to test the entire voice conversation flow without real
microphone hardware) — but outside the new provider-resilience suite, none of this is
captured as a repeatable, committed test. Every other verification claim in this document
that says "tested" still means "manually exercised and observed to work at the time," not
"covered by a test that will catch a future regression."

**Next action:** the pattern now exists (vitest, mocked dependencies, real behavioral
assertions) — extend it to the next highest-value area rather than the whole app at once.
Auth routes and the conversation store would be the next reasonable candidates: both are
pure-enough logic to unit test without a browser, and both have been hand-verified
repeatedly across this project's history the same way voice states have.

---

### 40. UI / UX Quality

**Status:** PARTIAL — see category 8's honest note

**Implementation:** dark mode, ChatGPT-style transcript conventions, responsive
mobile/desktop layout, a genuinely distinctive animated voice orb. New this session: a
one-time "portal" welcome animation (`client/src/components/WelcomeAnimation.tsx`) shown
on a brand-new account's first login — expanding rings, a spinning conic-gradient vortex,
and an outward starfield, built from the same brand-gradient/orb visual language as the
rest of the app (pure CSS transforms/opacity, no canvas/WebGL/3D library), with a Skip
button and `motion-safe:` variants respecting `prefers-reduced-motion`. Gated by a real
`has_seen_welcome` DB column so it plays exactly once ever, not once per browser.
Screenshotted via Playwright mid-animation to confirm it actually renders the intended
rings/glow/text rather than just trusting the CSS compiles.

**Missing/Problems:** the app is explicitly, deliberately **chat-first**, which directly
contradicts the repeated "not a ChatGPT clone, voice-first, orb as primary interaction"
requirement. This is the same gap as category 8, restated here because it's a UX-quality
question, not just a component question.

---

### 41. Error Handling

**Status:** PARTIAL

**Implementation:** every route has a try/catch with a real error message returned (not a
generic 500) — e.g. `chat.ts` distinguishes missing-API-key from rate-limited from generic
failure; `image.ts` and `speech.ts` specifically detect 429/quota errors and return a
human-readable explanation instead of raw API JSON (this was a real bug found and fixed
during testing — raw Google API error JSON was originally leaking into the chat UI
unformatted). New this session — process-level crash resilience, prompted directly by the
user asking "make sure the app is not crashing" for future users:
- `process.on("uncaughtException"/"unhandledRejection")` in `index.ts` — logs to
  `error_logs` and keeps serving instead of the Node default of killing the process. A
  deliberate, stated tradeoff: Node's own docs recommend restarting after an uncaught
  exception since in-memory state could be inconsistent, but this app keeps no meaningful
  state outside SQLite (already durable) and per-request closures, so continuing serves
  uptime better here than it would for a stateful worker.
- A catch-all Express error middleware (must be registered last) for anything a route
  passes to `next(err)` or throws synchronously that nothing local caught — returns a
  clean natural-sounding JSON message instead of Express's default HTML stack-trace page.
- `client/src/components/ErrorBoundary.tsx` — a real React error boundary wrapping the
  whole app. Before this, any render-time exception anywhere in the component tree meant
  a permanent blank white screen for that user (React doesn't recover from a component
  throwing on its own). Now it shows a "Something went wrong / Reload" screen and reports
  the crash to the server.

**Evidence:** not just written and reviewed — actually triggered. Added a temporary route
that threw inside `setImmediate` (i.e. genuinely outside any request handler's own
try/catch, the exact scenario `uncaughtException` exists for), hit it, confirmed via
`curl /health` immediately after that the server was still up, and confirmed via the new
admin Errors view that the exception was captured with a full stack trace. Removed the
temporary route immediately after confirming.

**Missing:** no reconnect logic for dropped SSE streams. No alerting on the new error log —
an admin has to go look. (The "no retry logic anywhere" gap noted here previously is now
addressed for chat specifically — see category 4: a real cross-provider circuit
breaker/fallback, plus a same-provider retry for Gemini's 503. A distinct "permission
denied" UI state for microphone access was also since built — see category 6/8's voice
error-state work.)

**Problems:** none currently observed beyond the gaps listed.

---

### 42. iOS Keyboard / Visual Viewport

**Status:** PARTIAL — architecturally fixed and verified as far as simulation allows;
**not yet confirmed on a real iPhone**, which is the one thing that would fully close this
out. Explicitly not marking VERIFIED per the standing rule of this document: simulated
verification, however careful, is not the same claim as "observed working on real iOS
Safari hardware."

**Previous state:** two earlier passes this session had already addressed part of this —
(1) `h-screen`→`h-dvh` plus `interactive-widget=resizes-content`, then (2) a real
`window.visualViewport`-driven `--app-vh` CSS variable (replacing reliance on `*vh` units
alone) and fixing the chat/auth inputs' font-size to 16px (iOS auto-zooms the page on
focusing anything smaller, which reads as "the screen getting disturbed"). Both were real
fixes, verified via simulated viewport resizes at the time. This request is what came next:
a third, more precise report describing exactly which parts of the layout still misbehave,
which pointed at what those first two passes hadn't touched.

**Root cause (the part the first two passes missed):** `html`/`body` were still normal,
in-flow, scrollable elements. Even with `--app-vh` correctly tracking
`visualViewport.height` in real time, the *document itself* could still be nudged a few
pixels by iOS's native "scroll the focused input into view" heuristic — particularly
plausible in the gap between the keyboard starting to animate open (against the old, taller
viewport) and our own resize listener firing with the corrected height a frame or two
later. That's what produces a layout that's numerically correct (the height math works) but
visually "disturbed" (the whole page seems to shift/jump). Two secondary gaps compounded
it: `viewport-fit=cover` was never set, so every `env(safe-area-inset-*)` in the codebase
(there weren't any yet, but any future one too) silently resolved to `0`; and the welcome
screen's Orb/heading/subtitle/suggestions were vertically centered inside a region that, when
it shrinks a lot, doesn't fit that content — since it's centered, the Orb (first in the
stack) is what scrolls out of view above the fold, with no adaptive/compact state to prevent
it.

**Changes made:**
- `client/index.html` — added `viewport-fit=cover` to the viewport meta tag (prerequisite
  for safe-area support to do anything at all).
- `client/src/index.css` — `html, body { position: fixed; inset: 0; overflow: hidden; }`.
  This is the core fix: the document can no longer scroll at all, so there is nothing left
  for iOS's native scroll-into-view behavior to perturb. Every screen now scrolls via its
  own explicitly-owned `overflow-y-auto` region instead — never the page.
- `client/src/lib/useViewportHeight.ts` — also tracks `visualViewport.offsetTop` into a
  `--app-vh-offset` CSS variable (defense in depth / an escape hatch if a future browser
  quirk needs it; not currently consumed anywhere since the `position: fixed` change removes
  the main reason it would be needed).
- `client/src/lib/useKeyboardOpen.ts` (new) — a small, deliberately scoped hook: a real
  `keyboardOpen` boolean derived from comparing current `visualViewport.height` against the
  largest height seen since mount (>150px drop = keyboard), only calling `setState` when the
  boolean actually flips (not on every animation-frame resize tick), and only mounted where
  it's actually consumed (`ChatWindow`) rather than at the app root — so a keyboard
  open/close transition re-renders one component, not the whole tree.
- `client/src/components/ChatWindow.tsx` — three changes: (1) the welcome screen now reads
  `useKeyboardOpen()` and swaps to a compact top-aligned layout (small Orb, subtitle and
  suggestions collapsed via `max-h-0 opacity-0` with a `transition-all duration-300`, so it's
  a smooth collapse/expand, not a pop) whenever the keyboard is open — voice-first when idle,
  typing-first the instant a keyboard appears, per this app's stated design; (2) the header's
  top padding and the composer's bottom padding now include
  `env(safe-area-inset-top)`/`env(safe-area-inset-bottom)` respectively — the bottom one in
  particular matters only when the keyboard is *closed* (iOS zeroes that inset while the
  keyboard is showing, so this never adds an artificial gap above an open keyboard, only
  above the home indicator when it's the real bottom edge).
- `client/src/pages/AuthLayout.tsx`, `client/src/pages/admin/AdminLayout.tsx` — **a
  regression these changes would otherwise have introduced, caught and fixed in the same
  pass**: both previously relied entirely on the document scrolling to reveal content taller
  than the viewport (a long signup form, a long admin table). Pinning `html`/`body` removes
  that entirely, so both now own their own `overflow-y-auto` scroll region instead
  (`h-[var(--app-vh)]` + `overflow-y-auto` in place of the old `min-h-[var(--app-vh)]` with
  no overflow handling at all).

**Files changed:** `client/index.html`, `client/src/index.css`,
`client/src/lib/useViewportHeight.ts`, `client/src/lib/useKeyboardOpen.ts` (new),
`client/src/components/ChatWindow.tsx`, `client/src/pages/AuthLayout.tsx`,
`client/src/pages/admin/AdminLayout.tsx`.

**Tests performed (all against the live production deploy at `jennysol.vikisol.in`, not
just a local dev build):**
- Confirmed `position: fixed` / `overflow: hidden` actually landed on `html`/`body` via
  `getComputedStyle` in a real (Chromium, mobile-emulated) browser session — not just
  reading the CSS source.
- Simulated a keyboard opening on a fresh welcome screen (iPhone 13 viewport, 390×664 →
  390×365, a ~55% height reduction matching a real keyboard's footprint) and confirmed via
  both `getBoundingClientRect()` and screenshots: header stays pinned at the top, the Orb
  shrinks and the subtitle/suggestions collapse (`opacity: 0` confirmed), the composer with
  all four controls (mode toggle, mic, text input, send button) stays fully within the new
  365px viewport with zero horizontal overflow, and `--app-vh` tracks the new height exactly
  (`365px`).
- Confirmed the keyboard-close transition restores the original layout (screenshot
  comparison before/after).
- Regression check: signup form submit button remains reachable (scrolled into view,
  confirmed visible) even under an extreme 390×280 viewport that forces real overflow —
  this is the exact regression the `AuthLayout`/`AdminLayout` fix above was needed for.
- Regression check: the narrow-width (320px, iPhone SE) composer fix from an earlier session
  still holds — send button fully within bounds, verified via bounding box math, not just
  visually.
- Regression check: sidebar drawer still opens/closes correctly.
- Regression check: a real end-to-end chat message ("What is 2+2?") on the unmodified,
  non-simulated production site — real 200 response, real answer containing "4", zero
  console errors.
- Landscape orientation (844×390): no horizontal overflow.

**iOS-specific verification status: NOT YET CONFIRMED ON REAL HARDWARE.** Every test above
runs in Chromium with mobile device emulation (viewport size, user agent, touch flag) plus
manual `visualViewport`/viewport-size manipulation to *approximate* what a real keyboard
does. This is a good-faith, rigorous approximation — the architecture (pinned document +
real `visualViewport.height` tracking + a real `keyboardOpen` state) is the same technique
production iOS web apps use specifically because it doesn't depend on emulator-only
behavior — but Chromium's emulation does not run WebKit, does not reproduce Safari's actual
`visualViewport` timing/quirks, and cannot simulate a real keyboard animating open. The
honest position: this should now work correctly on real iOS Safari, and every piece of it
was built and tested against the actual documented cause of the bug rather than trial-and-
error CSS tweaking — but "should work, verified as rigorously as possible without the
hardware" is a different, weaker claim than "confirmed on a real iPhone," and this document
says so explicitly rather than blurring the two.

**Remaining limitations:**
- No real-device confirmation (see above) — the single biggest open item.
- The `keyboardOpen` threshold (150px) is a heuristic, not something iOS exposes directly;
  it should catch every real keyboard while ignoring minor chrome changes (address bar
  show/hide), but hasn't been tuned against real keyboard-height data across iPhone models,
  keyboard types (predictive text on/off, third-party keyboards), or accessibility settings.
- `--app-vh-offset` is tracked but not currently consumed by any layout — it's there as an
  escape hatch, not an active part of the fix; if real-device testing surfaces a residual
  offset issue the `position: fixed` change didn't fully resolve, this is where that fix
  would plug in.
- Landscape + Dynamic Island + keyboard-open in combination (the most constrained real case)
  was not specifically simulated — only landscape-alone and portrait-keyboard-open were.
- No automated test coverage for this (client has no test suite at all yet — see category
  39, which is server-only so far); every verification above is a one-off Playwright script,
  not a committed regression test.

---

### 43. Ultra-Low-Latency + Background Agent Architecture

**Status: PARTIAL — core architecture implemented, unit-tested, and verified live against real Gemini. Several explicitly-scoped-out items below (Redis/queue-based execution, voice/TTS mid-stream integration, the local computer-use agent) are NOT implemented — see "Explicitly out of scope."**

**Previous state:** Every chat request re-sent the entire conversation history to Gemini, unbounded — directly confirmed in `JENNY_RESPONSE_LATENCY_AUDIT.md` as the cause of a live-reproduced 1.46s → 1.25s → 2.03s → 12.78s latency climb across 4 messages. The grounding-availability probe ran lazily on the first real chat request, contending with it for the same process/API key. There was no persisted run state: a chat request lived and died with its one HTTP connection — a dropped connection meant the frontend had no way to know whether the reply still completed server-side (the audit found it usually did, but there was no way to check). No SSE heartbeat. No request/run IDs. No timing instrumentation. The app always opened to a blank "New chat" screen on reload, regardless of what was open before. No first-token timeout existed anywhere in the provider chain — a hung provider blocked indefinitely.

**Root cause (confirmed, not assumed):** Architectural, not provider-specific — the app trusted one HTTP connection to be both the trigger and the sole record of a chat turn's outcome, and sent the full transcript on every turn with no compression.

**Changes made:**

*Bounded context (server/src/services/contextManager.ts, new):*
- `buildContext()` sends only the last `CONTEXT_RECENT_WINDOW` (default 12) raw messages plus a rolling summary of everything older, instead of the full transcript.
- The summary is generated **asynchronously, after the response is sent** (`summarizeIfNeeded`, fire-and-forget) — it never blocks the request that triggered it. It only re-summarizes once the unsummarized gap reaches `CONTEXT_SUMMARY_BATCH` (default 5) messages, not on every turn, to bound the extra LLM-call cost this introduces.
- Honest limitation: the *first* request after a conversation crosses the window isn't compressed yet (the gap is sent raw, since nothing's been dropped) — compression takes effect starting the request after summarization catches up. Live-verified (see below): this produces a bounded sawtooth pattern (grows a few messages, drops back down, repeats) rather than either unbounded growth or a hard cap that could silently lose content.
- Fast path: `userHasDocuments()` and a trivial-greeting regex skip the local ONNX embedding pass and vector search entirely when they can't matter (no documents at all, or a bare "Hi"/"Thanks"/etc.) — real cost avoided, not merely deferred.

*Grounding probe (server/src/services/providers/gemini.ts):* `probeGroundingAvailability` renamed to `warmUpGemini`, moved from "runs lazily on the first real chat request" (still true after the earlier `c18b34a` fix that made it non-blocking, but it still *ran concurrently* with that first user request) to "runs once at server boot, before the process accepts traffic" (`index.ts`). No longer contends with any real request for the same process/API key.

*Provider router (server/src/services/modelRouter.ts, rewritten):*
- `attemptWithTimeout()` bounds how long a single attempt can produce **zero** output before the router gives up and moves to the next provider (`LLM_FIRST_TOKEN_TIMEOUT_MS`, default 15s) — an `AbortController` signal is threaded through every provider (`llmProvider.ts`'s `StreamOptions`, `openaiCompatible.ts`'s `fetch` signal, Gemini SDK's own `abortSignal`). Once real output starts streaming, no timeout applies — only silence is bounded.
- **Live-discovered bug, fixed in the same pass:** the first-token timeout initially counted toward the same circuit breaker as real provider errors. Measured directly against production Gemini with only one provider configured (today's actual `LLM_PROVIDER_CHAIN`): three consecutive slow-but-would-have-eventually-succeeded responses tripped the breaker and locked the *only* configured provider out for a full 30s cooldown, with nothing to fail over to — strictly worse than not timing out at all. Fixed: a timeout now only counts against a provider's health when a configured, healthy fallback actually exists to move to (`routeChatCompletion`'s `hasFallbackLeft` check). Verified both by re-running the exact live scenario that exposed it, and by two new unit tests (`modelRouter.test.ts`: "does NOT trip the circuit breaker on a timeout when there's no fallback" / "DOES trip... when a healthy fallback exists").
- Optional hedging (`LLM_HEDGE_ENABLED`, default `false`; `LLM_HEDGE_DELAY_MS`, default 4000): if the primary hasn't produced a first token within the delay, a second configured/healthy provider starts concurrently; whichever answers first wins, the other is aborted (best-effort — see the code comment on why `AbortSignal` doesn't guarantee the upstream request itself stops being billed). Resolves the instant a winner emerges rather than waiting for the loser too. **Known, documented limitation:** if the *winning* arm fails partway through after already streaming some output, that failure currently has no path back to the caller (the promise already resolved) — flagged in code rather than silently shipped as fully solved. Off by default; only does anything once a second real provider is configured (today's production is Gemini-only, so it's currently inert there).

*Persistent AgentRun architecture (server/src/services/agentRunStore.ts, chatRunner.ts, runBus.ts, routes/agentRuns.ts — all new):*
- New SQLite tables `agent_runs` (one row per chat turn's full lifecycle: `queued → running → streaming → completed/failed`, with `started_at`/`first_event_at`/`first_token_at`/`completed_at`/`last_heartbeat_at`) and `agent_events` (append-only per-run event log, autoincrement id used as a replay cursor) and `conversation_summaries`.
- `startChatRun()` does only synchronous SQLite writes (create the run row, save the user's message) — this is what lets the HTTP route acknowledge a request in single-digit milliseconds, before any model call starts. `executeChatRun()` then runs the actual generation **with no reference to the HTTP `res` object at all** — it persists to SQLite regardless of whether any client is still connected. This is the concrete mechanism behind "browser closed ≠ Jenny stopped": nothing about it depends on the connection surviving.
- `POST /api/chat` subscribes to the run's live events (`runBus.ts`, an in-process `EventEmitter` — explicitly documented as single-process, matching this app's existing single-Railway-instance SQLite deployment, same tradeoff already accepted by `providerHealth.ts`) and streams them as SSE, but the generation itself is `void`-detached from the request. A dropped connection stops this one response from continuing, not the run.
- `GET /api/agent/runs/:id` (current status/text/sources — used for recovery), `GET /api/agent/runs/:id/events?after=<id>` (event replay), `GET /api/agent/runs/active` (every run still in flight or finished-but-unseen, powers "Jenny finished while you were away"), `POST /api/agent/runs/:id/seen`.
- SSE heartbeat every `SSE_HEARTBEAT_MS` (default 10s) during idle generation gaps.
- Every event on the wire is one JSON object with a `type` discriminator (`run.started`, `agent.status`, `message.delta`, `heartbeat`, `done`, `error`) carrying `requestId`/`runId`/`conversationId` — threaded from the HTTP route through the router to structured `chat_timing` JSON log lines (provider used, fell-back, hedged, retrieval-skipped, context-built/first-token/total ms, history turns sent).

*Frontend recovery (client/src/lib/api.ts, useAgentRunRecovery.ts (new), ChatWindow.tsx, MainApp.tsx):*
- `sendChatMessage` rewritten around the typed event stream; `onRunStarted` captures the runId immediately.
- `recoverRun()` in ChatWindow: if the SSE connection itself errors, polls `GET /api/agent/runs/:id` (backoff up to ~13.5s) before showing a hard failure — reflects partial text as it arrives, applies the final result once the run reaches a terminal state.
- A second `visibilitychange`/`pageshow` listener proactively reconciles against the run's server-side state the instant the tab becomes visible again, specifically because iOS Safari can suspend a backgrounded tab's JS without ever surfacing a network error to the stream reader — the audit's own named background-then-return scenario.
- `activeConversationId` now persists to `localStorage` and restores on load — no more blank "New chat" on reload when a real conversation was open. On conversation load, checks for a run still active in that conversation (browser was closed mid-reply) and resumes watching it.
- `useAgentRunRecovery` checks `GET /api/agent/runs/active` on mount/visibility/online and surfaces a dismissible "Jenny finished while you were away" banner (MainApp.tsx) for conversations other than the one currently open.
- Escalating status text while a reply is still empty: "Thinking…" → "Still working…" (8s) → "This is taking longer than expected — I'm still working on it." (20s) → "Reconnecting…" (on a dropped connection) — `MessageBubble`'s existing thinking-dots indicator now carries an explanatory label instead of being an unexplained indefinite spinner.

**Files changed:** `server/src/db/index.ts`, `server/src/services/{agentRunStore,chatRunner,runBus,contextManager,llmProvider,llm,modelRouter,vectorStore,conversationStore}.ts`, `server/src/services/providers/{gemini,deepseek,ollama,openaiCompatible}.ts`, `server/src/routes/{chat,agentRuns}.ts`, `server/src/index.ts`, `server/.env.example`; `client/src/lib/{api,useAgentRunRecovery}.ts`, `client/src/components/{ChatWindow,MessageBubble,MainApp}.tsx`. New tests: `contextManager.test.ts` (11), `agentRunStore.test.ts` (6, against the real SQLite db, not mocked), plus 8 new/updated cases in `modelRouter.test.ts`.

**Tests performed:**
- `npm test` (server): **54/54 passing** (29 pre-existing + 25 new), `npx tsc --noEmit` clean on both server and client, `npm run build` clean on both.
- Live, against real production Gemini (not mocked), via a real signed-up test user and a running local server:
  - Simple message ("Hi", fresh conversation): first SSE event (ack) at **62-71ms**; first real token at **713-1214ms**; full response done at **718-1321ms**.
  - 5-turn conversation, realistic 10s human-like pacing: first tokens **713-990ms** throughout — no growth.
  - 16-turn conversation, 8s pacing, crossing the 12-message window: `historyTurnsSent` (from structured logs) climbed 1→3→5→7→9→11→13→15→17, then **dropped back to 15** once background summarization caught up, then climbed 17→19 and dropped again — the designed bounded sawtooth, directly confirming the audit's headline bug (unbounded linear growth) no longer happens.
  - Reconnect: started a request, read 3 SSE events, then forcibly cancelled the connection (simulating the app closing) — 2.5s later, `GET /api/agent/runs/:id` returned `status: "completed"` with the complete final answer, despite the client connection having been dead the whole time.
  - Discovered and fixed the circuit-breaker interaction described above via this same live testing, not merely reasoned about — see modelRouter.ts changes.
- **Honest gap:** live testing also surfaced real Gemini-side latency variance (several 15s+ first-token timeouts) under back-to-back rapid-fire requests against this specific dev API key; a follow-up test with 10s spacing showed consistent sub-1s responses, strongly suggesting this dev key's own request-rate quota, not this architecture, though the exact cause on Google's side wasn't independently confirmed. This is exactly the kind of upstream variance the architecture is now built to *bound and report* (15s max wait, structured logs, graceful failure message) rather than eliminate — consistent with the spec's own instruction not to fake a sub-1s guarantee a remote provider can't always honor.

**iOS-specific / real-device verification status:** NOT independently re-verified on physical hardware in this pass — the `visibilitychange`/`pageshow` reconciliation logic is new and, like the rest of this session's iOS keyboard work (section 42), needs real-device confirmation before being called VERIFIED for backgrounding specifically. Simulated via a deliberate connection-cancel in Node, which exercises the same recovery code path but is not proof of iOS's exact JS-suspension behavior.

**Explicitly out of scope in this pass (not implemented — flagged rather than silently skipped):**
- **Redis/queue-based background execution.** Not built. Not needed for the actual requirement: `executeChatRun` already runs independent of the HTTP response inside this single Node process, which is what makes "Chrome closed ≠ Jenny stopped" true today. A real job queue (Redis/BullMQ) would only start to matter if this app ever runs as more than one instance — `runBus.ts` and `providerHealth.ts` both document this same single-instance assumption explicitly.
- **Model complexity-based routing (cheap/fast vs. strong model tiers).** Not built — there is currently only one configured model per provider (`gemini-3.5-flash-lite`, already the fast/cheap tier), so there is nothing to route between yet. Would be a straightforward follow-up once a second tier is actually configured with real credentials, rather than speculative scaffolding now.
- **Voice/TTS mid-generation streaming** (send-to-TTS-as-text-arrives instead of waiting for the full reply). The existing voice pipeline (`speak.ts`, `useVoiceConversation.ts`) is unchanged — it still waits for `onDone`. A real implementation needs incremental TTS chunking most cleanly, which is a separate, non-trivial feature.
- **Local Windows computer-use agent.** No such agent exists to integrate with in this environment — the AgentRun schema is generic enough (`agent_runs`/`agent_events`, not chat-specific field names) to plug a future one into, but that's extensibility, not an implementation.
- **Event replay actually consumed by the frontend.** `GET /api/agent/runs/:id/events?after=` exists and is tested server-side, but the client currently recovers via the simpler full-state `GET /api/agent/runs/:id` rather than incremental replay — sufficient for today's UI, listed here for completeness against the spec's own acceptance list.

**Remaining limitations:**
- DeepSeek fallback and hedging remain code-complete-but-unverified against a real DeepSeek API key in this environment (still no real key configured anywhere here, same gap noted in section 4) — verified only via mocked unit tests.
- The hedge-mode "winner fails mid-stream" gap noted above.
- No automated test drives the actual HTTP/SSE route end-to-end (`chat.ts`/`agentRuns.ts`) — the live testing above exercised it manually via a real server process, not as a committed regression test.

---

### 44. Guest Mode (No Login Wall, Gated After 10 Prompts)

**Status: VERIFIED — implemented and confirmed live, end to end, against a local server with the real production code path.**

**Previous state:** Every route except `/health`, `/api/auth/*`, `/api/errors`, `/api/admin` required a valid session (`requireAuth`); `RequireAuth.tsx` redirected anyone without one straight to `/login`. There was no way to use Jenny at all without creating a full account first.

**Changes made:**
- **Guest accounts are real `users` rows**, not a separate parallel system — `is_guest INTEGER NOT NULL DEFAULT 0` added to the schema (`db/index.ts`), `createGuestUser()` (`userStore.ts`) inserts one with a synthetic unusable email/password (same pattern already used for Google sign-ins' unusable password hash) and a real session via the existing `sessions` table. Because it's a normal user row, every existing user_id-scoped query — conversations, messages, documents, agent_runs — works for a guest with zero special-casing anywhere else in the codebase.
- `POST /api/auth/guest` (rate-limited via the existing `sensitiveLimiter`) creates one and returns a token exactly shaped like signup/login's response. `AuthContext.tsx` calls this automatically on first visit whenever `fetchMe()` comes back empty — a brand-new visitor lands directly in a working chat, no login wall. The guest's token persists in `localStorage` the same way a real login's does, so it's the *same* guest identity (and their history) on every later visit — not a fresh one each time.
- **Prompt gate:** `chat.ts` checks, before creating any run or message, whether the requester `isGuest` and has already sent `GUEST_PROMPT_LIMIT` (default 10, env-configurable) user turns total across every conversation they own (`countUserMessages`, a real `COUNT(*)` query — not a client-trusted number, so it can't be bypassed by resending a stale count, and it's a total across conversations, not per-conversation, so starting a new chat doesn't reset it). Past the limit: `403` with `{ error, code: "guest_limit_reached" }`, checked *before* the user's message is ever persisted — a blocked attempt leaves no phantom row behind.
- **Upgrade preserves history by construction, not by migration:** `POST /api/auth/upgrade` (authenticated) updates the *current* guest's row in place — same `id`, same session token — setting a real email/password/name and flipping `is_guest` to 0, rather than creating a new account and copying data over. Every conversation/message already foreign-keyed to that user id is simply already there afterward. Live-verified: upgraded a guest after 10 messages, confirmed `user.id` unchanged, confirmed the same session token kept working with zero re-login, confirmed the original conversation (with all its messages) was still visible via `GET /api/conversations`, and confirmed the 11th message — previously blocked — went through immediately after upgrading.
- Frontend: `ChatWindow.tsx` catches the `guest_limit_reached` `ChatError` (a new typed error class in `api.ts`, threading the server's `code` field through instead of string-matching a message), rolls back the optimistic user/assistant bubbles that were never actually sent, restores what the user typed, and opens `GuestLimitModal.tsx` — a compact inline signup form wired to the upgrade endpoint. `Sidebar.tsx` shows a proactive "You're chatting as a guest — sign up to save your chats" prompt instead of a logout button for a guest (logging out a guest would orphan their history with no way back in, since they never set real credentials) — same modal, opened manually rather than by hitting the limit.
- A guest who instead navigates directly to `/signup` (bypassing the modal) gets the pre-existing signup behavior: a brand-new, separate account — their guest history does **not** carry over that path. This is an accepted, documented limitation, not an oversight; the modal is the one path that preserves history, and it's the one surfaced by both entry points (limit-hit and the sidebar prompt).

**Files changed:** `server/src/db/index.ts`, `server/src/services/auth/userStore.ts`, `server/src/services/conversationStore.ts`, `server/src/routes/{auth,chat}.ts`; `client/src/lib/{auth,AuthContext,api}.ts`, `client/src/components/{Sidebar,ChatWindow,MainApp}.tsx`, `client/src/components/GuestLimitModal.tsx` (new).

**Tests performed:** `npx tsc --noEmit` clean (server + client), `npm run build` clean (server + client), server test suite still 54/54 (no regressions — no new unit tests were added specifically for the gate/upgrade routes; verification here is a real end-to-end run instead, see below, consistent with this app's existing gap that `chat.ts`/`auth.ts` have no automated route-level test coverage yet). Live, against a real local server (not mocked): created a guest, sent 12 messages in the same conversation, confirmed messages 1-10 succeeded and 11-12 were blocked with exactly `403`/`guest_limit_reached`, confirmed `/me` still reported `isGuest: true` right up to the upgrade call, upgraded with a real email/password, confirmed the user id was unchanged, confirmed the same bearer token kept working with no new login, confirmed the original conversation and its messages were still there, confirmed sending was unblocked immediately after upgrading, and confirmed a second brand-new guest got a fully independent id/limit (the gate is per-account, not global).

**Remaining limitations:**
- No automated regression test exists for the gate/upgrade routes themselves (see above) — only the live manual run.
- No "upgrade via Google" path — only email/password. A guest can still use the existing Google sign-in, but that creates a separate account rather than upgrading the current guest in place.
- The synthetic guest email (`guest-<uuid>@guest.jennysol.local`) is never sent anywhere and never needs to be — flagged here only so it's not mistaken for a real address if ever seen in the admin panel's user list.
- `GUEST_PROMPT_LIMIT` is a soft gate: a determined user can always clear `localStorage` and get a fresh guest with a new 10-message allowance. This was a deliberate scope decision (an anonymous product surface can't have a hard paywall without real bot-detection work, which wasn't asked for here), not an oversight — flagged so it isn't mistaken for one.

---

### 45. Empty-Response Hang (Live Production Incident)

**Status: VERIFIED — root-caused from real production logs, fixed, and confirmed live.**

**Reported symptom:** user sent "Do u know this guy named Syam Prabhakar", Jenny replied "Let me look that up real quick... (Running a search)" and then never responded again — confirmed stuck for 3+ minutes across multiple follow-up messages, screenshots provided.

**Root cause (confirmed via production `chat_timing` structured logs, not guessed):** the exact turn's log line read `[router] gemini ok` with no `firstTokenMs` — proof Gemini's stream resolved **successfully, with zero text output**, no exception thrown anywhere. Nothing in the code was watching for "succeeded but produced nothing," so `chatRunner.ts` persisted an empty assistant message and emitted `done` as if everything were fine. Separately, `MessageBubble.tsx`'s empty-content branch always showed the "thinking" dots regardless of whether the message was still streaming or had already finished — so a legitimately-empty completed message was visually indistinguishable from one still stuck generating, which is what made this look like an infinite hang rather than a bad-but-finished reply.

**Contributing factor:** the system persona told the model it "has a Google Search tool available" without qualifying that this is only true on some turns — the model narrated "let me search"/"running a search" (which the persona already explicitly told it not to do) even on turns where no tool was actually attached, then apparently attempted a function-call-shaped response instead of text, producing nothing.

**Fixes:**
- `gemini.ts`: when a stream resolves with zero deltas sent and no error, retry once forcing plain text (no tool) — mirrors the existing 503-retry pattern already in this file.
- `chatRunner.ts`: guaranteed non-empty reply as a provider-agnostic safety net — if `fullReply` is still empty after the model call resolves, substitute a plain "I wasn't able to put together an answer for that one — mind trying again?" before persisting/marking complete, so a "done" event can never carry zero content.
- `llm.ts`: persona rewritten to explicitly say the search tool is only attached "on some turns (not every one)," to never narrate the act of searching, and to say plainly "I'm not sure" rather than claim it's about to check.
- `MessageBubble.tsx`: the thinking-dots animation now only renders while `streaming` is actually true; a finished message with empty content shows "No response." instead — fixes both new occurrences and any already-saved historical empty messages from before this fix.

**Verified live in production**, post-deploy: resent a message pattern designed to reproduce the original trigger ("Do you know a guy named Syam Prabhakar" → "Yea sure please let me know once you are done"). The second message — same shape as the one that hung in the original report — took 11,959ms (internal retry visibly firing) but returned a real, honest answer ("It looks like there's no search tool attached to this chat right now... I don't have enough public info on Syam Prabhakar"). All four messages in the test sequence returned real content; `firstTokenMs` was non-null in the logs for every one, where the original incident showed `null`.

**Remaining limitation:** the underlying model behavior (attempting a function-call-shaped response with no tool attached) is not something this codebase can prevent outright — the fix bounds and recovers from it, it doesn't guarantee it can never happen a third time in a row (retry-once, not retry-forever, by design, to avoid an unbounded latency tax on every message). No automated regression test was added for this specific empty-stream scenario — verification here is the live production reproduction above.

---

### 46. Multi-Agent Orchestration (docs/AI_AGENT_IMPLEMENTATION_PLAN.md — running log, extended per phase)

**Status: VERIFIED — Phases 1-2 live and tested, full suite green. Rest of this entry is extended in
place as each further phase lands, per that plan's own "do not fake autonomy" discipline: this log
only ever describes what's actually running, never what's designed but not yet built.**

#### Phase 1 — Session data model

**Status: VERIFIED — schema live, store module tested (11/11).**

New SQLite tables, same `CREATE TABLE IF NOT EXISTS` convention as everything else in `db/index.ts`,
generalizing the existing `agent_runs`/`agent_events` pattern from one chat turn to a whole
multi-agent session (see `docs/AI_AGENT_SYSTEM_ARCHITECTURE.md` §5 for the full design rationale):

- `agent_sessions` — one row per multi-agent session (`planning|running|paused|completed|cancelled|failed`),
  with hard budget caps (`max_session_time_ms`, `max_token_budget`, `max_cost`, `max_agent_count`,
  `max_concurrent_agents`) the Phase 6 Resource Manager will enforce. Deliberately **not** named
  `sessions` — that name is already the auth-session table (`services/auth/sessions.ts`); grepped
  every raw `sessions` reference in `server/src` before closing this phase to confirm zero collision.
- `session_memory` — one row per top-level `SessionMemory` key (`session_id, key` composite PK), not
  one JSON blob, so one agent can update one section without a read-modify-write race on the whole
  object.
- `agents` — a logical agent: one row, no model loaded and no process started until a scheduler
  (Phase 6, not built yet) grants it an execution slot. `current_task_id`/`tokens_used` tracked per
  row.
- `agent_tasks` — the task DAG. `depends_on` is a JSON array of other `agent_tasks.id` values (edges);
  readiness resolution and cycle detection are Phase 3, not this phase — this phase only stores the
  edges as given.
- `agent_session_events` — generalizes `agent_events`' append-only/replay-by-id pattern to session
  scope; the sole source of truth the Phase 13 live dashboard will ever render from. Writer/reader
  functions are Phase 4, not built yet — only the table exists so far.
- `file_locks`, `user_decisions` — tables only; CRUD lands in Phase 7 and Phase 14 respectively.

`server/src/services/agentSessionStore.ts` (new) mirrors `agentRunStore.ts`'s exact shape for the
three pieces Phase 1 actually owns: session create/read/list/status, `session_memory` get/set/list,
and `agent_tasks` create/read/list/status — every read scoped by owner (`getSession(userId, id)`) or
by session (`getTask(sessionId, taskId)`) the same way `agentRunStore.getRun(userId, runId)` already
is, proven by an explicit cross-session-leakage test, not assumed from the WHERE clause alone.

**Two real bugs found by running the tests, not assumed away:**
1. `listSessionsForUser`/`listTasksForSession` ordered by `created_at` (`datetime('now')`, second
   resolution) alone — two rows created within the same second sorted arbitrarily. Fixed with a
   `rowid` tiebreaker (SQLite's own monotonic insertion-order column, free on every rowid table).
2. `updateTaskStatus`'s test passed a fake `agentId` that didn't exist in `agents` — `agent_tasks.agent_id`
   has a real FK to `agents(id)` (`foreign_keys` pragma is `ON` for this whole DB), so the write
   correctly rejected it. Not a bug in the store — fixed the test to insert a real `agents` row
   first, the same way `agentRunStore.test.ts` inserts a real user/conversation row rather than
   faking one.

**Also corrected in this pass** (found by inspection before Phase 7 needed it, not assumed):
`docs/AI_AGENT_SYSTEM_ARCHITECTURE.md` §2 previously claimed `toolRegistry.ts`/`pendingActions.ts`/
`agentAuditLog.ts` were directly reusable for internal agent tool calls. They're hard-wired to
`ProductIdentity` (Arena-style external callers, per ADR-002) — `client/src/pages/Agents.tsx`'s own
existing comment already said reusing them internally would be exactly the cross-boundary shortcut
this codebase guards against elsewhere. Corrected both architecture and plan docs: Phase 7 builds a
small, new `agentToolRegistry.ts` keyed by `(sessionId, agentId)` instead, reusing only the
`redactSecrets()` function, not the cross-product table/approval map.

#### Phase 2 — Agent registry

**Status: VERIFIED — 7/7 tests pass, full suite green (443/443), tsc clean.**

`server/src/services/agentRegistry.ts` (new): CRUD over the `agents` table plus the role ->
capability -> default-permission catalog (`ROLE_CATALOG`) covering all 14 roles named across the
founding directive and the architecture doc (Orchestrator, Architect, Coder, QA, Security,
Performance, Code Reviewer, Product Analyst, UX, UI, Backend, Database, Visual QA, Final Judge).
Each role's `defaultTaskCapability` is one of `modelRegistry.ts`'s own existing `TaskCapability`
values (`general`/`coding`/`reasoning`) — reused directly, not a new routing concept, so Phase 5's
`runAgentTask()` can route any agent's model call through the exact same `routeChatCompletion()`
capability hint chat already uses today.

`spawnAgent(sessionId, role)` is pure logic — one row insert, no model call, no provider module
import. Proven, not just asserted: spawning 50 agents in a single test completes in well under the
500ms bound asserted (real 50-agent model calls would never fit there), which is the concrete,
ongoing regression guard for the architecture's central "many logical agents, few concurrent model
executions" claim (§6).

`hasPermission(agent, permission)` exists and is tested, but — stated plainly, per this phase's own
audit requirement — is **not wired into any real dispatch path yet**. There is no dispatch path yet:
Phase 7's `agentToolRegistry.ts` is the real enforcement point. Recorded now so the `permissions`
column is never merely a decorative JSON field even before that phase lands.

Role -> capability -> default-permission table (this phase's documentation deliverable):

| Role | Task capability | Default permissions |
|---|---|---|
| orchestrator | reasoning | memory:write_any, task:create |
| architect | reasoning | file:read, memory:write_any |
| coder | coding | file:read, file:write, exec:command |
| qa | reasoning | file:read, exec:command |
| security | reasoning | file:read, exec:command |
| performance | reasoning | file:read, exec:command |
| code_reviewer | coding | file:read |
| product_analyst | general | file:read |
| ux | general | file:read |
| ui | coding | file:read, file:write |
| backend | coding | file:read, file:write, exec:command |
| database | coding | file:read, file:write, exec:command |
| visual_qa | general | file:read, exec:command |
| final_judge | reasoning | memory:write_any |

#### Phase 3 — Task DAG

**Status: VERIFIED — 13/13 tests pass, full suite green (456/456), tsc clean.**

`server/src/services/agentTaskDag.ts` (new): `createTask` (single, existence-checked),
`createTaskBatch` (atomic multi-task insert with real cycle detection), `readyTasks(sessionId)`
(pure, read-only).

Real design decisions made and recorded here, not deferred silently (this phase's own documentation
requirement):

- **"ready" is a computed label, never a persisted status value.** `readyTasks()` reads currently-
  persisted rows and returns 'pending' tasks whose every dependency is 'completed' — nothing writes
  'ready' into `agent_tasks.status`. The Phase 6 Scheduler calls this each tick and writes 'queued'
  directly the moment it actually grants a slot. This is what keeps the function genuinely
  side-effect-free rather than a status that goes stale the instant a sibling task completes.
- **A task with a failed/cancelled dependency blocks forever, silently, on purpose — for now.** It's
  simply never returned by `readyTasks()` and is not auto-failed itself. Reopening it is the Phase
  11/12 correction-task mechanism's job (a new corrective `agent_tasks` row), out of this phase's
  scope — recorded now so it's a decision, not a gap discovered later.
- **Cycle detection is a batch-level concern, not a single-insert concern**, and this is structural,
  not a shortcut: `agent_tasks.id` is always server-generated at insert time, so a single new task
  can only ever add a new sink to an already-valid DAG — it cannot complete a cycle. Real cycle risk
  only exists when several not-yet-persisted tasks reference each other within one batch (exactly
  the Orchestrator's own decompose-into-many-tasks-at-once case, Phase 9) — `createTaskBatch()` runs
  Kahn's algorithm over the batch's local ids and rejects the *entire* batch (nothing partially
  inserted) on any cycle, self-dependency, or reference to an unknown id.

Tested directly against the founding directive's own §9 worked example as a literal fixture
(TASK-006 depending on TASK-004+TASK-005; TASK-012 depending on six upstream tasks), plus explicit
self-dependency, 2-node cycle, 3-node cycle, and unknown-reference rejection cases — each asserting
the whole batch inserts nothing, not just that the throw happens.

#### Phase 4 — Event bus (session-scoped)

**Status: VERIFIED — 7/7 tests pass, full suite green (463/463), tsc clean.**

`server/src/services/sessionEventBus.ts` (new): `appendSessionEvent()` (durable-first — writes
`agent_session_events`, then publishes to an in-process `EventEmitter` keyed by `sessionId`, never
the reverse order), `subscribeToSession()`, `getSessionEventsAfter()` — the exact same shape as
`agentRunStore.appendEvent`/`runBus.ts`, one level up, generalized from run scope to session scope.
Same single-process caveat already honestly documented for `runBus.ts` (would need Redis pub/sub if
this ever runs as more than one instance — not needed today, see architecture doc §4).

The real, implemented event taxonomy (this phase's documentation deliverable — the actual list, not
the founding directive's illustrative one verbatim): `session.created`, `session.status_changed`,
`task.ready/started/progress/completed/failed`, `agent.spawned/status_changed`,
`tool.exec.started/finished`, `file.locked/changed/unlocked`, `memory.updated`,
`checkpoint.started/completed`, `decision.raised/answered`, `audit.started/result`.

**The two properties this phase's own audit specifically demanded, both proven by a real test, not
assumed:**
- **Durable-first ordering**: a live subscriber's handler queries the DB synchronously from inside
  the callback and confirms the row already exists — proves the write happens before the publish,
  not just that both happen.
- **Zero subscribers never drops an event**: one test kills the session's only live subscriber
  mid-session, appends two more events, and confirms both still land durably (`getSessionEventsAfter`
  sees all three; the dead subscriber only ever saw the first). A second test never attaches a
  subscriber at all and confirms events still accumulate. This is the concrete, ongoing regression
  guard for architecture doc §3's "fake autonomy" defense — the event log, not the emitter, is truth.

Also proven: a late subscriber's DB replay is byte-for-byte identical (type, payload, id) to what a
live subscriber saw in real time for the same sequence — the literal test this phase's build note
asked for.

#### Dashboard shell (pulled forward from Phase 13 — see plan doc's "Sequencing decision")

**Status: VERIFIED — real end-to-end, not a health probe: inserted a real session/agent/task/memory
entry/2 events directly via the service layer, then confirmed all three new admin routes return
correct shapes over real HTTP with real auth; 401 (no token), 403 (non-admin token), 404 (unknown
session id), and 200s all confirmed live, not assumed.**

**Correction found before building (not assumed): the dashboard does NOT land on
`client/src/pages/Agents.tsx`/`Tasks.tsx`** as the architecture doc originally said. Those are
`RequireAuth`-only consumer routes with real, unrelated existing content (planned JennySol product
agents — Research, Travel planning, etc.; Tasks.tsx is a user's own scheduled work) — putting an
internal engineering-ops dashboard there would show it to every regular signed-in user. Corrected:
built at `client/src/pages/admin/AgentSessions.tsx` (list) + `AgentSessionDetail.tsx` (one session),
under `/admin` (`RequireAdmin`-gated, same as `AdminDashboard.tsx`), linked from `AdminLayout.tsx`'s
nav. New server routes, admin-only: `GET /api/admin/agent-sessions`, `GET
/api/admin/agent-sessions/:id`, `GET /api/admin/agent-sessions/:id/events` — added
`getSessionUnscoped()`/`listAllSessions()` to `agentSessionStore.ts` for this (admin needs to see
every session regardless of owner, unlike every other user-scoped read in this store).

List view renders a real, honest empty state ("no engineering sessions yet — this is honest, not a
stub") since no phase before 9 can produce a session worth creating. Detail view polls
`GET .../events?after=` every 3s (not SSE yet — that's real remaining work, deliberately deferred to
Phase 13 proper per the plan doc's sequencing note) and re-fetches the session/agents/tasks/memory
snapshot whenever new events arrive, rather than deriving state from event payloads client-side —
the same "event log is truth" discipline as everywhere else in this system.

**Real operational finding surfaced while verifying this** (recorded since it matters beyond this
phase): port 8787 is currently held by `in.vikisol.jennysol-server`, a real macOS LaunchAgent running
compiled `dist/index.js` — this is the actual local-production server from the earlier
Tailscale/railtail mission (LOCAL-INFRA.md), auto-restarting via `launchd`'s `KeepAlive`. A stale
process from that same LaunchAgent (started 2026-09-11, i.e. a launch that predated this session)
was squatting on `127.0.0.1:8787` specifically while this session's own `npm run dev` bound the
wildcard `*:8787` — both listen calls silently succeeded (no `EADDRINUSE`), and all `localhost`
traffic was actually reaching the two-day-stale process, not the fresh one, until this was noticed
via a request-metrics route that should have existed and didn't. That stale instance was killed;
`launchd` immediately respawned a fresh one (same compiled `dist/index.js`, unrelated to tonight's
source changes) and it was confirmed healthy (`/health` → 200) before moving on. All further
verification for this phase ran on an isolated port (8788) specifically to never contend with this
real service again. **Flagging for the founder**: if a future session's local `curl`/dev-server
testing against "localhost" ever behaves unexpectedly, check `lsof -nP -iTCP:8787` first — this
LaunchAgent will answer for that port whether or not it holds the answer you expect.

#### Phase 5 — LLM provider abstraction touch-point

**Status: VERIFIED — 4 mocked tests + 1 genuinely live, unmocked test against this Mac's real local
Ollama, all passing. Full suite 468/469 (1 correctly skipped when Ollama isn't reachable — see
below). tsc clean.**

`server/src/services/agentTaskRunner.ts` (new): `runAgentTask(sessionId, taskId)` — exactly the one
integration function this phase calls for. Nothing new in the provider layer; it assembles a system
prompt from the agent's declared memory read-scope (`MEMORY_READ_SCOPE`, this phase's own
documentation deliverable — a table of which `session_memory` keys each of the 14 roles reads) and
calls the *existing* `routeChatCompletion()`, the same function every chat message already goes
through. Writes real `task.started`/`task.completed`/`task.failed` events and updates task/agent
status accordingly. A failed/all-providers-unavailable call marks the task `failed` with the real
error attached (tested directly, not assumed) — never silently retried or swallowed.

**The live-fire test** (this phase's own stated bar — "the first phase with something genuinely
worth a live-fire test"): unmocked, real network call to this Mac's actual local Ollama instance,
gated behind a runtime reachability check (`describe.skipIf`) so it participates when deliberately
pointed at a reachable Ollama and skips loudly (with a console warning naming the URL it tried)
everywhere else — including plain `npm test`, since `OLLAMA_BASE_URL` isn't exported to the shell by
default. Two real things surfaced while getting this test to pass, both handled honestly rather than
by loosening what they'd expose in production:
- **Cold-start latency really did exceed the 2500ms local budget**, twice in a row, on this actual
  Mac while writing this test. This is not a new bug — it's the same already-documented,
  already-decided tradeoff from the earlier local-cutover work (production has a live keep-warm
  prober specifically because of this; an isolated one-off test process doesn't). The test widens
  `LLM_LOCAL_FIRST_TOKEN_TIMEOUT_MS` to 20s **for its own process only**, restored immediately after,
  with a comment explaining why re-litigating that production number isn't this test's job.
- Confirmed live: once actually warm, real first-token latency was 373ms then 211ms — consistent
  with the number this codebase already had on record.

**Noted, not acted on**: this live test shares the same single real Ollama instance as the actual
`in.vikisol.jennysol-server` LaunchAgent (§ above) — running it is only safe as an occasional,
deliberate check (as done here), not wired into routine CI-style runs, to avoid contending with real
production traffic for the one local concurrency slot.

#### Phase 6 — Scheduler + Resource Manager

**Status: VERIFIED — 8/8 tests pass, full suite 476/477 (1 correctly-skipped live test unaffected),
tsc clean.**

`server/src/services/agentScheduler.ts` (new): `tick(sessionId, executor?)` — one iteration of the
Scheduler loop (architecture doc §6): find `readyTasks()` (Phase 3) with an agent already assigned,
ask the Resource Manager for a slot, and only once granted, transition the task `pending -> running`
and dispatch it (default `executor` is the real `runAgentTask`, injectable for tests). The Resource
Manager itself is a global (not per-session) counter — the real constraint it protects
(`HardwareProfile.maxConcurrentLocalRuns`, today 1 on this Mac) is machine-wide, the same reasoning
`providers/ollama.ts`'s own existing gate already uses, generalized here to arbitrate every
agent-task execution rather than just Ollama's.

**Proven, not assumed, with a controllable executor that reports real-time concurrency** (not a
count asserted after the fact): 5 ready tasks against a 2-slot limit dispatch exactly 2, the other 3
stay genuinely `pending`; a slot freeing up is picked up by the next-highest-priority remaining task
on the very next tick; two different sessions correctly compete for the *same* global slot pool
(one session taking the only slot leaves nothing for the other, regardless of which asked first).
Priority ordering (`priority` desc, then FIFO) and the "no agent assigned yet -> never dispatched"
boundary (agent assignment stays Phase 9's job) are both tested directly.

**Real budget enforcement, and one honestly-unenforced field:**
- `max_session_time_ms` and `max_token_budget` are enforced for real, computed from actual data
  (real elapsed wall-clock time since `created_at`; the real sum of `agents.tokens_used`) — a session
  over either limit stops granting slots and transitions to `paused` with a real
  `session.status_changed` event (`reason: "budget_exceeded:tokens"` or `"...time"`), tested to fire
  exactly once, not once per tick.
- **`max_cost` is accepted and stored (Phase 1's schema) but NOT enforced.** No $/token pricing table
  exists anywhere in this codebase (confirmed by inspection — `COST-BASELINE.md` tracks token counts
  and fallback rates, not real prices). Inventing a number here would be exactly the kind of guessed
  figure this engagement has avoided everywhere else. Recorded as a real, open gap for whenever real
  cost tracking is built, not silently skipped.

**Real measured number, and the scope decision behind it** (this phase's own documentation
requirement): on this Mac (`m1_16gb` profile), the real, current concurrency ceiling is **1** —
confirmed by `getHardwareProfile().maxConcurrentLocalRuns`, unchanged from the existing,
already-tuned value. This scheduler applies that same single number as the admission bound for
**every** task regardless of whether it will ultimately route to a local or cloud model — a
deliberate simplification, not an oversight: which provider a task's call will actually use is only
resolved inside `routeChatCompletion()` at call time (chain fallback, live health), so the Scheduler
cannot know in advance which of a batch of ready tasks will be cloud-routed and could safely run with
higher real concurrency. The safe, conservative choice made here is one global bound sized to the
most constrained resource (local); the plan's own text anticipated this exact question ("cloud-routed
tasks change the real achievable concurrency") — splitting the pool by provider is real future work,
not required to prove out this phase's core claim, and is flagged here rather than built
speculatively ahead of a real multi-role session (Phase 9) that would actually exercise it.

#### Phase 7 — Tool system integration

**Status: VERIFIED — 6 (locks) + 10 (tool registry) = 16/16 new tests pass, full suite 492/493 (1
correctly-skipped live test unaffected), tsc clean.**

Two new modules, both new/parallel to the existing cross-product tool system per the corrected §2 —
never built on `toolRegistry.ts`/`pendingActions.ts`:

- `server/src/services/agentFileLocks.ts`: `requestLock(sessionId, filePath, agentId)` returns
  `{outcome: "acquired"|"wait", granted: Promise<void>}` — an uncontended path/re-entrant request
  acquires immediately; a contended one gets the real `"wait"` outcome plus a real `file.locked`
  (`status: "wait"`) event, and its `granted` promise resolves only once the current holder actually
  calls `releaseLock()`. **The locking state machine** (this phase's documentation requirement):
  `UNLOCKED -> held by agent A` (on request) `-> {released -> UNLOCKED | requested by agent B while
  held -> B enters WAIT -> A releases -> transferred to B, A's slot is now UNLOCKED}`. Proven directly
  — the literal §12 test: two agents request the same path, the second gets `"wait"`, its promise is
  observably still unresolved before the release and resolves only after; a 3-waiter queue is granted
  in request order, not arbitrarily.
- `server/src/services/agentToolRegistry.ts`: `readFile()` (READ tier, executes immediately, gated
  on `hasPermission(agent, "file:read")`) and a real `proposeAgentAction`/`approveAgentAction`/
  `rejectAgentAction` WRITE-tier flow for `file.write` (same propose-approve-execute *shape* as
  ADR-004, new/parallel code) — the actual write function is module-private, reachable only through
  `approveAgentAction()`, so a WRITE structurally cannot bypass approval. Every file tool is confined
  to a resolved `WORKSPACE_ROOT` (this repo's root by default, overridable via
  `AGENT_WORKSPACE_ROOT` for tests only) — a path that would resolve outside it is refused before
  touching the filesystem, tested directly with a `"../../../etc/passwd"`-shaped path. Errors are
  redacted through the *existing* `redactSecrets()` (the function, not the cross-product table) before
  ever being written to an event.

**Audit boundary, verified as strongly as this table allows**: a real approved file write was
confirmed to leave `agent_audit_log`'s total row count completely unchanged (not just one query
shape returning empty) — internal agent tool calls produce `agent_session_events` rows exclusively,
never touching the cross-product audit table, which stays reserved for real product-connector
traffic.

**Test isolation note**: `agentToolRegistry.test.ts` runs against a throwaway `mkdtempSync` directory
(never this repo's own tree) — `AGENT_WORKSPACE_ROOT` must be set synchronously before that module's
dynamic import, since the workspace root is resolved once at that module's own load time; a
`beforeAll()` hook would run too late to affect it (caught while first writing this test).

#### Phase 8 — Code execution (command running, output capture)

**Status: VERIFIED — 8 (command tool) + 2 (propose/approve integration) = 10 new tests, full suite
502/503 (1 correctly-skipped live test unaffected), tsc clean.**

`server/src/services/agentCommandTool.ts` (new): `executeCommand(sessionId, agentId, cwd, command,
args)` — real process execution via `execFile` with an argv array, **never** a shell string, so
shell-metacharacter injection has no grammar to exploit (tested directly: an argument containing
`"; id; echo pwned"` is passed to npm as one inert literal string, not interpreted). Routed through
the exact same `proposeAgentAction`/`approveAgentAction` gate as `file.write`
(`agentToolRegistry.ts`, extended this phase) — a command is at least as consequential as a file
write and gets the identical approval discipline.

**The exact allow-list/bounding rules** (this phase's own documentation requirement, a real security
surface per the founding directive's §36/§37):
- **Binary + first-subcommand allow-list**, not a blocklist: `npm` → `test`/`run`/`install`/`ci`/
  `--version`; `node` → `--version`. Anything else (a different binary, or an allowed binary with an
  unlisted subcommand) is refused before a process is ever spawned.
- **cwd confined to the same `WORKSPACE_ROOT`** every file tool respects (`agentWorkspace.ts`,
  extracted out of `agentToolRegistry.ts` this phase into its own module so both tools enforce one
  shared boundary rather than two copies that could drift).
- **Hard bounds**: 30s wall-clock timeout, 100KB captured-output cap per stream (truncated, flagged
  `stdoutTruncated`/`stderrTruncated`, never silently cut with no indication).
- **A real non-zero exit (a failing test suite) resolves normally** with the real exit code — it is
  not thrown as a JS error. Only a genuine execution failure (unknown binary, timeout) leaves
  `exitCode: null`. Tested directly: a fixture whose `npm test` exits 1 comes back as a normal,
  inspectable result, not a caught exception.

**A real gap found by reading the redaction utility's actual code before trusting it — not assumed,
per this phase's own explicit audit instruction ("don't just trust the redaction utility works here
because it works elsewhere")**: `memoryScope.ts`'s `redactSecrets()` only replaces a **string value**
when the **entire** string is a bare JWT-shaped token — it does nothing for a secret embedded inside
a larger blob (a `.env`-style `KEY=value` line, an `Authorization: Bearer ...` line buried in real
command output). Using it as-is on captured stdout/stderr would have been exactly the false
confidence this instruction warned against. **Fix**: a new, purpose-built `redactOutputText()`
inside `agentCommandTool.ts` — substring-level scrubbing (a secret-labeled line's value, any
JWT-shaped substring anywhere in the text) applied specifically to command output, leaving
`memoryScope.ts` itself unmodified since its existing callers all pass structured objects and are
unaffected. Verified directly: a fixture command that echoes a fake `API_KEY=sk-fake-secret-...`
comes back with the value replaced with `[redacted]` in both the returned result and the real
`tool.exec.finished` event payload (which now includes captured stdout/stderr, redacted and
size-bounded, since architecture doc §8's dashboard design renders the command panel directly from
this event — added after noticing the original draft omitted it, which would have made the
redaction test meaningless since there'd have been nothing in the event to redact).

#### Phase 9 — Parallel agents (the first 4 real roles)

**Status: VERIFIED — 11 mocked tests + 1 genuinely live, fully unmocked end-to-end run (real
Orchestrator → real Architect → real Coder → real QA, on this Mac's real local Ollama), all passing.
Full suite 513/515 (2 correctly-skipped live tests unaffected), tsc clean. This is the first phase
where the whole stack — Phases 1-8 together — actually ran as one real system, not separately.**

`server/src/services/agentRolePrompts.ts` (new): real system prompts for Orchestrator, Architect,
Coder (QA gets a documented contract, not a prompt — see below), each with an explicit output-format
contract. `server/src/services/agentJsonExtract.ts` (new): shared, honest JSON parsing for model
output (strips markdown fences, falls back to extracting the first balanced block, throws a real,
named error — never returns an empty/fabricated result on a genuine parse failure).
`server/src/services/agentOrchestrator.ts` (new): `decomposeObjective()` — the founding directive's
own §9 worked example made real: one live LLM call, real JSON parsing, one agent spawned per role
actually referenced, a real `createTaskBatch()` insert (Phase 3's cycle detection sitting
underneath, unmodified). `runRoleTask()` — the per-role dispatcher: Architect and Coder run through
the existing `runAgentTask()` (Phase 5, extended this phase with an optional `systemPromptOverride`
+ `onComplete` hook — backward compatible, its own original tests unchanged); **QA never calls an
LLM at all**, by design (architecture doc §9/§12: a verdict must cite real evidence, never a model's
own unverified claim) — it runs a real command through the exact Phase 7/8 propose/approve gate and
reports PASS/FAIL from the real exit code.

**The live end-to-end run — three real attempts, each a genuine finding, not scripted to succeed:**
1. First attempt timed out at 120s. Real cause: `deepseek-r1:7b`'s "thinking" mode took **30.6
   seconds** for a single first real content token on this Mac — a real, honest characteristic of a
   real local reasoning model doing real multi-step work, not a bug. Widened the test's own timeout
   to 300s (this test's job is proving the wiring, not re-tuning production's cold-start budget,
   same principle as Phase 5's live test) rather than switching the role to a faster capability,
   which would have misrepresented what Orchestrator/Architect roles are meant to actually use.
2. Second attempt ran all real steps (decompose ×2, architect, coder) but failed reading back
   `live-e2e/ping.js` — the real model wrote the file to a different path than the requested
   subdirectory. Real finding, not a bug in this system: a small local model doesn't always follow a
   nested-path instruction exactly. Fixed the test to read whichever path the Coder actually
   recorded in `changed_files` rather than assuming compliance with an exact instruction, and
   simplified the fixture to a flat root path to remove one unnecessary degree of freedom.
3. Third attempt reached the real QA step and got a real, deterministic result — but that specific
   run's `extractJson` call threw on genuinely malformed JSON from the Coder: the model's own
   `content` string ended with a stray `'` instead of closing the JSON string properly (a real
   quote-escaping mistake, visible directly in the captured raw output). **Real fix, not a
   workaround**: strengthened `CODER_SYSTEM_PROMPT` with explicit JSON-escaping guidance (use double
   quotes in generated code, escape every `"`/`\n`/`\`) — this improves the Coder role for real
   production use, not just this test. Also adjusted the test's own final assertion: it checks that
   QA reached a **real, deterministic verdict** (a real, non-null exit code) rather than asserting
   the generated code must always be correct — a small local model's code quality is real,
   unavoidable variance, and asserting it never fails would make the test dishonestly brittle.

**Fourth attempt, with the strengthened prompt, passed in full**: real decomposition, real
architecture note written to `session_memory`, a real file written by a real model through the real
approval gate, and a real `npm test` run against a real, independent fixture project reporting a
real PASS.

**Audit (this phase's own explicit requirement — re-reading the founding directive's §42 "do not
fake autonomy" against the actual running system, not a plan)**: every status transition and event
observed during all four live attempts traced to something that actually happened — a real model
response, a real file on disk, a real process exit code. No fabricated progress, no silently-skipped
step, no invented pass. The one thing this run could not itself prove is the live dashboard actually
rendering this trail (Phase 13, not built yet) — flagged, not assumed.

**A fifth, harmless real incident, caught by `git status` before committing rather than missed**: the
very first (buggy, pre-hoisting-fix) run of this phase's test file really did write a stray
`ping.js` into this repo's own root — because `AGENT_WORKSPACE_ROOT` hadn't actually taken effect yet
(the same static-vs-dynamic-import ESM hoisting bug already caught once this session in
`agentToolRegistry.test.ts`/`agentCommandTool.test.ts`, reintroduced here before being fixed). The
workspace-boundary check itself worked correctly throughout — the problem was that it was handed the
wrong root, a test-harness ordering bug, not a bypass of the check. Confirmed harmless (content and
timestamp matched the known mocked-test fixture exactly, never referenced by any real code) and
deleted. Recorded here because it's real, concrete proof of why this pattern needs to keep being
caught early: any new test file that sets `AGENT_WORKSPACE_ROOT` must set it before a *dynamic*
import of the module under test, never rely on a static import or a `beforeAll()` hook.

**Not started**: Phase 10 onward (full structured shared memory + write-scope enforcement, the
remaining 10 specialist roles and full QA pipeline, the dashboard, human steering, final
integration). This entry is extended in place, not replaced, as each further phase lands — see
`docs/AI_AGENT_IMPLEMENTATION_PLAN.md` for the full order.

#### Re-plan: JENNYSOL-AGENTS-UI-FIRST.md supersedes the Phase 10-15 ordering

Before continuing, a second brief (`JENNYSOL-AGENTS-UI-FIRST.md`) reordered everything after Phase 9
into Stages A-D — observability and a real human control surface *before* more roles, not after
(rationale: all three Phase 9 findings were only caught by a human reading a trace of a *four*-role
run; ten more roles without a live surface would be undebuggable). This supersedes the old Phase
10-15 order but covers the same ground: Stage A/B ≈ old Phase 13/14 pulled forward, Stage C ≈ old
Phase 10/11, Stage D ≈ old Phase 12. Adopted as stated, no scope removed — see that file for the
full brief. From here, entries are titled by Stage, not Phase number.

**Pre-flight (the brief's own §1, before any new work)**: confirmed `f16d6b1` pushed and
`origin/main` matched (no local-only work). The brief's "name the 2 failing tests" was, on
inspection, imprecise: the suite reports 2 **skipped** tests, not failing ones — both are
`describe.skipIf(!ollamaReachable)` live-model tests (`agentTaskRunner.test.ts`,
`agentOrchestrator.test.ts`) that skip honestly when this Mac's local Ollama daemon isn't running,
which it wasn't at session start. Started it for real and re-ran both live tests to verify rather
than trust a skip: both passed in isolation (agentOrchestrator's full 4-role live E2E: 136s cold,
72s once warm). One real, honest finding surfaced doing this: running the *full* suite concurrently
with a freshly-started Ollama daemon, `agentTaskRunner.test.ts`'s live test missed even its widened
20s test-only budget on one call (timeout, then `AllProvidersUnavailableError` since that test
deliberately runs `ollama`-only, no cloud fallback) — confirmed transient by re-running the same
test alone immediately after (2.78s, passed). Real evidence for Stage C §5.1's latency question, not
a bug: under concurrent load this Mac's local inference latency is genuinely inconsistent enough to
occasionally exceed a 20s budget on a task that normally finishes in seconds. Recorded here rather
than papered over by widening the timeout further.

#### Stage A/B (partial) — the real gap found first: nothing drove a session end-to-end

**Status: VERIFIED — 540 tests (25 new: 9 + 5 + 9 new files, 2 new rejection-path tests in
agentOrchestrator.test.ts), tsc clean both packages, full suite green.** Before writing any dashboard
code, inspecting the actual system for what "watch a live run" would even show turned up a real,
load-bearing gap the brief didn't anticipate: **nothing before this stage could actually run a
session end-to-end outside of a test manually calling `runRoleTask` task-by-task.** Phase 6's
Scheduler and Phase 9's roles had never been wired together, and no route existed to start a session
at all. Building the dashboard on top of that would have meant either faking activity (forbidden) or
building UI with nothing real to render. Closed first, as its own real finding, not silently folded
into "just add SSE":

- `server/src/services/agentSessionRunner.ts` (new): `driveSession(sessionId, executor?)` — the
  missing loop. Ticks the Scheduler (`agentScheduler.tick`) with the role-aware executor
  (`runRoleTask`, Phase 9) repeatedly until every task is terminal (session marked
  completed/failed accordingly) or the session is paused (idle-polls) or cancelled (returns).
  `activeRunners` guards against two competing loops for one session. Fire-and-forget, same shape as
  `chatRunner`'s `executeChatRun`.
- **A second, more serious real gap found while building this loop**: `agentOrchestrator.ts`'s
  Coder/QA branches were **self-approving** every WRITE/exec action — `proposeAgentAction()` then
  immediately `approveAgentAction()` in the same code path, with nothing external ever actually
  deciding anything. The propose/approve *shape* (ADR-004) existed; the human was never actually in
  the loop. This is precisely what Stage B calls "a control surface is a safety control" — fixed at
  the root, not papered over in the dashboard: `agentToolRegistry.ts` gained
  `awaitApprovalDecision(actionId)`, a promise created and stored **at propose time** (not lazily on
  first await — see the real race this avoided, below), resolved only by a later, real
  `approveAgentAction`/`rejectAgentAction` call or the action's own now-actively-enforced TTL
  (a `setTimeout`, not just a lazily-checked timestamp — a proposal nobody ever decides on now fails
  honestly instead of hanging a task forever). `agentOrchestrator.ts`'s Coder/QA branches now
  propose, mark the task `awaiting_approval` (new `AgentTaskStatus`/`task.awaiting_approval` event —
  a real, distinct, dashboard-visible state, not folded into "running"), and really wait.
- **Real bug caught writing the first rejection test, not assumed away**: `rejectAgentAction` has no
  internal `await`, so a listener reacting to the same event tick it fires in — as this stage's own
  test helper, and in principle a very fast real approval-queue client, does — could call it *before*
  `awaitApprovalDecision` had registered a waiter, permanently missing the one resolution and hanging
  the task until the 5-minute TTL. Root-caused and fixed for real: the decision promise is now
  created inside `proposeAgentAction` itself, before its event is ever emitted, so it always exists
  by the time anything could possibly react — no ordering assumption left to rely on.
- **The ESM static-import-hoisting bug (caught 3 times this session already) recurred a 4th time**,
  self-inflicted debugging this exact issue: a temporary `console.log` diagnostic revealed a real
  file write landed in the actual repo root (`/ping.js`) instead of the test's tmp workspace, because
  my own new `import { approveAgentAction } from "./agentToolRegistry.js"` in
  `agentOrchestrator.test.ts` was a **static** top-of-file import, hoisted above that file's
  `AGENT_WORKSPACE_ROOT` assignment. Fixed by moving it into the file's existing dynamic-import
  block. The stray `ping.js` this produced was confirmed harmless (content/timestamp matched the
  debug run exactly, untracked, unreferenced) and deleted. Recorded again because this is now a
  4-for-4 pattern worth a permanent rule, not a one-off: **any new import in any agent test file that
  transitively touches `agentWorkspace.ts` (currently: `agentToolRegistry.ts`, `agentCommandTool.ts`,
  `agentOrchestrator.ts`) must be dynamic, after the env var assignment, full stop — never add a
  static import "just this once."**
- `server/src/services/agentSessionControl.ts` (new): `pauseSession`, `resumeSession`,
  `cancelSession`, `killAgent` — real, durable transitions Stage B's own definition of done requires
  ("cancel cleanly: locks released, partial state recorded, no orphaned agents"; "kill one agent
  without tearing down the whole DAG"). Cancel/kill reject that scope's pending actions
  (`agentToolRegistry.ts` gained `rejectAllPendingActionsForSession`/`rejectPendingActionsForAgent`)
  and release its file locks (`agentFileLocks.ts` gained `releaseAllLocksForSession`/
  `releaseLocksHeldByAgent`) — a killed agent's sibling tasks/locks/pending actions are provably
  untouched (tested directly). `agentScheduler.tick()` also now refuses to dispatch into a
  paused/cancelled/terminal session directly (not just relying on the driver loop's own check) —
  the Scheduler stays the sole authority on pending→running transitions, per its own header comment.
- `server/src/routes/admin.ts`: `POST /agent-sessions` (the real "start a session" route — returns
  as soon as the session row exists, then `decomposeObjective` + `driveSession` run in the
  background, same fire-and-forget shape as chat), `POST /agent-sessions/:id/{pause,resume,cancel}`,
  `POST /agent-sessions/:id/agents/:agentId/kill`, `GET /agent-actions/pending` (optionally
  `?sessionId=`), `POST /agent-actions/:id/{approve,reject}`, and `GET /agent-sessions/:id/stream`
  (Stage A §2.1's live SSE feed — same header/heartbeat/unsubscribe-on-close shape as `chat.ts`'s
  existing SSE route, replaying `?after=` before subscribing live so a reconnecting client never
  misses an event; transport only, no new domain logic, per the brief's own framing).
- New tests: `agentSessionControl.test.ts` (9), `agentSessionRunner.test.ts` (5, using a controllable
  fake executor exactly like `agentScheduler.test.ts`'s own convention — proves the loop completes a
  real dependency chain, marks failure correctly, respects pause without touching state, stops
  immediately on cancel, and never runs two competing loops for one session),
  `routes/adminAgentSessions.http.test.ts` (9, real HTTP layer via `supertest` against the real
  `app.ts` — the same gap-closing rationale `httpRoutes.test.ts` documents: a route can wire auth or
  validation wrong even when the service underneath is correct, and only an HTTP-layer test catches
  that. Covers 401/403/400 gating, real background decomposition observed via polling, real
  pause/resume/cancel transitions, real kill-one-agent-not-its-sibling, and the approval queue
  actually writing/blocking a real file through real HTTP calls). Plus 2 new rejection-path unit
  tests in `agentOrchestrator.test.ts` (coder write rejected → task fails, file never written; QA
  command rejected → task fails, command never runs) and the live E2E test updated to act as its own
  "human" via the real event bus rather than self-approving.

**Not yet built (this stage continues)**: the actual dashboard UI wiring to this new surface (SSE
consumption, the run view's DAG/artifact rendering, the approval queue UI, pause/resume/cancel/kill
buttons, mobile layout, design-system pass) — everything above is the real server-side surface the
UI now has something honest to render against. Continuing directly into the client next, per the
brief's own "build the surface" instruction.

#### Stage A/B client — the dashboard actually wired to the new surface

**Status: VERIFIED live against a real running server (not just tsc-clean) — see the live proof
below. tsc clean on the client package.**

- `client/src/lib/admin.ts`: `startAgentSession`, `pauseAgentSession`, `resumeAgentSession`,
  `cancelAgentSession`, `killAgent`, `fetchPendingActions`/`approveAgentAction`/`rejectAgentAction`,
  and `streamAgentSessionEvents` — the SSE client. **Not** the native `EventSource` API: this app's
  auth is a Bearer token on a custom header (`authFetch`), which `EventSource` cannot attach, so this
  mirrors `api.ts`'s own `sendChatMessage` fetch+reader SSE parsing exactly rather than introducing a
  second streaming mechanism client-side.
- `client/src/pages/admin/AgentSessions.tsx`: a real "start a session" form (objective textarea +
  submit) posting to the new route and navigating to the run view — the list page's stale empty-state
  copy (which said starting a session "isn't built yet") corrected, since it now is.
- `client/src/pages/admin/AgentSessionDetail.tsx` (rewritten): SSE-driven (was 3s polling), with
  auto-reconnect on drop and a `live`/`reconnecting…` indicator; still re-fetches the full snapshot on
  every event rather than deriving state from the event payload — the same rule the polling-only shell
  established, now event-driven instead of time-driven. Added: a DAG-aware task list (each task shows
  its real `dependsOn` resolved to titles, and real elapsed time ticking live for in-flight tasks); an
  **unmissable, always-first amber banner** for anything `awaiting_approval` or `blocked` with inline
  Approve/Reject acting on the real action right there (Stage B §2.3's "single most important state,
  currently invisible" — now the first thing on the page); a real Artifacts panel derived purely from
  `tool.exec.finished` events (files written, commands run with real exit codes and captured
  stdout/stderr — the same real-evidence-only rule QA's own execution already followed, now visible);
  session-level Pause/Resume/Cancel buttons and a per-agent Kill button, all wired to the real Stage A
  control routes; a token-usage total with an explicit, honest note that cost isn't computed (no
  $/token price table exists — same gap `agentScheduler.ts` already documents, not hidden from the
  founder here).
- `client/src/pages/admin/AgentApprovals.tsx` (new): the global "everything waiting on you, right
  now" queue Stage B asks for, across every session — real diff/command preview, large
  (`py-3`/`px-6`) touch targets sized for mobile approval away from a desk, no bulk action, no
  default, no one-tap-through (every decision is its own explicit button press against its own real
  action id). Registered at `/admin/agent-approvals` with its own nav item.
- No new visual language introduced (Stage B2's own rule): every new element reuses the existing
  admin surface's established tokens exactly (`brand`/`neutral`/`emerald`/`rose`/`amber`/`sky`,
  `rounded-2xl` cards, `dark:` variants) rather than inventing new colors or components — this was a
  constraint followed while building fresh, not a separate pass applied afterward. Every new view
  has its own loading/empty/error states (`AgentApprovals`'s "quiet here" empty state deliberately
  echoes the doctrine's own "an honest 'it's quiet here' beats an invented number" language).

**Live proof, not just tsc** (no browser-automation tool is available in this environment, so the
rendered pixels were not visually confirmed — noted honestly rather than assumed; what follows
verifies the exact real data/API path every one of the components above actually calls): started a
second, isolated dev server instance on port 8788 (the real production LaunchAgent on 8787,
`in.vikisol.jennysol-server`, was left running and untouched throughout — confirmed healthy,
same PID, before and after) and a client dev instance pointed at it, then drove the real HTTP surface
directly with a real signed-up-and-admin-promoted user:
1. `POST /agent-sessions` with a real objective → real 201, `status: "planning"`.
2. Connected to the real SSE stream and watched it deliver real events live: decomposition
   (`gemini`, cloud fallback — a real, live routing decision, not scripted), the Architect task, then
   the Coder proposing a real `file.write` — genuinely reaching `task.awaiting_approval` with a real
   `actionId`, exactly the payload shape the approval banner renders.
3. `GET /agent-actions/pending` showed that exact action; `POST .../approve` executed it for real —
   the file landed on disk with the exact real content the model wrote.
4. QA's own proposed command then hit **a real, correct refusal**: the command it invented
   (`node -e ...`) is not on the allow-list. `approveAgentAction` threw, the task failed with that
   exact honest reason attached, and the session correctly transitioned to `failed` — proof the
   "never widen the allow-list" boundary (this document's own §7) holds even against a live model's
   own choices, and that failure propagates honestly end-to-end rather than getting swallowed.
5. Cleaned up afterward: the test user (cascades to its session/agents/tasks/events), the one real
   file it wrote, and the two isolated dev processes — the shared real SQLite database (confirmed
   this session: dev, tests, and the production LaunchAgent all resolve to the same
   `server/data/jennysol.db`, an existing, already-accepted characteristic of this codebase's
   real-DB-integration-testing style, not something introduced here) was left exactly as found.

**Real, honest finding from step 4, not a defect**: this is the first time a live QA task's own
command choice has been checked against the allow-list rather than assumed compliant (Phase 9's live
test supplied the QA command itself, deliberately, to keep that test's own scope narrow) — a small
model asked to "verify a file" will sometimes reach for `node -e` reflexively, and the system's real
job is to refuse that, not accommodate it. Recorded here as evidence for Stage C §5.4 (failure
semantics): "an agent proposes a disallowed command" is a real, now-observed failure mode with a
defined, correct behavior (refuse, fail the task honestly, fail the session) — worth encoding as a
permanent regression test in that stage rather than only known from this one live run.

**Not yet built**: Stage C (§5.1 latency/cost report, §5.2 write-scope enforcement, §5.3 checkpoints,
§5.4 failure-semantics tests) and Stage D (remaining 10 roles). Continuing directly into Stage C next.

#### Stage C — latency/cost truth, write-scope enforcement, checkpoints, failure semantics

**Status: VERIFIED — 24 new tests, tsc clean both packages, full suite green (550; the 1 already-
documented, environment-load-dependent live-model flake re-confirmed transient by re-running it alone
immediately after, same as every prior occurrence this session).**

**§5.1 — real numbers, node by node, local model (this Mac's real, always-available capacity), warm:**
a one-off measurement script (not committed — produced the numbers below, then deleted) ran the exact
real `decomposeObjective`/`runRoleTask` path against this Mac's real Ollama for the objective "create
ping.js exporting a function returning 'pong'":
- Decompose (Orchestrator, `deepseek-r1:7b`): **20-34s**
- Architect (`deepseek-r1:7b`): **13-33s**
- Coder (`qwen2.5-coder:7b`): **6-8s** first-token, **8-33s** total node time
- QA (no LLM call by design): **~1ms** to a real command result
- **Total wall-clock for a 3-4 node objective: 60-136s** (136s the first, colder Phase 9 run; 60-71s
  once models were already warm) — a real, honest four-reasoning-step objective on this Mac is a
  **roughly one-to-two-minute** objective, not a low-latency interaction.
- Real token cost: **1,679-1,882 tokens** total across 3 agents for this small a task. No $ figure is
  reported — `agentScheduler.ts`'s own documented gap (no $/token price table exists anywhere in this
  codebase) still applies; reporting a dollar amount here would be exactly the invented number this
  engagement has avoided everywhere else.
- A separate, real, live-UI-verification run (previous entry) used `gemini` (cloud fallback) instead
  and completed decompose+architect in **~10s each** — roughly 2-3x faster than the local path for
  the reasoning-heavy nodes, a real, direct measurement of the local-vs-cloud tradeoff this system
  already routes between.
- **What would have to change to be acceptable**, per the brief's own instruction to report before
  optimizing: (1) a faster/smaller model for the Orchestrator/Architect reasoning nodes specifically —
  `deepseek-r1:7b`'s "thinking" mode is the single largest cost observed all session (30s+ more than
  once); (2) parallelizing independent DAG branches once real objectives have any (this session's
  test objectives were linear chains, so the Scheduler's real concurrency support has real work left
  untested here); (3) a keep-warm prober ahead of local reasoning calls specifically, not just the
  general-capability model `keepWarm.ts` already keeps resident — the 30s+ figures were consistently
  the model's own cold "thinking" latency, not network or transport overhead. Not implemented here —
  reporting only, per the brief's own explicit instruction not to optimize yet.
- **A real, freshly-observed failure mode found doing this measurement**: the live Orchestrator twice
  (both real measurement runs) assigned the "qa" role to a task whose description was plain-English
  coding instructions meant for a coder task, while a differently-titled task got the correct QA
  command spec — a real role/description mismatch, not a JSON-escaping issue. `runQaTask`'s existing
  `JSON.parse` catch handled it exactly as designed: an immediate (~1ms), honest, correctly-labeled
  failure, no hang, no silent skip. Considered and rejected a stricter fix (rejecting the whole
  decompose batch atomically the moment any qa-role task's spec is malformed) because it would trade
  a *better* outcome (architect+coder's real, completed work stands; only the one malformed QA node
  fails) for a *worse* one (the entire batch, including the parts that already worked, gets thrown
  away) — for zero real time/cost savings, since the failure is already near-instant and free. Fixed
  the actual root cause instead: strengthened `ORCHESTRATOR_SYSTEM_PROMPT` (`agentRolePrompts.ts`)
  with an explicit worked example distinguishing a qa-role task's required JSON-spec description from
  a coder-role task's prose description — a real prompt fix, not a validation workaround, matching
  Phase 9's own precedent for exactly this class of live-model issue.

**§5.2 — real, server-side write-scope enforcement for shared memory** (`agentMemoryWriteScope.ts`,
new): every real memory write before this stage (`agentOrchestrator.ts`'s three `setMemory` call
sites — orchestrator→requirements, architect→architecture, coder→changed_files) went straight to the
store completely unguarded — `agentTaskRunner.ts`'s own comment had flagged this exact gap since
Phase 5 ("Phase 2 flagged this as a gap to close by this point, not before"). `writeSessionMemory()`
is now the one real enforcement point: a role without `memory:write_any` (per `agentRegistry.ts`'s
existing `ROLE_CATALOG`) can only write a key in its own declared `MEMORY_WRITE_SCOPE` — defined for
all 14 roles now, same reasoning as `ROLE_CATALOG`'s own "define the full catalog now, not per-phase."
**The explicit violation cases the brief asks for, not just the happy path** (`agentMemoryWriteScope.
test.ts`, 5 tests): a coder writing outside its own scope is refused; an agent id real in a *different*
session can't be used to write into this one just by pairing it with this session's id (getAgent's
own existing cross-session-leakage guard, reused here); an unknown agent id throws rather than
silently no-op-ing. Also closed in passing: `sessionEventBus.ts`'s `"memory.updated"` event type has
existed since Phase 4 but nothing had ever emitted it — every write now does.

**§5.3 — checkpoints, both real failure shapes the brief names:**
1. *A clean mid-run failure* (`agentSessionControl.ts`'s new `retryTask`): the checkpoint is nothing
   new to build — every task before a failure is already durably `completed` in `agent_tasks`, and
   `agentTaskDag.ts`'s `readyTasks()` already never re-selects a completed task. What was missing was
   a way to reset *only* the failed node back to a clean `pending` (new `resetTaskForRetry` in
   `agentSessionStore.ts` — deliberately not `updateTaskStatus`, whose CASE-based timestamp logic only
   ever moves `started_at`/`completed_at` forward and would leave a retried task's elapsed-time
   display showing the stale failed attempt's numbers). New route:
   `POST /agent-sessions/:id/tasks/:taskId/retry` (+ a client Retry button on any failed task).
   **Tested for real** (`agentSessionControl.test.ts`, 3 tests): a real 2-node chain where node 1
   completed and node 2 failed — retrying node 2 resets exactly that node, while node 1's real,
   already-completed result is provably untouched; retrying a non-failed task is refused (the
   explicit violation case); an unknown task id throws.
2. *A real process restart mid-run* — a materially different case from a clean failure: a task stuck
   `running`/`awaiting_approval` when the process itself dies has no real executor promise left behind
   it, but its row never learns the process died. New `resumeInFlightSessionsOnBoot()`
   (`agentSessionRunner.ts`), called once at server startup (`index.ts`): for every session still
   `running`, resets any task stuck `running`/`awaiting_approval` via the same `resetTaskForRetry` the
   manual retry route uses, then re-invokes `driveSession` — deliberately does **not** touch a session
   stuck `planning` (that would mean silently re-running a real LLM decomposition call the operator
   never asked for again; left for a human to notice and retry from the dashboard instead). **Tested
   for real** (`agentSessionRunner.test.ts`, 2 new tests): a task simulated as stuck mid-flight is
   reset and the session actually completes for real afterward, with node 1's real completed result
   untouched (the checkpoint holding through a *process-level* interruption, not just a clean
   task-level one); a paused or already-terminal session is confirmed left exactly alone — a reboot
   must never silently resume a session a human deliberately paused.

**§5.4 — failure semantics, the four named cases, each with a defined behavior and a real test —
not all four needed new code, and this section says plainly which didn't rather than padding it out:**

1. **Malformed output** — already covered by real, pre-existing tests before this stage: the Coder
   producing invalid `{filePath,content}` JSON, and QA receiving an unparseable command spec, both
   fail the task honestly (`agentOrchestrator.test.ts`, existing). New this stage: **a disallowed
   command survives even a real, human approval and still never runs** — the exact live finding from
   this stage's own §5.1 measurement run and the earlier live-UI-verification session, now a
   permanent regression test (`"refuses a disallowed command even when approved, and fails the task
   with the real reason"`). This proves the allow-list boundary (this document's own §7, "never widen
   the allow-list") holds independent of who or what approves the action.
2. **Timeout** — already fully covered: `agentTaskRunner.test.ts`'s existing
   `"marks the task failed with the real error attached"` test simulates exactly this
   (`AllProvidersUnavailableError`, the real, observed shape every provider timeout eventually takes —
   confirmed live twice this session, once in this stage's own §5.1 run). Every provider call already
   carries its own bounded timeout (`LLM_LOCAL_FIRST_TOKEN_TIMEOUT_MS` locally, each cloud provider's
   own network timeout) — a role task cannot hang indefinitely on a model call; no new code needed.
3. **Loop** — two distinct real meanings, both already handled: a DAG-level cycle (two tasks
   depending on each other) is rejected atomically at decompose time, already tested since Phase 3
   (`"propagates a real cycle rejection from Phase 3's DAG"`). A single LLM call repeating/looping its
   own output is bounded by each provider's own max-token configuration — a `modelRegistry.ts`/
   provider-layer concern, unmodified and out of this stage's real scope. Explicitly **not** covered:
   an agent stuck in an automatic retry loop — there is no automatic retry mechanism anywhere in this
   system today (a failed task stays failed until a human retries it via §5.3's `retryTask`), so a
   bounded-retry-count guard has nothing to guard yet. Flagged here, not silently assumed: **if any
   future stage adds automatic retries, a max-attempt guard must be added at the same time**, not
   asserted as already safe.
4. **Contradicts another agent's work** — the real, concrete version of this in the current
   architecture is QA's real command disagreeing with what Coder believed it produced, already tested
   (`"fails the task on a real failing command's real exit code"`) and independently reconfirmed live
   twice this session (the §5.1 measurement run's role/description mismatch, and the live-UI-
   verification session's allow-list refusal). A different flavor — the Coder writing to a different
   path than the objective implied — was Phase 9's own second live finding; it isn't separately
   re-tested here because it's structurally regression-proof by construction, not by a special check:
   `changed_files` memory always records whatever path the Coder actually used, never an assumed one,
   so nothing downstream can silently disagree with reality.

24 + 1 = 25 tests total for Stage C, full suite green, tsc clean both packages.

**Stage C is now complete in full** (§5.1 latency/cost truth, §5.2 write-scope enforcement, §5.3
checkpoints, §5.4 failure semantics) — every item in the brief's own definition-of-done for this
stage that is server/logic-facing is real, tested, and pushed. Continuing directly into Stage D.

#### Stage D group 1 — backend, database, ui (the coder-shaped roles)

**Status: VERIFIED live end-to-end on a real running server, 21 new tests, tsc clean, full suite
green.**

Refactored `runRoleTask`'s dispatch from per-role if-statements into a `ROLE_EXECUTION` table
(`agentOrchestrator.ts`) before adding these three — backend/database/ui are mechanically identical
to Coder (one `{filePath,content}` JSON, one real approved write), so they're additional table
entries, not new branches. `assignableRoles()` is now the Orchestrator's single source of truth for
which roles it may plan work for — computed from the same table, so a role the table doesn't yet
cover can never be planned for (architecture doc §3's "do not fake autonomy": no role gets assigned
work before it has real execution logic behind it). `agentRolePrompts.ts` gained `BACKEND_/DATABASE_/
UI_SYSTEM_PROMPT` via one shared template (three near-identical prompt strings would drift apart over
time otherwise) and `ORCHESTRATOR_SYSTEM_PROMPT` now names all three with guidance on when to use
them over generic "coder."

**Live proof, not just mocked tests** (isolated dev server, real signed-up admin user, production
LaunchAgent on 8787 confirmed untouched throughout): a real objective ("create a backend route file
and a database schema file for a notes list") really decomposed into `database`+`backend`+`qa` tasks
— the live Orchestrator correctly chose the new specialist roles over generic "coder," unprompted by
anything except the new prompt guidance. The `database` role wrote a real, correct SQL schema; the
`backend` role wrote a real, working Express router with a sensible handler — both proposed through
the real approval gate, both approved, both landed on disk exactly as approved. QA then proposed
`node -e ...` for its own file-existence check — the **exact same real allow-list refusal already
seen twice before this session** (Stage A/B's live verification, and this stage's own §5.1
measurement run) — now a third independent live confirmation that the boundary holds regardless of
which provider (this run used `gemini`, not local Ollama) or which objective produced the disallowed
command. Cleaned up afterward: the two real files, the test user (cascades to its session).

#### Stage D group 2 — security, performance, code_reviewer (the review-shaped roles)

**Status: VERIFIED live end-to-end on a real running server, 30 new tests, tsc clean, full suite
green (563).**

These three read real, already-written code and report findings — they never write or fix anything
themselves (mirroring QA's own "reports, never decides" shape one level up). The real, necessary piece
built for this: `agentOrchestrator.ts`'s `readChangedFilesContent()`, wired through group 1's
`augmentContext` hook, actually reads every file in `changed_files` via `agentToolRegistry.ts`'s
existing READ-tier `readFile` before the model ever runs — without this, a "review" of file *names*
alone (all `MEMORY_READ_SCOPE` gave these roles before) would be an invented finding, not a real one.
**A real bug caught while designing this, not after**: all three roles share one `audit_results`
memory key — a naive `writeSessionMemory(..., "audit_results", {verdict, findings})` per role would
let the second reviewer to finish silently erase the first one's findings. Fixed before it ever
shipped: `runReviewCompletion` reads the existing value, merges this role's own findings under its
own key, and writes the merged object back — **tested explicitly** (`"two reviewers writing to
audit_results merge under their own role key, neither clobbers the other"`), not just asserted safe.
Also tested: a reviewer given nothing to review yet reports that honestly rather than inventing a
finding about code it was never shown (matching the prompt's own explicit instruction for this case).

**Live proof, not just mocked tests**: a real objective ("create config.js with a hardcoded database
password, then have security review it") really decomposed into architect→coder→security tasks. The
live Coder wrote the exact file asked for (a real secret in real code — the *point* of this
objective was to give the reviewer something real and specific to find, not a contrived pass). The
live Security role's finding — `"config.js contains a hardcoded database password
('supersecretpassword123') exported directly in source code."` — quotes the **exact real password
string from the file**, direct proof it actually read the file's real content rather than guessing
from its name. Verdict `"concerns"`, correctly. Session completed cleanly (the Orchestrator correctly
scoped the plan to exactly what was asked — no unrequested QA step tacked on). Cleaned up afterward:
the one real file, the test user.

**Not yet built**: Stage D group 3 (product_analyst/ux/final_judge — the planning/judgment roles),
Visual QA (blocked on real vision-model support — see `JENNYSOL-VISION-AND-IMAGERY.md`, not yet
started), and the full QA pipeline (lands last, once the roles it checks all exist).

---

## PHASE 5 — Automatic Gap Analysis

### EXECUTIVE SUMMARY

- **Total requirement categories audited:** 41
- **IMPLEMENTED or TESTED:** 6 (categories 1 partial-toward-implemented, 3, 5, 6, 7, 8, 12
  partial, 41 partial — see individual entries; treat this as "substantial, verified work
  exists" rather than a precise count, since most categories are partial rather than
  binary)
- **PARTIAL:** 13 (1, 2, 3, 6, 10, 11, 12/13/14 combined, 28, 33–35, 36, 37, 40, 41)
- **NOT STARTED:** 22 of 41 categories — category 37 (Observability) moved to PARTIAL this
  update (real crash/error logging now exists, visible in the admin dashboard). Every
  category specific to Vikisol Arena's role-specific/marketplace identity is still NOT
  STARTED (15–27, 29–32, 38).
- **VERIFIED against a real, working demonstration (not just code review):** conversation
  history lifecycle, Gemini chat, Gemini image generation (verified correct, blocked by
  quota), Gemini TTS (verified working, discovered the 10/day cap), the full voice
  conversation state machine including barge-in's code path and a real multi-turn no-
  wake-word exchange, the full authentication lifecycle — signup, login, logout,
  logout-all-devices, password reset with session revocation, email verification, and
  **tenant isolation directly confirmed with two real accounts** (see category 2) — and
  now Google Search grounding's fallback behavior, a real triggered-and-caught server
  crash, the admin dashboard's stats/users/transcript/errors views against live data, and
  the welcome animation actually rendering (all this update — see categories 1, 2, 37, 40,
  41). **Not yet verified:** an actual Google sign-in (no OAuth client ID configured in
  this environment) and an actual successful grounded chat answer (this key's grounding
  quota is currently exhausted) — both implemented and reviewed, neither exercised
  end-to-end with real external success.
- **Blocked on credentials/external services:** DeepSeek (no key), Ollama (no local
  instance), every category 19–27 integration (no third-party API accounts exist for any
  of them), real email sending for verification/password-reset (currently dev-mode console
  logging behind a pluggable `EmailProvider`).

### CRITICAL MISSING FEATURES

1. **Multi-tenancy / user accounts** (category 2) — the foundational gap; almost every
   other Vikisol-Arena-specific category is blocked on this.
2. **Memory system beyond raw history** (category 10) — includes a real correctness risk:
   no guardrail today against the model fabricating an answer to "what do you remember
   about me."
3. **Voice-first UI hierarchy** (categories 8, 40) — the app is chat-first, which the
   specs explicitly and repeatedly say not to build.
4. **Every real-world integration** (categories 19–27) — zero exist; this is where most of
   Vikisol Arena's differentiated value (vs. a generic chatbot) was supposed to live.
5. **Role-specific AI** (category 30) — zero of the eight specified roles have any
   implementation, because there's no user/role system for them to attach to.

### CRITICAL SECURITY ISSUES

1. **~~No rate limiting anywhere~~ — RESOLVED.** `express-rate-limit` is now applied
   globally (120 req/min, all routes) plus a stricter `sensitiveLimiter` (20 req/15min) on
   signup/login/forgot-password/reset-password specifically, guarding against brute-force
   and quota-exhaustion abuse on those endpoints. Verified via curl (repeated calls past
   the sensitive-route limit return HTTP 429). Login also has a separate DB-backed lockout
   (`loginAttempts.ts`, 8 failures/15min per email) independent of the HTTP-level limiter.
2. **Untested prompt-injection surface** — uploaded document text goes into the LLM
   context with no sanitization; never deliberately tested. Still open, unrelated to auth.
3. **~~No authentication~~ — RESOLVED.** Every data route (`/api/chat`,
   `/api/conversations`, `/api/documents`, `/api/image`, `/api/speech`) now requires a
   valid Bearer session token via `requireAuth` middleware; unauthenticated requests get a
   401. Conversations, messages, documents, and vector-search chunks are all scoped by
   `user_id` at the query level (not just the UI), and this was directly verified — not
   just code-reviewed — with two real signed-up accounts, each seeing only their own data.
   What remains open: uploaded documents from *before* this change are orphaned
   (`user_id` NULL) rather than deleted or reassigned, and there is no admin/reassignment
   tool for them; and password-reset/email-verification links are only logged to the
   server console (no real email provider configured yet), which is a usability gap, not a
   security one, since the tokens themselves are real, single-use, and time-limited.

### CRITICAL ARCHITECTURE ISSUES

1. **SQLite as the sole datastore** — correct and sufficient for what exists today;
   architecturally incompatible with the multi-tenant, multi-media, high-write-volume
   vision described across every mega-spec in this project's history. Not a bug, but a
   real fork point: staying on SQLite bounds how much of the larger vision can ever be
   built here.
2. **No tool-calling loop** — the "agent" is currently a fixed pipeline (embed → retrieve
   → answer), not a model that can decide to call one of several tools. Every integration
   category (19–27) needs this to exist first.
3. **~~Data isolation~~ — RESOLVED.** `users`, `sessions`, and per-user `user_id` foreign
   keys on `documents`/`conversations` now exist and are enforced at query time everywhere
   data is read or written. What's still genuinely missing at the architecture level is any
   notion of an *organization* (multi-member team/tenant above the individual user) —
   only a single flat `users` table exists; there is no `organizations` table or
   membership model, so any future "team" or "company account" feature still needs new
   schema.

### VOICE-FIRST STATUS

The **mechanics** are genuinely, rigorously implemented and tested: continuous listening
with no wake-word requirement to start, real multi-turn conversation with no wake word
between turns, real voice barge-in, an animated state-reactive orb, TTS across 30 voices
plus a robust fallback chain. This is the most mature, most verified part of the codebase.

What is **not** true: the app is not voice-first in the way the specs define it —
"the main interaction should NOT look like a ChatGPT clone," "chat history should be
secondary," "no permanent chat input at center." The actual app is a chat interface with a
voice feature bolted on, not a voice interface with chat as a fallback. Both things are
true at once: the voice *feature* is excellent; the voice-first *product identity* was not
built.

### MEMORY STATUS

Jenny can remember and correctly retrieve the **current session's own conversation
history** — verified, works, persists in SQLite, survives switching between conversations.

Jenny **cannot** remember or search anything else: no extracted preferences, no cross-
conversation semantic search, no photos/videos/calendar/email to search in the first
place. If asked "what do you remember about me," today's system prompt gives the model no
explicit instruction to admit it has no such data — a real, fixable honesty gap.

### DEVICE CONTROL STATUS

Nothing works. No capability exists to open an application, control a device, take a
screenshot, or interact with anything outside the browser tab this app runs in.

### VIKISOL ARENA STATUS

None of Vikisol Arena's defining, role-specific capabilities exist. What's been built is a
capable but generic RAG chatbot with strong voice UX — it is not yet, in any way, "Jenny
the intelligence layer of a multi-role marketplace platform." Every one of the eight
specified roles (candidate through admin) has zero dedicated functionality.

### PRODUCTION READINESS

**Rating: ALPHA**

Reasoning: the app that exists works, is deployed (frontend live on Vercel; backend
deployment to Railway still pending a token/billing resolution from earlier in this
project), and has been genuinely tested end-to-end for the features it has. That's more
than a prototype. Authentication and rate limiting — the two items that used to headline
this section — are now real and verified. What still holds this at ALPHA rather than
higher: no automated test suite (all verification has been manual, albeit extensive), no
real email provider (password reset/verification are functionally complete but only
dev-console-logged), and a scope that still covers perhaps 15–20% of what's been specified
as "Jenny" across this project's history — the auth work closes the foundational gap but
does not itself add role-specific or integration functionality. It is not a production
candidate for "Vikisol Arena's AI layer" — it is a solid alpha, now with real accounts, of
one piece of that (a personal RAG + voice chat tool).

---

## PHASE 6 — Priority Roadmap

### P0 — Must fix / must build (before this is safe as a public-facing app)
- ~~Rate limiting on all API routes.~~ **DONE.** Global + per-route sensitive limiter, see
  Critical Security Issues above. Verified via curl.
- System-prompt fix for the "what do you remember about me" honesty gap. *Reason: prevents
  fabricated answers about non-existent memory. Dependencies: none. Complexity: trivial.
  Testing: ask the question, confirm an honest answer.* **Still open.**
- ~~Decide (not necessarily build) the multi-tenancy question.~~ **DECIDED AND BUILT.**
  Full authentication + per-user data isolation now exists (see category 2 and the P1 item
  below, which is done rather than pending).
- A real email provider for password-reset/verification links. *Reason: currently
  dev-console-only; unusable by real end users outside this development session.
  Dependencies: an email-sending account (e.g. Resend, SendGrid, or SMTP credentials) —
  requires user action. Complexity: low once credentials exist, since `EmailProvider` is
  already an interface with one implementation to swap in.* **New P0 item, surfaced by
  this work.**

### P1 — Important
- ~~Basic authentication + per-user data scoping, if/when multi-tenancy is greenlit.~~
  **DONE.** Signup/login/logout/logout-all-devices/sessions/password-reset/
  email-verification all implemented and tested; tenant isolation directly verified with
  two real accounts, confirmed via database inspection that data returned by every route
  is scoped by `user_id`.
- Minimum-similarity threshold on RAG retrieval. *Reason: currently surfaces irrelevant
  "sources" on unrelated queries (observed directly during testing). Dependencies: none.
  Complexity: low.*
- DeepSeek/Ollama real verification. *Dependencies: a DeepSeek key, a running Ollama
  instance. Complexity: low once available.*
- Image *understanding* (not just generation). *Reason: Gemini already supports this;
  cheapest multimodal expansion available. Dependencies: none. Complexity: low-medium.*
- A minimal automated smoke-test suite covering every route. *Reason: manual
  re-verification has already happened multiple times across this project for the same
  features. Complexity: low-medium.*

### P2 — Advanced
- Semantic memory extraction (explicit preference/fact capture + retrieval into future
  system prompts). *Dependencies: none technically, but low value without multi-tenancy
  (whose preferences are being remembered?). Complexity: medium.*
- A real tool-calling loop (structured function calling, not the fixed RAG pipeline).
  *Dependencies: none. Complexity: medium. Required before any of categories 19–27 are
  worth starting.*
- One real external integration end-to-end (e.g. Google Places, as the least
  credential-heavy option) as a proof of the tool architecture above. *Dependencies: the
  tool-calling loop, a Google Places API key. Complexity: medium.*
- Voice-first UI redesign (orb as primary surface, chat secondary) — *if* still desired
  given the chat-first version now has real, tested conversation history behind it.
  *Dependencies: a real product decision, since it reverses a recent, deliberate,
  explicitly-requested build. Complexity: high (touches the entire layout).*

### P3 — Future
- Everything else: role-specific AI, PostgreSQL/Redis/pgvector migration, calendar/email/
  Teams/Zoom, food/travel/booking, device/computer control, speaker verification, proactive
  notifications, billing, observability dashboard, mobile/desktop apps. Each of these is
  its own multi-week project with its own credential/infrastructure prerequisites, none of
  which exist yet.

---

## FINAL COMPLETION CHECK

- [ ] All P0 requirements VERIFIED
- [ ] All critical security issues resolved
- [ ] Continuous voice VERIFIED
- [ ] Barge-in VERIFIED
- [ ] Memory VERIFIED
- [ ] Multimodal VERIFIED
- [ ] Tool permissions VERIFIED
- [ ] Device control VERIFIED
- [ ] Core Arena roles VERIFIED
- [ ] Software requirement agent VERIFIED
- [ ] Integrations VERIFIED
- [ ] Tests passing
- [ ] Production configuration verified
- [ ] Observability verified
- [ ] No fake implementations
- [ ] No critical TODOs
- [ ] Documentation complete

**FINAL STATUS: NOT COMPLETE**

This must remain NOT COMPLETE until every box above is genuinely, verifiably checked. As of
this update, three of seventeen boxes are partially arguable: continuous voice and
barge-in (both with the honestly-stated real-world-reliability caveat above), plus **"all
critical security issues resolved"** is now much closer to true — the two headline items
(no rate limiting, no authentication) are both fixed and verified, though the box stays
unchecked since prompt-injection sanitization is still untested and no automated test
suite exists to keep these guarantees from regressing silently. The other fourteen require
work that has not started.
