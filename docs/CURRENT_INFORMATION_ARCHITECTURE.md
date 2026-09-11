# Jennysol Current-Information Architecture

Written 2026-09-08, after auditing the real production behavior behind reported failures (weather, "search this on Google", stale status claims) and implementing targeted fixes. This describes the actual implementation, not the intended one — see the CRITICAL RULE at the end for what's deliberately still missing.

## Summary of the real root cause

Two nearly identical-looking failures — "Jenny can't search" and "Jenny gave a stale fact about Queen Sirikit" — turned out to have **two different, unrelated root causes**, confirmed by production logs, not assumed:

1. **Gemini's native Google Search grounding tool is completely disabled right now** — the boot-time probe (`warmUpGemini`) fails with `429 RESOURCE_EXHAUSTED` on this API key's current tier (confirmed: identical `limit: 0`-style quota failure to the one blocking image generation — see `docs/JENNYSOL_CAPABILITIES.md`). This was previously **silently swallowed** (an empty `catch {}` with no logging) — a real observability gap, fixed this session by adding a log line, which is what made this diagnosable from `railway logs` at all.
2. **The current-info detector had real gaps.** "Is Queen Sirikit alive?" and "Can u search about her on google" matched none of the existing trigger keywords, so *no* current-info path (external search or Gemini's native tool) was ever attempted for them — the model answered from pretrained knowledge alone, with no freshness caveat. Fixed this session (see Section 2).

Neither failure was "the model is bad." Both are documented, traceable, and now either fixed in code or clearly logged as a provider-tier limitation.

## 1. Current-info detection (`server/src/services/currentInfo.ts`)

Two regex-based patterns, checked via `needsCurrentInfo(message)`:

- `CURRENT_INFO_PATTERN` — time-sensitivity keywords (today/latest/current/weather/score/price/etc.) **plus, added this session**: `alive`, `deceased`, `passed away`, `still (in office|married|operating|available)`, `open now`. This closes the exact gap that let "Is Queen Sirikit alive?" through with zero freshness handling.
- `EXPLICIT_SEARCH_REQUEST_PATTERN` (**new this session**) — a distinct pattern for direct requests to search regardless of topic: "search for/about", "can/could you search", "google this/that/her/him", "look this/that up", "check online", "find out online". This closes the exact gap that let "Can u search about her on google" through unrecognized.

This is a single shared function, imported by `contextManager.ts` (decides whether to spend a real search call) and `gemini.ts` (decides whether to declare its native tool, interim-fallback-only — see Section 3). One heuristic, not two copies that could drift.

**Known limitation**: still two regex patterns, not a real intent classifier. False negatives are possible for phrasings not anticipated here; false positives just cost a wasted search attempt. Deliberately kept this simple rather than building an ML classifier with nothing to validate it against.

## 2. Search architecture (unchanged this session, built earlier — verified still accurate)

```
User message
  → needsCurrentInfo() (Section 1)
  → hasAnySearchProviderConfigured()?
       NO  → Gemini's own native googleSearch tool is the interim mechanism
             (only if groundingAvailable — see Section 3's finding)
       YES → searchRouter.ts's ordered chain (Tavily today; extensible)
  → results injected into system prompt as "LIVE WEB RESULTS" (contextManager.ts)
  → whichever provider answers (Gemini/DeepSeek/Ollama) receives identical text
```

`SearchProvider` interface (`services/search/searchProvider.ts`): `{ name, configured(), search(query, opts?) }`. One implementation today: `tavily.ts`. `searchRouter.ts` mirrors `modelRouter.ts`'s health-gated chain pattern exactly, namespaced (`search:tavily`) in the shared `providerHealth.ts` stats map.

## 3. Search providers — actual configuration (checked directly, not assumed)

**Updated 2026-09-10: Tavily is now configured and live in production.**
Verified with real queries returning real citations (provider/sourceType/
freshness metadata), independently checked against raw Tavily snippet text
to confirm answers are genuinely grounded, not fabricated. The table below
is kept as the historical record of the state this document originally
audited — not the current one.

| Provider | Configured in production (as of original audit)? | Evidence |
|---|---|---|
| Tavily (`TAVILY_API_KEY`) | ~~NOT CONFIGURED~~ → **CONFIGURED since 2026-09-10** | `railway variables` — key present; live production queries verified |
| Gemini native grounding | **CONFIGURED but PERMANENTLY FAILING** | `railway logs`: `[gemini] grounding (Google Search tool) probe failed ... 429 RESOURCE_EXHAUSTED` (unchanged — Tavily is the active path instead, not a fix to this) |

**Current state**: live search reaches production via Tavily. The
deterministic safety gate described elsewhere in this document (never let
the model guess when live verification genuinely fails) remains in place
and was itself verified live — a real transient Tavily failure correctly
produced the honest fallback instead of a guess, with normal service
resuming on the very next request.

## 4. Freshness model — CURRENT STATE: NOT IMPLEMENTED AS A SEPARATE SYSTEM

The full policy described in the originating spec (REAL-TIME / RECENT / CURRENT STATUS / HISTORICAL tiers, each with its own freshness target) is **PLANNED, NOT IMPLEMENTED** as a distinct scored system. What exists instead, implemented this session, is a **prompt-level temporal-honesty instruction** (Section 6) plus **actual current-date grounding** (Section 5) — these produce much of the same practical effect (don't state a changeable fact as current without a source) without building a formal claim-classification pipeline that has no live search results to classify yet (Section 3). Building the full tiered system now, with zero search providers actually returning results, would be machinery with nothing to operate on — deliberately not done, per the instruction not to over-build ahead of a real need.

## 5. Current date/time availability — FIXED THIS SESSION (confirmed missing before)

`server/src/services/llm.ts`'s `currentDateLine()` computes `new Date().toISOString().slice(0, 10)` **fresh on every system-prompt build**, from the server's own clock — never hardcoded, never left for the model to infer from its training cutoff. Injected as the first line of every system prompt, for every provider. Verified: this is what turned "she turned 92 in August" (stated as if recent) into an honest non-answer for a near-identical query after the fix.

**Known limitation**: UTC only. No per-user timezone is captured or sent by the client today (Section 6 below) — "today"/"tonight"/"open now" use the server's UTC day, which can be wrong near a day boundary for a user in a very different timezone. Fixing this needs a new client→server signal (the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`) that doesn't exist yet — flagged as a known gap, not silently ignored.

## 6. Timezone handling — NOT IMPLEMENTED

No timezone is captured from the client, stored per-user, or threaded into the system prompt. `currentDateLine()` uses UTC. PLANNED if "today"/"tonight" ambiguity near midnight proves to matter in practice — not built speculatively.

## 7. Source-quality tiers, evidence synthesis, conflict detection, stale-result guard, query rewriting — NOT IMPLEMENTED

All PLANNED per the originating spec, none built this session. Reasoning: every one of these operates on search results, and (Section 3) there are currently zero search results flowing through the system in production — Tavily isn't configured and Gemini's native tool is quota-blocked. Building a source-quality classifier, a multi-source conflict detector, or a query-rewriter with no live search results to feed it would be unverifiable, speculative complexity — exactly what the audit's own instruction warned against ("do not optimize for having search"). These become real, buildable, testable work the moment a search provider is actually configured (Section 9's next step).

## 8. Persona-level temporal-honesty rules — IMPLEMENTED, VERIFIED (partial reliability — see limitation)

Added to `PERSONA_INTRO` in `llm.ts` this session: an explicit instruction that current-STATUS claims (alive/married/in-office/still-operating), not just prices/news, must not be stated confidently without either a `LIVE WEB RESULTS` section or a successful native search — "a remembered fact from training is evidence about the past, not proof about right now." Also instructs weighing a more recent source's date over an older one *when a date is actually present in the injected context* (there is no date-extraction step yet — Section 7 — so this only applies once Section 7 exists).

**Verified live in production, before/after**:
- Before this session's fixes: *"Is Queen Sirikit alive?"* → *"Yes, Queen Sirikit is alive... she turned 92 in August."* (confident, stated as current, and the age is actually stale by roughly two years relative to today's real date).
- After: *"I don't have a live connection to check her current status right this second, so I can't confirm whether Queen Sirikit is alive today. My training data only goes up to the past, and statuses like this change over time, so I'd rather not guess from memory."*

