// Shared across every provider so the router treats a Gemini 503 and a
// DeepSeek 503 the same way, instead of each provider inventing its own
// notion of "is this worth retrying."
export type ErrorKind =
  | "503"
  | "429"
  | "quota"
  | "auth"
  | "invalid_request"
  | "timeout"
  | "at_capacity"
  | "cancelled"
  | "other";

export function classifyError(err: unknown): ErrorKind {
  const status = (err as { status?: number })?.status;
  const code = (err as { code?: string })?.code;
  const message = err instanceof Error ? err.message : String(err);

  // A user explicitly cancelled the run — says nothing about the provider
  // at all, and (unlike every other kind here) the router must not treat it
  // as "try the next provider": see modelRouter.ts's routeChatCompletion,
  // which rethrows immediately on this kind instead of falling back.
  if (code === "cancelled") return "cancelled";
  // Self-imposed (see ollama.ts's concurrency gate) — a local run count
  // limit says nothing about whether the provider itself is actually
  // healthy, same reasoning as a self-imposed first-token timeout with no
  // fallback left (see modelRouter.ts's hasFallbackLeft).
  if (code === "at_capacity") return "at_capacity";
  if (status === 401 || status === 403) return "auth";
  if (status === 400) return "invalid_request";
  if (status === 503) return "503";
  if (status === 429) {
    // Gemini's own quota-exhaustion errors are technically 429s but carry
    // RESOURCE_EXHAUSTED / "quota" in the body — those won't clear in
    // seconds the way a short rate-limit window does, so treat them as a
    // distinct, longer-lived kind of failure.
    return /RESOURCE_EXHAUSTED|quota/i.test(message) ? "quota" : "429";
  }
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|timeout|network|fetch failed/i.test(message)) return "timeout";
  return "other";
}

// Worth a fast, same-provider retry right now — the failure looks like a
// momentary blip rather than the provider actually being down or misused.
export function isRetryableNow(kind: ErrorKind): boolean {
  return kind === "503" || kind === "timeout";
}

// Whether this failure says anything real about the provider's own
// availability. A malformed request (ours, not theirs) shouldn't count
// against a provider's health or trip its circuit breaker.
export function affectsProviderHealth(kind: ErrorKind): boolean {
  return kind !== "invalid_request" && kind !== "at_capacity" && kind !== "cancelled";
}
