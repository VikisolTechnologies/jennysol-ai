// M5 (Arena connector, PROJECT-PROGRESS.md milestone model): JennySol's implementation of
// ProductConnector for Arena — the FIRST real product connector, following the exact same
// interface every fake test connector (M3/M4's "acme"/"widgetco") already proved works. Per
// ADR-002, this file is the only place in JennySol's codebase allowed to know "Arena" exists as
// a concept — the tool registry and chat loop only ever see a generic ProductConnector.
//
// No tools registered yet — getTools() is intentionally empty. Arena's real, callable tools
// (arena.searchJobs, etc.) are M6's job, once there's a real HTTP client to Arena's own API to
// back them with. Shipping this connector now, with zero tools, proves the identity/
// configuration wiring itself is correct in isolation — exactly M5's own, narrower scope.
//
// Cross-repo interoperability was verified live during M5's own implementation: a real token
// minted by Arena's actual `AgentServiceTokenIssuer.java` (arena-api) was accepted by
// `verifyServiceToken()` below, correctly resolving to `{product: "arena", ...}`, and a tampered
// copy of that same real token was correctly rejected. That check used real Java output and
// can't be re-run automatically from this Node test suite (see arena.test.ts's own comment) —
// recorded as one-time verified evidence in PROJECT-PROGRESS.md's M5 entry, the same way this
// project already records other live-verified-once facts it can't keep re-proving in CI.
import type { ProductConnector, RegisteredTool } from "../tools/productConnector.js";

export const arenaConnector: ProductConnector = {
  product: "arena",

  getTools(): RegisteredTool[] {
    return [];
  },

  // Same "has what it needs right now" convention as every other configured() in this codebase —
  // true once SERVICE_TOKEN_SECRET_ARENA is set to the same value Arena's own
  // AgentServiceTokenIssuer signs with.
  configured(): boolean {
    return !!process.env.SERVICE_TOKEN_SECRET_ARENA;
  },
};
