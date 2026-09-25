import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK at its boundary: each messages.stream() call returns the next scripted message.
const scripted: unknown[] = [];
const calls: Record<string, unknown>[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      stream: (params: Record<string, unknown>) => {
        calls.push(JSON.parse(JSON.stringify(params)));
        const message = scripted.shift() as { content: { type: string; text?: string }[] };
        const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
        return {
          on(event: string, fn: (...a: unknown[]) => void) {
            (handlers[event] ||= []).push(fn);
            return this;
          },
          async finalMessage() {
            handlers.streamEvent?.forEach((fn) => fn({}));
            for (const block of message.content) if (block.type === "text") handlers.text?.forEach((fn) => fn(block.text));
            return message;
          },
        };
      },
    };
  }
  return { default: FakeAnthropic };
});

const { anthropicProvider, modelForTier, toApiToolName, fromApiToolName } = await import("./anthropic.js");

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

describe("anthropic provider", () => {
  beforeEach(() => {
    scripted.length = 0;
    calls.length = 0;
    delete process.env.ANTHROPIC_MODEL_FAST;
  });

  it("maps tiers to Haiku / Sonnet / Opus, overridable per deployment", () => {
    expect(modelForTier("fast")).toBe("claude-haiku-4-5-20251001");
    expect(modelForTier("balanced")).toBe("claude-sonnet-5");
    expect(modelForTier("deep")).toBe("claude-opus-5-5");
    expect(modelForTier(undefined)).toBe("claude-haiku-4-5-20251001");
    process.env.ANTHROPIC_MODEL_FAST = "claude-custom";
    expect(modelForTier("fast")).toBe("claude-custom");
  });

  it("translates dotted tool names to API-safe names and back", () => {
    expect(toApiToolName("arena.createPost")).toBe("arena__createPost");
    expect(fromApiToolName("arena__createPost")).toBe("arena.createPost");
  });

  it("runs the tool loop: calls the tool with the original name, feeds the result back, then answers", async () => {
    scripted.push(
      { stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "tu1", name: "arena__search", input: { query: "badminton" } }] },
      { stop_reason: "end_turn", usage, content: [{ type: "text", text: "There's a game at 6pm." }] }
    );
    const onToolCall = vi.fn(async () => ({ activities: [{ id: "p1" }] }));
    let out = "";
    await anthropicProvider.streamChatCompletion("sys", [{ role: "user", content: "badminton?" }], (d) => (out += d), undefined, {
      tier: "balanced",
      tools: [{ name: "arena.search", description: "search", parameters: { type: "object", properties: {} } }],
      onToolCall,
    });

    expect(onToolCall).toHaveBeenCalledWith({ id: "tu1", name: "arena.search", args: { query: "badminton" } });
    expect(out).toBe("There's a game at 6pm.");
    expect(calls[0].model).toBe("claude-sonnet-5");
    expect((calls[0].tools as { name: string }[])[0].name).toBe("arena__search");
    const secondRoundLast = (calls[1].messages as { role: string; content: { type: string; tool_use_id: string }[] }[]).at(-1)!;
    expect(secondRoundLast.content[0]).toEqual(expect.objectContaining({ type: "tool_result", tool_use_id: "tu1" }));
  });

  it("reports a failing tool to the model as an error result instead of throwing", async () => {
    scripted.push(
      { stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "tu1", name: "arena__search", input: {} }] },
      { stop_reason: "end_turn", usage, content: [{ type: "text", text: "Search is down right now." }] }
    );
    let out = "";
    await anthropicProvider.streamChatCompletion("sys", [{ role: "user", content: "x" }], (d) => (out += d), undefined, {
      tools: [{ name: "arena.search", description: "s", parameters: { type: "object" } }],
      onToolCall: async () => {
        throw new Error("boom");
      },
    });
    const result = (calls[1].messages as { content: { is_error?: boolean; content: string }[] }[]).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("boom");
    expect(out).toBe("Search is down right now.");
  });

  it("merges consecutive same-role turns and drops a leading assistant turn", async () => {
    scripted.push({ stop_reason: "end_turn", usage, content: [{ type: "text", text: "ok" }] });
    await anthropicProvider.streamChatCompletion(
      "sys",
      [
        { role: "assistant", content: "hello" },
        { role: "user", content: "a" },
        { role: "user", content: "b" },
      ],
      () => {}
    );
    expect(calls[0].messages).toEqual([{ role: "user", content: "a\n\nb" }]);
  });
});
