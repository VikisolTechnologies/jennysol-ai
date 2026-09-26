# ADR-007 — Agency Desk data privacy and provider routing

**Status:** Accepted by the architect (Claude), 26 Sep 2026. Items marked **FOUNDER** need Syam's action or confirmation.
**Inputs:**
- the founder/Codex privacy direction (26 Sep);
- ADR-005 (memory isolation);
- the existing privacy watch-only mode (`server/src/services/privacyTier.ts`, `PRIVACY_TIER_ENFORCE` off);
- master context §14.

## 1. Decision in one paragraph
Agency Desk is **private-first**. Identifiable candidate and agency data is processed **only** on Vikisol-controlled private infrastructure, or in the agency's own environment. A cloud model may see **only minimized, redacted or synthetic content**, and only through a **paid, no-training** Gemini project, with an audit record and the agency's written permission. There is **no automatic escalation**: if the permitted path is unavailable, the request fails honestly. Enforcement for agency data is **on from day one**; there is no shadow mode for agency tenants.

## 2. What this changes versus today (reconciliation)
| Today | After ADR-007 |
|---|---|
| Three tiers: LOCAL, PRIVATE, PUBLIC_CLOUD. Watch-only; `PRIVACY_TIER_ENFORCE` unset. | **Four tiers:**<br>• `LOCAL`: this machine/process only.<br>• `PRIVATE`: Vikisol-controlled private infrastructure only.<br>• `CONTROLLED_CLOUD` (**new**): the paid Gemini project only, redacted/minimized payload, audit record, agency permission required.<br>• `PUBLIC_CLOUD`: any approved provider. |
| Enforcement is global and off. | Enforcement is **per tenant**. **Agency tenants are always enforced**, whatever the global flag says. Arena and JennySol consumer traffic stay watch-only until their own enforcement decision. |
| "Local" means the founder's Mac over Tailscale. | For agency data, "private" means **a Vikisol-controlled server**, never the founder's personal Mac. Until such a server exists, **workflows that touch identifiable candidate data do not run.** |
| Provider chain may fall back across providers. | For CONTROLLED_CLOUD/PRIVATE/LOCAL data the chain is filtered **before** routing. An empty chain means an honest failure. There is never a silent fallback to a lower tier. |

## 3. Data classification
| Class | Examples | Allowed tiers |
|---|---|---|
| **A: Identifiable / confidential** | CV files, names, emails, phones, addresses, recruiter notes, compensation, notice period, interview feedback, communication history, confidential client identity, embeddings/vector indexes, long-term memory, exports, audit records | `LOCAL`, `PRIVATE` only |
| **B: Minimized** | Redacted JDs (client name, emails, phones and URLs removed), de-identified candidate summaries (no identifiers or free-text notes) | + `CONTROLLED_CLOUD` (with agency permission) |
| **C: Non-sensitive** | Synthetic eval data, public information, generic writing/formatting | + `PUBLIC_CLOUD` |

**Classification is decided in deterministic code** (by the route, the data source and the redaction result), never by the model. When in doubt, the class is A.

## 4. Data flow
```
Recruiter upload (TLS) ─► encrypted-at-rest store (tenant = agency)
        │
        ▼
Local parsing + deterministic identifier detection (regex + known-field extraction)
        │
        ▼
Classification (code) ──► Class A ──► PRIVATE model only ──► unavailable? ► honest failure
        │
        ├─► Class B ──► redaction check passes? ──► agency setting allows cloud? ──► kill switch off?
        │                         │ no                        │ no                        │ on
        │                         ▼                           ▼                           ▼
        │                   treat as Class A            treat as Class A            treat as Class A
        │                         │ yes (all three)
        │                         ▼
        │                 paid Gemini (CONTROLLED_CLOUD, minimal context)
        │
        ▼
Local validation (schema + protected-attribute guardrail)
        ▼
Recruiter review (edit / approve)  ─►  audit record (provider, class, redaction result,
                                        policy decision, model, latency — NO prompt content)
```

