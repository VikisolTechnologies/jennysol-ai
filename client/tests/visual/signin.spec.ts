import { test, expect } from "@playwright/test";
import { freshVisit } from "./fixtures";

test("sign-in — email step", async ({ page }) => {
  await freshVisit(page, "/login");
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("signin-email.png");
});

test("sign-in — password step", async ({ page }) => {
  await freshVisit(page, "/login");
  await page.locator('input[type="email"]').fill("someone@example.test");
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("signin-password.png");
});
