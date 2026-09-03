# Jennysol AI

Jennysol AI is a retrieval-augmented (RAG) chat assistant: upload documents, then chat
with an AI that answers using those documents as grounded context, powered by Gemini.

## Architecture (v1)

```
jennysol-ai/
  client/   React + Vite + TypeScript + Tailwind — chat UI, document upload/list
  server/   Node + Express + TypeScript — REST API
    services/llm.ts              Picks the configured LlmProvider (LLM_PROVIDER, default "gemini")
    services/llmProvider.ts      LlmProvider interface — swap/add providers without touching routes
    services/providers/gemini.ts Gemini implementation (@google/genai, chat completion, streaming)
    services/embeddings.ts       Local embedding model (@huggingface/transformers, no API key needed)
    services/chunker.ts          Splits uploaded documents into overlapping text chunks
    services/vectorStore.ts      SQLite-backed store; cosine similarity search over chunk embeddings
    routes/documents.ts          Upload, list, delete documents
    routes/chat.ts               RAG query: embed question -> retrieve top chunks -> ask the LLM provider
    db/                          better-sqlite3 database (jennysol.db, gitignored)
```

Flow: a document is uploaded -> chunked -> each chunk embedded locally -> stored in SQLite.
A chat message is embedded the same way -> top-k similar chunks are retrieved -> sent to
the configured LLM provider as context alongside the user's question -> answer streamed
back to the UI.

## Prerequisites

- Node.js 20+ and npm
- A Gemini API key (https://aistudio.google.com/apikey) — free tier available, required
  for chat. Put it in `server/.env`.

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

v1: document upload + chunking + local embeddings + vector search + Gemini chat, with a
polished chat/upload UI (dark mode, drag-and-drop upload, markdown rendering, source
citations, responsive layout). Built, typechecked, and browser-smoke-tested locally
(upload → chunk → embed → store → retrieve pipeline, and the chat UI's request/streaming/
error paths, all confirmed working end to end, including a live Gemini response). Ready to
deploy split across Vercel + Railway or as a single Docker service (see Deployment above);
not yet deployed to a live URL. Chat requires `GEMINI_API_KEY` to be set — without it,
everything else still works and the UI explains what's missing instead of failing
silently.
