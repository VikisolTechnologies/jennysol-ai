import { describe, it, expect } from "vitest";
import { citedReport } from "./citedReport.js";

describe("cited research report", () => {
  it("attaches a citation to every sourced sentence", () => {
    const result = citedReport("qwen3 deadline", [
      { title: "Ollama", url: "https://example.com/a", snippet: "Thinking can be disabled." },
    ]);
    expect(result.report).toBe("Thinking can be disabled. [1]");
    expect(result.citations).toEqual([{ n: 1, title: "Ollama", url: "https://example.com/a" }]);
  });

  it("refuses to invent a report when search returned nothing", () => {
    const result = citedReport("unknown", []);
    expect(result.report).toBe("");
    expect(result.note).toMatch(/No sources were found/);
  });
});
