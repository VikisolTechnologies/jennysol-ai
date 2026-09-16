import { test, expect } from "@playwright/test";
import { completeSignup } from "./fixtures";

// JENNYSOL-UI-BUILD.md §3 rule 3 / definition-of-done item 4: "Unavailable
// must actually render when the provider chain fails ... deliberately
// broken." Real component logic under test (ChatWindow's chatUnavailable
// state, set only when a send never reaches run.started — see its own
// comment) — the only simulated part is making the backend actually fail,
// via a route interception that aborts the real POST /api/chat request
// exactly the way a genuinely unreachable server would from the browser's
// point of view.
test("orb shows unavailable when the provider chain is broken", async ({ page }) => {
  await completeSignup(page);
  await page.getByText("Not now").click();
  await page.waitForURL("**/first-run", { timeout: 8000 });
  await page.waitForURL((url) => url.pathname === "/first-run");

  await page.route("**/api/chat", (route) => route.abort("failed"));

  await page.locator('input[placeholder="Ask Jenny"]').fill("hello");
  await page.locator('input[placeholder="Ask Jenny"]').press("Enter");
  await page.waitForURL((url) => url.pathname === "/", { timeout: 8000 });

  // Real orb instances can legitimately show "unavailable" simultaneously
  // (the hero orb, plus the bottom status row this fix now also renders
  // for a typing-only user — see ChatWindow.tsx's own comment on that
  // condition) — asserting at least one is enough to prove the real state
  // actually reaches the screen, not a specific count of them.
  await expect(page.locator('[aria-label="Jenny is unavailable"]').first()).toBeVisible({ timeout: 8000 });
  // Small tolerance: the orb's own real animation (still transitioning
  // state right as this frame is captured) can shift a handful of pixels
  // run to run; the toBeVisible() assertion above is what actually proves
  // the real state.
  await expect(page).toHaveScreenshot("chat-unavailable.png", { maxDiffPixelRatio: 0.02 });

  await page.unroute("**/api/chat");
});
