# JennySol Free-First Architecture

Written 2026-09-08. Goal: make JennySol useful with **zero paid API credits**, using local/open-source/self-hosted services wherever a real one exists, with paid providers as an optional enhancement — never a hard dependency. Pricing/limits below are sourced from each provider's own official docs as of September 2026; anything not directly verified against an official page is marked as such.

Terminology used throughout, per the user's explicit distinction:
- **FREE API** — no card, a real usable limit, hosted by the vendor.
- **FREE TIER** — free up to a limit, but requires a card on file (can silently convert to billing).
- **OPEN SOURCE** — the software is free; a *hosted* version of it may still be paid. Self-hosting is what makes it free.
- **SELF-HOSTED** — you run it yourself, on your own hardware.
- **PAID API** — costs money from the first request or past a small threshold that assumes billing.

## 1. Provider matrix

| Capability | Current Provider | Current Status | Free Option | Self-hosted Option | Paid Option | Recommended |
|---|---|---|---|---|---|---|
| Text generation | Gemini (primary), DeepSeek (fallback, not yet configured), Ollama (opt-in) | **Update 2026-09-11**: Ollama installed on this Mac (M1 Pro, 16GB), running, `qwen3:8b` pulled and verified — real chat, real tool calling, real cancellation, all tested through the actual JennySol pipeline. See [JENNY_LOCAL_MODEL_MATRIX.md](../JENNY_LOCAL_MODEL_MATRIX.md) and [JENNY_AI_INFRASTRUCTURE.md](../JENNY_AI_INFRASTRUCTURE.md). Not yet the default chain in production Railway (`DEPLOYMENT_MODE=cloud` there, correctly — Railway can't reach this Mac's Ollama) | Ollama (open-weight models, FREE API — local, no cost) | Ollama on M1 now, RTX 5060 Ti/dual-5090 later | Gemini, DeepSeek | Ollama now installed and verified; keep Gemini/DeepSeek as cloud fallback — add `DEEPSEEK_API_KEY` per [JENNY_REQUIRED_PROVIDER_CONFIGURATION.md](../JENNY_REQUIRED_PROVIDER_CONFIGURATION.md) for real production resilience |
| Current date | Deterministic short-circuit (`dateTime.ts`) | **IMPLEMENTED**, free | Server clock | Server clock | — | Already free — no change needed |
| Current time | Deterministic short-circuit (`dateTime.ts`) | **IMPLEMENTED this session**, free | Server clock | Server clock | — | Already free |
| Timezone | Browser `Intl` → `X-Timezone` header | **IMPLEMENTED this session**, free | Browser API | — | — | Already free |
| Web search | SearXNG (new, unconfigured) → Tavily (unconfigured) | Architecture ready; nothing actually configured | Tavily (1,000 credits/mo, no card) | SearXNG (self-hosted, no per-query cost) | Tavily overage, Brave (card required) | SearXNG self-hosted as primary once stood up; Tavily free tier as fallback |
| Current-info research | Reuses web search layer | Same as above | Same | Same | Same | Same |
| Weather | Open-Meteo | **IMPLEMENTED this session**, free, no key | Open-Meteo (10k calls/day, no key, no card) | — (no self-host needed) | WeatherAPI.com, OpenWeatherMap (card required) | Open-Meteo — already the best option, done |
| Image generation | Gemini (`gemini-3.1-flash-image`) | Blocked — zero-quota billing tier | — | FLUX.1-schnell on future RTX 5060 Ti | Gemini (needs billing) | Local FLUX.1-schnell once the GPU server exists |
| Image understanding / vision | Not implemented | MISSING CAPABILITY | Ollama vision models (e.g. llama3.2-vision, llava) | Ollama | Gemini vision (same key as chat) | Ollama vision model once local inference is running |
| Embeddings | `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2), ONNX, in-process | **Already FREE and LOCAL** | Already free | Already self-hosted (runs in the Node process) | — | No change needed |
| RAG | SQLite + cosine similarity over the above embeddings | **Already free/local** | — | — | — | No change needed |
| Local LLM | Ollama provider, curated model registry | Code ready; Ollama not installed yet | Ollama | Ollama | — | Install Ollama on the M1 now |
| Voice input (STT) | Browser Web Speech API | **Already free** (client-side, no server round-trip, no key) | Already free | whisper.cpp (M1) / faster-whisper (RTX) for a future non-browser client | — | Keep browser STT; no cost today |
| Text-to-speech | Gemini TTS | Working, but consumes Gemini quota/cost | Browser `SpeechSynthesis` (lower quality, zero cost, zero effort) | Piper or Kokoro (self-hosted) | Gemini TTS (current) | Kokoro on future RTX server; browser TTS as an immediate zero-cost fallback |
| Computer control | Not implemented | PLANNED (future phase) | — | — | — | Not evaluated this session |
| File processing | Local text extraction + local embeddings | **Already free/local** | — | — | — | No change needed |

## 2. Free-first routing policy (already largely in place)

`modelRouter.ts` already implements the shape this policy needs: an ordered, health-gated provider chain (`LLM_PROVIDER_CHAIN`), with `DEPLOYMENT_MODE=local` changing the *default* chain to try Ollama first (`ollama,gemini,deepseek`) when nobody has set an explicit chain. This was already true before this session — it just has nothing to prefer yet because Ollama isn't installed anywhere it runs today.

`searchRouter.ts` got the equivalent treatment this session: the default chain is now `searxng,tavily` (searxng first), inert until `SEARXNG_BASE_URL` is set. Once a self-hosted SearXNG instance exists, search becomes free-by-default with zero code changes.

**What this policy does NOT yet do**: true per-request cost/latency/quality scoring across providers. `modelRouter.ts`'s own comment explains why: with only two real cloud providers and no signal to meaningfully distinguish "better at coding" vs "better at reasoning" between them, a scoring system would be speculative complexity with nothing real to act on. The ordered-chain-plus-health-gating approach already achieves the practical goal ("prefer the free option when it's actually usable, fail over to what works") without inventing a scoring model that has no real data feeding it yet.

## 3. Search — free/self-hosted architecture

| Provider | Type | Card Required | Current Limit (Sept 2026, official docs) | Notes |
|---|---|---|---|---|
| **Tavily** | FREE API | No | 1,000 API credits/month | Structured JSON, source URLs. [tavily.com/pricing](https://tavily.com/pricing) |
| **Brave Search API** | FREE TIER | **Yes** | $5 free credit/mo ≈ 1,000 calls | Card required even for $0 usage — Brave discontinued its old no-card tier. |
| **Bing Search API v7** | Retired | — | 0 — decommissioned Aug 2025 | Not usable at all anymore. |
| **Google Programmable Search** | FREE API, sunsetting | No (for the free 100/day) | 100/day free, then $5/1,000 | Closed to new customers; existing users must migrate off by Jan 1, 2027. |
| **SearXNG** | OPEN SOURCE, self-host only | N/A | No hosted API; bounded by upstream engine scraping limits | Actively maintained. ~256–512MB RAM, ~1 vCPU to self-host. Aggregates Google/Bing/DuckDuckGo/etc. via scraping — can be rate-limited/blocked by those engines at volume; not bulletproof at scale, fine for a small app. |

**Recommendation implemented**: `searxngProvider` (new, `server/src/services/search/searxng.ts`) is wired into the existing `SearchProvider` chain ahead of Tavily. **Not yet deployed** — standing up an actual SearXNG instance is a real infrastructure change (a new container, and per SearXNG's own docs it must never be exposed to the public internet unauthenticated) that has cost/security implications, so it wasn't done unilaterally this session. Two practical deployment options, in order of readiness:

1. **A second private Railway service in the same project** (available now, before the home server exists): deploy the official `searxng/searxng` Docker image as its own Railway service with **no public domain generated** — Railway services in the same project can reach each other over private networking (`<service-name>.railway.internal`) without exposing a public URL. Set `SEARXNG_BASE_URL=http://searxng.railway.internal:8080` on the `jennysol-api` service. This keeps the "never expose SearXNG publicly" rule by construction (no public domain is ever attached).
2. **The future home server** (RTX 5060 Ti box): run it there once it exists, reachable from Railway only via the secure tunnel described in Section 12 below — not directly on the open internet either way.

