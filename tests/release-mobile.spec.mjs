import { expect, test } from "@playwright/test";

test("mobile release renders and keeps controls recoverable", async ({ page, browserName }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text() !== "not granted") consoleErrors.push(message.text());
  });

  await page.goto(`/?mobile-qa=${browserName}`);
  await expect(page.locator(".nav-hotspot")).toHaveCount(2);
  await expect(page.locator(".pnlm-render-container canvas")).toBeVisible();

  const layout = await page.evaluate(() => {
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const corner = document.elementFromPoint(5, 5);
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      topbarRight: topbar.right,
      cornerBackground: corner ? getComputedStyle(corner).backgroundColor : ""
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.topbarRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.cornerBackground).not.toBe("rgb(255, 255, 255)");

  const screenshot = await page.screenshot();
  expect(screenshot.byteLength).toBeGreaterThan(100_000);

  const navigatorToggle = page.locator("#navigatorToggle");
  await navigatorToggle.click();
  await expect(navigatorToggle).toHaveAttribute("aria-expanded", "true");
  await page.locator("#navigatorClose").click();
  await expect(navigatorToggle).toHaveAttribute("aria-expanded", "false");
  await navigatorToggle.click();
  await expect(navigatorToggle).toHaveAttribute("aria-expanded", "true");

  await page.locator("#fullscreen").click();
  await page.waitForTimeout(600);
  await expect.poll(() => page.evaluate(() => Boolean(
    document.fullscreenElement || document.webkitFullscreenElement || document.body.classList.contains("is-cinema-fullscreen")
  ))).toBe(true);

  const globals = await page.evaluate(() => ({
    editor: Boolean(window.__TOUR_EDITOR_API),
    preview: Boolean(window.__TOUR_DRAFT_PREVIEW_API)
  }));
  expect(globals).toEqual({ editor: false, preview: false });
  expect(consoleErrors).toEqual([]);
});
