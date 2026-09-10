// M3 (tool registry): the one place JennySol's core is allowed to ask "what tools can this
// identity use" or "run this tool call." See ADR-002 for why this exists as a registry rather
// than the chat loop knowing about individual products directly, and productConnector.ts for
// the interface a product implements to register with it.
import type { ProductIdentity } from "../productIdentity.js";
import { requireScope } from "../productIdentity.js";
import type { ProductConnector, RegisteredTool } from "./productConnector.js";

export class ToolRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

// Thrown by dispatch() when an identity from one product tries to invoke a tool namespaced
// under a *different* product — independent of whatever that identity's own `scope` claims
// contain, since a token should never legitimately carry another product's tool names, and a
// registry that trusted scope alone here would let a misconfigured or malicious token cross a
// boundary no amount of correct scoping was ever meant to allow.
export class CrossProductToolAccessError extends Error {
  constructor(callerProduct: string, toolName: string) {
    super(`Product "${callerProduct}" cannot access tool "${toolName}" — it belongs to a different product's namespace`);
    this.name = "CrossProductToolAccessError";
  }
}

// M4 (connector framework): what registeredConnectorStatus() reports per connector — the same
// shape capabilityRegistry.ts's own CapabilityStatus uses for `configured` (report state, not
// aspiration), reused here rather than reinvented. Deliberately not wired into
// getCapabilityRegistry() itself yet — that function is real, production-facing, and would
// otherwise have nothing but fake test connectors to report on until a real one (Arena, M5)
// exists to register.
export interface ConnectorStatus {
  product: string;
  configured: boolean;
  toolCount: number;
}

export class ToolRegistry {
  private readonly connectors = new Map<string, ProductConnector>();

  // Generic reporting mechanism any real registry instance can use, regardless of which
  // connectors happen to be registered — proven in toolRegistry.test.ts against fake
  // connectors, wired into a real admin view once a real connector (M5+) exists to report on.
  getConnectorStatus(): ConnectorStatus[] {
    return [...this.connectors.values()].map((c) => ({
      product: c.product,
      configured: c.configured(),
      toolCount: c.getTools().length,
    }));
  }

  registerConnector(connector: ProductConnector): void {
    if (this.connectors.has(connector.product)) {
      throw new ToolRegistryError(`A connector for product "${connector.product}" is already registered`);
    }
    for (const tool of connector.getTools()) {
      if (!tool.name.startsWith(`${connector.product}.`)) {
        throw new ToolRegistryError(
          `Tool "${tool.name}" from connector "${connector.product}" must be namespaced as "${connector.product}.<name>"`
        );
      }
    }
    this.connectors.set(connector.product, connector);
  }

  // Only ever consults the identity's *own* product's connector — a tool from any other
  // registered product is not filtered out by scope, it is never looked at in the first place.
  // This is the direct implementation of M3's acceptance criteria: "product A's tools are
  // invisible to product B's identity," proven in toolRegistry.test.ts against two independent
  // fake connectors.
  getToolsFor(identity: ProductIdentity): RegisteredTool[] {
    const connector = this.connectors.get(identity.product);
    if (!connector) return [];
    return connector.getTools().filter((t) => identity.scope.includes(t.name));
  }

  async dispatch(identity: ProductIdentity, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!toolName.startsWith(`${identity.product}.`)) {
      throw new CrossProductToolAccessError(identity.product, toolName);
    }
    requireScope(identity, toolName);

    const connector = this.connectors.get(identity.product);
    if (!connector) {
      throw new ToolRegistryError(`No connector registered for product "${identity.product}"`);
    }
    const tool = connector.getTools().find((t) => t.name === toolName);
    if (!tool) {
      throw new ToolRegistryError(`Tool "${toolName}" not found for product "${identity.product}"`);
    }
    return tool.execute(identity, args);
  }
}
