#!/usr/bin/env node

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNear(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
}

async function runMagick(arguments_) {
  for (const binary of ["magick", "convert"]) {
    try {
      return await execFileAsync(binary, arguments_);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error("ImageMagick is required for guided studio fixtures.");
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/__tour-editor/status`)).ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Timed out waiting for guided studio server.");
}

async function waitForApi(page, path, predicate, timeout = 10_000) {
  const startedAt = Date.now();
  let lastBody = null;
  while (Date.now() - startedAt < timeout) {
    const url = new URL(path, page.url()).href;
    const response = await page.request.get(url, { headers: { "cache-control": "no-store" } });
    if (response.ok()) {
      lastBody = await response.json();
      if (predicate(lastBody)) return lastBody;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${path}: ${JSON.stringify(lastBody)}`);
}

async function assertOneTask(page, heading, options = {}) {
  await page.getByRole("heading", { name: heading }).waitFor();
  const primaryActions = await page.evaluate(() => {
    const active = document.querySelector(".editor-stage-panel:not([hidden])");
    const candidates = [
      ...(active?.querySelectorAll(".editor-button--primary") || []),
      ...document.querySelectorAll(".editor-panel__footer .editor-button--primary")
    ];
    return candidates
      .filter((element) => !element.hidden && !element.closest("[hidden]") && getComputedStyle(element).display !== "none")
      .map((element) => element.textContent.trim());
  });
  const allowedPrimaryActions = options.allowedPrimaryActions || 1;
  assert(primaryActions.length <= allowedPrimaryActions, `${heading} exposes primary actions: ${primaryActions.join(" | ")}`);
  const layout = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const footer = document.querySelector(".editor-panel__footer")?.getBoundingClientRect();
    const active = document.querySelector(".editor-stage-panel:not([hidden])");
    const visible = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return !element.hidden && !element.closest("[hidden]") && style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    const unnamedButtons = [...(active?.querySelectorAll("button") || []), ...document.querySelectorAll(".editor-panel__footer button")]
      .filter(visible)
      .filter((button) => !(button.getAttribute("aria-label") || button.textContent || button.title || "").trim())
      .map((button) => button.id || button.outerHTML.slice(0, 80));
    const unlabeledFields = [...(active?.querySelectorAll("input, select, textarea") || [])]
      .filter(visible)
      .filter((field) => !field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby") && !field.closest("label"))
      .map((field) => field.id || field.outerHTML.slice(0, 80));
    const smallMobileTargets = viewport <= 500
      ? [...(active?.querySelectorAll("button") || []), ...document.querySelectorAll(".editor-panel__footer button")]
          .filter(visible)
          .map((button) => ({ name: (button.getAttribute("aria-label") || button.textContent || button.title || "").trim(), box: button.getBoundingClientRect() }))
          .filter(({ box }) => box.width < 36 || box.height < 36)
          .map(({ name, box }) => `${name || "unnamed"} (${Math.round(box.width)}×${Math.round(box.height)})`)
      : [];
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    return {
      viewport,
      scrollWidth: document.documentElement.scrollWidth,
      footerBottom: footer?.bottom || 0,
      windowHeight: window.innerHeight,
      unnamedButtons,
      unlabeledFields,
      smallMobileTargets,
      duplicateIds
    };
  });
  assert(layout.scrollWidth <= layout.viewport, `${heading} has horizontal overflow: ${JSON.stringify(layout)}`);
  assert(layout.footerBottom <= layout.windowHeight + 1, `${heading} footer is outside the viewport: ${JSON.stringify(layout)}`);
  assert(layout.unnamedButtons.length === 0, `${heading} has unnamed buttons: ${layout.unnamedButtons.join(" | ")}`);
  assert(layout.unlabeledFields.length === 0, `${heading} has unlabeled fields: ${layout.unlabeledFields.join(" | ")}`);
  assert(layout.smallMobileTargets.length === 0, `${heading} has mobile targets smaller than 36px: ${layout.smallMobileTargets.join(" | ")}`);
  assert(layout.duplicateIds.length === 0, `${heading} has duplicate IDs: ${layout.duplicateIds.join(", ")}`);
}

async function addedHotspots(page, sceneId) {
  return page.evaluate((id) => window.__TOUR_EDITOR_API.getAddedHotspots(id).map((hotspot) => ({
    target: hotspot.target,
    kind: hotspot.kind,
    pitch: hotspot.pitch,
    yaw: hotspot.yaw,
    positionConfirmed: hotspot.positionConfirmed,
    arrivalConfirmed: hotspot.arrivalConfirmed
  })), sceneId);
}

async function waitForWorkspaceStructure(page, predicate) {
  await waitForApi(page, "/__tour-editor/workspace-project", (body) => Boolean(body.project && predicate(body.project)));
}

async function dragViewer(page, deltaX) {
  const bounds = await page.locator("#panorama").boundingBox();
  assert(bounds, "Panorama is not visible.");
  const startX = bounds.x + bounds.width * 0.35;
  const y = bounds.y + bounds.height * 0.45;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function viewerPose(page) {
  return page.evaluate(() => ({
    pitch: Math.round(window.__TOUR_EDITOR_API.viewer.getPitch() * 10) / 10,
    yaw: Math.round(window.__TOUR_EDITOR_API.viewer.getYaw() * 10) / 10
  }));
}

async function elementCenter(page, selector) {
  return page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: Math.round((box.left + box.width / 2) * 10) / 10, y: Math.round((box.top + box.height / 2) * 10) / 10 };
  });
}

async function waitForMarkerAt(page, target, tolerance = 8) {
  await page.waitForFunction(({ expected, allowedDifference }) => {
    const marker = document.querySelector(".nav-hotspot-anchor.is-editor-selected .nav-hotspot")?.getBoundingClientRect();
    return Boolean(marker && Math.abs((marker.left + marker.width / 2) - expected.x) <= allowedDifference && Math.abs((marker.top + marker.height / 2) - expected.y) <= allowedDifference);
  }, { expected: target, allowedDifference: tolerance }, { timeout: 3000 });
}

async function dragElementCenter(page, selector, deltaX, deltaY) {
  const start = await elementCenter(page, selector);
  const hitTarget = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    const hotspot = element?.closest?.("[data-editor-hotspot-id]");
    return {
      tag: element?.tagName || null,
      className: element?.className?.baseVal || element?.className || null,
      hotspotId: hotspot?.dataset?.editorHotspotId || null,
      pointerEvents: element ? getComputedStyle(element).pointerEvents : null
    };
  }, start);
  assert(hitTarget.hotspotId, `Walking button is not the top hit target before drag: ${JSON.stringify({ start, hitTarget })}`);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + deltaX, start.y + deltaY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  return { start, end: { x: Math.round((start.x + deltaX) * 10) / 10, y: Math.round((start.y + deltaY) * 10) / 10 } };
}

