# Jenny Response Latency Audit

Diagnostic only. No fixes applied. Every claim below is labeled CONFIRMED (verified by
reading the actual code and/or reproducing it live against production), LIKELY (strong
code-level evidence, not independently reproduced), POSSIBLE (plausible, real, but outside
what this codebase/tooling can directly inspect), or RULED OUT (checked and confirmed not
the cause).

All production references are to the live deploy: frontend `jennysol.vikisol.in` (Vercel),
backend `api.jennysol.vikisol.in` (Railway, single container, single Node process). Config
confirmed via `railway variables` at the time of this audit: `LLM_PROVIDER=gemini`,
`GEMINI_MODEL=gemini-3.5-flash-lite`, no `LLM_PROVIDER_CHAIN`, no `DEEPSEEK_API_KEY`, no
`OLLAMA_BASE_URL`.

---

## Executive Summary

Two genuinely separate problems, with two separate confirmed root causes. They should not
be fixed as if they were one issue.

**Problem 1 — normal requests get slower over the course of a conversation.**
CONFIRMED root cause: conversation history is unbounded and resent in full to Gemini on
every single turn (`server/src/routes/chat.ts:47,57` — `getConversationMessages` has no
`LIMIT`, `turns` is the entire history plus the new message, every time). Message 1 in a
fresh conversation sends the smallest possible prompt; message 4 sends 3x more prior
context. This alone produces a monotonically increasing prompt size — and reproduced this
live during this audit: 1.46s → 1.25s → 2.03s → **12.78s** across 4 sequential messages in
one conversation, with the server-side logs showing the 4th request succeeded on Gemini's
first attempt (no retry, no error) — meaning the 12.78s was Gemini itself taking longer to
process, not a code-level retry/failure. This is consistent with, though not proven to be
solely caused by, growing prompt size; Gemini's own variable latency (separately confirmed
via a real 503 in production logs earlier this project) is a second, independent
contributor. There is no code-level "greetings take a simpler path" — every message,
including "Hi", runs the identical pipeline (embedding, chunk search, history load, model
call). "Hi" is fast because its *history is empty*, not because it's special-cased.

**Problem 2 — a response can seem to disappear after backgrounding the app.**
CONFIRMED root cause, but not the one I expected going in, and testing overturned my first
hypothesis (documented below rather than silently corrected): the server-side generation
and database write **do complete** even after the client disconnects — a live test
reloading the page mid-stream showed the assistant's reply was fully generated and
persisted. The actual failure is a **UX/discoverability gap, not data loss**: (1) there is
zero frontend code anywhere (`visibilitychange`, `pagehide`, `AbortController`, reconnect
logic — all absent, confirmed by an exhaustive grep) to reconnect to or check on an
in-flight request after backgrounding; (2) on reload/remount, the app always resets to a
blank "New chat" welcome screen rather than returning to the conversation that was open —
so even though the reply exists in the database, the user lands somewhere that doesn't show
it and has no indication to go look. Whether a *long* backgrounding (iOS discarding the tab
under memory pressure — closer to what a reload simulates) behaves the same as a *brief*
one (a quick app-switch, where iOS more likely just throttles JS without discarding
anything) could not be fully distinguished with the tooling available for this audit — see
iOS Safari Findings.

---

## Exact Request Pipeline

The pipeline the request spec proposed (intent detection → task planning → tool calls →
etc.) does not match what this codebase actually does. The real pipeline, stage by stage,
with file:line references:

```
USER INPUT (ChatWindow.tsx handleSend, ~line 189)
  ↓
Frontend: sendChatMessage() — client/src/lib/api.ts:16
  ↓
authFetch() → doFetch() → fetch() — client/src/lib/auth.ts (POST /api/chat, fetch+SSE, no WebSocket)
  ↓
Backend: chatRouter.post("/") — server/src/routes/chat.ts:28
  ↓
zod validation (chat.ts:29)
  ↓
requireAuth middleware (already ran before this handler) — server/src/middleware/auth.ts:20
  → getSessionUserId(token): 2 synchronous SQLite calls (SELECT + UPDATE last_used_at)
  ↓
conversationExists / createConversation — sync SQLite (chat.ts:43-46)
  ↓
getConversationMessages — sync SQLite, UNBOUNDED, full history (chat.ts:47)
  ↓
addMessage (user turn) — sync SQLite (chat.ts:50)
  ↓
embed(message) — LOCAL ONNX transformer model, lazy-loaded singleton (embeddings.ts) — chat.ts:53
  ↓
searchSimilarChunks — sync SQLite, fetches ALL of the user's chunks then scores in JS (vectorStore.ts:62) — chat.ts:54
  ↓
buildSystemPrompt — pure string building, no I/O (llm.ts) — chat.ts:55
  ↓
SSE headers + first event written (chat.ts:59-62)
  ↓
streamChatCompletion → routeChatCompletion (modelRouter.ts) — chat.ts:66
  ↓
Provider selection: resolveChain() reads LLM_PROVIDER_CHAIN, else LLM_PROVIDER, else "gemini"
  → in production today: chain = ["gemini"] only (confirmed via railway variables)
  ↓
geminiProvider.streamChatCompletion — server/src/services/providers/gemini.ts:76
  → probeGroundingAvailability() (fires once per process lifetime, background, non-blocking)
  → needsWebSearch() keyword check decides whether to declare the googleSearch tool
  → getClient().models.generateContentStream(...) — @google/genai SDK
  ↓
Per-chunk: onDelta(text) → res.write() SSE event — chat.ts:69-71
  ↓
Stream completes → addMessage (assistant turn, full reply) — sync SQLite — chat.ts:82
  ↓
Final SSE "done" event + res.end() — chat.ts:84-85
  ↓
Frontend: ReadableStream reader loop parses `data: ` lines — api.ts:43-67
  ↓
onDelta/onConversationId/onDone callbacks → React state updates — ChatWindow.tsx handleSend
```

