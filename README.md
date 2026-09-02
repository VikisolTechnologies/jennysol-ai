# Jennysol AI

Jennysol AI is a retrieval-augmented (RAG) chat assistant: upload documents, then chat
with an AI that answers using those documents as grounded context, powered by Claude.

## Architecture (v1)

```
jennysol-ai/
  client/   React + Vite + TypeScript + Tailwind — chat UI, document upload/list
  server/   Node + Express + TypeScript — REST API
    services/llm.ts          Claude client (chat completion, streaming)
    services/embeddings.ts   Local embedding model (@xenova/transformers, no API key needed)
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

## Status

v1 scaffold: document upload + chunking + local embeddings + vector search + Claude chat,
with a basic chat/upload UI. Not yet deployed; local dev only.
