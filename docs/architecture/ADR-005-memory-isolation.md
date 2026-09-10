# ADR-005: Cross-Product Memory Isolation

**Status:** Accepted (architecture decision; implementation not started — see `PROJECT-PROGRESS.md`, milestone M8)
**Date:** 2026-09-10

## Context

JennySol's existing memory is real but narrow: raw per-conversation history, scoped by `user_id`,
verified isolated between two different JennySol accounts (`security.test.ts`, 10 passing tests).
There is no semantic/long-term memory layer yet (facts remembered across conversations) — the
architecture handoff document explicitly flags this as a future addition, not yet built. Once
Arena tool calls exist (ADR-002), a live question arises for the first time: if a user asks
JennySol something and, in the course of answering, a tool returns real Arena data (a candidate's
skills, a job's salary range, an application's status), does that data ever become part of
JennySol's own persistent memory about that user — and could it later leak into an unrelated
context, a different product, or a support/admin view?

## Decision

Arena tool-call results are **context for the current turn only**. They may be used to answer the
user's immediate question and may be included in that one conversation's own history (the same
way any assistant reply is already stored) — but they must never be promoted into whatever becomes
JennySol's cross-conversation, cross-product long-term memory (preferences, extracted facts)
without a separate, explicit action distinct from the tool call itself.

Every memory write, once a long-term memory layer exists, carries a `sourceProduct` field:

```
Fact { userId, category, key, value, sourceProduct: "jennysol" | "arena" | ... }
```

A fact whose `sourceProduct` is `"arena"` is visible only when JennySol is answering on behalf of
that same product/user context — it is not surfaced as general "things I know about you" in an
unrelated conversation, and it is never included in a cross-product memory summary without the
user's explicit awareness that it's happening.

## Why

- **Matches the layered memory model the founder explicitly required** (global JennySol memory,
  user memory, product memory, organization memory, conversation memory) — this ADR is the
  concrete mechanism (a `sourceProduct` tag, checked at read time) that keeps those layers from
  collapsing into one undifferentiated blob by default.
- **A candidate's data is not the user's own preference.** The clearest concrete case: an
  enterprise recruiter's tool call to `arena.getCandidate` returns a *different person's* private
  profile data. That must never become "a fact JennySol remembers about the recruiter" — it was
  never the recruiter's own information to begin with. This is a stricter, more specific version
  of the general product-isolation rule, worth naming explicitly rather than assuming the general
  rule covers it.
- **JennySol's own conversation-memory precedent already draws exactly this kind of line** between
  "raw history" (safe, ephemeral, already isolated per-user) and a future semantic-memory
  extraction step which its own docs say needs its own gate before being built — this ADR is that
  gate, defined before the extraction step is built rather than bolted on after.
- **Testable as a concrete assertion, not a policy statement.** "No Arena tool-call content ever
  appears in a cross-product memory read for an unrelated context" is directly verifiable by a
  test that calls a tool, then queries memory from a different simulated context and asserts the
  result is absent — exactly the kind of test `PROJECT-PROGRESS.md`'s Phase 6 (security
  verification) already lists as required (tests 13–14, currently BLOCKED pending this ADR's
  implementation).

## Consequences

- The long-term/semantic memory system JennySol eventually builds (currently NOT STARTED per
  `PROJECT-PROGRESS.md` Phase 2, item 18) must be designed with `sourceProduct` from its first
  version — retrofitting tagging onto an existing unscoped memory table later is real, avoidable
  migration risk.
- A user who wants "remember that I prefer remote roles" to apply across both a direct JennySol
  conversation and future Arena-agent conversations needs an explicit, product-independent
  preference-memory category — a deliberate exception to per-product isolation, not a default.
  This ADR does not design that mechanism; it only establishes that such sharing must be
  explicit and opt-in, never implicit.
- Arena's own data remains authoritative for Arena data. If a candidate's skills change in Arena,
  JennySol must never answer from a stale memorized copy — this ADR's "no promotion to long-term
  memory" rule is also what prevents that staleness class of bug, as a side effect of the
  isolation rule rather than a separately-designed cache-invalidation system.

## Alternatives considered

- **Treat all tool results as ordinary conversation content, subject to whatever memory policy
  conversation history already has.** Rejected — conversation history is already real and
  reasonably scoped (per-user), but "reasonably scoped" is not the same guarantee as "never
  becomes another product's or another user's memorized fact," which is the specific risk this
  ADR addresses.
- **Never let Arena tool results touch memory in any form, including the current conversation.**
  Rejected as unworkably strict — a user needs JennySol to remember what a tool returned *within
  the same conversation* to have a coherent multi-turn exchange about it; the isolation this ADR
  requires is about promotion to long-term/cross-product memory, not about the current turn.
