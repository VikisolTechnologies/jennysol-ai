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
  await page.waitForTimeout(500); // real provider-health fetch resolves (403 for a guest — Routing shows its honest fallback)
  await expect(page).toHaveScreenshot("settings.png");
});
