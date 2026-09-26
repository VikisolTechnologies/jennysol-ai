// Shadow mode is the default for non-agency traffic. A tier is logged, including which providers
// would have been refused, and the request still uses today's chain. PRIVACY_TIER_ENFORCE=true is
// what actually refuses the cloud for that traffic.
//
// ADR-007 §2/§9: agency tenants are NEVER in shadow mode — enforcement for an agency request is
// always on, regardless of this global flag. Callers signal that with `forceEnforce: true`
// (agency/tenant.ts is the only caller that ever sets it); nothing about non-agency call sites
// changes.

export type PrivacyTier = "LOCAL" | "PRIVATE" | "CONTROLLED_CLOUD" | "PUBLIC_CLOUD";

export function privacyEnforced(): boolean {
  return process.env.PRIVACY_TIER_ENFORCE === "true";
}

// LOCAL/PRIVATE both mean "this codebase's only private adapter" today (Ollama) — ADR-007
// distinguishes them conceptually (this machine vs. a future Vikisol-controlled server) but there
// is only one real adapter to route to until that server exists, so both resolve to it.
const PRIVATE_PROVIDERS = new Set(["ollama"]);

// ADR-007 §1/§5: CONTROLLED_CLOUD may reach ONLY the paid Gemini project — never Ollama (agency
// data isn't routed to this codebase's Ollama fallback, which isn't a validated processor for it),
// and never any other cloud adapter that might be configured. "gemini" here is deliberately the
// production provider name, not a config toggle — the *paid-vs-free* distinction is a Railway
// project setting (ADR-007 §7), not something this code can see or enforce.
const CONTROLLED_CLOUD_PROVIDERS = new Set(["gemini"]);

export function cloudProviders(names: string[]): string[] {
  return names.filter((name) => !PRIVATE_PROVIDERS.has(name));
}

function allowedFor(tier: PrivacyTier, names: string[]): string[] {
  if (tier === "CONTROLLED_CLOUD") return names.filter((name) => CONTROLLED_CLOUD_PROVIDERS.has(name));
  return names.filter((name) => PRIVATE_PROVIDERS.has(name));
}

export function applyPrivacyTier(
  tier: PrivacyTier | undefined,
  names: string[],
  opts: { forceEnforce?: boolean } = {}
): { names: string[]; rejected: string[] } {
  if (!tier || tier === "PUBLIC_CLOUD") return { names, rejected: [] };
  const allowed = new Set(allowedFor(tier, names));
  const rejected = names.filter((name) => !allowed.has(name));
  if (!opts.forceEnforce && !privacyEnforced()) return { names, rejected };
  return { names: names.filter((name) => allowed.has(name)), rejected };
}

export const PRIVATE_UNAVAILABLE =
  "This needs a private model and none is available. It was not sent to a cloud model.";

export const CONTROLLED_CLOUD_UNAVAILABLE =
  "This needs the controlled-cloud processor and it isn't available right now. It was not sent anywhere else.";

export function unavailableMessageFor(tier: PrivacyTier): string {
  return tier === "CONTROLLED_CLOUD" ? CONTROLLED_CLOUD_UNAVAILABLE : PRIVATE_UNAVAILABLE;
}
