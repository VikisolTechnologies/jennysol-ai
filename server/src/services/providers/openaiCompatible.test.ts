import { describe, it, expect, vi, afterEach } from "vitest";
import { streamOpenAiCompatible } from "./openaiCompatible.js";
import type { ToolCall } from "../llmProvider.js";

function sseResponse(chunks: unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function contentChunk(text: string) {
  return { choices: [{ delta: { content: text } }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamOpenAiCompatible — plain chat (no tools)", () => {
  it("streams content deltas through unchanged (regression guard)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([contentChunk("Hello"), contentChunk(" world")]));
    vi.stubGlobal("fetch", fetchMock);

    let out = "";
    await streamOpenAiCompatible("http://fake/v1/chat/completions", {}, "test-model", "sys", [], (t) => (out += t));

    expect(out).toBe("Hello world");
    // No tools option supplied — request body must not carry a tools field.
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools).toBeUndefined();
  });

  it("requests include_usage and reports real usage when the API sends it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([contentChunk("hi"), { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }]));
    vi.stubGlobal("fetch", fetchMock);

    const onUsage = vi.fn();
    await streamOpenAiCompatible("http://fake/v1/chat/completions", {}, "test-model", "sys", [], () => {}, { onUsage });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 12, completionTokens: 3, estimated: false });
  });

  it("falls back to an estimate, clearly labeled, if a response ends without a usage chunk", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([contentChunk("hi there")]));
    vi.stubGlobal("fetch", fetchMock);

    const onUsage = vi.fn();
    await streamOpenAiCompatible("http://fake/v1/chat/completions", {}, "test-model", "sys", [], () => {}, { onUsage });

    expect(onUsage).toHaveBeenCalledTimes(1);
    const usage = onUsage.mock.calls[0][0];
    expect(usage.estimated).toBe(true);
    expect(usage.completionTokens).toBeGreaterThan(0);
    expect(usage.promptTokens).toBeGreaterThan(0);
  });
});

describe("streamOpenAiCompatible — tool calling", () => {
  it("executes a tool call and feeds the result back for a final answer", async () => {
    const round1 = sseResponse([
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "call_1", function: { name: "get_weather", arguments: '{"city":' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"Berlin"}' } }],
            },
          },
        ],
      },
    ]);
    const round2 = sseResponse([contentChunk("It's sunny in Berlin.")]);
    const fetchMock = vi.fn().mockResolvedValueOnce(round1).mockResolvedValueOnce(round2);
    vi.stubGlobal("fetch", fetchMock);

    const onToolCall = vi.fn(async (call: ToolCall) => {
      expect(call.name).toBe("get_weather");
      expect(call.args).toEqual({ city: "Berlin" });
      return { tempC: 22, condition: "sunny" };
    });

    let out = "";
    await streamOpenAiCompatible(
      "http://fake/v1/chat/completions",
      {},
      "test-model",
      "sys",
      [{ role: "user", content: "weather in berlin?" }],
      (t) => (out += t),
      {
        tools: [{ name: "get_weather", description: "get weather", parameters: { type: "object", properties: {} } }],
        onToolCall,
      }
    );

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(out).toBe("It's sunny in Berlin.");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second request must carry the tool result back to the model.
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(JSON.parse(toolMsg.content)).toEqual({ tempC: 22, condition: "sunny" });
  });

  it("feeds a tool error back to the model as data instead of throwing", async () => {
    const round1 = sseResponse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "broken_tool", arguments: "{}" } }] } }] },
    ]);
    const round2 = sseResponse([contentChunk("Sorry, that tool failed.")]);
    const fetchMock = vi.fn().mockResolvedValueOnce(round1).mockResolvedValueOnce(round2);
    vi.stubGlobal("fetch", fetchMock);

    const onToolCall = vi.fn(async () => {
      throw new Error("tool exploded");
    });

    let out = "";
    await streamOpenAiCompatible("http://fake/v1/chat/completions", {}, "test-model", "sys", [], (t) => (out += t), {
      tools: [{ name: "broken_tool", description: "d", parameters: {} }],
      onToolCall,
    });

    expect(out).toBe("Sorry, that tool failed.");
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === "tool");
    expect(JSON.parse(toolMsg.content)).toEqual({ error: "tool exploded" });
  });

  it("never leaves the turn empty if the model never settles on a final answer", async () => {
    const alwaysCallsTool = () =>
      sseResponse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_x", function: { name: "loop_tool", arguments: "{}" } }] } }] },
      ]);
    const fetchMock = vi.fn(async () => alwaysCallsTool());
    vi.stubGlobal("fetch", fetchMock);

    let out = "";
    await streamOpenAiCompatible("http://fake/v1/chat/completions", {}, "test-model", "sys", [], (t) => (out += t), {
      tools: [{ name: "loop_tool", description: "d", parameters: {} }],
      onToolCall: async () => ({ ok: true }),
    });

    expect(out).toContain("couldn't reach a final answer");
    // Bounded — must not have looped forever.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
