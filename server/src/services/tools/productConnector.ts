// M3 (tool registry, PROJECT-PROGRESS.md milestone model): the interface a product implements
// to register its own tools with JennySol, per ADR-002 in docs/architecture/. JennySol's core —
// the model router, the AgentRun runtime, the chat loop — never imports a concrete connector or
// references a product by name; it only ever talks to `ToolRegistry` (toolRegistry.ts), which
// talks to whichever `ProductConnector`s have been registered. This file has no knowledge of
// Arena, or of any other product, on purpose.
import type { ProductIdentity } from "../productIdentity.js";

export interface RegisteredTool {
  // Must be namespaced as "<product>.<name>" (enforced by ToolRegistry.registerConnector) —
  // this is what makes cross-product tool-name collisions structurally impossible rather than
  // a convention someone has to remember.
  name: string;
  description: string;
  // Plain JSON Schema, same convention as llmProvider.ts's ToolDefinition — a connector's tools
  // are handed to the model through that same interface once M6 wires a real one in.
  parameters: Record<string, unknown>;
  // The actual side effect. Receives the verified ProductIdentity (never a raw token, never a
  // client-supplied user id) so the tool can enforce its own resource-level authorization on
  // top of ToolRegistry's product/scope check — see ADR-003: "Arena tools re-derive
  // authorization independently."
  execute: (identity: ProductIdentity, args: Record<string, unknown>) => Promise<unknown>;
}

export interface ProductConnector {
  // Must exactly match the `iss` claim a service token from this product carries (verified by
  // serviceToken.ts) — this is the join key ToolRegistry uses to find "this identity's own
  // product's tools" and nothing else.
  readonly product: string;
  getTools(): RegisteredTool[];
}
