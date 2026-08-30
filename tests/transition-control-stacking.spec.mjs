import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

async function stacking(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector(".tour-scene-transition");
    const topbar = document.querySelector(".topbar");
    const panel = document.querySelector(".scene-panel");
    const userInterface = document.querySelector(".pnlm-ui");
    const renderer = document.querySelector(".pnlm-render-container");
    const hotspot = document.querySelector(".pnlm-hotspot-base.nav-hotspot-anchor");
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    const ownsPoint = (element) => {
      const value = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        value.left + value.width / 2,
        value.top + value.height / 2
      );
      return hit === element || element.contains(hit);
    };
    return {
      phase: overlay.dataset.phase || "static",
      overlayZ: Number(getComputedStyle(overlay).zIndex),
      topbarZ: Number(getComputedStyle(topbar).zIndex),
      panelZ: Number(getComputedStyle(panel).zIndex),
      userInterfaceZ: getComputedStyle(userInterface).zIndex,
      rendererZ: Number(getComputedStyle(renderer).zIndex),
      hotspotZ: hotspot ? Number(getComputedStyle(hotspot).zIndex) : null,
      topbarRect: rect(topbar),
      panelRect: rect(panel),
      topbarOwnsPoint: ownsPoint(topbar),
      panelOwnsPoint: ownsPoint(panel)
    };
  });
}

function expectSameRect(actual, expected) {
  for (const key of ["x", "y", "width", "height"])
    expect(Math.abs(actual[key] - expected[key]), `${key}: ${actual[key]} vs ${expected[key]}`)
      .toBeLessThanOrEqual(0.5);
}

async function transitionAndAssert(page) {
  const before = await stacking(page);
  const overlay = page.locator(".tour-scene-transition");
  const during = await stacking(page);

  expect(during.overlayZ).toBeLessThan(during.topbarZ);
  expect(during.overlayZ).toBeLessThan(during.panelZ);
  expect(during.overlayZ).toBeGreaterThan(during.rendererZ);
  expect(during.userInterfaceZ).toBe("auto");
  if (during.hotspotZ !== null) expect(during.overlayZ).toBeGreaterThan(during.hotspotZ);
  expect(during.topbarOwnsPoint).toBe(true);
  expect(during.panelOwnsPoint).toBe(true);
  expectSameRect(during.topbarRect, before.topbarRect);
  expectSameRect(during.panelRect, before.panelRect);

  await expect(overlay).toHaveAttribute("data-phase", "loading");
}

test("cold start owns the viewport and later scene guards preserve controls", async ({ page }) => {
  await page.goto("/?transition-control-stacking=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tour-scene-transition")).toBeVisible();
  const initial = await stacking(page);
  expect(initial.phase).toBe("initial-loading");
  expect(initial.overlayZ).toBeGreaterThan(initial.topbarZ);

  await page.evaluate(() => {
    const overlay = document.querySelector(".tour-scene-transition");
    overlay.classList.remove("tour-scene-transition--static");
    overlay.dataset.phase = "loading";
    document.documentElement.classList.remove("is-tour-transition-boot");
    document.documentElement.classList.add("is-tour-ready");
    document.body.classList.add("is-navigator-open");
  });
  await expect(page.locator("#navigatorPanel")).toBeVisible();
  await page.waitForTimeout(250);
  await transitionAndAssert(page);

  for (const viewport of [
    { width: 360, height: 800 },
    { width: 844, height: 390 }
  ]) {
    await page.setViewportSize(viewport);
    await transitionAndAssert(page);
  }
});
