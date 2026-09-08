import { describe, it, expect } from "vitest";
import { isDateTimeQuestion, getCurrentDateTimeResponse } from "./dateTime.js";

describe("isDateTimeQuestion", () => {
  const shouldDetect = [
    "What's current time",
    "What time is it right now?",
    "What is the time?",
    "current time please",
    "What's today's date?",
    "What is today's date?",
    "What day is it today?",
    "what's the date",
  ];

  for (const message of shouldDetect) {
    it(`detects: "${message}"`, () => {
      expect(isDateTimeQuestion(message)).toBe(true);
    });
  }

  const shouldNotDetect = [
    "What's the weather like?",
    "What's the price of gold?",
    "Tell me a story about time travel",
    "What's for dinner?",
  ];

  for (const message of shouldNotDetect) {
    it(`does not detect: "${message}"`, () => {
      expect(isDateTimeQuestion(message)).toBe(false);
    });
  }
});

describe("getCurrentDateTimeResponse", () => {
  it("reflects the real current UTC year, computed fresh (not hardcoded)", () => {
    const response = getCurrentDateTimeResponse();
    const currentYear = new Date().getUTCFullYear().toString();
    expect(response).toContain(currentYear);
    expect(response).toMatch(/UTC/);
  });

  it("is honest about not knowing the caller's local timezone when none is given", () => {
    expect(getCurrentDateTimeResponse().toLowerCase()).toContain("timezone");
  });

  it("uses the caller's real IANA timezone when provided, instead of UTC", () => {
    const response = getCurrentDateTimeResponse("Asia/Kolkata");
    expect(response).toContain("Asia/Kolkata");
    expect(response).not.toContain("UTC");
  });

  it("falls back to UTC for a malformed/unsafe timezone string rather than throwing", () => {
    expect(() => getCurrentDateTimeResponse("'; DROP TABLE users; --")).not.toThrow();
    expect(getCurrentDateTimeResponse("not-a-real-timezone")).toContain("UTC");
  });
});
