import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "../db/index.js";
import * as sessionStore from "./agentSessionStore.js";
import { spawnAgent } from "./agentRegistry.js";
import { getSessionEventsAfter } from "./sessionEventBus.js";
import { getAuditTrailForCorrelation } from "./agentAuditLog.js";

// Isolated from the real repo on purpose — this suite writes real files, so it gets its own
// throwaway workspace root rather than touching this codebase's own tree. Must be set — and the
// directory must already exist — SYNCHRONOUSLY at true module-top-level, before the dynamic import
// below: WORKSPACE_ROOT inside agentToolRegistry.ts is computed once, at that module's own load
// time, and a beforeAll() hook runs too late to affect it.
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "agent-tool-registry-test-"));
process.env.AGENT_WORKSPACE_ROOT = tmpRoot;
afterAll(() => {
  delete process.env.AGENT_WORKSPACE_ROOT;
  rmSync(tmpRoot, { recursive: true, force: true });
});

const {
  readFile,
  proposeAgentAction,
  approveAgentAction,
  rejectAgentAction,
  AgentToolError,
  __clearPendingAgentActionsForTests,
} = await import("./agentToolRegistry.js");

function makeUser() {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("agentToolRegistry", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    userId = makeUser();
    sessionId = sessionStore.createSession({ userId, objective: "test" }).id;
    __clearPendingAgentActionsForTests();
  });

  afterEach(() => {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

  describe("readFile — READ tier, executes immediately", () => {
    it("reads a real file when the agent has file:read permission", async () => {
      const agent = spawnAgent(sessionId, "coder"); // coder has file:read by default
      await fs.writeFile(path.join(tmpRoot, "hello.txt"), "hi there", "utf8");

      const content = await readFile(sessionId, agent.id, "hello.txt");
      expect(content).toBe("hi there");

      const events = getSessionEventsAfter(sessionId, 0);
      expect(events.map((e) => e.type)).toEqual(["tool.exec.started", "tool.exec.finished"]);
      expect(events[1].payload).toMatchObject({ tool: "file.read", ok: true });
    });

    it("refuses an agent without file:read permission", async () => {
      const agent = spawnAgent(sessionId, "coder", { permissions: [] }); // explicitly no permissions
      await expect(readFile(sessionId, agent.id, "hello.txt")).rejects.toThrow(AgentToolError);
    });

    it("refuses a path that escapes the workspace root", async () => {
      const agent = spawnAgent(sessionId, "coder");
      await expect(readFile(sessionId, agent.id, "../../../etc/passwd")).rejects.toThrow(AgentToolError);
    });
  });

  describe("file.write — WRITE tier, propose -> approve -> execute only", () => {
    it("does nothing until approved — a proposal alone never touches the filesystem", async () => {
      const agent = spawnAgent(sessionId, "coder");
      const action = proposeAgentAction(sessionId, agent.id, "file.write", {
        filePath: "not-yet-written.txt",
        content: "pending",
      });
      expect(action.id).toBeTruthy();
      await expect(fs.access(path.join(tmpRoot, "not-yet-written.txt"))).rejects.toThrow();
    });

    it("writes the real file only once approved, with real events for both steps", async () => {
      const agent = spawnAgent(sessionId, "coder");
      const action = proposeAgentAction(sessionId, agent.id, "file.write", {
        filePath: "written.txt",
        content: "real content",
      });

      await approveAgentAction(action.id);

      const written = await fs.readFile(path.join(tmpRoot, "written.txt"), "utf8");
      expect(written).toBe("real content");

      const events = getSessionEventsAfter(sessionId, 0);
      expect(events.map((e) => e.type)).toEqual([
        "tool.exec.started", // the proposal itself
        "file.locked", // acquiring the lock before the real write (uncontended -> "acquired" immediately)
        "tool.exec.started", // the actual write beginning
        "tool.exec.finished",
        "file.unlocked",
      ]);
      expect(events[0].payload).toMatchObject({ status: "pending_approval" });
      expect(events[3].payload).toMatchObject({ tool: "file.write", ok: true });
    });

    it("is single-use — approving twice fails the second time and doesn't double-write", async () => {
      const agent = spawnAgent(sessionId, "coder");
      const action = proposeAgentAction(sessionId, agent.id, "file.write", {
        filePath: "once.txt",
        content: "v1",
      });
      await approveAgentAction(action.id);
      await expect(approveAgentAction(action.id)).rejects.toThrow(AgentToolError);
    });

    it("rejection prevents execution and records a real, distinct event", async () => {
      const agent = spawnAgent(sessionId, "coder");
      const action = proposeAgentAction(sessionId, agent.id, "file.write", {
        filePath: "rejected.txt",
        content: "should never land",
      });
      rejectAgentAction(action.id);

      await expect(fs.access(path.join(tmpRoot, "rejected.txt"))).rejects.toThrow();
      await expect(approveAgentAction(action.id)).rejects.toThrow(AgentToolError); // consumed by the rejection

      const events = getSessionEventsAfter(sessionId, 0);
      expect(events[events.length - 1].payload).toMatchObject({ ok: false, rejected: true });
    });

    it("refuses to even propose a write for an agent without file:write permission", () => {
      const agent = spawnAgent(sessionId, "coder", { permissions: ["file:read"] });
      expect(() => proposeAgentAction(sessionId, agent.id, "file.write", { filePath: "x.txt", content: "x" })).toThrow(
        AgentToolError
      );
    });

    it("refuses a write path that escapes the workspace root, at approval time", async () => {
      const agent = spawnAgent(sessionId, "coder");
      const action = proposeAgentAction(sessionId, agent.id, "file.write", {
        filePath: "../outside.txt",
        content: "escape attempt",
      });
      await expect(approveAgentAction(action.id)).rejects.toThrow(AgentToolError);
    });
  });

  describe("exec.command — routed through the same propose/approve gate as file.write", () => {
    it("proposeAgentAction/approveAgentAction actually runs a real command and returns its result", async () => {
      const agent = spawnAgent(sessionId, "coder"); // coder has exec:command by default
      const action = proposeAgentAction(sessionId, agent.id, "exec.command", {
        cwd: ".",
        command: "npm",
        args: ["--version"],
      });
      const result = (await approveAgentAction(action.id)) as { exitCode: number | null; stdout: string };
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    }, 15_000);

    it("refuses to even propose a command for an agent without exec:command permission", () => {
      const agent = spawnAgent(sessionId, "coder", { permissions: ["file:read"] });
      expect(() =>
        proposeAgentAction(sessionId, agent.id, "exec.command", { cwd: ".", command: "npm", args: ["--version"] })
      ).toThrow(AgentToolError);
    });
  });

  describe("audit boundary — internal agent tool calls never reach the cross-product audit log", () => {
    it("a real file write inserts zero rows into agent_audit_log — the whole table, not just one query shape", async () => {
      const before = (db.prepare("SELECT COUNT(*) as c FROM agent_audit_log").get() as { c: number }).c;

      const agent = spawnAgent(sessionId, "coder");
      const action = proposeAgentAction(sessionId, agent.id, "file.write", {
        filePath: "audited.txt",
        content: "x",
      });
      await approveAgentAction(action.id);

      const after = (db.prepare("SELECT COUNT(*) as c FROM agent_audit_log").get() as { c: number }).c;
      expect(after).toBe(before); // the table's real row count didn't move at all

      // Same conclusion from the read API's own side, for good measure: this session's id was
      // never used as a correlationId for any product-connector call, so a query using it as one
      // must come back empty.
      const rows = getAuditTrailForCorrelation(sessionId, { product: "jennysol-agents", externalUserId: agent.id });
      expect(rows).toHaveLength(0);
    });
  });
});
