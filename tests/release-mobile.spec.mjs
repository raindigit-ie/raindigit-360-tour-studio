import { expect, test } from "@playwright/test";

test("mobile release renders and keeps controls recoverable", async ({ page, browserName }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text() !== "not granted") consoleErrors.push(message.text());
  });

  await page.goto(`/?mobile-qa=${browserName}`);
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
  expect(screenshot.byteLength).toBeGreaterThan(50_000);

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

test("mobile release exposes an optional floorplan without blocking the tour", async ({ page }) => {
  await page.route(/\/js\/tour-config\.js(?:\?.*)?$/, (route) => route.fulfill({
    contentType: "application/javascript; charset=utf-8",
    body: `window.TOUR_CONFIG=${JSON.stringify({
      schema: "raindigit-tour-project/v1",
      title: "Floorplan QA Tour",
      firstScene: "scene-001",
      map: {
        enabled: true,
        asset: "assets/studio-placeholder.svg",
        pins: { "scene-001": { x: 24, y: 64 }, "scene-002": { x: 76, y: 32 } }
      },
      scenes: [
        { id: "scene-001", title: "Kitchen", subtitle: "Kitchen view", space: "kitchen", spaceLabel: "Kitchen", thumb: "assets/studio-placeholder.svg", panorama: "assets/studio-placeholder.svg", pitch: 0, yaw: 0, hfov: 94, hotspots: [] },
        { id: "scene-002", title: "Hall", subtitle: "Hall view", space: "hall", spaceLabel: "Hall", thumb: "assets/studio-placeholder.svg", panorama: "assets/studio-placeholder.svg", pitch: 0, yaw: 0, hfov: 94, hotspots: [] }
      ]
    })};`
  }));
  await page.goto("/?floorplan-qa=1");
  await expect(page.locator(".pnlm-render-container canvas")).toBeVisible();

  const toggle = page.locator("#mapToggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator("#floorplanPanel")).toBeVisible();
  await expect(page.locator(".floorplan-pin")).toHaveCount(2);
  await page.locator('.floorplan-pin[data-scene="scene-002"]').click();
  await expect(page.locator("#sceneCounter")).toContainText("View 2 of 2");
  await expect(page.locator("#floorplanPanel")).toBeHidden();
  await toggle.click();
  await page.locator("#floorplanClose").click();
  await expect(page.locator("#floorplanPanel")).toBeHidden();
});

test("release hides floorplan control when no map is configured", async ({ page }) => {
  await page.route(/\/js\/tour-config\.js(?:\?.*)?$/, (route) => route.fulfill({
    contentType: "application/javascript; charset=utf-8",
    body: `window.TOUR_CONFIG=${JSON.stringify({
      schema: "raindigit-tour-project/v1",
      title: "No Floorplan QA Tour",
      firstScene: "scene-001",
      map: { enabled: false, asset: null, pins: {} },
      scenes: [
        { id: "scene-001", title: "Kitchen", subtitle: "Kitchen view", space: "kitchen", spaceLabel: "Kitchen", thumb: "assets/studio-placeholder.svg", panorama: "assets/studio-placeholder.svg", pitch: 0, yaw: 0, hfov: 94, hotspots: [] }
      ]
    })};`
  }));
  await page.goto("/?no-floorplan-qa=1");
  await expect(page.locator(".pnlm-render-container canvas")).toBeVisible();
  await expect(page.locator("#mapToggle")).toBeHidden();
  await expect(page.locator("#floorplanPanel")).toBeHidden();
});
