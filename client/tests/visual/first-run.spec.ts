import { test, expect } from "@playwright/test";
import { completeSignup } from "./fixtures";

test("first run screen", async ({ page }) => {
  await completeSignup(page);
  await page.getByText("Not now").click();
  await page.waitForURL("**/first-run", { timeout: 8000 });
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot("first-run.png");
});
