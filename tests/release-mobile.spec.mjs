import { expect, test } from "@playwright/test";
import sharp from "sharp";

test("desktop fullscreen keeps the complete tour control surface", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Desktop fullscreen regression only.");
  await page.goto("/?desktop-fullscreen-qa=1");
  await expect(page.locator(".pnlm-render-container canvas")).toBeVisible();

  const controls = {
    topbar: page.locator(".topbar"),
    rooms: page.locator("#navigatorToggle"),
    reset: page.locator("#resetView"),
    capture: page.locator("#captureView"),
    fullscreen: page.locator("#fullscreen")
  };
  for (const control of Object.values(controls)) await expect(control).toBeVisible();

  await controls.fullscreen.click();
  await expect.poll(() => page.evaluate(() => ({
    fullscreenClass: document.fullscreenElement?.className || "",
    fallback: document.body.classList.contains("is-cinema-fullscreen")
  }))).toMatchObject({ fullscreenClass: expect.stringContaining("tour-shell") });

  for (const control of Object.values(controls)) await expect(control).toBeVisible();
  await controls.rooms.click();
  await expect(controls.rooms).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#navigatorPanel")).toBeVisible();
  await expect(page.locator("#routeStrip")).toBeVisible();

  const hitTargets = await page.evaluate(() => {
    const selectors = ["#navigatorToggle", "#resetView", "#captureView", "#fullscreen"];
    return selectors.map((selector) => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { selector, hit: hit === element || element.contains(hit) };
    });
  });
  expect(hitTargets.every((target) => target.hit), JSON.stringify(hitTargets)).toBe(true);

  const downloadPromise = page.waitForEvent("download");
  await controls.capture.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^raindigit-tour-.+\.png$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const capture = sharp(Buffer.concat(chunks)).removeAlpha();
  const [captureMetadata, captureStats] = await Promise.all([capture.metadata(), capture.stats()]);
  expect(captureMetadata.format).toBe("png");
  expect(captureMetadata.width).toBeGreaterThan(320);
  expect(captureMetadata.height).toBeGreaterThan(180);
  expect(
    captureStats.channels.slice(0, 3).every(({ min, max, stdev }) => max - min >= 24 && stdev >= 3),
    JSON.stringify(captureStats.channels)
  ).toBe(true);

  await page.locator("#navigatorClose").click();
  await controls.fullscreen.click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
});

test("mobile release renders and keeps controls recoverable", async ({ page, browserName }, testInfo) => {
  test.skip(testInfo.project.name === "chromium-desktop", "Mobile release regression only.");
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text() !== "not granted") consoleErrors.push(message.text());
  });

  await page.goto(`/?mobile-qa=${browserName}`);
  await expect(page.locator(".pnlm-render-container canvas")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-tour-webgl-buffer", "default");
  await expect(page.locator("html")).toHaveAttribute("data-tour-webgl-readback", "disabled");
  const contextAttributes = await page.locator(".pnlm-render-container canvas").last().evaluate((canvas) => {
    const context = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    return context?.getContextAttributes();
  });
  expect(contextAttributes?.preserveDrawingBuffer).toBe(false);

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
  const screenshotImage = sharp(screenshot);
  const [screenshotMetadata, screenshotStats] = await Promise.all([
    screenshotImage.metadata(),
    screenshotImage.stats()
  ]);
  expect(screenshotMetadata.width).toBeGreaterThanOrEqual(400);
  expect(screenshotMetadata.height).toBeGreaterThanOrEqual(800);
  expect(
    screenshotStats.channels.slice(0, 3).every(({ min, max, stdev }) => max - min >= 24 && stdev >= 3),
    JSON.stringify(screenshotStats.channels)
  ).toBe(true);

  const navigatorToggle = page.locator("#navigatorToggle");
  await navigatorToggle.click();
  await expect(navigatorToggle).toHaveAttribute("aria-expanded", "true");

  const touchTargets = await page.evaluate(() => {
    const controls = ["#navigatorToggle", "#resetView", "#captureView", "#fullscreen", "#navigatorClose"];
    const primary = controls.map((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { selector, width: rect.width, height: rect.height };
    });
    const route = Array.from(document.querySelectorAll(".route-step"), (element) => {
      const rect = element.getBoundingClientRect();
      return { selector: ".route-step", width: rect.width, height: rect.height };
    });
    return { primary, route };
  });
  expect(touchTargets.primary.every(({ width, height }) => width >= 39.5 && height >= 39.5), JSON.stringify(touchTargets.primary)).toBe(true);
  expect(touchTargets.route.every(({ height }) => height >= 35.5), JSON.stringify(touchTargets.route)).toBe(true);

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

test("iPhone readiness does not depend on cross-origin Resource Timing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "webkit-mobile", "iPhone WebKit regression only.");
  await page.addInitScript(() => {
    const nativeGetEntriesByType = performance.getEntriesByType.bind(performance);
    Object.defineProperty(performance, "getEntriesByType", {
      configurable: true,
      value: (entryType) => entryType === "resource" ? [] : nativeGetEntriesByType(entryType)
    });
  });
  await page.goto("/?iphone-resource-timing=hidden");
  await expect(page.locator("html")).toHaveClass(/is-tour-ready/, { timeout: 60_000 });
  await expect(page.locator(".tour-shell")).not.toHaveClass(/is-transition-guarded/, { timeout: 60_000 });
  const canvas = page.locator(".pnlm-render-container canvas").last();
  await expect(canvas).toBeVisible();
  const screenshot = sharp(await canvas.screenshot()).removeAlpha();
  const stats = await screenshot.stats();
  expect(stats.channels.slice(0, 3).some(({ stdev }) => stdev > 3), JSON.stringify(stats.channels)).toBe(true);
});

test("mobile release exposes an optional floorplan without blocking the tour", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "chromium-desktop", "Mobile release regression only.");
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

test("release hides floorplan control when no map is configured", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "chromium-desktop", "Mobile release regression only.");
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
