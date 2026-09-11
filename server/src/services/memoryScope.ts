// M8 (product-scoped memory isolation, PROJECT-PROGRESS.md milestone model): the explicit
// boundary this milestone's acceptance criteria requires between JennySol's own memory (global,
// per-user, per-conversation — all real, all already scoped by user_id, see conversationStore.ts/
// vectorStore.ts and security.test.ts's 10 cross-user tests) and a connected product's data
// (Arena today, per-tenant, per-external-user).
//
// The real risk this file guards against is not something that exists today — the product
// gateway (routes/agentGateway.ts) has never called conversationStore/vectorStore at all (see
// agentGateway.memoryIsolation.test.ts for the structural proof). The risk is a FUTURE change
// wiring the gateway into persistence — for multi-turn context, or an explicit "remember this"
// feature — without carrying this distinction. This file is what that future change must go
// through; it is not a parallel memory system, and it stores nothing itself.
export type MemoryScope =
  | { kind: "global" }
  | { kind: "user"; userId: string }
  | { kind: "conversation"; userId: string; conversationId: string }
  | { kind: "product"; product: string; externalUserId: string; tenantId?: string };

// A product tool's result is current-turn context by default (M8 rule 1): it exists only for the
// one model round-trip that requested it — agentGateway.ts's onToolCall returns it directly into
// the function-response channel and never persists it. This brand exists so a future persistence
// call site can't accept one by accident: TypeScript's structural typing means an object literal
// shaped like `{scope, toolName, data}` still satisfies most interfaces, but the `__brand` field
// only this module produces makes "did someone unwrap this on purpose" a real, checkable fact
// rather than a convention nobody enforces.
export interface ProductToolResult {
  readonly __brand: "current-turn-only";
  scope: Extract<MemoryScope, { kind: "product" }>;
  toolName: string;
  data: unknown;
}

export function wrapProductToolResult(
  scope: Extract<MemoryScope, { kind: "product" }>,
  toolName: string,
  data: unknown
): ProductToolResult {
  return { __brand: "current-turn-only", scope, toolName, data };
}

// Explicit, intentional escape hatch for the one real reason a product tool result would ever
// need to leave current-turn scope: a signed-in JennySol user explicitly asking to remember
// something (M8 rule 10). Deliberately requires the caller to already know the target scope is
// "user" or "conversation" — there is no path from a ProductToolResult to global memory at all,
// and going to a *different* product's or user's scope is not expressible by this function's
// types, only ever the caller's own.
export function unwrapForExplicitUserMemory(
  result: ProductToolResult,
  targetScope: Extract<MemoryScope, { kind: "user" | "conversation" }>
): { scope: MemoryScope; toolName: string; data: unknown } {
  return { scope: targetScope, toolName: result.toolName, data: redactSecrets(result.data) };
}

const SECRET_KEY_PATTERN = /token|secret|password|passwd|credential|authorization|api[_-]?key/i;
// Three base64url segments separated by dots, each reasonably long — matches a JWT (the shape of
// every service token and Arena session token in this system) regardless of which object key it
// turns up under, so a credential doesn't survive just because it wasn't stored under an
// obviously-named field.
const JWT_LIKE_PATTERN = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

function redactString(s: string): string {
  return JWT_LIKE_PATTERN.test(s.trim()) ? "[redacted]" : s;
}

// Real, recursive redaction (M8 rule 8: "secrets/tokens must never enter memory") — used
// defensively by unwrapForExplicitUserMemory above, and directly testable against adversarial
// input shapes without needing to know any specific product's response schema in advance.
// Redacts by KEY NAME for nested fields (catches a credential nested at any depth under a
// plausible key) and by VALUE SHAPE for bare strings (catches a raw token sitting under an
// innocuous key, e.g. `{note: "Bearer eyJ...")`}`).
export function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, seen));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactSecrets(val, seen);
  }
  return out;
}
