// M1 (tool-calling engine) — proves the generic tool-calling loop in gemini.ts against a
// fake/test tool, per PROJECT-PROGRESS.md's milestone model: "a real chat turn triggers a
// locally-defined test tool and incorporates its result; covered by a passing automated test."
//
// No GEMINI_API_KEY is available in this environment to also verify this against the real
// Gemini API (see PROJECT-PROGRESS.md's M1 evidence entry for the honest statement of that
// gap) — these tests mock only the network-calling parts of the `@google/genai` SDK
// (`GoogleGenAI`'s `generateContentStream`), while keeping the SDK's own real, pure helper
// (`createPartFromFunctionResponse`) unmocked, so the exact real request-building logic in
// gemini.ts is exercised end-to-end except for the actual network call.

import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContentStream = vi.fn();

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    // A real class, not an arrow-function mockImplementation — `new GoogleGenAI(...)` in
    // gemini.ts requires something constructible, and arrow functions have no [[Construct]].
    GoogleGenAI: vi.fn().mockImplementation(function MockGoogleGenAI(this: { models: unknown }) {
      this.models = { generateContentStream };
    }),
  };
});

vi.mock("../currentInfo.js", () => ({ needsCurrentInfo: vi.fn(() => false) }));
vi.mock("../search/searchRouter.js", () => ({ hasAnySearchProviderConfigured: vi.fn(() => false) }));

import { geminiProvider } from "./gemini.js";
import type { ToolCall, ToolDefinition } from "../llmProvider.js";

function asyncIterableOf(chunks: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const c of chunks) yield c;
    },
  };
}

const TEST_TOOL: ToolDefinition = {
  name: "get_secret_number",
  description: "Returns a fixed test number — a fake tool, never a real Arena/product tool.",
  parameters: { type: "object", properties: {}, required: [] },
};

