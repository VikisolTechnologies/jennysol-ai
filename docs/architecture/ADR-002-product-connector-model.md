# ADR-002: Product Connector Model

**Status:** Accepted (architecture decision; implementation not started — see `PROJECT-PROGRESS.md`, milestones M3–M5)
**Date:** 2026-09-10

## Context

If JennySol is the central AI platform (ADR-001), it needs a way to know about Arena's tools
(and, later, other products' tools) without its core — the model router, the AgentRun runtime, the
chat loop — becoming aware of Arena-specific concepts like "candidate," "unlock credit," or
"job posting." Today, `server/src` contains zero references to Arena anywhere (confirmed via
repo-wide `grep`), which is correct — the question this ADR answers is how that stays true even
after real integration exists.

## Decision

Introduce a **Product Connector** abstraction: a small, uniform interface each integrated product
implements to register its own tools with JennySol's Tool Registry (ADR-004 covers the approval
model for what those tools can do; this ADR covers only how they get registered). Arena becomes
the first connector, not a special case hardcoded into JennySol's core.

```
ToolRegistry
  registerConnector(connector: ProductConnector): void

ProductConnector
  productName: string          // "arena"
  getTools(): ToolDefinition[] // arena.searchJobs, arena.getCandidate, ...
  verifyIdentity(token): ProductIdentity | null
```

JennySol's chat/agent loop asks the registry "what tools are available for this
`ProductIdentity`" — it never imports or references `arena.*` tool logic directly. Arena's own
domain logic (`TalentSearchService`, `ApplicationService`, etc.) is called only from Arena's own
tool-endpoint implementations, reached over the network exactly like a normal Arena API caller.

## Why

- **Keeps JennySol product-agnostic**, which is the entire point of ADR-001. A hardcoded
  `if (product === "arena")` branch anywhere in the model-router, memory, or chat-loop code would
  be the "JennySol becomes Arena-shaped" failure mode this whole design exists to prevent.
- **Makes the second product cheap.** Once the connector interface and registry exist, a future
  Vikisol product implements the same small interface — it does not need JennySol's core team to
  change JennySol's core code to be supported.
- **Matches JennySol's own existing pattern.** `LlmProvider` (model providers) and
  `SearchProvider` (search providers) already use exactly this shape — an interface, a registry/
  router, concrete implementations behind it. `ProductConnector` is the same idiom applied one
  layer up, not a new architectural style being introduced.

## Consequences

- Arena's tool wrappers (Phase 4/6 of `PROJECT-PROGRESS.md`) live in Arena's own codebase (a thin
  `AgentToolController`), not inside JennySol. JennySol's Arena connector only knows the tool
  *schemas* and the network location to call, never Arena's internal service classes.
- A tool's actual execution always crosses a real network boundary and a real authorization check
  on Arena's side — there is no in-process shortcut, even though both services may eventually run
  on the same cloud provider.
- This ADR does not by itself solve identity/authentication (ADR-003) or approval (ADR-004) — it
  only describes how a product's tools become visible to the registry once those exist.

## Alternatives considered

- **Hardcode Arena awareness directly into JennySol's chat loop.** Rejected — this is exactly the
  coupling ADR-001 exists to avoid, and would need to be redone for every future product.
- **A plugin system loaded via dynamic imports/npm packages.** Rejected as unnecessary complexity
  for the current scale (one product); the same interface can be satisfied by a network-based
  connector without JennySol needing to load Arena's code into its own process at all — the
  simpler and more secure option.
