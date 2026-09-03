# Jennysol AI

Jennysol AI is a conversational assistant with persistent chat history (multiple
conversations, switch between them, like any other AI chat app), optionally grounded in
documents you upload. Also does image generation and a full hands-free voice conversation
mode — say "Hey Jenny" once, then just talk, with pause/resume/end controls and a choice
of 30 natural Gemini voices (or the free instant browser voice). Chat provider is
swappable — Gemini, DeepSeek, or a local Ollama model today.

## Architecture (v1)

```
jennysol-ai/
  client/   React + Vite + TypeScript + Tailwind — chat UI, document upload/list
    lib/speechRecognitionTypes.ts  Shared Web Speech API type shims + feature detection
    lib/useSpeechRecognition.ts    Push-to-talk mic button (one click, one utterance)
    lib/useVoiceConversation.ts     "Hey Jenny" hands-free conversation: sleeping/listening/paused state machine
    lib/voices.ts                   The 30 Gemini voice names + persisted voice selection
    lib/speak.ts                    Speaks via Gemini TTS (chosen voice) or falls back to browser speechSynthesis
  server/   Node + Express + TypeScript — REST API
    services/llm.ts                     Picks the configured LlmProvider (LLM_PROVIDER, default "gemini")
    services/llmProvider.ts             LlmProvider interface — swap/add providers without touching routes
    services/providers/gemini.ts        Gemini implementation (@google/genai, chat completion, streaming)
    services/providers/deepseek.ts      DeepSeek implementation (OpenAI-compatible REST, streaming)
    services/providers/ollama.ts        Local Ollama implementation (OpenAI-compatible REST, streaming)
    services/providers/openaiCompatible.ts  Shared streaming client used by deepseek.ts and ollama.ts
    services/providers/geminiImage.ts   Image generation (Gemini "Nano Banana" image models)
    services/providers/geminiTts.ts     Text-to-speech (Gemini TTS, raw PCM wrapped in a WAV header)
    services/embeddings.ts            Local embedding model (@huggingface/transformers, no API key needed)
    services/chunker.ts               Splits uploaded documents into overlapping text chunks
    services/vectorStore.ts           SQLite-backed store; cosine similarity search over chunk embeddings
    services/conversationStore.ts     Conversations + messages persistence (SQLite)
    routes/documents.ts                Upload, list, delete documents
    routes/chat.ts                     RAG query: embed question -> retrieve top chunks -> ask the LLM provider
    routes/conversations.ts            List conversations, fetch/delete one with its messages
    routes/image.ts                    Image generation request -> Gemini image model -> base64 image
    routes/speech.ts                   Text -> chosen Gemini voice -> base64 WAV
    db/                                better-sqlite3 database (jennysol.db, gitignored)
```

