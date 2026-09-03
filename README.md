# Jennysol AI

Jennysol AI is a retrieval-augmented (RAG) chat assistant: upload documents, then chat
with an AI that answers using those documents as grounded context. Also does image
generation and voice input/output, including hands-free "Hey Jenny" wake-word activation.
Chat provider is swappable — Gemini, DeepSeek, or a local Ollama model today.

## Architecture (v1)

```
jennysol-ai/
  client/   React + Vite + TypeScript + Tailwind — chat UI, document upload/list
    lib/speechRecognitionTypes.ts  Shared Web Speech API type shims + feature detection
    lib/useSpeechRecognition.ts    Push-to-talk mic button (one click, one utterance)
    lib/useWakeWord.ts              Always-on "Hey Jenny" listening (continuous recognition + wake-phrase match)
    lib/speak.ts                    Browser speechSynthesis wrapper (spoken replies)
  server/   Node + Express + TypeScript — REST API
    services/llm.ts                     Picks the configured LlmProvider (LLM_PROVIDER, default "gemini")
    services/llmProvider.ts             LlmProvider interface — swap/add providers without touching routes
    services/providers/gemini.ts        Gemini implementation (@google/genai, chat completion, streaming)
    services/providers/deepseek.ts      DeepSeek implementation (OpenAI-compatible REST, streaming)
    services/providers/ollama.ts        Local Ollama implementation (OpenAI-compatible REST, streaming)
    services/providers/openaiCompatible.ts  Shared streaming client used by deepseek.ts and ollama.ts
    services/providers/geminiImage.ts   Image generation (Gemini "Nano Banana" image models)
    services/embeddings.ts            Local embedding model (@huggingface/transformers, no API key needed)
    services/chunker.ts               Splits uploaded documents into overlapping text chunks
    services/vectorStore.ts           SQLite-backed store; cosine similarity search over chunk embeddings
    routes/documents.ts                Upload, list, delete documents
    routes/chat.ts                     RAG query: embed question -> retrieve top chunks -> ask the LLM provider
    routes/image.ts                    Image generation request -> Gemini image model -> base64 image
    db/                                better-sqlite3 database (jennysol.db, gitignored)
```

Voice is entirely browser-native (Web Speech API) — no backend, no API key, no extra
vendor. Works in Chrome/Edge/Safari; Firefox has no `SpeechRecognition` implementation, so
both the mic button and the "Hey Jenny" toggle are feature-detected and hide themselves
there rather than showing a broken control. Spoken-reply output (`speechSynthesis`) is more
broadly supported and unaffected.

"Hey Jenny" (also "hi jenny" / "hello jenny" / "wake up jenny" / "ok jenny") toggles
always-on listening: sleeping (only listening for the phrase) -> hearing it flips to awake
(your next sentence is sent as the actual question) -> back to sleeping once answered.
Say the wake phrase and your question in one breath ("hey jenny what's the capital of
France") and it skips straight to sending. Answers triggered this way are always spoken
back, regardless of the separate spoken-replies toggle — a spoken question gets a spoken
answer. Continuous browser speech recognition drops out on its own periodically (silence
timeouts, network blips); `useWakeWord` restarts it automatically while enabled, which is
what makes it "always" listening rather than "listening until the browser stops it."

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

v1: document upload + chunking + local embeddings + vector search + chat (Gemini,
DeepSeek, or Ollama), image generation, and browser-native voice input/output including
"Hey Jenny" wake-word activation, with a ChatGPT-style UI (dark mode, drag-and-drop
upload, markdown rendering, source citations, responsive layout). Built, typechecked, and
browser-smoke-tested locally end to end, including live Gemini chat responses and the
wake-word toggle's on/off/permission flow; image generation is code-complete and verified
against the real API (correct model name, correct request/response handling) but blocked
in this environment by the API key's free-tier quota (0 image requests/day) rather than by
a bug. DeepSeek and Ollama are implemented but untested against their real APIs — no
DeepSeek key and no local Ollama instance were available to verify against here. Wake-word
voice recognition itself is also unverified beyond the toggle/permission flow — headless
browser automation can't simulate real microphone audio, so real-world recognition
accuracy needs a manual check in an actual browser.

Deployed: frontend live on Vercel; backend deployment to Railway pending (see Deployment
above) — a Railway project token and cleared billing balance are needed to finish that
half.
