# JennySol API & Environment Setup

Written 2026-09-08. Every environment variable listed here was found by grepping `process.env.*` across `server/src` — nothing invented, nothing aspirational. No secret values appear anywhere in this document; where a key is needed, this says exactly where to get one and where to put it, never what it should be.

**Never paste a real key into a chat conversation with an AI assistant.** Add it directly in Railway's dashboard (or your local `server/.env`, which is gitignored).

## Provider / capability keys

### GEMINI_API_KEY (required — primary chat provider)
- **Purpose**: chat text generation, image generation (currently blocked — see `docs/JENNYSOL_CAPABILITIES.md`), TTS, native search grounding (currently quota-blocked)
- **Official signup**: [aistudio.google.com](https://aistudio.google.com) → Get API Key
- **Free tier**: yes for plain chat completions (separate quota bucket from image generation and search grounding, which this account's tier currently has zero quota for)
- **Card required**: not for the free chat tier
- **Env var**: `GEMINI_API_KEY`
- **Railway**: `jennysol-api` service → Variables → add there
- **Local dev**: `server/.env` → `GEMINI_API_KEY=...`
- **Self-hosted alternative**: Ollama (`OLLAMA_BASE_URL`, below) — chat works with zero cloud key once Ollama is installed and a model is pulled

### TAVILY_API_KEY (optional — recommended for web search)
- **Purpose**: current-information web search
- **Official signup**: [tavily.com](https://tavily.com) → Sign Up → Dashboard → API Keys
- **Free tier**: 1,000 API credits/month (verified against Tavily's own pricing page, Sept 2026)
- **Card required**: No
- **Env var**: `TAVILY_API_KEY`
- **Railway**: `jennysol-api` service → Variables
- **Local dev**: `server/.env`
- **Self-hosted alternative**: `SEARXNG_BASE_URL` (below) — no key at all

### SEARXNG_BASE_URL (optional — self-hosted search, no key)
- **Purpose**: free/self-hosted alternative to Tavily; preferred first in the default search chain when set
- **Not a key** — this is the URL of an instance you run yourself (see `docs/JENNYSOL_FREE_FIRST_ARCHITECTURE.md` Section 3 for exact deployment options — nothing is auto-provisioned)
- **Free tier**: N/A — open source, self-hosted, no per-query cost
- **Card required**: No
- **Env var**: `SEARXNG_BASE_URL` (e.g. `http://searxng.railway.internal:8080` for a private Railway service — never a public URL)
- **Railway**: `jennysol-api` service → Variables, once an instance exists
- **Local dev**: point at a local Docker instance if you run one
- **Self-hosted**: yes — this *is* the self-hosted option

### DEEPSEEK_API_KEY (optional — secondary cloud fallback)
- **Purpose**: fallback chat provider if Gemini is unhealthy/unavailable
- **Official signup**: [platform.deepseek.com](https://platform.deepseek.com)
- **Free tier**: check DeepSeek's current pricing page directly — not independently re-verified this session (low priority: Gemini is the healthy primary today)
- **Env var**: `DEEPSEEK_API_KEY` (model override: `DEEPSEEK_MODEL`)
- **Railway / local dev**: same pattern as above
- **Self-hosted alternative**: Ollama

### OLLAMA_BASE_URL / OLLAMA_MODEL (optional — local inference, no key ever)
- **Purpose**: local, free, zero-API-key chat generation
- **Not a hosted service** — install Ollama yourself: [ollama.com/download](https://ollama.com/download)
- **Env var**: `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434` — never expose this port publicly), `OLLAMA_MODEL` (override the auto-picked model)
- **Local dev**: install Ollama, `ollama serve`, then pull a model from the curated registry in `server/src/services/models/modelRegistry.ts` (e.g. `ollama pull llama3.2:3b`)
- **Railway**: not applicable to Railway's cloud service directly — Ollama runs on your own hardware (the M1 now, the RTX 5060 Ti later), reached via private networking, never a public Railway variable pointing at a public Ollama port
- **Card required**: never — this is the free option

### LOCAL_HARDWARE_PROFILE (optional — local inference tuning)
- **Purpose**: tells the model registry which hardware profile to gate model selection against (`m1_16gb`, `dedicated_rtx5060ti_16gb`) instead of auto-detecting
- **Not a key** — a profile name
- **Env var**: `LOCAL_HARDWARE_PROFILE`

### GOOGLE_CLIENT_ID (optional — Google sign-in)
- **Purpose**: "Sign in with Google" on the frontend
- **Official signup**: [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth Client ID
- **Free tier**: this is a free Google Cloud Console feature, not a billed API
- **Env var**: `GOOGLE_CLIENT_ID`
- **Railway / local dev**: same pattern as above

## Operational tuning variables (no signup needed — not external services)

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | server listen port | `8787` |
| `CORS_ORIGIN` | comma-separated allowed frontend origins | none (same-origin only) |
| `FRONTEND_URL` | used in outbound email/redirect links | `http://localhost:5173` |
| `DEPLOYMENT_MODE` | `local` prefers Ollama first in the default provider chain | unset (cloud-first) |
| `LLM_PROVIDER_CHAIN` / `LLM_PROVIDER` | explicit ordered fallback chain, e.g. `gemini,deepseek,ollama` | `gemini` |
| `SEARCH_PROVIDER_CHAIN` | explicit search provider order | `searxng,tavily` |
| `LLM_FIRST_TOKEN_TIMEOUT_MS` / `LLM_FALLBACK_FIRST_TOKEN_TIMEOUT_MS` | per-provider failover timeouts | `10000` / `6000` |
| `LLM_HEDGE_ENABLED` / `LLM_HEDGE_DELAY_MS` | race two providers on slow first-token (off by default) | `false` / `4000` |
| `CONTEXT_RECENT_WINDOW` / `CONTEXT_SUMMARY_BATCH` | how much raw history is sent vs. summarized | `12` / `5` |
| `GUEST_PROMPT_LIMIT` | how often a guest sees the sign-up nudge | `10` |
| `SSE_HEARTBEAT_MS` | chat stream keepalive interval | `10000` |
| `GEMINI_MODEL` / `DEEPSEEK_MODEL` | model id overrides | provider defaults |
| `GEMINI_IMAGE_MODEL` / `GEMINI_TTS_MODEL` | Gemini sub-model overrides | provider defaults |
| `GEMINI_SEARCH_SOFT_TIMEOUT_MS` | Gemini native-grounding probe timeout | provider default |

## Required vs. optional, at a glance

**Required for JennySol to run at all**: `GEMINI_API_KEY` (or `DEEPSEEK_API_KEY`, or a locally running Ollama — at least one text-generation path).

**Optional, each independently additive**: `TAVILY_API_KEY` or `SEARXNG_BASE_URL` (search), `DEEPSEEK_API_KEY` (extra fallback), `GOOGLE_CLIENT_ID` (Google sign-in), `OLLAMA_BASE_URL`/`LOCAL_HARDWARE_PROFILE` (local inference).

**Never required**: weather, current date/time, timezone, embeddings/RAG, and creator identity all work with zero keys — see `docs/JENNYSOL_FREE_FIRST_ARCHITECTURE.md`.

**Check live configuration status** (never reveals values): `GET /api/admin/config-health`, admin-authenticated — see `capabilityRegistry.ts`.
