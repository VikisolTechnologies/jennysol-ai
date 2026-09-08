import { getHardwareProfile } from "./hardwareProfile.js";
import { needsCurrentInfo } from "../currentInfo.js";

// Every field here is either verified against ollama.com/library at the
// time this file was written, or is a cloud model already wired up
// elsewhere in this codebase (gemini.ts, deepseek.ts). None of these tags
// or sizes are invented — see JENNY_IMPLEMENTATION_STATUS.md for the
// verification pass. Re-verify with `ollama show <tag>` before trusting
// memoryRequirementGb for a model added later.
export type Provider = "gemini" | "deepseek" | "ollama";
export type TaskCapability = "general" | "coding" | "reasoning" | "currentInfoSummarization" | "embedding";

export interface ModelEntry {
  provider: Provider;
  modelId: string; // the exact string passed to the provider's API (Ollama tag, or cloud model id)
  displayName: string;
  localOrCloud: "local" | "cloud";
  capabilities: TaskCapability[];
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  contextWindow: number;
  // GB, approximate resident memory for a single loaded instance —
  // verified against the provider's own published size where local
  // (Ollama), not applicable (0) for cloud. This is what
  // fitsHardware() checks against the active HardwareProfile's
  // maxSingleModelGb — never inferred from parameter count alone.
  memoryRequirementGb: number;
  costClass: "free" | "low" | "medium" | "high";
  latencyClass: "fast" | "medium" | "slow";
  qualityClass: "basic" | "capable" | "frontier";
  license: string;
  requiresDedicatedServer: boolean;
  enabled: boolean;
}

// Curated, not exhaustive — see modelRouter.ts's REGISTRY comment for the
// same philosophy applied to providers: adding a model later is a new
// entry here (plus, for Ollama, actually pulling it), not a redesign.
export const MODEL_REGISTRY: ModelEntry[] = [
  // ---- Cloud (already live in this app; see providers/gemini.ts, deepseek.ts) ----
  {
    provider: "gemini",
    modelId: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    displayName: "Gemini",
    localOrCloud: "cloud",
    capabilities: ["general", "coding", "reasoning", "currentInfoSummarization"],
    supportsToolCalling: true,
    supportsStreaming: true,
    contextWindow: 1_000_000,
    memoryRequirementGb: 0,
    costClass: "low",
    latencyClass: "fast",
    qualityClass: "capable",
    license: "proprietary",
    requiresDedicatedServer: false,
    enabled: true,
  },
  {
    provider: "deepseek",
    modelId: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    displayName: "DeepSeek",
    localOrCloud: "cloud",
    capabilities: ["general", "coding", "reasoning", "currentInfoSummarization"],
    supportsToolCalling: false,
    supportsStreaming: true,
    contextWindow: 128_000,
    memoryRequirementGb: 0,
    costClass: "low",
    latencyClass: "fast",
    qualityClass: "capable",
    license: "proprietary",
    requiresDedicatedServer: false,
    enabled: true,
  },

  // ---- Local (Ollama) — sizes verified via ollama.com/library ----
  {
    provider: "ollama",
    modelId: "llama3.2:3b",
    displayName: "Llama 3.2 3B",
    localOrCloud: "local",
    capabilities: ["general"],
    supportsToolCalling: true,
    supportsStreaming: true,
    contextWindow: 128_000,
    memoryRequirementGb: 2.0,
    costClass: "free",
    latencyClass: "fast",
    qualityClass: "basic",
    license: "Llama 3.2 Community License",
    requiresDedicatedServer: false,
    enabled: true,
  },
  {
    provider: "ollama",
    modelId: "qwen3:4b",
    displayName: "Qwen3 4B",
    localOrCloud: "local",
    capabilities: ["general", "currentInfoSummarization"],
    supportsToolCalling: true,
    supportsStreaming: true,
    contextWindow: 256_000,
    memoryRequirementGb: 2.5,
    costClass: "free",
    latencyClass: "fast",
    qualityClass: "basic",
    license: "Apache 2.0",
    requiresDedicatedServer: false,
    enabled: true,
  },
  {
    provider: "ollama",
    modelId: "qwen3:8b",
    displayName: "Qwen3 8B",
    localOrCloud: "local",
    capabilities: ["general", "reasoning", "currentInfoSummarization"],
    supportsToolCalling: true,
    supportsStreaming: true,
    contextWindow: 40_000,
    memoryRequirementGb: 5.2,
    costClass: "free",
    latencyClass: "medium",
    qualityClass: "capable",
    license: "Apache 2.0",
    requiresDedicatedServer: false,
    enabled: true,
  },
  {
    provider: "ollama",
    modelId: "qwen2.5-coder:7b",
    displayName: "Qwen2.5 Coder 7B",
    localOrCloud: "local",
    capabilities: ["coding"],
    supportsToolCalling: true,
    supportsStreaming: true,
    contextWindow: 32_000,
    memoryRequirementGb: 4.7,
    costClass: "free",
    latencyClass: "medium",
    qualityClass: "capable",
    license: "Apache 2.0",
    requiresDedicatedServer: false,
    enabled: true,
  },
  {
    provider: "ollama",
    modelId: "deepseek-r1:7b",
    displayName: "DeepSeek-R1 7B (distilled)",
    localOrCloud: "local",
    capabilities: ["reasoning"],
    supportsToolCalling: false,
    supportsStreaming: true,
    contextWindow: 32_000,
    memoryRequirementGb: 4.7,
    costClass: "free",
    latencyClass: "slow",
    qualityClass: "capable",
    license: "MIT (Qwen-2.5 base license applies to weights)",
    requiresDedicatedServer: false,
    enabled: true,
  },
  {
    provider: "ollama",
    modelId: "nomic-embed-text",
    displayName: "Nomic Embed Text",
    localOrCloud: "local",
    capabilities: ["embedding"],
    supportsToolCalling: false,
    supportsStreaming: false,
    contextWindow: 8_192,
    memoryRequirementGb: 0.5,
    costClass: "free",
    latencyClass: "fast",
    qualityClass: "capable",
    license: "Apache 2.0",
    requiresDedicatedServer: false,
    enabled: true,
  },

  // ---- Reserved for the dedicated RTX 5060 Ti server — do not select on
  // the M1 profile even if someone flips `enabled: true` by hand; fitsHardware()
  // checks memoryRequirementGb against the active profile regardless. Sizes
  // verified the same way; add the exact pulled tag once that machine is live.
  {
    provider: "ollama",
    modelId: "qwen2.5-coder:14b",
    displayName: "Qwen2.5 Coder 14B",
    localOrCloud: "local",
    capabilities: ["coding"],
    supportsToolCalling: true,
    supportsStreaming: true,
    contextWindow: 32_000,
    memoryRequirementGb: 9.0,
    costClass: "free",
    latencyClass: "slow",
    qualityClass: "capable",
    license: "Apache 2.0",
    requiresDedicatedServer: true,
    enabled: false,
  },
  {
    provider: "ollama",
    modelId: "deepseek-r1:32b",
    displayName: "DeepSeek-R1 32B (distilled)",
    localOrCloud: "local",
    capabilities: ["reasoning"],
    supportsToolCalling: false,
    supportsStreaming: true,
    contextWindow: 32_000,
    memoryRequirementGb: 20,
    costClass: "free",
    latencyClass: "slow",
    qualityClass: "frontier",
    license: "MIT (Qwen-2.5 base license applies to weights)",
    requiresDedicatedServer: true,
    enabled: false,
  },
];

