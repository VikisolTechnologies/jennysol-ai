# ADR-001: JennySol Becomes the Central AI Platform for the Vikisol Ecosystem

**Status:** Accepted (architecture decision; implementation not started — see `PROJECT-PROGRESS.md`)
**Date:** 2026-09-10

## Context

Vikisol Arena's own prior specifications repeatedly assumed a hypothetical AI service ("Jennsol")
would provide Arena's agent capabilities. Investigation found the real project — this repository,
`VikisolTechnologies/Jennysol-AI` — already exists as a deployed, actively-developed, general-
purpose conversational AI (chat, voice, RAG, image generation) with real per-user authentication,
a real multi-provider model router with circuit-breaker failover, and a durable AgentRun execution
model. It has zero Arena or product-specific awareness today.

Two designs were possible:

1. Build a second, Arena-specific AI service inside `arena-api`, duplicating model routing,
   provider failover, and conversation persistence that already exist here.
2. Extend this repository into the shared AI platform for every Vikisol product, with each
   product (Arena first) connecting through a controlled boundary.

## Decision

JennySol is the central AI platform for the Vikisol ecosystem. It owns model routing, agent
execution, general reasoning and core tools (search, weather, time, image, voice), and — once
built (ADR-002) — the tool registry and product-connector framework. Individual products (Arena,
and whatever comes after it) own their own users, authorization, and domain-specific tools, and
connect to JennySol as a controlled caller, never as an owner of JennySol's internals.

## Why

- **Avoids duplicating real, working infrastructure.** The model router
  (`services/modelRouter.ts`), circuit breaker (`services/providerHealth.ts`), and AgentRun
  durability model (`services/agentRunStore.ts`, `chatRunner.ts`) are already built, tested (196
  passing tests as of this ADR), and proven against real production traffic. Arena rebuilding
  these would be strictly worse — more code, less battle-tested, and a second thing to keep in
  sync with every future provider addition.
- **Keeps AI-specific complexity out of Arena's domain codebase.** Arena's own architecture
  documents (from a prior remediation round) already identified "Agent Chat is currently not a
  real AI agent" and specifically warned against building "another temporary chatbot
  architecture" inside Arena. This ADR is the direct resolution of that warning: don't build a
  second one — connect to the real one.
- **Matches the actual scale of the problem.** Vikisol has more than one product in its roadmap.
  A shared AI platform amortizes model-routing/provider-failover engineering across all of them;
  an Arena-only AI would need to be rebuilt or forked for the next product.

## Consequences

- JennySol's own roadmap now has an explicit new constituency (product integrations) alongside
  its existing personal-assistant use case. Its engineering priorities (Ollama installation,
  DeepSeek verification, Tavily/SearXNG configuration) are unaffected by this decision — those
  remain useful regardless of ecosystem integration.
- JennySol must build real multi-tenant/product identity (ADR-003) before any product's real user
  data reaches it — this is new, non-trivial work, not a relabeling of what exists.
- Arena's `AgentServiceClient` boundary (`arena-api`'s `com.vikisol.arena.agent` package) is
  confirmed as the correct shape for "Arena calls out to an external AI brain" and does not need
  to be redesigned — only given a real implementation once JennySol's side exists (ADR-002).

## Alternatives considered

- **Arena builds its own agent from scratch.** Rejected — duplicates real, working
  infrastructure and repeats the exact "temporary fake AI" mistake this whole investigation was
  triggered by.
- **Merge the two repositories.** Rejected — see ADR-002 and `PROJECT-PROGRESS.md`'s repository
  strategy section; separate deployability, security surfaces, and release cadences are worth
  more than the convenience of one repo.
