import { test, expect } from "@playwright/test";
import { completeSignup } from "./fixtures";

test("mic permission screen", async ({ page }) => {
  await completeSignup(page);
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot("mic-permission.png");
});
