// Open-Meteo — chosen specifically because it needs no API key and no
// credit card at all for non-commercial use (confirmed against
// open-meteo.com/en/docs and open-meteo.com/en/pricing: 10,000 calls/day
// free, geocoding endpoint included). This is what "model-independent,
// zero-cost weather capability" means in practice: a real HTTP call to a
// real data source, not the LLM inventing a plausible-sounding number.
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// WMO weather interpretation codes, as used by Open-Meteo's `weather_code`
// field — https://open-meteo.com/en/docs (see "WMO Weather interpretation
// codes" table). Not exhaustive of every code Open-Meteo could ever return,
// but covers every code likely to occur in practice.
const WMO_CONDITIONS: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  56: "light freezing drizzle",
  57: "dense freezing drizzle",
  61: "slight rain",
  63: "moderate rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "heavy freezing rain",
  71: "slight snow fall",
  73: "moderate snow fall",
  75: "heavy snow fall",
  77: "snow grains",
  80: "slight rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  85: "slight snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with slight hail",
  99: "thunderstorm with heavy hail",
};

export interface WeatherResult {
  resolvedLocation: string; // e.g. "Guntur, Andhra Pradesh, India" — from the geocoder, not echoed user input
  conditionText: string;
  temperatureC: number;
  feelsLikeC: number;
  humidityPercent: number;
  windKph: number;
  precipitationMm: number;
  observedAt: string; // ISO timestamp Open-Meteo reports the reading for
}

async function geocode(locationName: string, signal?: AbortSignal): Promise<{ lat: number; lon: number; label: string } | null> {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", locationName);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo geocoding returned ${res.status}`);
  const data = (await res.json()) as {
    results?: { latitude: number; longitude: number; name: string; admin1?: string; country?: string }[];
  };
  const first = data.results?.[0];
  if (!first) return null;
  const label = [first.name, first.admin1, first.country].filter(Boolean).join(", ");
  return { lat: first.latitude, lon: first.longitude, label };
}

async function fetchCurrentConditions(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<Omit<WeatherResult, "resolvedLocation">> {
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code"
  );

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo forecast returned ${res.status}`);
  const data = (await res.json()) as {
    current?: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      wind_speed_10m: number;
      precipitation: number;
      weather_code: number;
    };
  };
  if (!data.current) throw new Error("Open-Meteo forecast response missing `current`");

  return {
    conditionText: WMO_CONDITIONS[data.current.weather_code] ?? "conditions unavailable",
    temperatureC: data.current.temperature_2m,
    feelsLikeC: data.current.apparent_temperature,
    humidityPercent: data.current.relative_humidity_2m,
    windKph: data.current.wind_speed_10m,
    precipitationMm: data.current.precipitation,
    observedAt: data.current.time,
  };
}

// Returns null on ANY failure (location not found, network error, malformed
// response) — the caller's job is to tell the user honestly that live
// weather isn't available right now, never to fall back to a guessed number.
export async function getWeather(locationName: string, signal?: AbortSignal): Promise<WeatherResult | null> {
  try {
    const place = await geocode(locationName, signal);
    if (!place) return null;
    const conditions = await fetchCurrentConditions(place.lat, place.lon, signal);
    return { resolvedLocation: place.label, ...conditions };
  } catch (err) {
    console.error("[weather] Open-Meteo lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
