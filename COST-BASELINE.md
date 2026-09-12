# COST-BASELINE.md

Written 2026-09-12, as part of Phase 1 of `JENNYSOL-LOCAL-CUTOVER.md`. The mission brief is
explicit that "the entire business case for going local rests on this number and nobody has
stated it" — this document exists to make that gap visible, not to guess at filling it.

## What's needed

Total Gemini API spend over the last 30 days, broken down by model (`gemini-3.5-flash-lite` is
the only one this app uses) and, if the billing export allows it, by whatever request
categorization Google's console offers (input vs. output tokens at minimum).

## Why this session can't produce it

This session has no credentials for Google Cloud Console or AI Studio billing — `GEMINI_API_KEY`'s
own value was never read for this purpose, and even if it had been, an API key doesn't grant
billing-dashboard access anyway (that's a separate Google Cloud IAM permission). Real historical
spend must come from Google's own billing records, not be reconstructed from token-count estimates
in application logs — this app's own `chat_timing` logs (extended this session — see
`JENNY_MODEL_FLEET.md` / the request-metrics work) only retain a rolling window in memory and
aren't a substitute for the actual invoice.

## Where to get the real number (founder/Syam action)

1. **Google AI Studio** ([aistudio.google.com](https://aistudio.google.com)) → the API key's
   associated Google Cloud project → **Billing** in Cloud Console
   ([console.cloud.google.com/billing](https://console.cloud.google.com/billing)) for that project.
2. Filter to the Generative Language API / Gemini API line item, last 30 days.
3. If a breakdown by input/output tokens or by request is available in the billing export, capture
   that too — it materially changes what "going local" actually saves (a workload dominated by long
   context windows saves differently than one dominated by many small requests).

## Once the real number exists

Replace this document's "What's needed" section with the actual figure and date pulled, and note
whether it came from the Cloud Console billing UI directly or a CSV/BigQuery export. Compare it
against `LLM_HEDGE_ENABLED`/hardware costs already sunk into the Mac (see
`JENNY_MAC_PRODUCTION_REQUIREMENTS.md`) to make the local-cutover business case concrete rather than
assumed.

## What this session added instead (real, in-app, but not a substitute for real billing data)

`GET /api/admin/request-metrics` (admin-authenticated) now reports rolling request counts,
fallback rate, and error rate per provider, plus real (or clearly-labeled-estimated) token counts
per request in the `chat_timing` log line — see `JENNY_MODEL_FLEET.md` for what's real vs.
estimated per provider. This is useful for *going-forward* cost tracking once real traffic starts
flowing through it, but it cannot answer "what have we already spent" for a window that predates
this instrumentation existing.
