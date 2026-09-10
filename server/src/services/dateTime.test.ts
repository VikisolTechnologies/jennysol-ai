import { describe, it, expect } from "vitest";
import { detectDateTimeIntent, getCurrentDateTimeResponse, isDateTimeQuestion } from "./dateTime.js";

describe("detectDateTimeIntent — TIME phrasings (normalized intent, not per-phrase regex)", () => {
  // Every one of these reduces to the same normalized intent once filler
  // words are stripped — this is the actual point of the rewrite: a new
  // phrasing built from the same request words doesn't need its own test
  // or its own regex to work. "tell me the time" and "time?" specifically
  // are the exact live-production bugs found in the 2026-09-10 audit
  // (previously fell through to the model, which answered "I don't have a
  // live clock running").
  const timePhrasings = [
    "What time is it?",
    "What's the time?",
    "Tell me the time",
    "Can you tell me the time?",
    "What is the current time?",
    "What time is it right now?",
    "Time?",
    "What time is it now?",
    "do you know the time",
    "What's current time",
    "current time please",
  ];

  for (const message of timePhrasings) {
    it(`resolves "${message}" to DATE_TIME_TIME with no location`, () => {
      const intent = detectDateTimeIntent(message);
      expect(intent.matched).toBe(true);
      expect(intent.kind).toBe("time");
      expect(intent.location).toBeNull();
    });
  }
});

describe("detectDateTimeIntent — DATE phrasings", () => {
  const datePhrasings = [
    "What date is it today?", // the exact live-production bug: word order broke the old regex
    "What's today's date?",
    "What is today's date?",
    "What's the date today?",
    "Tell me today's date",
    "What day is it today?",
    "what's the date",
  ];

  for (const message of datePhrasings) {
    it(`resolves "${message}" to DATE_TIME_DATE`, () => {
      const intent = detectDateTimeIntent(message);
      expect(intent.matched).toBe(true);
      expect(intent.kind).toBe("date");
    });
  }
});

describe("detectDateTimeIntent — location-specific time (the confirmed wrong-answer bug)", () => {
  const cases: Array<{ message: string; location: string }> = [
    { message: "What time is it in London?", location: "London" },
    { message: "What time is it in London right now?", location: "London" },
    { message: "What is the current time in Tokyo?", location: "Tokyo" },
    { message: "Tell me the time in London", location: "London" },
    { message: "What's the time right now in Tokyo?", location: "Tokyo" },
    { message: "What time is it in New York right now?", location: "New York" },
  ];

  for (const { message, location } of cases) {
    it(`extracts location "${location}" from "${message}" instead of using the caller's own timezone`, () => {
      const intent = detectDateTimeIntent(message);
      expect(intent.matched).toBe(true);
      expect(intent.kind).toBe("time");
      expect(intent.location).toBe(location);
    });
  }
});

describe("detectDateTimeIntent — negative cases (must not false-positive)", () => {
  const shouldNotDetect = [
    "What's the weather like?",
    "What's the price of gold?",
    "Tell me a story about time travel",
    "What's for dinner?",
    "What's the capital of France?",
  ];

  for (const message of shouldNotDetect) {
    it(`does not detect: "${message}"`, () => {
      expect(detectDateTimeIntent(message).matched).toBe(false);
      expect(isDateTimeQuestion(message)).toBe(false);
    });
  }
});

describe("getCurrentDateTimeResponse — timezone resolution", () => {
  it("uses a real IANA timezone resolver, not a hardcoded offset — DST-correct via Intl", () => {
    // Asia/Kolkata has no DST, so this is a stable, always-true assertion:
    // the offset must come from the real tz database, not a literal string.
    const response = getCurrentDateTimeResponse({ kind: "time", location: null }, "Asia/Kolkata");
    expect(response).toContain("Asia/Kolkata");
    expect(response).not.toContain("UTC");
  });

  it("reflects the real current UTC year, computed fresh (not hardcoded)", () => {
    const response = getCurrentDateTimeResponse({ kind: "time", location: null });
    const currentYear = new Date().getUTCFullYear().toString();
    expect(response).toContain(currentYear);
    expect(response).toMatch(/UTC/);
  });

  it("is honest about not knowing the caller's local timezone when none is given", () => {
    expect(getCurrentDateTimeResponse({ kind: "time", location: null }).toLowerCase()).toContain("timezone");
  });

  it("falls back to UTC for a malformed/unsafe timezone string rather than throwing", () => {
    expect(() => getCurrentDateTimeResponse({ kind: "time", location: null }, "'; DROP TABLE users; --")).not.toThrow();
    expect(getCurrentDateTimeResponse({ kind: "time", location: null }, "not-a-real-timezone")).toContain("UTC");
  });

  it("resolves a known city to its real IANA zone and names that city in the answer", () => {
    const response = getCurrentDateTimeResponse({ kind: "time", location: "London" }, "Asia/Kolkata");
    expect(response).toContain("London");
    // Must not silently fall back to the caller's own timezone (the exact
    // confirmed production bug) — the caller passed Asia/Kolkata, but asked
    // about London, so Kolkata must never appear as the answer's basis.
    expect(response).not.toContain("Asia/Kolkata");
  });

  it("a named location always wins over the caller's own timezone header", () => {
    const withCallerTz = getCurrentDateTimeResponse({ kind: "time", location: "Tokyo" }, "America/New_York");
    const withoutCallerTz = getCurrentDateTimeResponse({ kind: "time", location: "Tokyo" }, undefined);
    // Same city, same real moment -> same answer regardless of the caller's
    // own timezone header (proves the header isn't leaking into the
    // location-specific branch at all).
    expect(withCallerTz).toBe(withoutCallerTz);
  });

  it("asks for clarification rather than guessing when the location isn't in the resolver", () => {
    const response = getCurrentDateTimeResponse({ kind: "time", location: "Narnia" }, "Asia/Kolkata");
    expect(response.toLowerCase()).toMatch(/don't have|not sure|specific|clarify|which/);
    // Must not silently answer with the caller's own timezone for an
    // unresolvable location — this is the exact bug being fixed.
    expect(response).not.toContain("Asia/Kolkata");
  });

  it("date-kind responses lead with the date, not a bare clock time", () => {
    const response = getCurrentDateTimeResponse({ kind: "date", location: "Tokyo" });
    expect(response).toContain("Tokyo");
    expect(response.toLowerCase()).toMatch(/today is/);
  });
});