describe("gemini tool-calling engine (M1)", () => {
  beforeEach(() => {
    generateContentStream.mockReset();
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("calls the tool and incorporates its real result into the final answer", async () => {
    // Round 1: the model decides to call the tool, no text yet.
    generateContentStream.mockResolvedValueOnce(
      asyncIterableOf([
        {
          text: undefined,
          candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "call-1", name: "get_secret_number", args: {} } }] } }],
          functionCalls: [{ id: "call-1", name: "get_secret_number", args: {} }],
        },
      ])
    );
    // Round 2: the model answers using the tool's result.
    generateContentStream.mockResolvedValueOnce(
      asyncIterableOf([{ text: "The secret number is 42.", candidates: undefined, functionCalls: undefined }])
    );

    const onDelta = vi.fn();
    const onToolCall = vi.fn(async (call: ToolCall) => {
      expect(call).toEqual({ id: "call-1", name: "get_secret_number", args: {} });
      return { secretNumber: 42 };
    });

    await geminiProvider.streamChatCompletion(
      "You are a test assistant.",
      [{ role: "user", content: "What is the secret number?" }],
      onDelta,
      undefined,
      { tools: [TEST_TOOL], onToolCall }
    );

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith("The secret number is 42.");
    expect(generateContentStream).toHaveBeenCalledTimes(2);

    // The second call's request must include the model's function-call turn and the tool's
    // function-response turn as real conversation history, not just the original user message —
    // this is what lets the model actually "see" the tool result rather than hallucinate one.
    const secondCallArgs = generateContentStream.mock.calls[1][0];
    const roles = secondCallArgs.contents.map((c: { role: string }) => c.role);
    expect(roles).toEqual(["user", "model", "user"]);
    const functionResponsePart = secondCallArgs.contents[2].parts[0];
    expect(functionResponsePart.functionResponse.name).toBe("get_secret_number");
    expect(functionResponsePart.functionResponse.response).toEqual({ output: { secretNumber: 42 } });
  });

  it("answers directly, without ever calling the tool, when the model doesn't need one", async () => {
    generateContentStream.mockResolvedValueOnce(
      asyncIterableOf([{ text: "Hello! How can I help?", candidates: undefined, functionCalls: undefined }])
    );

    const onDelta = vi.fn();
    const onToolCall = vi.fn();

    await geminiProvider.streamChatCompletion(
      "You are a test assistant.",
      [{ role: "user", content: "hi" }],
      onDelta,
      undefined,
      { tools: [TEST_TOOL], onToolCall }
    );

    expect(onToolCall).not.toHaveBeenCalled();
    expect(onDelta).toHaveBeenCalledWith("Hello! How can I help?");
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it("reports a tool failure back to the model as data, instead of throwing", async () => {
    generateContentStream.mockResolvedValueOnce(
      asyncIterableOf([
        {
          text: undefined,
          candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "call-1", name: "get_secret_number", args: {} } }] } }],
          functionCalls: [{ id: "call-1", name: "get_secret_number", args: {} }],
        },
      ])
    );
    generateContentStream.mockResolvedValueOnce(
      asyncIterableOf([{ text: "I couldn't get that for you — the tool failed.", candidates: undefined, functionCalls: undefined }])
    );

    const onDelta = vi.fn();
    const onToolCall = vi.fn(async () => {
      throw new Error("upstream tool exploded");
    });

    await expect(
      geminiProvider.streamChatCompletion(
        "You are a test assistant.",
        [{ role: "user", content: "What is the secret number?" }],
        onDelta,
        undefined,
        { tools: [TEST_TOOL], onToolCall }
      )
    ).resolves.toBeUndefined();

    const secondCallArgs = generateContentStream.mock.calls[1][0];
    const functionResponsePart = secondCallArgs.contents[2].parts[0];
    expect(functionResponsePart.functionResponse.response).toEqual({
      output: { error: "upstream tool exploded" },
    });
    expect(onDelta).toHaveBeenCalledWith("I couldn't get that for you — the tool failed.");
  });

  it("stops after a bounded number of rounds instead of looping forever on a misbehaving model", async () => {
    // Every round calls the tool again, never settling on a plain-text answer.
    generateContentStream.mockImplementation(() =>
      Promise.resolve(
        asyncIterableOf([
          {
            text: undefined,
            candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "call-x", name: "get_secret_number", args: {} } }] } }],
            functionCalls: [{ id: "call-x", name: "get_secret_number", args: {} }],
          },
        ])
      )
    );

    const onDelta = vi.fn();
    const onToolCall = vi.fn(async () => ({ secretNumber: 42 }));

    await geminiProvider.streamChatCompletion(
      "You are a test assistant.",
      [{ role: "user", content: "loop forever" }],
      onDelta,
      undefined,
      { tools: [TEST_TOOL], onToolCall }
    );

    // MAX_TOOL_ROUNDS = 4 in gemini.ts — bounded, not unbounded.
    expect(generateContentStream).toHaveBeenCalledTimes(4);
    expect(onToolCall).toHaveBeenCalledTimes(4);
    expect(onDelta).toHaveBeenCalledWith(
      "I tried a few tool calls but couldn't reach a final answer — mind rephrasing your question?"
    );
  });

  it("declares the tool's real JSON Schema to the model via parametersJsonSchema", async () => {
    generateContentStream.mockResolvedValueOnce(
      asyncIterableOf([{ text: "ok", candidates: undefined, functionCalls: undefined }])
    );

    await geminiProvider.streamChatCompletion(
      "sys",
      [{ role: "user", content: "hi" }],
      vi.fn(),
      undefined,
      { tools: [TEST_TOOL], onToolCall: vi.fn() }
    );

    const requestArgs = generateContentStream.mock.calls[0][0];
    expect(requestArgs.config.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "get_secret_number",
            description: TEST_TOOL.description,
            parametersJsonSchema: TEST_TOOL.parameters,
          },
        ],
      },
    ]);
  });
});
