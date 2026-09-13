import { getHardwareProfile } from "./hardwareProfile.js";
import { needsCurrentInfo } from "../currentInfo.js";

// Every field here is either verified against ollama.com/library at the
// time this file was written, or is a cloud model already wired up
// elsewhere in this codebase (gemini.ts, deepseek.ts). None of these tags
// or sizes are invented — see JENNY_IMPLEMENTATION_STATUS.md for the
// verification pass. Re-verify with `ollama show <tag>` before trusting
// memoryRequirementGb for a model added later.
export type Provider = "gemini" | "deepseek" | "ollama";
export type TaskCapability = "general" | "coding" | "reasoning" | "currentInfoSummarization" | "embedding" | "trivial";

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
// JENNYSOL-CONTINUE.md Phase 3 routing-table audit finding: the two cloud
// entries' `capabilities` arrays below are NEVER actually consulted by any
// real routing decision — confirmed by tracing every call site. Cloud
// provider selection happens entirely in modelRouter.ts's own resolveChain()
// against ITS OWN separate REGISTRY (name/provider/configured() only,
// chain-order-based, already self-documented there as "no capability-scored
// cloud selection exists"); modelsFor() (the only reader of `capabilities`
// anywhere in this file) is only ever called from pickOllamaModel(), which
// immediately filters to `provider === "ollama"`. So these two arrays are
// accurate as a description of what each cloud model is good at, but
// decorative as data — nothing routes a coding request to DeepSeek
// *because* its capabilities list "coding". Not a bug (the underlying
// design choice is deliberate and documented in modelRouter.ts), but worth
// knowing before assuming a capability tag here changes real behavior for
// a cloud entry the way it does for an Ollama one.
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
  // JENNYSOL-CONTINUE.md Phase 3 routing-table audit finding: this entry
  // can never actually be selected by pickOllamaModel() under the current
  // registry, for any capability — confirmed directly (general → qwen3:8b,
  // trivial → qwen3:4b, coding → qwen2.5-coder:7b, reasoning →
  // deepseek-r1:7b, every time, on this hardware profile). It only claims
  // "general," and qwen3:8b's higher qualityClass always wins that pool.
  // Not installed on this Mac either (confirmed via `ollama list`). Its one
  // real remaining role is as the string default for OLLAMA_MODEL
  // (ollama.ts, .env.example) — a last-resort path that only fires if
  // pickOllamaModel() ever returns undefined entirely, which requires the
  // registry to have zero enabled, hardware-fitting "general" candidates —
  // not a real condition today. Kept registered (rather than deleted)
  // specifically so that unreachable-in-practice fallback string still
  // points at a real, license-verified, hardware-checked entry rather than
  // an unregistered, unverified model name, should it ever actually fire.
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
    // "trivial" added per JENNYSOL-CONTINUE.md Phase 3 — this is the
    // dedicated small/fast tier a short, low-stakes message should reach;
    // previously nothing ever routed here, since classifyTask() had no
    // "trivial" signal and every non-coding/reasoning/current-info message
    // fell to plain "general", which always outranks this model on quality.
    capabilities: ["general", "currentInfoSummarization", "trivial"],
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
    // Dual license, not plain MIT: DeepSeek's own README (github.com/deepseek-ai/DeepSeek-R1,
    // section 7) states the distillation code is MIT, but each distilled checkpoint stays
    // under its base model's license — this tag is distilled onto Qwen2.5-7B, so Apache 2.0
    // (Qwen2.5's license) also applies to the weights. Verified 2026-09-11 — see
    // JENNY_MODEL_LICENSE_MATRIX.md. (A Llama-based R1 distill would instead carry the Llama
    // Community License underneath — this tag deliberately isn't that one.)
    license: "MIT (DeepSeek) + Apache 2.0 (Qwen2.5 base)",
    requiresDedicatedServer: false,
    enabled: true,
  },
  // A nomic-embed-text (Ollama) entry lived here previously — removed
  // (JENNYSOL-CONTINUE.md Phase 6: "remove the dormant Ollama nomic
  // embedding path so nobody rediscovers it as a live option later").
  // The real, active RAG embedding pipeline is server/src/services/
  // embeddings.ts (Xenova/all-MiniLM-L6-v2, in-process ONNX, unrelated to
  // Ollama) — this entry was never wired into it and no code path ever
  // selected it. Confirmed via `ollama list` it was never actually pulled
  // on this Mac in the first place — nothing to clean up on disk.

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
    license: "MIT (DeepSeek) + Apache 2.0 (Qwen2.5 base)",
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