**Known limitation, found in the same test batch**: *"Who is the current Queen of Thailand?"* (also current-info-detected) still answered confidently ("Suthida Tidjai... married since 2019") with no hedge, immediately after the same deploy. The answer happens to be correct, but the hedging instruction did not fire for it the way it did for the Sirikit phrasing. **This is model-compliance variance, not a code bug** — the instruction is a prompt-level probabilistic nudge, not a deterministic guarantee (unlike the creator-identity fix in `docs/JENNYSOL_CAPABILITIES.md`, which bypasses the model entirely). Documented honestly rather than claimed as a solved guarantee.

## 9. Caching — NOT IMPLEMENTED, nothing to audit

No caching layer exists anywhere in this codebase (confirmed in the security audit's own investigation — no Redis, no in-memory response cache). Search results, when they exist, are never cached — every current-info request that reaches `searchRouter.ts` makes a live call. Not a risk today; becomes relevant only once Section 3's gap is closed and real query volume exists.

## 10. Citations

`chatRunner.ts` attaches `webSources` (title/url/domain) from whichever mechanism actually returned them, to the final message's `sources` array — the same shape as document citations. Never fabricated: a source only ever appears here if it was actually returned by a real search/grounding call. Today, with Section 3's gap, this array is empty for essentially every current-info answer in production — confirmed directly in the test batch below (`sources: []` on every query).

## 11. Failure behavior

When no search mechanism is available (today's actual state), the persona instructs an honest "can't verify" rather than answering confidently from memory — this is what's actually observed in production for most tested queries (Section 8). It is **not a hard code-level block** — it's a prompt instruction the model can occasionally fail to follow (Section 8's Thailand-queen counter-example). A deterministic, code-enforced "stale result guard" (Section 3 of the spec) doesn't exist because there are currently no search results for it to gate on.

## 12. API keys

| Key | Purpose | Status |
|---|---|---|
| `GEMINI_API_KEY` | chat, image gen, native search grounding | CONFIGURED, but this tier has zero quota for grounding and image gen specifically (plain chat completions are unaffected and working) |
| `TAVILY_API_KEY` | provider-independent search | NOT CONFIGURED |
| `SERPER_API_KEY`, `BING_SEARCH_API_KEY` | alternative search providers | NOT CONFIGURED, NOT REFERENCED IN CODE (no adapter files exist) |

## 13. Production configuration

Railway env vars checked directly this session (`railway variables`): `LLM_PROVIDER_CHAIN=gemini,deepseek,ollama`, `GEMINI_API_KEY` set, `GEMINI_IMAGE_MODEL` set. No `TAVILY_API_KEY`, no `DEEPSEEK_API_KEY` — both fallback paths (search and cloud-provider fallback) are code-complete but inert until credentials exist.

## 14. Tests

New this session:

- `server/src/services/currentInfo.test.ts` — 14 tests: 10 confirm the newly-added trigger phrasings correctly activate current-info handling (including the exact two production-observed failures), 4 confirm non-current-info messages still don't.
- Existing `server/src/services/search/searchRouter.test.ts` (from earlier this session) still covers provider-chain fallback/health behavior at the mock level — unchanged, still passing.

**Not built**: the "known stale result A vs. fresh result B" ranking tests from the spec's Section 24 — there is no ranking/evidence-processing code yet for such a test to exercise (Section 4/7). Would be speculative tests for unbuilt code.

## 15. Production test results (this session, live against `api.jennysol.vikisol.in`)

| Query | Before fix | After fix |
|---|---|---|
| "Is Queen Sirikit alive?" | Confident, stale: "Yes... turned 92 in August" | Honest: "I can't confirm... my training data only goes up to the past" |
| "Can u search about her on google" | "I can't run a live web search" (technically true, but the query wasn't even recognized as current-info) | Same honest answer, now via the correctly-triggered current-info path — `sources: []` confirms no search actually ran (Section 3's real gap), but the reasoning path is now correct |
| "Who created JennySol?" (×4 phrasings) | 3 different, mutually contradictory hallucinations across separate test runs ("Solv", "Dave", "developed by Google") | Identical canonical answer every time, ~300ms (no model call at all — see `docs/JENNYSOL_CAPABILITIES.md`) |
| "How's weather" → "Am in Guntur..." (same conversation) | N/A (original report) | Coherent follow-up, correctly recognized as still about weather, honestly states no live weather tool exists, suggests the phone's own weather app |
| "Who is the current Queen of Thailand?" | Confident, no hedge (answer happens to be correct) | Same — hedging instruction did not fire this time (Section 8 limitation) |

## 16. Known limitations (full list)

**CRITICAL**: none remaining from this specific audit — the two originally-reported symptom classes (stale confident answers, unrecognized search requests) are both measurably improved and verified live.

**HIGH**: No search provider is actually returning live results in production right now (Section 3) — both available mechanisms (Tavily, Gemini native) are inert (unconfigured / quota-exhausted respectively). Every "fix" in this document improves *honesty when no search happens*, not the underlying absence of search itself. Closing this needs either a `TAVILY_API_KEY` or billing enabled on the Gemini key.

**MEDIUM**: Persona-level honesty instructions are probabilistic, not guaranteed (Section 8's Thailand-queen case). Weather has no dedicated provider at all (`docs/JENNYSOL_CAPABILITIES.md`). No timezone support (Section 6).

**LOW/PLANNED**: source-date extraction, source-quality tiering, multi-source conflict detection, query rewriting, a formal freshness-tier policy, a code-level stale-result guard — all documented as not built, all explicitly deferred until a real search provider exists to build them against (Section 4/7).

## Critical rule, restated

A search result — when one eventually exists in production — is evidence, not automatically truth. This document deliberately does not claim a verification/evidence-synthesis pipeline exists; it documents what was actually built (detection gaps closed, current date grounded, honesty instructions strengthened) and what remains correctly categorized as PLANNED until there's a live search provider to build it against.
