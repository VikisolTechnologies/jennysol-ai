// Live, real (not mocked) eval of the Agent Goal Run runtime — docs/JENNYSOL-EVAL-RESULTS.md
// §1. Uses real Gemini (reads .env the normal way) and a real weather API call, never mocked.
// Not part of the vitest suite on purpose: needs network + a real model, and writes real rows.
// Run it with a throwaway JENNYSOL_DB_PATH so it never touches the real data/jennysol.db:
//   JENNYSOL_DB_PATH=/tmp/live-goal-run-eval.db npx tsx scripts/live-goal-run-eval.ts
import { startRun } from "../src/services/agentRuntime/runtime.js";
import { getSteps } from "../src/services/agentRuntime/store.js";
import type { ProductIdentity } from "../src/services/productIdentity.js";

const identity: ProductIdentity = { product: "jennysol", externalUserId: "live-eval-user", scope: ["jennysol.currentDateTime", "jennysol.getWeather", "jennysol.webSearch"] };

const scenarios = [
  { goal: "What time is it right now, in UTC?", expectTool: "jennysol.currentDateTime" },
  { goal: "What's the weather in Hyderabad right now?", expectTool: "jennysol.getWeather" },
  { goal: "Explain in one sentence why the sky is blue.", expectTool: null }, // no tool needed
];

async function main() {
  let passed = 0;
  for (const s of scenarios) {
    const t0 = Date.now();
    const run = await startRun(identity, s.goal, { maxSteps: 4, maxMs: 25_000 });
    const steps = getSteps(run.id);
    const ms = Date.now() - t0;
    const toolsCalled = steps.filter((st) => st.kind === "tool_call").map((st) => st.toolName);
    const ok =
      run.status === "completed" &&
      run.content.trim().length > 0 &&
      (s.expectTool === null || toolsCalled.includes(s.expectTool));
    console.log(`${ok ? "PASS" : "FAIL"}  "${s.goal}"  status=${run.status} tools=[${toolsCalled.join(",")}] ${ms}ms`);
    console.log(`      reply: ${run.content.slice(0, 200)}`);
    if (ok) passed++;
  }
  console.log(`\n${passed}/${scenarios.length} passed`);
  process.exit(passed === scenarios.length ? 0 : 1);
}
void main();
