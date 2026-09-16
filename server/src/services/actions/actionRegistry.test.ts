import { describe, it, expect } from "vitest";
import { ACTION_REGISTRY, findActionTarget, matchesAnyTrigger } from "./actionRegistry.js";

describe("ACTION_REGISTRY", () => {
  it("every entry has at least one trigger keyword and one required slot", () => {
    for (const target of ACTION_REGISTRY) {
      expect(target.triggerKeywords.length).toBeGreaterThan(0);
      expect(target.slots.some((s) => s.required)).toBe(true);
    }
  });

  it("no entry claims real-device verification (none has been done this session)", () => {
    for (const target of ACTION_REGISTRY) {
      expect(target.verifiedOnDevice).toBe(false);
    }
  });

  it("ids are unique", () => {
    const ids = ACTION_REGISTRY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("matchesAnyTrigger", () => {
  it("matches a real trigger keyword case-insensitively", () => {
    expect(matchesAnyTrigger("Call my mom")).toBe(true);
    expect(matchesAnyTrigger("please text John")).toBe(true);
  });

  it("does not match ordinary chat with no action keyword", () => {
    expect(matchesAnyTrigger("What's 2 + 2?")).toBe(false);
    expect(matchesAnyTrigger("Summarize this document for me")).toBe(false);
  });
});

describe("web_search webUrl", () => {
  it("real-encodes the query into Google's own search URL", () => {
    const target = findActionTarget("web_search")!;
    expect(target.webUrl({ query: "best biryani in HSR" })).toBe(
      "https://www.google.com/search?q=best%20biryani%20in%20HSR"
    );
  });
});

describe("maps_directions webUrl", () => {
  it("uses Google's own documented Maps URLs API format", () => {
    const target = findActionTarget("maps_directions")!;
    expect(target.webUrl({ destination: "Viceroy, HSR Layout" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Viceroy%2C%20HSR%20Layout"
    );
  });
});

describe("phone_call webUrl", () => {
  it("strips non-digit, non-plus characters into a real tel: URI", () => {
    const target = findActionTarget("phone_call")!;
    expect(target.webUrl({ number: "+91 98765 43210" })).toBe("tel:+919876543210");
  });
});

describe("sms platform-specific formatting", () => {
  it("uses Android's ?body= separator by default (webUrl)", () => {
    const target = findActionTarget("sms")!;
    expect(target.webUrl({ number: "9876543210", message: "on my way" })).toBe(
      "sms:9876543210?body=on%20my%20way"
    );
  });

  it("uses iOS's &body= separator when platform is ios", () => {
    const target = findActionTarget("sms")!;
    expect(target.appUrl!({ number: "9876543210", message: "on my way" }, "ios")).toBe(
      "sms:9876543210&body=on%20my%20way"
    );
  });

  it("uses Android's ?body= separator when platform is android", () => {
    const target = findActionTarget("sms")!;
    expect(target.appUrl!({ number: "9876543210", message: "on my way" }, "android")).toBe(
      "sms:9876543210?body=on%20my%20way"
    );
  });

  it("omits the body param entirely when no message was given", () => {
    const target = findActionTarget("sms")!;
    expect(target.webUrl({ number: "9876543210" })).toBe("sms:9876543210");
  });
});

describe("food_zomato webUrl", () => {
  it("has no appUrl -- deliberately web-only, no unverified deep link scheme guessed", () => {
    const target = findActionTarget("food_zomato")!;
    expect(target.appUrl).toBeUndefined();
  });

  it("combines place and query into a real search URL", () => {
    const target = findActionTarget("food_zomato")!;
    expect(target.webUrl({ query: "biryani", place: "Viceroy" })).toBe(
      "https://www.zomato.com/search?q=Viceroy%20biryani"
    );
  });
});
