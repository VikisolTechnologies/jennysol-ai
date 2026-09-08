# Jennysol Capabilities

Written 2026-09-08. States plainly, per capability, whether it's implemented, model-independent, and actually working in production — traced end-to-end, not assumed from the presence of a file or UI button.

**Live, authoritative source**: `server/src/services/capabilityRegistry.ts` computes this same information live from real env vars and reachability checks (never a second hand-maintained copy this file could drift from) — read it directly, or hit `GET /api/admin/config-health` (admin-authenticated, never returns secret values) for the current state of a running deployment. This document is the narrative explanation; the registry is the source of truth if the two ever disagree.

## Canonical identity

Defined once, in `server/src/services/identity.ts` — not scattered across prompts:

```
JENNYSOL_IDENTITY = {
  productName: "JennySol",
  organization: "Vikisol Labs",
  founder: "Syam Prabhakar Seeli",
  founderLineage: "son of the late Kishore Seeli, a great visionary leader",
}
```

**Enforcement mechanism**: a deterministic, model-free short-circuit — not a persona instruction hoping the model repeats it correctly. `isIdentityQuestion(message)` (regex-based intent detection) is checked in `chatRunner.ts`'s `executeChatRun`, *before* any context build or model call. If it matches, the canonical response is streamed and persisted directly; `streamChatCompletion` (and therefore every provider — Gemini, DeepSeek, Ollama) is never invoked for that turn. This guarantees identical, correct behavior regardless of which model is currently selected, whether search is available, or how reliably a given model (especially a small local one) follows a system-prompt instruction.

**Why this approach, not a persona line**: live production testing, before this fix, showed the same near-identical question answered three different, mutually contradictory, entirely fabricated ways across separate requests — "the folks at Solv," "created by Dave," "developed by Google." A prompt-level fact competes with the model's own pretrained associations and is not reliably reproduced; a code-level short-circuit cannot hallucinate.

**Tests** (`server/src/services/identity.test.ts`, `chatRunner.identity.test.ts`): 9 detection-match tests (the 6 required phrasings + 3 real-world variants), 4 non-match tests (confirms it doesn't fire on unrelated questions), 1 content test (canonical response contains the required facts), and an integration test proving `streamChatCompletion` is never called for an identity question while a normal question still reaches it. All passing (see Test Results below).

**Production verification** (live, `api.jennysol.vikisol.in`, post-deploy):

| Query | Response | Latency |
|---|---|---|
| "Who created JennySol?" | "I was created at Vikisol Labs by my founder, Syam Prabhakar Seeli — son of the late Kishore Seeli, a great visionary leader." | 338ms |
| "Who made you?" | identical | 266ms |
| "Who is your founder?" | identical | 314ms |
| "Do u know who created jennysol" | identical | 268ms |

Identical wording every time, ~300ms (no model call at all — this is why it's dramatically faster than any other chat response, which averages 500-1000ms).

## Image generation

**Intended provider**: Gemini (`services/providers/geminiImage.ts`, model `gemini-3.1-flash-image` — confirmed via `GEMINI_IMAGE_MODEL` env var).

**Actual provider**: same — the adapter is real and correctly implemented (calls `generateContent` with `responseModalities: [Modality.IMAGE]`, extracts the inline base64 image data, throws a clear error if no image part comes back). This is not a mock and not a stub.

**Exact failure point, traced end-to-end and confirmed via production logs**:

```
USER REQUEST → frontend (image mode toggle, ChatWindow.tsx)
  → POST /api/image (requireAuth, but stateless — no AgentRun, see limitation below)
  → generateImage(prompt) → Gemini API call
  → Gemini API rejects with HTTP 429 RESOURCE_EXHAUSTED:
    "Quota exceeded for metric: generativelanguage.googleapis.com/
     generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-image"
  → route catches it, returns an honest error message to the frontend
  → frontend renders the error text in the chat bubble, no fake "here's your image"
```

**Root cause**: `limit: 0` is not a temporary rate limit — it means this specific Gemini API key's current billing tier has **zero** allotted quota for the image-generation model, period. This is a provider/account-configuration limitation, not a code bug. Confirmed directly from Google's own error body, not inferred.

**IMAGE GENERATION STATUS: Blocked by provider limitation (missing/insufficient billing tier on the configured Gemini API key).** Not broken code, not blocked by a missing key (a key IS configured), not a routing bug — the request correctly reaches Gemini and Gemini correctly rejects it.

**Fix made this session** (the code was already structurally sound, so the fix is honesty, not new plumbing): the error message returned to the user now distinguishes this exact `limit: 0` pattern from a genuine transient rate limit — previously it said "hit today's limit... it'll free up again soon" for *any* 429, which is false for a permanent zero-quota tier (nothing "frees up" without an account change). Now: "this account's current plan doesn't include any image-generation quota, so it's not something that'll clear up on its own. Someone would need to enable billing/upgrade the plan for that model." It also never claims a search or generation happened when it didn't (verified: no fake success path exists in the code either before or after this session's changes).

**To actually fix it**: enable billing / upgrade the Gemini API key's tier for `gemini-3.1-flash-image` specifically (a separate quota bucket from plain chat completions, which are unaffected and working fine — confirmed, chat responses average 500-1000ms with no quota errors).

**Capability model**: image generation is **not** gated by which chat model happens to be selected — `POST /api/image` is a completely separate route/provider call, independent of `modelRouter.ts`'s chat provider chain. It correctly does not pretend DeepSeek or Ollama can generate images (neither is ever invoked for this route). There is no formal capability-registry object (`{TEXT_GENERATION, VISION, IMAGE_GENERATION, ...}`) in code — the "capability" today is simply "which route exists," which happens to already prevent the specific failure mode asked about (falsely reporting image support for a model that can't do it), so a formal registry wasn't built for a problem that isn't actually occurring. Flagged as PLANNED if a second image-capable provider is ever added and a real choice needs making.

