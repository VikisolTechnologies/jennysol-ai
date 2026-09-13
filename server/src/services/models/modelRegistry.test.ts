import { describe, it, expect, beforeEach } from "vitest";
import { fitsHardware, modelsFor, pickOllamaModel, classifyTask, MODEL_REGISTRY, findModel } from "./modelRegistry.js";

const originalEnv = { ...process.env };

describe("modelRegistry", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LOCAL_HARDWARE_PROFILE = "m1_16gb";
  });

  it("cloud models always fit hardware regardless of profile", () => {
    const gemini = findModel("gemini", process.env.GEMINI_MODEL || "gemini-3.5-flash-lite");
    expect(gemini).toBeDefined();
    expect(fitsHardware(gemini!)).toBe(true);
  });

  it("marks a requiresDedicatedServer model as not fitting the m1_16gb profile", () => {
    const big = MODEL_REGISTRY.find((m) => m.requiresDedicatedServer);
    expect(big).toBeDefined();
    expect(fitsHardware(big!)).toBe(false);
  });

  it("a requiresDedicatedServer model fits once the dedicated profile is active", () => {
    process.env.LOCAL_HARDWARE_PROFILE = "dedicated_rtx5060ti_16gb";
    const big = MODEL_REGISTRY.find((m) => m.requiresDedicatedServer && m.memoryRequirementGb <= 13);
    expect(big).toBeDefined();
    expect(fitsHardware(big!)).toBe(true);
  });

  it("modelsFor never returns a model that doesn't fit the active hardware profile", () => {
    for (const capability of ["general", "coding", "reasoning", "currentInfoSummarization", "embedding", "trivial"] as const) {
      for (const m of modelsFor(capability)) {
        expect(fitsHardware(m)).toBe(true);
      }
    }
  });

  it("classifyTask detects a coding request", () => {
    expect(classifyTask("Can you write a Python function to reverse a linked list?")).toBe("coding");
    expect(classifyTask("```js\nconsole.log(1)\n```")).toBe("coding");
  });

  it("classifyTask detects a current-information request", () => {
    expect(classifyTask("What's today's gold rate in India?")).toBe("currentInfoSummarization");
  });

  it("classifyTask detects a genuine reasoning request", () => {
    // Real gap this session found and fixed: classifyTask() previously had
    // NO signal for "reasoning" at all, so a reasoning-tagged model could
    // never be reached by real chat traffic regardless of what
    // pickOllamaModel() did with the result.
    expect(classifyTask("Walk me through your reasoning, step by step, for why this proof holds.")).toBe("reasoning");
    expect(classifyTask("Prove that the square root of 2 is irrational. Think through it carefully.")).toBe("reasoning");
  });

  it("classifyTask treats a short, low-stakes message as trivial rather than general", () => {
    expect(classifyTask("Tell me a joke")).toBe("trivial");
    expect(classifyTask("thanks!")).toBe("trivial");
  });

  it("classifyTask still falls back to general for anything longer with no other signal", () => {
    expect(
      classifyTask("Can you give me a thoughtful, detailed comparison of remote work versus office work for a growing team?")
    ).toBe("general");
  });

  it("more specific signals win over the trivial word-count heuristic even on a short message", () => {
    expect(classifyTask("step by step, what is 2+2?")).toBe("reasoning");
  });

  // JENNYSOL-CONTINUE.md Phase 3: "a table of representative prompts →
  // the provider and model that must be selected... these must fail
  // loudly if a future change silently reroutes traffic." This is that
  // table — the classification AND the final model pick are both asserted,
  // since the real bug this session found lived in the mapping step
  // (pickOllamaModel), not the classification step, and a test that only
  // checked classifyTask() would have missed it entirely.
  describe("routing assertions — representative prompts must reach the right model", () => {
    const cases: { prompt: string; expectedModelId: string }[] = [
      { prompt: "Can you write a Python function to reverse a linked list?", expectedModelId: "qwen2.5-coder:7b" },
      { prompt: "Refactor this class to use dependency injection.", expectedModelId: "qwen2.5-coder:7b" },
      { prompt: "Walk me through your reasoning, step by step, for why this proof holds.", expectedModelId: "deepseek-r1:7b" },
      { prompt: "Prove that the square root of 2 is irrational. Think through it carefully.", expectedModelId: "deepseek-r1:7b" },
      { prompt: "hi", expectedModelId: "qwen3:4b" },
      { prompt: "thanks!", expectedModelId: "qwen3:4b" },
      {
        prompt: "Can you give me a thoughtful, detailed comparison of remote work versus office work for a growing team?",
        expectedModelId: "qwen3:8b",
      },
    ];

    it.each(cases)("'$prompt' routes to $expectedModelId", ({ prompt, expectedModelId }) => {
      const capability = classifyTask(prompt);
      const picked = pickOllamaModel(capability);
      expect(picked?.modelId).toBe(expectedModelId);
    });
  });

  it("pickOllamaModel picks the dedicated reasoning specialist over a generalist that also claims reasoning", () => {
    // The exact bug, asserted directly against the registry rather than
    // through classifyTask(): qwen3:8b's own capabilities list includes
    // "reasoning" too (it's a real, if lesser, reasoning performer), and
    // used to always win the latency tie-break against deepseek-r1:7b once
    // both tied on qualityClass "capable" — a generalist tuned for fast
    // chat beat a model built to spend time thinking, every time.
    const picked = pickOllamaModel("reasoning");
    expect(picked?.modelId).toBe("deepseek-r1:7b");
  });

  it("pickOllamaModel still returns qwen3:8b for a plain general request (regression guard on the specificity fix)", () => {
    const picked = pickOllamaModel("general");
    expect(picked?.modelId).toBe("qwen3:8b");
  });
});
