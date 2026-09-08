// Usage (from server/): npm run models -- list|health|benchmark|install
import "dotenv/config";
import { MODEL_REGISTRY, fitsHardware } from "../src/services/models/modelRegistry.js";
import { getHardwareSnapshot } from "../src/services/models/hardwareProfile.js";
import {
  isOllamaAvailable,
  listInstalledOllamaModels,
  isModelInstalled,
  ollamaProvider,
} from "../src/services/providers/ollama.js";
import { geminiProvider } from "../src/services/providers/gemini.js";
import { deepseekProvider } from "../src/services/providers/deepseek.js";
import { getHealthSnapshot } from "../src/services/providerHealth.js";

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

async function cmdList() {
  const hw = getHardwareSnapshot();
  console.log(`Hardware profile: ${hw.profile.id} (${hw.profile.label})\n`);
  console.log(
    pad("MODEL", 26) + pad("PROVIDER", 10) + pad("LOCAL/CLOUD", 12) + pad("SIZE", 8) +
      pad("CAPABILITIES", 34) + pad("QUALITY", 10) + pad("LATENCY", 8) + pad("LICENSE", 30) + "HW FIT"
  );
  for (const m of MODEL_REGISTRY) {
    console.log(
      pad(m.displayName, 26) +
        pad(m.provider, 10) +
        pad(m.localOrCloud, 12) +
        pad(m.localOrCloud === "local" ? `${m.memoryRequirementGb}GB` : "-", 8) +
        pad(m.capabilities.join(","), 34) +
        pad(m.qualityClass, 10) +
        pad(m.latencyClass, 8) +
        pad(m.license, 30) +
        (fitsHardware(m) ? (m.enabled ? "OK" : "disabled") : "NO (needs dedicated server)")
    );
  }
}