Either path is the same code change (`SEARXNG_BASE_URL` + `SEARCH_PROVIDER_CHAIN=searxng,tavily`); nothing in the app needs to know which.

**In the meantime**: set up the free Tavily key (1,000 credits/month, no card — see Section 10) so search actually works today, independent of when SearXNG gets deployed.

## 4. Weather — implemented

Open-Meteo confirmed free, no API key, no card, for non-commercial use: 10,000 calls/day, 5,000/hour (official docs/pricing pages). Commercial use requires a paid subscription — not applicable at JennySol's current usage.

Implementation (`server/src/services/weather/`):
- `weatherProvider.ts` — geocodes a location name via Open-Meteo's free geocoding endpoint, then fetches current conditions (temperature, feels-like, humidity, wind, precipitation, WMO condition code → text) from the free forecast endpoint. Returns `null` on **any** failure — network error, unresolvable location — never a guessed value.
- `weatherIntent.ts` — detects a weather question and extracts a location via regex (capitalized-word heuristic, deliberately simple — same philosophy as `currentInfo.ts`/`identity.ts`).
- Wired into `contextManager.ts`: resolved weather data is injected into the system prompt as `LIVE WEATHER DATA`, with an explicit instruction to state the exact figures and never invent them. A failed lookup injects an explicit "tell the user honestly it's unavailable" instruction instead of silently doing nothing.
- Handles the real, confirmed-in-production two-turn case: "How's weather" (no location) → "Am in Guntur can u please check" (no weather keyword at all, just a location reply) — by checking whether the *previous* user turn was a weather question when the current one only supplies a location.

