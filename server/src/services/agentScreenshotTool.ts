// JENNYSOL-VISION-AND-IMAGERY.md Part A.4: the Visual QA screenshot mechanism, designed and built as
// its own piece of work per the brief's own explicit instruction ("do not improvise it inside a role
// implementation") — this file is that piece; agentOrchestrator.ts's visual_qa dispatch (Part A.4
// cont'd) only ever calls into it, never captures a screenshot itself.
//
// Capture mechanism: Playwright (`playwright-core`), reusing the exact library Arena FE's own real
// E2E suite already uses (per the brief's own "Playwright already exists in the Arena repo — reuse
// that mechanism rather than inventing one") — this package installs no browser of its own; on this
// Mac it resolves to the same Chromium build already cached for Arena's own test suite, confirmed
// during this session's own vision-model evaluation work (no second download needed).
//
// Storage: NOT a new asset-storage system. The captured PNG (base64) lives in the calling task's own
// `agent_tasks.result` column — the same real, existing storage every other role's result already
// uses, for exactly as long as that row exists. No new retention policy, no new table, no new
// lifecycle to reason about — a deliberate scope decision, not an oversight (a real, standalone
// screenshot archive with its own retention window is a legitimate future refinement, not required to
// make a real Visual QA role work today).
//
// Scope: a real file already on disk within the agent workspace (the common real case: the "ui" role
// just wrote an HTML/component file this same session) — resolved through the exact same
// resolveInWorkspace() boundary every other file-touching agent tool already uses, so a Visual QA
// task can no more escape the workspace than a file.read/file.write task can. Screenshotting a
// *running dev server URL* is real, additional scope (process lifecycle, port allocation, readiness
// waiting) deliberately left out of this pass — flagged, not silently assumed away.
import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import { resolveInWorkspace, AgentWorkspaceError } from "./agentWorkspace.js";

export class ScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenshotError";
  }
}

export interface ScreenshotResult {
  base64Png: string;
  resolvedPath: string;
}

// One browser launch per call — real overhead (a few hundred ms), accepted deliberately: this is a
// one-off role invocation, not a hot path, and a persistent browser pool is real complexity with no
// real need behind it yet.
export async function captureFileScreenshot(filePath: string): Promise<ScreenshotResult> {
  let resolved: string;
  try {
    resolved = resolveInWorkspace(filePath);
  } catch (err) {
    if (err instanceof AgentWorkspaceError) throw new ScreenshotError(err.message);
    throw err;
  }

  try {
    await fs.access(resolved);
  } catch {
    throw new ScreenshotError(`File "${filePath}" does not exist in the workspace — nothing to screenshot`);
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`file://${resolved}`);
    const buffer = await page.screenshot({ fullPage: true });
    return { base64Png: buffer.toString("base64"), resolvedPath: resolved };
  } catch (err) {
    throw new ScreenshotError(`Failed to render/screenshot "${filePath}": ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close();
  }
}