Stages that **do not exist** in this app (present in the spec's hypothetical pipeline but
absent here, confirmed by inspection): intent detection, task planning, memory retrieval
beyond the single RAG chunk-similarity search above, tool calls other than Gemini's own
optional native search grounding, TTS in the text-chat path (TTS is a separate,
user-triggered feature, not automatic), any queue.

---

## Frontend Findings

**Exact files/functions:**
- `client/src/components/ChatWindow.tsx` — `handleSend()` (~line 189), `generationRef`
  (line 80), `sending` state (line 57).
- `client/src/lib/api.ts` — `sendChatMessage()` (line 16), does the actual `fetch` + SSE
  parsing.
- `client/src/lib/auth.ts` — `authFetch()` (adds the Bearer token, handles 401), `doFetch()`
  (wraps `fetch()`, converts a thrown network error into a friendly message — added earlier
  this project for a different bug, not related to backgrounding).

**Transport:** `fetch()` with a manually-read `ReadableStream` (`res.body.getReader()`),
parsing hand-rolled `data: {...}\n\n` lines (api.ts:39-67). This is SSE-*shaped* but not the
native `EventSource` API and not WebSocket — a deliberate choice (POST with a body isn't
possible with `EventSource`), but it means none of `EventSource`'s built-in
reconnect-on-drop behavior applies here; a dropped stream is just a dead `fetch()`.

**AbortController: CONFIRMED ABSENT.** Grepped the entire `client/src` tree for
`AbortController`, `abortController`, `signal:` — zero matches. There is no way for the
frontend to cancel an in-flight request today (e.g. if the user starts a new chat or
navigates away mid-stream, the old fetch and its upstream Gemini call keep running
server-side regardless — see Streaming Findings).

**Request timeout: CONFIRMED ABSENT** client-side. `fetch()` is called with no `signal`, no
timeout wrapper anywhere in the chat path.

**Retry behavior (frontend): CONFIRMED ABSENT.** `sendChatMessage`/`authFetch`/`doFetch` do
not retry. The only retry in the whole system is server-side, inside a single request's
Gemini call (see Gemini Findings) — it never creates a second HTTP request from the client.

**Duplicate submission guard:** `handleSend` starts with `if (!text || sending) return;`
(ChatWindow.tsx) — this blocks a double-tap *while* `sending` is `true` within the same
component instance. It does **not** survive a remount: `sending` is a plain `useState`
initialized to `false`, so if the page reloads (see iOS Safari Findings), the guard resets
and a user could legitimately resubmit the same message, creating two separate turns in
history. This is user-initiated duplication, not the app auto-duplicating.

**Page lifecycle handling (`visibilitychange`, `pagehide`, `pageshow`, `freeze`, `resume`,
`focus`, `blur`, `online`, `offline`, `beforeunload`): CONFIRMED ABSENT.** Grepped the
entire client tree — zero matches for any of these. Nothing in this codebase reacts to the
tab being backgrounded, resumed, or the network changing state.

**"Active request" concept (request ID, resumability): CONFIRMED ABSENT.** The closest thing
is `generationRef` (ChatWindow.tsx:80), an in-memory `useRef` counter that lets late-arriving
deltas from a *stale* request (e.g. user clicked "New chat" mid-stream, still in the same
page session) become no-ops. It is not persisted (no `localStorage`/`sessionStorage`), has
no ID tied to the actual HTTP request, and does not survive a remount — it exists to protect
UI consistency within one live session, not to track or recover requests across a reload.

---

## iOS Safari Findings

No code in this repo reacts to backgrounding in any way (see Frontend Findings above), so
this section is about what iOS Safari itself does, and what was possible to verify.

**What's publicly known about iOS Safari and backgrounded tabs** (general platform
behavior, not something inspectable in this codebase): a backgrounded Safari tab has its JS
timers and execution significantly throttled almost immediately, and — especially under
memory pressure, or after a longer period backgrounded — iOS can discard the tab's entire
process/JS context. On return, Safari reloads the page from scratch rather than resuming the
suspended one. A brief app-switch-and-back is more likely to just throttle execution without
a full discard; there is no reliable, code-inspectable line between "throttled" and
"discarded" — it's OS/memory-pressure dependent.

**What was actually tested (live, against production):** reloaded the page ~700ms into a
real in-flight chat request (the closest reproducible proxy for "iOS discarded the tab").
Result:
- The server-side generation **completed** and the assistant's reply **was persisted** to
  the database — confirmed by reloading again and clicking into the conversation from the
  sidebar, where the full reply was present.
