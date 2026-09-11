// M3 (tool registry, PROJECT-PROGRESS.md milestone model): the interface a product implements
// to register its own tools with JennySol, per ADR-002 in docs/architecture/. JennySol's core —
// the model router, the AgentRun runtime, the chat loop — never imports a concrete connector or
// references a product by name; it only ever talks to `ToolRegistry` (toolRegistry.ts), which
// talks to whichever `ProductConnector`s have been registered. This file has no knowledge of
// Arena, or of any other product, on purpose.
import type { ProductIdentity } from "../productIdentity.js";

// M7 (approval-controlled write tools): per ADR-004, a READ tool executes immediately; a WRITE
// tool must never execute until the caller (the gateway route) has routed it through a real
// propose → user-approves → execute flow (see tools/pendingActions.ts). ToolRegistry.dispatch()
// itself has no opinion on tier — the gating happens one layer up, in whatever decides whether
// dispatch() is even called yet for a given tool call.
export type ToolTier = "READ" | "WRITE";

// What a tool's execute() gets beyond the identity/args, for a tool that needs to act as its own
// product's specific user rather than just reading public data. rawToken is the exact service
// token this identity was verified from (see middleware/productIdentity.ts) — a tool that needs
// to call back into its own product's authenticated API (e.g. Arena's POST /applications, which
// requires real Arena authentication — see AgentServiceTokenAuthenticationFilter on the Arena
// side) forwards this same token as its own Authorization header. A tool that only reads public
// data (like arena.searchJobs) simply never touches it.
export interface ToolExecutionContext {
  rawToken: string;
}

export interface RegisteredTool {
  // Must be namespaced as "<product>.<name>" (enforced by ToolRegistry.registerConnector) —
  // this is what makes cross-product tool-name collisions structurally impossible rather than
  // a convention someone has to remember.
  name: string;
  description: string;
  // Plain JSON Schema, same convention as llmProvider.ts's ToolDefinition — a connector's tools
  // are handed to the model through that same interface once M6 wires a real one in.
  parameters: Record<string, unknown>;
  tier: ToolTier;
  // The actual side effect. Receives the verified ProductIdentity (never a raw token beyond what
  // context explicitly carries, never a client-supplied user id) so the tool can enforce its own
  // resource-level authorization on top of ToolRegistry's product/scope check — see ADR-003:
  // "Arena tools re-derive authorization independently."
  execute: (identity: ProductIdentity, args: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>;
}

export interface ProductConnector {
  // Must exactly match the `iss` claim a service token from this product carries (verified by
  // serviceToken.ts) — this is the join key ToolRegistry uses to find "this identity's own
  // product's tools" and nothing else.
  readonly product: string;
  getTools(): RegisteredTool[];
  // M4: has what it needs to even be reachable right now (e.g. its
  // `SERVICE_TOKEN_SECRET_<PRODUCT>` is set) — mirrors the exact naming convention
  // `LlmProvider`/`SearchProvider` already use (`configured()`, not "healthy" — a connector
  // can be configured and still be failing; that finer distinction is what providerHealth.ts's
  // pattern is for, not duplicated here until a real connector's failure modes are known).
  configured(): boolean;
}
