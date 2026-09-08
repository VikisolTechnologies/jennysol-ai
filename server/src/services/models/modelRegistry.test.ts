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
    for (const capability of ["general", "coding", "reasoning", "currentInfoSummarization", "embedding"] as const) {
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

  it("classifyTask defaults to general for anything else", () => {
    expect(classifyTask("Tell me a joke")).toBe("general");
  });

  it("pickOllamaModel returns a coding-capable model for the coding capability", () => {
    const picked = pickOllamaModel("coding");
    expect(picked?.provider).toBe("ollama");
    expect(picked?.capabilities).toContain("coding");
  });

  it("pickOllamaModel falls back to a general model when no model matches the requested capability on this hardware", () => {
    // embedding models aren't chat models — picking for a chat-shaped
    // capability with nothing tagged for it should still return something
    // usable rather than nothing.
    const picked = pickOllamaModel("reasoning");
    expect(picked).toBeDefined();
    expect(picked?.provider).toBe("ollama");
  });
});
