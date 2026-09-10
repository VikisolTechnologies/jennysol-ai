# ADR-003: Service-Token Identity Federation

**Status:** Accepted (architecture decision; implementation not started — see `PROJECT-PROGRESS.md`, milestone M2)
**Date:** 2026-09-10

## Context

JennySol's current authentication (`services/auth/sessions.ts`) resolves a request to exactly one
thing: a JennySol `User` row, reached via password, Google Sign-In, or guest creation. There is no
concept of "this request is on behalf of an authenticated user of a *different* product." Arena
already has its own real, tested authentication (15-minute JWTs, rotating refresh tokens, RBAC,
TOTP for admin roles) and its own tenant model (`EnterpriseProfile`/`Membership`). Connecting the
two without creating a new class of vulnerability is the single highest-risk piece of this entire
integration — explicitly named as such in the founder's own instruction that triggered this
investigation ("Do NOT use one shared JennySol password for all Arena users").

## Decision

Arena mints a **short-lived, narrowly-scoped service token** when a user opens the agent, and
JennySol verifies it on every call from Arena's connector. This token is not Arena's session JWT,
not Arena's refresh token, and not a JennySol session token — it is a fourth, purpose-built
credential type that exists only to carry identity across this one boundary.

```
Service token claims (minimum):
  iss:   "arena"                    — which product issued it
  aud:   "jennysol"                 — who it's valid for
  sub:   Arena userId               — never a JennySol id
  role:  Arena role (TALENT, RECRUITER, ...)
  tenantId: Arena EnterpriseProfile id, if applicable
  scope: [ "arena.searchJobs", "arena.getMyProfile", ... ]  — explicit allow-list, not "all tools"
  exp:   short (minutes, not the session's full lifetime)
```

Arena's connector on the JennySol side verifies signature, issuer, audience, expiry, and scope on
every tool call — not once at session start. A token whose scope doesn't include the tool being
called is rejected server-side, not merely hidden in the UI.

## Why

- **Never a shared password, ever.** Directly satisfies the explicit instruction this ADR
  responds to. JennySol's existing `JENNYSOL_PASSWORD`-style single-secret auth (present in the
  earlier, unrelated local prototype, and structurally the kind of pattern to avoid) cannot
  represent "many different Arena users," so a fundamentally different, per-user credential is
  required — not a reuse of anything that exists today.
- **Arena remains the source of truth for Arena identity.** JennySol never independently decides
  who an Arena user is or what tenant they belong to — it only verifies a claim Arena already
  made and signed. This mirrors Arena's own internal rule (already true for every existing
  controller) that authorization is always re-derived server-side, never trusted from the caller.
- **Scope, not just identity, limits blast radius.** A compromised or overly-broad token is still
  bounded by its `scope` claim — a token minted for "answer questions about my own applications"
  cannot be replayed against `arena.unlockCandidateContact` even if leaked, because the tool
  endpoint itself checks scope, not just validity.
- **Short expiry bounds the token-replay risk** named explicitly in the founder's requested test
  list (`PROJECT-PROGRESS.md` Phase 6, tests 1–8) — a stolen token is only useful for minutes, not
  for the life of a login session.

## Consequences

- Arena needs a new, small token-issuing capability (`AgentServiceTokenIssuer`, milestone M5) —
  not a reuse of its existing JWT issuer, since the claim shape and audience are different and
  conflating them risks accidentally widening what a stolen Arena session token could do.
- JennySol needs a verifier for tokens it did not issue itself — a new trust boundary requiring
  its own explicit key/secret management, separate from JennySol's own session-signing (if any is
  ever added; today JennySol sessions are opaque DB tokens, not signed JWTs, so this introduces
  JennySol's first cryptographic-signature verification code path).
- Per the founder's own instruction and this project's engineering discipline elsewhere: this
  layer must be built and tested against a **fake product connector first** (milestone M2, before
  M5), so the first real credentials Arena ever sends are hitting already-hardened code, not code
  being debugged live against real user data.

## Alternatives considered

- **Reuse Arena's existing JWT directly.** Rejected — it was never scoped or audienced for this
  purpose, has a longer lifetime than is appropriate for a cross-service credential, and its
  compromise would have blast radius across all of Arena, not just the agent boundary.
- **A single shared API key between Arena and JennySol (no per-user identity).** Rejected — this
  is the multi-tenant equivalent of the shared-password anti-pattern the founder explicitly ruled
  out; it would make every Arena user indistinguishable to JennySol, breaking tenant isolation
  and per-user authorization entirely.
- **OAuth2 client-credentials + a separate user-context header.** A reasonable alternative
  implementation of the same idea above; left as an implementation detail for milestone M2 rather
  than decided here, since the security property (short-lived, scoped, Arena-issued,
  JennySol-verified) is what matters, not the specific token format.
