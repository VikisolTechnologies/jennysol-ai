// M3 (tool registry) — proven against two independent fake products ("acme" and "widgetco"),
// per the milestone's explicit acceptance criteria: "a second, fake product can register a tool
// and have it appear correctly scoped in a chat session's available tools, with a real test
// proving product A's tools are invisible to product B's identity." No Arena code anywhere here.

import { describe, it, expect } from "vitest";
import { ToolRegistry, ToolRegistryError, CrossProductToolAccessError } from "./toolRegistry.js";
import { InsufficientScopeError } from "../productIdentity.js";
import type { ProductConnector } from "./productConnector.js";
import type { ProductIdentity } from "../productIdentity.js";

function acmeConnector(opts?: { configured?: boolean }): ProductConnector {
  return {
    product: "acme",
    getTools: () => [
      {
        name: "acme.getWidget",
        description: "Fake test tool — returns a fake widget.",
        parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        execute: async (_identity, args) => ({ widgetId: args.id, name: "Test Widget" }),
      },
    ],
    configured: () => opts?.configured ?? true,
  };
}

function widgetcoConnector(opts?: { configured?: boolean }): ProductConnector {
  return {
    product: "widgetco",
    getTools: () => [
      {
        name: "widgetco.getGadget",
        description: "Fake test tool — returns a fake gadget, from a completely different fake product.",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => ({ gadget: "Test Gadget" }),
      },
    ],
    configured: () => opts?.configured ?? true,
  };
}

function identity(overrides: Partial<ProductIdentity>): ProductIdentity {
  return { product: "acme", externalUserId: "user-1", scope: [], ...overrides };
}

