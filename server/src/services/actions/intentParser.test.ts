import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocking the shared llm.ts boundary (same convention as
// chatRunner.identity.test.ts) — this proves parseActionIntent's own real
// logic (prompt construction, JSON extraction, slot/target validation)
// without depending on a real provider actually being configured/reachable.
vi.mock("../llm.js", () => ({ streamChatCompletion: vi.fn() }));

import { streamChatCompletion } from "../llm.js";
import { parseActionIntent } from "./intentParser.js";

function mockLlmReply(json: unknown) {
  vi.mocked(streamChatCompletion).mockImplementation(async (_sp, _hist, onDelta) => {
    onDelta(JSON.stringify(json));
    return { providerUsed: "gemini", fellBack: false } as never;
  });
}

beforeEach(() => {
  vi.mocked(streamChatCompletion).mockReset();
});

describe("parseActionIntent", () => {
  it("returns a real target with all required slots filled", async () => {
    mockLlmReply({ targetId: "phone_call", slots: { number: "9876543210" } });
    const result = await parseActionIntent("call 9876543210");
    expect(result).toEqual({ targetId: "phone_call", slots: { number: "9876543210" }, missingRequiredSlots: [] });
  });

  it("reports the missing required slot by real name", async () => {
    mockLlmReply({ targetId: "phone_call", slots: {} });
    const result = await parseActionIntent("call my mom");
    expect(result?.missingRequiredSlots).toEqual(["number"]);
  });

  // Real bug found live: for "call my mom" (no real number stated), the
  // real LLM returned a non-empty placeholder ("mom") instead of correctly
  // omitting the slot, despite this prompt's own explicit instruction not
  // to invent one -- a plain non-empty check let it through, and it
  // silently stripped to an empty tel: link. Never trust the model's
  // instruction-following alone for something that produces a real link.
  it("treats a non-numeric placeholder value as missing, not known (phone_call's real validator)", async () => {
    mockLlmReply({ targetId: "phone_call", slots: { number: "mom" } });
    const result = await parseActionIntent("call my mom");
    expect(result?.missingRequiredSlots).toEqual(["number"]);
    // The invalid placeholder isn't carried forward into slots either --
    // it must not survive into the next turn's clarify state as if real.
    expect(result?.slots.number).toBeUndefined();
  });

  // Same defense-in-depth class as the phone-number bug above, applied to
  // the one other slot with a real structural shape: an email address.
  it("treats a non-email placeholder value as missing, not known (email's real validator)", async () => {
    mockLlmReply({ targetId: "email", slots: { to: "my boss" } });
    const result = await parseActionIntent("email my boss");
    expect(result?.missingRequiredSlots).toEqual(["to"]);
    expect(result?.slots.to).toBeUndefined();
  });

  it("accepts a real email address for email's `to` slot", async () => {
    mockLlmReply({ targetId: "email", slots: { to: "priya@example.com" } });
    const result = await parseActionIntent("email priya@example.com");
    expect(result?.missingRequiredSlots).toEqual([]);
    expect(result?.slots.to).toBe("priya@example.com");
  });

  it("returns null when the model says nothing matches", async () => {
    mockLlmReply({ targetId: null, slots: {} });
    const result = await parseActionIntent("what's the weather like");
    expect(result).toBeNull();
  });

  it("returns null (never throws) when the model's targetId isn't a real registry id", async () => {
    mockLlmReply({ targetId: "not_a_real_target", slots: {} });
    const result = await parseActionIntent("call someone");
    expect(result).toBeNull();
  });

  it("returns null (never throws) when the model's output isn't valid JSON", async () => {
    vi.mocked(streamChatCompletion).mockImplementation(async (_sp, _hist, onDelta) => {
      onDelta("I'm not sure what you mean by that.");
      return { providerUsed: "gemini", fellBack: false } as never;
    });
    const result = await parseActionIntent("garbled input");
    expect(result).toBeNull();
  });

  it("returns null (never throws) when every configured provider fails", async () => {
    vi.mocked(streamChatCompletion).mockRejectedValue(new Error("all providers down"));
    const result = await parseActionIntent("call someone");
    expect(result).toBeNull();
  });

  it("passes prior target/slots into the prompt so a clarify answer can be merged", async () => {
    mockLlmReply({ targetId: "phone_call", slots: { number: "9876543210" } });
    await parseActionIntent("9876543210", "phone_call", {});
    const systemPrompt = vi.mocked(streamChatCompletion).mock.calls[0][0];
    expect(systemPrompt).toContain("phone_call");
  });
});
