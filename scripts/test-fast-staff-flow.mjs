#!/usr/bin/env node

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
  throw new Error("ImageMagick is required for fast-flow fixtures.");
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/__tour-editor/status`)).ok) return;
    } catch {
      // The isolated test server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Timed out waiting for fast-flow studio server.");
}

async function waitForStage(page, stage, timeout = 20_000) {
  await page.waitForFunction((expected) => document.body.dataset.editorStage === expected, stage, { timeout });
}

async function dragSelectedWalkingButton(page, sequence) {
  await page.locator(".nav-hotspot-anchor.is-editor-selected .nav-hotspot").waitFor({ state: "visible", timeout: 20_000 });
  await page.evaluate((pointerId) => {
    const element = document.querySelector(".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
    if (!element) throw new Error("Selected walking button is missing.");
    const box = element.getBoundingClientRect();
    const start = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const end = { x: start.x + 26, y: start.y + 12 };
    const options = { bubbles: true, cancelable: true, pointerId, pointerType: "mouse", button: 0, buttons: 1 };
    element.dispatchEvent(new PointerEvent("pointerdown", { ...options, clientX: start.x, clientY: start.y }));
    document.dispatchEvent(new PointerEvent("pointermove", { ...options, clientX: end.x, clientY: end.y }));
    document.dispatchEvent(new PointerEvent("pointerup", { ...options, buttons: 0, clientX: end.x, clientY: end.y }));
  }, 700 + sequence);
  await page.waitForFunction(() => {
    const snapshot = window.__RAINDIGIT_STUDIO_DEBUG__?.snapshot();
    if (!snapshot?.selected) return false;
    const hotspot = window.__TOUR_EDITOR_API.sceneById[snapshot.selected.sceneId]?.hotspots[snapshot.selected.hotspotIndex];
    return hotspot?.positionConfirmed === true;
  });
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "raindigit-fast-staff-flow-"));
  const port = 24000 + Math.floor(Math.random() * 10000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const outputDir = join(projectRoot, "output", "playwright", "fast-staff-flow");
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
    for (const [index, colours] of [["#213b4f", "#d6af5c"], ["#355843", "#e1c783"], ["#4d354a", "#8bc6b1"]].entries()) {
      const file = join(root, `ordered-${index + 1}.jpg`);
      await runMagick(["-size", "1600x800", `gradient:${colours[0]}-${colours[1]}`, "-quality", "88", file]);
      fixtures.push(file);
    }

    await waitForServer(baseUrl);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, acceptDownloads: true });
    const consoleErrors = [];
    const failedRequests = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText || "failed";
      if (request.url().includes("/__tour-editor/studio-log") && failure.includes("ERR_ABORTED")) return;
      failedRequests.push(`${request.url()} · ${failure}`);
    });
    page.on("dialog", (dialog) => dialog.accept());
    let deliberateActions = 0;
    const click = async (locator) => {
      deliberateActions += 1;
      await locator.click();
    };
    const startedAt = Date.now();

    await page.goto(`${baseUrl}/?edit=1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Start a tour" }).waitFor();
    await page.getByLabel("Tour name").fill("Fast Staff Tour");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }),
      click(page.getByRole("button", { name: "Create new tour" }))
    ]);
    await page.locator("#editorImportFiles").setInputFiles(fixtures);
    await page.getByText("3 photos ready", { exact: true }).waitFor({ timeout: 90_000 });
    await click(page.getByRole("button", { name: "Continue", exact: true }));
    await waitForStage(page, "rooms");
    await page.locator("#editorQuickRouteCard").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outputDir, "01-routes-fast-path-desktop.png"), fullPage: true });

    await click(page.getByRole("button", { name: "Connect in order" }));
    await page.getByText("Every neighbouring photo is connected in both directions.", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 780 });
    await page.locator("#editorQuickRouteCard").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outputDir, "02-routes-fast-path-mobile.png") });
    await page.setViewportSize({ width: 1280, height: 760 });
    const routePlan = await (await page.request.get(`${baseUrl}/__tour-editor/workspace-project`)).json();
    assert(routePlan.project.scenes.reduce((sum, scene) => sum + scene.plannedTargets.length, 0) === 4, "Fast setup did not create the expected four directed routes.");
    await click(page.getByRole("button", { name: "Save setup" }));
    await waitForStage(page, "light", 30_000);
    await page.locator("#editorApplyLookAll").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outputDir, "03-look-fast-path-desktop.png"), fullPage: true });

    await click(page.getByRole("button", { name: "Bright", exact: true }));
    await click(page.getByRole("button", { name: "Use on all photos & continue" }));
    await waitForStage(page, "links", 30_000);

    for (let index = 0; index < 4; index += 1) {
      await dragSelectedWalkingButton(page, index);
      const label = index < 3 ? "Next walking button" : "Choose first views";
      await click(page.getByRole("button", { name: label }));
    }
    await waitForStage(page, "arrival", 30_000);
    await page.locator("#editorOpeningViewsFastPath").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outputDir, "04-opening-views-fast-path-desktop.png"), fullPage: true });
    await click(page.getByRole("button", { name: /Keep 3 current views & continue|Keep current view & continue/ }));
    await waitForStage(page, "polish", 30_000);
    await click(page.getByRole("button", { name: "Publish" }));
    await waitForStage(page, "export");

    const readiness = await page.locator("#editorReadiness li").count();
    const ready = await page.locator("#editorReadiness li.is-ready").count();
    assert(readiness >= 6 && readiness === ready, `Fast flow reached export without a clean preflight (${ready}/${readiness}).`);
    const downloadPromise = page.waitForEvent("download", { timeout: 180_000 });
    await click(page.getByRole("button", { name: "Build & download web package" }));
    const download = await downloadPromise;
    const suggestedName = download.suggestedFilename();
    assert(suggestedName.endsWith(".zip"), `Fast flow downloaded an unexpected file: ${suggestedName}`);
    await page.getByRole("link", { name: "Download web package" }).waitFor({ timeout: 180_000 });

    const release = await (await page.request.get(`${baseUrl}/__tour-editor/release-status?workspace=1`)).json();
    assert(release.ready && release.multires?.ready, `Fast flow did not produce a ready web release: ${JSON.stringify(release)}`);
    const measuredFlow = await page.evaluate(() => window.__RAINDIGIT_STUDIO_DEBUG__?.snapshot()?.flow);
    assert(measuredFlow?.deliberateActions > 0 && measuredFlow?.elapsedMs > 0, `Studio flow metrics were not captured: ${JSON.stringify(measuredFlow)}`);
    assert(deliberateActions <= 13, `Fast flow exceeded the action budget: ${deliberateActions} actions.`);
    assert(consoleErrors.length === 0, `Fast flow logged console errors: ${consoleErrors.join(" | ")}`);
    assert(failedRequests.length === 0, `Fast flow had failed requests: ${failedRequests.join(" | ")}`);
    await page.screenshot({ path: join(outputDir, "fast-flow-complete.png"), fullPage: true });

    process.stdout.write(`${JSON.stringify({
      ok: true,
      photos: 3,
      walkingButtons: 4,
      deliberateActions,
      elapsedMs: Date.now() - startedAt,
      measuredFlow,
      downloaded: suggestedName
    }, null, 2)}\n`);
  } catch (error) {
    throw new Error(`${error.message}${serverError ? `\nServer output:\n${serverError}` : ""}`);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
