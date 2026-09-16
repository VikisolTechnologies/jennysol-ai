import { test, expect } from "@playwright/test";
import { completeSignup, mockChatReply } from "./fixtures";

async function enterChat(page: import("@playwright/test").Page) {
  await mockChatReply(page);
  await completeSignup(page);
  await page.getByText("Not now").click();
  await page.waitForURL("**/first-run", { timeout: 8000 });
  await page.getByText("What do I have tomorrow?").click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 8000 });
}

test("chat — with a reply", async ({ page }) => {
  await enterChat(page);
  await page.waitForTimeout(500); // let the stubbed stream finish and the bubble settle
  await expect(page).toHaveScreenshot("chat.png");
});

// JENNYSOL-UI-BUILD.md §6's "Desktop matters here more than in Arena" —
// real check that the sidebar renders as persistent (in the document's
// normal flow, on-screen) rather than an off-canvas overlay at 1024px+.
// toBeVisible() alone isn't enough here — a translate-x-full sidebar is
// still "visible" by computed style while sitting off-screen — so this
// checks its actual bounding box is inside the viewport, on desktop only.
test("chat — sidebar persistent on desktop", async ({ page }) => {
  await enterChat(page);
  await page.waitForTimeout(500);
  const viewport = page.viewportSize();
  test.skip(!viewport || viewport.width < 1024, "persistent-sidebar behavior only applies at 1024px+");
  const box = await page.locator("aside").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  await expect(page).toHaveScreenshot("chat-sidebar.png");
});
