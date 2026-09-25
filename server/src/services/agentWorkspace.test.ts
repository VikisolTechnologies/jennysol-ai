import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const fixture = mkdtempSync(path.join(tmpdir(), "agent-boundary-"));
const root = path.join(fixture, "workspace");
mkdirSync(root);
process.env.AGENT_WORKSPACE_ROOT = root;
const { resolveInWorkspace } = await import("./agentWorkspace.js");
afterAll(() => {
  delete process.env.AGENT_WORKSPACE_ROOT;
  rmSync(fixture, { recursive: true, force: true });
});

describe("filesystem containment", () => {
  it("refuses file, directory and dangling symlinks even when lexically inside the workspace", () => {
    writeFileSync(path.join(fixture, "outside.txt"), "fixture");
    symlinkSync(path.join(fixture, "outside.txt"), path.join(root, "file-link"));
    symlinkSync(fixture, path.join(root, "dir-link"));
    symlinkSync(path.join(fixture, "missing"), path.join(root, "dangling"));
    for (const name of ["file-link", "dir-link/outside.txt", "dir-link/new.txt", "dangling"]) {
      expect(() => resolveInWorkspace(name)).toThrow(/Symlinks/);
    }
  });
  it("refuses traversal and protected files while allowing source and example configuration", () => {
    for (const name of ["../outside.txt", ".env", "server/.env.production", ".git/config", "data/jennysol.db-wal", "private.key", ".npmrc"]) {
      expect(() => resolveInWorkspace(name)).toThrow();
    }
    expect(resolveInWorkspace("src/new/file.ts")).toContain("src/new/file.ts");
    expect(resolveInWorkspace("server/.env.example")).toContain(".env.example");
  });
});
