// M9 (audit/observability) — unit tests against the real SQLite table (matching this project's
// own conversationStore.test.ts convention), not a mock. Covers real-event recording, secret
// redaction, and the identity-scoped read boundary this milestone's own rule requires.

import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { logAuditEvent, getAuditTrailForCorrelation, __deleteAuditEventsForCorrelationForTests } from "./agentAuditLog.js";

describe("agentAuditLog (M9)", () => {
  const correlationIds: string[] = [];
  afterEach(() => {
    for (const id of correlationIds) __deleteAuditEventsForCorrelationForTests(id);
    correlationIds.length = 0;
  });

  function newCorrelationId(): string {
    const id = randomUUID();
    correlationIds.push(id);
    return id;
  }

  it("records a real event and reads it back for the same identity", () => {
    const correlationId = newCorrelationId();
    const identity = { product: "arena", externalUserId: "u1", tenantId: undefined };

    logAuditEvent({ correlationId, type: "agent_request_received", identity, detail: { message: "hi" } });

    const trail = getAuditTrailForCorrelation(correlationId, identity);
    expect(trail).toHaveLength(1);
    expect(trail[0].eventType).toBe("agent_request_received");
    expect(trail[0].product).toBe("arena");
    expect(trail[0].externalUserId).toBe("u1");
    expect(trail[0].detail).toEqual({ message: "hi" });
  });

  it("preserves chronological order across a full propose->approve->execute chain", () => {
    const correlationId = newCorrelationId();
    const identity = { product: "arena", externalUserId: "u2", tenantId: undefined };

    logAuditEvent({ correlationId, type: "agent_request_received", identity });
    logAuditEvent({ correlationId, type: "tool_call_decided", identity, toolName: "arena.applyToJob" });
    logAuditEvent({ correlationId, type: "pending_action_created", identity, toolName: "arena.applyToJob" });
    logAuditEvent({ correlationId, type: "pending_action_approved", identity, toolName: "arena.applyToJob" });
    logAuditEvent({ correlationId, type: "tool_dispatched", identity, toolName: "arena.applyToJob" });

    const trail = getAuditTrailForCorrelation(correlationId, identity);
    expect(trail.map((e) => e.eventType)).toEqual([
      "agent_request_received",
      "tool_call_decided",
      "pending_action_created",
      "pending_action_approved",
      "tool_dispatched",
    ]);
  });

  // Acceptance: secrets/tokens must never enter persistent memory — the audit log is exactly the
  // kind of "detail" blob a careless call site could accidentally pass a raw token into.
  it("redacts a credential embedded in event detail before it is ever written to disk", () => {
    const correlationId = newCorrelationId();
    const identity = { product: "arena", externalUserId: "u3", tenantId: undefined };

    logAuditEvent({
      correlationId,
      type: "tool_dispatched",
      identity,
      toolName: "arena.applyToJob",
      detail: { rawToken: "must-not-survive", jobId: "job-1" },
    });

    const trail = getAuditTrailForCorrelation(correlationId, identity);
    expect(trail[0].detail).toEqual({ rawToken: "[redacted]", jobId: "job-1" });
  });

  // Acceptance: audit logging must itself respect user/tenant boundaries.
  it("a different external user cannot read another user's audit trail via the same correlationId", () => {
    const correlationId = newCorrelationId();
    const owner = { product: "arena", externalUserId: "owner", tenantId: undefined };
    const intruder = { product: "arena", externalUserId: "intruder", tenantId: undefined };

    logAuditEvent({ correlationId, type: "agent_request_received", identity: owner });

    expect(getAuditTrailForCorrelation(correlationId, intruder)).toEqual([]);
    expect(getAuditTrailForCorrelation(correlationId, owner)).toHaveLength(1);
  });

  it("a different tenant cannot read another tenant's audit trail, even with the same product+externalUserId", () => {
    const correlationId = newCorrelationId();
    const tenantA = { product: "arena", externalUserId: "shared-id", tenantId: "tenant-A" };
    const tenantB = { product: "arena", externalUserId: "shared-id", tenantId: "tenant-B" };

    logAuditEvent({ correlationId, type: "agent_request_received", identity: tenantA });

    expect(getAuditTrailForCorrelation(correlationId, tenantB)).toEqual([]);
    expect(getAuditTrailForCorrelation(correlationId, tenantA)).toHaveLength(1);
  });

  it("a different product cannot read another product's audit trail", () => {
    const correlationId = newCorrelationId();
    const arena = { product: "arena", externalUserId: "u1", tenantId: undefined };
    const otherProduct = { product: "hrlms", externalUserId: "u1", tenantId: undefined };

    logAuditEvent({ correlationId, type: "agent_request_received", identity: arena });

    expect(getAuditTrailForCorrelation(correlationId, otherProduct)).toEqual([]);
  });

  it("supports identity-less events (e.g. a token that fails before any identity can be resolved)", () => {
    const correlationId = newCorrelationId();
    logAuditEvent({ correlationId, type: "product_identity_invalid", detail: { reason: "Service token missing issuer" } });

    // Unreadable via the identity-scoped read path by design — there is no identity to scope it
    // to; this is intentional (see the module's own doc comment) and not a bug under test here.
    const asAnyone = getAuditTrailForCorrelation(correlationId, { product: "arena", externalUserId: "u1", tenantId: undefined });
    expect(asAnyone).toEqual([]);
  });
});
