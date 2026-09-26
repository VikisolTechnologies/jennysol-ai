# Provider order measurement (STEP 2, decision #10)

Real, live measurement, 2026-09-26. Same 20 prompts as `JENNYSOL-CURRENT-STATE.md` §5, run twice
through the real `routeChatCompletion` — once with today's default chain, once with the new
`LLM_LOCAL_FIRST_ENABLED=true` (Ollama first for `general`/`trivial` tasks only, per decision #10)
— against real Gemini and the real local Ollama fleet. Script: `server/scripts/measure-provider-order.ts`.

## Result

| | p50 | p95 | local share | errors |
|---|---|---|---|---|
| **BEFORE** (today's default) | 1,609ms | 11,031ms | 0% | 0 |
| **AFTER** (`LLM_LOCAL_FIRST_ENABLED=true`) | 4,181ms | **121,214ms** | 15% (3/20) | 1 |

**p95 got roughly 11x worse.** Two of the three requests that actually landed on Ollama were
genuinely bad:
- "Compare AWS vs GCP for a startup" (`general`) took **121,214ms — over two minutes** — via
  `qwen3:8b`.
- "Apply me to the top matching job" (`general`) took 25,830ms.
- "Explain quantum entanglement in simple terms" (`trivial`) never finished at all — it had to be
  manually terminated after several more minutes of hanging, and is counted as the one error above.
- Only "thanks!" (4,551ms) came back at a latency that wouldn't feel broken to a real user.

## The root cause, not just the number

This traces to a real finding already flagged in `JENNYSOL-CURRENT-STATE.md` §5: `qwen3:8b`'s
"warm" latency was already measured at 5–6 seconds for a two-word reply, likely its default
"thinking" preamble. What this measurement adds: **that preamble's length is not bounded**, and the
router's own first-token timeout doesn't catch it — the router measures *any* provider activity,
including thinking-trace tokens, as satisfying the timeout (a deliberate, documented design for
telling "cold" from "hung," not for capping total response time). So a model that's actively
"thinking out loud" passes the liveness check every time, and can then legitimately run for minutes
before producing a real answer. This is a genuine robustness gap independent of today's decision —
logged as a follow-up in `BLOCKERS.md`.

## Decision: `LLM_LOCAL_FIRST_ENABLED` stays off by default

Per the founder's own explicit fallback condition ("if local-first makes the p95 clearly worse for
users, keep it behind a flag and report the numbers instead") — this is exactly that case, with
real numbers, not a guess. The flag (`modelRouter.ts`'s `effectiveChainOverride`, off by default,
fully tested) ships as dormant infrastructure: safe to have in the codebase, not safe to turn on
in production against the current local fleet.

**What would change this recommendation:** a genuinely fast local model for `general`/`trivial`
traffic (the current fleet's `qwen2.5-coder:7b` measured a 192ms *warm* response earlier in this
session — dramatically better than `qwen3:8b`'s 5–6s+ — but it's tagged for coding, not general
chat; worth a real evaluation of whether a smaller, non-"thinking" general-purpose model would
serve this traffic acceptably before revisiting local-first).

**Keep-warm:** not expanded beyond today's single "general" model default. Given warm latency
itself is the problem here (not just cold-start), adding more keep-warm capacity for `general`
doesn't address what this measurement actually found.

## STEP 2b re-measure (26 Sep 2026, after the deadline fix)

Same 20 prompts, same script (`server/scripts/measure-provider-order.ts`). This pass sends
`reasoning_effort: "none"` for general/fast qwen3, caps each Ollama attempt at 30s (60s for
reasoning), and warms `qwen3:8b` and `qwen3:4b` before the local-first pass. Prompts were spaced
4.5s apart. An earlier unpaced run hit Gemini's free-tier 429 and was discarded. The table is
the completed log.

| | p50 | p95 | local share | errors |
|---|---|---|---|---|
| **BEFORE** (today's default) | 1,523ms | 12,005ms | 0% | 0 |
| **AFTER** (local-first, think off, deadlines, keep-warm) | 7,027ms | **18,885ms** | 25% (5/20) | 1 |

18,885 / 12,005 is **1.57×**. The review's line for proposing the flag was about 1.5×. This is
past that line, and p50 went from 1.5s to 7.0s. `LLM_LOCAL_FIRST_ENABLED` stays off.

What the local attempts actually did:

- Five trivial prompts finished on `qwen3:4b`. First answer tokens arrived in 112–2,437ms, so
  thinking was off. The full replies still took 7.3–18.9s.
- Three general prompts produced no answer token within 2.5s and fell back to Gemini.
- "Explain quantum entanglement in simple terms" streamed a partial answer, then hit the 30s
  total deadline and failed honestly. That is the one error.
- Nothing ran for minutes. The previous 121s p95 and the manual kill are gone.

## STEP 2b re-measure v2 (26 Sep 2026, after fixing a miscalibrated first-token timeout)

The run above still bounced most `general` prompts off Gemini before Ollama got a real chance:
`LLM_LOCAL_FIRST_TOKEN_TIMEOUT_MS` defaulted to 2,500ms, tuned for "thinking is off, so the first
answer token should be near-instant." Direct measurement against the real deployment topology
(Railway → Tailscale relay → the Mac's Ollama) with `think:false` found first-answer-token latency
of 3.15–3.82s on `qwen3:4b`/`qwen3:8b` even on short prompts — the 2,500ms budget failed the
attempt before generation had a real chance to start, every time, tripping the circuit breaker on
top. `modelRouter.ts`'s `firstTokenTimeoutMs()` now defaults to 8,000ms (still overridable via the
same env var). This is a measurement-accuracy fix, not a new mechanism — the 30s/60s total
deadline and "thinking doesn't count as progress" from the pass above are unchanged.

Same 20 prompts, same script, same warmed models, prompts spaced 5s apart.

| | p50 | p95 | local share | errors |
|---|---|---|---|---|
| **BEFORE** (today's default) | 1,659ms | 12,024ms | 0% | 0 |
| **AFTER** (8s first-token timeout, everything else from v1) | 7,161ms | **13,833ms** | 30% (6/20) | 3 |

13,833 / 12,024 is **1.15×** — comfortably inside the review's ~1.5× line, a real improvement over
v1's 1.57×. But this run also surfaces something v1's tighter timeout was hiding: **3 of 20
requests (15%) now fail outright** instead of falling back to Gemini — "What's a good recipe for
butter chicken?", "Explain quantum entanglement in simple terms", and "Compare AWS vs GCP for a
startup" all streamed real answer tokens on Ollama, then hit the 30s total deadline mid-generation
and failed rather than falling back (the router's documented "already streamed, can't safely
retry" guard). v1's own single error was the same shape; this pass just has three because more
requests now actually reach Ollama at all.

**What this changes about the recommendation:** the *latency* case for local-first now looks
better than v1 reported (1.15× is a real win, not the 1.57× regression written above). The
*reliability* case looks worse: local-first for public `general`/`trivial` traffic would mean
~1 in 7 real chat replies fails outright rather than degrading to a slower cloud answer, because
this pipeline's "don't duplicate partial content" guard treats a `general`/`trivial` cloud-eligible
request the same as a `PRIVATE`-tier one that must never leak to the cloud. `LLM_LOCAL_FIRST_ENABLED`
stays off — now specifically because of the failure rate, not the latency, and that's a distinct
open question worth its own look: should a `general`/`trivial` local attempt that's already
streamed be allowed to hand off to Gemini with a "let me redo that" rather than failing, since
unlike `PRIVATE` traffic it was never barred from the cloud in the first place? Logged in
`BLOCKERS.md`.
