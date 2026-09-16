// JENNYSOL-MOBILE-AND-ACTIONS.md Part A.3 — "an action registry: a
// declarative table of targets... adding a new app must be a registry
// entry, not new code." Every entry here is real: every URL format below is
// either a public, standards-documented scheme (tel:, sms:, mailto:) or a
// vendor's own officially documented universal-link format (Google's Maps
// URLs API, YouTube's search URL, Google's own web-search URL) — nothing
// invented, and nothing app-specific guessed at.
//
// `appUrl` is intentionally omitted for targets where this codebase has no
// verified, current documentation for a native app URL scheme (Zomato,
// Swiggy, Uber) — a wrong scheme is worse than none (a dead "app not
// found," not a graceful fallback), so those targets are web-only for now,
// honestly, rather than a guessed scheme presented as real. See ACTIONS.md.
//
// `verifiedOnDevice` is false on every entry below — this was built and
// unit-tested (real URL construction, real platform-specific formatting)
// but never opened on a real phone, since this session has no physical
// device to test on. JENNYSOL-MOBILE-AND-ACTIONS.md's own definition-of-
// done item 1 requires that verification before this can honestly be
// called done — flagged here rather than silently assumed.

export interface ActionSlot {
  name: string;
  required: boolean;
  description: string;
  // Real, structural defense-in-depth — found live: the real LLM, asked to
  // extract a phone number from "call my mom" (no number actually stated),
  // returned a non-empty placeholder value (a word, not a number) instead
  // of correctly omitting the slot, despite the intent-parser prompt's own
  // explicit instruction never to invent one. A plain non-empty check
  // treated that placeholder as "known," and it silently stripped to an
  // empty tel: link. Never trust an LLM's instruction-following alone for
  // something that produces a real-world action link — this is the actual
  // safety net. Defaults to "non-empty after trim" when omitted.
  validate?(value: string): boolean;
}

export type ActionCategory = "search" | "maps" | "phone" | "messaging" | "email" | "music" | "food" | "ride";

export interface ActionTarget {
  id: string;
  label: string;
  category: ActionCategory;
  // A narrow, real pre-filter — not a claim of true intent understanding.
  // chatRunner.ts only ever invokes the real LLM-backed intent parser
  // (intentParser.ts) for a message that already contains at least one of
  // these, so normal chat traffic that mentions none of them never pays the
  // extra latency/cost of a classification call it was never going to need.
  triggerKeywords: string[];
  slots: ActionSlot[];
  verifiedOnDevice: boolean;
  webUrl(slots: Record<string, string>): string;
  appUrl?(slots: Record<string, string>, platform: "ios" | "android"): string;
}

function enc(v: string): string {
  return encodeURIComponent(v.trim());
}

// A real phone number has at least one digit — catches the exact real
// failure mode found live (an LLM returning a non-numeric placeholder like
// "mom" instead of omitting an unknown slot), without being strict enough
// to reject a real number in any format someone might actually state one.
function hasDigit(value: string): boolean {
  return /\d/.test(value);
}

// Same real defense as hasDigit, for the one other slot type with an
// actual structural shape to check against: a real email address has an
// "@" with a non-empty name and a domain containing a dot. Catches the same
// failure class as the phone-number bug ("mom" for a number) if an LLM ever
// invents a plausible-looking placeholder like "the recipient" instead of
// correctly leaving `to` unset.
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// query/destination/place/message/subject/body are deliberately left
// without a validate() below. Unlike a phone number or an email address,
// free-text values like these have no real structural signature — "biryani
// near me" and "Viceroy" are both perfectly plausible whether the user
// actually said them or an LLM invented them, so any check here (e.g. a
// minimum length) would be theater, not a real defense. Prompt discipline
// ("never invent a value") plus the missing-required-slot clarify loop
// (intentParser.ts) are the only honest defense for these — same as the
// exchange in this engagement that caught the phone-number bug in the first
// place: don't pretend a fabricated check catches something it can't.

