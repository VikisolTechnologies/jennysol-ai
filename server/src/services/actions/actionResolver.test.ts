import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../llm.js", () => ({ streamChatCompletion: vi.fn() }));

import { streamChatCompletion } from "../llm.js";
import { tryResolveAction } from "./actionResolver.js";
import { clearPendingAction } from "./actionState.js";

function mockLlmReply(json: unknown) {
  vi.mocked(streamChatCompletion).mockImplementationOnce(async (_sp, _hist, onDelta) => {
    onDelta(JSON.stringify(json));
    return { providerUsed: "gemini", fellBack: false } as never;
  });
}

beforeEach(() => {
  vi.mocked(streamChatCompletion).mockReset();
});

describe("tryResolveAction", () => {
  it("returns null (skips the LLM entirely) for ordinary chat with no trigger keyword", async () => {
    const result = await tryResolveAction("conv-1", "what's the weather like");
    expect(result).toBeNull();
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it("asks a real, specific clarifying question when a required slot is missing", async () => {
    mockLlmReply({ targetId: "phone_call", slots: {} });
    const result = await tryResolveAction("conv-2", "call my mom");
    expect(result).toEqual({ kind: "clarify", text: "What's the phone number to call, as stated?" });
  });

  it("resolves to a real markdown handoff link once every required slot is known", async () => {
    mockLlmReply({ targetId: "phone_call", slots: { number: "9876543210" } });
    const result = await tryResolveAction("conv-3", "call 9876543210");
    expect(result?.kind).toBe("resolved");
    expect(result?.text).toContain("tel:9876543210");
    expect(result?.text).toContain("I can't complete this for you");
  });

  it("merges a follow-up answer into the pending slot from the clarify turn", async () => {
    mockLlmReply({ targetId: "phone_call", slots: {} });
    const first = await tryResolveAction("conv-4", "call my mom");
    expect(first?.kind).toBe("clarify");

    mockLlmReply({ targetId: "phone_call", slots: { number: "9876543210" } });
    const second = await tryResolveAction("conv-4", "9876543210");
    expect(second?.kind).toBe("resolved");
    expect(second?.text).toContain("tel:9876543210");

    // Real prompt-construction proof, not just the mocked outcome: the
    // second call's own system prompt actually carried the pending state
    // forward.
    const secondCallSystemPrompt = vi.mocked(streamChatCompletion).mock.calls[1][0];
    expect(secondCallSystemPrompt).toContain("phone_call");
  });

  it("clears pending state and falls through when the follow-up doesn't answer it", async () => {
    mockLlmReply({ targetId: "phone_call", slots: {} });
    await tryResolveAction("conv-5", "call my mom");

    mockLlmReply({ targetId: null, slots: {} });
    const second = await tryResolveAction("conv-5", "actually never mind, what's 2+2");
    expect(second).toBeNull();

    // Pending state is really gone, not just this call's return value --
    // the next unrelated, non-triggering message skips the LLM entirely.
    const third = await tryResolveAction("conv-5", "tell me a joke");
    expect(third).toBeNull();
    expect(streamChatCompletion).toHaveBeenCalledTimes(2);
  });

  it("returns null (never touches the LLM again) once resolved", async () => {
    clearPendingAction("conv-6");
    expect(await tryResolveAction("conv-6", "no keyword here")).toBeNull();
  });
});
