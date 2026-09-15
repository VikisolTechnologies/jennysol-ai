import { test, expect } from "@playwright/test";
import { completeSignup } from "./fixtures";

async function enterChat(page: import("@playwright/test").Page) {
  await completeSignup(page);
  await page.getByText("Not now").click();
  await page.waitForURL("**/first-run", { timeout: 8000 });
  await page.getByText("What do I have tomorrow?").click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 8000 });
}

// Real, live AI-generated reply text — genuinely non-deterministic between
// runs (confirmed live: two runs produced different real Gemini responses
// of different lengths, re-wrapping the bubble by a handful of pixels each
// time). A pixel-perfect diff would flake on real, correct behavior, not
// catch real regressions — this screen's layout/chrome is what's under
// test, not today's exact model output, so a small tolerance is the honest
// choice here, unlike every other screen in this suite (static UI content,
// held to 0 tolerance).
const LIVE_CONTENT_TOLERANCE = { maxDiffPixelRatio: 0.04 };

test("chat — with a real streaming reply", async ({ page }) => {
  await enterChat(page);
  await page.waitForTimeout(2000); // let a real reply start streaming in
  await expect(page).toHaveScreenshot("chat.png", LIVE_CONTENT_TOLERANCE);
});

// JENNYSOL-UI-BUILD.md §6's "Desktop matters here more than in Arena" —
// real check that the sidebar renders as persistent (in the document's
// normal flow, on-screen) rather than an off-canvas overlay at 1024px+.
// toBeVisible() alone isn't enough here — a translate-x-full sidebar is
// still "visible" by computed style while sitting off-screen — so this
// checks its actual bounding box is inside the viewport, on desktop only.
test("chat — sidebar persistent on desktop", async ({ page }) => {
  await enterChat(page);
  await page.waitForTimeout(1500);
  const viewport = page.viewportSize();
  test.skip(!viewport || viewport.width < 1024, "persistent-sidebar behavior only applies at 1024px+");
  const box = await page.locator("aside").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  await expect(page).toHaveScreenshot("chat-sidebar.png", LIVE_CONTENT_TOLERANCE);
});
