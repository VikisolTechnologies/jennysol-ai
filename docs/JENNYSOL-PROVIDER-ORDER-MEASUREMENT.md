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
