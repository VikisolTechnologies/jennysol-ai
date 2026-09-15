import { test, expect } from "@playwright/test";
import { freshVisit } from "./fixtures";

// JENNYSOL-UI-BUILD.md §3 rule 4 / definition-of-done item 8: "Pause all
// animation ... under prefers-reduced-motion." Real assertion against the
// real Orb component's own computed `animate` flag (components/orb/Orb.tsx)
// — under reduced motion, none of its motion-safe:animate-* classes are
// applied, so the ripple/breathe/core elements render with no active CSS
// animation at all rather than a class Tailwind's own media-query variant
// would have suppressed anyway (this checks the app's own logic branch,
// not Tailwind's).
test("welcome orb has no active animation under prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await freshVisit(page);
  await page.waitForURL("**/start", { timeout: 8000 });
  await page.waitForTimeout(300);

  const animatedCount = await page.locator('[class*="motion-safe:animate-"]').count();
  expect(animatedCount).toBe(0);
});
