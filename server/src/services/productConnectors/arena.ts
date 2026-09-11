// M5/M6 (Arena connector, PROJECT-PROGRESS.md milestone model): JennySol's implementation of
// ProductConnector for Arena — the FIRST real product connector, following the exact same
// interface every fake test connector (M3/M4's "acme"/"widgetco") already proved works. Per
// ADR-002, this file is the only place in JennySol's codebase allowed to know "Arena" exists as
// a concept — the tool registry and chat loop only ever see a generic ProductConnector.
//
// Cross-repo interoperability was verified live during M5's own implementation: a real token
// minted by Arena's actual `AgentServiceTokenIssuer.java` (arena-api) was accepted by
// `verifyServiceToken()`, correctly resolving to `{product: "arena", ...}`, and a tampered copy
// of that same real token was correctly rejected. That check used real Java output and can't be
// re-run automatically from this Node test suite (see arena.test.ts's own comment) — recorded as
// one-time verified evidence in PROJECT-PROGRESS.md's M5 entry, the same way this project already
// records other live-verified-once facts it can't keep re-proving in CI.
import type { ProductConnector, RegisteredTool, ToolExecutionContext } from "../tools/productConnector.js";
import type { ProductIdentity } from "../productIdentity.js";

// Arena's own production API by default — overridable for local dev against a different Arena
// deployment. Includes the `/api/v1` prefix: Arena's Spring Boot app sets
// `server.servlet.context-path: /api/v1` (application.yml), so every real endpoint — including
// `/jobs` — is actually served under that path, not at the bare domain root. A real, live
// end-to-end test during M6 caught this exact gap: a real Gemini call correctly decided to
// invoke this tool, but the tool's request 404'd against the wrong URL until this prefix was
// added — found by running the real flow, not by unit-testing this file in isolation (the
// mocked-fetch tests below asserted the URL they were told to expect, which was itself wrong
// until this fix). Arena's `/jobs` endpoint is unauthenticated (public, per its own
// SecurityConfig — confirmed during the original architecture investigation), so this first tool
// needs no additional Arena-side credential beyond the request itself.
const ARENA_API_BASE_URL = process.env.ARENA_API_BASE_URL || "https://api-arena.vikisol.in/api/v1";

interface ArenaApiEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
}

// M6: Arena's real GET /jobs (JobController.java) takes only `page`/`size` — no keyword/text
// search parameter exists in that endpoint today. Do not invent one: the tool's own
// name/description are honest about this real limitation rather than silently pretending a
// query the user asked about was actually filtered on Arena's side.
async function searchJobs(_identity: ProductIdentity, args: Record<string, unknown>): Promise<unknown> {
  const page = typeof args.page === "number" && args.page >= 0 ? args.page : 0;
  const size = typeof args.size === "number" && args.size > 0 ? Math.min(args.size, 50) : 20;

  const res = await fetch(`${ARENA_API_BASE_URL}/jobs?page=${page}&size=${size}`);
  if (!res.ok) {
    throw new Error(`Arena /jobs returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as ArenaApiEnvelope<unknown>;
  if (!body.success) {
    throw new Error(body.message || "Arena /jobs request failed");
  }
  return body.data;
}

// M7 (approval-controlled write tools): Arena's first WRITE tool. Real, consequential — this
// submits an actual application on the user's behalf, so ToolRegistry never calls this directly
// off a model decision; it only ever runs after routes/agentGateway.ts has routed the proposed
// call through pendingActions.ts's propose → user-approves → dispatch flow (ADR-004).
//
// Requires real Arena authentication — POST /applications (ApplicationController.java) is
// class-level @PreAuthorize("hasRole('TALENT')"), unlike the public GET /jobs above. Forwards
// `context.rawToken` — the exact service token Arena minted for this user's turn — as this
// request's own Authorization header. Arena's AgentServiceTokenAuthenticationFilter verifies it
// with the same shared secret, independently re-checks the token's own scope actually authorizes
// this specific endpoint (per ADR-003), and resolves the real Arena user before this call is
// allowed to reach ApplicationController at all — this tool is never trusted to have already
// enforced that correctly on its own.
async function applyToJob(_identity: ProductIdentity, args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
  const jobId = typeof args.jobId === "string" ? args.jobId : undefined;
  if (!jobId) {
    throw new Error("applyToJob requires a jobId");
  }

  const res = await fetch(`${ARENA_API_BASE_URL}/applications`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${context.rawToken}`,
    },
    body: JSON.stringify({ jobId }),
  });

  const body = (await res.json().catch(() => ({}))) as ArenaApiEnvelope<unknown>;
  if (!res.ok || !body.success) {
    throw new Error(body.message || `Arena application submission failed: HTTP ${res.status}`);
  }
  return body.data;
}

export const arenaConnector: ProductConnector = {
  product: "arena",

  getTools(): RegisteredTool[] {
    return [
      {
        name: "arena.searchJobs",
        description:
          "Lists currently open jobs on Arena, most recent first, with pagination. " +
          "IMPORTANT LIMITATION: Arena's job-listing API does not currently support keyword or " +
          "text search — this returns the general open-jobs feed only. Never claim the results " +
          "were filtered to match what the user asked for; if they asked for something specific " +
          "(e.g. \"React jobs\"), say honestly that Arena can't filter by keyword yet and offer " +
          "the general listing instead.",
        parameters: {
          type: "object",
          properties: {
            page: { type: "number", description: "Zero-based page number.", default: 0 },
            size: { type: "number", description: "Results per page, max 50.", default: 20 },
          },
          required: [],
        },
        tier: "READ",
        execute: searchJobs,
      },
      {
        name: "arena.applyToJob",
        description:
          "Submits a real, consequential job application on the user's behalf to a specific " +
          "Arena job posting. This will only actually run after the user explicitly approves " +
          "it — describe what you're about to do and wait for approval rather than assuming " +
          "it already happened.",
        parameters: {
          type: "object",
          properties: {
            jobId: { type: "string", description: "The Arena job posting id to apply to." },
          },
          required: ["jobId"],
        },
        tier: "WRITE",
        execute: applyToJob,
      },
    ];
  },

  // Same "has what it needs right now" convention as every other configured() in this codebase —
  // true once SERVICE_TOKEN_SECRET_ARENA is set to the same value Arena's own
  // AgentServiceTokenIssuer signs with.
  configured(): boolean {
    return !!process.env.SERVICE_TOKEN_SECRET_ARENA;
  },
};