## 5. Provider routing matrix
| Data class \ Provider | Local Ollama (founder's Mac) | Vikisol private server (future) | Paid Gemini (Developer API) | Vertex AI asia-south1 + DPA | Free Gemini | Hosted DeepSeek | Anthropic/OpenAI |
|---|---|---|---|---|---|---|---|
| Agency A | ✗ | ✓ | ✗ | ✗ until the §8 decision | ✗ | ✗ | ✗ |
| Agency B | ✗ | ✓ | ✓ (redacted, permitted) | ✓ (after the decision) | ✗ | ✗ | ✗ |
| Agency C (synthetic/public) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Arena / consumer JennySol | as today (watch-only) | ✓ | ✓ | ✓ | **✗ (see §7)** | ✗ | only with founder approval |

**Paid Gemini configuration for Agency Desk:**
- no Search/Maps grounding;
- no File API storage;
- no explicit context caching;
- no shared logging datasets;
- no feedback containing real agency data;
- Interactions API `store=false` if used.

The Developer API may keep data for limited abuse monitoring, so it is **never described as zero-retention or on-prem.**

**Hosted DeepSeek:** not an approved processor for anything; the earlier idea of a DeepSeek backup key is **withdrawn**. DeepSeek open weights may be evaluated locally only.

## 6. Pilot staging (keeps it cheap)
- **Stage 1: Workflow 1 (JD → scorecard).** Uses only Class B (redacted JD) and Class C (synthetic eval set). Runs on **paid Gemini, CONTROLLED_CLOUD**. **No candidate data exists in Stage 1**, so no private server is needed. This is what can be sold first.
- **Stage 2: Workflows 2 and 3 (candidate data).** Blocked until:
  - (a) at least 2 agencies sign the paid pilot, **and**
  - (b) the founder picks the Class A processing location (§8), **and**
  - (c) a DPA is signed, **and**
  - (d) agency tenant isolation + enforcement tests are green.

## 7. Production issue found while writing this (FOUNDER, urgent and cheap)
`capabilityRegistry.ts` notes that Gemini image generation is "blocked by a zero-quota billing tier". That strongly suggests production JennySol runs on an **unpaid/free Gemini key**. On the free tier, Google may use prompts to improve its products. So **today's Jenny chats, including Arena context, may be eligible for training.**
- **Action:** enable billing on the Google AI Studio / Cloud project behind `GEMINI_API_KEY`, or create a paid project and swap the key in Railway yourself. Expected cost at current volume: small (well under ₹1,000/month).

## 8. Remaining decisions and questions
**FOUNDER decisions:**
1. **Class A location for Stage 2.** Options:
   - (i) **Vertex AI asia-south1 (Mumbai)** with a Google Cloud DPA, region pinning, CMEK optional, retention configured. Cheapest and fastest. Requires agency disclosure that Google is a subprocessor.
   - (ii) **A Vikisol private GPU server in India** (the planned RTX 5090 box, colocated or at the office with a static IP, firewall, backups and monitoring). Most private, about ₹4–6 lakh capex plus operations effort.
   - The architect recommends **(i) for the pilot, (ii) later** if agencies demand on-prem.
2. **Data residency.** DPDP doesn't mandate India-only storage today (cross-border transfer is allowed except to notified countries). JennySol currently stores data in **SQLite on a Railway volume, region not confirmed**. Decide whether agency data must be stored in India. If yes, the agency store moves to an India region (e.g. GCP/AWS Mumbai managed Postgres, about ₹2–4k/month).

**Legal/security questions (for the lawyer):**
- the DPA template (controller = agency, processor = Vikisol);
- the subprocessor list;
- breach notification period;
- deletion timelines including backups;
- candidate notice and opt-out wording;
- whether redacted JDs still count as client-confidential;
- the retention of audit records.

## 9. Enforcement and tests (deterministic, outside the model)
1. Route classification in code; `AgencyTenant.dataProcessingSetting` ∈ {`private_only`, `private_plus_controlled_cloud`}, **default `private_only`**.
2. **Kill switch** per agency (`cloudProcessingDisabled`) and a global one (`AGENCY_CLOUD_DISABLED=true`).
3. Tests:
   - (a) Class A never reaches any cloud adapter (spy on every adapter);
   - (b) provider failure never escalates tier;
   - (c) the kill switch blocks cloud;
   - (d) the redaction check fails closed;
   - (e) Sentry events from agency routes contain no PII (see §10);
   - (f) the audit record never contains prompt content.
4. **Never claim "on-prem"** unless every component in the request path runs in Vikisol's or the agency's controlled environment.

## 10. Sentry
**Arena:**
- add `arena.vikisol.in` plus the exact preview/local origins in use; no broad wildcard. (**FOUNDER**, 2 minutes.)

**Agency Desk:** a separate Sentry project, configured with:
- `sendDefaultPii=false`, enhanced privacy, server-side scrubbing, no IP storage;
- scrub rules for names, email, phone, CV, candidate, salary/compensation, notice, authorization, cookie, token, password, api_key, client and feedback;
- `beforeSend` strips headers, query strings, bodies, form values and attachments;
- no local variables, no Session Replay;
- org 2FA required, restricted access, shortest retention.

## 11. Pilot infrastructure cost (rough estimates, to confirm)
| Item | Stage 1 | Stage 2 (option i) |
|---|---|---|
| Paid Gemini (scorecards, 3–5 agencies) | ~₹200–800/month | — |
| Vertex AI asia-south1 (≈5,000 CVs processed) | — | ~₹1,000–4,000/month |
| India-region agency database (if residency is required) | — | ~₹2,000–4,000/month |
| Sentry | free–~₹2,500/month | same |
| Railway (existing) | existing | existing |
| **Total** | **< ₹3,500/month** | **~₹5,000–12,000/month** |

Pilot revenue at 3–5 × ₹12,000 per 45 days covers this.

## 12. Smallest implementation sequence (Claude Code, in this order)
1. **FOUNDER:** switch production Gemini to a paid project (§7).
2. Add the `CONTROLLED_CLOUD` tier; enforce per tenant, with agency tenants always enforced; add the kill switches. Tests 9(a)–(d).
3. An agency tenant model: agency, members, `dataProcessingSetting`, isolation tests (no cross-agency reads).
4. A deterministic JD redaction step (client name, emails, phones, URLs); fail closed.
5. Audit records per model call (no content). Test 9(f).
6. **The real scorecard** (review `d27386b`) on this path, evaluated on `docs/evals/agency-scorecard-eval-set.md`: cases 8 and 10 must refuse the protected attribute, with an escalation flag.
7. The Agency Sentry project + scrubbing, and test 9(e), when the Agency UI ships.
8. Stage 2 only after §6(a)–(d).
