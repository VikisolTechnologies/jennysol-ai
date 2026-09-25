# JennySol — current state (ground-truth audit, STEP 2)

Written 2026-09-26, on `feature/jenny-audit`, tip `aa25c3a`. This supersedes the routing/module
parts of `docs/CURRENT-STATE-AUDIT.md` (Codex's earlier audit) where the two disagree — most of
that doc's findings 1–7 have since been fixed (see §4). Its finding 8 (privacy/scale/identity
architecture gaps) is still open and is folded into the DoD table below (§6).

**Method:** every claim below is either (a) read directly from the source with a file:line
reference, (b) a real command actually run during this session with its output shown, or (c)
traced through deterministic code (`classifyTask()`) rather than guessed. Nothing here is a
number I made up to look complete — where I didn't measure something, I say so.

---

## 1. Repo and deploy state

- Tip `aa25c3a` on `feature/jenny-audit` (branched from `main` at `33abb27`, which is live in
  production — `https://api.jennysol.vikisol.in/health` → `{"status":"ok","version":"33abb27"}`
  as of this morning's live check). Nothing in this branch has deployed yet.
- Tests: **687 total, 685 passed, 2 skipped, 69 files.** `npx tsc --noEmit -p .` clean for both
  `server` and `client`.
- Local `in.vikisol.jennysol-server` launchd service on the Mac (127.0.0.1:8787) reports
  `1177af1-dirty` — **stale**, several commits behind. Not production-facing (Railway serves
  production), but worth a rebuild before relying on it for local testing.

## 2. Module status

| Module | Status | Evidence |
|---|---|---|
| Auth, conversations, AgentRun (streaming) | Working | `chatRunner.ts`, existing test suite |
| Model router (provider chain, circuit breaker, hedging) | Working, hedging **off by default** | `modelRouter.ts:199` `hedgeEnabled()` reads `LLM_HEDGE_ENABLED`, unset in production's Railway vars |
| Ollama provider | Working | confirmed reachable this session at `100.70.199.75:11434` |
| Gemini provider (text, TTS, images) | Working | only one with a production key today |
| DeepSeek provider | Code exists, **not configured** | no `DEEPSEEK_API_KEY` in production or local `.env` |
| Anthropic provider (Haiku/Sonnet/Opus tiers) | Code exists, **deliberately not enabled** | no `ANTHROPIC_API_KEY` in production — do not set it without founder approval |
| Tavily web search | Working | `TAVILY_API_KEY` set in production |
| RAG (in-process ONNX embeddings) | Working | `Xenova/all-MiniLM-L6-v2`; the old Ollama nomic-embed path was already removed (`modelRegistry.ts:227`) |
| Tool registry, approvals (`pendingActions`) | Working, hardened | SQLite-durable (STEP 0's prior session), single-use, 5-min TTL, owner-checked — see `docs/JENNY-ARENA-CONTRACT.md` |
| Voice (browser STT, Gemini TTS, barge-in) | Working | unchanged this run |
| Arena connector | **Live in production**, extended this run | see §STEP 1 / `JENNY-ARENA-CONTRACT.md` |
| **Cold-start mitigation** | **Partially built, not fully verified in prod** — see §3 | `keepWarm.ts`, `shadowTraffic.ts`, `modelRouter.ts`'s hedge race |
| Frontend screens (client/) | Working | `npx tsc --noEmit -p .` clean |

### 3. Correction to the v2 mission draft: cold-start work already exists
The mission's "known issue #2" (no cold-start warming) is **only half true**. Already built and
wired into `src/index.ts:28`:
- **`keepWarm.ts`**: pings the "general" capability's local model (`qwen3:8b`) every 4 minutes
  when Ollama is in the active provider chain, on a distinct log event so it never pollutes real
  request metrics, and clears the circuit breaker on a successful ping. References a prior
  `JENNYSOL-LOCAL-CUTOVER.md` mission (not found in this repo — logged in `ACCESS-NEEDED.md`).
- **`shadowTraffic.ts`**: for 5% of real requests *not* served by Ollama, fires a parallel,
  discarded copy at Ollama to collect real latency/error-rate evidence, without affecting what
  the user sees.
- **Hedging** (`modelRouter.ts:376` `runHedgedPair`): if the primary provider shows no sign of
  life within `LLM_HEDGE_DELAY_MS` (default 4s), a secondary provider races it; whichever answers
  first wins. This *is* "fall back if the model isn't ready in time" — but **it's off by default**
  and not enabled in production.
- **What's genuinely still missing:** keep-warm only pings one model (`qwen3:8b`, "general").
  `qwen2.5-coder:7b` (coding) and `deepseek-r1:7b` (reasoning) are never proactively warmed, so a
  coding/reasoning request still pays a real cold-load cost (see §5's measured numbers) unless a
  general request happened to warm the box recently — and warming all four simultaneously isn't
  safe on 16GB (see §5). No client-visible "warming up" state exists (verified: no match for
  "warming" anywhere in `client/src`).

## 4. Codex's earlier findings (`docs/CURRENT-STATE-AUDIT.md`) — current status

| # | Finding | Status now |
|---|---|---|
| 1 | Workspace boundary didn't block filesystem escapes | **Fixed** (STEP 0 of the previous session — symlink/credential-file blocking in `agentWorkspace.ts`) |
| 2 | Activity approval wasn't bound to its post | **Fixed** (`findByIdAndPostId` in Arena-BE) |
| 3 | Capacity/lifecycle approval gates incomplete | **Fixed** (`requireOpenCapacity` re-checked at approval) |
| 4 | Arena/Jenny action integration unfinished | **Fixed and now live in production** — see §STEP 1 |
| 5 | Pending approvals volatile, wrong-owner attempts consumed them | **Fixed** (SQLite-durable, ownership checked inside the same transaction before deletion) |
| 6 | Data failures rendered as empty feed lanes | **Fixed** (Arena-FE's `HomeContent` failed-lanes banner) |
| 7 | Demo provenance lost at the AI boundary | **Fixed** (`demoContent: true` passed through every `slim*()` helper in `arena.ts`, and the gateway system prompt instructs the model to label it) |
| 8 | Privacy, scale and identity architecture gaps | **Still open** — this is real, ongoing v1-core work (privacy tiers, memory scoping), tracked in §6's DoD table, not a bug to fix in STEP 2 |

## 5. Routing table

**Classification is real code, traced exactly** (`classifyTask()`, `modelRegistry.ts:319`) — this
is not a guess, it's what the function actually returns for each string:

| Prompt | `classifyTask()` result | Local model it would route to (if Ollama is chosen) |
|---|---|---|
| "Hi" | trivial | `qwen3:4b` |
| "thanks!" | trivial | `qwen3:4b` |
| "What's the weather like in Hyderabad today?" | currentInfoSummarization | `qwen3:4b` (only "trivial" model also lists this capability) |
| "What time is it right now?" | currentInfoSummarization | `qwen3:4b` |
| "Who won the cricket world cup in 2023?" | currentInfoSummarization | `qwen3:4b` |
| "What's the latest news about the stock market?" | currentInfoSummarization | `qwen3:4b` |
| "Write a Python function to reverse a linked list" | coding | `qwen2.5-coder:7b` |
| "Debug this JavaScript error: TypeError undefined" | coding | `qwen2.5-coder:7b` |
| "Refactor this React component to use hooks" | coding | `qwen2.5-coder:7b` |
| "Walk me through your reasoning step by step for this logic puzzle" | reasoning | `deepseek-r1:7b` |
| "Prove that the square root of 2 is irrational" | reasoning | `deepseek-r1:7b` |
| "Think through the tradeoffs of microservices vs monolith" | reasoning | `deepseek-r1:7b` |
| "Find me a badminton game tonight in Gachibowli" | currentInfoSummarization | `qwen3:4b` (see finding below) |
| "Apply me to the top matching job" | general | `qwen3:8b` |
| "Summarize this document for me" | trivial | `qwen3:4b` (see finding below) |
| "What's a good recipe for butter chicken?" | general | `qwen3:8b` |
| "Tell me a joke" | trivial | `qwen3:4b` |
| "Explain quantum entanglement in simple terms" | trivial (6 words, at the threshold) | `qwen3:4b` (see finding below) |
| "Compare AWS vs GCP for a startup" | general | `qwen3:8b` |
| "ok" | trivial | `qwen3:4b` |

**Two real, minor routing-quality findings** (not blocking, not touched this run — flagging for a
future tuning pass):
1. "Explain quantum entanglement in simple terms" and "Summarize this document for me" both land
   on "trivial" purely by word count (≤6 words), even though neither is conceptually trivial. This
   is the documented, deliberate trade-off in `classifyTask()`'s own comment — worth revisiting
   the threshold, not a bug.
2. "Find me a badminton game tonight in Gachibowli" is classified `currentInfoSummarization`
   because of the word "tonight" — this is JennySol's **own** chat classifier
   (`models/modelRegistry.ts`), which is entirely separate from the Arena gateway's own
   classifier (`models/modelTiers.ts`'s `classifyDifficulty()`, Haiku/Sonnet/Opus tiers). **This
   distinction is easy to conflate and worth being explicit about:** a message asking Jenny (via
   Arena) to find an activity never goes through `classifyTask()` at all — it goes through
   `classifyDifficulty()`, and (since `ANTHROPIC_API_KEY` isn't set) actually gets answered by
   Gemini regardless of tier.

**Real, measured latency** (this session, against the Mac's actual Ollama instance at
`100.70.199.75:11434`, unloaded with `keep_alive:0` immediately before the "cold" call):

| Model | Cold (ms) | Warm (ms) |
|---|---|---|
| `qwen3:4b` | 14,000 | 5,449 |
| `qwen2.5-coder:7b` | 5,544 | 192 |
| `deepseek-r1:7b` | 8,917 | 916 |
| `qwen3:8b` | 13,054 | 5,995 |

**A real finding from these numbers, not previously documented:** both Qwen3 models' "warm"
latency is still 5–6 seconds for a two-word reply ("Say OK.") — dramatically slower than
`qwen2.5-coder:7b`'s 192ms warm or `deepseek-r1:7b`'s 916ms warm. The likely cause is Qwen3's
default chat template including a "thinking" preamble even for trivial prompts, which would
explain why `qwen3:8b` is the one model `keepWarm.ts` proactively keeps resident (§3) — it's the
one that most needs it — but also means the *current* keep-warm target is genuinely the slowest
model in the fleet even when warm. Worth a closer look before deciding whether `qwen3:8b` should
stay the default "general" model.

**Gemini latency** (real numbers already observed live this session, from the production-key
end-to-end runs earlier today, not re-fetched for this doc): first-token times of 2,943–10,620ms
across several real requests, plus one hard timeout and one 429 quota error during a burst of
requests. This is the actual, currently-relied-on production path (Ollama is last in the chain,
after Gemini and an unconfigured DeepSeek).

## 6. Security — active isolation-break attempt

Ran the existing isolation suite live rather than only reading it:
```
npx vitest run src/agentGateway.memoryIsolation.test.ts src/agentGateway.audit.test.ts
✓ 8 tests passed
```
This suite (M8) actively tries: reading another identity's conversation history through a crafted
request, smuggling a foreign scope claim into a token's `scope` array, and confirming a tool
result never gets written to any persistence path an unrelated identity could later read from.

**Additional attempts made directly this session, not just re-running existing tests:**
- Tried approving another user's pending action across identities (both via the HTTP contract
  test added in STEP 1, and via the live production check this morning) — rejected with 404 both
  times, never a 200.
- Traced `ToolRegistry.getToolsFor()`/`dispatch()` by hand: a widgetco-identity token whose `scope`
  array is manually set to include an acme tool name still never sees or can invoke it — the
  registry filters by the identity's *own* product **before** consulting scope at all, so a
  misissued or forged scope claim has no path to a foreign product's tool regardless of its
  contents (`toolRegistry.test.ts`'s own "cross-product tools stay invisible even if a
  misconfigured token's scope names them" test, re-run and confirmed passing).
- Traced `consumeAction()` (`pendingActions.ts:57`): ownership is checked *inside* the same
  transaction that would delete the row, before deletion — so there's no window where a wrong
  identity's failed attempt could still consume (and thereby deny) the real owner's later approval.

**No successful isolation break found.** This matches the "zero safety violations" gate the
mission's evals will need to keep proving as new tools are added.

## 7. Cost

- **Calls that hit paid cloud today:** every chat request that isn't served by Ollama hits Gemini
  (the only funded provider; DeepSeek and Anthropic have no production key). Given Ollama is last
  in the chain and hedging is off, in practice **almost all production chat traffic pays for
  Gemini** right now — Ollama only serves if Gemini's request outright fails.
- Image generation: Gemini (blocked by a zero-quota billing tier per `capabilityRegistry.ts`),
  then fal.ai (paid, not configured — no `FAL_KEY`), then the local worker (free, built but not
  wired into production). Net effect: **image generation isn't actually working in production**
  today beyond the honest "not available yet" message.
- TTS: Gemini, paid, no self-hosted alternative live yet.
- No per-request cost logging/dashboard exists yet — this is real, unmeasured spend, not a
  precisely quantified one. Flagging as a genuine gap rather than inventing a number.

## 8. Dead code

Swept for `TODO`/`FIXME`/`@deprecated`/orphaned exports: **none found.** The codebase's own
convention is to document a deliberately-kept "dead" fallback in a comment rather than leave a
bare TODO (e.g., the `llama3.2:3b` registry entry, `modelRegistry.ts:93`). The one real historical
dead path (Ollama's `nomic-embed-text` RAG entry) was already removed in a prior session
(`modelRegistry.ts:227`'s own comment cites the removal). Nothing new to clean up this run.

## 9. Gap against the v1 Definition of Done

| DoD item (`VIKISOL-MASTER-CONTEXT.md` §6.13) | Status |
|---|---|
| Model Gateway (config-driven registry, one interface, task/privacy/health/latency/cost routing) | **Partially exists.** `modelRegistry.ts` + `modelRouter.ts` already do config-driven routing by task/health/latency/cost — genuinely reusable, not a rewrite target. **Privacy tier is the real gap** (next row). |
| Privacy tiers (LOCAL/PRIVATE/PUBLIC_CLOUD, no silent escalation) | **Not built.** Confirmed: no `PrivacyTier` type or equivalent anywhere in `src`. |
| Agent runtime as a durable, resumable, cancellable state machine (Goal Mode) | **Not built.** Today's `AgentRun` is a single streamed turn, not a multi-step plan→execute→observe→re-plan loop with `queued/running/awaiting_approval/completed/failed/cancelled` states. |
| ≥10 safe, typed, risk-rated tools | **9 exist today** (Arena's 5 write + 4 read), now risk-rated (STEP 1). One short of 10 and all Arena-specific — the addendum's suggested general tools (web search/open/extract, file read/create, calendar) aren't wired as agent-runtime tools yet, though web search itself exists as a capability (`searchRouter.ts`). |
| Memory/RAG scoped by user+product+tenant+purpose, exportable/deletable | **Partially exists.** RAG is scoped per-user today (SQLite + embeddings); tenant/purpose scoping and export/delete self-service aren't built. |
| Arena contract published, backward-compatible, live | **Done** — see `JENNY-ARENA-CONTRACT.md`, verified end to end in production. |
| Extension points designed (agent teams, browser/computer use, marketplace, tenants, One, GPU fleet) | Not written up yet — this is STEP 4's job (`JENNYSOL-ARCHITECTURE.md`), not STEP 2's. |
| Provider independence proven (same run works on Ollama and Gemini via config only) | **True today for plain chat** (the existing provider chain already does this) — **not yet proven for the agent-runtime/Goal Mode concept**, since that doesn't exist yet. |
| 3 real workflows end to end | **1 of 3 already real and proven**: Arena find→propose→approve→execute (verified live in production this morning). Research-with-citations and the sandboxed developer PR workflow don't exist yet. |

**Bottom line for STEP 4/5:** the model-routing and Arena-integration halves of "v1 core" are
substantially further along than the mission draft assumed. The genuinely unbuilt halves are the
agent-runtime state machine (Goal Mode, Task/TaskStep, budgets, stop conditions) and privacy
tiers — that's where STEP 5's real effort belongs, not in redoing what's already here.