async function cmdHealth() {
  const hw = getHardwareSnapshot();
  console.log(`Hardware: ${hw.platform}/${hw.arch}, ${hw.totalMemoryGb}GB total, ${hw.freeMemoryGb}GB free`);
  console.log(`Active profile: ${hw.profile.id} (max single model ${hw.profile.maxSingleModelGb}GB, max concurrent local runs ${hw.profile.maxConcurrentLocalRuns})\n`);

  console.log("--- Cloud providers ---");
  console.log(`gemini:   configured=${!!process.env.GEMINI_API_KEY}`);
  console.log(`deepseek: configured=${!!process.env.DEEPSEEK_API_KEY}`);

  console.log("\n--- Local (Ollama) ---");
  const reachable = isOllamaAvailable();
  console.log(`reachable at ${process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"}: ${reachable}`);
  if (reachable) {
    try {
      const installed = await listInstalledOllamaModels();
      console.log(`installed models: ${installed.length === 0 ? "(none)" : installed.map((m) => m.name).join(", ")}`);
      console.log("\n--- Curated fleet installation status ---");
      for (const m of MODEL_REGISTRY.filter((e) => e.provider === "ollama")) {
        const isInstalled = installed.some((i) => i.name === m.modelId);
        const status = !fitsHardware(m)
          ? "REQUIRES DEDICATED SERVER"
          : isInstalled
            ? "INSTALLED"
            : "NOT INSTALLED";
        console.log(`  ${pad(m.modelId, 24)} ${status}`);
      }
    } catch (err) {
      console.log(`  failed to list installed models: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    console.log("(not reachable — install/start Ollama, or check OLLAMA_BASE_URL)");
  }

  console.log("\n--- Circuit breaker state ---");
  const snapshot = getHealthSnapshot();
  if (Object.keys(snapshot).length === 0) {
    console.log("(no recorded attempts yet this process)");
  } else {
    for (const [name, s] of Object.entries(snapshot)) {
      console.log(
        `  ${pad(name, 12)} healthy=${s.healthy} successes=${s.successCount} failures=${s.failureCount} consecutiveFailures=${s.consecutiveFailures}${
          s.cooldownUntil ? ` cooldownUntil=${new Date(s.cooldownUntil).toISOString()}` : ""
        }`
      );
    }
  }
}

async function cmdInstall() {
  const modelId = process.argv[3];
  if (!modelId) {
    console.log("Usage: npm run models -- install <ollama-model-tag>");
    console.log("Curated tags: " + MODEL_REGISTRY.filter((m) => m.provider === "ollama").map((m) => m.modelId).join(", "));
    return;
  }
  const entry = MODEL_REGISTRY.find((m) => m.provider === "ollama" && m.modelId === modelId);
  if (!entry) {
    console.log(`"${modelId}" is not in the curated registry — not installing an unverified tag automatically.`);
    console.log("Curated tags: " + MODEL_REGISTRY.filter((m) => m.provider === "ollama").map((m) => m.modelId).join(", "));
    return;
  }
  if (!fitsHardware(entry)) {
    console.log(`"${modelId}" requires more memory than the active hardware profile allows — not installing.`);
    console.log(`(${entry.memoryRequirementGb}GB needed; this profile's ceiling is set in hardwareProfile.ts)`);
    return;
  }
  if (await isModelInstalled(modelId)) {
    console.log(`"${modelId}" is already installed.`);
    return;
  }
  console.log(`This CLI does not auto-pull models (per the architecture spec: never download automatically).`);
  console.log(`Verified safe to run on this hardware. To install, run yourself:\n`);
  console.log(`  ollama pull ${modelId}`);
}

async function cmdBenchmark() {
  const PROMPT = "In one short sentence, what is 2+2?";
  const results: { provider: string; ok: boolean; firstTokenMs?: number; totalMs?: number; error?: string }[] = [];

  async function bench(
    name: string,
    stream: (onDelta: (t: string) => void) => Promise<void>
  ) {
    const start = Date.now();
    let firstTokenMs: number | undefined;
    try {
      await stream((t) => {
        if (firstTokenMs === undefined && t) firstTokenMs = Date.now() - start;
      });
      results.push({ provider: name, ok: true, firstTokenMs, totalMs: Date.now() - start });
    } catch (err) {
      results.push({ provider: name, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (process.env.GEMINI_API_KEY) {
    await bench("gemini", (onDelta) =>
      geminiProvider.streamChatCompletion("Answer briefly.", [{ role: "user", content: PROMPT }], onDelta)
    );
  } else {
    results.push({ provider: "gemini", ok: false, error: "not configured (GEMINI_API_KEY unset)" });
  }

  if (process.env.DEEPSEEK_API_KEY) {
    await bench("deepseek", (onDelta) =>
      deepseekProvider.streamChatCompletion("Answer briefly.", [{ role: "user", content: PROMPT }], onDelta)
    );
  } else {
    results.push({ provider: "deepseek", ok: false, error: "not configured (DEEPSEEK_API_KEY unset)" });
  }

  if (isOllamaAvailable()) {
    await bench("ollama", (onDelta) =>
      ollamaProvider.streamChatCompletion("Answer briefly.", [{ role: "user", content: PROMPT }], onDelta)
    );
  } else {
    results.push({ provider: "ollama", ok: false, error: "not reachable" });
  }

  console.log(`Benchmark prompt: "${PROMPT}"\n`);
  for (const r of results) {
    if (r.ok) {
      console.log(`${pad(r.provider, 10)} OK   firstTokenMs=${r.firstTokenMs ?? "?"}  totalMs=${r.totalMs}`);
    } else {
      console.log(`${pad(r.provider, 10)} SKIP ${r.error}`);
    }
  }
}

const cmd = process.argv[2];
switch (cmd) {
  case "list":
    await cmdList();
    break;
  case "health":
    await cmdHealth();
    break;
  case "install":
    await cmdInstall();
    break;
  case "benchmark":
    await cmdBenchmark();
    break;
  default:
    console.log("Usage: npm run models -- list|health|benchmark|install <tag>");
    process.exitCode = 1;
}