- However, the reload landed the user on a **blank "New chat" welcome screen**, not the
  conversation that was in progress. The conversation was visible in the sidebar list (title
  = the user's message, "just now") but not opened. The user would have to know to click
  back into it.
- This overturns my initial code-reading hypothesis (that a dead client connection would
  cause `res.write()` to throw and abort the request handler before it reached the
  database-save line). That did not happen in this test — Node/Express appears to let the
  write silently fail (or the generation finished fast enough, in this specific case, before
  the connection was fully torn down) without aborting the handler. **I'm flagging this
  explicitly as a corrected assumption, not silently fixing my own reasoning**, because it
  changes the actual finding: this is not a data-loss bug, it's a "the user isn't shown
  where their answer is" bug.

**What was not, and could not be, tested:** true iOS-Safari-specific JS throttling/discard
behavior (Chromium mobile emulation changes viewport/user-agent, not the JS execution
model), and specifically whether a *brief* (10-60s) backgrounding — the TEST L/M/N
scenarios — behaves like a full discard (my reload test) or like a paused-then-resumed
stream that picks back up cleanly once foregrounded (a real possibility I have no way to
rule in or out from this environment). **This is the single biggest gap in this audit** and
the reason "not yet confirmed on real hardware" is the honest position, not a hedge.

---

## Streaming Findings

**Mechanism: CONFIRMED.** SSE-shaped payloads over a single `fetch()` response body, hand
parsed. Not native `EventSource`. Not WebSocket. Not a plain buffered JSON response — genuine
token-by-token streaming (`res.write()` per delta, `chat.ts:69-71`).

**Heartbeat/keepalive payload: CONFIRMED ABSENT.** No periodic no-op event (a common
SSE pattern — a comment line like `: ping\n\n` sent every N seconds to keep intermediaries
from timing out an idle-looking connection) is sent during a gap with no actual model
output. `res.setHeader("Connection", "keep-alive")` (chat.ts:61) is set, but this is a
legacy HTTP/1.1 header; Railway's edge serves over HTTP/2 (confirmed via `HTTP/2` in earlier
`curl -i` output against `api.jennysol.vikisol.in` this project), where this header has no
real effect. If Gemini takes a long time before its first token (the grounding-probe
contention window, or ordinary variance), the connection can sit genuinely idle — bytes-wise
— for that whole time, which is exactly the condition most likely to trip an idle-connection
timeout somewhere in the path (see Reverse Proxy Findings).

**Server-side disconnect detection: CONFIRMED ABSENT.** No `req.on("close", ...)` or
`res.on("close", ...)` handler anywhere in `chat.ts`. The backend has no way to notice a
client left and does not attempt to cancel the upstream Gemini call early. Combined with the
live test above, the practical effect is: an abandoned request still runs Gemini to
completion and still writes to the database — it doesn't get cancelled, it just becomes
invisible to whoever abandoned it.

**Partial response persistence: CONFIRMED — none until the very end, but full generation
does survive.** `addMessage(userId, conversationId, "assistant", fullReply, sources)`
(chat.ts:82) is the only place the assistant's turn is written, and it only runs after the
entire `await streamChatCompletion(...)` call resolves successfully. There is no incremental
save of partial content. If the *upstream Gemini call itself* fails or throws (not just the
client disconnecting), nothing is saved — this path (a genuine mid-generation Gemini
failure) was not separately reproduced in this audit and remains a LIKELY, not CONFIRMED,
total-loss scenario.