**Verified live in production** (see Section 15) against the real Open-Meteo API, not a mock: `What's the weather in Guntur?` → actual current conditions, correctly cited as Open-Meteo, with the honest-failure behavior confirmed for an unresolvable location in tests.

## 5. Image generation — local architecture for the future RTX 5060 Ti

**Not implemented — cannot be, until the GPU server exists.** The M1 Pro dev machine is explicitly not being used as an image-generation server (16GB unified memory shared with the OS and everything else running; not comparable to a dedicated 16GB VRAM GPU).

| Model | VRAM @1024² | License | Speed on 16GB card | Verdict |
|---|---|---|---|---|
| SD 1.5 | ~4GB | OpenRAIL-M | ~2-4s/img | Fast but 2022-era quality — not a sensible default in 2026 |
| SDXL base+refiner | ~10-12GB | OpenRAIL++-M | ~15-20s/img | Usable fallback |
| **FLUX.1-schnell** | ~12GB (fp8) | **Apache 2.0** | **~2.4s/img** | **Recommended** — fast, fully commercial-safe, fits comfortably in 16GB |
| FLUX.1-dev | ~12GB (fp8) | Non-commercial only | ~14s/img | Higher quality but the license blocks self-hosted-app use |
| FLUX.2 [klein] 4B | ~8GB | Apache 2.0 | Fast, less field-proven (new, Jan 2026) | Worth revisiting once more benchmarked |

**Recommended stack**: FLUX.1-schnell served via ComfyUI's built-in HTTP server (`--listen` for LAN access, JSON workflow submission) — the more practical path to a network-callable image server than hand-rolling a Diffusers + FastAPI wrapper for a single-GPU home setup.

**Planned architecture** (build once the GPU exists, not before):
```
JennySol chat backend → new "image" capability entry in modelRouter-style chain
  → local image server (ComfyUI + FLUX.1-schnell) on the RTX 5060 Ti box
  → reachable from Railway only via the secure tunnel (Section 12)
  → generated image → AgentRun event → frontend
```
This also fixes the separately-documented gap (`docs/JENNYSOL_CAPABILITIES.md`) that image generation currently bypasses the AgentRun system entirely — the local path should be built as a proper AgentRun capability from the start, not retrofitted later.

