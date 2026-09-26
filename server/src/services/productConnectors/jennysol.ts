// JENNYSOL-ARCHITECTURE.md §5 — JennySol's own first-party tools, exposed through the SAME
// ProductConnector interface every other product's tools use (ADR-002: the tool registry never
// knows a product by name beyond its own connector). "jennysol" here means "using your own
// JennySol account, not through another product's gateway" — the Agent Runtime (§3) is its first
// real caller. Every tool here wraps an existing, already-tested capability; none of these are
// new capability work, only new tool-calling surface for the model to reach them through.
import { search, hasAnySearchProviderConfigured } from "../search/searchRouter.js";
import { getWeather } from "../weather/weatherProvider.js";
import { getCurrentDateTimeResponse } from "../dateTime.js";
import type { ProductConnector, RegisteredTool } from "../tools/productConnector.js";
import type { ProductIdentity } from "../productIdentity.js";

type Json = Record<string, unknown>;

async function webSearch(_identity: ProductIdentity, args: Json): Promise<unknown> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) throw new Error("webSearch needs a query");
  const outcome = await search(query);
  if (!outcome) return { results: [], note: "No search provider is configured right now." };
  return { results: outcome.results.slice(0, 8), provider: outcome.providerUsed };
}

async function currentWeather(_identity: ProductIdentity, args: Json): Promise<unknown> {
  const location = typeof args.location === "string" ? args.location.trim() : "";
  if (!location) throw new Error("getWeather needs a location");
  const result = await getWeather(location);
  if (!result) throw new Error(`Couldn't get weather for "${location}" right now`);
  return result;
}

async function currentDateTime(_identity: ProductIdentity, args: Json): Promise<unknown> {
  const timezone = typeof args.timezone === "string" ? args.timezone : "UTC";
  const kind = args.kind === "date" ? "date" : "time";
  const location = typeof args.location === "string" && args.location.trim() ? args.location.trim() : null;
  // Reuses the exact same deterministic responder chatRunner.ts's own pre-tool-calling
  // fast-path already uses for this — one function, several callers, never two implementations.
  return { text: getCurrentDateTimeResponse({ kind, location }, timezone) };
}

export const jennysolConnector: ProductConnector = {
  product: "jennysol",

  getTools(): RegisteredTool[] {
    const tools: RegisteredTool[] = [
      {
        name: "jennysol.currentDateTime",
        description: "The current date or time, in the user's timezone or a named city.",
        parameters: {
          type: "object",
          properties: {
            timezone: { type: "string", description: "IANA timezone, e.g. Asia/Kolkata — used when no location is given." },
            location: { type: "string", description: "A named city, e.g. 'Tokyo' — overrides timezone when given." },
            kind: { type: "string", enum: ["time", "date"], description: "Default 'time'." },
          },
          required: [],
        },
        tier: "READ",
        risk: "low",
        execute: currentDateTime,
      },
      {
        name: "jennysol.getWeather",
        description: "Current weather for a named place.",
        parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
        tier: "READ",
        risk: "low",
        execute: currentWeather,
      },
    ];
    if (hasAnySearchProviderConfigured()) {
      tools.push({
        name: "jennysol.webSearch",
        description: "Searches the web for current information and returns titled results with URLs.",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        tier: "READ",
        risk: "low",
        execute: webSearch,
      });
    }
    return tools;
  },

  // Always reachable — these are JennySol's own capabilities, not a connection to an external
  // product that could be unconfigured (same reasoning capabilityRegistry.ts already gives for
  // weather/date-time being modelIndependent/always-on).
  configured(): boolean {
    return true;
  },
};
