import { hasAnyConfiguredProvider } from "./modelRouter.js";
import { isOllamaAvailable } from "./providers/ollama.js";
import { hasAnySearchProviderConfigured } from "./search/searchRouter.js";

// The single authoritative list of what JennySol can do — computed live from
// the same env vars / reachability checks each capability's own code already
// uses, never a second source of truth someone has to remember to keep in
// sync. Deliberately reports state, not aspiration: "implemented" means the
// code path exists; "configured" means it has what it needs *right now*;
// "available" is the AND of both (plus, for a couple of capabilities, a
// known runtime-only block like Gemini's image-gen billing tier — see
// `detail`). Never derive a user-facing "X works" claim from source code
// existing alone; this is what routes/admin.ts's config-health endpoint
// exposes so that claim can be checked against live state instead.
export type CapabilityId =
  | "TEXT_GENERATION"
  | "CURRENT_DATE"
  | "CURRENT_TIME"
  | "TIMEZONE"
  | "WEATHER"
  | "WEB_SEARCH"
  | "CURRENT_INFORMATION"
  | "IMAGE_GENERATION"
  | "VISION"
  | "EMBEDDINGS"
  | "RAG"
  | "SPEECH_TO_TEXT"
  | "TEXT_TO_SPEECH"
  | "COMPUTER_CONTROL";

export interface CapabilityStatus {
  id: CapabilityId;
  implemented: boolean;
  // Has credentials/reachability right now — never whether it's *working*
  // (a configured-but-quota-blocked provider is configured: true, available:
  // false, with `detail` explaining why; see IMAGE_GENERATION below).
  configured: boolean;
  available: boolean;
  provider: string | null;
  requiresKey: boolean;
  free: boolean;
  selfHosted: boolean;
  modelIndependent: boolean;
  detail?: string;
}

export function getCapabilityRegistry(): CapabilityStatus[] {
  const textGenConfigured = hasAnyConfiguredProvider();
  const searchConfigured = hasAnySearchProviderConfigured();
  const geminiKeyPresent = !!process.env.GEMINI_API_KEY;
  const ollamaReachable = isOllamaAvailable();

  return [
    {
      id: "TEXT_GENERATION",
      implemented: true,
      configured: textGenConfigured,
      available: textGenConfigured,
      provider: "gemini | deepseek | ollama",
      requiresKey: true,
      free: ollamaReachable,
      selfHosted: ollamaReachable,
      modelIndependent: true,
    },
    {
      id: "CURRENT_DATE",
      implemented: true,
      configured: true,
      available: true,
      provider: "server clock (dateTime.ts)",
      requiresKey: false,
      free: true,
      selfHosted: true,
      modelIndependent: true,
    },
    {
      id: "CURRENT_TIME",
      implemented: true,
      configured: true,
      available: true,
      provider: "server clock (dateTime.ts)",
      requiresKey: false,
      free: true,
      selfHosted: true,
      modelIndependent: true,
    },
    {
      id: "TIMEZONE",
      implemented: true,
      configured: true,
      available: true,
      provider: "browser Intl (X-Timezone header)",
      requiresKey: false,
      free: true,
      selfHosted: true,
      modelIndependent: true,
      detail: "Falls back to UTC when the client doesn't send X-Timezone.",
    },
    {
      id: "WEATHER",
      implemented: true,
      configured: true,
      available: true,
      provider: "open-meteo",
      requiresKey: false,
      free: true,
      selfHosted: false,
      modelIndependent: true,
    },
    {
      id: "WEB_SEARCH",
      implemented: true,
      configured: searchConfigured,
      available: searchConfigured,
      provider: process.env.SEARXNG_BASE_URL ? "searxng" : process.env.TAVILY_API_KEY ? "tavily" : null,
      requiresKey: true,
      free: true,
      selfHosted: !!process.env.SEARXNG_BASE_URL,
      modelIndependent: true,
      detail: searchConfigured ? undefined : "Set TAVILY_API_KEY or SEARXNG_BASE_URL.",
    },
    {
      id: "CURRENT_INFORMATION",
      implemented: true,
      configured: searchConfigured,
      available: searchConfigured,
      provider: "reuses WEB_SEARCH",
      requiresKey: true,
      free: true,
      selfHosted: !!process.env.SEARXNG_BASE_URL,
      modelIndependent: true,
      detail: searchConfigured
        ? undefined
        : "No search provider configured — the model is instructed to say it can't verify rather than guess.",
    },
    {
      id: "IMAGE_GENERATION",
      implemented: true,
      configured: geminiKeyPresent,
      available: false,
      provider: "gemini",
      requiresKey: true,
      free: false,
      selfHosted: false,
      modelIndependent: false,
      detail: geminiKeyPresent
        ? "Blocked by a zero-quota billing tier on the configured Gemini key (confirmed via production logs, not a code bug)."
        : "GEMINI_API_KEY not set.",
    },
    {
      id: "VISION",
      implemented: false,
      configured: false,
      available: false,
      provider: null,
      requiresKey: true,
      free: false,
      selfHosted: false,
      modelIndependent: false,
      detail: "Not implemented — no vision/image-understanding code path exists yet.",
    },
    {
      id: "EMBEDDINGS",
      implemented: true,
      configured: true,
      available: true,
      provider: "local ONNX (Xenova/all-MiniLM-L6-v2)",
      requiresKey: false,
      free: true,
      selfHosted: true,
      modelIndependent: true,
    },
    {
      id: "RAG",
      implemented: true,
      configured: true,
      available: true,
      provider: "SQLite + local embeddings",
      requiresKey: false,
      free: true,
      selfHosted: true,
      modelIndependent: true,
    },
    {
      id: "SPEECH_TO_TEXT",
      implemented: true,
      configured: true,
      available: true,
      provider: "browser Web Speech API",
      requiresKey: false,
      free: true,
      selfHosted: false,
      modelIndependent: true,
      detail: "Client-side only — nothing server-side to configure.",
    },
    {
      id: "TEXT_TO_SPEECH",
      implemented: true,
      configured: geminiKeyPresent,
      available: geminiKeyPresent,
      provider: "gemini",
      requiresKey: true,
      free: false,
      selfHosted: false,
      modelIndependent: false,
      detail: "Consumes Gemini quota. Future self-hosted path: Kokoro or Piper on the RTX 5060 Ti server.",
    },
    {
      id: "COMPUTER_CONTROL",
      implemented: false,
      configured: false,
      available: false,
      provider: null,
      requiresKey: false,
      free: false,
      selfHosted: false,
      modelIndependent: false,
      detail: "Not implemented — planned future capability, no code exists yet.",
    },
  ];
}