**Chat history** is server-authoritative, not client-tracked: the client sends just the
new message plus a `conversationId` (omitted for a brand-new chat — the server creates one,
lazily, only once a first message actually arrives, so clicking "New chat" and never typing
anything doesn't litter the sidebar with empty threads); the server loads that
conversation's prior turns from SQLite itself rather than trusting a resent transcript, and
persists both sides of each exchange. The sidebar's "Chats" list is the primary surface now
(matches how every other AI chat app is laid out); Documents is a collapsed, secondary
section underneath it, not the first thing you see.

Speech *recognition* (listening) is entirely browser-native (Web Speech API) — no backend,
no API key. Works in Chrome/Edge/Safari; Firefox has no `SpeechRecognition` implementation,
so both the mic button and the "Hey Jenny" control are feature-detected and hide themselves
there rather than showing something broken. Speech *output* (talking back) goes through
Gemini TTS for the natural-sounding voices, with the browser's own `speechSynthesis` as
both a selectable free/instant option and the automatic fallback if a Gemini TTS call ever
fails — voice output degrades rather than going silent.

**Voice conversation ("Hey Jenny"), redesigned around one piece of real feedback:**
repeating the wake phrase before every single turn is tedious and not how a normal
conversation works. So it only gates getting *in*: say "hey jenny" (or "hi/hello/wake up/ok
jenny") once and every following turn is heard and answered automatically — no wake phrase
needed again — until you end it. States: **sleeping** (armed, only matching the wake
phrase) → hearing it → **listening** (everything you say is sent) ⇄ **paused** (mic off,
one click to resume back into **listening** — for when you want to talk to someone else in
the room without Jenny jumping in) → **off** (fully ended). Say the wake phrase and your
first question in one breath ("hey jenny what's the capital of France") and it skips
straight to answering. The header shows one state-aware button that does the right thing
for whatever state you're in (start/pause/resume) plus a separate "end conversation" (✕)
button. Answers heard through this flow are always spoken back regardless of the separate
spoken-replies toggle — a spoken question gets a spoken answer. Continuous browser speech
recognition drops out on its own periodically (silence timeouts, network blips);
`useVoiceConversation` restarts it automatically while active, and mutes recognition during
TTS playback so the mic doesn't hear Jenny's own voice and treat it as the next command.

**Voice picker:** the speaker icon in the header opens a panel with the spoken-replies
on/off switch, a dropdown of all 30 Gemini voice names plus "Browser default," and a
Preview button that speaks a sample in whichever voice is selected before you commit to it
— their actual tone/character isn't documented anywhere reliably enough to label honestly,
so preview-by-ear is the intended way to pick, not a guessed description.

Flow: a document is uploaded -> chunked -> each chunk embedded locally -> stored in SQLite.
A chat message is embedded the same way -> top-k similar chunks are retrieved -> sent to
the configured LLM provider as context alongside the user's question -> answer streamed
back to the UI.

## Prerequisites

- Node.js 20+ and npm
- A Gemini API key (https://aistudio.google.com/apikey) — required regardless of which
  chat provider you use below, since image generation always goes through Gemini. Free
  tier covers chat; image generation needs a billing-enabled Google Cloud project (the
  free tier's image quota is 0 requests/day — the app tells you this clearly if you hit
  it rather than failing silently).
- Optional: a DeepSeek API key (https://platform.deepseek.com) if you set
  `LLM_PROVIDER=deepseek` to use DeepSeek for chat instead of Gemini.
- Optional: [Ollama](https://ollama.com) running locally (`ollama pull llama3.2`, or any
  model — set `OLLAMA_MODEL` to match) if you set `LLM_PROVIDER=ollama`. Ollama must be
  reachable from wherever the server process actually runs — see the note in
  `.env.example`; a cloud deploy (Railway etc.) has no cloud-hosted Ollama to fall back
  to, so this provider is realistically a local-dev-only option unless you run and expose
  an Ollama instance yourself.

## Setup

```bash
# server
cd server
cp .env.example .env   # then edit .env and set GEMINI_API_KEY
npm install
npm run dev             # http://localhost:8787

# client (separate terminal)
cd client
npm install
npm run dev              # http://localhost:5173
```

Without `GEMINI_API_KEY` set, the server still runs and document upload/search still
works (embeddings are local) — only chat requests fail, with a clear in-chat error
telling you what to fix.

## Deployment

Two supported shapes:

**Split (recommended — matches this org's Vercel + Railway pattern):** client on Vercel,
server on Railway, as separate projects/services.

- *Client → Vercel:* zero-config Vite detection. Set the project's `VITE_API_BASE_URL`
  env var to the Railway service's URL (e.g. `https://jennysol-api.up.railway.app` or a
  custom subdomain) so the built client calls the right origin.
- *Server → Railway:* set the service's Root Directory to `server`; Railway then finds
  `server/Dockerfile` (server-only image, no client build) automatically. Set
  `GEMINI_API_KEY` (required), `GEMINI_MODEL` (optional, defaults to
  `gemini-3.5-flash-lite`), and `CORS_ORIGIN` to the Vercel domain (e.g.
  `https://jennysol.vikisol.in`) so the API only accepts requests from that origin.
- Railway's free/starter tiers don't guarantee a persistent disk on redeploy — uploaded
  documents and the SQLite DB may reset then; fine for v1, revisit (e.g. a Railway volume)
  before treating uploads as durable.

**Single service (simplest, e.g. local Docker or a single-host deploy):** the server
serves the built client itself (`server/src/index.ts` serves `client/dist` and falls back
to it for any non-`/api` route), so one process can host both. Use the root `Dockerfile`
(builds both client and server) for this shape — not `server/Dockerfile`, which is
server-only and expects a separately-hosted frontend:

```bash
docker build -t jennysol-ai .
docker run -p 8787:8787 -e GEMINI_API_KEY=... jennysol-ai
```

Or manually on any Node host:

```bash
npm run install:all   # installs server + client deps
npm run build          # builds client, then server
GEMINI_API_KEY=... npm start
```

In this shape, leave `VITE_API_BASE_URL` and `CORS_ORIGIN` unset (both default to
same-origin behavior).

## Switching or adding a model provider

`server/src/services/llmProvider.ts` defines the `LlmProvider` interface; `services/llm.ts`
picks an implementation from `LLM_PROVIDER` (default `"gemini"`). To add another provider
(a different vendor, or a second Gemini tier for cheap/fast routing), implement
`LlmProvider` in `services/providers/`, register it in the `providers` map in `llm.ts`, and
set `LLM_PROVIDER` — nothing in `routes/chat.ts` or the client needs to change.

## Known accepted risk

`npm audit` in `server/` reports advisories with no available fix: `adm-zip` and `sharp`
(nested inside `@huggingface/transformers`'s ONNX runtime dependency chain — neither is
reachable through any code path this app exercises, since no ZIP or image input is ever
processed) and `qs` (nested inside `express`'s `body-parser` dependency — the patched
version falls outside the range `express@4.x` allows, so it needs an `express` major
version bump to actually resolve; not attempted here as out of scope for this change).
Revisit before any deployment that changes those code paths or upgrades `express`.

## Status

v1: persistent multi-conversation chat history + document upload/chunking/local
embeddings/vector search + chat (Gemini, DeepSeek, or Ollama) + image generation + a full
hands-free voice conversation mode (30 selectable Gemini voices + browser fallback,
pause/resume/end controls), with a ChatGPT-style UI (dark mode, chats-first sidebar with
documents collapsed underneath, markdown rendering, source citations, responsive layout)
and a warmer, more conversational system-prompt persona. Built, typechecked, and
browser-smoke-tested locally end to end, including: live Gemini chat responses; live Gemini
TTS audio generation and playback (real WAV verified — correct format, correct sample rate,
plays back; this one actually works on the current API key's plan, unlike image generation
below); the full voice-conversation button state cycle (sleeping → paused → resumed →
ended); and the full conversation lifecycle (create on first message, appear in the
sidebar, switch between threads and correctly reload each one's history, delete). That last
test also caught and fixed a real race condition — switching to "New chat" while a response
was still streaming used to crash by mutating a message array that had just been reset;
there's now a generation counter that makes an abandoned in-flight request's callbacks
no-ops instead. Image generation is code-complete and verified against the real API
(correct model name, correct request/response handling) but blocked in this environment by
the API key's free-tier quota (0 image requests/day) rather than by a bug. DeepSeek and
Ollama are implemented but untested against their real APIs — no DeepSeek key and no local
Ollama instance were available to verify against here. Actual speech *recognition* accuracy
(hearing real spoken words correctly) is unverified — headless browser automation has no
real microphone to test with, so that needs a manual check in an actual browser; everything
downstream of recognition (the state machine, the TTS pipeline, the UI) is verified.

Explicitly not implemented, by design: Siri-style "only responds to the owner's voice"
speaker verification. That's a distinct ML capability from speech-to-text — the free/open
options (SpeechBrain, pyannote, Wespeaker) are Python research frameworks needing real
model inference, not something a browser can do or that fits this app's Node backend
without a new ML microservice; the commercial cloud options in this space have mostly been
retired (Azure's in 2025, AWS's in 2026). Faking it with something unreliable would give
false security rather than real personalization — flagged instead of half-built.

Deployed: frontend live on Vercel; backend deployment to Railway pending (see Deployment
above) — a Railway project token and cleared billing balance are needed to finish that
half.
