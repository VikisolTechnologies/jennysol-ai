# Jennysol AI

Jennysol AI is a retrieval-augmented (RAG) chat assistant: upload documents, then chat
with an AI that answers using those documents as grounded context, powered by Claude.

## Architecture (v1)

```
jennysol-ai/
  client/   React + Vite + TypeScript + Tailwind — chat UI, document upload/list
  server/   Node + Express + TypeScript — REST API
    services/llm.ts          Claude client (chat completion, streaming)
    services/embeddings.ts   Local embedding model (@huggingface/transformers, no API key needed)
    services/chunker.ts      Splits uploaded documents into overlapping text chunks
    services/vectorStore.ts  SQLite-backed store; cosine similarity search over chunk embeddings
    routes/documents.ts      Upload, list, delete documents
    routes/chat.ts           RAG query: embed question -> retrieve top chunks -> ask Claude
    db/                      better-sqlite3 database (jennysol.db, gitignored)
```

Flow: a document is uploaded -> chunked -> each chunk embedded locally -> stored in SQLite.
A chat message is embedded the same way -> top-k similar chunks are retrieved -> sent to
Claude as context alongside the user's question -> answer streamed back to the UI.

## Prerequisites

- Node.js 20+ and npm
- An Anthropic API key (https://console.anthropic.com/) — required, put it in `server/.env`

## Setup

```bash
# server
cd server
cp .env.example .env   # then edit .env and set ANTHROPIC_API_KEY
npm install
npm run dev             # http://localhost:8787

# client (separate terminal)
cd client
npm install
npm run dev              # http://localhost:5173
```

## Known accepted risk

`npm audit` in `server/` reports two "no fix available" advisories (`adm-zip`, `sharp`)
nested inside `@huggingface/transformers`'s ONNX runtime dependency chain. Neither is
reachable through any code path this app exercises (no ZIP or image input is ever
processed) — tracked here rather than silently ignored, revisit before any deployment
that changes that.

## Status

v1 scaffold: document upload + chunking + local embeddings + vector search + Claude chat,
with a basic chat/upload UI. Built, typechecked, and smoke-tested locally (upload →
chunk → embed → store → retrieve pipeline confirmed working end to end). Not yet
deployed; local dev only. Chat requires `ANTHROPIC_API_KEY` to be set.
