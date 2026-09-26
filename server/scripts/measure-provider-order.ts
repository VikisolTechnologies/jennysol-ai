// Real, live measurement for VIKISOL-MASTER-CONTEXT.md §11 decision #10 — "measure p50/p95
// latency and the local share before and after on the 20-prompt routing set, and write down the
// result." Same 20 prompts as JENNYSOL-CURRENT-STATE.md §5. Runs each prompt through the REAL
// routeChatCompletion twice — once with LLM_LOCAL_FIRST_ENABLED unset (today's behavior), once
// with it set to "true" — against real Gemini and the real local Ollama fleet, no mocks.
//
// Run from server/: set -a; source .env; set +a; npx tsx scripts/measure-provider-order.ts
import { classifyTask } from "../src/services/models/modelRegistry.js";
import { routeChatCompletion } from "../src/services/modelRouter.js";

const PROMPTS = [
  "Hi", "thanks!", "What's the weather like in Hyderabad today?", "What time is it right now?",
  "Who won the cricket world cup in 2023?", "What's the latest news about the stock market?",
  "Write a Python function to reverse a linked list", "Debug this JavaScript error: TypeError undefined",
  "Refactor this React component to use hooks", "Walk me through your reasoning step by step for this logic puzzle",
  "Prove that the square root of 2 is irrational", "Think through the tradeoffs of microservices vs monolith",
  "Find me a badminton game tonight in Gachibowli", "Apply me to the top matching job",
  "Summarize this document for me", "What's a good recipe for butter chicken?", "Tell me a joke",
  "Explain quantum entanglement in simple terms", "Compare AWS vs GCP for a startup", "ok",
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function runConfig(label: string, localFirstEnabled: boolean) {
  // effectiveChainOverride() reads process.env at call time, not import time — no module reload
  // needed, just flip the flag between the two passes.
  if (localFirstEnabled) process.env.LLM_LOCAL_FIRST_ENABLED = "true";
  else delete process.env.LLM_LOCAL_FIRST_ENABLED;

  const latencies: number[] = [];
  let localCount = 0;
  let errorCount = 0;
  const perPrompt: Array<{ prompt: string; capability: string; providerUsed: string; ms: number }> = [];

  for (const prompt of PROMPTS) {
    const capability = classifyTask(prompt);
    const t0 = Date.now();
    try {
      const result = await routeChatCompletion("You are a helpful assistant.", [{ role: "user", content: prompt }], () => {}, undefined, capability);
      const ms = Date.now() - t0;
      latencies.push(ms);
      if (result.providerUsed === "ollama") localCount++;
      perPrompt.push({ prompt, capability, providerUsed: result.providerUsed, ms });
      console.log(`  [${label}] ${capability.padEnd(24)} ${result.providerUsed.padEnd(8)} ${ms}ms  "${prompt.slice(0, 40)}"`);
    } catch (err) {
      errorCount++;
      console.log(`  [${label}] ${capability.padEnd(24)} ERROR "${prompt.slice(0, 40)}" — ${err instanceof Error ? err.message : err}`);
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    label,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    localSharePct: Math.round((localCount / PROMPTS.length) * 100),
    errorCount,
    perPrompt,
  };
}

async function main() {
  console.log(`Measuring ${PROMPTS.length} prompts, two configurations, real live calls...\n`);
  const before = await runConfig("BEFORE (today's default)", false);
  console.log("");
  const after = await runConfig("AFTER (LLM_LOCAL_FIRST_ENABLED=true)", true);

  console.log("\n=== RESULT ===");
  console.log(`BEFORE: p50=${before.p50}ms p95=${before.p95}ms local_share=${before.localSharePct}% errors=${before.errorCount}`);
  console.log(`AFTER:  p50=${after.p50}ms p95=${after.p95}ms local_share=${after.localSharePct}% errors=${after.errorCount}`);
  console.log(JSON.stringify({ before, after }));
}
void main();
