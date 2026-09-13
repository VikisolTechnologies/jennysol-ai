// Phase 8 of docs/AI_AGENT_IMPLEMENTATION_PLAN.md: a real command-execution tool, bounded,
// output-capturing, secret-redacting. This is a genuine security surface (the founding directive's
// own §36/§37 apply directly) — the design choices below are deliberate, not the minimum that
// happens to work:
//
// - execFile with an argv array, never a shell string. There is no `command: string` accepted
//   anywhere in this module — only (binary, args[]) — so shell metacharacter injection
//   ("; rm -rf" etc.) has no syntax to exploit in the first place, not merely a check to bypass.
// - A real ALLOW-LIST (binary -> permitted first-argument subcommands), not a blocklist. Anything
//   not explicitly listed is refused. The list is deliberately small: enough for a Coder/QA agent to
//   verify its own work (run a test suite, install what it just declared as a dependency), nothing
//   that reads environment/secrets (no `env`, no arbitrary `node -e`), rewrites git history, or
//   reaches further than npm's own install step already does.
// - Routed through the exact same propose -> approve -> execute gate as file.write
//   (agentToolRegistry.ts) — running a command is at least as consequential as writing a file, so it
//   gets the same approval discipline, not a lighter one.
// - Bounded: a hard wall-clock timeout, a captured-output size cap, and cwd confined to the same
//   WORKSPACE_ROOT every file tool already respects (agentWorkspace.ts) — never this repo's own
//   tree as the *target* for a test run of this tool itself (see agentCommandTool.test.ts's own
//   isolated fixture project, matching this phase's own stated test requirement).
import { execFile, type ExecFileException } from "node:child_process";
import { getAgent, hasPermission } from "./agentRegistry.js";
import { appendSessionEvent } from "./sessionEventBus.js";
import { resolveInWorkspace, AgentWorkspaceError } from "./agentWorkspace.js";

// Command output is unstructured free text, not the object shapes memoryScope.ts's redactSecrets()
// was built for — read that function's actual implementation before relying on it here (per this
// phase's own audit requirement: "don't just trust the redaction utility works here because it
// works elsewhere") and confirmed it only replaces a STRING VALUE when the *entire* string is a bare
// JWT; it does nothing for a secret embedded inside a larger blob (a ".env"-style line, a
// "Authorization: Bearer ..." line buried in a log). A captured stdout/stderr blob needs
// substring-level scrubbing instead, so this is new, purpose-built redaction for this tool only —
// memoryScope.ts itself is left unmodified, since its existing callers all pass structured objects
// and are unaffected by (and don't need) this.
const SECRET_LINE_PATTERN = /^(.*(?:token|secret|password|passwd|credential|authorization|api[_-]?key)[^=:\n]*[=:]\s*).+$/gim;
const JWT_SUBSTRING_PATTERN = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function redactOutputText(text: string): string {
  return text.replace(SECRET_LINE_PATTERN, "$1[redacted]").replace(JWT_SUBSTRING_PATTERN, "[redacted]");
}

export class AgentCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentCommandError";
  }
}

// binary -> allowed first-argument subcommands. A binary with an empty array means it takes no
// subcommand restriction beyond being on this list at all (none currently defined that way, kept
// explicit rather than implicit).
const ALLOWED_COMMANDS: Record<string, string[]> = {
  npm: ["test", "run", "install", "ci", "--version"],
  node: ["--version"],
};

const MAX_OUTPUT_BYTES = 100_000;
const DEFAULT_TIMEOUT_MS = 30_000;

function assertAllowed(command: string, args: string[]): void {
  const allowedFirstArgs = ALLOWED_COMMANDS[command];
  if (!allowedFirstArgs) {
    throw new AgentCommandError(`Command "${command}" is not on the allow-list`);
  }
  const firstArg = args[0];
  if (!firstArg || !allowedFirstArgs.includes(firstArg)) {
    throw new AgentCommandError(`"${command} ${firstArg ?? ""}" is not on the allow-list`.trim());
  }
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) return { text, truncated: false };
  return { text: text.slice(0, MAX_OUTPUT_BYTES), truncated: true };
}

export interface CommandResult {
  // null only when the process never produced a real exit code at all (spawn failure, killed by
  // timeout) — a real, non-zero exit from a command that ran (e.g. a failing test suite) is a
  // normal, valid result, not an error this tool throws.
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

// Module-private in spirit, but exported for agentToolRegistry.ts's approveAgentAction to call —
// there is no OTHER exported way to actually run a command; proposeAgentAction/approveAgentAction is
// the only public path, matching executeFileWrite's own structural guarantee in that file.
export async function executeCommand(
  sessionId: string,
  agentId: string,
  cwd: string,
  command: string,
  args: string[]
): Promise<CommandResult> {
  const agent = getAgent(sessionId, agentId);
  if (!agent) throw new AgentCommandError(`Agent ${agentId} not found in session ${sessionId}`);
  if (!hasPermission(agent, "exec:command")) {
    throw new AgentCommandError(`Agent ${agentId} (role ${agent.role}) lacks "exec:command" permission`);
  }
  assertAllowed(command, args);
  let resolvedCwd: string;
  try {
    resolvedCwd = resolveInWorkspace(cwd);
  } catch (err) {
    if (err instanceof AgentWorkspaceError) throw new AgentCommandError(err.message);
    throw err;
  }

  appendSessionEvent({
    sessionId,
    agentId,
    type: "tool.exec.started",
    payload: { tool: "exec.command", command, args },
  });
  const start = Date.now();

  return new Promise<CommandResult>((resolve) => {
    execFile(
      command,
      args,
      { cwd: resolvedCwd, timeout: DEFAULT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES * 2 },
      (err: ExecFileException | null, stdoutRaw, stderrRaw) => {
        const durationMs = Date.now() - start;
        const timedOut = err != null && err.killed === true && err.signal != null;
        const exitCode = err == null ? 0 : typeof err.code === "number" ? err.code : null;

        const stdoutR = truncate(redactOutputText(stdoutRaw ?? ""));
        const stderrR = truncate(redactOutputText(stderrRaw ?? ""));

        // stdout/stderr are included here — already redacted and size-bounded — because the Phase
        // 13 dashboard's command panel (architecture doc §8) renders directly from this event row;
        // nothing about output ever needs a second, separate fetch path.
        appendSessionEvent({
          sessionId,
          agentId,
          type: "tool.exec.finished",
          payload: {
            tool: "exec.command",
            command,
            args,
            ok: exitCode === 0,
            exitCode,
            durationMs,
            timedOut,
            stdout: stdoutR.text,
            stderr: stderrR.text,
            stdoutTruncated: stdoutR.truncated,
            stderrTruncated: stderrR.truncated,
          },
        });

        resolve({
          exitCode,
          timedOut,
          stdout: stdoutR.text,
          stderr: stderrR.text,
          durationMs,
          stdoutTruncated: stdoutR.truncated,
          stderrTruncated: stderrR.truncated,
        });
      }
    );
  });
}