**KNOWN LIMITATION (real, found during this audit, not fixed this session)**: image generation does **not** go through the AgentRun system at all. `POST /api/image` is a synchronous request/response with purely client-side React state (`ChatWindow.tsx`'s `handleSendImage`) — no `agent_runs` row, no `runId`, no SSE, no persistence. If the browser closes or reloads mid-generation, the result is lost with no way to recover it, unlike every text chat response. This directly conflicts with the project's own "AgentRun is the unit of execution" principle and was out of scope to re-architect in this session (a real, non-trivial change — wiring image generation into `chatRunner.ts`'s existing run lifecycle) versus the two specific fixes requested (identity, and diagnosing why images fail). Documented here rather than silently left unmentioned.

## Weather

**IMPLEMENTED, model-independent, free, no API key.** `server/src/services/weather/` — `weatherProvider.ts` calls Open-Meteo's free geocoding + forecast endpoints (no key, no card, 10,000 calls/day non-commercial), `weatherIntent.ts` detects a weather question and extracts a location. Real conditions are injected into the system prompt as `LIVE WEATHER DATA` with an explicit "never invent these figures" instruction; a failed lookup injects an explicit "tell the user honestly it's unavailable" instruction instead. Handles the real, confirmed-in-production two-turn case ("How's weather" → "Am in Guntur can u please check") by checking whether the previous user turn was a weather question.

**Verified live in production** against the real Open-Meteo API (not mocked): `What's the weather in Guntur?` → real current temperature/feels-like/humidity/wind/precipitation/conditions, correctly attributed to Open-Meteo. See `docs/JENNYSOL_FREE_FIRST_ARCHITECTURE.md` Section 4 for the full implementation writeup and Section 13 for test evidence. Known limitation: location extraction requires a capitalized place name (a heuristic, not NLP) — `"weather in guntur"` (lowercase) isn't caught and falls back to asking the user for their city, same honest behavior as before this capability existed.

## Search / current information

See `docs/CURRENT_INFORMATION_ARCHITECTURE.md` for the full audit. Summary: the architecture (provider-independent `SearchProvider`/`searchRouter.ts`, injected into context for any model) is IMPLEMENTED, but **NOT CONFIGURED** (no `TAVILY_API_KEY`) and Gemini's own native fallback is **CONFIGURED but quota-blocked** on this API key's tier — so no live search is actually reaching production right now, regardless of how well the request is classified.

## Capability summary table

| Capability | Implemented? | Model-independent? | Works locally (Ollama)? | Works in production today? |
|---|---|---|---|---|
| Text chat | Yes | Yes (per-provider) | Not tested yet (Ollama not installed — see architecture handoff) | Yes |
| Creator identity | Yes, deterministic | Yes — bypasses the model entirely | Yes (never reaches Ollama for this) | Yes, verified |
| Document RAG | Yes | Yes | Yes (once Ollama is installed) | Yes |
| Provider-independent web search | Yes (code) | Yes | Yes (once configured) | **No** — no key configured |
| Gemini native search grounding | Yes (code) | No (Gemini-only) | N/A | **No** — quota-blocked on this key |
| Image generation | Yes (code) | No (Gemini-only) | No | **No** — quota-blocked on this key |
| Weather | Yes | Yes — bypasses no model, injects real data any provider can state | Yes | **Yes, verified** — Open-Meteo, no key |
| Current date/time | Yes, deterministic | Yes — bypasses the model entirely | Yes | Yes, verified |
| Timezone | Yes | Yes — browser `Intl` header, server formats | Yes | Yes, verified |
| Voice/TTS | Yes (separate from AgentRun) | No (Gemini-only) | N/A | Yes |

## Environment variables (capability-relevant)

| Variable | Capability | Status |
|---|---|---|
| `GEMINI_API_KEY` | chat, image gen, native grounding | Configured; tier lacks image-gen and grounding quota specifically |
| `GEMINI_IMAGE_MODEL` | image generation | Configured (`gemini-3.1-flash-image`) — model choice isn't the problem, billing tier is |
| `TAVILY_API_KEY` | provider-independent search | Not configured |
| `SEARXNG_BASE_URL` | self-hosted search | Not configured — coded, not deployed (see free-first architecture doc) |
| `DEEPSEEK_API_KEY` | cloud fallback chat | Not configured |
| `OLLAMA_BASE_URL` | local chat fallback | Configured with a default; Ollama itself not installed on the dev machine yet |

Live status for all of these, without secret values: `GET /api/admin/config-health` (admin-authenticated) or `server/src/services/capabilityRegistry.ts` directly.

## Known limitations (capabilities-specific)

- Image generation and Gemini's native search grounding share the same root cause (a zero-quota billing tier) — fixing one credential/billing change likely fixes both.
- Image generation bypasses the AgentRun architecture entirely (see above) — a real gap, not fixed this session, scoped out as a larger change than requested.
- A formal capability registry now exists (`capabilityRegistry.ts`, added 2026-09-08) — the note above about "no formal registry" no longer applies.
