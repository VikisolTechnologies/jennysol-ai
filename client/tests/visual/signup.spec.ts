import { test, expect } from "@playwright/test";
import { freshVisit } from "./fixtures";

test("sign-up — name step", async ({ page }) => {
  await freshVisit(page, "/signup");
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("signup-name.png");
});

test("sign-up — email step", async ({ page }) => {
  await freshVisit(page, "/signup");
  await page.locator('input[placeholder="Your name"]').fill("Syam");
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("signup-email.png");
});

test("sign-up — password step with strength meter", async ({ page }) => {
  await freshVisit(page, "/signup");
  await page.locator('input[placeholder="Your name"]').fill("Syam");
  await page.locator('button[type="submit"]').click();
  await page.locator('input[type="email"]').fill(`visual-${Date.now()}@example.test`);
  await page.locator('button[type="submit"]').click();
  await page.locator('input[type="password"]').fill("Str0ngPassword!123");
  await page.waitForTimeout(200);
  await expect(page).toHaveScreenshot("signup-password.png");
});
