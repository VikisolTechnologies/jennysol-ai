// Deliberately simple regex heuristics, not NLP/NER — same philosophy as
// currentInfo.ts and identity.ts: cheap, explainable, and easy to extend one
// phrasing at a time rather than a black-box classifier with no
// infrastructure yet to validate it against.
const WEATHER_KEYWORDS = /\b(weather|forecast|temperature|humidity|precipitation|raining|snowing)\b/i;
const HOWS_WEATHER = /\bhow'?s\s+(?:the\s+)?weather\b/i;

export function isWeatherQuestion(message: string): boolean {
  return WEATHER_KEYWORDS.test(message) || HOWS_WEATHER.test(message);
}

// Case-SENSITIVE on purpose: this is what lets "Am in Guntur can u please
// check" correctly capture just "Guntur" — the capitalized-word run stops
// at the next lowercase word ("can"), rather than swallowing the rest of
// the sentence. A real, if imperfect, tradeoff: an all-lowercase location
// ("weather in san francisco") won't be caught by this and falls through to
// the existing "ask the user for their city" behavior, which is not a
// regression from before this capability existed.
const LOCATION_AFTER_PREPOSITION = /\b(?:in|for|at)\s+([A-Z][A-Za-z]*(?:\s[A-Z][A-Za-z]*){0,2})\b/;
const IM_IN_LOCATION = /\b(?:i'?m|i\s+am|am)\s+in\s+([A-Z][A-Za-z]*(?:\s[A-Z][A-Za-z]*){0,2})\b/;

export function extractLocationFromMessage(message: string): string | null {
  return LOCATION_AFTER_PREPOSITION.exec(message)?.[1] ?? IM_IN_LOCATION.exec(message)?.[1] ?? null;
}