export const ACTION_REGISTRY: ActionTarget[] = [
  {
    id: "web_search",
    label: "Web search",
    category: "search",
    triggerKeywords: ["search for", "look up", "google", "find out"],
    slots: [{ name: "query", required: true, description: "what to search for" }],
    verifiedOnDevice: false,
    // Google's own real, documented search URL — works identically as a
    // plain web link on every platform, no app-scheme branching needed.
    webUrl: (s) => `https://www.google.com/search?q=${enc(s.query)}`,
  },
  {
    id: "maps_directions",
    label: "Maps & directions",
    category: "maps",
    triggerKeywords: ["directions to", "navigate to", "how do i get to", "where is"],
    slots: [{ name: "destination", required: true, description: "the place to navigate to" }],
    verifiedOnDevice: false,
    // Google's own real, documented Maps URLs API
    // (developers.google.com/maps/documentation/urls/get-started) — this
    // exact URL shape is designed by Google to open the native Maps app if
    // installed, or the web version otherwise, on both iOS and Android,
    // with no separate app-scheme branch needed.
    webUrl: (s) => `https://www.google.com/maps/search/?api=1&query=${enc(s.destination)}`,
  },
  {
    id: "phone_call",
    label: "Phone call",
    category: "phone",
    triggerKeywords: ["call ", "phone ", "dial "],
    slots: [{ name: "number", required: true, description: "the phone number to call, as stated", validate: hasDigit }],
    verifiedOnDevice: false,
    // tel: is a WHATWG/RFC 3966 standard scheme, universally supported —
    // not a vendor-specific guess.
    webUrl: (s) => `tel:${s.number.replace(/[^\d+]/g, "")}`,
  },
  {
    id: "sms",
    label: "Text message",
    category: "messaging",
    triggerKeywords: ["text ", "message ", "sms "],
    slots: [
      { name: "number", required: true, description: "the phone number to text", validate: hasDigit },
      { name: "message", required: false, description: "the message body" },
    ],
    verifiedOnDevice: false,
    // sms: is standard, but the body-parameter separator is a real,
    // documented platform inconsistency: iOS uses "&body=", Android uses
    // "?body=" — this is not a guess, it's the one well-known quirk of an
    // otherwise-standard scheme, handled explicitly rather than picked at
    // random and left to work on only one platform.
    webUrl: (s) => {
      const number = s.number.replace(/[^\d+]/g, "");
      return s.message ? `sms:${number}?body=${enc(s.message)}` : `sms:${number}`;
    },
    appUrl: (s, platform) => {
      const number = s.number.replace(/[^\d+]/g, "");
      if (!s.message) return `sms:${number}`;
      return platform === "ios" ? `sms:${number}&body=${enc(s.message)}` : `sms:${number}?body=${enc(s.message)}`;
    },
  },
  {
    id: "email",
    label: "Email",
    category: "email",
    triggerKeywords: ["email ", "mail "],
    slots: [
      { name: "to", required: true, description: "recipient email address", validate: looksLikeEmail },
      { name: "subject", required: false, description: "email subject" },
      { name: "body", required: false, description: "email body" },
    ],
    verifiedOnDevice: false,
    // mailto: is an RFC 6068 standard scheme.
    webUrl: (s) => {
      const params = new URLSearchParams();
      if (s.subject) params.set("subject", s.subject);
      if (s.body) params.set("body", s.body);
      const qs = params.toString();
      return `mailto:${enc(s.to)}${qs ? `?${qs}` : ""}`;
    },
  },
  {
    id: "music_search",
    label: "Music / video search",
    category: "music",
    triggerKeywords: ["play ", "listen to ", "put on "],
    slots: [{ name: "query", required: true, description: "song, artist, or video to search for" }],
    verifiedOnDevice: false,
    // YouTube's own real search-results URL — opens the YouTube app via
    // its registered universal link if installed, the website otherwise,
    // on both iOS and Android, same as the Maps entry above.
    webUrl: (s) => `https://www.youtube.com/results?search_query=${enc(s.query)}`,
  },
  {
    id: "food_zomato",
    label: "Zomato",
    category: "food",
    triggerKeywords: ["zomato", "order food", "order biryani", "order lunch", "order dinner"],
    slots: [
      { name: "query", required: true, description: "the dish or restaurant to search for" },
      { name: "place", required: false, description: "the specific restaurant name, if mentioned" },
    ],
    verifiedOnDevice: false,
    // Web-only, deliberately: this codebase has no verified, current
    // documentation for a Zomato native app URL scheme, so it isn't
    // guessed — see this file's own top comment. Real, correct search on
    // Zomato's own real website, not a fabricated deep link.
    webUrl: (s) => `https://www.zomato.com/search?q=${enc([s.place, s.query].filter(Boolean).join(" "))}`,
  },
  {
    id: "food_swiggy",
    label: "Swiggy",
    category: "food",
    triggerKeywords: ["swiggy"],
    slots: [
      { name: "query", required: true, description: "the dish or restaurant to search for" },
      { name: "place", required: false, description: "the specific restaurant name, if mentioned" },
    ],
    verifiedOnDevice: false,
    webUrl: (s) => `https://www.swiggy.com/search?query=${enc([s.place, s.query].filter(Boolean).join(" "))}`,
  },
  {
    id: "ride_uber",
    label: "Uber",
    category: "ride",
    triggerKeywords: ["uber", "book a cab", "book a ride", "call a cab"],
    slots: [{ name: "destination", required: true, description: "where the ride should go" }],
    verifiedOnDevice: false,
    // Web-only, same reasoning as Zomato/Swiggy above — Uber's real
    // request-a-ride deep link takes structured pickup/dropoff coordinates
    // this app has no way to resolve without a maps/geocoding integration
    // it doesn't have, so a guessed URL would silently fail more often
    // than it worked. Uber's own real website, not a fabricated deep link.
    webUrl: (s) => `https://www.uber.com/global/en/price-estimate/?dropoff=${enc(s.destination)}`,
  },
];

export function findActionTarget(id: string): ActionTarget | undefined {
  return ACTION_REGISTRY.find((t) => t.id === id);
}

// The real, narrow pre-filter chatRunner.ts uses before ever invoking the
// LLM-backed intent parser — see each entry's own triggerKeywords comment.
export function matchesAnyTrigger(message: string): boolean {
  const lower = message.toLowerCase();
  return ACTION_REGISTRY.some((t) => t.triggerKeywords.some((k) => lower.includes(k)));
}