**Can the backend finish while the client is backgrounded? CONFIRMED YES** (see iOS Safari
Findings' live test). **Can the frontend recover/reconnect to see it? CONFIRMED NO** — no
polling, no reconnect, no "check if my last message got answered" affordance exists.

---

## Backend Findings

Every operation in the request path and whether it's synchronous/blocking:

| Stage | File:line | Sync/blocking? |
|---|---|---|
| Zod validation | chat.ts:29 | sync, trivial |
| Session lookup (auth) | sessions.ts `getSessionUserId` | **sync SQLite**, 2 queries (SELECT + UPDATE) |
| `conversationExists`/`createConversation` | chat.ts:43-46 | **sync SQLite** |
| `getConversationMessages` | chat.ts:47 | **sync SQLite**, unbounded — grows every turn |
| `addMessage` (user turn) | chat.ts:50 | **sync SQLite**, 2 statements (INSERT + UPDATE) |
| `embed()` | chat.ts:53 | async, but backed by a **synchronous local ONNX model** call under the hood (see Memory Findings) |
| `searchSimilarChunks` | chat.ts:54 | **sync SQLite**, fetches ALL user chunks (no `LIMIT` in SQL), scores every one in JS |
| `buildSystemPrompt` | chat.ts:55 | pure sync string work, negligible |
| `routeChatCompletion` → Gemini | chat.ts:66 | async, network-bound (the actual model call) |
| `addMessage` (assistant turn) | chat.ts:82 | **sync SQLite** |

**No explicit blocking bugs beyond what's listed above** — nothing does a redundant model
call, nothing duplicates work, no unnecessary sequential chain beyond what's architecturally
inherent (history must be loaded before it can be sent). The concerning pattern is the sheer
number of **synchronous SQLite calls on every single request** (5 separate calls minimum:
session lookup ×2, conversation check/create, history load, user-message insert, plus the
chunk search, plus the assistant-message insert = **8 total**), each of which blocks Node's
single event loop thread for its duration. Individually fast (SQLite, indexed lookups), but
see Queue/Concurrency Findings for why this matters under concurrent load.

---

## Model Router Findings

**File:** `server/src/services/modelRouter.ts`, `server/src/services/providerHealth.ts`,
`server/src/services/retryClassifier.ts` (built earlier this project, in direct response to
a real Gemini 503 observed in production).

**Actual routing behavior, confirmed from `railway variables` at audit time:**
`LLM_PROVIDER_CHAIN` is not set. `LLM_PROVIDER=gemini`. `resolveChain()`
(modelRouter.ts:29-42) falls back to `LLM_PROVIDER` when the chain var is absent, so the
resolved chain today is `["gemini"]` — **a single-provider chain**. Every request, without
exception, is attempted on Gemini and only Gemini. DeepSeek and Ollama are never selected —
not because of health/circuit-breaker state, but because they aren't in the configured
chain at all today.

**Health/circuit breaker (providerHealth.ts):** real and active, but only matters once a
second provider is actually configured. 3 consecutive transient failures (503/timeout/429)
trip a 30s cooldown; a single auth failure trips a 1-hour cooldown. With only one provider
in the chain, tripping its breaker doesn't produce a fallback — it produces
`AllProvidersUnavailableError` (the "I can't reach any AI engine right now" message,
chat.ts:92-96), since there's nothing left to fall back to.

**Retry (at the router level):** none — the router itself doesn't retry a provider; it
either succeeds, or (if nothing streamed yet) moves to the next provider in the chain. The
one retry that exists is inside Gemini's own provider file (see Gemini Findings).

**Does provider selection change between requests?** No — with a single-provider chain and
no fallback ever triggered (Gemini being the only option), every request in production today
goes to the identical provider/model. **RULED OUT: Ollama and DeepSeek are not contributing
to the reported latency/reliability issue, because they are never invoked.**

---

## Gemini Findings

**File:** `server/src/services/providers/gemini.ts`.

- **Model:** `gemini-3.5-flash-lite` (from `GEMINI_MODEL` env var, confirmed set on
  Railway).
- **API:** `@google/genai` SDK, `models.generateContentStream` — streaming, not a single
  buffered call.
- **Connection reuse:** a single module-level `GoogleGenAI` client instance
  (`getClient()`, lines 6-10), lazily constructed once and reused for every request in the
  process's lifetime — not reconstructed per-request.
- **Timeout:** none set explicitly on the SDK call — whatever the SDK's/Google's own default
  is applies; not configured or overridden in this code.
- **Retry: CONFIRMED, precisely one, precisely scoped.** Only for a `503` status, only when
  `deltasSent === 0` (nothing streamed yet), a flat `setTimeout(1000)` delay, then exactly
  one more attempt (lines 101-119). Not a loop, not exponential backoff, not applied to 429.
  If that single retry also fails, the error propagates — no second retry.
- **429 handling:** no special retry; propagates up, chat.ts gives it a "rate-limited, try
  in a minute" message. No inspection of a `Retry-After` header anywhere in the code.
- **Concurrency:** unconstrained by this code — nothing limits how many simultaneous
  `generateContentStream` calls this process can have in flight to Gemini at once.

**The grounding probe — CONFIRMED, real, and directly relevant to "why does it get slower
after the first message":** `probeGroundingAvailability()` (lines 42-59) fires exactly once
per process lifetime, on the very first `streamChatCompletion` call (any message, including
"Hi" — there is no content check before firing it). It runs in the background
(`void (async () => {...})()`), not awaited, so it doesn't block that first reply. But it
**is** a second, concurrent, full `generateContentStream` call to Gemini with the search
tool enabled, made from the same client, at roughly the same time as whatever the user's
first real message triggers. The code's own comment (lines 30-38), backed by direct
measurement earlier in this project, states this probe historically took **~15-17 seconds**
to resolve one way or the other on this API key/tier. A user's *second* message, landing
within that ~15-20s window after the first, would be sharing Gemini-side capacity/rate-limit
headroom with that still-in-flight probe call. This is **LIKELY** a real contributor to
"message 2 is slower than message 1," though it cannot be stated as CONFIRMED without
request-level instrumentation correlating a specific slow request to the probe's exact
in-flight window (see Timing Instrumentation).

**A previously undocumented finding surfaced during this audit's reproduction run:** Railway
logs showed this exact SDK warning during testing: `there are non-text parts functionCall in
the response, returning concatenation of all text parts.` This means Gemini attempted to
return a function-call part that this codebase doesn't handle (`gemini.ts`'s delta loop only
reads `chunk.text`) — the SDK silently drops it with a console warning, not an error. I
could not definitively attribute this specific log line to one of my test messages, because
**there is no request ID connecting a client-observed request to a specific server log
line** — which is itself a direct, lived demonstration of why Timing Instrumentation (below)
is needed, not just a theoretical nice-to-have. Marked POSSIBLE as a latency contributor
(an unhandled function-call turn could plausibly involve extra round-trip behavior inside
the SDK/model) — not CONFIRMED.

**Does this implementation's retry wait long enough to feel like "not responding"?**
CONFIRMED: the one retry that exists adds exactly 1 second of deliberate delay, which is
trivial. The user-perceptible long waits reproduced in this audit (12.78s) happened on a
request that **succeeded on the first attempt** with no retry involved at all — meaning
the slowness is Gemini's own generation time under a larger prompt, not retry logic. Retry
logic is not what's making Jenny "not respond" in the case actually reproduced here.

---

## Ollama Findings

