// M2 (product identity/security, PROJECT-PROGRESS.md milestone model): what a verified service
// token (serviceToken.ts) resolves to. This is deliberately NOT a JennySol `User` — a
// ProductIdentity represents "a user of a different Vikisol product, acting through JennySol,"
// which has no JennySol account, no JennySol session, and no password of any kind. See ADR-003
// in docs/architecture/ for why this exists as its own concept rather than reusing JennySol's
// own auth model.
export interface ProductIdentity {
  // Which product vouched for this identity — "arena" once M5 exists, a fake test product
  // ("acme" in this module's own tests) until then. Never "jennysol" itself.
  product: string;
  // The external user's id *in that product* — never a JennySol user id, and JennySol makes no
  // attempt to map it to one. Arena's own userId stays Arena's problem to interpret.
  externalUserId: string;
  role?: string;
  tenantId?: string;
  // Explicit allow-list of tool names this identity is permitted to call — see ADR-003's
  // "scope, not just identity, limits blast radius." An empty array means read-only/no-tool
  // access, not "trust everything."
  scope: string[];
}

export class InsufficientScopeError extends Error {
  constructor(product: string, toolName: string) {
    super(`Product "${product}" identity is not scoped for tool "${toolName}"`);
    this.name = "InsufficientScopeError";
  }
}

export function hasScope(identity: ProductIdentity, toolName: string): boolean {
  return identity.scope.includes(toolName);
}

// Every tool dispatcher (once one exists — M3+) must call this before executing, not just
// before *showing* the tool as available — server-side enforcement, never a client-side-only
// check. See ADR-003: "A token whose scope doesn't include the tool being called is rejected
// server-side, not merely hidden in the UI."
export function requireScope(identity: ProductIdentity, toolName: string): void {
  if (!hasScope(identity, toolName)) {
    throw new InsufficientScopeError(identity.product, toolName);
  }
}
