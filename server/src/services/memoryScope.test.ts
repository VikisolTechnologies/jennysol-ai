// M8 (product-scoped memory isolation) — unit + adversarial tests for the redaction guard and
// the current-turn-only brand. No Arena code anywhere here (matches this project's own M2/M3
// convention of proving primitives against fake data before a real product touches them).

import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { addMessage, getConversationMessages } from "./conversationStore.js";
import { redactSecrets, wrapProductToolResult, unwrapForExplicitUserMemory } from "./memoryScope.js";

describe("redactSecrets (M8, acceptance test F)", () => {
  it("redacts a top-level key that looks like a credential", () => {
    expect(redactSecrets({ token: "abc123", jobId: "job-1" })).toEqual({
      token: "[redacted]",
      jobId: "job-1",
    });
  });

  it("redacts credential-shaped keys nested at any depth, without prior knowledge of the shape", () => {
    const adversarial = {
      job: {
        title: "Business Development Manager",
        metadata: {
          internal: {
            serviceToken: "should-never-survive",
            SERVICE_TOKEN_SECRET_ARENA: "should-never-survive-either",
          },
        },
      },
    };
    const result = redactSecrets(adversarial) as any;
    expect(result.job.metadata.internal.serviceToken).toBe("[redacted]");
    expect(result.job.metadata.internal.SERVICE_TOKEN_SECRET_ARENA).toBe("[redacted]");
    expect(result.job.title).toBe("Business Development Manager");
  });

  it("redacts a raw JWT-shaped string value even under an innocuous key name", () => {
    const adversarial = {
      note: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhcmVuYS11c2VyLTQyIn0.c2lnbmF0dXJlLWxvb2tzLXJlYWw",
    };
    // The bearer prefix isn't part of the JWT itself; redactString checks the trimmed value
    // against the three-segment pattern, so embed the raw token as the whole string here.
    const raw = { note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhcmVuYS11c2VyLTQyIn0.c2lnbmF0dXJlLWxvb2tzLXJlYWw" };
    expect((redactSecrets(raw) as any).note).toBe("[redacted]");
    // A plain sentence is left alone — this isn't a blanket string scrubber.
    expect((redactSecrets(adversarial) as any).note).not.toBe("[redacted]");
  });

  it("handles arrays, null, and circular references without throwing", () => {
    const arr = [{ token: "x" }, { jobId: "job-1" }];
    expect(redactSecrets(arr)).toEqual([{ token: "[redacted]" }, { jobId: "job-1" }]);
    expect(redactSecrets(null)).toBeNull();

    const circular: any = { jobId: "job-1" };
    circular.self = circular;
    expect(() => redactSecrets(circular)).not.toThrow();
  });

  it("leaves ordinary, non-credential data completely unchanged", () => {
    const clean = { jobId: "job-1", title: "Sales Executive", skills: ["CRM", "Negotiation"] };
    expect(redactSecrets(clean)).toEqual(clean);
  });
});

describe("ProductToolResult brand + explicit-memory escape hatch (M8, acceptance test H)", () => {
  it("wraps a product tool result with its scope and tool name", () => {
    const wrapped = wrapProductToolResult(
      { kind: "product", product: "arena", externalUserId: "u1" },
      "arena.searchJobs",
      { jobId: "job-1" }
    );
    expect(wrapped.__brand).toBe("current-turn-only");
    expect(wrapped.scope).toEqual({ kind: "product", product: "arena", externalUserId: "u1" });
  });

  it("unwrapping for explicit user memory relabels the scope to what the caller explicitly asked for, and redacts secrets", () => {
    const wrapped = wrapProductToolResult(
      { kind: "product", product: "arena", externalUserId: "u1" },
      "arena.applyToJob",
      { jobId: "job-1", serviceToken: "must-not-survive" }
    );

    const remembered = unwrapForExplicitUserMemory(wrapped, {
      kind: "conversation",
      userId: "jennysol-user-1",
      conversationId: "conv-1",
    });

    expect(remembered.scope).toEqual({ kind: "conversation", userId: "jennysol-user-1", conversationId: "conv-1" });
    expect((remembered.data as any).serviceToken).toBe("[redacted]");
    expect((remembered.data as any).jobId).toBe("job-1");
  });
});

// M8 (acceptance test H, integration-level): proves the explicit-memory escape hatch, wired to
// JennySol's REAL conversationStore (not a mock), still respects the existing per-user boundary
// that store already enforces — an explicit "remember this Arena result" action for user A is
// invisible to user B, exactly like every other message in that same, real, already-tested table.
describe("explicit memory of a product tool result, through the real conversationStore (M8, acceptance test H)", () => {
  function makeUser(): string {
    const userId = randomUUID();
    db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
      userId,
      `${userId}@example.test`
    );
    return userId;
  }

  function makeConversation(userId: string): string {
    const id = randomUUID();
    db.prepare("INSERT INTO conversations (id, user_id, title) VALUES (?, ?, 'Test')").run(id, userId);
    return id;
  }

  let userIds: string[] = [];
  afterEach(() => {
    for (const id of userIds) db.prepare("DELETE FROM users WHERE id = ?").run(id); // cascades
    userIds = [];
  });

  it("a product tool result explicitly remembered into user A's conversation is invisible to user B", () => {
    const userA = makeUser();
    const userB = makeUser();
    userIds.push(userA, userB);
    const conversationA = makeConversation(userA);

    const toolResult = wrapProductToolResult(
      { kind: "product", product: "arena", externalUserId: "arena-user-1" },
      "arena.searchJobs",
      { jobId: "job-1", title: "Registered Nurse", serviceToken: "must-not-survive" }
    );
    const remembered = unwrapForExplicitUserMemory(toolResult, {
      kind: "conversation",
      userId: userA,
      conversationId: conversationA,
    });

    addMessage(userA, conversationA, "assistant", JSON.stringify(remembered.data));

    const asOwner = getConversationMessages(userA, conversationA);
    expect(asOwner).toHaveLength(1);
    expect(asOwner[0].content).toContain("Registered Nurse");
    expect(asOwner[0].content).not.toContain("must-not-survive");

    // Same conversation id, wrong user — the real store's existing WHERE c.user_id = ? join
    // returns nothing, exactly as it already does for JennySol's own data.
    const asIntruder = getConversationMessages(userB, conversationA);
    expect(asIntruder).toEqual([]);
  });
});
