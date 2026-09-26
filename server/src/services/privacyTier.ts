// Shadow mode is the default. A tier is logged, including which providers
// would have been refused, and the request still uses today's chain.
// PRIVACY_TIER_ENFORCE=true is what actually refuses the cloud.

export type PrivacyTier = "LOCAL" | "PRIVATE" | "PUBLIC_CLOUD";

export function privacyEnforced(): boolean {
  return process.env.PRIVACY_TIER_ENFORCE === "true";
}

export function cloudProviders(names: string[]): string[] {
  return names.filter((name) => name !== "ollama");
}

export function applyPrivacyTier(tier: PrivacyTier | undefined, names: string[]): { names: string[]; rejected: string[] } {
  if (!tier || tier === "PUBLIC_CLOUD") return { names, rejected: [] };
  const rejected = cloudProviders(names);
  if (!privacyEnforced()) return { names, rejected };
  return { names: names.filter((name) => name === "ollama"), rejected };
}

export const PRIVATE_UNAVAILABLE =
  "This needs a private model and none is available. It was not sent to a cloud model.";
