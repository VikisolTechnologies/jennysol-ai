import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Real Playwright, not mocked — this module's entire job is producing a real screenshot, and a
// mocked browser would prove nothing about whether the real capture actually works.
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "agent-screenshot-test-"));
process.env.AGENT_WORKSPACE_ROOT = tmpRoot;
afterAll(() => {
  delete process.env.AGENT_WORKSPACE_ROOT;
  rmSync(tmpRoot, { recursive: true, force: true });
});

// Dynamic, not static — agentWorkspace.ts computes WORKSPACE_ROOT from AGENT_WORKSPACE_ROOT at
// module load time, and a static import would be hoisted above the assignment above (the exact,
// repeatedly-caught ESM hoisting bug documented throughout this session).
const { captureFileScreenshot, ScreenshotError } = await import("./agentScreenshotTool.js");

describe("captureFileScreenshot — JENNYSOL-VISION-AND-IMAGERY.md Part A.4", () => {
  it("captures a real PNG screenshot of a real HTML file in the workspace", async () => {
    writeFileSync(path.join(tmpRoot, "preview.html"), "<html><body style='background:red'><h1>Real content</h1></body></html>");

    const result = await captureFileScreenshot("preview.html");

    expect(result.base64Png.length).toBeGreaterThan(100);
    // A real PNG's magic bytes, decoded from the real base64 output — proof this is a genuine
    // image, not just an arbitrary non-empty string.
    const bytes = Buffer.from(result.base64Png, "base64");
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  }, 20_000);

  it("refuses a path that escapes the workspace, same boundary every other file tool already enforces", async () => {
    await expect(captureFileScreenshot("../../etc/passwd")).rejects.toThrow(ScreenshotError);
  });

  it("fails honestly when the file doesn't exist, rather than screenshotting a blank error page", async () => {
    await expect(captureFileScreenshot("does-not-exist.html")).rejects.toThrow(/does not exist/i);
  });
});
