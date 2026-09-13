// The one, shared filesystem security boundary every agent tool (file read/write — Phase 7 — and
// command execution — Phase 8) is confined to. Extracted out of agentToolRegistry.ts so this
// boundary is enforced from a single place rather than two copies that could silently drift apart —
// a real path-traversal or cwd-escape check is exactly the kind of thing that must never have a
// second, slightly different implementation.
import path from "node:path";

export class AgentWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentWorkspaceError";
  }
}

// Resolved once, at module load, from this file's own location (server/src/services/ -> repo root,
// 3 levels up) — the same import.meta.dirname-relative pattern db/index.ts already uses for its data
// directory. An autonomous agent tool escaping the repo entirely (via "../../../etc/passwd"-style
// traversal, or a stray absolute path) is exactly the kind of real security surface the founding
// directive's §36/§37 call out — bounded here structurally, not by convention. Overridable via
// AGENT_WORKSPACE_ROOT for tests only.
export const WORKSPACE_ROOT = path.resolve(
  process.env.AGENT_WORKSPACE_ROOT || path.resolve(import.meta.dirname, "../../..")
);

// A relative path resolves under WORKSPACE_ROOT; an absolute path is honored only if it's already
// inside WORKSPACE_ROOT (path.resolve leaves an absolute input unchanged relative to the base, so
// this one function correctly handles both shapes with the same escape check).
export function resolveInWorkspace(inputPath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, inputPath);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new AgentWorkspaceError(`Path "${inputPath}" escapes the agent workspace root — refused`);
  }
  return resolved;
}
