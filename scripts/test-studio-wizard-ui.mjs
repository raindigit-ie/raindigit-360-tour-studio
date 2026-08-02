#!/usr/bin/env node

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertSimpleStage(page, heading) {
  const title = page.getByRole("heading", { name: heading });
  await title.waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".editor-stage-panel[hidden]").length === 6);
  const panel = title.locator("xpath=ancestor::section[1]");
  const technicalCopy = await panel.innerText();
  assert(!/\b(panorama|pitch|yaw|hfov|iframe|json|rdtour)\b/i.test(technicalCopy), `${heading} exposes technical copy: ${technicalCopy}`);
  assert(await panel.locator(".editor-button--primary:visible").count() <= 1, `${heading} shows too many competing primary actions.`);
  const layout = await page.evaluate(() => {
    const editor = document.querySelector(".editor-panel").getBoundingClientRect();
    const content = document.querySelector(".editor-panel__content").getBoundingClientRect();
    const footer = document.querySelector(".editor-panel__footer").getBoundingClientRect();
    return {
      editor: { top: editor.top, bottom: editor.bottom },
      content: { top: content.top, bottom: content.bottom },
      footer: { top: footer.top, bottom: footer.bottom }
    };
  });
  assert(layout.footer.top >= layout.editor.top - 1, `${heading} footer starts above the editor: ${JSON.stringify(layout)}`);
  assert(layout.footer.bottom <= layout.editor.bottom + 1, `${heading} footer falls below the editor: ${JSON.stringify(layout)}`);
  assert(layout.content.bottom <= layout.footer.top + 1, `${heading} content overlaps the footer: ${JSON.stringify(layout)}`);
}

async function assertNoMobileOverflow(page, stage) {
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    panelRight: document.querySelector(".editor-panel")?.getBoundingClientRect().right || 0
  }));
  assert(layout.scrollWidth <= layout.viewport && layout.panelRight <= layout.viewport, `${stage} overflows on mobile: ${JSON.stringify(layout)}`);
}

async function viewerPose(page) {
  return page.evaluate(() => ({
    sceneId: window.__TOUR_EDITOR_API.viewer.getScene(),
    pitch: window.__TOUR_EDITOR_API.viewer.getPitch(),
    yaw: window.__TOUR_EDITOR_API.viewer.getYaw(),
    hfov: window.__TOUR_EDITOR_API.viewer.getHfov()
  }));
}

async function addedHotspots(page, sceneId) {
  return page.evaluate((id) => window.__TOUR_EDITOR_API.getAddedHotspots(id).map((hotspot) => ({
    pitch: hotspot.pitch,
    yaw: hotspot.yaw,
    targetSceneId: hotspot.targetSceneId,
    positionConfirmed: hotspot.positionConfirmed,
    arrivalConfirmed: hotspot.arrivalConfirmed
  })), sceneId);
}