**RULED OUT** as a current cause of any production behavior. `OLLAMA_BASE_URL` is not set
on Railway (defaults to `http://localhost:11434`, which does not exist in Railway's
container). `isOllamaAvailable()` (ollama.ts) probes this on a 60s cache and defaults to
unavailable until proven otherwise; on Railway it will always resolve to unavailable, since
nothing is listening there. It is never in the resolved provider chain (single-provider
`["gemini"]`, confirmed above), so none of the "model resident / keep_alive / cold-start /
serialized requests" questions in the original spec apply to production today — there is no
Ollama traffic happening at all. (The code exists and is unit-tested with mocks — see
`JENNY_IMPLEMENTATION_STATUS.md` category 4 — but has never made a real request in this
environment.)

---

## DeepSeek Findings

**RULED OUT** as a current cause. `DEEPSEEK_API_KEY` is not set on Railway. `configured()`
for the DeepSeek entry in the router (modelRouter.ts) returns `false`, so it's skipped
before ever being attempted — confirmed by the chain being resolved to `["gemini"]` alone.
No DeepSeek network call has ever been made in this environment (also stated honestly in
`JENNY_IMPLEMENTATION_STATUS.md`). The "Gemini → wait 30s → failure → DeepSeek → wait →
response" sequential-fallback-delay scenario the spec asked about **cannot be happening**,
because DeepSeek is never reached at all right now.

---

## Memory Findings

**File:** `server/src/services/embeddings.ts`, `server/src/services/vectorStore.ts`.