async function dispatchElementDrag(page, selector, deltaX, deltaY) {
  return page.evaluate(({ selector, deltaX, deltaY }) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing draggable element: ${selector}`);
    const box = element.getBoundingClientRect();
    const start = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const end = { x: start.x + deltaX, y: start.y + deltaY };
    const eventOptions = { bubbles: true, cancelable: true, pointerId: 991, pointerType: "mouse", button: 0, buttons: 1 };
    element.dispatchEvent(new PointerEvent("pointerdown", { ...eventOptions, clientX: start.x, clientY: start.y }));
    document.dispatchEvent(new PointerEvent("pointermove", { ...eventOptions, clientX: end.x, clientY: end.y }));
    document.dispatchEvent(new PointerEvent("pointerup", { ...eventOptions, buttons: 0, clientX: end.x, clientY: end.y }));
    return {
      start: { x: Math.round(start.x * 10) / 10, y: Math.round(start.y * 10) / 10 },
      end: { x: Math.round(end.x * 10) / 10, y: Math.round(end.y * 10) / 10 }
    };
  }, { selector, deltaX, deltaY });
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "raindigit-guided-flow-"));
  const port = 22000 + Math.floor(Math.random() * 12000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const outputDir = join(projectRoot, "output", "playwright", "guided-studio");
  await mkdir(outputDir, { recursive: true });
  const server = spawn(process.execPath, [join(projectRoot, "scripts", "tour-editor-server.mjs"), "--port", String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      INSTA360_TOUR_WORKSPACE: join(root, "workspace"),
      INSTA360_TOUR_ARTIFACTS: join(root, "artifacts"),
      INSTA360_TOUR_ARCHIVES: join(root, "archives"),
      INSTA360_TOUR_RELEASE: join(root, "release"),
      INSTA360_TOUR_MULTIRES_RELEASE: join(root, "release-multires")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverError = "";
  server.stderr.on("data", (chunk) => { serverError += chunk.toString(); });
  let browser;

  try {
    const fixtures = [];
    for (const [index, colors] of [["#193746", "#d6af5c"], ["#385b48", "#e8d7a6"], ["#4b334f", "#8bc6b1"], ["#5b4033", "#d8c7a9"]].entries()) {
      const path = join(root, `photo-${index + 1}.jpg`);
      await runMagick(["-size", "1800x900", `gradient:${colors[0]}-${colors[1]}`, "-quality", "90", path]);
      fixtures.push(path);
    }

    await waitForServer(baseUrl);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    let portableBuildRequests = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/__tour-editor/build-portable-release")) portableBuildRequests += 1;
    });
    const consoleErrors = [];
    const requestFailures = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("requestfailed", (request) => requestFailures.push(`${request.url()} - ${request.failure()?.errorText || "failed"}`));
    page.on("dialog", async (dialog) => { await dialog.accept(); });

    await page.goto(`${baseUrl}/?edit=1`);
    await assertOneTask(page, "Start a tour");
    await page.getByLabel("Tour name").fill("Guided Staff Journey");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }),
      page.getByRole("button", { name: "Create new tour" }).click()
    ]);
    await assertOneTask(page, "Add 360 photos");
    await page.getByText("Tour ready. Add photos.", { exact: true }).waitFor({ timeout: 15_000 });
    await page.locator("#editorImportFiles").waitFor({ state: "attached" });
    await page.locator("#editorImportFiles").setInputFiles(fixtures);
    await page.getByText("4 photos ready", { exact: true }).waitFor({ timeout: 90_000 });
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto(`${baseUrl}/?edit=1&workspace=1`);
    await assertOneTask(page, "Start a tour");
    await page.getByRole("button", { name: /Continue (current|unfinished) tour/ }).click();
    await assertOneTask(page, "Add 360 photos");
    await page.locator(".editor-stage-panel[data-stage-panel='upload'] .editor-upload-item__actions .editor-button--small").first().click();
    await page.locator(".editor-photo-preview__dialog").waitFor({ state: "visible" });
    const uploadPreviewImage = page.locator("#editorPreviewImage");
    await page.waitForFunction(() => document.querySelector("#editorPreviewImage")?.complete === true);
    assert((await uploadPreviewImage.getAttribute("src")).includes("/__tour-editor/workspace/panoramas/"), "Upload preview must use the full panorama, not only a thumbnail.");
    await page.getByRole("button", { name: "360 view" }).click();
    await page.locator("#editorPreviewViewer canvas").waitFor({ state: "visible", timeout: 10_000 });
    const uploadPreviewMode = await page.evaluate(() => ({
      imageHidden: document.querySelector("#editorPreviewImage")?.hidden,
      viewerHidden: document.querySelector("#editorPreviewViewer")?.hidden,
      hasCanvas: Boolean(document.querySelector("#editorPreviewViewer .pnlm-render-container canvas"))
    }));
    assert(uploadPreviewMode.imageHidden && !uploadPreviewMode.viewerHidden && uploadPreviewMode.hasCanvas, `360 preview did not render correctly: ${JSON.stringify(uploadPreviewMode)}`);
    await page.keyboard.press("Escape");
    await page.locator(".editor-photo-preview__dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    const roomsStageWidth = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const stagePanel = document.querySelector('.editor-stage-panel[data-stage-panel="rooms"]')?.getBoundingClientRect();
      return { viewport, stageWidth: stagePanel?.width || 0 };
    });
    assert(roomsStageWidth.stageWidth >= roomsStageWidth.viewport - 48, `Step 2 rooms panel is still width-capped: ${JSON.stringify(roomsStageWidth)}`);

    await page.setViewportSize({ width: 390, height: 605 });
    await assertOneTask(page, "Set up spaces and walking routes");
    await page.getByLabel("Number of spaces").fill("3");
    await page.getByRole("button", { name: "Update spaces" }).click();
    await page.getByLabel("Number of floors").fill("3");
    await page.getByRole("button", { name: "Update floors" }).click();
    const roomNames = page.locator("#editorRoomList input");
    const floorNames = page.locator("#editorFloorList input");
    const spaceTemplates = page.locator("#editorRoomList select");
    assert(await floorNames.nth(0).inputValue() === "First floor", "The first default floor name was not First floor.");
    assert(await floorNames.nth(1).inputValue() === "Second floor", "The second default floor name was not Second floor.");
    assert(await floorNames.nth(2).inputValue() === "Third floor", "The third default floor name was not Third floor.");
    const kitchenTemplateText = await spaceTemplates.nth(0).locator("option", { hasText: "Kitchen - кухня" }).textContent();
    assert(kitchenTemplateText === "Kitchen - кухня", "The quick-name list did not show the Russian space hint.");
    await spaceTemplates.nth(0).selectOption("Kitchen");
    assert(await roomNames.nth(0).inputValue() === "Kitchen", "Choosing a quick name should write only the English space name.");
    await spaceTemplates.nth(1).selectOption("Kitchen");
    assert(await roomNames.nth(1).inputValue() === "Kitchen 2", "Duplicate quick names should get a visible numeric suffix.");
    await roomNames.nth(1).fill("Wrong space");
    await roomNames.nth(1).press("Tab");
    await roomNames.nth(2).fill("Hall");
    await roomNames.nth(2).press("Tab");
    await page.getByLabel("Number of spaces").fill("1");
    await page.getByRole("button", { name: "Update spaces" }).click();
    await page.waitForFunction(() => document.querySelectorAll("#editorRoomList input").length === 3);
    assert(await page.getByLabel("Number of spaces").inputValue() === "3", "The space count control allowed a destructive shrink.");
    await page.getByRole("button", { name: "Remove Wrong space" }).click();
    await page.waitForFunction(() => document.querySelectorAll("#editorRoomList input").length === 2);
    assert(await roomNames.nth(0).inputValue() === "Kitchen" && await roomNames.nth(1).inputValue() === "Hall", "Deleting a middle space did not keep the intended spaces.");
    await floorNames.nth(2).fill("Wrong floor");
    await floorNames.nth(2).press("Tab");
    await page.getByRole("button", { name: "Remove Wrong floor" }).click();
    await page.waitForFunction(() => document.querySelectorAll("#editorFloorList input").length === 2);
    assert(await floorNames.nth(0).inputValue() === "First floor" && await floorNames.nth(1).inputValue() === "Second floor", "Deleting a middle floor did not keep the intended floors.");
    assert(await page.locator('.editor-room-photo[data-scene-id="scene-001"] input').inputValue() === "Kitchen view 1", "The first auto-named photo still looked like a generic View.");
    assert(await page.locator('.editor-room-photo[data-scene-id="scene-002"] input').inputValue() === "Kitchen view 2", "The second auto-named photo still looked like a generic View.");
    await page.getByRole("button", { name: "Remove Kitchen view 4" }).click();
    await assertOneTask(page, "Set up spaces and walking routes");
    await page.waitForFunction(() => document.querySelectorAll(".editor-room-photo").length === 3);
    assert(await page.locator('.editor-room-photo[data-scene-id="scene-004"]').count() === 0, "The removed duplicate photo was still visible on the room board.");
    assert(await roomNames.nth(0).inputValue() === "Kitchen" && await roomNames.nth(1).inputValue() === "Hall", "Removing a photo lost the current room names.");
    await page.locator("#editorRoomImportFiles").setInputFiles(fixtures[3]);
    await assertOneTask(page, "Set up spaces and walking routes");
    await page.waitForFunction(() => document.querySelectorAll(".editor-room-photo").length === 4);
    const addedRoomState = await page.evaluate(async () => ({
      rooms: Array.from(document.querySelectorAll("#editorRoomList input")).map((input) => input.value),
      selectedSource: document.querySelector(".editor-photo-choice.is-selected strong")?.textContent,
      selectedStatus: document.querySelector(".editor-photo-choice.is-selected small")?.textContent,
      added: {
        title: document.querySelector('.editor-room-photo[data-scene-id="scene-004"] input')?.value,
        space: document.querySelector('.editor-room-photo[data-scene-id="scene-004"] select')?.selectedOptions[0]?.textContent,
        floor: document.querySelectorAll('.editor-room-photo[data-scene-id="scene-004"] select')[1]?.selectedOptions[0]?.textContent
      },
      project: (await (await fetch("/__tour-editor/workspace-project", { cache: "no-store" })).json()).project
    }));
    assert(addedRoomState.rooms.join("|") === "Kitchen|Hall", `Adding a missing photo on Step 2 lost the room setup: ${JSON.stringify(addedRoomState)}`);
    assert(addedRoomState.added.title === "Kitchen view 4" && addedRoomState.added.space === "Kitchen" && addedRoomState.added.floor === "First floor", `The Step 2 upload did not inherit the current photo location: ${JSON.stringify(addedRoomState)}`);
    assert(addedRoomState.selectedSource === "Kitchen view 4" && addedRoomState.selectedStatus === "Selected source", `The newly added Step 2 photo was not selected for route setup: ${JSON.stringify(addedRoomState)}`);
    const sourceStripScroll = await page.evaluate(() => {
      const strip = document.querySelector("#editorRoomChoices");
      strip.scrollLeft = strip.scrollWidth;
      return { before: strip.scrollLeft, overflow: strip.scrollWidth > strip.clientWidth };
    });
    await page.locator(".editor-place-choice").filter({ hasText: "Kitchen view 1" }).click();
    const preservedSourceScroll = await page.evaluate(() => ({
      sourceScrollLeft: document.querySelector("#editorRoomChoices")?.scrollLeft || 0,
      selectedSource: document.querySelector(".editor-photo-choice.is-selected strong")?.textContent,
      selectedRoomBoard: document.querySelector(".editor-room-photo.is-selected input")?.value,
      linkedBadges: Array.from(document.querySelectorAll(".editor-photo-choice small")).map((node) => node.textContent)
    }));
    assert(!sourceStripScroll.overflow || preservedSourceScroll.sourceScrollLeft >= sourceStripScroll.before - 4, `Choosing a destination reset the source strip scroll: ${JSON.stringify({ sourceStripScroll, preservedSourceScroll })}`);
    assert(preservedSourceScroll.selectedSource === "Kitchen view 4" && preservedSourceScroll.selectedRoomBoard === "Kitchen view 4", `The selected source highlight did not persist across blocks: ${JSON.stringify(preservedSourceScroll)}`);
    assert(preservedSourceScroll.linkedBadges.some((text) => text.includes("outgoing") || text === "Selected source"), `Source strip did not expose linked/unlinked status: ${JSON.stringify(preservedSourceScroll)}`);
    await page.getByRole("button", { name: "Remove Kitchen view 4" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".editor-room-photo").length === 3);

    await page.getByRole("button", { name: "Preview Kitchen view 1" }).click();
    await page.getByRole("dialog", { name: "Kitchen view 1" }).waitFor({ state: "visible" });
    const previewImage = page.locator("#editorPreviewImage");
    await page.waitForFunction(() => document.querySelector("#editorPreviewImage")?.complete === true);
    assert((await previewImage.getAttribute("src")).includes("/__tour-editor/workspace/panoramas/"), "Preview must use the full panorama, not only a thumbnail.");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Kitchen view 1" }).waitFor({ state: "hidden" });

    const photoNames = page.locator(".editor-room-photo input");
    await photoNames.nth(0).fill("Kitchen window");
    await photoNames.nth(1).fill("Kitchen door");
    await photoNames.nth(2).fill("Hall entrance");
    const afterPhotoNames = await page.locator(".editor-room-photo input").evaluateAll((inputs) => inputs.map((input) => input.value));
    assert(afterPhotoNames[0] === "Kitchen window" && afterPhotoNames[1] === "Kitchen door", `Photo name input did not update the visible board: ${JSON.stringify(afterPhotoNames)}`);
    assert(await page.locator(".editor-room-photo__move-controls button").count() === 12, "Every photo card needs visible left/up/down/right move buttons.");
    const thirdPhoto = page.locator('.editor-room-photo[data-scene-id="scene-003"]');
    const hallColumn = page.locator(".editor-room-column").nth(1);
    const kitchenRoomId = await page.locator(".editor-room-column").nth(0).getAttribute("data-room-id");
    const hallRoomId = await hallColumn.getAttribute("data-room-id");
    const thirdRoomSelect = page.locator('.editor-room-photo[data-scene-id="scene-003"] select');
    await page.getByLabel("Move Hall entrance to next space").click();
    const dragState = await page.evaluate(() => ({
      columns: Array.from(document.querySelectorAll(".editor-room-column")).map((column) => ({
        roomId: column.dataset.roomId,
        scenes: Array.from(column.querySelectorAll(".editor-room-photo")).map((card) => card.dataset.sceneId)
      })),
      status: document.querySelector("#editorStatus")?.textContent
    }));
    assert(await hallColumn.locator(".editor-room-photo").count() === 1, `The right arrow did not move the photo into Hall: ${JSON.stringify(dragState)}`);
    assert(await thirdRoomSelect.nth(0).inputValue() === hallRoomId, "The room selector did not follow the right-arrow space move.");
    const thirdSelectors = page.locator('.editor-room-photo[data-scene-id="scene-003"] select');
    assert(await thirdSelectors.nth(1).locator("option", { hasText: "Second floor" }).count() === 1, "The photo card did not offer the second floor.");
    await thirdSelectors.nth(1).selectOption({ label: "Second floor" });
    assert(await thirdSelectors.nth(1).inputValue() !== await thirdSelectors.nth(0).inputValue(), "The floor selector was not independent from the space selector.");
    await page.getByLabel("Move Hall entrance to previous space").click();
    assert(await page.locator(".editor-room-column").nth(0).locator(".editor-room-photo").count() === 3, "The left arrow could not move a photo back.");
    assert(await thirdSelectors.nth(0).inputValue() === kitchenRoomId, "The room selector did not follow the left-arrow space move.");
    await page.locator('.editor-room-photo[data-scene-id="scene-001"]').scrollIntoViewIfNeeded();
    await page.getByLabel("Move Kitchen door up").click();
    const reorderedKitchenScenes = await page.locator(".editor-room-column").nth(0).locator(".editor-room-photo").evaluateAll((cards) => cards.map((card) => card.dataset.sceneId));
    assert(JSON.stringify(reorderedKitchenScenes) === JSON.stringify(["scene-002", "scene-001", "scene-003"]), `The up arrow did not reorder photos: ${JSON.stringify(reorderedKitchenScenes)}`);
    await page.getByLabel("Move Kitchen window up").click();
    const restoredKitchenScenes = await page.locator(".editor-room-column").nth(0).locator(".editor-room-photo").evaluateAll((cards) => cards.map((card) => card.dataset.sceneId));
    assert(JSON.stringify(restoredKitchenScenes) === JSON.stringify(["scene-001", "scene-002", "scene-003"]), `Could not restore room order with the up arrow: ${JSON.stringify(restoredKitchenScenes)}`);
    await page.locator('.editor-room-photo[data-scene-id="scene-003"] select').nth(0).selectOption(hallRoomId);
    assert(await page.locator(".editor-room-column").nth(1).locator(".editor-room-photo").count() === 1, "The Room menu did not move the photo back to Hall.");
    await waitForWorkspaceStructure(page, (project) =>
      project.rooms.map((room) => room.label).join("|") === "Kitchen|Hall" &&
      project.floors.map((floor) => floor.label).join("|") === "First floor|Second floor" &&
      project.scenes.map((scene) => scene.id).join("|") === "scene-001|scene-002|scene-003" &&
      project.scenes.find((scene) => scene.id === "scene-001")?.title === "Kitchen window" &&
      project.scenes.find((scene) => scene.id === "scene-002")?.title === "Kitchen door" &&
      project.scenes.find((scene) => scene.id === "scene-003")?.spaceLabel === "Hall" &&
      project.scenes.find((scene) => scene.id === "scene-003")?.floorLabel === "Second floor"
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertOneTask(page, "Set up spaces and walking routes");
    await page.waitForFunction(() => document.querySelectorAll("#editorRoomList input").length === 2 && document.querySelectorAll(".editor-room-photo").length === 3);
    const reloadState = await page.evaluate(async () => ({
      rooms: Array.from(document.querySelectorAll("#editorRoomList input")).map((input) => input.value),
      floors: Array.from(document.querySelectorAll("#editorFloorList input")).map((input) => input.value),
      cards: Array.from(document.querySelectorAll(".editor-room-photo")).map((card) => ({
        sceneId: card.dataset.sceneId,
        title: card.querySelector("input")?.value,
        selectedFloor: card.querySelectorAll("select")[1]?.selectedOptions[0]?.textContent
      })),
      project: (await (await fetch("/__tour-editor/workspace-project", { cache: "no-store" })).json()).project
    }));
    assert(reloadState.rooms[0] === "Kitchen" && reloadState.rooms[1] === "Hall", `Reload lost saved space names: ${JSON.stringify(reloadState)}`);
    assert(reloadState.floors[0] === "First floor" && reloadState.floors[1] === "Second floor", `Reload lost saved floor names: ${JSON.stringify(reloadState)}`);
    assert(await page.locator('.editor-room-photo[data-scene-id="scene-001"] input').inputValue() === "Kitchen window", `Reload lost the first photo name: ${JSON.stringify(reloadState)}`);
    assert(await page.locator('.editor-room-photo[data-scene-id="scene-002"] input').inputValue() === "Kitchen door", `Reload lost the second photo name: ${JSON.stringify(reloadState)}`);
    assert(await page.locator(".editor-room-column").nth(1).locator(".editor-room-photo").count() === 1, `Reload lost the photo space assignment: ${JSON.stringify(reloadState)}`);
    assert(await page.locator('.editor-room-photo[data-scene-id="scene-003"] select').nth(1).locator("option:checked").textContent() === "Second floor", `Reload lost the photo floor assignment: ${JSON.stringify(reloadState)}`);

    await page.getByRole("button", { name: "Connect in order" }).click();
    await waitForWorkspaceStructure(page, (project) => project.scenes.reduce((total, scene) => total + (scene.plannedTargets?.length || 0), 0) === 4);
    await page.getByText("Every neighbouring photo is connected in both directions.", { exact: true }).waitFor();
    assert(await page.getByText("Every neighbouring photo is connected in both directions.", { exact: true }).count() === 1, "Fast setup did not report a complete ordered route plan.");
    await page.getByRole("button", { name: "Undo automatic routes" }).click();
    await waitForWorkspaceStructure(page, (project) => project.scenes.every((scene) => (scene.plannedTargets?.length || 0) === 0));

    await page.locator(".editor-photo-choice").filter({ hasText: "Kitchen window" }).click();
    const sourceDestinationState = await page.evaluate(() => ({
      sourceCards: document.querySelectorAll(".editor-photo-choice-card").length,
      destinationCards: document.querySelectorAll(".editor-place-choice-card").length,
      sourceStatuses: Array.from(document.querySelectorAll(".editor-photo-choice")).map((button) => ({
        title: button.querySelector("strong")?.textContent,
        status: button.querySelector("small")?.textContent,
        selected: button.classList.contains("is-selected")
      })),
      currentCards: Array.from(document.querySelectorAll(".editor-place-choice-card.is-current-source")).map((card) => ({
        title: card.querySelector("strong")?.textContent,
        note: card.querySelector(".editor-choice-status")?.textContent,
        disabled: card.querySelector(".editor-place-choice")?.disabled
      })),
      groups: Array.from(document.querySelectorAll(".editor-place-choice-group")).map((group) => ({
        title: group.querySelector("header strong")?.textContent,
        count: group.querySelectorAll(".editor-place-choice-card").length,
        firstTitle: group.querySelector(".editor-place-choice strong")?.textContent
      }))
    }));
    assert(sourceDestinationState.destinationCards === sourceDestinationState.sourceCards, `The destination list hid the current source instead of showing it disabled: ${JSON.stringify(sourceDestinationState)}`);
    assert(sourceDestinationState.currentCards.length === 1 && sourceDestinationState.currentCards[0].title === "Kitchen window" && sourceDestinationState.currentCards[0].note === "Current photo" && sourceDestinationState.currentCards[0].disabled, `The current source was not shown as a disabled destination: ${JSON.stringify(sourceDestinationState)}`);
    assert(sourceDestinationState.sourceStatuses.some((item) => item.title === "Kitchen window" && item.status === "Selected source" && item.selected), `The source strip did not keep a clear selected-source marker: ${JSON.stringify(sourceDestinationState)}`);
    assert(sourceDestinationState.groups[0]?.title === "Same space" && sourceDestinationState.groups[0]?.firstTitle === "Kitchen window", `The destination list was not grouped with the current source first: ${JSON.stringify(sourceDestinationState)}`);
    await page.getByRole("button", { name: "Preview source Kitchen window" }).click();
    await page.getByRole("dialog", { name: "Kitchen window" }).waitFor({ state: "visible" });
    assert((await page.locator("#editorPreviewImage").getAttribute("src")).includes("/__tour-editor/workspace/panoramas/"), "Source route preview must use the full panorama.");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Kitchen window" }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Preview destination Kitchen door" }).click();
    await page.getByRole("dialog", { name: "Kitchen door" }).waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Kitchen door" }).waitFor({ state: "hidden" });
    const lastPreviewedDestination = await page.evaluate(() => ({
      title: document.querySelector(".editor-place-choice-card.is-recent-target strong")?.textContent,
      status: document.querySelector(".editor-place-choice-card.is-recent-target .editor-choice-status")?.textContent
    }));
    assert(lastPreviewedDestination.title === "Kitchen door" && lastPreviewedDestination.status === "Last previewed", `The lower destination block did not keep the last previewed card visible: ${JSON.stringify(lastPreviewedDestination)}`);
    await page.locator(".editor-place-planner").scrollIntoViewIfNeeded();
    const roomRouteScrollTop = await page.evaluate(() => document.querySelector(".editor-panel__content")?.scrollTop || 0);
    await page.locator(".editor-place-choice").filter({ hasText: "Kitchen door" }).click();
    const lastSelectedDestination = await page.evaluate(() => ({
      title: document.querySelector(".editor-place-choice-card.is-recent-target strong")?.textContent,
      status: document.querySelector(".editor-place-choice-card.is-recent-target .editor-choice-status")?.textContent
    }));
    assert(lastSelectedDestination.title === "Kitchen door" && lastSelectedDestination.status === "Selected destination", `The lower destination block did not keep the last selected card visible: ${JSON.stringify(lastSelectedDestination)}`);
    const roomRouteScrollAfterClick = await page.evaluate(() => document.querySelector(".editor-panel__content")?.scrollTop || 0);
    assert(roomRouteScrollAfterClick >= roomRouteScrollTop - 24, `Choosing a walking route jumped to the top: ${JSON.stringify({ roomRouteScrollTop, roomRouteScrollAfterClick })}`);
    assert(await page.locator(".editor-place-choice.is-selected").count() === 1, "The room board did not keep the selected destination visible.");
    const incomingOnlySourceState = await page.evaluate(() => (
      Array.from(document.querySelectorAll(".editor-photo-choice")).map((button) => ({
        title: button.querySelector("strong")?.textContent,
        status: button.querySelector("small")?.textContent,
        icon: button.querySelector("i")?.textContent,
        linkedClass: button.closest(".editor-photo-choice-card")?.className
      }))
    ));
    const kitchenDoorSource = incomingOnlySourceState.find((item) => item.title === "Kitchen door");
    const hallEntranceSource = incomingOnlySourceState.find((item) => item.title === "Hall entrance");
    assert(kitchenDoorSource?.status === "No outgoing yet" && kitchenDoorSource?.icon === "!", `An incoming-only source looked complete: ${JSON.stringify(incomingOnlySourceState)}`);
    assert(hallEntranceSource?.status === "No outgoing yet" && hallEntranceSource?.icon === "!", `An incoming-only source looked complete: ${JSON.stringify(incomingOnlySourceState)}`);
    await page.locator(".editor-photo-choice").filter({ hasText: "Kitchen door" }).click();
    const reverseSuggestionState = await page.evaluate(() => ({
      selectedSource: document.querySelector(".editor-photo-choice.is-selected strong")?.textContent,
      groups: Array.from(document.querySelectorAll(".editor-place-choice-group")).map((group) => ({
        title: group.querySelector("header strong")?.textContent,
        cards: Array.from(group.querySelectorAll(".editor-place-choice strong")).map((node) => node.textContent)
      }))
    }));
    assert(reverseSuggestionState.groups[0]?.title === "Same space" && reverseSuggestionState.groups[0]?.cards.includes("Kitchen window"), `The reverse return candidate was not suggested first: ${JSON.stringify(reverseSuggestionState)}`);
    await page.locator(".editor-place-choice").filter({ hasText: "Kitchen window" }).click();
    await page.getByText("Walking buttons: Kitchen window", { exact: true }).waitFor();
    await page.locator(".editor-photo-choice").filter({ hasText: "Hall entrance" }).click();
    await page.locator(".editor-place-choice").filter({ hasText: "Kitchen window" }).click();
    await page.getByText("Walking buttons: Kitchen window", { exact: true }).waitFor();
    await page.evaluate(() => { document.querySelector(".editor-panel__content").scrollTop = 0; });
    await page.screenshot({ path: join(outputDir, "01-room-board-top-mobile.png") });
    await page.locator(".editor-place-planner").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outputDir, "01-room-board-places-mobile.png") });
    await page.getByRole("button", { name: "Save setup" }).click();

    await assertOneTask(page, "Choose the look");
    await page.screenshot({ path: join(outputDir, "01-look-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Bright", exact: true }).click();
    await page.getByRole("button", { name: "Use on all photos & continue" }).click();

    await page.setViewportSize({ width: 1280, height: 760 });
    await assertOneTask(page, "Place the walking buttons");
    await page.getByRole("button", { name: "Add walking button" }).click();
    await page.locator('.editor-add-route-preview[data-add-route-preview-target="scene-003"]').click();
    await page.locator(".editor-photo-preview__dialog").waitFor({ state: "visible" });
    assert((await page.locator("#editorPreviewImage").getAttribute("src")).includes("/__tour-editor/workspace/panoramas/"), "Step 4 add-route preview must open the full panorama.");
    await page.keyboard.press("Escape");
    await page.locator(".editor-photo-preview__dialog").waitFor({ state: "hidden" });
    await page.locator('.editor-add-route-option[data-add-route-target="scene-003"]').click();
    await page.waitForFunction(() => {
      const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot();
      return snapshot?.selected?.sceneId === "scene-001" && snapshot.selected.target === "scene-003";
    });
    const routeAddedOnPlacementStep = await page.evaluate(() => {
      const scene = window.__TOUR_EDITOR_API.sceneById["scene-001"];
      return {
        targets: scene.hotspots.map((hotspot) => hotspot.target),
        selected: window.__RAINDIGIT_STUDIO_DEBUG__.snapshot().selected,
        addMenuHidden: document.querySelector("#editorAddRouteMenu")?.hidden,
        advancedOpen: document.querySelector(".editor-placement-advanced")?.open
      };
    });
    assert(JSON.stringify(routeAddedOnPlacementStep.targets) === JSON.stringify(["scene-002", "scene-003"]), `Step 4 did not add the missed route to the current source: ${JSON.stringify(routeAddedOnPlacementStep)}`);
    assert(routeAddedOnPlacementStep.selected?.sceneId === "scene-001" && routeAddedOnPlacementStep.selected?.target === "scene-003", `The new Step 4 route was not selected for placement: ${JSON.stringify(routeAddedOnPlacementStep)}`);
    assert(routeAddedOnPlacementStep.addMenuHidden === true, `The Add walking button picker stayed open after choosing a route: ${JSON.stringify(routeAddedOnPlacementStep)}`);
    assert(routeAddedOnPlacementStep.advancedOpen === false, `Advanced placement actions are open on the default surface: ${JSON.stringify(routeAddedOnPlacementStep)}`);
    const movementThumbnails = await page.evaluate(() => Array.from(document.querySelectorAll(".editor-saved-movement__thumb img")).map((image) => ({
      src: image.getAttribute("src"),
      width: image.naturalWidth,
      height: image.naturalHeight
    })));
    assert(movementThumbnails.length === 2 && movementThumbnails.every((image) => image.src && image.width > 0 && image.height > 0), `Step 4 movement rows do not show destination thumbnails: ${JSON.stringify(movementThumbnails)}`);
    await page.locator('.editor-saved-movement[data-saved-movement-target="scene-003"] .editor-saved-movement__preview').click();
    await page.locator(".editor-photo-preview__dialog").waitFor({ state: "visible" });
    assert((await page.locator("#editorPreviewImage").getAttribute("src")).includes("/__tour-editor/workspace/panoramas/"), "Step 4 saved-route preview must open the full panorama.");
    await page.keyboard.press("Escape");
    await page.locator(".editor-photo-preview__dialog").waitFor({ state: "hidden" });
    await page.locator(".editor-placement-advanced summary").click();
    await page.getByRole("button", { name: "Remove this walking button" }).click();
    await page.waitForFunction(() => {
      const scene = window.__TOUR_EDITOR_API.sceneById["scene-001"];
      const projectScene = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot().workspaceProject?.scenes?.find((candidate) => candidate.id === "scene-001");
      return !scene.hotspots.some((hotspot) => hotspot.target === "scene-003") &&
        !projectScene?.plannedTargets?.includes("scene-003") &&
        document.querySelectorAll('.editor-saved-movement[data-saved-movement-target="scene-003"]').length === 0;
    });
    await page.getByRole("button", { name: "Add walking button" }).click();
    await page.locator('.editor-add-route-option[data-add-route-target="scene-003"]').click();
    await page.waitForFunction(() => {
      const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot();
      return snapshot?.selected?.sceneId === "scene-001" && snapshot.selected.target === "scene-003";
    });
    await waitForApi(page, "/__tour-editor/overrides?workspace=1", (draft) => (
      draft.uiState?.stage === "links" &&
        draft.uiState?.selected?.sceneId === "scene-001" &&
        draft.uiState?.selected?.target === "scene-003"
    ));
    await page.evaluate(async () => {
      const response = await fetch("/__tour-editor/overrides?workspace=1", { cache: "no-store" });
      const draft = await response.json();
      draft.sceneMetadata = {
        ...(draft.sceneMetadata || {}),
        "scene-001": { title: "Driveway view 1", subtitle: "360 photo" },
        "scene-002": { title: "Driveway view 2", subtitle: "360 photo" },
        "scene-003": { title: "Driveway view 10", subtitle: "360 photo" }
      };
      Object.values(draft.addedHotspots || {}).forEach((hotspots) => {
        hotspots.forEach((hotspot) => {
          if (hotspot.target === "scene-003") hotspot.label = "Go to Driveway view 10";
        });
      });
      const save = await fetch("/__tour-editor/save?workspace=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft)
      });
      if (!save.ok) throw new Error("Could not save stale draft fixture");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__?.snapshot();
      const status = document.querySelector("#editorStatus")?.textContent || "";
      return document.body.dataset.editorStage === "links" &&
        status !== "Loading project" &&
        snapshot?.selected?.sceneId === "scene-001" &&
        snapshot.selected.target === "scene-003";
    });
    await assertOneTask(page, "Place the walking buttons");
    const restoredRouteSelection = await page.evaluate(() => {
      const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot();
      return {
        stage: document.body.dataset.editorStage,
        selected: snapshot.selected,
        activeSceneId: snapshot.activeSceneId,
        sourceTitle: document.querySelector("#editorSceneName")?.textContent,
        targetTitle: document.querySelector('.editor-saved-movement[data-saved-movement-target="scene-003"] strong')?.textContent,
        guidance: document.querySelector("#editorLinkGuidance")?.textContent,
        runtimeTitles: ["scene-001", "scene-002", "scene-003"].map((id) => window.__TOUR_EDITOR_API.sceneById[id]?.title)
      };
    });
    assert(restoredRouteSelection.stage === "links" && restoredRouteSelection.selected?.sceneId === "scene-001" && restoredRouteSelection.selected?.target === "scene-003", `Reload did not restore the same walking target: ${JSON.stringify(restoredRouteSelection)}`);
    assert(restoredRouteSelection.sourceTitle === "Kitchen window" && restoredRouteSelection.targetTitle === "Hall entrance", `Stale draft scene names overrode the workspace project: ${JSON.stringify(restoredRouteSelection)}`);
    assert(!restoredRouteSelection.guidance.includes("Driveway view 10") && !restoredRouteSelection.runtimeTitles.includes("Driveway view 10"), `Step 4 still showed stale Driveway names after reload: ${JSON.stringify(restoredRouteSelection)}`);
    await page.getByRole("button", { name: "Previous walking button" }).click();
    await page.waitForFunction(() => {
      const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__?.snapshot();
      return document.body.dataset.editorStage === "links" &&
        snapshot?.selected?.sceneId === "scene-001" &&
        snapshot.selected.target === "scene-002";
    });
    await page.getByRole("button", { name: "Back" }).click();
    await assertOneTask(page, "Choose the look");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await assertOneTask(page, "Place the walking buttons");
    await page.locator('.editor-saved-movement[data-saved-movement-target="scene-002"]').click();
    await page.waitForFunction(() => {
      const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__?.snapshot();
      const marker = document.querySelector(".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
      return Boolean(marker &&
        snapshot?.activeSceneId === "scene-001" &&
        snapshot.selected?.sceneId === "scene-001" &&
        snapshot.selected.target === "scene-002" &&
        snapshot.viewerLoaded);
    });
    const sourceSceneId = await page.evaluate(() => window.__TOUR_EDITOR_API.viewer.getScene());

    const firstStart = (await addedHotspots(page, sourceSceneId)).find((hotspot) => hotspot.target === "scene-002");
    const draggedFirst = await dragElementCenter(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot", 92, 34);
    await page.getByText("Check the walking button on the photo.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Next walking button" }).waitFor();
    const firstMarker = await elementCenter(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
    assertNear(firstMarker.x, draggedFirst.end.x, 24, "The first walking button did not stay near the release pointer");
    assertNear(firstMarker.y, draggedFirst.end.y, 24, "The first walking button did not stay near the release pointer");
    let first = (await addedHotspots(page, sourceSceneId)).find((hotspot) => hotspot.target === "scene-002");
    if (!(first?.kind === "doorway" && first.positionConfirmed)) {
      const diagnostics = await page.evaluate(() => {
        const marker = document.querySelector(".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
        const box = marker?.getBoundingClientRect();
        const top = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
        return {
          snapshot: window.__RAINDIGIT_STUDIO_DEBUG__.snapshot(),
          selectedHotspot: (() => {
            const selected = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot().selected;
            return selected ? window.__TOUR_EDITOR_API.sceneById[selected.sceneId]?.hotspots[selected.hotspotIndex] : null;
          })(),
          marker: box && { x: box.left + box.width / 2, y: box.top + box.height / 2 },
          top: {
            tag: top?.tagName || null,
            className: top?.className?.baseVal || top?.className || null,
            hotspotId: top?.closest?.("[data-editor-hotspot-id]")?.dataset?.editorHotspotId || null
          },
          status: document.querySelector("#editorStatus")?.textContent
        };
      });
      const logResponse = await page.request.get(`${baseUrl}/__tour-editor/studio-log`);
      const logs = (await logResponse.json()).entries.slice(-20).map((entry) => ({ event: entry.event, details: entry.details, inventory: entry.inventory?.selected }));
      throw new Error(`The first walking button was not saved: ${JSON.stringify({ first, diagnostics, logs })}`);
    }
    assert(first.pitch !== firstStart.pitch || first.yaw !== firstStart.yaw, "Dragging the first walking button did not change its stored coordinates.");
    const reviewMoveState = await page.evaluate(() => ({
      centreHidden: document.querySelector(".editor-centre-target")?.hidden,
      confirmHidden: document.querySelector("#editorConfirmCentre")?.hidden,
      continueLabel: document.querySelector("#editorContinue")?.textContent.trim()
    }));
    assert(reviewMoveState.centreHidden === true && reviewMoveState.confirmHidden === true && reviewMoveState.continueLabel === "Next walking button", `Movement placement still exposes centre-cross controls: ${JSON.stringify(reviewMoveState)}`);
    await page.getByRole("button", { name: "Next walking button" }).click();

    await page.waitForFunction(() => {
      const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__?.snapshot();
      return Boolean(document.querySelector(".nav-hotspot-anchor.is-editor-selected .nav-hotspot") &&
        snapshot?.activeSceneId === "scene-001" &&
        snapshot.selected?.sceneId === "scene-001" &&
        snapshot.selected.target === "scene-003" &&
        snapshot.viewerLoaded);
    });
    const draggedSecond = await dragElementCenter(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot", -112, 28);
    await page.getByText("Check the walking button on the photo.", { exact: true }).waitFor();
    const secondMarker = await elementCenter(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
    assertNear(secondMarker.x, draggedSecond.end.x, 24, "The second walking button did not stay near the release pointer");
    assertNear(secondMarker.y, draggedSecond.end.y, 24, "The second walking button did not stay near the release pointer");
    const both = await addedHotspots(page, sourceSceneId);
    const firstAfterSecond = both.find((hotspot) => hotspot.target === "scene-002");
    const second = both.find((hotspot) => hotspot.target === "scene-003");
    assert(both.length === 2 && firstAfterSecond?.positionConfirmed && second?.positionConfirmed, `Two independent points were not preserved: ${JSON.stringify(both)}`);
    assert(JSON.stringify(firstAfterSecond) === JSON.stringify(first), `Placing the second point changed the first point: ${JSON.stringify({ first, both })}`);
    assert(firstAfterSecond.pitch !== second.pitch || firstAfterSecond.yaw !== second.yaw, "Two points collapsed onto the same panorama coordinate.");
    await page.locator('.editor-saved-movement[data-saved-movement-target="scene-002"]').click();
    await page.waitForFunction((expected) => {
      const viewer = window.__TOUR_EDITOR_API.viewer;
      const yawDelta = Math.abs((((viewer.getYaw() - expected.yaw + 540) % 360) - 180));
      return Math.abs(viewer.getPitch() - expected.pitch) < 0.2 && yawDelta < 0.2 && Math.abs(viewer.getHfov() - 94) < 0.2;
    }, firstAfterSecond);
    const focusedFromList = await page.evaluate(() => {
      const row = document.querySelector('.editor-saved-movement[data-saved-movement-target="scene-002"]');
      const list = document.querySelector("#editorHotspotList");
      const rowBox = row?.getBoundingClientRect();
      const listBox = list?.getBoundingClientRect();
      return {
        rowSelected: row?.classList.contains("is-selected") || false,
        rowVisible: Boolean(rowBox && listBox && rowBox.top >= listBox.top - 1 && rowBox.bottom <= listBox.bottom + 1),
        selected: window.__RAINDIGIT_STUDIO_DEBUG__.snapshot().selected
      };
    });
    assert(focusedFromList.rowSelected && focusedFromList.rowVisible && focusedFromList.selected?.target === "scene-002", `Selecting a saved route row did not focus its marker and row: ${JSON.stringify(focusedFromList)}`);
    await page.locator("#panorama").dblclick({ position: { x: 360, y: 260 } });
    await page.waitForTimeout(150);
    const hfovAfterDoubleClick = await page.evaluate(() => Math.round(window.__TOUR_EDITOR_API.viewer.getHfov() * 10) / 10);
    assertNear(hfovAfterDoubleClick, 94, 0.2, "Double click changed the Studio zoom");
    await page.evaluate((expected) => window.__TOUR_EDITOR_API.viewer.lookAt(expected.pitch, expected.yaw, Math.min(window.__TOUR_EDITOR_API.viewer.getHfov(), 86), 0), second);
    await page.locator('[data-editor-hotspot-id="scene-001::1"] .nav-hotspot').click();
    await page.waitForFunction(() => {
      const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__?.snapshot();
      const row = document.querySelector('.editor-saved-movement[data-saved-movement-target="scene-003"]');
      return snapshot?.selected?.target === "scene-003" && row?.classList.contains("is-selected");
    });
    const afterMarkerClick = await addedHotspots(page, sourceSceneId);
    assert(JSON.stringify(afterMarkerClick.find((hotspot) => hotspot.target === "scene-002")) === JSON.stringify(firstAfterSecond), "Clicking a walking person changed the first point coordinates.");
    assert(JSON.stringify(afterMarkerClick.find((hotspot) => hotspot.target === "scene-003")) === JSON.stringify(second), "Clicking a walking person changed the selected point coordinates.");
    await page.getByRole("button", { name: "Next walking button" }).click();
    while (await page.evaluate(() => document.body.dataset.editorStage === "links" && window.__TOUR_EDITOR_API.scenes.flatMap((scene) => scene.hotspots).some((hotspot) => hotspot.positionConfirmed === false))) {
      await page.waitForFunction(() => Boolean(document.querySelector(".nav-hotspot-anchor.is-editor-selected .nav-hotspot")));
      await dragElementCenter(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot", 66, 20);
      await page.getByRole("button", { name: /Next walking button|Choose first views/ }).waitFor();
      if (await page.getByRole("button", { name: "Next walking button" }).isVisible().catch(() => false)) {
        await page.getByRole("button", { name: "Next walking button" }).click();
      }
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: join(outputDir, "02-movements-desktop.png"), fullPage: true });

    for (let guard = 0; guard < 8; guard += 1) {
      const backLabel = await page.locator("#editorBack").textContent();
      if (backLabel?.trim() === "Back") break;
      await page.getByRole("button", { name: "Previous walking button" }).click();
      await page.waitForTimeout(250);
    }
    await page.getByRole("button", { name: "Back" }).click();
    await assertOneTask(page, "Choose the look");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await assertOneTask(page, "Place the walking buttons");
    const confirmedAfterBack = await page.evaluate(() => window.__TOUR_EDITOR_API.scenes.flatMap((scene) => scene.hotspots).filter((hotspot) => hotspot.positionConfirmed).length);
    assert(confirmedAfterBack === 4, "Back navigation lost saved movement points.");
    assert(await page.locator(".editor-walking-icon").count() >= 1, "Walking buttons do not use one consistent person icon.");
    const arrivalReadinessBefore = await page.evaluate(() => {
      const pendingHotspots = window.__TOUR_EDITOR_API.scenes.flatMap((scene) => scene.hotspots).filter((hotspot) => hotspot.arrivalConfirmed === false);
      return {
        pendingRoutes: pendingHotspots.length,
        pendingDestinations: new Set(pendingHotspots.map((hotspot) => hotspot.target)).size
      };
    });
    const pendingBeforeArrival = arrivalReadinessBefore.pendingDestinations;
    assert(arrivalReadinessBefore.pendingRoutes === 4, `Expected four pending incoming routes, found ${arrivalReadinessBefore.pendingRoutes}.`);
    assert(pendingBeforeArrival === 3, `Repeated destinations must be reviewed once, found ${pendingBeforeArrival} destination views.`);
    await page.setViewportSize({ width: 390, height: 605 });
    await page.getByRole("button", { name: "Choose first views" }).click();
    await page.waitForTimeout(2_000);
    const stageAfterMobileContinue = await page.evaluate(() => ({
      stage: document.body.dataset.editorStage,
      status: document.querySelector("#editorStatus")?.textContent,
      continueDisabled: document.querySelector("#editorContinue")?.disabled,
      continueHidden: document.querySelector("#editorContinue")?.hidden,
      viewerLoaded: window.__TOUR_EDITOR_API.viewer.isLoaded()
    }));
    assert(stageAfterMobileContinue.stage === "arrival", `Mobile continue did not advance: ${JSON.stringify(stageAfterMobileContinue)}`);

    await assertOneTask(page, "Choose what people see first");
    await waitForApi(page, "/__tour-editor/overrides?workspace=1", (draft) => draft.uiState?.stage === "arrival");
    await page.goto(`${baseUrl}/?edit=1`, { waitUntil: "domcontentloaded" });
    await assertOneTask(page, "Start a tour");
    await page.getByText("Unfinished tour: Guided Staff Journey", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Continue unfinished tour" }).click();
    await page.waitForFunction(() => {
      const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__?.snapshot();
      return document.body.dataset.editorStage === "arrival" &&
        snapshot?.selected &&
        snapshot.activeSceneId === snapshot.selected.sceneId &&
        snapshot.viewerLoaded;
    });
    await assertOneTask(page, "Choose what people see first");
    await page.getByRole("button", { name: "Open destination" }).waitFor();
    await page.screenshot({ path: join(outputDir, "03-first-view-mobile.png"), fullPage: true });
    const visitedArrivalTasks = new Set();
    for (let index = 0; index < pendingBeforeArrival; index += 1) {
      const currentStage = await page.evaluate(() => document.body.dataset.editorStage);
      if (currentStage !== "arrival") break;
      await page.waitForFunction(() => {
        const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot();
        return snapshot.selected && snapshot.activeSceneId === snapshot.selected.sceneId && snapshot.viewerLoaded;
      });
      await page.getByText(`First view ${index + 1} of ${pendingBeforeArrival}`, { exact: false }).waitFor();
      const openDestination = page.getByRole("button", { name: "Open destination" });
      await openDestination.waitFor();
      assert(await page.locator("#editorEditArrival").isHidden(), "Step 5 exposes a second open button instead of one primary action.");
      assert(await page.locator("#editorSaveArrival").isHidden(), "Step 5 exposes a hidden save button before the destination is open.");
      const route = await page.evaluate(() => {
        const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot();
        const selected = snapshot.selected;
        const hotspot = window.__TOUR_EDITOR_API.sceneById[selected.sceneId].hotspots[selected.hotspotIndex];
        return { source: selected.sceneId, hotspotIndex: selected.hotspotIndex, target: hotspot.target };
      });
      const taskKey = route.target;
      assert(!visitedArrivalTasks.has(taskKey), `First-view flow selected the same destination twice: ${taskKey}`);
      visitedArrivalTasks.add(taskKey);
      assert(typeof route.target === "string" && route.source !== route.target, `Movement has an invalid destination: ${JSON.stringify(route)}`);
      await openDestination.click();
      try {
        await page.waitForFunction((targetId) => window.__TOUR_EDITOR_API.viewer.getScene() === targetId, route.target, { timeout: 20_000 });
      } catch {
        const diagnostics = await page.evaluate(async ({ target }) => {
          const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot();
          const panorama = window.__TOUR_EDITOR_API.sceneById[target]?.panorama;
          const viewerBounds = document.querySelector("#panorama")?.getBoundingClientRect();
          const canvasBounds = document.querySelector(".pnlm-render-container canvas")?.getBoundingClientRect();
          let panoramaStatus = null;
          try { panoramaStatus = (await fetch(panorama, { cache: "no-store" })).status; } catch { panoramaStatus = "fetch-failed"; }
          return {
            snapshot,
            panorama,
            panoramaStatus,
            viewerBounds: viewerBounds && { width: viewerBounds.width, height: viewerBounds.height },
            canvasBounds: canvasBounds && { width: canvasBounds.width, height: canvasBounds.height }
          };
        }, route);
        throw new Error(`Opening the destination did not load it: ${JSON.stringify({ route, diagnostics, consoleErrors, requestFailures })}`);
      }
      await page.waitForFunction(() => window.__TOUR_EDITOR_API.viewer.isLoaded());
      const saveFirstView = page.getByRole("button", { name: "Save first view" });
      await saveFirstView.waitFor();
      assert(await page.locator("#editorSaveArrival").isHidden(), "Step 5 exposes a duplicate save button instead of one primary action.");
      await dragViewer(page, index === 0 ? 80 : -90);
      await saveFirstView.click();
      if (index < pendingBeforeArrival - 1) {
        await page.waitForFunction((previousTaskKey) => {
          const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot();
          if (document.body.dataset.editorStage === "polish" || document.body.dataset.editorStage === "export") return true;
          if (!snapshot.selected) return false;
          return `${snapshot.selected.sceneId}::${snapshot.selected.target}` !== previousTaskKey;
        }, taskKey);
      }
    }
    assert(visitedArrivalTasks.size === pendingBeforeArrival, `Each destination should be reviewed once: ${visitedArrivalTasks.size}/${pendingBeforeArrival}`);
    const pendingAfterSharedArrival = await page.evaluate(() => window.__TOUR_EDITOR_API.scenes.flatMap((scene) => scene.hotspots).filter((hotspot) => hotspot.arrivalConfirmed === false).length);
    assert(pendingAfterSharedArrival === 0, `Shared first views did not complete all routes: ${pendingAfterSharedArrival}`);

    await assertOneTask(page, "Final view and polish", { allowedPrimaryActions: 2 });
    const polishState = await page.evaluate(() => ({
      stage: document.body.dataset.editorStage,
      editButton: document.querySelector("#editorPolishEditToggle")?.textContent?.trim(),
      saveViewButton: document.querySelector("#editorPolishSaveView")?.textContent?.trim(),
      tourVisible: getComputedStyle(document.querySelector(".tour-shell")).visibility
    }));
    assert(polishState.stage === "polish", `Expected polish stage before publishing: ${JSON.stringify(polishState)}`);
    assert(polishState.editButton === "Correct walking buttons", `Polish edit button is unclear: ${JSON.stringify(polishState)}`);
    assert(polishState.saveViewButton === "Save this photo opening view", `Polish opening-view button is missing: ${JSON.stringify(polishState)}`);
    assert(polishState.tourVisible !== "hidden", `Polish stage must show the final tour preview: ${JSON.stringify(polishState)}`);
    if (await page.locator(".editor-polish-row").count()) {
      await page.locator(".editor-polish-row").first().click();
      await page.waitForFunction(() => window.__RAINDIGIT_STUDIO_DEBUG__?.snapshot().selected?.sceneId === window.__TOUR_EDITOR_API.viewer.getScene());
      await page.waitForFunction(() => !window.__RAINDIGIT_STUDIO_DEBUG__?.snapshot().viewportSettling, null, { timeout: 5000 });
      const openPanelProjection = await page.evaluate(() => {
        const selected = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot().selected;
        const hotspot = window.__TOUR_EDITOR_API.sceneById[selected.sceneId].hotspots[selected.hotspotIndex];
        window.__TOUR_EDITOR_API.viewer.lookAt(hotspot.pitch, hotspot.yaw, 94, false);
        return new Promise((resolve) => {
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            const viewer = document.querySelector("#panorama")?.getBoundingClientRect();
            const marker = document.querySelector(".nav-hotspot-anchor.is-editor-selected .nav-hotspot")?.getBoundingClientRect();
            resolve({
              editorOpen: document.body.classList.contains("is-editor-open"),
              viewerCenterX: Math.round((viewer.left + viewer.width / 2) * 10) / 10,
              viewerCenterY: Math.round((viewer.top + viewer.height / 2) * 10) / 10,
              markerCenterX: Math.round((marker.left + marker.width / 2) * 10) / 10,
              markerCenterY: Math.round((marker.top + marker.height / 2) * 10) / 10
            });
          }));
        });
      });
      assert(openPanelProjection.editorOpen === true, `Polish projection regression must test with the panel open: ${JSON.stringify(openPanelProjection)}`);
      assertNear(openPanelProjection.markerCenterX, openPanelProjection.viewerCenterX, 12, "Polish open-panel marker is horizontally mis-projected before full view");
      assertNear(openPanelProjection.markerCenterY, openPanelProjection.viewerCenterY, 12, "Polish open-panel marker is vertically mis-projected before full view");
    }
    await page.getByRole("button", { name: "Correct in full final view" }).click();
    await page.waitForFunction(() => !document.body.classList.contains("is-editor-open"));
    const fullViewLayout = await page.evaluate(() => {
      const shell = document.querySelector(".tour-shell")?.getBoundingClientRect();
      const panel = document.querySelector(".editor-panel");
      return {
        stage: document.body.dataset.editorStage,
        editorOpen: document.body.classList.contains("is-editor-open"),
        polishEditing: document.body.classList.contains("is-polish-editing"),
        shellWidth: Math.round(shell?.width || 0),
        shellHeight: Math.round(shell?.height || 0),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        panelDisplay: panel ? getComputedStyle(panel).display : null
      };
    });
    assert(fullViewLayout.stage === "polish" && !fullViewLayout.editorOpen, `Polish full-view toggle left the editor open: ${JSON.stringify(fullViewLayout)}`);
    assert(fullViewLayout.polishEditing === true, `Polish full-view correction did not enable marker editing: ${JSON.stringify(fullViewLayout)}`);
    assert(fullViewLayout.shellWidth >= fullViewLayout.viewportWidth - 2 && fullViewLayout.shellHeight >= fullViewLayout.viewportHeight - 2, `Polish full-view toggle did not restore a full-size viewer: ${JSON.stringify(fullViewLayout)}`);
    assert(fullViewLayout.panelDisplay === "none", `Polish full-view toggle did not hide the panel: ${JSON.stringify(fullViewLayout)}`);
    await page.getByRole("button", { name: "Show tour studio" }).click();
    await page.waitForFunction(() => document.body.classList.contains("is-editor-open") && document.body.dataset.editorStage === "polish");
    const polishDragSceneId = await page.evaluate(async () => {
      const api = window.__TOUR_EDITOR_API;
      const scene = api.scenes.find((candidate) => candidate.hotspots.length > 0);
      if (!scene) return null;
      await new Promise((resolve) => {
        if (api.viewer.getScene() === scene.id && api.viewer.isLoaded()) {
          resolve();
          return;
        }
        const onSceneChange = (sceneId) => {
          if (sceneId !== scene.id) return;
          api.viewer.off("scenechange", onSceneChange);
          window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
        };
        api.viewer.on("scenechange", onSceneChange);
        api.viewer.loadScene(scene.id);
      });
      return scene.id;
    });
    assert(polishDragSceneId, "Polish drag regression needs at least one walking button.");
    if (await page.getByRole("button", { name: "Correct walking buttons" }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Correct walking buttons" }).click();
    }
    await page.getByRole("button", { name: "Finish walking-button correction" }).waitFor();
    await page.locator(".editor-polish-row").first().click();
    await page.waitForFunction(() => window.__RAINDIGIT_STUDIO_DEBUG__?.snapshot().selected?.sceneId === window.__TOUR_EDITOR_API.viewer.getScene());
    const polishBeforeDrag = await page.evaluate(() => {
      const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot();
      const selected = snapshot.selected;
      const hotspot = window.__TOUR_EDITOR_API.scenes.find((scene) => scene.id === selected.sceneId).hotspots[selected.hotspotIndex];
      window.__TOUR_EDITOR_API.viewer.lookAt(hotspot.pitch, hotspot.yaw, 94, false);
      return {
        sceneId: selected.sceneId,
        hotspotIndex: selected.hotspotIndex,
        target: selected.target,
        pitch: hotspot.pitch,
        yaw: hotspot.yaw
      };
    });
    await page.waitForTimeout(200);
    const polishAnchorGeometry = await page.evaluate(() => {
      const viewer = document.querySelector("#panorama")?.getBoundingClientRect();
      const anchor = document.querySelector(".nav-hotspot-anchor.is-editor-selected")?.getBoundingClientRect();
      const markerElement = document.querySelector(".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
      const marker = markerElement?.getBoundingClientRect();
      const markerStyle = markerElement ? getComputedStyle(markerElement) : null;
      return {
        viewer: viewer && {
          centerX: Math.round((viewer.left + viewer.width / 2) * 10) / 10,
          centerY: Math.round((viewer.top + viewer.height / 2) * 10) / 10
        },
        anchor: anchor && {
          width: Math.round(anchor.width * 10) / 10,
          height: Math.round(anchor.height * 10) / 10,
          centerX: Math.round((anchor.left + anchor.width / 2) * 10) / 10,
          centerY: Math.round((anchor.top + anchor.height / 2) * 10) / 10
        },
        marker: marker && {
          width: Math.round(marker.width * 10) / 10,
          height: Math.round(marker.height * 10) / 10,
          centerX: Math.round((marker.left + marker.width / 2) * 10) / 10,
          centerY: Math.round((marker.top + marker.height / 2) * 10) / 10,
          outlineStyle: markerStyle?.outlineStyle,
          animationName: markerStyle?.animationName
        }
      };
    });
    assert(polishAnchorGeometry.anchor?.width >= 40 && polishAnchorGeometry.anchor?.height >= 40, `Selected walking button anchor is still zero-sized: ${JSON.stringify(polishAnchorGeometry)}`);
    assert(polishAnchorGeometry.marker.outlineStyle === "none" && polishAnchorGeometry.marker.animationName === "none", `Polish selected marker still has editor-only visual styling: ${JSON.stringify(polishAnchorGeometry)}`);
    assertNear(polishAnchorGeometry.marker.centerX, polishAnchorGeometry.viewer.centerX, 12, "Selected walking button is horizontally mis-anchored when centred");
    assertNear(polishAnchorGeometry.marker.centerY, polishAnchorGeometry.viewer.centerY, 12, "Selected walking button is vertically mis-anchored when centred");
    await page.evaluate(({ pitch, yaw }) => window.__TOUR_EDITOR_API.viewer.lookAt(pitch, yaw - 40, 94, false), polishBeforeDrag);
    await page.waitForTimeout(200);
    const polishDrag = await dispatchElementDrag(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot", 48, 18);
    await page.waitForFunction(() => document.querySelector("#editorSaveStatus")?.textContent?.includes("Saved locally"));
    const polishMarkerAfterDrag = await elementCenter(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
    assertNear(polishMarkerAfterDrag.x, polishDrag.end.x, 24, "The Polish walking button did not stay near the release pointer");
    assertNear(polishMarkerAfterDrag.y, polishDrag.end.y, 24, "The Polish walking button did not stay near the release pointer");
    const polishAfterDrag = await page.evaluate(({ sceneId, hotspotIndex }) => {
      const hotspot = window.__TOUR_EDITOR_API.scenes.find((scene) => scene.id === sceneId).hotspots[hotspotIndex];
      return { pitch: hotspot.pitch, yaw: hotspot.yaw };
    }, polishBeforeDrag);
    assert(Math.abs(polishAfterDrag.yaw - polishBeforeDrag.yaw) > 0.3 || Math.abs(polishAfterDrag.pitch - polishBeforeDrag.pitch) > 0.3, `Polish drag did not update runtime coordinates: ${JSON.stringify({ polishBeforeDrag, polishAfterDrag })}`);
    const polishDraft = await (await page.request.get(`${baseUrl}/__tour-editor/overrides?workspace=1`)).json();
    const polishBaseCount = await page.evaluate((sceneId) => window.__TOUR_EDITOR_API.getBaseHotspotCount(sceneId), polishBeforeDrag.sceneId);
    const polishSavedHotspot = polishDraft.addedHotspots?.[polishBeforeDrag.sceneId]?.[polishBeforeDrag.hotspotIndex - polishBaseCount];
    assert(polishSavedHotspot && Math.abs(polishSavedHotspot.yaw - polishAfterDrag.yaw) <= 0.2 && Math.abs(polishSavedHotspot.pitch - polishAfterDrag.pitch) <= 0.2, `Polish drag was not saved into draft addedHotspots: ${JSON.stringify({ polishBeforeDrag, polishAfterDrag, polishSavedHotspot })}`);
    const polishPreviewHref = await page.locator("#editorPreviewLink").getAttribute("href");
    assert(polishPreviewHref.includes("preview=1"), `Dirty Polish changes must invalidate stale release previews: ${polishPreviewHref}`);
    await page.getByRole("button", { name: "Finish walking-button correction" }).click();
    await page.getByRole("button", { name: "Save this photo opening view" }).click();
    await page.getByRole("button", { name: "Publish" }).click();
    await assertOneTask(page, "Check and publish");
    const readinessChecks = await page.locator("#editorReadiness li").allTextContents();
    const readyCheckCount = await page.locator("#editorReadiness li.is-ready").count();
    assert(readinessChecks.length >= 6 && readyCheckCount === readinessChecks.length, `Release preflight is incomplete: ${JSON.stringify(readinessChecks)}`);
    await page.screenshot({ path: join(outputDir, "03-publish-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Build & download web package" }).click();
    try {
      await page.getByRole("link", { name: "Download web package" }).waitFor({ timeout: 180_000 });
    } catch (error) {
      const diagnostics = await page.evaluate(async () => {
        let releaseStatus = null;
        try {
          releaseStatus = await (await fetch("/__tour-editor/release-status?workspace=1", { cache: "no-store" })).json();
        } catch (releaseError) {
          releaseStatus = { error: releaseError.message };
        }
        return {
          editorStatus: document.querySelector("#editorStatus")?.textContent,
          releaseStatus,
          releasePanelText: document.querySelector("#editorReleaseActions")?.textContent?.replace(/\s+/g, " ").trim()
        };
      });
      throw new Error(`Timed out waiting for the web package link: ${JSON.stringify(diagnostics)}`, { cause: error });
    }
    await page.screenshot({ path: join(outputDir, "04-publish-ready-mobile.png"), fullPage: true });
    const completedBuildProgress = await page.request.get(`${baseUrl}/__tour-editor/release-build-status?workspace=1`);
    const completedBuildState = await completedBuildProgress.json();
    assert(completedBuildState.phase === "complete" && completedBuildState.percent === 100, `Build progress did not finish cleanly: ${JSON.stringify(completedBuildState)}`);
    await page.evaluate(() => window.__RAINDIGIT_STUDIO_DEBUG__.flush());
    const logResponse = await page.request.get(`${baseUrl}/__tour-editor/studio-log`);
    const logBody = await logResponse.json();
    const events = new Set(logBody.entries.map((entry) => entry.event));
    for (const required of ["tour-setup-complete", "planned-place-toggled", "planned-places-synchronised", "walking-button-removed-from-placement", "movement-drag-end-coordinate", "movement-drag-screen-check", "operator-step", "draft-save-success"]) {
      assert(events.has(required), `Diagnostic journal is missing ${required}.`);
    }
    const logPath = join(root, "workspace", "studio-debug.ndjson");
    assert((await stat(logPath)).size > 0, "The bounded diagnostic journal was not written.");
    const logText = await readFile(logPath, "utf8");
    assert(!/data:image|blob:/i.test(logText), "The diagnostic journal contains media payloads.");
    assert(consoleErrors.length === 0, `Studio console errors: ${consoleErrors.join(" | ")}`);

    const href = await page.getByRole("link", { name: "Download web package" }).getAttribute("href");
    const releaseResponse = await page.request.get(new URL(href, baseUrl).href);
    assert(releaseResponse.ok() && (await releaseResponse.body()).length > 100_000, "The optimized website package was not built correctly.");
    const statusBeforePortableBuild = await (await page.request.get(`${baseUrl}/__tour-editor/release-status?workspace=1`)).json();
    const reusedBuildResponse = await page.request.post(`${baseUrl}/__tour-editor/build-release?workspace=1`, {
      data: {
        slug: statusBeforePortableBuild.multires.slug,
        tourVersion: statusBeforePortableBuild.multires.tourVersion,
        changeSummary: statusBeforePortableBuild.multires.changeSummary
      }
    });
    const reusedBuild = await reusedBuildResponse.json();
    assert(reusedBuildResponse.ok() && reusedBuild.reused === true && reusedBuild.buildDurationMs === 0, `An unchanged release was rebuilt instead of reused: ${JSON.stringify(reusedBuild)}`);
    const artifactsBeforePortableBuild = await readdir(join(root, "artifacts"));
    assert(
      statusBeforePortableBuild.legacyReady === false && statusBeforePortableBuild.embedReady === false,
      `Primary web build unexpectedly prepared optional files: ${JSON.stringify({ statusBeforePortableBuild, artifactsBeforePortableBuild })}`
    );
    await page.getByText("Add it to a website", { exact: true }).click();
    await page.getByRole("button", { name: "Prepare embed & portable files" }).click();
    await waitForApi(page, "/__tour-editor/release-build-status?workspace=1", (progress) => (
      progress.active === false && progress.phase === "complete"
    ), 60_000);
    await waitForApi(page, "/__tour-editor/release-status?workspace=1", (status) => (
      status.legacyReady === true && status.embedReady === true
    ), 10_000);
    const portableBuildState = await (await page.request.get(`${baseUrl}/__tour-editor/release-build-status?workspace=1`)).json();
    assert(portableBuildState.phase === "complete" && portableBuildState.percent === 100, `Portable build progress did not finish cleanly after ${portableBuildRequests} request(s): ${JSON.stringify(portableBuildState)}`);
    assert(portableBuildRequests === 1, `Portable build started ${portableBuildRequests} times from one employee action.`);
    const preEmbedStatus = await (await page.request.get(`${baseUrl}/__tour-editor/release-status?workspace=1`)).json();
    const embedResponse = await page.request.get(`${baseUrl}/__tour-editor/release-embed-download?workspace=1`);
    const embedSource = await embedResponse.text();
    const postEmbedStatus = await (await page.request.get(`${baseUrl}/__tour-editor/release-status?workspace=1`)).json();
    assert(
      embedResponse.ok() && embedSource.length > 10_000 && /raindigit|360 virtual tour/i.test(embedSource),
      `Optional paste-in embed was not prepared correctly: ${JSON.stringify({ status: embedResponse.status(), bytes: embedSource.length, prefix: embedSource.slice(0, 120), preEmbedStatus, postEmbedStatus })}`
    );
    const postDownloadStatus = await page.request.get(`${baseUrl}/__tour-editor/status`);
    assert((await postDownloadStatus.json()).workspaceAvailable === true, "Downloading a release must preserve the editable working tour.");
    await page.getByRole("button", { name: "Archive and finish tour" }).click();
    await waitForApi(page, "/__tour-editor/status", (status) => status.workspaceAvailable === false, 20_000);
    await page.getByText("Recent archived tours", { exact: true }).waitFor({ timeout: 10_000 });
    const archivedOpenButton = page.locator("#editorArchiveList button", { hasText: "Open" }).first();
    await archivedOpenButton.waitFor({ timeout: 10_000 });
    const archiveSlugs = await readdir(join(root, "archives"));
    assert(archiveSlugs.length === 1, `Expected one safe project archive, found ${archiveSlugs.length}.`);
    const archivedFiles = await readdir(join(root, "archives", archiveSlugs[0]));
    assert(archivedFiles.length === 1 && archivedFiles[0].endsWith(".rdtour"), `Safe project archive was not created: ${archivedFiles.join(", ")}`);
    await archivedOpenButton.click();
    await waitForApi(page, "/__tour-editor/workspace-project", (body) => body.project?.scenes?.length === 3, 20_000);
    assert(new URL(page.url()).searchParams.get("workspace") === "1", `Restored archive did not reopen in workspace mode: ${page.url()}`);

    console.log(JSON.stringify({
      passed: true,
      photos: 3,
      rooms: 2,
      visualRoomBoard: true,
      unifiedWalkingButtons: true,
      independentPoints: true,
      backNavigation: true,
      firstViews: visitedArrivalTasks.size,
      releaseBuilt: true,
      optionalPortableBuild: true,
      downloadPreservesWorkspace: true,
      explicitArchiveClearsWorkspace: true,
      archiveRestore: true,
      preflightChecks: readinessChecks.length,
      buildProgress: completedBuildState.phase,
      webBuildMs: completedBuildState.buildDurationMs,
      portableBuildMs: portableBuildState.buildDurationMs,
      mobile: true,
      diagnosticEvents: events.size
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) {
      const exited = new Promise((resolvePromise) => server.once("exit", resolvePromise));
      server.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000))]);
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (server.exitCode && server.exitCode !== 0) throw new Error(`Guided flow server failed: ${serverError}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
