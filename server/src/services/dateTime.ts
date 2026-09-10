// Deterministic, model-free "what time/date is it" capability — same
// architecture as identity.ts. A normalized-intent layer (strip a fixed
// set of filler/request words, see FILLER_WORDS, then check what's left)
// replaces the original per-phrasing regex list, which had confirmed
// production gaps: "tell me the time" and "time?" matched none of the old
// patterns and fell through to the model, reviving the exact "I don't
// have a live clock" bug this file exists to prevent. A named-city query
// ("what time is it in London") used to match but silently answered with
// the caller's own timezone instead of London's — fixed here by real
// location extraction + an IANA timezone lookup (LOCATION_TIMEZONES),
// never a hardcoded UTC offset, so DST is always handled by the
// environment's own tz database via Intl.

const FILLER_WORDS = new Set([
  "what", "whats", "is", "it", "the", "current", "currently", "right", "now",
  "please", "can", "you", "could", "would", "tell", "me", "do", "know",
  "today", "todays", "here", "exact", "actual", "my", "for", "of", "a", "an",
  "give", "us", "kindly", "just", "in", "about", "real", "and",
]);

function normalizeTokens(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/'/g, "") // "what's" -> "whats", "today's" -> "todays"
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Anchors on a trailing "in <place>" clause — the only location grammar
// this understands, matching every example in the product spec ("in
// London", "in New York right now", "in Tokyo?"). Deliberately narrow
// rather than a general NER model: a location this can't parse falls
// through to "no location" rather than guessing, and a location it
// parses but doesn't recognize triggers an honest clarification instead
// of a silently wrong answer (see getCurrentDateTimeResponse below).
const LOCATION_CLAUSE =
  /\bin\s+([a-z][a-z.\s'-]*?)\s*(?:\bright\s+now\b|\bnow\b|\btoday\b|\bcurrently\b)?\s*[?!.]*\s*$/i;

export interface DateTimeIntent {
  matched: boolean;
  kind: "time" | "date" | null;
  /** Raw extracted location text (e.g. "New York"), or null if the caller's own timezone should be used. */
  location: string | null;
}

const NO_MATCH: DateTimeIntent = { matched: false, kind: null, location: null };

export function detectDateTimeIntent(message: string): DateTimeIntent {
  const locationMatch = message.match(LOCATION_CLAUSE);
  let location: string | null = null;
  let working = message;
  if (locationMatch && locationMatch.index !== undefined) {
    location = locationMatch[1].trim().replace(/\s+/g, " ");
    working = message.slice(0, locationMatch.index) + " " + message.slice(locationMatch.index + locationMatch[0].length);
  }

  const remaining = new Set(normalizeTokens(working).filter((t) => !FILLER_WORDS.has(t)));
  if (remaining.size === 0 || remaining.size > 2) return NO_MATCH;

  const hasTime = remaining.has("time");
  const hasDate = remaining.has("date") || remaining.has("day");
  const hasOther = [...remaining].some((t) => t !== "time" && t !== "date" && t !== "day");
  if (hasOther || (!hasTime && !hasDate)) return NO_MATCH;

  // A combined "date and time" style ask is answered by the "time"
  // response, which already states both.
  return { matched: true, kind: hasTime ? "time" : "date", location };
}

// Back-compat single-purpose check, used by chatRunner.ts's initial gate.
export function isDateTimeQuestion(message: string): boolean {
  return detectDateTimeIntent(message).matched;
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

interface ResolvedLocation {
  zone: string;
  display: string;
}

// City name -> real IANA zone identifier, never a hardcoded offset — the
// offset (including DST) is always computed by Intl against this zone at
// call time. Curated, not exhaustive: covers every example in the product
// spec plus the world's major capitals/cities. Anything not in here
// correctly falls through to an honest clarification request rather than
// a guess (see getCurrentDateTimeResponse).
const LOCATION_TIMEZONES: Record<string, ResolvedLocation> = {
  london: { zone: "Europe/London", display: "London" },
  paris: { zone: "Europe/Paris", display: "Paris" },
  berlin: { zone: "Europe/Berlin", display: "Berlin" },
  munich: { zone: "Europe/Berlin", display: "Munich" },
  rome: { zone: "Europe/Rome", display: "Rome" },
  milan: { zone: "Europe/Rome", display: "Milan" },
  madrid: { zone: "Europe/Madrid", display: "Madrid" },
  barcelona: { zone: "Europe/Madrid", display: "Barcelona" },
  moscow: { zone: "Europe/Moscow", display: "Moscow" },
  athens: { zone: "Europe/Athens", display: "Athens" },
  vienna: { zone: "Europe/Vienna", display: "Vienna" },
  zurich: { zone: "Europe/Zurich", display: "Zurich" },
  geneva: { zone: "Europe/Zurich", display: "Geneva" },
  brussels: { zone: "Europe/Brussels", display: "Brussels" },
  amsterdam: { zone: "Europe/Amsterdam", display: "Amsterdam" },
  copenhagen: { zone: "Europe/Copenhagen", display: "Copenhagen" },
  oslo: { zone: "Europe/Oslo", display: "Oslo" },
  stockholm: { zone: "Europe/Stockholm", display: "Stockholm" },
  helsinki: { zone: "Europe/Helsinki", display: "Helsinki" },
  warsaw: { zone: "Europe/Warsaw", display: "Warsaw" },
  prague: { zone: "Europe/Prague", display: "Prague" },
  budapest: { zone: "Europe/Budapest", display: "Budapest" },
  bucharest: { zone: "Europe/Bucharest", display: "Bucharest" },
  sofia: { zone: "Europe/Sofia", display: "Sofia" },
  lisbon: { zone: "Europe/Lisbon", display: "Lisbon" },
  dublin: { zone: "Europe/Dublin", display: "Dublin" },
  reykjavik: { zone: "Atlantic/Reykjavik", display: "Reykjavik" },
  "kyiv": { zone: "Europe/Kyiv", display: "Kyiv" },
  kiev: { zone: "Europe/Kyiv", display: "Kyiv" },
  istanbul: { zone: "Europe/Istanbul", display: "Istanbul" },
  ankara: { zone: "Europe/Istanbul", display: "Ankara" },

  tokyo: { zone: "Asia/Tokyo", display: "Tokyo" },
  osaka: { zone: "Asia/Tokyo", display: "Osaka" },
  seoul: { zone: "Asia/Seoul", display: "Seoul" },
  beijing: { zone: "Asia/Shanghai", display: "Beijing" },
  shanghai: { zone: "Asia/Shanghai", display: "Shanghai" },
  shenzhen: { zone: "Asia/Shanghai", display: "Shenzhen" },
  guangzhou: { zone: "Asia/Shanghai", display: "Guangzhou" },
  "hong kong": { zone: "Asia/Hong_Kong", display: "Hong Kong" },
  taipei: { zone: "Asia/Taipei", display: "Taipei" },
  bangkok: { zone: "Asia/Bangkok", display: "Bangkok" },
  hanoi: { zone: "Asia/Ho_Chi_Minh", display: "Hanoi" },
  "ho chi minh city": { zone: "Asia/Ho_Chi_Minh", display: "Ho Chi Minh City" },
  saigon: { zone: "Asia/Ho_Chi_Minh", display: "Ho Chi Minh City" },
  jakarta: { zone: "Asia/Jakarta", display: "Jakarta" },
  manila: { zone: "Asia/Manila", display: "Manila" },
  "kuala lumpur": { zone: "Asia/Kuala_Lumpur", display: "Kuala Lumpur" },
  singapore: { zone: "Asia/Singapore", display: "Singapore" },
  dubai: { zone: "Asia/Dubai", display: "Dubai" },
  "abu dhabi": { zone: "Asia/Dubai", display: "Abu Dhabi" },
  doha: { zone: "Asia/Qatar", display: "Doha" },
  "kuwait city": { zone: "Asia/Kuwait", display: "Kuwait City" },
  riyadh: { zone: "Asia/Riyadh", display: "Riyadh" },
  jeddah: { zone: "Asia/Riyadh", display: "Jeddah" },
  baghdad: { zone: "Asia/Baghdad", display: "Baghdad" },
  tehran: { zone: "Asia/Tehran", display: "Tehran" },
  "tel aviv": { zone: "Asia/Jerusalem", display: "Tel Aviv" },
  jerusalem: { zone: "Asia/Jerusalem", display: "Jerusalem" },
  karachi: { zone: "Asia/Karachi", display: "Karachi" },
  lahore: { zone: "Asia/Karachi", display: "Lahore" },
  islamabad: { zone: "Asia/Karachi", display: "Islamabad" },
  dhaka: { zone: "Asia/Dhaka", display: "Dhaka" },
  kathmandu: { zone: "Asia/Kathmandu", display: "Kathmandu" },
  colombo: { zone: "Asia/Colombo", display: "Colombo" },
  mumbai: { zone: "Asia/Kolkata", display: "Mumbai" },
  bombay: { zone: "Asia/Kolkata", display: "Mumbai" },
  delhi: { zone: "Asia/Kolkata", display: "Delhi" },
  "new delhi": { zone: "Asia/Kolkata", display: "New Delhi" },
  bangalore: { zone: "Asia/Kolkata", display: "Bangalore" },
  bengaluru: { zone: "Asia/Kolkata", display: "Bengaluru" },
  hyderabad: { zone: "Asia/Kolkata", display: "Hyderabad" },
  chennai: { zone: "Asia/Kolkata", display: "Chennai" },
  madras: { zone: "Asia/Kolkata", display: "Chennai" },
  kolkata: { zone: "Asia/Kolkata", display: "Kolkata" },
  calcutta: { zone: "Asia/Kolkata", display: "Kolkata" },
  pune: { zone: "Asia/Kolkata", display: "Pune" },
  ahmedabad: { zone: "Asia/Kolkata", display: "Ahmedabad" },

  cairo: { zone: "Africa/Cairo", display: "Cairo" },
  lagos: { zone: "Africa/Lagos", display: "Lagos" },
  nairobi: { zone: "Africa/Nairobi", display: "Nairobi" },
  johannesburg: { zone: "Africa/Johannesburg", display: "Johannesburg" },
  "cape town": { zone: "Africa/Johannesburg", display: "Cape Town" },
  casablanca: { zone: "Africa/Casablanca", display: "Casablanca" },
  accra: { zone: "Africa/Accra", display: "Accra" },
  "addis ababa": { zone: "Africa/Addis_Ababa", display: "Addis Ababa" },

  "new york": { zone: "America/New_York", display: "New York" },
  "new york city": { zone: "America/New_York", display: "New York" },
  nyc: { zone: "America/New_York", display: "New York" },
  boston: { zone: "America/New_York", display: "Boston" },
  washington: { zone: "America/New_York", display: "Washington, D.C." },
  "washington dc": { zone: "America/New_York", display: "Washington, D.C." },
  miami: { zone: "America/New_York", display: "Miami" },
  atlanta: { zone: "America/New_York", display: "Atlanta" },
  philadelphia: { zone: "America/New_York", display: "Philadelphia" },
  chicago: { zone: "America/Chicago", display: "Chicago" },
  houston: { zone: "America/Chicago", display: "Houston" },
  dallas: { zone: "America/Chicago", display: "Dallas" },
  austin: { zone: "America/Chicago", display: "Austin" },
  denver: { zone: "America/Denver", display: "Denver" },
  phoenix: { zone: "America/Phoenix", display: "Phoenix" },
  "los angeles": { zone: "America/Los_Angeles", display: "Los Angeles" },
  la: { zone: "America/Los_Angeles", display: "Los Angeles" },
  "san francisco": { zone: "America/Los_Angeles", display: "San Francisco" },
  seattle: { zone: "America/Los_Angeles", display: "Seattle" },
  "las vegas": { zone: "America/Los_Angeles", display: "Las Vegas" },
  toronto: { zone: "America/Toronto", display: "Toronto" },
  ottawa: { zone: "America/Toronto", display: "Ottawa" },
  montreal: { zone: "America/Toronto", display: "Montreal" },
  vancouver: { zone: "America/Vancouver", display: "Vancouver" },
  "mexico city": { zone: "America/Mexico_City", display: "Mexico City" },
  "sao paulo": { zone: "America/Sao_Paulo", display: "São Paulo" },
  "rio de janeiro": { zone: "America/Sao_Paulo", display: "Rio de Janeiro" },
  brasilia: { zone: "America/Sao_Paulo", display: "Brasília" },
  "buenos aires": { zone: "America/Argentina/Buenos_Aires", display: "Buenos Aires" },
  santiago: { zone: "America/Santiago", display: "Santiago" },
  bogota: { zone: "America/Bogota", display: "Bogotá" },
  lima: { zone: "America/Lima", display: "Lima" },

  sydney: { zone: "Australia/Sydney", display: "Sydney" },
  canberra: { zone: "Australia/Sydney", display: "Canberra" },
  melbourne: { zone: "Australia/Melbourne", display: "Melbourne" },
  brisbane: { zone: "Australia/Brisbane", display: "Brisbane" },
  perth: { zone: "Australia/Perth", display: "Perth" },
  adelaide: { zone: "Australia/Adelaide", display: "Adelaide" },
  auckland: { zone: "Pacific/Auckland", display: "Auckland" },
  wellington: { zone: "Pacific/Auckland", display: "Wellington" },
};

function resolveTimezoneForLocation(rawLocation: string): ResolvedLocation | null {
  const key = rawLocation.toLowerCase().trim().replace(/\s+/g, " ");
  return LOCATION_TIMEZONES[key] ?? null;
}

function formatFor(tz: string, now: Date) {
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
  const zoneNamePart = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  return { datePart, timePart, zoneNamePart };
}

// `intent.location`, when present, always wins over the caller's own
// timezone — that's the whole point of a named-city query. An
// unrecognized location asks for clarification rather than silently
// falling back to the caller's timezone (the confirmed production bug
// this replaces: "what time is it in London" used to answer with the
// caller's own local time, mislabeled as London's).
export function getCurrentDateTimeResponse(
  intent: Pick<DateTimeIntent, "kind" | "location">,
  callerTimezone?: string
): string {
  const now = new Date();
  const isDateKind = intent.kind === "date";

  if (intent.location) {
    const resolved = resolveTimezoneForLocation(intent.location);
    if (!resolved) {
      return `I don't have a reliable timezone mapping for "${intent.location}" — could you name the city more specifically, or tell me its country, so I can get you the right time?`;
    }
    const { datePart, timePart, zoneNamePart } = formatFor(resolved.zone, now);
    if (isDateKind) {
      return `Today is ${datePart} in ${resolved.display}.`;
    }
    return `Right now it's ${timePart}${zoneNamePart ? ` ${zoneNamePart}` : ""} on ${datePart} in ${resolved.display}.`;
  }

  const tz = callerTimezone && isValidTimezone(callerTimezone) ? callerTimezone : "UTC";
  const { datePart, timePart, zoneNamePart } = formatFor(tz, now);

  if (tz === "UTC") {
    return isDateKind
      ? `Today is ${datePart} (UTC). I don't know your local timezone from here, so if you tell me your city or UTC offset I can convert that to your local date.`
      : `Right now it's ${timePart} UTC on ${datePart}. I don't know your local timezone from here, so if you tell me your city or UTC offset I can convert that to your local time.`;
  }

  return isDateKind
    ? `Today is ${datePart} (${tz}).`
    : `Right now it's ${timePart}${zoneNamePart ? ` ${zoneNamePart}` : ""} on ${datePart} (${tz}).`;
}
