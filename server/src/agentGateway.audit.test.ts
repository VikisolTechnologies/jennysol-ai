// M9 (audit/observability) — integration tests proving the real gateway (routes/agentGateway.ts)
// actually writes a real, queryable audit trail to the real database, for both the read-tool and
// the full write-tool propose->approve->execute chain this milestone's own acceptance criteria
// names. Same real-app supertest pattern as M6/M7/M8's own gateway test files.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("./services/modelRouter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/modelRouter.js")>();
  return { ...actual, routeChatCompletion: vi.fn() };
});

import { app } from "./app.js";
import { routeChatCompletion } from "./services/modelRouter.js";
import { signServiceToken } from "./services/serviceToken.js";
import { getAuditTrailForCorrelation, __deleteAuditEventsForCorrelationForTests } from "./services/agentAuditLog.js";

const ARENA_SECRET = "arena-test-secret-do-not-use-in-production";

function talentToken(externalUserId: string) {
  return signServiceToken({
    issuer: "arena",
    externalUserId,
    role: "TALENT",
    scope: ["arena.searchJobs", "arena.applyToJob"],
  });
}

describe("agentGateway — audit trail (M9, real HTTP + real audit_log table)", () => {
  const correlationIds: string[] = [];

  beforeEach(() => {
    vi.mocked(routeChatCompletion).mockReset();
    process.env.SERVICE_TOKEN_SECRET_ARENA = ARENA_SECRET;
  });

  afterEach(() => {
    for (const id of correlationIds) __deleteAuditEventsForCorrelationForTests(id);
    correlationIds.length = 0;
  });

  it("a real READ tool call is fully traceable: request received -> tool decided -> dispatched -> completed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { content: [] } }) })
    );
    vi.mocked(routeChatCompletion).mockImplementation(async (_sys, _hist, onDelta, _sources, _cap, _sig, _tools, onToolCall) => {
      const result = await onToolCall!({ id: "1", name: "arena.searchJobs", args: { page: 0, size: 5 } });
      onDelta(`Tool returned: ${JSON.stringify(result)}`);
      return { providerUsed: "gemini", fellBack: false };
    });

    const token = talentToken("arena-audit-user-1");
    const res = await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "find me jobs" })
      .expect(200);

    // The correlationId isn't in the HTTP response today (a deliberate M6 design choice keeping
    // the response shape minimal) — recovered here by querying for this identity's most recent
    // trail, which is what a real operator/support tool would also need to do.
    const identity = { product: "arena", externalUserId: "arena-audit-user-1", tenantId: undefined };
    // Query using a wildcard-free approach: the middleware assigns one correlationId per request,
    // so find it by re-deriving it is not possible from outside — instead assert via a direct db
    // read scoped to this identity across all its correlationIds.
    const { db } = await import("./db/index.js");
    const rows = db
      .prepare("SELECT DISTINCT correlation_id FROM agent_audit_log WHERE external_user_id = ?")
      .all("arena-audit-user-1") as { correlation_id: string }[];
    expect(rows).toHaveLength(1);
    const correlationId = rows[0].correlation_id;
    correlationIds.push(correlationId);

    const trail = getAuditTrailForCorrelation(correlationId, identity);
    expect(trail.map((e) => e.eventType)).toEqual([
      "agent_request_received",
      "tool_call_decided",
      "tool_dispatched",
      "agent_request_completed",
    ]);
    expect(trail[1].toolName).toBe("arena.searchJobs");
    expect(res.body.content).toContain("content");
  });

  it("a real WRITE tool's full propose->approve->execute chain is fully traceable in order", async () => {
    let capturedActionId = "";
    vi.mocked(routeChatCompletion).mockImplementationOnce(async (_sys, _hist, onDelta, _sources, _cap, _sig, _tools, onToolCall) => {
      const result = (await onToolCall!({ id: "1", name: "arena.applyToJob", args: { jobId: "job-1" } })) as {
        actionId: string;
      };
      capturedActionId = result.actionId;
      onDelta("ok");
      return { providerUsed: "gemini", fellBack: false };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { id: "app-1" } }) })
    );

    const token = talentToken("arena-audit-user-2");
    await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "apply me" })
      .expect(200);

    await request(app)
      .post(`/api/agent/gateway/actions/${capturedActionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ approve: true })
      .expect(200);

    const { db } = await import("./db/index.js");
    // Grouped and ordered by each correlationId's OWN first row — a correlationId is a random
    // UUID, so sorting by its string value would not reflect real request order.
    const rows = db
      .prepare(
        "SELECT correlation_id FROM agent_audit_log WHERE external_user_id = ? GROUP BY correlation_id ORDER BY MIN(rowid)"
      )
      .all("arena-audit-user-2") as { correlation_id: string }[];
    // Two real HTTP requests through requireProductIdentity -> two distinct correlationIds.
    expect(rows).toHaveLength(2);
    for (const r of rows) correlationIds.push(r.correlation_id);

    const identity = { product: "arena", externalUserId: "arena-audit-user-2", tenantId: undefined };
    const allEvents = rows.flatMap((r) => getAuditTrailForCorrelation(r.correlation_id, identity));
    const eventTypes = allEvents.map((e) => e.eventType);

    expect(eventTypes).toContain("pending_action_created");
    expect(eventTypes).toContain("pending_action_approved");
    expect(eventTypes).toContain("tool_dispatched");
    // The proposal must be recorded strictly before the approval, and the approval strictly
    // before execution — this is the exact chain M9's own acceptance criteria names.
    expect(eventTypes.indexOf("pending_action_created")).toBeLessThan(eventTypes.indexOf("pending_action_approved"));
    expect(eventTypes.indexOf("pending_action_approved")).toBeLessThan(eventTypes.indexOf("tool_dispatched"));

    // The round-trip token used for the real dispatch never appears anywhere in the stored trail.
    for (const e of allEvents) {
      expect(JSON.stringify(e.detail)).not.toContain(token);
    }
  });

  // A READ tool is dispatched immediately (unlike WRITE, which is only proposed) — so it's the
  // one that actually exercises requireScope() synchronously inside the /chat request, which is
  // what this test needs to produce a real scope_violation event. The mocked "model" here calls a
  // tool name directly the same way M8's own adversarial tests do — proving the server-side gate
  // doesn't depend on Gemini itself only ever offering tools the identity is scoped for.
  it("a scope violation is recorded as a distinct, real audit event, not silently swallowed", async () => {
    vi.mocked(routeChatCompletion).mockImplementationOnce(async (_sys, _hist, onDelta, _sources, _cap, _sig, _tools, onToolCall) => {
      await onToolCall!({ id: "1", name: "arena.searchJobs", args: {} });
      onDelta("unreachable");
      return { providerUsed: "gemini", fellBack: false };
    });
    vi.stubGlobal("fetch", vi.fn());

    const token = signServiceToken({
      issuer: "arena",
      externalUserId: "arena-audit-user-3",
      role: "TALENT",
      scope: ["arena.applyToJob"], // deliberately missing arena.searchJobs
    });

    await request(app)
      .post("/api/agent/gateway/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "find me jobs" })
      .expect(502);

    const { db } = await import("./db/index.js");
    const rows = db
      .prepare("SELECT DISTINCT correlation_id FROM agent_audit_log WHERE external_user_id = ?")
      .all("arena-audit-user-3") as { correlation_id: string }[];
    expect(rows).toHaveLength(1);
    correlationIds.push(rows[0].correlation_id);

    const identity = { product: "arena", externalUserId: "arena-audit-user-3", tenantId: undefined };
    const trail = getAuditTrailForCorrelation(rows[0].correlation_id, identity);
    expect(trail.map((e) => e.eventType)).toContain("scope_violation");
    // The failure that eventually surfaces to the HTTP caller is also recorded, not silently
    // dropped — a real operator reading this trail sees the root cause AND the outer failure.
    expect(trail.map((e) => e.eventType)).toContain("provider_failure");
  });
});