// Deliberately narrow: cheaply-detectable signals only, everything else
// falls to "general". A broader classifier (vision, etc.) would need real
// signal this app doesn't have yet — see modelRouter.ts's own comment on
// why capability-scored routing stays bounded to what's actually
// detectable rather than invented.
const CODING_PATTERN =
  /```|\b(function|class \w+|component|refactor|debug(ging)?|stack ?trace|regex|algorithm|compile|syntax error|write (a|an|some) (script|function|program|code)|css|sql query|api endpoint|typescript|javascript|python script)\b/i;

// JENNYSOL-CONTINUE.md Phase 3: classifyTask() previously had NO signal for
// "reasoning" at all — every message fell through to "general" or "coding"
// regardless of content, so a reasoning-tagged model could never be reached
// by real chat traffic no matter what pickOllamaModel() did with it. This
// follows the exact same style already established for CODING_PATTERN
// above and needsCurrentInfo() (currentInfo.ts) — a same-kind heuristic,
// not a new architectural approach — matched against explicit
// reasoning-request language rather than topic keywords, to keep false
// positives (an ordinary question landing on the slower reasoning model
// for no reason) low.
const REASONING_PATTERN =
  /\b(step[ -]by[ -]step|reason(ing)? through|think through|prove that|walk me through your reasoning|chain of thought|solve this (logic )?puzzle|explain your reasoning|logically deduce)\b/i;

// A short message that didn't match anything more specific above (current
// info, reasoning, coding all get first refusal — order matters here) has
// no real need for the higher-quality "capable" tier's extra latency. Word
// count, not character count, since "no", "thanks!", and "sounds good" are
// all genuinely trivial at very different lengths.
const TRIVIAL_MAX_WORDS = 6;

export function classifyTask(message: string): TaskCapability {
  if (needsCurrentInfo(message)) return "currentInfoSummarization";
  if (REASONING_PATTERN.test(message)) return "reasoning";
  if (CODING_PATTERN.test(message)) return "coding";
  if (message.trim().split(/\s+/).filter(Boolean).length <= TRIVIAL_MAX_WORDS) return "trivial";
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

// JENNYSOL-CONTINUE.md Phase 3, the real bug: qwen3:8b's own capabilities
// list includes "reasoning" alongside "general" (it's a real, if lesser,
// reasoning performer) — so it was ALWAYS a candidate for a "reasoning"
// request too, and once quality tied against deepseek-r1:7b (both
// "capable"), the latency tie-break picked qwen3:8b every time, since a
// generalist tuned for fast chat naturally outranks a model built to spend
// time thinking. Confirmed live before this fix: pickOllamaModel("reasoning")
// returned qwen3:8b, never deepseek-r1:7b, no matter what. A model that
// doesn't also claim "general" is, by construction, a dedicated specialist
// for whatever it does claim — this tier makes a real specialist always
// outrank a generalist that merely also lists the same capability, before
// quality/latency ever get a vote. No-op for capability === "general"
// itself: every general-capable entry trivially includes "general", so
// they all tie here and fall through to quality/latency exactly as before.
function specificityRank(entry: ModelEntry): number {
  return entry.capabilities.includes("general") ? 0 : 1;
}

function bestOf(candidates: ModelEntry[]): ModelEntry | undefined {
  return [...candidates].sort(
    (a, b) =>
      specificityRank(b) - specificityRank(a) ||
      QUALITY_RANK[b.qualityClass] - QUALITY_RANK[a.qualityClass] ||
      LATENCY_RANK[b.latencyClass] - LATENCY_RANK[a.latencyClass]
  )[0];
}

export function pickOllamaModel(capability: TaskCapability): ModelEntry | undefined {
  const specific = modelsFor(capability).filter((m) => m.provider === "ollama");
  if (specific.length > 0) return bestOf(specific);
  return bestOf(modelsFor("general").filter((m) => m.provider === "ollama"));
}
