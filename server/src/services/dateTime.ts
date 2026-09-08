// Deterministic, model-free "what time/date is it" capability — same
// architecture as identity.ts, for the same reason: confirmed in production,
// Gemini answered "I don't have a live clock" even though the server has
// always had `new Date()` available. A persona instruction telling the model
// it has "today's date" is advisory and probabilistic (the model can ignore
// it or misstate it); this computes the real time fresh on every call and
// returns it directly, bypassing the model so it can't be gotten wrong.
const DATETIME_PATTERNS: RegExp[] = [
  /\bwhat\s*('?s|\s+is)\s+(the\s+)?(current\s+)?time\b/i,
  /\bwhat\s+time\s+is\s+it\b/i,
  /\bcurrent\s+time\b/i,
  /\btime\s+right\s+now\b/i,
  /\bwhat\s*('?s|\s+is)\s+(today'?s|the current|the)\s+date\b/i,
  /\bwhat\s+day\s+is\s+(it|today)\b/i,
  /\btoday'?s\s+date\b/i,
];

export function isDateTimeQuestion(message: string): boolean {
  return DATETIME_PATTERNS.some((pattern) => pattern.test(message));
}

// UTC only — the server has no reliable signal for the user's actual
// timezone (no browser Intl data reaches this layer today), so this is
// honest about that gap rather than guessing a timezone.
export function getCurrentDateTimeResponse(): string {
  const now = new Date();
  const datePart = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const timePart = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: true,
  });
  return `Right now it's ${timePart} UTC on ${datePart}. I don't know your local timezone from here, so if you tell me your city or UTC offset I can convert that to your local time.`;
}