export function fitsHardware(entry: ModelEntry): boolean {
  if (entry.localOrCloud === "cloud") return true;
  const profile = getHardwareProfile();
  if (entry.requiresDedicatedServer && profile.id === "m1_16gb") return false;
  return entry.memoryRequirementGb <= profile.maxSingleModelGb;
}

export function modelsFor(capability: TaskCapability): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => m.enabled && m.capabilities.includes(capability) && fitsHardware(m));
}

export function findModel(provider: Provider, modelId: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.provider === provider && m.modelId === modelId);
}

// Deliberately narrow: two real, cheaply-detectable signals (does this need
// current info, does this look like a coding request), everything else
// falls to "general". A broader classifier (hard reasoning vs. simple,
// vision, etc.) would need real signal this app doesn't have yet — see
// modelRouter.ts's own comment on why capability-scored routing stays
// bounded to what's actually detectable rather than invented.
const CODING_PATTERN =
  /```|\b(function|class \w+|component|refactor|debug(ging)?|stack ?trace|regex|algorithm|compile|syntax error|write (a|an|some) (script|function|program|code)|css|sql query|api endpoint|typescript|javascript|python script)\b/i;

export function classifyTask(message: string): TaskCapability {
  if (needsCurrentInfo(message)) return "currentInfoSummarization";
  if (CODING_PATTERN.test(message)) return "coding";
  return "general";
}

// Best local model for a task: prefers a model whose capabilities actually
// list this task type, then the most capable quality tier that still fits
// hardware, then the fastest among ties. Falls back to "general" candidates
// if nothing matches the specific capability (e.g. no reasoning-tagged
// model fits the active hardware profile) rather than returning nothing —
// a general-purpose local model attempting a task is better than skipping
// Ollama entirely for a capability gap this narrow.
const QUALITY_RANK: Record<ModelEntry["qualityClass"], number> = { frontier: 2, capable: 1, basic: 0 };
const LATENCY_RANK: Record<ModelEntry["latencyClass"], number> = { fast: 2, medium: 1, slow: 0 };

function bestOf(candidates: ModelEntry[]): ModelEntry | undefined {
  return [...candidates].sort(
    (a, b) => QUALITY_RANK[b.qualityClass] - QUALITY_RANK[a.qualityClass] || LATENCY_RANK[b.latencyClass] - LATENCY_RANK[a.latencyClass]
  )[0];
}

export function pickOllamaModel(capability: TaskCapability): ModelEntry | undefined {
  const specific = modelsFor(capability).filter((m) => m.provider === "ollama");
  if (specific.length > 0) return bestOf(specific);
  return bestOf(modelsFor("general").filter((m) => m.provider === "ollama"));
}