async function dragPlacementSurface(page, deltaX, deltaY) {
  const surface = page.locator(".editor-placement-surface");
  const bounds = await surface.boundingBox();
  assert(bounds, "The placement surface is not visible.");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 8 });
  await page.mouse.up();
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
  throw new Error("ImageMagick is required for studio UI fixtures.");
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/__tour-editor/status`)).ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Timed out waiting for the studio UI test server.");
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "raindigit-studio-ui-test-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const baseUrl = `http://127.0.0.1:${port}`;
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
    for (const [index, colors] of [["#182e3b", "#d6af5c"], ["#274738", "#e8d7a6"], ["#3c293e", "#8bc6b1"], ["#3b3424", "#d47c64"]].entries()) {
      const path = join(root, `panorama-${index + 1}.jpg`);
      await runMagick(["-size", "2000x1000", `gradient:${colors[0]}-${colors[1]}`, "-quality", "90", path]);
      fixtures.push(path);
    }

    await waitForServer(baseUrl);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

    await page.goto(`${baseUrl}/?edit=1`);
    await assertSimpleStage(page, "Start a tour");
    assert(await page.getByText("Open saved work", { exact: true }).isVisible(), "Saved work must be available without cluttering the start screen.");
    assert(!await page.getByLabel("Choose saved tour").isVisible(), "Saved-work controls must start collapsed.");
    await page.getByLabel("Tour name").fill("Studio UI Journey");
    await page.getByRole("button", { name: "Create tour" }).click();
    await assertSimpleStage(page, "Add 360 photos");

    await page.locator("#editorImportFiles").setInputFiles(fixtures);
    await page.getByText("4 photos ready", { exact: true }).waitFor({ timeout: 90_000 });
    await page.getByRole("button", { name: "Continue" }).click();
    await assertSimpleStage(page, "Name rooms and views");

    await page.getByLabel("Room name: Room 1").fill("Kitchen");
    await page.getByText("Add another room", { exact: true }).click();
    await page.locator("#editorNewRoomName").fill("Hall");
    await page.getByRole("button", { name: "Add room" }).click();
    await page.locator("#editorNewRoomName").fill("Living room");
    await page.getByRole("button", { name: "Add room" }).click();
    await page.locator("#editorNewRoomName").fill("Temporary");
    await page.getByRole("button", { name: "Add room" }).click();
    await page.getByRole("button", { name: "Remove Temporary" }).click();
    assert(await page.locator(".editor-room").count() === 3, "An accidental empty room must be removable.");

    const cards = page.locator(".editor-project-scene");
    assert(await cards.count() === 4, "The Rooms screen must keep four stable photo cards.");
    const roomSelects = page.locator(".editor-project-scene select");
    await roomSelects.nth(0).selectOption({ label: "Kitchen" });
    await roomSelects.nth(1).selectOption({ label: "Kitchen" });
    await roomSelects.nth(2).selectOption({ label: "Hall" });
    await roomSelects.nth(3).selectOption({ label: "Living room" });
    const roomCounts = await page.locator("[data-room-count]").allTextContents();
    assert(JSON.stringify(roomCounts) === JSON.stringify(["2 views", "1 view", "1 view"]), `Room counts did not update: ${roomCounts.join(", ")}`);
    assert(await cards.count() === 4, "Assigning a room must not move a card under the pointer.");

    await page.getByRole("button", { name: "Continue" }).click();
    await assertSimpleStage(page, "Choose the look");
    assert(!await page.getByLabel("Brightness").isVisible(), "Professional picture controls must start collapsed.");
    await page.getByRole("button", { name: "Bright", exact: true }).click();
    await page.getByText("Fine tune picture", { exact: true }).click();
    await page.getByLabel("Brightness").fill("108");
    await page.getByRole("button", { name: "Continue" }).click();
    await assertSimpleStage(page, "Add ways to move");

    await page.getByText("Link options", { exact: true }).click();
    assert(await page.getByLabel("Movement type").inputValue() === "viewpoint", "A same-room destination must default to viewpoint.");
    assert(await page.getByLabel("Button name").inputValue() === "Go to View 2", "A same-room label must name the target viewpoint.");
    await page.getByLabel("Move to").selectOption({ label: "Hall - View 3" });
    assert(await page.getByLabel("Movement type").inputValue() === "doorway", "A different room must default to doorway.");
    assert(await page.getByLabel("Button name").inputValue() === "Walk to Hall", "A doorway label must name the target room.");
    await page.getByRole("button", { name: "Add and place" }).click();
    const sourceSceneId = (await viewerPose(page)).sceneId;
    assert(await page.getByRole("button", { name: "Place selected", exact: true }).getAttribute("aria-pressed") === "true", "Adding a movement must enter explicit placement mode.");
    const lockedPose = await viewerPose(page);
    await dragPlacementSurface(page, 140, 60);
    const poseAfterBlockedDrag = await viewerPose(page);
    assert(Math.abs(lockedPose.pitch - poseAfterBlockedDrag.pitch) < 0.01 && Math.abs(lockedPose.yaw - poseAfterBlockedDrag.yaw) < 0.01, `Placement mode moved the camera: ${JSON.stringify({ lockedPose, poseAfterBlockedDrag })}`);
    await page.locator(".editor-placement-surface").click({ position: { x: 270, y: 330 } });
    const firstPlaced = await addedHotspots(page, sourceSceneId);
    assert(firstPlaced.length === 1 && firstPlaced[0].positionConfirmed, `The first movement was not placed: ${JSON.stringify(firstPlaced)}`);
    assert(await page.getByRole("button", { name: "Rotate view" }).getAttribute("aria-pressed") === "true", "Placing a movement must return to rotate mode.");

    await page.getByText("Link options", { exact: true }).click();
    await page.getByLabel("Move to").selectOption({ label: "Living room - View 4" });
    await page.getByRole("button", { name: "Add and place" }).click();
    const firstBeforeSecondPlacement = (await addedHotspots(page, sourceSceneId))[0];
    await dragPlacementSurface(page, -120, 45);
    const firstAfterSecondDrag = (await addedHotspots(page, sourceSceneId))[0];
    assert(JSON.stringify(firstBeforeSecondPlacement) === JSON.stringify(firstAfterSecondDrag), `Moving the second point changed the first point: ${JSON.stringify({ firstBeforeSecondPlacement, firstAfterSecondDrag })}`);
    await page.getByRole("button", { name: "Rotate view" }).click();
    for (let index = 0; index < 3; index += 1) await page.locator("#editorNextScene").click();
    assert((await viewerPose(page)).sceneId !== sourceSceneId, "The test must leave the source view before checking incomplete work routing.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForFunction((id) => window.__TOUR_EDITOR_API.viewer.getScene() === id, sourceSceneId);
    assert(await page.locator(".editor-placement-surface").isVisible(), "Continue must return to the unplaced movement and enter placement mode.");
    assert((await page.locator("#editorStatus").textContent()).includes("Place the selected movement"), "The movement gate must explain the focused action.");
    await page.locator(".editor-placement-surface").click({ position: { x: 470, y: 250 } });
    const bothPlaced = await addedHotspots(page, sourceSceneId);
    assert(bothPlaced.length === 2 && bothPlaced.every((hotspot) => hotspot.positionConfirmed), `Both movements must keep independent confirmed positions: ${JSON.stringify(bothPlaced)}`);
    assert(bothPlaced[0].pitch !== bothPlaced[1].pitch || bothPlaced[0].yaw !== bothPlaced[1].yaw, "Two movements must not collapse to one coordinate.");
    await page.getByRole("button", { name: "Continue" }).click();
    await assertSimpleStage(page, "Choose first views");

    await page.getByRole("button", { name: "Check tour" }).click();
    assert(await page.getByRole("heading", { name: "Choose first views" }).isVisible(), "An unsaved destination view must block publish.");
    assert((await page.locator("#editorStatus").textContent()).includes("Choose the destination view"), "The destination-view gate must explain the focused action.");
    for (let index = 0; index < 2; index += 1) {
      await page.getByRole("button", { name: "Choose destination view" }).click();
      await page.getByRole("button", { name: "Use as destination view" }).click();
    }
    const arrivals = await addedHotspots(page, sourceSceneId);
    assert(arrivals.every((hotspot) => hotspot.arrivalConfirmed), `All destination views must be saved in sequence: ${JSON.stringify(arrivals)}`);

    await page.getByRole("button", { name: "Check tour" }).click();
    await assertSimpleStage(page, "Check and publish");
    await page.getByText("Check the tour first", { exact: true }).click();
    const previewHref = await page.getByRole("link", { name: "Open tour preview" }).getAttribute("href");
    assert(previewHref?.startsWith(`${baseUrl}/?preview=1`), `Preview must stay on the studio origin: ${previewHref}`);

    const preview = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await preview.goto(previewHref);
    await preview.locator(".pnlm-render-container canvas").waitFor({ timeout: 20_000 });
    assert(!await preview.locator("body").getAttribute("data-tour-error"), "Same-origin review preview failed.");
    await preview.close();

    await page.getByRole("button", { name: "Build the tour" }).click();
    await page.getByRole("link", { name: "Download website file" }).waitFor({ timeout: 90_000 });
    assert(!await page.getByRole("button", { name: "Download editable backup" }).isVisible(), "Advanced downloads must stay collapsed by default.");
    assert(!await page.getByRole("link", { name: "Open sample website" }).isVisible(), "Optional website testing must stay collapsed by default.");
    await page.getByText("Add it to a website", { exact: true }).click();
    await page.locator("#editorInstallUrl").fill("https://client.example/tours/home.html");
    assert((await page.locator("#editorEmbedCode").inputValue()).includes('src="https://client.example/tours/home.html"'), "The generated iframe must use the entered public URL.");

    await page.getByText("Test on a website", { exact: true }).click();
    const embedTestHref = await page.getByRole("link", { name: "Open sample website" }).getAttribute("href");
    const embedTest = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await embedTest.goto(new URL(embedTestHref, baseUrl).href);
    await embedTest.frameLocator("iframe").locator(".pnlm-render-container canvas").waitFor({ timeout: 20_000 });
    assert(await embedTest.locator("iframe").getAttribute("allowfullscreen") !== null, "The generated embed test must allow fullscreen.");
    assert((await embedTest.locator("iframe").getAttribute("src")).includes("release-single-preview.html"), "The embed test must exercise the primary one-file delivery.");
    await embedTest.close();

    const websitePath = join(root, "client-tour.html");
    const [websiteDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download website file" }).click()
    ]);
    await websiteDownload.saveAs(websitePath);
    assert((await stat(websitePath)).size > 100_000, "The one-file website download is unexpectedly small.");
    const offlineTour = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    await offlineTour.goto(`file://${websitePath}`);
    await offlineTour.locator(".pnlm-render-container canvas").waitFor({ timeout: 20_000 });
    assert(!await offlineTour.locator("body").getAttribute("data-tour-error"), "The downloaded one-file tour must open without a web server.");
    await offlineTour.close();

    await page.getByText("Backups and advanced files", { exact: true }).click();
    const backupPath = join(root, "client-project.rdtour");
    const [projectDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download editable backup" }).click()
    ]);
    await projectDownload.saveAs(backupPath);
    assert((await stat(backupPath)).size > 10_000, "The editable project download is unexpectedly small.");

    const releaseHref = await page.getByRole("link", { name: "Open finished tour" }).getAttribute("href");
    const release = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await release.goto(new URL(releaseHref, baseUrl).href);
    await release.locator(".pnlm-render-container canvas").waitFor({ timeout: 20_000 });
    assert(await release.locator(".scene-card").count() === 4, "Published tour must contain all four viewpoints.");
    await release.close();

    await page.getByRole("button", { name: "Tours" }).click();
    await page.getByRole("heading", { name: "Start a tour" }).waitFor();
    await page.getByText("Create or open another tour", { exact: true }).click();
    await page.getByText("Open saved work", { exact: true }).click();
    await page.locator("#editorProjectBackup").setInputFiles(backupPath);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Open saved tour" }).click();
    await page.getByRole("heading", { name: "Add 360 photos" }).waitFor({ timeout: 30_000 });
    await page.locator(".editor-upload-item").first().waitFor({ timeout: 30_000 });
    assert(await page.locator(".editor-upload-item").count() === 4, "Restoring the editable project must recover all four photos.");

    await page.setViewportSize({ width: 390, height: 605 });
    await page.getByRole("button", { name: "Continue" }).click();
    await assertSimpleStage(page, "Name rooms and views");
    const mobileLayout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      widestRoom: Math.max(...Array.from(document.querySelectorAll(".editor-room, .editor-project-scene")).map((element) => element.getBoundingClientRect().right), 0)
    }));
    assert(mobileLayout.scrollWidth <= mobileLayout.viewport && mobileLayout.widestRoom <= mobileLayout.viewport, `Rooms overflow on mobile: ${JSON.stringify(mobileLayout)}`);
    await assertNoMobileOverflow(page, "Rooms");

    await page.getByRole("button", { name: "Continue" }).click();
    await assertSimpleStage(page, "Choose the look");
    await assertNoMobileOverflow(page, "Look");
    await page.getByRole("button", { name: "Continue" }).click();
    await assertSimpleStage(page, "Add ways to move");
    await assertNoMobileOverflow(page, "Movement");
    await page.getByRole("button", { name: "Continue" }).click();
    await assertSimpleStage(page, "Choose first views");
    await assertNoMobileOverflow(page, "First views");
    await page.getByRole("button", { name: "Check tour" }).click();
    await assertSimpleStage(page, "Check and publish");
    await assertNoMobileOverflow(page, "Publish");

    assert(consoleErrors.length === 0, `Studio console errors: ${consoleErrors.join(" | ")}`);
    console.log(JSON.stringify({ passed: true, stages: 7, noviceDefault: true, visibleActionBudget: true, rooms: 3, viewpoints: 4, movementGate: true, arrivalGate: true, sameOriginPreview: true, embedTest: true, offlineSingleFile: true, localRelease: true, downloads: 2, projectRestore: true, mobileWizard: true }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    await rm(root, { recursive: true, force: true });
    if (server.exitCode && server.exitCode !== 0) throw new Error(`Studio UI test server failed: ${serverError}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
