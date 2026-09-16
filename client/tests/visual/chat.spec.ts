import { test, expect } from "@playwright/test";
import { completeSignup, mockChatReply } from "./fixtures";

async function enterChat(page: import("@playwright/test").Page) {
  // ChatWindow's real timeOfDayGreeting() reads the real system clock
  // (Wednesday afternoon/evening/...) — found live: this suite's own
  // baseline, recorded hours earlier the same day, drifted and failed once
  // real wall-clock time crossed into a different part of the day. Freezing
  // only Date() (not setTimeout/rAF — see setFixedTime's own docs) makes
  // this genuinely deterministic forever, rather than a baseline that will
  // keep drifting every time real time moves on, today or any other day.
  await page.clock.setFixedTime(new Date("2026-01-07T15:00:00"));
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
