# JennySol — Required Provider Configuration

What's genuinely missing, why it matters, and how to add it — written so the founder can act on
this without pasting a secret into chat or a repo. No secret values appear anywhere in this
document; every status below was read from environment variable *presence*, never their contents.

## Current production status (Railway, `jennysol-ai-api` project, `jennysol-api` service)

| Variable | Status | What it gates |
|---|---|---|
| `GEMINI_API_KEY` | CONFIGURED | The only chat provider currently active in production. |
| `DEEPSEEK_API_KEY` | **NOT CONFIGURED** | DeepSeek is fully implemented in code (`server/src/services/providers/deepseek.ts`) and already declared in `server/.env.example` — it is a config-only gap, not a code gap. |
| `TAVILY_API_KEY` | CONFIGURED | Live web search / current-info grounding. |
| `SERVICE_TOKEN_SECRET_ARENA` | CONFIGURED | JennySol↔Arena agent-gateway integration — unrelated to chat providers, do not touch. |
| `OLLAMA_BASE_URL` / Ollama reachability | Not applicable to Railway | Railway's container has no path to reach Ollama on this Mac — see [Mac vs. Railway](#mac-vs-railway-what-ollama-can-and-cannot-do-today) below. |
| `LLM_PROVIDER_CHAIN` | Not set (defaults to `gemini` alone) | See [Root cause](#why-production-said-all-ai-engines-unavailable). |

## Why production said "all AI engines unavailable"

Confirmed directly from `server/src/services/modelRouter.ts` and this Mac's own `railway logs`
output (not guessed): with only `GEMINI_API_KEY` configured and `LLM_PROVIDER_CHAIN` unset, the
router's fallback chain resolves to exactly one entry — `["gemini"]`. Real production traffic this
same day hit a real Gemini `RESOURCE_EXHAUSTED` (429 quota) failure and a real 10-second
first-token timeout. With no second provider configured, there is nothing to fall back to, so the
router correctly (this is the router working as designed, not a bug) throws
`AllProvidersUnavailableError`, which `chatRunner.ts` turns into the friendly
"I can't reach any AI engine right now" message the user saw.

**This is a single-point-of-failure configuration gap, not a router defect.** The router's
fallback/circuit-breaker/hedging machinery is already real and already tested — it simply has
nothing to fail over to today.

## What to add

### 1. `DEEPSEEK_API_KEY` — recommended, highest-value fix available today

- **Why**: gives production a real second cloud provider. A Gemini quota/timeout failure would then
  fail over to DeepSeek automatically instead of surfacing as "all AI engines unavailable" —
  exactly the resilience this whole audit was about.
- **How to obtain**: DeepSeek's own API console, [platform.deepseek.com](https://platform.deepseek.com).
- **Where it belongs**:
  - **Railway** (production): `jennysol-ai-api` project → `jennysol-api` service → Variables tab.
    Add `DEEPSEEK_API_KEY`. Then either add `LLM_PROVIDER_CHAIN=gemini,deepseek` alongside it, or
    leave `LLM_PROVIDER_CHAIN` unset — `modelRouter.ts`'s `hasAnyConfiguredProvider()` will still
    only try what's configured, but without an explicit chain the router's *default* stays
    `gemini` alone (see `defaultChainFor()` in `modelRouter.ts`) — **the explicit
    `LLM_PROVIDER_CHAIN=gemini,deepseek` is the part that actually matters**, not just the key.
  - **This Mac** (`server/.env`, for local/future Mac-hosted use): the same two lines, in the file
    already listed in `.env.example`.
- **How to verify it loaded, without printing it**: `GET /api/admin/provider-health` (admin auth
  required) — added this session — reports `{name: "deepseek", configured: true, ...}` once the
  key is present; it never echoes the key itself. Locally: `npm run models -- health` inside
  `server/`, same guarantee.

### 2. Ollama, for the Mac's own local-first behavior

Not a missing *secret* — Ollama needs no API key at all — but it needs to be reachable from
wherever JennySol's own server process runs:

- **On this Mac, for local development/testing**: already done this session — Ollama installed via
  Homebrew, running as a `brew services`-managed background daemon bound to `127.0.0.1:11434`
  (never exposed beyond localhost — see [JENNY_MAC_PRODUCTION_REQUIREMENTS.md](JENNY_MAC_PRODUCTION_REQUIREMENTS.md)
  for why that matters). No env var changes needed — `OLLAMA_BASE_URL`'s own default
  (`http://127.0.0.1:11434`) already matches.
- **On Railway** (today's actual production host): **not applicable**. Railway's container has no
  network path to a service running on this Mac — setting `OLLAMA_BASE_URL` there to anything
  would just point at an unreachable host. Ollama only helps production once JennySol's own server
  process is the one running on this Mac (or the future GPU server) — see
  [JENNY_AI_INFRASTRUCTURE.md](JENNY_AI_INFRASTRUCTURE.md) for that migration path. This document
  deliberately does not propose tunneling Ollama's port to Railway — exposing a local inference
  server to the public internet is exactly the kind of security tradeoff Section 33 of the
  governing directive asked not to make.
- **To go local-first once JennySol itself runs on this Mac**: set `DEPLOYMENT_MODE=local` (no
  explicit `LLM_PROVIDER_CHAIN` needed — `defaultChainFor()` then resolves to
  `ollama,gemini,deepseek` automatically), or set `LLM_PROVIDER_CHAIN=ollama,gemini,deepseek`
  explicitly for the same effect with less "magic."

## Mac vs. Railway: what Ollama can and cannot do today

```
RAILWAY (today's real production host)
    Gemini ✅ configured
    DeepSeek ❌ not configured (see above)
    Ollama: unreachable — nothing runs on Railway's own container, no path to this Mac

THIS MAC (local dev today; candidate future production host)
    Gemini ✅ configured (same key, via server/.env)
    DeepSeek: same gap as Railway until the key above is added
    Ollama ✅ installed, running, reachable at 127.0.0.1:11434 — see JENNY_LOCAL_MODEL_MATRIX.md
```

## Nothing else requires founder input right now

Every other capability JennySol's own `capabilityRegistry.ts` reports as "not configured" (vision,
computer control) is a **not-implemented** gap, not a missing-credential one — no key would turn
them on. `TAVILY_API_KEY` and `SERVICE_TOKEN_SECRET_ARENA` are both already configured in
production. `GEMINI_API_KEY` is being treated as temporarily compromised per the founder's own
standing instruction from earlier this engagement (exposed once in a tool-output accident) and
will be rotated, along with every other key, only at the final security-hardening stage the
founder has already specified — nothing in this document changes that plan or asks for that
rotation early.
