import type { Page } from "@playwright/test";

// Every spec starts from a genuinely fresh guest (AuthContext's real
// auto-guestLogin on first visit — see lib/AuthContext.tsx), not a shared
// or mocked identity: clearing storage first is what makes the guest
// created for THIS test's run new, so screens gated on hasSeenWelcome
// (Welcome/mic-permission/first-run) actually show rather than being
// skipped because a previous test's guest already "saw" them.
export async function freshVisit(page: Page, path = "/"): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(path);
}

// Drives a real signup (real API calls, a real new guest-upgrade account
// each time — the random email guarantees no collision across parallel/
// repeated runs) through to the real /mic-permission screen, for specs
// that need a screen only reachable after account creation.
export async function completeSignup(page: Page): Promise<void> {
  await freshVisit(page, "/signup");
  await page.locator('input[placeholder="Your name"]').fill("Syam");
  await page.locator('button[type="submit"]').click();
  await page
    .locator('input[type="email"]')
    .fill(`visual-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await page.locator('button[type="submit"]').click();
  await page.locator('input[type="password"]').fill("Str0ngPassword!123");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/mic-permission", { timeout: 8000 });
}
