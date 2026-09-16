import { test, expect } from "@playwright/test";
import { freshVisit } from "./fixtures";

test("settings screen (regular, non-admin account)", async ({ page }) => {
  await freshVisit(page);
  // A fresh guest has hasSeenWelcome=false, so RequireAuth would otherwise
  // redirect straight back to /start — going through the real "Continue as
  // guest" action first (same as any real first-time visitor who skips
  // signup) is what actually marks it seen, via the real dismissWelcome().
  await page.waitForURL("**/start", { timeout: 8000 });
  await page.getByText("Continue as guest").click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 8000 });
  await page.goto("/settings");
  // Real provider-health fetch resolving (403 for a guest — Routing shows
  // its honest fallback). A fixed wait here previously raced this under
  // real, heavier concurrent load from other specs in the suite (found
  // live: failed ~1 in 10 runs once admin.spec.ts started spawning real
  // promote-admin.ts subprocesses alongside it) — waiting for the actual
  // real text this fetch produces is correct regardless of how long it
  // happens to take on a given run, a fixed timeout never was.
  await page.getByText("Only visible to admin accounts on this deployment.").waitFor({ timeout: 8000 });
  await expect(page).toHaveScreenshot("settings.png");
});
