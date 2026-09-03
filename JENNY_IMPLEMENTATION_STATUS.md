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

**Missing:** organizations (the `organization_id` column exists on `users` but nothing
creates, joins, or manages membership in one — no invite flow, no org-level roles, no org
switching); all 8 role-specific *experiences* (the role is captured at signup and stored,
but nothing in the app currently behaves differently based on it — see category 30); admin
tooling (no way to disable/inspect other users); audit logging of security events;
CSRF-specific protection (mitigated in practice by Bearer-token auth rather than cookies —
tokens aren't auto-sent by the browser the way cookies are, which sidesteps classic CSRF,
but this wasn't independently pen-tested); account deletion / data export (categories 79–80
in the original spec) have no endpoint.

**Problems:** none currently known in what was built — this is the most rigorously tested
addition in the project's history, specifically because it's securit­y-critical. The
honest remaining risk is the same class as anywhere else in this app: nothing here has
been reviewed by anyone other than the author.

**Next action:** organizations, if genuinely needed, is the natural next slice — the schema
already has a place for `organization_id` to avoid a second migration.

---

### 3. AI Model Providers

**Status:** IMPLEMENTED (Gemini), PARTIAL (DeepSeek, Ollama — implemented but never
verified against their real APIs), TESTED (Gemini specifically)

**Implementation:**
- `server/src/services/llmProvider.ts` — the interface
- `server/src/services/providers/gemini.ts`, `deepseek.ts`, `ollama.ts` —
  implementations
- `server/src/services/providers/openaiCompatible.ts` — shared streaming client for
  DeepSeek/Ollama
- Selection via `LLM_PROVIDER` env var in `llm.ts`

**Evidence:** Gemini chat verified live repeatedly (curl + browser) throughout this
project. DeepSeek and Ollama are real, complete implementations against documented API
shapes, but **no DeepSeek API key and no local Ollama instance have ever been available in
this environment to run an actual request through them** — they are unverified, not fake.

**Missing:** cost tracking, token usage tracking, provider health checks, no Claude
provider (intentionally removed). Automatic fallback now exists in one narrow, real form —
see category 1 — but only for Gemini's own grounding-tool failure, not a general "Gemini
down, try DeepSeek" cross-provider fallback; if the *active* provider itself errors, the
request still just fails.

**Problems:** none in the code itself; the honest status is "correct-looking code, two of
three providers never actually exercised."

**Next action:** get a DeepSeek key and a local Ollama instance running, send one real
message through each, confirm end to end. This is a fast, low-risk verification, not new
implementation.

---

### 4. Model Router

**Status:** NOT STARTED (beyond a static switch)

**Implementation:** `LLM_PROVIDER` env var picks one provider for *all* chat traffic.

**Missing:** any actual *model* routing logic — nothing considers task complexity, latency,
cost, or context size per-request; changing providers means changing an env var and
restarting the server, not a live per-request decision. Worth distinguishing from what
category 1 now has: Gemini's own per-turn decision to invoke (or not invoke) the
`googleSearch` tool is real *tool* routing, but it's the model reasoning about one binary
choice on a fixed provider — not model routing in the sense this category means (e.g.
sending trivial queries to a cheaper model and complex ones to a stronger one).

**Next action:** not worth building until there's a second real reason to route (e.g. a
genuinely cheap/fast model for trivial queries vs. a stronger one for complex ones) — right
now Gemini alone handles every request type this app has.

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

**Missing:** no authentication (nothing to authorize, see category 2), no rate limiting at
all (a single client can hammer `/api/chat` with no throttling), no SSRF protection (moot —
no tool fetches arbitrary URLs on the user's behalf), no prompt-injection-specific defenses
beyond the system prompt's general instructions (uploaded document content is passed to
the model as context with no sanitization against embedded instructions — untested whether
a malicious PDF could influence model behavior), no CSRF protection (moot for a
same-origin/CORS-locked API with no cookies/sessions), no secrets manager (env vars only,
appropriate at this scale), no encryption at rest for the SQLite file.

**Problems:** the untested prompt-injection surface via uploaded documents is worth
flagging as a real, unverified risk, not a theoretical one — this app explicitly puts
untrusted user-uploaded text directly into the LLM's context.

**Next action:** rate limiting (e.g. `express-rate-limit`) is a small, high-value,
near-zero-risk addition given the app is now publicly deployed. Prompt-injection testing
(deliberately upload a document containing "ignore previous instructions…" and see what
happens) would be cheap and informative.

---

### 37. Observability

**Status:** NOT STARTED

**Missing:** no structured logging, no metrics, no traces, no token/cost tracking, no
latency tracking beyond what's visible in ad hoc `console.log`/error output during manual
testing.

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

**Status:** NOT STARTED (as an automated suite) — extensively manually verified

**Implementation:** zero files matching `*.test.*`/`*.spec.*`, no test runner configured
in either `package.json`.

**Evidence of manual verification instead:** this project's history includes real,
repeated verification via TypeScript compilation, live curl requests against every
endpoint, and Playwright-driven browser sessions (including a deterministic fake-
`SpeechRecognition` rig used to test the entire voice conversation flow without real
microphone hardware) — but none of this is captured as a repeatable, committed test suite.
Every verification claim in this document that says "tested" means "manually exercised and
observed to work at the time," not "covered by a test that will catch a future regression."

**Next action:** this is a real gap given how much manual re-verification has been needed
across this project's history (e.g., the same voice states re-verified multiple times
after each redesign). At minimum, a smoke-test script hitting each API route would catch
regressions cheaply.

---

### 40. UI / UX Quality

**Status:** PARTIAL — see category 8's honest note

**Implementation:** dark mode, ChatGPT-style transcript conventions, responsive
mobile/desktop layout, a genuinely distinctive animated voice orb.

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
unformatted).

**Missing:** no retry logic anywhere (a transient 503 from Gemini just fails the request
to the user, rather than retrying once). No reconnect logic for dropped SSE streams. No
distinct "permission denied" UI state for microphone access.

**Problems:** none currently observed beyond the gaps listed.

---

## PHASE 5 — Automatic Gap Analysis

### EXECUTIVE SUMMARY

- **Total requirement categories audited:** 41
- **IMPLEMENTED or TESTED:** 6 (categories 1 partial-toward-implemented, 3, 5, 6, 7, 8, 12
  partial, 41 partial — see individual entries; treat this as "substantial, verified work
  exists" rather than a precise count, since most categories are partial rather than
  binary)
- **PARTIAL:** 12 (1, 2, 3, 6, 10, 11, 12/13/14 combined, 28, 33–35, 36, 40, 41)
- **NOT STARTED:** 23 of 41 categories — narrowed by one since this update: category 2
  (multi-user architecture) moved from NOT STARTED to PARTIAL with real, tested
  authentication and tenant isolation. Every category specific to Vikisol Arena's
  role-specific/marketplace identity is still NOT STARTED (15–27, 29–32, 37, 38).
- **VERIFIED against a real, working demonstration (not just code review):** conversation
  history lifecycle, Gemini chat, Gemini image generation (verified correct, blocked by
  quota), Gemini TTS (verified working, discovered the 10/day cap), the full voice
  conversation state machine including barge-in's code path and a real multi-turn no-
  wake-word exchange, and now the full authentication lifecycle — signup, login, logout,
  logout-all-devices, password reset with session revocation, email verification, and
  **tenant isolation directly confirmed with two real accounts** (see category 2).
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
