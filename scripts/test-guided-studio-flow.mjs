#!/usr/bin/env node

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
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

async function assertOneTask(page, heading) {
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
  assert(primaryActions.length <= 1, `${heading} exposes primary actions: ${primaryActions.join(" | ")}`);
  const layout = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const footer = document.querySelector(".editor-panel__footer")?.getBoundingClientRect();
    return {
      viewport,
      scrollWidth: document.documentElement.scrollWidth,
      footerBottom: footer?.bottom || 0,
      windowHeight: window.innerHeight
    };
  });
  assert(layout.scrollWidth <= layout.viewport, `${heading} has horizontal overflow: ${JSON.stringify(layout)}`);
  assert(layout.footerBottom <= layout.windowHeight + 1, `${heading} footer is outside the viewport: ${JSON.stringify(layout)}`);
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
  await page.waitForFunction(async (predicateSource) => {
    const response = await fetch("/__tour-editor/workspace-project", { cache: "no-store" });
    const body = await response.json();
    const project = body.project;
    if (!project) return false;
    return Function("project", `return (${predicateSource})(project);`)(project);
  }, predicate.toString(), { timeout: 10_000 });
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
      INSTA360_TOUR_RELEASE: join(root, "release")
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
    await page.getByRole("button", { name: "Continue current tour" }).click();
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
    await page.getByRole("button", { name: "Continue" }).click();

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
    await roomNames.nth(1).fill("Wrong space");
    await roomNames.nth(1).press("Tab");
    await roomNames.nth(2).fill("Hall");
    await roomNames.nth(2).press("Tab");
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

    await page.getByRole("button", { name: "Kitchen window", exact: true }).click();
    await page.locator(".editor-place-planner").scrollIntoViewIfNeeded();
    const roomRouteScrollTop = await page.evaluate(() => document.querySelector(".editor-panel__content")?.scrollTop || 0);
    await page.locator(".editor-place-choice").filter({ hasText: "Kitchen door" }).click();
    const roomRouteScrollAfterClick = await page.evaluate(() => document.querySelector(".editor-panel__content")?.scrollTop || 0);
    assert(roomRouteScrollAfterClick >= roomRouteScrollTop - 24, `Choosing a walking route jumped to the top: ${JSON.stringify({ roomRouteScrollTop, roomRouteScrollAfterClick })}`);
    await page.locator(".editor-place-choice").filter({ hasText: "Hall entrance" }).click();
    await page.getByText("Walking buttons: Kitchen door, Hall entrance", { exact: true }).waitFor();
    assert(await page.locator(".editor-place-choice.is-selected").count() === 2, "The room board did not keep two selected places.");
    await page.getByRole("button", { name: "Kitchen door", exact: true }).click();
    await page.locator(".editor-place-choice").filter({ hasText: "Kitchen window" }).click();
    await page.getByText("Walking buttons: Kitchen window", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Hall entrance", exact: true }).click();
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
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const label = (await page.locator("#editorContinue").textContent()).trim();
      if (label === "Continue") break;
      assert(label === "Next photo", `Unexpected look-step action: ${label}`);
      await page.locator("#editorContinue").click();
      await page.waitForTimeout(500);
    }
    assert((await page.locator("#editorContinue").textContent()).trim() === "Continue", "The look step did not reach the final Continue action.");
    await page.locator("#editorContinue").click();

    await page.setViewportSize({ width: 1280, height: 760 });
    await assertOneTask(page, "Place the walking buttons");
    await page.waitForFunction(() => {
      const button = document.querySelector("#editorConfirmCentre");
      return button && !button.disabled;
    });
    const sourceSceneId = await page.evaluate(() => window.__TOUR_EDITOR_API.viewer.getScene());

    await dragViewer(page, 130);
    const firstPose = await viewerPose(page);
    const firstTarget = await elementCenter(page, ".editor-centre-target");
    await page.getByRole("button", { name: "Save point here" }).click();
    await page.getByText("Check the walking button on the photo.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Next walking button" }).waitFor();
    await waitForMarkerAt(page, firstTarget);
    const firstMarker = await elementCenter(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
    assertNear(firstMarker.x, firstTarget.x, 8, "The first walking button did not stay under the centre target after save");
    assertNear(firstMarker.y, firstTarget.y, 8, "The first walking button did not stay under the centre target after save");
    let first = (await addedHotspots(page, sourceSceneId))[0];
    assert(first?.kind === "doorway" && first.positionConfirmed, `The first walking button was not saved: ${JSON.stringify(first)}`);
    assertNear(first.pitch, firstPose.pitch, 1, "The first walking button pitch did not match the centre target");
    assertNear(first.yaw, firstPose.yaw, 1, "The first walking button yaw did not match the centre target");
    const draggedFirst = await dragElementCenter(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot", 92, 34);
    const firstAfterDrag = (await addedHotspots(page, sourceSceneId))[0];
    if (firstAfterDrag.pitch === first.pitch && firstAfterDrag.yaw === first.yaw) {
      const dragDiagnostics = await page.evaluate(() => ({
        status: document.querySelector("#editorStatus")?.textContent,
        snapshot: window.__RAINDIGIT_STUDIO_DEBUG__.snapshot(),
        topAtMarker: (() => {
          const element = document.querySelector(".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
          const box = element?.getBoundingClientRect();
          if (!box) return null;
          const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {
            tag: top?.tagName || null,
            className: top?.className?.baseVal || top?.className || null,
            hotspotId: top?.closest?.("[data-editor-hotspot-id]")?.dataset?.editorHotspotId || null
          };
        })()
      }));
      throw new Error(`Dragging a selected walking button did not change its coordinates: ${JSON.stringify({ first, firstAfterDrag, draggedFirst, dragDiagnostics })}`);
    }
    const draggedMarker = await elementCenter(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
    assertNear(draggedMarker.x, draggedFirst.end.x, 24, "Dragged walking button did not stay near the release pointer");
    assertNear(draggedMarker.y, draggedFirst.end.y, 24, "Dragged walking button did not stay near the release pointer");
    first = firstAfterDrag;
    await page.getByRole("button", { name: "Adjust point" }).click();
    await page.getByRole("button", { name: "Update point here" }).waitFor();
    const currentTargetWhileAdjusting = await elementCenter(page, ".editor-centre-target");
    await waitForMarkerAt(page, currentTargetWhileAdjusting);
    const currentMarkerWhileAdjusting = await elementCenter(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
    assertNear(currentMarkerWhileAdjusting.x, currentTargetWhileAdjusting.x, 8, "Editing an existing point did not show the selected marker under the centre target");
    assertNear(currentMarkerWhileAdjusting.y, currentTargetWhileAdjusting.y, 8, "Editing an existing point did not show the selected marker under the centre target");
    await page.getByRole("button", { name: "Update point here" }).click();
    await page.getByText("Check the walking button on the photo.", { exact: true }).waitFor();
    first = (await addedHotspots(page, sourceSceneId))[0];
    await page.getByRole("button", { name: "Next walking button" }).click();

    await dragViewer(page, -170);
    const secondPose = await viewerPose(page);
    const secondTarget = await elementCenter(page, ".editor-centre-target");
    await page.getByRole("button", { name: "Save point here" }).click();
    await page.getByText("Check the walking button on the photo.", { exact: true }).waitFor();
    await waitForMarkerAt(page, secondTarget);
    const secondMarker = await elementCenter(page, ".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
    assertNear(secondMarker.x, secondTarget.x, 8, "The second walking button did not stay under the centre target after save");
    assertNear(secondMarker.y, secondTarget.y, 8, "The second walking button did not stay under the centre target after save");
    const both = await addedHotspots(page, sourceSceneId);
    assert(both.length === 2 && both.every((hotspot) => hotspot.positionConfirmed), `Two independent points were not preserved: ${JSON.stringify(both)}`);
    assert(JSON.stringify(both[0]) === JSON.stringify(first), `Placing the second point changed the first point: ${JSON.stringify({ first, both })}`);
    assert(both[0].pitch !== both[1].pitch || both[0].yaw !== both[1].yaw, "Two points collapsed onto the same panorama coordinate.");
    assertNear(both[1].pitch, secondPose.pitch, 1, "The second walking button pitch did not match the centre target");
    assertNear(both[1].yaw, secondPose.yaw, 1, "The second walking button yaw did not match the centre target");
    await page.getByRole("button", { name: "Next walking button" }).click();
    while (await page.getByRole("button", { name: "Save point here" }).isVisible().catch(() => false)) {
      await page.waitForFunction(() => {
        const button = document.querySelector("#editorConfirmCentre");
        return button && !button.disabled;
      });
      await dragViewer(page, 70);
      await page.getByRole("button", { name: "Save point here" }).click();
      await page.getByRole("button", { name: /Next walking button|Choose first views/ }).waitFor();
      if (await page.getByRole("button", { name: "Next walking button" }).isVisible().catch(() => false)) {
        await page.getByRole("button", { name: "Next walking button" }).click();
      }
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: join(outputDir, "02-movements-desktop.png"), fullPage: true });

    await page.getByRole("button", { name: "Back" }).click();
    await assertOneTask(page, "Choose the look");
    await page.getByRole("button", { name: "Continue" }).click();
    await assertOneTask(page, "Place the walking buttons");
    const confirmedAfterBack = await page.evaluate(() => window.__TOUR_EDITOR_API.scenes.flatMap((scene) => scene.hotspots).filter((hotspot) => hotspot.positionConfirmed).length);
    assert(confirmedAfterBack === 4, "Back navigation lost saved movement points.");
    assert(await page.locator(".editor-walking-icon").count() >= 1, "Walking buttons do not use one consistent person icon.");
    const pendingBeforeArrival = await page.evaluate(() => window.__TOUR_EDITOR_API.scenes.flatMap((scene) => scene.hotspots).filter((hotspot) => hotspot.arrivalConfirmed === false).length);
    assert(pendingBeforeArrival === 4, `Expected four first views, found ${pendingBeforeArrival}.`);
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
    await page.waitForFunction(async () => {
      const response = await fetch("/__tour-editor/overrides?workspace=1", { cache: "no-store" });
      const draft = await response.json();
      return draft.uiState?.stage === "arrival";
    });
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
      const taskKey = `${route.source}::${route.hotspotIndex}`;
      assert(!visitedArrivalTasks.has(taskKey), `First-view flow selected the same movement twice: ${taskKey}`);
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
          if (document.body.dataset.editorStage === "export") return true;
          if (!snapshot.selected) return false;
          return `${snapshot.selected.sceneId}::${snapshot.selected.hotspotIndex}` !== previousTaskKey;
        }, taskKey);
      }
    }
    assert(visitedArrivalTasks.size === 3, `Repeated destinations should reuse a saved first view instead of asking again: ${visitedArrivalTasks.size}`);
    const pendingAfterSharedArrival = await page.evaluate(() => window.__TOUR_EDITOR_API.scenes.flatMap((scene) => scene.hotspots).filter((hotspot) => hotspot.arrivalConfirmed === false).length);
    assert(pendingAfterSharedArrival === 0, `Shared first views did not complete all routes: ${pendingAfterSharedArrival}`);

    await assertOneTask(page, "Check and publish");
    await page.screenshot({ path: join(outputDir, "03-publish-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Build the tour" }).click();
    await page.getByRole("link", { name: "Download website file" }).waitFor({ timeout: 90_000 });
    await page.evaluate(() => window.__RAINDIGIT_STUDIO_DEBUG__.flush());
    const logResponse = await page.request.get(`${baseUrl}/__tour-editor/studio-log`);
    const logBody = await logResponse.json();
    const events = new Set(logBody.entries.map((entry) => entry.event));
    for (const required of ["tour-setup-complete", "planned-place-toggled", "planned-places-synchronised", "movement-centre-confirmed", "movement-drag-screen-check", "operator-step", "draft-save-success"]) {
      assert(events.has(required), `Diagnostic journal is missing ${required}.`);
    }
    const logPath = join(root, "workspace", "studio-debug.ndjson");
    assert((await stat(logPath)).size > 0, "The bounded diagnostic journal was not written.");
    const logText = await readFile(logPath, "utf8");
    assert(!/data:image|blob:/i.test(logText), "The diagnostic journal contains media payloads.");
    assert(consoleErrors.length === 0, `Studio console errors: ${consoleErrors.join(" | ")}`);

    const href = await page.getByRole("link", { name: "Download website file" }).getAttribute("href");
    const releaseResponse = await page.request.get(new URL(href, baseUrl).href);
    assert(releaseResponse.ok() && (await releaseResponse.body()).length > 100_000, "The customer website file was not built correctly.");
    await page.waitForFunction(async () => {
      const response = await fetch("/__tour-editor/status", { cache: "no-store" });
      const status = await response.json();
      return status.workspaceAvailable === false;
    }, null, { timeout: 5_000 });
    const postExportStatus = await page.request.get(`${baseUrl}/__tour-editor/status`);
    assert((await postExportStatus.json()).workspaceAvailable === false, "Finished export did not clear the active working tour.");

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
      exportClearsWorkspace: true,
      mobile: true,
      diagnosticEvents: events.size
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    await rm(root, { recursive: true, force: true });
    if (server.exitCode && server.exitCode !== 0) throw new Error(`Guided flow server failed: ${serverError}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