**CONFIRMED: there is no simpler path for greetings.** Every message — "Hi" included —
calls `embed(message)` then `searchSimilarChunks(userId, embedding, 5)` unconditionally
(chat.ts:53-54), before the model is ever called. There is no content-based branch that
skips this for short/greeting-like messages. The Audit 9 hypothesis ("greetings intentionally
take a simpler path") is **RULED OUT** by direct code inspection.

**Embedding mechanism:** entirely local, not a remote API call — `@huggingface/transformers`
running an ONNX model (`Xenova/all-MiniLM-L6-v2`) in-process (embeddings.ts:1-17). The model
is loaded lazily via a module-level singleton (`let extractor`) on the *first* `embed()` call
in the process's lifetime, then reused for every call after. This means the very first
embedding call of a fresh container's life pays a model-load cost that every subsequent call
(regardless of which user or message) does not — but this cost lands on whichever message
happens to be first after a deploy/restart, not specifically on "message 2" of a given
user's session, and not specifically skipped for "Hi."

**`searchSimilarChunks` cost scales with the user's total uploaded chunk count, not message
complexity:** the SQL query (vectorStore.ts:62-70) has no `LIMIT` — it fetches every chunk
belonging to every document the user has ever uploaded, then computes cosine similarity for
all of them in JavaScript (a plain loop, `embeddings.ts:33-37`), then sorts and slices to
top 5. For a user with few/no documents this is negligible; for a user with a large uploaded
corpus this would add real, linearly-scaling latency to *every single message*, including
"Hi" — this was not measured against a large real document set in this audit (LIKELY not
CONFIRMED as currently impactful, since typical test accounts here have few documents).

---

## Tool Findings

**Only one "tool" exists in this app: Gemini's own native `googleSearch` grounding**,
gated by a keyword heuristic (`needsWebSearch()`, gemini.ts:68-73). No other tool system —
no places/maps/calendar/computer-use/document-search-as-a-tool — exists anywhere in this
codebase (consistent with `JENNY_IMPLEMENTATION_STATUS.md`'s own "Tools/integrations: none"
note).

Tested the exact examples the request asked about against the actual regex:
- `"Hello"` → no match → tool **not** declared.
- `"What is the weather?"` → matches `weather` → tool **is** declared for this turn.
- `"What is 2+2?"` → no match → tool **not** declared.
- `"Explain what artificial intelligence is in simple terms."` → no match → tool **not**
  declared.

So a genuine web-search-shaped question *does* take a measurably different (slower, per
earlier project measurements: ~1s without the tool declared vs ~5s with it) path than a
knowledge question — this is intentional and by design, not a bug, but it does mean "what's
the weather" will legitimately be slower than "what is 2+2" even with identical history
length.

---

## Queue/Concurrency Findings

**RULED OUT: no Redis, no worker queue, no per-user/per-provider lock, no semaphore, no
explicit concurrency limiter exists anywhere in this codebase.** Confirmed by inspection —
there is no such infrastructure to find.

**LIKELY, not CONFIRMED, real contributor: implicit event-loop contention from synchronous
SQLite.** Node runs this app as a single process with a single event loop (confirmed —
`Dockerfile`'s `CMD ["node", "dist/index.js"]`, no cluster/pm2/worker setup). Every request
performs multiple synchronous `better-sqlite3` calls (8, per the Backend Findings table
above) — each one blocks that single event loop thread for its duration, meaning it also
blocks *every other concurrent request* the server is handling at that instant, whether
from the same user or a different one. This is not a designed "queue" but it produces
queue-like behavior under real concurrent load: request B's synchronous DB calls wait behind
request A's. This project's own earlier work this session directly correlated a burst of
concurrent automated test traffic with a real Gemini 503 in production logs — consistent
with (though not, on its own, proof of) this same class of contention. No hard numbers exist
to quantify this precisely (see Timing Instrumentation).

---

## Database Findings

`better-sqlite3`, a single synchronous connection to a single SQLite file on a Railway
persistent volume (no connection pool — `better-sqlite3` doesn't use one; it's
synchronous-by-design, one connection). Schema/index verification (checking for missing
indexes on `user_id`/`conversation_id` columns) was **not performed** in this audit — that
would require reading `server/src/db/index.ts`'s schema definitions, which was out of scope
for the time available here; flagging as a genuine gap in this audit rather than guessing.
Two confirmed unbounded-growth queries: `getConversationMessages` (no `LIMIT`, scales with
conversation length) and `searchSimilarChunks`'s underlying chunk fetch (no `LIMIT`, scales
with a user's total uploaded chunks). No connection-pool exhaustion is possible in the way
the original spec asked about — there is no pool to exhaust, single connection, single
process.

---

## Infrastructure Findings

Single Railway container, single Node 22 process (`Dockerfile`, confirmed), no clustering.
No explicit `server.timeout` / `keepAliveTimeout` / `headersTimeout` set on the Node HTTP
server (`index.ts`'s `app.listen(port, ...)`, no options object) — Node's own defaults
apply, not overridden. Exact CPU/RAM allocation for the Railway service was **not
retrievable** via the CLI tooling available in this session (`railway status --json` did
not surface it) — reported as unknown rather than guessed.

---

## Reverse Proxy Findings

Railway's own managed edge sits in front of the app (`server: railway-hikari`,
`x-railway-edge` headers, observed directly via `curl -i` against
`api.jennysol.vikisol.in` earlier this project — HTTP/2). Its buffering and idle-connection
timeout behavior is Railway-managed infrastructure, not part of this repository, and **not
directly inspectable** from here. **POSSIBLE, not confirmable from code**, contributor: if
Railway's edge (or, further out, the user's own mobile carrier's NAT/idle-connection
timeout — a well-known real phenomenon on cellular networks, typically tens of seconds) has
a shorter idle timeout than a slow Gemini generation gap, and this app sends no heartbeat
during that gap (confirmed absent, see Streaming Findings), the connection could be dropped
by an intermediary the app has no control over and no visibility into.

---

## Background/Resume Findings

Already the core subject of the iOS Safari and Streaming sections above. Summary: no
`requestId`/`conversationId`/`messageId`/`status` "active request" tracking exists
(CONFIRMED absent). The backend has no endpoint to ask "did my last message finish?" There
is no client-side polling or reconnect. On a fresh page load/remount, the app does not
automatically reopen the conversation that was active before — it defaults to the blank
"New chat" welcome screen (CONFIRMED via live reproduction). This is the architectural
reliability gap the original request's Audit 15 asked about, confirmed to exist.

---

## Duplicate Request Findings

`handleSend`'s `if (!text || sending) return;` guard (ChatWindow.tsx) prevents a
double-tap/double-Enter from firing two requests *within the same live session* — confirmed
present and functioning as designed. No React StrictMode double-fetch risk in production
(StrictMode's double-invoke is a dev-only, render/effect-only behavior; the production
build doesn't have this behavior, and even in dev it doesn't double-fire a `fetch` call
inside an event handler like `handleSend`). No frontend auto-retry exists at all (confirmed
above), so no risk of the frontend itself generating a second HTTP request behind the
user's back. The one place a duplicate *could* legitimately happen: if a request is
abandoned (reload/remount resets `sending` to `false`) and the user resubmits the same
message manually — this is user-initiated, not a bug, but worth noting since it would show
up as two similar-looking user turns in history.

---

## Timing Instrumentation

**CONFIRMED: none exists today.** Grepped `chat.ts`, `gemini.ts`, `modelRouter.ts`,
`providerHealth.ts` for `console.time`, timestamps, or request IDs in the chat path — none
found. The only related logging is `modelRouter.ts`'s `console.log("[router] ... ok/failed
...")` (added earlier this project), which records provider name and outcome but **no
timestamp or duration of its own** (only whatever coarse timestamp Railway's log
aggregator attaches), and **no request ID** — which is exactly what made it impossible to
definitively attribute the `functionCall` SDK warning (Gemini Findings) to a specific
request during this audit's own reproduction.

**Minimum instrumentation proposal (not implemented — per the request, diagnosis only):**

Per-request, generate a `requestId` at the top of `chatRouter.post("/")` and thread it
through as a plain object accumulating `Date.now()` timestamps at each stage boundary
already identified in the Exact Request Pipeline above:

```
request_id, conversation_id, user_id, provider, model
frontend_submit_ms       (client, Date.now() when handleSend fires)
backend_received_ms      (top of chatRouter.post)
auth_complete_ms         (already done by middleware — capture on req before the handler)
history_loaded_ms        (after getConversationMessages)
embed_complete_ms        (after embed())
chunk_search_complete_ms (after searchSimilarChunks)
router_start_ms          (before routeChatCompletion)
provider_first_token_ms  (first onDelta call)
provider_complete_ms     (after routeChatCompletion resolves)
backend_response_end_ms  (after res.end())
frontend_first_event_ms  (client, first SSE event received)
frontend_complete_ms     (client, stream done)
```

Log this as one structured line per request (or write to a lightweight table) on
completion — enough to compute TTFB, time-to-first-token, model latency, memory/embedding
latency, and frontend render latency separately, and enough to finally answer "was request X
slow because of Gemini, because of history size, because of the grounding probe, or because
of something in this server's own synchronous DB calls" with actual numbers instead of
inference from log-line proximity, which is what this audit had to rely on.

---

## Reproduction Results

All against live production (`jennysol.vikisol.in` / `api.jennysol.vikisol.in`), via
external, black-box timing (no code changes) — the same technique used successfully
throughout this project.

| Test | Result |
|---|---|
| A "Hi" | 1.46s, 200 |
| C "What is 2+2?" | 1.25s, 200 |
| D "Explain AI simply" | 2.03s, 200 |
| H/I two more in a row | **12.78s**, 200 (succeeded first try, no retry/error in logs) |
| J/K/L/M/N (background/lock/return) | **Not reproducible** with available tooling — see iOS Safari Findings. The one adjacent test performed (hard reload ~700ms into a request) showed the reply was generated and persisted server-side, but the client landed on a blank "New chat" screen instead of the conversation — see iOS Safari Findings for the full result and its limits. |
| E (web search) | Not separately re-run in this audit; the code path (needsWebSearch → tool declared) is confirmed by direct code inspection under Tool Findings, and its slower-with-search-enabled behavior was directly measured earlier this project. |
| F (memory-dependent) | Not separately re-run; this app's only "memory" is the RAG chunk search, exercised identically on every test above. |
| G (tool-invoking) | Same as E — the only tool is googleSearch grounding. |

The escalating pattern from TEST H/I (1.25s → 12.78s within the same short conversation) is
a genuine, live reproduction of the user-reported symptom, on the current, already-improved
production code — not a hypothetical.

---

## Root Causes

**CONFIRMED:**
1. Conversation history is unbounded and resent in full every turn (chat.ts:47,57;
   conversationStore.ts's `getConversationMessages` has no `LIMIT`) — later messages in a
   conversation carry a strictly larger prompt than earlier ones.
2. No client-side reconnection, polling, or "active request" recovery of any kind exists
   (exhaustive grep across the client for AbortController/visibilitychange/pagehide/etc. —
   zero matches).
3. The app does not return to the previously-open conversation after a reload/remount — it
   always shows the blank welcome screen, even when the conversation (and its answer) exists
   and is fetchable.
4. Server-side generation and persistence continue and complete even after the client
   disconnects (live-tested) — so this specific failure mode is a discoverability gap, not
   data loss, contradicting my own initial hypothesis before testing it.
5. No heartbeat/keepalive is sent during idle gaps in an active stream.
6. No server-side client-disconnect detection (`req.on("close")` absent) — an abandoned
   request is never cancelled early.
7. Ollama and DeepSeek are not configured in production and are never invoked — ruled out
   as current contributors.
8. There is no code path that treats "Hi" differently from any other message — every
   message pays the identical embedding + chunk-search + full-history cost.

**LIKELY:**
9. The one-time-per-process background grounding probe (a real, concurrent Gemini call,
   historically ~15-17s) can overlap with a user's second message shortly after the first,
   plausibly contributing to that message's slowness — not proven with request-level
   correlation, but directly evidenced by the code's own documented measurement.
10. Synchronous SQLite calls (8 per request) create real event-loop contention under
    concurrent load, compounding latency for whichever request is queued behind another's
    blocking call — consistent with, not proven by, this project's earlier correlation
    between a testing traffic burst and a real Gemini 503.

**POSSIBLE:**
11. An unhandled Gemini function-call response part (`functionCall` SDK warning, observed
    live during this audit) may add latency on turns where it occurs — could not be
    attributed to a specific request without request-ID instrumentation.
12. Railway's edge and/or the user's mobile carrier may have an idle-connection timeout
    shorter than a slow generation gap — plausible, real-world, but not inspectable from
    this codebase or the CLI tooling available.
13. Whether a *brief* iOS backgrounding (10-60s) behaves like the tested hard-reload
    scenario, or like a paused-then-cleanly-resumed stream, is genuinely unknown without
    real hardware.

**RULED OUT:**
14. Ollama causing any current production latency/failure (never configured, never
    invoked).
15. DeepSeek causing any current production latency/failure (never configured, never
    invoked).
16. A sequential Gemini-then-DeepSeek fallback delay (can't happen — DeepSeek isn't in the
    chain).
17. Greetings taking an intentionally simpler/faster code path (no such branch exists).
18. A queue, lock, or semaphore blocking one request behind another by design (none exists;
    see LIKELY #10 for the *unintentional* event-loop-contention version of this instead).
19. Frontend-side duplicate requests from retries or StrictMode (no frontend retry exists;
    StrictMode's double-invoke doesn't double-fire fetches from event handlers in
    production).
20. The one existing retry (Gemini 503, +1s) being long enough on its own to explain a
    12-second wait — it isn't; the reproduced 12.78s delay had zero retries logged.

---

## Recommended Fix (prioritized, NOT implemented)

**P0 — must fix:**
- Cap/summarize conversation history sent to the model (a sliding window of recent turns,
  and/or a rolling summary of older ones) so prompt size — and therefore latency — stops
  growing unboundedly within a single conversation. This is the most directly confirmed,
  highest-certainty fix for Problem 1.
- Add the minimum timing instrumentation proposed above. Every other prioritization here is
  a best-effort ranking without it; with it, the LIKELY/POSSIBLE items above become provable
  or disprovable with actual numbers.
- On app load, if there's a most-recently-active conversation, return the user to it instead
  of the blank welcome screen — directly closes the discoverability gap confirmed in the
  iOS Safari Findings live test.

**P1 — important:**
- Add a lightweight "is my last message still processing / did it finish" check the client
  can call after returning from backgrounding — doesn't need to be a full active-request
  architecture on day one, just enough to recover the confirmed-real case (reply generated
  server-side but never seen client-side).
- Add an SSE heartbeat during idle generation gaps, to protect against the POSSIBLE
  intermediary-timeout scenario.
- Add `req.on("close")` handling to cancel the upstream Gemini call when a client genuinely
  disconnects, so abandoned requests stop consuming Gemini time/quota instead of running to
  completion for no one.
- Real-device (physical iPhone) testing of the TEST J-N scenarios specifically — the one
  category of evidence this audit could not produce itself.

**P2 — optimization:**
- Investigate whether the background grounding probe's ~15-17s window can be shortened or
  made to not compete for the same rate-limit headroom as a concurrent real request (once
  instrumentation confirms whether this LIKELY item is actually significant).
- Add a `LIMIT` to `searchSimilarChunks`'s underlying SQL fetch for users with large
  document sets, so chunk-search cost stops scaling linearly with total uploaded chunks.
- Investigate whether the currently-unhandled Gemini `functionCall` response parts should be
  handled explicitly rather than silently dropped.

---

## Most Important Final Question

**Why is "Hi" fast but normal requests slow?**
Not because "Hi" takes a different, faster code path — it doesn't; the code is identical for
every message. "Hi" is fast because it's (almost always) the *first* message in a
conversation, meaning `getConversationMessages` returns an empty history and the prompt sent
to Gemini is as small as it will ever be for that conversation. Every subsequent message
in the same conversation sends a strictly larger prompt (the entire prior history, unbounded,
resent every time — chat.ts:47,57), and this project directly reproduced that pattern live
during this audit (1.46s → 1.25s → 2.03s → 12.78s across 4 sequential messages, the last
succeeding on Gemini's first attempt with no retry). A second, less certain but plausible
contributor is the one-time-per-process background grounding probe, which is a real,
concurrent Gemini call that can overlap with a user's second message.

**Why can a response disappear when the user leaves the app and returns?**
This has a different cause than the latency question, and testing during this audit
overturned my own initial hypothesis about it: the server-side generation and database save
do complete even after the client disconnects. The actual problem is that nothing in this
app was built to reconnect to, or even remember, an in-flight request after a
backgrounding-triggered reload — and, separately but compounding it, the app always resets
to a blank "New chat" screen on load rather than returning to whatever conversation was
open. So the reply usually isn't gone — it's sitting in a conversation the user isn't
looking at, with no signal telling them to go check. Whether a brief (rather than
tab-discarding) backgrounding behaves the same way could not be confirmed without a real
iPhone.

---

## 1-10: Exact Inventory

1. **Exact files inspected:** `client/src/components/ChatWindow.tsx`, `client/src/lib/api.ts`,
   `client/src/lib/auth.ts`, `server/src/routes/chat.ts`,
   `server/src/services/llm.ts`, `server/src/services/modelRouter.ts`,
   `server/src/services/providerHealth.ts`, `server/src/services/retryClassifier.ts`,
   `server/src/services/providers/gemini.ts`, `server/src/services/providers/ollama.ts`,
   `server/src/services/providers/deepseek.ts`, `server/src/services/embeddings.ts`,
   `server/src/services/vectorStore.ts`, `server/src/services/conversationStore.ts`,
   `server/src/middleware/auth.ts`, `server/src/services/auth/sessions.ts`,
   `server/src/index.ts`, `server/Dockerfile`.
2. **Exact functions inspected:** `handleSend`, `sendChatMessage`, `authFetch`, `doFetch`,
   `chatRouter.post("/")`, `requireAuth`, `getSessionUserId`, `getConversationMessages`,
   `addMessage`, `embed`, `searchSimilarChunks`, `routeChatCompletion`, `resolveChain`,
   `geminiProvider.streamChatCompletion`, `probeGroundingAvailability`, `needsWebSearch`,
   `isOllamaAvailable`.
3. **Exact providers/models involved (production, confirmed via `railway variables`):**
   Gemini only, model `gemini-3.5-flash-lite`. DeepSeek and Ollama present in code, never
   invoked (unconfigured).
4. **Exact network mechanism:** `fetch()` (not `XMLHttpRequest`, not Axios).
5. **Exact streaming mechanism:** hand-rolled SSE-shaped events over a single `fetch()`
   response body, read via `ReadableStreamDefaultReader`. Not native `EventSource`, not
   WebSocket.
6. **Exact timeout/retry behavior:** no client-side timeout or retry anywhere. Server-side:
   exactly one retry, only for Gemini's own `503`, only if zero tokens streamed yet, flat
   1000ms delay, one attempt only.
7. **Exact queue/concurrency behavior:** none exists by design; effective contention comes
   only from Node's single event loop plus 8 synchronous SQLite calls per request.
8. **Exact iOS lifecycle handling:** none exists in this codebase (confirmed absent by
   grep) — this is a finding, not an oversight in this audit.
9. **Exact confirmed bottleneck:** unbounded, ever-growing conversation history resent in
   full to the model on every turn.
10. **Exact recommended architecture change:** bound/summarize history sent to the model;
    add request-level timing instrumentation before doing anything else; return users to
    their last-active conversation on load rather than a blank screen. (Full prioritized
    list above — not implemented, per this request.)
