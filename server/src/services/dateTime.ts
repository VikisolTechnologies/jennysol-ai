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

// A bare IANA identifier ("Asia/Kolkata", "Etc/UTC") — not a strict full
// validation of the tz database, just enough to reject anything that isn't
// shaped like one before it ever reaches Intl (which throws a RangeError on
// a bad zone, and this is fed by a client-supplied header — see chat.ts).
const IANA_TIMEZONE_SHAPE = /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/;

function isValidTimezone(tz: string): boolean {
  if (!IANA_TIMEZONE_SHAPE.test(tz)) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Prefers the caller's real IANA timezone (see client's `X-Timezone` header,
// captured from the browser's own Intl.DateTimeFormat().resolvedOptions() —
// the one place this can be known honestly rather than guessed from IP
// geolocation, which the product spec explicitly ruled out). Falls back to
// UTC, explicitly, rather than silently guessing a timezone when the header
// is missing or malformed.
export function getCurrentDateTimeResponse(timezone?: string): string {
  const tz = timezone && isValidTimezone(timezone) ? timezone : "UTC";
  const now = new Date();
  const datePart = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: tz,
  });
  const timePart = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
    hour12: true,
  });

  if (tz === "UTC") {
    return `Right now it's ${timePart} UTC on ${datePart}. I don't know your local timezone from here, so if you tell me your city or UTC offset I can convert that to your local time.`;
  }

  const zoneNamePart = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  return `Right now it's ${timePart}${zoneNamePart ? ` ${zoneNamePart}` : ""} on ${datePart} (${tz}).`;
}
