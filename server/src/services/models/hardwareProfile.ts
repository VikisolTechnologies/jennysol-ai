import os from "node:os";

// What actually gates which local models are safe to run — not a guess, and
// not model parameter count alone (a 14B model and an 8B model can both
// claim "runs on 16GB" depending on quantization; this profile is the
// budget the registry's own memoryRequirementGb gets checked against, see
// modelRegistry.ts's fitsHardware()).
export interface HardwareProfile {
  id: string;
  label: string;
  totalMemoryGb: number;
  // Conservative usable budget for a single loaded model — leaves headroom
  // for the OS, the JennySol Node process itself, a browser, and Ollama's
  // own overhead. Not "totalMemoryGb minus a fixed tax": macOS and Ollama
  // both already page/compress aggressively, so this is deliberately a
  // fraction of total, tuned to avoid the machine swapping under normal use
  // rather than computed from any precise accounting.
  usableMemoryGb: number;
  // Hard ceiling on a single local model's approximate memory requirement.
  // Anything above this is marked requiresDedicatedServer in the registry
  // and the router will not select it on this profile, regardless of what
  // the model's own metadata claims about "running on 16GB" — this is the
  // one number a human should tune per real observed stability, not code.
  maxSingleModelGb: number;
  maxConcurrentLocalRuns: number;
}

export const HARDWARE_PROFILES: Record<string, HardwareProfile> = {
  m1_16gb: {
    id: "m1_16gb",
    label: "Apple Silicon, 16GB unified memory",
    totalMemoryGb: 16,
    usableMemoryGb: 10,
    maxSingleModelGb: 6,
    maxConcurrentLocalRuns: 1,
  },
  dedicated_rtx5060ti_16gb: {
    id: "dedicated_rtx5060ti_16gb",
    label: "Ryzen 5 9600X / 64GB RAM / RTX 5060 Ti 16GB",
    totalMemoryGb: 64,
    // Bounded by VRAM (16GB), not system RAM — a quantized model that
    // doesn't fit the GPU spills to CPU and loses the entire point of
    // having a dedicated GPU box. Bump this once real VRAM headroom is
    // measured on the actual hardware, not before.
    usableMemoryGb: 14,
    maxSingleModelGb: 13,
    maxConcurrentLocalRuns: 2,
  },
  // Used whenever LOCAL_HARDWARE_PROFILE isn't set and detection doesn't
  // match a known profile (e.g. Railway's own container, which has no GPU
  // and isn't meant to run local models at all) — deliberately the most
  // conservative profile that still allows the smallest registry tier, so
  // an unrecognized environment fails toward "local models mostly skipped,
  // cloud providers still work" rather than crashing or guessing large.
  unknown: {
    id: "unknown",
    label: "Unrecognized hardware — conservative defaults",
    totalMemoryGb: 8,
    usableMemoryGb: 4,
    maxSingleModelGb: 3,
    maxConcurrentLocalRuns: 1,
  },
};

function detectProfileId(): string {
  const totalGb = os.totalmem() / 1024 ** 3;
  const isAppleSilicon = process.platform === "darwin" && process.arch === "arm64";
  if (isAppleSilicon && totalGb <= 18) return "m1_16gb";
  if (!isAppleSilicon && totalGb >= 48) return "dedicated_rtx5060ti_16gb";
  return "unknown";
}

// LOCAL_HARDWARE_PROFILE always wins when set — this is what makes the M1 →
// dedicated-server move a config change, not a code change: point the same
// server binary at the new profile id and the router's memory ceiling moves
// with it. Auto-detection exists so a first run without that env var set
// still fails toward something safe instead of "unknown" for no reason.
export function getHardwareProfile(): HardwareProfile {
  const configured = process.env.LOCAL_HARDWARE_PROFILE;
  if (configured && HARDWARE_PROFILES[configured]) return HARDWARE_PROFILES[configured];
  return HARDWARE_PROFILES[detectProfileId()];
}

export interface HardwareSnapshot {
  platform: string;
  arch: string;
  totalMemoryGb: number;
  freeMemoryGb: number;
  profile: HardwareProfile;
}

// The live, request-time picture — os.freemem() on macOS is a weak signal
// (the kernel holds a lot as reclaimable cache that free-looking tools
// don't count as "free"), so this is used for coarse pressure checks
// (maxLocalConcurrentRuns gating in modelRouter.ts), never as a precise
// admission-control number.
export function getHardwareSnapshot(): HardwareSnapshot {
  return {
    platform: process.platform,
    arch: process.arch,
    totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeMemoryGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    profile: getHardwareProfile(),
  };
}
