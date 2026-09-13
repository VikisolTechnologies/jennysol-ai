import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";
import { spawnAgent } from "./agentRegistry.js";
import { getSessionEventsAfter } from "./sessionEventBus.js";

// Isolated real fixture projects, never this repo's own codebase as the target (this phase's own
// explicit test requirement) — AGENT_WORKSPACE_ROOT must be set synchronously before the dynamic
// import below, same reasoning as agentToolRegistry.test.ts (the workspace root is resolved once,
// at agentWorkspace.ts's own module load time).
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "agent-command-tool-test-"));
process.env.AGENT_WORKSPACE_ROOT = tmpRoot;

function makeFixtureProject(name: string, testScript: string) {
  const dir = path.join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, scripts: { test: testScript } }, null, 2));
}
makeFixtureProject("fixture-pass", "echo hello-from-fixture");
makeFixtureProject("fixture-fail", "exit 1");
makeFixtureProject("fixture-secret", "echo API_KEY=sk-fake-secret-1234567890");

afterAll(() => {
  delete process.env.AGENT_WORKSPACE_ROOT;
  rmSync(tmpRoot, { recursive: true, force: true });
});

const { executeCommand, AgentCommandError } = await import("./agentCommandTool.js");

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("agentCommandTool", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = makeUser();
    sessionId = sessionStore.createSession({ userId, objective: "test" }).id;
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

  describe("allow-list — argv array, no shell, real refusals", () => {
    it("refuses a binary that isn't on the allow-list at all", async () => {
      const agent = spawnAgent(sessionId, "coder");
      await expect(executeCommand(sessionId, agent.id, ".", "rm", ["-rf", "/"])).rejects.toThrow(AgentCommandError);
    });

    it("refuses an allowed binary with a disallowed subcommand", async () => {
      const agent = spawnAgent(sessionId, "coder");
      await expect(executeCommand(sessionId, agent.id, ".", "npm", ["publish"])).rejects.toThrow(AgentCommandError);
    });

    it("treats shell metacharacters as an inert literal argument, not a second command — there is no shell to interpret them", async () => {
      const agent = spawnAgent(sessionId, "coder");
      // If this were ever run through a shell, this payload would try to run `id` after the real
      // command. With execFile + an argv array there is no shell grammar at all — this is passed to
      // npm as one literal, meaningless argument string and fails harmlessly.
      const result = await executeCommand(sessionId, agent.id, "fixture-pass", "npm", [
        "test",
        "; id; echo pwned",
      ]);
      expect(result.stdout).not.toContain("uid=");
    });
  });

  describe("permission gating", () => {
    it("refuses an agent without exec:command permission", async () => {
      const agent = spawnAgent(sessionId, "coder", { permissions: ["file:read"] });
      await expect(executeCommand(sessionId, agent.id, "fixture-pass", "npm", ["test"])).rejects.toThrow(
        AgentCommandError
      );
    });
  });

  describe("workspace boundary", () => {
    it("refuses a cwd that escapes the workspace root", async () => {
      const agent = spawnAgent(sessionId, "coder");
      await expect(executeCommand(sessionId, agent.id, "../../../etc", "npm", ["--version"])).rejects.toThrow(
        AgentCommandError
      );
    });
  });

  describe("real command execution — a real fixture project, not this repo", () => {
    it("runs a real passing command and captures real stdout/exit-code/duration", async () => {
      const agent = spawnAgent(sessionId, "coder");
      const result = await executeCommand(sessionId, agent.id, "fixture-pass", "npm", ["test"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello-from-fixture");
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.timedOut).toBe(false);

      const events = getSessionEventsAfter(sessionId, 0);
      expect(events.map((e) => e.type)).toEqual(["tool.exec.started", "tool.exec.finished"]);
      expect(events[1].payload).toMatchObject({ tool: "exec.command", ok: true, exitCode: 0 });
    }, 15_000);

    it("a real failing command resolves normally with the real non-zero exit code — never thrown as a JS error", async () => {
      const agent = spawnAgent(sessionId, "coder");
      const result = await executeCommand(sessionId, agent.id, "fixture-fail", "npm", ["test"]);

      expect(result.exitCode).not.toBe(0);
      const events = getSessionEventsAfter(sessionId, 0);
      expect(events[1].payload).toMatchObject({ tool: "exec.command", ok: false });
    }, 15_000);

    it("redacts a secret-shaped value in captured output before it ever reaches an event or the returned result", async () => {
      const agent = spawnAgent(sessionId, "coder");
      const result = await executeCommand(sessionId, agent.id, "fixture-secret", "npm", ["test"]);

      expect(result.stdout).not.toContain("sk-fake-secret-1234567890");
      expect(result.stdout).toContain("[redacted]");

      const events = getSessionEventsAfter(sessionId, 0);
      const finished = JSON.stringify(events.find((e) => e.type === "tool.exec.finished")?.payload ?? {});
      expect(finished).not.toContain("sk-fake-secret-1234567890");
    }, 15_000);
  });
});