**Until then**: image generation stays "Blocked by provider limitation" (Gemini's zero-quota tier) — not fixed by a code change, not fixed by local infrastructure that doesn't exist yet.

## 6. Text models — local model catalog (already curated)

`server/src/services/models/modelRegistry.ts` already has a curated, hardware-gated catalog — no changes needed this session, just confirming it matches the free-first goal:

| Model | Hardware target | VRAM/RAM | License | Cost |
|---|---|---|---|---|
| Llama 3.2 3B | M1 Pro 16GB | 2.0GB | Llama 3.2 Community License | Free |
| Qwen3 4B | M1 Pro 16GB | 2.5GB | Apache 2.0 | Free |
| Qwen3 8B | M1 Pro 16GB | 5.2GB | Apache 2.0 | Free |
| Qwen2.5-Coder 7B | M1 Pro 16GB | 4.7GB | Apache 2.0 | Free |
| DeepSeek-R1 7B (distilled) | M1 Pro 16GB | 4.7GB | MIT (Qwen base) | Free |
| Qwen2.5-Coder 14B | RTX 5060 Ti only (`requiresDedicatedServer`) | 9.0GB | Apache 2.0 | Free |
| DeepSeek-R1 32B (distilled) | RTX 5060 Ti only | 20GB | MIT (Qwen base) | Free |
| nomic-embed-text | M1 Pro 16GB | 0.5GB | Apache 2.0 | Free (unused — see Section 7) |

All zero API-key cost once Ollama is installed and these are pulled. **Action needed**: install Ollama on the M1 (`brew install ollama`, `ollama serve`), then `node server/scripts/models-cli.ts install <tag>` for whichever models are wanted — nothing here auto-installs.

## 7. Embeddings / RAG — already free, no change needed

`server/src/services/embeddings.ts` uses `@huggingface/transformers` running `Xenova/all-MiniLM-L6-v2` as an ONNX model **in-process**, in Node — no API key, no network call after the model is cached once. This was already the case before this session; the model registry's `nomic-embed-text` Ollama entry is currently unused (embeddings never call out to Ollama), which is fine — the in-process ONNX path is simpler and already free, so there's no clear win from switching.

Verified this session (no change made): document ingestion, chunking, embedding, SQLite storage (`chunks` table with a BLOB column, not pgvector — this app uses SQLite, not Postgres), retrieval (`vectorStore.searchSimilarChunks`), and user isolation (every query scoped by `WHERE d.user_id = ?` via a join) are all unchanged and were already covered by `docs/SECURITY_AUDIT.md`'s cross-user isolation tests.

## 8. Voice — audited, not rewritten

| Component | Current | Cost | Free/local alternative |
|---|---|---|---|
| Speech-to-text | Browser Web Speech API (`useSpeechRecognition.ts`) | **Already free** — client-side, no server round-trip | Already optimal for a browser client |
| Text-to-speech | Gemini TTS (`geminiTts.ts`, `/api/speech`) | Consumes Gemini quota/billing | Browser `SpeechSynthesis` (zero cost, lower quality, zero engineering) as an immediate fallback; **Kokoro** (Apache 2.0, ~82M params, GPU-accelerated, high quality) or **Piper** (GPL-3.0, CPU-only, lighter/lower quality) self-hosted on the future RTX server |

Research findings (Sept 2026 model cards): **faster-whisper** (CTranslate2) is the right STT choice if a non-browser client is ever needed on the RTX server — 4-8x faster than plain Whisper at equal accuracy; **whisper.cpp** is the right choice on the M1 (Metal + Core ML acceleration). Not implemented — the browser's native STT already covers today's actual use case at zero cost, so there's no current-use-case reason to add a server-side STT pipeline.

**Not changed this session** per explicit instruction not to replace working voice functionality unnecessarily. The one real recurring cost in voice today is Gemini TTS; Kokoro on the future GPU server is the eventual zero-cost replacement.

## 9. Railway — what's free vs. what costs money

| Component | Can Railway host it? | Needs a paid Railway plan? | Move to home server later? | Should it stay on Railway? |
|---|---|---|---|---|
| Node/Express backend | Yes (current) | Depends on usage tier | Optional | Yes — needs to stay reachable 24/7 regardless of home server uptime |
| SQLite (file-based, on a volume) | Yes (current — `jennysol-api-volume`) | Included | Could move, but simplest to keep with the backend | Yes |
| Redis | Not currently used anywhere in this codebase | N/A | N/A | Not needed — nothing in this app currently requires it |
| SearXNG | Yes, as a second private service (Section 3) | Depends on Railway's resource-based pricing for the extra service | Yes, once the home server exists | Either works; Railway is available *today* |
| Weather (Open-Meteo) | N/A — it's an external free API call, not something to host | No | No | No hosting needed at all |
| Model inference (Ollama) | **Do not put GPU inference on Railway** — no GPU instances, and CPU-only LLM inference is impractically slow for a chat product | Would require Railway's more expensive compute tiers for even mediocre CPU inference | Yes — this is exactly what the home server is for | No |
| Image generation (ComfyUI/FLUX) | **Do not put GPU inference on Railway** — same reasoning, and Railway has no GPU tier at all | N/A | Yes — this is the whole reason for the RTX 5060 Ti server | No |

## 10. API key setup — exactly what to create, where

None of these are required for JennySol to function — Gemini alone (already configured) plus this session's free additions (weather, identity, time) already cover a working product. Each key below is a genuine enhancement, not a hard dependency.

### Tavily (search — recommended, genuinely free)
- **Purpose**: current-information web search fallback (works even before SearXNG is deployed)
- **Official signup**: tavily.com → Sign Up → Dashboard → API Keys
- **Free tier**: 1,000 API credits/month
- **Credit card required**: No
- **Environment variable**: `TAVILY_API_KEY`
- **Where to add it in Railway**: `jennysol-api` service → Variables tab → New Variable → paste the key value there (never in chat, never in a committed file)
- **Needed for local dev**: Optional — search silently no-ops without it, same as today
- **Free/self-hosted alternative**: SearXNG (Section 3) once deployed

### SearXNG (search — self-hosted, no key at all)
- Not a "key" — a base URL of your own instance.
- **Environment variable**: `SEARXNG_BASE_URL` (e.g. `http://searxng.railway.internal:8080` for a private Railway service)
- **Where to add it in Railway**: same Variables tab, once the instance exists
- **Needed for local dev**: Optional
- Nothing to sign up for — you run it.

### Nothing else requires a new key this session
Weather (Open-Meteo), current time/date, and creator identity all work with zero keys, by design.

### Optional, not recommended right now
- **DeepSeek** (`DEEPSEEK_API_KEY`) — already wired as a fallback provider, not currently set. Low priority: Gemini is already the healthy primary; only worth adding if Gemini's reliability becomes a real problem.
- **WeatherAPI.com / OpenWeatherMap** — skip. Open-Meteo already covers this for free with no card.

**Keys we can avoid entirely**: Brave Search (card required for $0 usage), Google Programmable Search (sunsetting for new use by 2027), OpenWeatherMap (card required even on the free tier), any paid Gemini tier for image generation or search grounding (Section 17 explains why not to upgrade this yet).

## 11. Three configurations

### A. Zero/near-zero-cost development
Gemini (already have a key, free-tier chat is fast and unaffected by the image/grounding quota issue), Open-Meteo weather (free, done), local embeddings (free, done), browser STT/TTS (free, done), Ollama installed locally once for local-first text generation (free, one-time setup). **Actual monthly cost: $0**, assuming Gemini's free-tier chat quota (separate from the blocked image/grounding quota) isn't exceeded.

### B. Low-cost production
Everything in A, plus: Tavily free tier (1,000 credits/month, $0) for search, Railway's existing hosting plan (whatever tier is already running the backend — unchanged by anything in this session). **Actual monthly cost: whatever Railway's current plan already costs**, plus $0 for Tavily/weather/embeddings.

### C. Self-hosted JennySol
Add: SearXNG as a private Railway service (or on the home server once it exists) for search with zero per-query cost, Ollama as the primary text provider (Gemini/DeepSeek as a fallback only), Kokoro/Piper for TTS on the RTX 5060 Ti server, FLUX.1-schnell for image generation on the same server. At this point the only recurring cash cost is whatever Railway charges to keep the always-on cloud control plane running (routing, auth, SQLite) — every AI capability itself is free.

## 12. Future home server — service placement

Target hardware: RTX 5060 Ti 16GB, Ryzen 5 9600X, 64GB DDR5.

| Service | Runs on home server? | Public internet exposure |
|---|---|---|
| Ollama | Yes | **Never** — port 11434 stays bound to localhost/private network only |
| ComfyUI (FLUX.1-schnell) | Yes | **Never** — LAN/private network only |
| faster-whisper / whisper.cpp | Yes, if a non-browser STT client is ever built | Never |
| Piper / Kokoro | Yes | Never |
| SearXNG | Yes (or on Railway privately, see Section 3) | **Never** — SearXNG's own docs are explicit about this |
| PostgreSQL / pgvector | Not currently needed — this app uses SQLite | N/A |
| Redis | Not currently used anywhere in this codebase | N/A |
| Jenny Local Agent (future computer-control feature) | Yes, eventually | Never directly |

**Secure connectivity**: the cloud control plane (Railway) needs to reach these home-server services without any of them ever having a public IP/port. The standard, low-effort way to do this is an outbound-only tunnel from the home server to a relay (e.g. a WireGuard tunnel, or a reverse-tunnel tool like Tailscale/Cloudflare Tunnel) so Railway calls a private address and the home server never accepts unsolicited inbound connections from the internet. Not implemented this session — the home server doesn't exist yet — but this is the shape to build when it does, not a public port-forward.

## 13. Testing performed this session

- `weatherIntent.test.ts` — detection + location-extraction, including the real confirmed production phrasing "Am in Guntur can u please check" extracting exactly "Guntur", and the known limitation (all-lowercase location isn't caught).
- `weatherProvider.test.ts` — mocked-fetch unit tests (success, unresolvable location, HTTP failure — all three confirm `null` is returned rather than an invented value), **plus a live smoke test against the real Open-Meteo API** (not mocked) confirming real current conditions for Guntur and honest `null` for a nonexistent location.
- `dateTime.test.ts` — timezone-aware formatting, including a malformed/hostile input string handled without throwing.
- `searchRouter.test.ts` — extended to prove SearXNG is preferred over Tavily when both are configured, falls back to Tavily when SearXNG fails, and is a no-op change when unconfigured (protects against ever silently breaking today's Tavily-only behavior).
- **Live production tests** (`api.jennysol.vikisol.in`, post-deploy):
  - `What's the weather in Guntur?` → real current conditions (36.3°C, clear sky, 43% humidity, matching the direct Open-Meteo smoke test).
  - Two-turn flow `How's weather` → `Am in Guntur can u please check and let me know` → correctly resolves to real Guntur weather on the second turn (the exact real-world case that was broken before this session).
  - `What time is it here?` with `X-Timezone: Asia/Kolkata` → `Right now it's 11:32 AM GMT+5:30 ... (Asia/Kolkata)`.
  - Same question with `X-Timezone: Asia/Shanghai` (simulating travel) → `Right now it's 02:02 PM GMT+8 ... (Asia/Shanghai)` — confirms the browser's timezone, not a hardcoded one, drives the answer.
  - Search: unchanged from `docs/CURRENT_INFORMATION_ARCHITECTURE.md` — still NOT CONFIGURED (no Tavily key, no SearXNG instance yet) — this session built the architecture and the free option, not the actual key/deployment, per "don't fabricate a paid upgrade."
  - Image generation: unchanged, still blocked by Gemini's zero-quota tier — confirmed still failing with the identical error in fresh logs post-deploy.
- Full suite: 159/159 passing, server + client TypeScript clean, both builds clean.

## 14. Known limitations / not done this session

- SearXNG is coded but **not deployed** — no instance exists yet. Search remains non-functional until either a Tavily key is added (fastest) or a SearXNG instance is stood up (Section 3).
- Ollama is not installed on the M1 dev machine — the entire "local-first text generation" story is code-ready but unexercised in practice.
- Voice TTS still costs Gemini quota; Kokoro/Piper migration is a future-server task, not done here (avoiding an unnecessary rewrite of working functionality per explicit instruction).
- Image generation and vision remain unimplemented until the RTX 5060 Ti server exists.
- The all-lowercase weather location gap ("weather in guntur", no capital G) is a known, accepted heuristic limitation — documented, not silently hidden.
