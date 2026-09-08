import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getWeather } from "./weatherProvider.js";

const GEOCODE_RESPONSE = {
  results: [{ latitude: 16.3, longitude: 80.43, name: "Guntur", admin1: "Andhra Pradesh", country: "India" }],
};
const FORECAST_RESPONSE = {
  current: {
    time: "2026-09-08T03:30",
    temperature_2m: 31.2,
    apparent_temperature: 35.6,
    relative_humidity_2m: 68,
    wind_speed_10m: 9.4,
    precipitation: 0,
    weather_code: 2,
  },
};

describe("getWeather (Open-Meteo)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const str = url.toString();
        if (str.includes("geocoding-api")) {
          return new Response(JSON.stringify(GEOCODE_RESPONSE), { status: 200 });
        }
        return new Response(JSON.stringify(FORECAST_RESPONSE), { status: 200 });
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("resolves a location and returns real, non-invented current conditions", async () => {
    const result = await getWeather("Guntur");
    expect(result).not.toBeNull();
    expect(result!.resolvedLocation).toBe("Guntur, Andhra Pradesh, India");
    expect(result!.temperatureC).toBe(31.2);
    expect(result!.feelsLikeC).toBe(35.6);
    expect(result!.humidityPercent).toBe(68);
    expect(result!.conditionText).toBe("partly cloudy");
  });

  it("returns null (never invents data) when the location can't be geocoded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }))
    );
    const result = await getWeather("Nonexistentville");
    expect(result).toBeNull();
  });

  it("returns null (never invents data) on a network/HTTP failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("error", { status: 500 }))
    );
    const result = await getWeather("Guntur");
    expect(result).toBeNull();
  });
});