describe("ToolRegistry (M3)", () => {
  it("registers two independent fake product connectors without conflict", () => {
    const registry = new ToolRegistry();
    expect(() => registry.registerConnector(acmeConnector())).not.toThrow();
    expect(() => registry.registerConnector(widgetcoConnector())).not.toThrow();
  });

  it("rejects registering the same product twice", () => {
    const registry = new ToolRegistry();
    registry.registerConnector(acmeConnector());
    expect(() => registry.registerConnector(acmeConnector())).toThrow(ToolRegistryError);
  });

  it("rejects a connector whose tool isn't namespaced under its own product", () => {
    const registry = new ToolRegistry();
    const badConnector: ProductConnector = {
      product: "acme",
      getTools: () => [
        { name: "notNamespaced", description: "bad", parameters: {}, execute: async () => null },
      ],
      configured: () => true,
    };
    expect(() => registry.registerConnector(badConnector)).toThrow(/must be namespaced/);
  });

  it("getToolsFor: product A's tools are correctly visible to product A's own identity", () => {
    const registry = new ToolRegistry();
    registry.registerConnector(acmeConnector());
    registry.registerConnector(widgetcoConnector());

    const acmeIdentity = identity({ product: "acme", scope: ["acme.getWidget"] });
    const tools = registry.getToolsFor(acmeIdentity);

    expect(tools.map((t) => t.name)).toEqual(["acme.getWidget"]);
  });

  it("getToolsFor: product A's tools are INVISIBLE to product B's identity — the M3 acceptance test", () => {
    const registry = new ToolRegistry();
    registry.registerConnector(acmeConnector());
    registry.registerConnector(widgetcoConnector());

    const widgetcoIdentity = identity({ product: "widgetco", externalUserId: "wco-user-1", scope: ["widgetco.getGadget"] });
    const tools = registry.getToolsFor(widgetcoIdentity);

    expect(tools.map((t) => t.name)).toEqual(["widgetco.getGadget"]);
    expect(tools.map((t) => t.name)).not.toContain("acme.getWidget");
  });

  it("getToolsFor: cross-product tools stay invisible even if a (misconfigured) token's scope names them", () => {
    // Defense in depth: the registry filters by the identity's OWN product first, so a
    // widgetco identity whose scope somehow (a bug, a forged/misissued token) contains an
    // acme tool name still never sees it — visibility isn't decided by scope content alone.
    const registry = new ToolRegistry();
    registry.registerConnector(acmeConnector());
    registry.registerConnector(widgetcoConnector());

    const overScopedWidgetco = identity({
      product: "widgetco",
      externalUserId: "wco-user-1",
      scope: ["widgetco.getGadget", "acme.getWidget"],
    });

    expect(registry.getToolsFor(overScopedWidgetco).map((t) => t.name)).toEqual(["widgetco.getGadget"]);
  });

  it("getToolsFor: an identity from an unregistered product sees no tools", () => {
    const registry = new ToolRegistry();
    registry.registerConnector(acmeConnector());
    expect(registry.getToolsFor(identity({ product: "totally-unknown", scope: ["anything"] }))).toEqual([]);
  });

  it("dispatch: executes a real tool for an authorized identity of the matching product", async () => {
    const registry = new ToolRegistry();
    registry.registerConnector(acmeConnector());

    const result = await registry.dispatch(
      identity({ product: "acme", scope: ["acme.getWidget"] }),
      "acme.getWidget",
      { id: "w-1" }
    );

    expect(result).toEqual({ widgetId: "w-1", name: "Test Widget" });
  });

  it("dispatch: rejects an out-of-scope tool call for the identity's own product", async () => {
    const registry = new ToolRegistry();
    registry.registerConnector(acmeConnector());

    await expect(
      registry.dispatch(identity({ product: "acme", scope: [] }), "acme.getWidget", { id: "w-1" })
    ).rejects.toThrow(InsufficientScopeError);
  });

  it("dispatch: NEVER invokes another product's tool, even if the identity's scope names it (cross-product dispatch attempt)", async () => {
    const registry = new ToolRegistry();
    let acmeToolWasCalled = false;
    registry.registerConnector({
      product: "acme",
      getTools: () => [
        {
          name: "acme.getWidget",
          description: "test",
          parameters: {},
          execute: async () => {
            acmeToolWasCalled = true;
            return { should: "never happen" };
          },
        },
      ],
      configured: () => true,
    });
    registry.registerConnector(widgetcoConnector());

    // A widgetco identity somehow carrying "acme.getWidget" in its scope (misissued token) —
    // dispatch must refuse before ever reaching acme's connector, not just fail authorization
    // after already having found and prepared to run the tool.
    const misconfigured = identity({ product: "widgetco", externalUserId: "wco-1", scope: ["acme.getWidget"] });

    await expect(registry.dispatch(misconfigured, "acme.getWidget", {})).rejects.toThrow(
      CrossProductToolAccessError
    );
    expect(acmeToolWasCalled).toBe(false);
  });

  it("dispatch: unknown tool name for a real, correctly-scoped product is a clear registry error, not a silent no-op", async () => {
    const registry = new ToolRegistry();
    registry.registerConnector(acmeConnector());

    await expect(
      registry.dispatch(identity({ product: "acme", scope: ["acme.doesNotExist"] }), "acme.doesNotExist", {})
    ).rejects.toThrow(/not found/);
  });

  // M4 (connector framework) — reusable by more than one product without code changes to the
  // core, proven by registering two independently-configured fake connectors and reading their
  // status back generically.
  describe("getConnectorStatus (M4)", () => {
    it("reports each registered connector's product, configured state, and tool count independently", () => {
      const registry = new ToolRegistry();
      registry.registerConnector(acmeConnector({ configured: true }));
      registry.registerConnector(widgetcoConnector({ configured: false }));

      const status = registry.getConnectorStatus();

      expect(status).toEqual(
        expect.arrayContaining([
          { product: "acme", configured: true, toolCount: 1 },
          { product: "widgetco", configured: false, toolCount: 1 },
        ])
      );
      expect(status).toHaveLength(2);
    });

    it("returns an empty list when no connectors are registered", () => {
      expect(new ToolRegistry().getConnectorStatus()).toEqual([]);
    });

    it("reflects a connector's current configured() state each time it's called, not a cached value from registration", () => {
      const registry = new ToolRegistry();
      let isConfigured = false;
      registry.registerConnector({
        product: "acme",
        getTools: () => [],
        configured: () => isConfigured,
      });

      expect(registry.getConnectorStatus()[0].configured).toBe(false);
      isConfigured = true;
      expect(registry.getConnectorStatus()[0].configured).toBe(true);
    });
  });
});
