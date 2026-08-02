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
    for (const [index, colors] of [["#193746", "#d6af5c"], ["#385b48", "#e8d7a6"], ["#4b334f", "#8bc6b1"]].entries()) {
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

    await page.goto(`${baseUrl}/?edit=1`);
    await assertOneTask(page, "Start a tour");
    await page.getByLabel("Tour name").fill("Guided Staff Journey");
    await page.getByRole("button", { name: "Create new tour" }).click();
    await assertOneTask(page, "Add 360 photos");
    await page.locator("#editorImportFiles").setInputFiles(fixtures);
    await page.getByText("3 photos ready", { exact: true }).waitFor({ timeout: 90_000 });
    await page.getByRole("button", { name: "Continue" }).click();

    await page.setViewportSize({ width: 390, height: 605 });
    await assertOneTask(page, "Set up rooms and walking routes");
    await page.getByLabel("Number of rooms").fill("2");
    await page.getByRole("button", { name: "Update rooms" }).click();
    const roomNames = page.locator("#editorRoomList input");
    await roomNames.nth(0).fill("Kitchen");
    await roomNames.nth(0).press("Tab");
    await roomNames.nth(1).fill("Hall");
    await roomNames.nth(1).press("Tab");
    assert(await page.locator('.editor-room-photo[data-scene-id="scene-001"] input').inputValue() === "Kitchen view 1", "The first auto-named photo still looked like a generic View.");
    assert(await page.locator('.editor-room-photo[data-scene-id="scene-002"] input').inputValue() === "Kitchen view 2", "The second auto-named photo still looked like a generic View.");

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
    const thirdPhoto = page.locator('.editor-room-photo[data-scene-id="scene-003"]');
    const hallColumn = page.locator(".editor-room-column").nth(1);
    await thirdPhoto.locator(".editor-room-photo__select").dragTo(hallColumn);
    const dragState = await page.evaluate(() => ({
      columns: Array.from(document.querySelectorAll(".editor-room-column")).map((column) => ({
        roomId: column.dataset.roomId,
        scenes: Array.from(column.querySelectorAll(".editor-room-photo")).map((card) => card.dataset.sceneId)
      })),
      status: document.querySelector("#editorStatus")?.textContent
    }));
    assert(await hallColumn.locator(".editor-room-photo").count() === 1, `Dragging a photo did not move it into Hall: ${JSON.stringify(dragState)}`);
    const kitchenRoomId = await page.locator(".editor-room-column").nth(0).getAttribute("data-room-id");
    const hallRoomId = await hallColumn.getAttribute("data-room-id");
    const thirdRoomSelect = page.locator('.editor-room-photo[data-scene-id="scene-003"] select');
    assert(await thirdRoomSelect.inputValue() === hallRoomId, "The room selector did not follow the drag operation.");
    await thirdRoomSelect.selectOption(kitchenRoomId);
    assert(await page.locator(".editor-room-column").nth(0).locator(".editor-room-photo").count() === 3, "The accessible Room menu could not move a photo.");
    await page.locator('.editor-room-photo[data-scene-id="scene-001"]').scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const source = document.querySelector('.editor-room-photo[data-scene-id="scene-002"] .editor-room-photo__select');
      const target = document.querySelector('.editor-room-photo[data-scene-id="scene-001"]');
      const sourceBox = source.getBoundingClientRect();
      const targetBox = target.getBoundingClientRect();
      const start = { clientX: sourceBox.left + sourceBox.width / 2, clientY: sourceBox.top + sourceBox.height / 2 };
      const end = { clientX: targetBox.left + targetBox.width / 2, clientY: targetBox.top + targetBox.height / 2 };
      source.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ...start }));
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, button: 0, ...end }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, ...end }));
    });
    const reorderedKitchenScenes = await page.locator(".editor-room-column").nth(0).locator(".editor-room-photo").evaluateAll((cards) => cards.map((card) => card.dataset.sceneId));
    assert(JSON.stringify(reorderedKitchenScenes) === JSON.stringify(["scene-002", "scene-001", "scene-003"]), `Dragging within one room did not reorder photos: ${JSON.stringify(reorderedKitchenScenes)}`);
    await page.evaluate(() => {
      const source = document.querySelector('.editor-room-photo[data-scene-id="scene-001"] .editor-room-photo__select');
      const target = document.querySelector('.editor-room-photo[data-scene-id="scene-002"]');
      const sourceBox = source.getBoundingClientRect();
      const targetBox = target.getBoundingClientRect();
      const start = { clientX: sourceBox.left + sourceBox.width / 2, clientY: sourceBox.top + sourceBox.height / 2 };
      const end = { clientX: targetBox.left + targetBox.width / 2, clientY: targetBox.top + targetBox.height / 2 };
      source.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ...start }));
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, button: 0, ...end }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, ...end }));
    });
    const restoredKitchenScenes = await page.locator(".editor-room-column").nth(0).locator(".editor-room-photo").evaluateAll((cards) => cards.map((card) => card.dataset.sceneId));
    assert(JSON.stringify(restoredKitchenScenes) === JSON.stringify(["scene-001", "scene-002", "scene-003"]), `Could not restore room order after reorder test: ${JSON.stringify(restoredKitchenScenes)}`);
    await page.locator('.editor-room-photo[data-scene-id="scene-003"] select').selectOption(hallRoomId);
    assert(await page.locator(".editor-room-column").nth(1).locator(".editor-room-photo").count() === 1, "The Room menu did not move the photo back to Hall.");

    await page.getByRole("button", { name: "Kitchen window", exact: true }).click();
    await page.locator(".editor-place-choice").filter({ hasText: "Kitchen door" }).click();
    await page.locator(".editor-place-choice").filter({ hasText: "Hall entrance" }).click();
    await page.getByText("Walking buttons: Kitchen door, Hall entrance", { exact: true }).waitFor();
    assert(await page.locator(".editor-place-choice.is-selected").count() === 2, "The room board did not keep two selected places.");
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
    await page.getByRole("button", { name: "Save point here" }).click();
    const first = (await addedHotspots(page, sourceSceneId))[0];
    assert(first?.kind === "doorway" && first.positionConfirmed, `The first walking button was not saved: ${JSON.stringify(first)}`);

    await dragViewer(page, -170);
    await page.getByRole("button", { name: "Save point here" }).click();
    const both = await addedHotspots(page, sourceSceneId);
    assert(both.length === 2 && both.every((hotspot) => hotspot.positionConfirmed), `Two independent points were not preserved: ${JSON.stringify(both)}`);
    assert(JSON.stringify(both[0]) === JSON.stringify(first), `Placing the second point changed the first point: ${JSON.stringify({ first, both })}`);
    assert(both[0].pitch !== both[1].pitch || both[0].yaw !== both[1].yaw, "Two points collapsed onto the same panorama coordinate.");
    await page.screenshot({ path: join(outputDir, "02-movements-desktop.png"), fullPage: true });

    await page.getByRole("button", { name: "Back" }).click();
    await assertOneTask(page, "Choose the look");
    await page.getByRole("button", { name: "Continue" }).click();
    await assertOneTask(page, "Place the walking buttons");
    assert(await page.locator(".editor-saved-movement").count() === 2, "Back navigation lost saved movement points.");
    assert(await page.locator(".editor-walking-icon").count() >= 2, "Walking buttons do not use one consistent person icon.");
    const pendingBeforeArrival = await page.evaluate(() => window.__TOUR_EDITOR_API.scenes.flatMap((scene) => scene.hotspots).filter((hotspot) => hotspot.arrivalConfirmed === false).length);
    assert(pendingBeforeArrival === 2, `Expected two first views, found ${pendingBeforeArrival}.`);
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
    await page.screenshot({ path: join(outputDir, "03-first-view-mobile.png"), fullPage: true });
    const visitedArrivalTasks = new Set();
    for (let index = 0; index < 2; index += 1) {
      await page.waitForFunction(() => {
        const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot();
        return snapshot.selected && snapshot.activeSceneId === snapshot.selected.sceneId && snapshot.viewerLoaded;
      });
      await page.getByText(`First view ${index + 1} of 2`, { exact: false }).waitFor();
      const open = page.getByRole("button", { name: /^Open / });
      await open.waitFor();
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
      await open.click();
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
      const saveFirstView = page.getByRole("button", { name: "Save this first view" });
      await saveFirstView.waitFor();
      await dragViewer(page, index === 0 ? 80 : -90);
      await saveFirstView.click();
      if (index === 0) {
        await page.waitForFunction((previousTaskKey) => {
          const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__.snapshot();
          if (!snapshot.selected) return false;
          return `${snapshot.selected.sceneId}::${snapshot.selected.hotspotIndex}` !== previousTaskKey;
        }, taskKey);
      }
    }

    await assertOneTask(page, "Check and publish");
    await page.screenshot({ path: join(outputDir, "03-publish-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Build the tour" }).click();
    await page.getByRole("link", { name: "Download website file" }).waitFor({ timeout: 90_000 });
    const href = await page.getByRole("link", { name: "Download website file" }).getAttribute("href");
    const releaseResponse = await page.request.get(new URL(href, baseUrl).href);
    assert(releaseResponse.ok() && (await releaseResponse.body()).length > 100_000, "The customer website file was not built correctly.");

    await page.evaluate(() => window.__RAINDIGIT_STUDIO_DEBUG__.flush());
    const logResponse = await page.request.get(`${baseUrl}/__tour-editor/studio-log`);
    const logBody = await logResponse.json();
    const events = new Set(logBody.entries.map((entry) => entry.event));
    for (const required of ["tour-setup-complete", "planned-place-toggled", "planned-places-synchronised", "movement-centre-confirmed", "draft-save-success"]) {
      assert(events.has(required), `Diagnostic journal is missing ${required}.`);
    }
    const logPath = join(root, "workspace", "studio-debug.ndjson");
    assert((await stat(logPath)).size > 0, "The bounded diagnostic journal was not written.");
    const logText = await readFile(logPath, "utf8");
    assert(!/data:image|blob:/i.test(logText), "The diagnostic journal contains media payloads.");
    assert(consoleErrors.length === 0, `Studio console errors: ${consoleErrors.join(" | ")}`);

    console.log(JSON.stringify({
      passed: true,
      photos: 3,
      rooms: 2,
      visualRoomBoard: true,
      unifiedWalkingButtons: true,
      independentPoints: true,
      backNavigation: true,
      firstViews: 2,
      releaseBuilt: true,
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
