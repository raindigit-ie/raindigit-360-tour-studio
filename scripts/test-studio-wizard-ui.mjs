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
    await page.getByLabel("Project title").fill("Studio UI Journey");
    await page.getByRole("button", { name: "Create new project" }).click();
    await page.getByRole("heading", { name: "Upload panoramas" }).waitFor();

    await page.locator("#editorImportFiles").setInputFiles(fixtures);
    await page.getByText("4 panoramas ready", { exact: true }).waitFor({ timeout: 90_000 });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Organize rooms" }).waitFor();

    await page.getByLabel("Room name: Room 1").fill("Kitchen");
    await page.locator("#editorNewRoomName").fill("Hall");
    await page.getByRole("button", { name: "Add room" }).click();
    await page.locator("#editorNewRoomName").fill("Living room");
    await page.getByRole("button", { name: "Add room" }).click();
    await page.locator("#editorNewRoomName").fill("Temporary");
    await page.getByRole("button", { name: "Add room" }).click();
    await page.getByRole("button", { name: "Remove Temporary" }).click();
    assert(await page.locator(".editor-room").count() === 3, "An accidental empty room must be removable.");

    const cards = page.locator(".editor-project-scene");
    assert(await cards.count() === 4, "The Rooms screen must keep four stable panorama cards.");
    const roomSelects = page.locator(".editor-project-scene select");
    await roomSelects.nth(0).selectOption({ label: "Kitchen" });
    await roomSelects.nth(1).selectOption({ label: "Kitchen" });
    await roomSelects.nth(2).selectOption({ label: "Hall" });
    await roomSelects.nth(3).selectOption({ label: "Living room" });
    const roomCounts = await page.locator("[data-room-count]").allTextContents();
    assert(JSON.stringify(roomCounts) === JSON.stringify(["2 views", "1 view", "1 view"]), `Room counts did not update: ${roomCounts.join(", ")}`);
    assert(await cards.count() === 4, "Assigning a room must not move a card under the pointer.");

    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Color and light" }).waitFor({ timeout: 20_000 });
    await page.getByLabel("Brightness").fill("108");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Transitions" }).waitFor();

    assert(await page.getByLabel("Transition marker type").inputValue() === "viewpoint", "A same-room destination must default to viewpoint.");
    assert(await page.getByLabel("Label").inputValue() === "View panorama 2", "A same-room label must name the target viewpoint.");
    await page.getByLabel("Transition destination").selectOption({ label: "Hall - panorama 3" });
    assert(await page.getByLabel("Transition marker type").inputValue() === "doorway", "A different room must default to doorway.");
    assert(await page.getByLabel("Label").inputValue() === "Walk to Hall", "A doorway label must name the target room.");
    await page.getByRole("button", { name: "Add transition" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    assert(await page.getByRole("heading", { name: "Transitions" }).isVisible(), "An unplaced transition must block the next step.");
    assert((await page.locator("#editorStatus").textContent()).includes("Place 1 transition point"), "The transition gate must explain what remains.");
    await page.locator("#panorama").click({ position: { x: 320, y: 360 } });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Arrival views" }).waitFor();

    const sourceScene = await page.locator("#editorSceneName").textContent();
    await page.getByRole("button", { name: "Review" }).click();
    assert(await page.getByRole("heading", { name: "Arrival views" }).isVisible(), "An unsaved arrival view must block export.");
    assert((await page.locator("#editorStatus").textContent()).includes("Save 1 arrival view"), "The arrival gate must explain what remains.");
    await page.getByRole("button", { name: "Set arrival view" }).click();
    await page.getByRole("button", { name: "Save arrival view" }).click();
    await page.locator("#editorSceneName").filter({ hasText: sourceScene }).waitFor();

    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("heading", { name: "Review and export" }).waitFor();
    const previewHref = await page.getByRole("link", { name: "Open review preview" }).getAttribute("href");
    assert(previewHref?.startsWith(`${baseUrl}/?preview=1`), `Preview must stay on the studio origin: ${previewHref}`);

    const preview = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await preview.goto(previewHref);
    await preview.locator(".pnlm-render-container canvas").waitFor({ timeout: 20_000 });
    assert(!await preview.locator("body").getAttribute("data-tour-error"), "Same-origin review preview failed.");
    await preview.close();

    await page.getByRole("button", { name: "Prepare final files" }).click();
    await page.getByRole("link", { name: "Download tour website (.html)" }).waitFor({ timeout: 90_000 });
    assert(await page.getByRole("button", { name: "Download editable backup (.rdtour)" }).isVisible(), "Editable project download is missing.");
    assert(await page.getByRole("link", { name: "Open website embed test" }).isVisible(), "The local embed test is missing.");
    await page.locator("#editorInstallUrl").fill("https://client.example/tours/home.html");
    assert((await page.locator("#editorEmbedCode").inputValue()).includes('src="https://client.example/tours/home.html"'), "The generated iframe must use the entered public URL.");

    const embedTestHref = await page.getByRole("link", { name: "Open website embed test" }).getAttribute("href");
    const embedTest = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await embedTest.goto(new URL(embedTestHref, baseUrl).href);
    await embedTest.frameLocator("iframe").locator(".pnlm-render-container canvas").waitFor({ timeout: 20_000 });
    assert(await embedTest.locator("iframe").getAttribute("allowfullscreen") !== null, "The generated embed test must allow fullscreen.");
    assert((await embedTest.locator("iframe").getAttribute("src")).includes("release-single-preview.html"), "The embed test must exercise the primary one-file delivery.");
    await embedTest.close();

    const websitePath = join(root, "client-tour.html");
    const [websiteDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download tour website (.html)" }).click()
    ]);
    await websiteDownload.saveAs(websitePath);
    assert((await stat(websitePath)).size > 100_000, "The one-file website download is unexpectedly small.");
    const offlineTour = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    await offlineTour.goto(`file://${websitePath}`);
    await offlineTour.locator(".pnlm-render-container canvas").waitFor({ timeout: 20_000 });
    assert(!await offlineTour.locator("body").getAttribute("data-tour-error"), "The downloaded one-file tour must open without a web server.");
    await offlineTour.close();

    const backupPath = join(root, "client-project.rdtour");
    const [projectDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download editable backup (.rdtour)" }).click()
    ]);
    await projectDownload.saveAs(backupPath);
    assert((await stat(backupPath)).size > 10_000, "The editable project download is unexpectedly small.");

    const releaseHref = await page.getByRole("link", { name: "Open final tour" }).getAttribute("href");
    const release = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await release.goto(new URL(releaseHref, baseUrl).href);
    await release.locator(".pnlm-render-container canvas").waitFor({ timeout: 20_000 });
    assert(await release.locator(".scene-card").count() === 4, "Published tour must contain all four viewpoints.");
    await release.close();

    await page.getByRole("button", { name: "Projects" }).click();
    await page.getByRole("heading", { name: "Create or open a tour" }).waitFor();
    await page.locator("#editorProjectBackup").setInputFiles(backupPath);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Open project backup" }).click();
    await page.getByRole("heading", { name: "Upload panoramas" }).waitFor({ timeout: 30_000 });
    await page.locator(".editor-upload-item").first().waitFor({ timeout: 30_000 });
    assert(await page.locator(".editor-upload-item").count() === 4, "Restoring the editable project must recover all four panoramas.");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Organize rooms" }).waitFor();
    const mobileLayout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      widestRoom: Math.max(...Array.from(document.querySelectorAll(".editor-room, .editor-project-scene")).map((element) => element.getBoundingClientRect().right), 0)
    }));
    assert(mobileLayout.scrollWidth <= mobileLayout.viewport && mobileLayout.widestRoom <= mobileLayout.viewport, `Rooms overflow on mobile: ${JSON.stringify(mobileLayout)}`);

    assert(consoleErrors.length === 0, `Studio console errors: ${consoleErrors.join(" | ")}`);
    console.log(JSON.stringify({ passed: true, stages: 7, rooms: 3, viewpoints: 4, transitionGate: true, arrivalGate: true, sameOriginPreview: true, embedTest: true, offlineSingleFile: true, localRelease: true, downloads: 2, projectRestore: true, mobileRooms: true }, null, 2));
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
