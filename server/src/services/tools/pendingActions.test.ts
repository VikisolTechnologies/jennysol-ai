// M7 (approval-controlled write tools) — proves the propose/consume contract in isolation:
// single-use, identity-bound, and TTL-bound. No Arena code anywhere here.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { proposeAction, consumeAction, PendingActionError, __clearAllPendingActionsForTests } from "./pendingActions.js";
import type { ProductIdentity } from "../productIdentity.js";

function identity(overrides: Partial<ProductIdentity> = {}): ProductIdentity {
  return { product: "acme", externalUserId: "user-1", scope: [], ...overrides };
}

describe("pendingActions (M7)", () => {
  beforeEach(() => {
    __clearAllPendingActionsForTests();
    vi.useRealTimers();
  });

  it("proposes an action and consumes it exactly once for the same identity", () => {
    const proposer = identity();
    const action = proposeAction(proposer, "acme.doSomething", { widgetId: "w-1" });

    expect(action.toolName).toBe("acme.doSomething");
    expect(action.args).toEqual({ widgetId: "w-1" });

    const consumed = consumeAction(action.id, proposer);
    expect(consumed.id).toBe(action.id);
  });

  it("rejects consuming the same action a second time (single-use)", () => {
    const proposer = identity();
    const action = proposeAction(proposer, "acme.doSomething", {});

    consumeAction(action.id, proposer);

    expect(() => consumeAction(action.id, proposer)).toThrow(PendingActionError);
  });

  it("rejects consuming an action that never existed", () => {
    expect(() => consumeAction("not-a-real-id", identity())).toThrow(/No such pending action/);
  });

  it("rejects consuming an action proposed by a DIFFERENT identity — even same product, different user", () => {
    const proposer = identity({ externalUserId: "user-1" });
    const intruder = identity({ externalUserId: "user-2" });
    const action = proposeAction(proposer, "acme.doSomething", {});

    expect(() => consumeAction(action.id, intruder)).toThrow(/does not belong to the requesting identity/);
  });

  it("rejects consuming an action proposed by the same external user id but a DIFFERENT product", () => {
    const proposer = identity({ product: "acme", externalUserId: "user-1" });
    const crossProduct = identity({ product: "widgetco", externalUserId: "user-1" });
    const action = proposeAction(proposer, "acme.doSomething", {});

    expect(() => consumeAction(action.id, crossProduct)).toThrow(/does not belong to the requesting identity/);
  });

  it("rejects consuming an action after it has expired", () => {
    vi.useFakeTimers();
    const proposer = identity();
    const action = proposeAction(proposer, "acme.doSomething", {});

    vi.advanceTimersByTime(6 * 60 * 1000); // past the 5-minute TTL

    expect(() => consumeAction(action.id, proposer)).toThrow(/expired/);
    vi.useRealTimers();
  });

  it("each proposal gets a unique id, even for the same identity/tool/args", () => {
    const proposer = identity();
    const a = proposeAction(proposer, "acme.doSomething", {});
    const b = proposeAction(proposer, "acme.doSomething", {});

    expect(a.id).not.toBe(b.id);
  });
});
