import { describe, it, expect } from "vitest";
import { isWeatherQuestion, extractLocationFromMessage } from "./weatherIntent.js";

describe("isWeatherQuestion", () => {
  const shouldDetect = [
    "What's the weather in Guntur?",
    "How's weather",
    "What's the forecast for tomorrow?",
    "Is it raining in London?",
    "What's the humidity like?",
  ];
  for (const message of shouldDetect) {
    it(`detects: "${message}"`, () => expect(isWeatherQuestion(message)).toBe(true));
  }

  const shouldNotDetect = ["What's the capital of France?", "Who created JennySol?", "Tell me a joke"];
  for (const message of shouldNotDetect) {
    it(`does not detect: "${message}"`, () => expect(isWeatherQuestion(message)).toBe(false));
  }
});

describe("extractLocationFromMessage", () => {
  it("extracts a single-word capitalized city after 'in'", () => {
    expect(extractLocationFromMessage("What's the weather in Guntur?")).toBe("Guntur");
  });

  it("extracts a two-word capitalized city", () => {
    expect(extractLocationFromMessage("What's the weather in New York?")).toBe("New York");
  });

  it("handles the real confirmed-production phrasing 'Am in <City>' without swallowing the rest of the sentence", () => {
    expect(extractLocationFromMessage("Am in Guntur can u please check and let me know")).toBe("Guntur");
  });

  it("handles 'I'm in <City>'", () => {
    expect(extractLocationFromMessage("I'm in Hyderabad right now")).toBe("Hyderabad");
  });

  it("returns null when no capitalized location is present", () => {
    expect(extractLocationFromMessage("How's weather")).toBeNull();
  });

  it("returns null for an all-lowercase location (known heuristic limitation)", () => {
    expect(extractLocationFromMessage("weather in guntur")).toBeNull();
  });
});
