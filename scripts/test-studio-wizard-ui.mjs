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
}

async function assertNoMobileOverflow(page, stage) {
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    panelRight: document.querySelector(".editor-panel")?.getBoundingClientRect().right || 0
  }));
  assert(layout.scrollWidth <= layout.viewport && layout.panelRight <= layout.viewport, `${stage} overflows on mobile: ${JSON.stringify(layout)}`);
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
    await page.getByRole("button", { name: "Continue" }).click();
    assert(await page.getByRole("heading", { name: "Add ways to move" }).isVisible(), "An unplaced movement point must block the next step.");
    assert((await page.locator("#editorStatus").textContent()).includes("Place 1 movement point"), "The movement gate must explain what remains.");
    await page.locator("#panorama").click({ position: { x: 320, y: 360 } });
    await page.getByRole("button", { name: "Continue" }).click();
    await assertSimpleStage(page, "Choose first views");

    const sourceScene = await page.locator("#editorSceneName").textContent();
    await page.getByRole("button", { name: "Check tour" }).click();
    assert(await page.getByRole("heading", { name: "Choose first views" }).isVisible(), "An unsaved destination view must block publish.");
    assert((await page.locator("#editorStatus").textContent()).includes("Choose 1 destination view"), "The destination-view gate must explain what remains.");
    await page.getByRole("button", { name: "Choose destination view" }).click();
    await page.getByRole("button", { name: "Use as destination view" }).click();
    await page.locator("#editorSceneName").filter({ hasText: sourceScene }).waitFor();

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

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Name rooms and views" }).waitFor();
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
