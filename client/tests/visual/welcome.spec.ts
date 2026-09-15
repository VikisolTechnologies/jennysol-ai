import { test, expect } from "@playwright/test";
import { freshVisit } from "./fixtures";

test("welcome screen", async ({ page }) => {
  await freshVisit(page);
  await page.waitForURL("**/start", { timeout: 8000 });
  await page.waitForTimeout(500); // orb ripple/twinkle settle
  await expect(page).toHaveScreenshot("welcome.png");
});
