// Shared by the search layer (decides whether to spend a real search API
// call) and, as an interim fallback, gemini.ts (decides whether to declare
// its own native grounding tool when no external search provider is
// configured yet) — one heuristic, not two copies that could drift.
//
// Declaring/running a search step costs real latency, so it's not enough to
// gate on "could this benefit from freshness at all" — only turns that
// plausibly need real-world, time-sensitive info pay for it. False
// negatives just mean no live grounding on a borderline message; false
// positives cost a few seconds on a message that didn't need it — both
// cheaper than taxing every message with a search call.
const CURRENT_INFO_PATTERN =
  /\b(today|tonight|this week|this month|this year|current|currently|latest|recent(ly)?|breaking|news|weather|forecast|score|stock|exchange rate|gold rate|price of|release date|who won|election|schedule|upcoming|right now|open now|alive|deceased|passed away|still (in office|married|operating|available)|202[4-9])\b/i;

// A distinct pattern from CURRENT_INFO_PATTERN above, deliberately: this one
// catches an EXPLICIT request to search/look something up ("can you search
// about her", "google this", "look that up online"), regardless of whether
// the message itself contains any time-sensitivity keyword. Confirmed live
// in production as a real gap: "Can u search about her on google" matched
// neither pattern before this, so no search/grounding was ever attempted
// and the model just said it couldn't browse live results — technically
// honest, but not what an explicit search request should do when a search
// capability exists at all.
const EXPLICIT_SEARCH_REQUEST_PATTERN =
  /\b(search (for|about)|can you search|could you search|google (this|that|it|her|him|them)|look (this|that|it) up|look up|check online|find (out )?online)\b/i;

export function needsCurrentInfo(message: string): boolean {
  return CURRENT_INFO_PATTERN.test(message) || EXPLICIT_SEARCH_REQUEST_PATTERN.test(message);
}
