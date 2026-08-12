#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function requestJson(url, options = {}, expected = 200) {
  const response = await fetch(url, options);
  const body = await response.json();
  assert(response.status === expected, `${options.method || "GET"} ${url} returned ${response.status}: ${body.error || JSON.stringify(body)}`);
  return body;
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
  throw new Error("ImageMagick is not installed (expected magick or convert).");
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/__tour-editor/status`);
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Timed out waiting for the frame picker test server.");
}

async function importPanorama(baseUrl, filePath, roomId, roomLabel) {
  return requestJson(`${baseUrl}/__tour-editor/workspace-import?workspace=1`, {
    method: "POST",
    headers: {
      "content-type": "image/jpeg",
      "x-tour-file-name": encodeURIComponent(filePath.split("/").pop()),
      "x-tour-room-id": encodeURIComponent(roomId),
      "x-tour-room-label": encodeURIComponent(roomLabel)
    },
    body: await readFile(filePath)
  }, 201);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "raindigit-frame-picker-"));
  const workspace = join(root, "workspace");
  const port = 26000 + Math.floor(Math.random() * 12000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [join(projectRoot, "scripts", "tour-editor-server.mjs"), "--port", String(port)], {
    cwd: projectRoot,
    env: { ...process.env, INSTA360_TOUR_WORKSPACE: workspace, INSTA360_TOUR_ARTIFACTS: join(root, "artifacts"), INSTA360_TOUR_RELEASE: join(root, "release") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverError = "";
  server.stderr.on("data", (chunk) => { serverError += chunk.toString(); });
  let browser;

  try {
    await waitForServer(baseUrl);
    await requestJson(`${baseUrl}/__tour-editor/workspace-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", title: "Frame Picker QA", replace: false })
    }, 201);

    const first = join(root, "living-room.jpg");
    const second = join(root, "front-drive.jpg");
    await runMagick(["-size", "1800x900", "gradient:#253d32-#d6af5c", "-quality", "90", first]);
    await runMagick(["-size", "1800x900", "gradient:#142235-#e8d7a6", "-quality", "90", second]);
    await importPanorama(baseUrl, first, "room-living", "Living room");
    await importPanorama(baseUrl, second, "space-driveway", "Driveway");

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const consoleErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.goto(`${baseUrl}/?frame-picker=1&workspace=1`);
    await page.getByRole("heading", { name: "Frame picker" }).waitFor({ timeout: 15_000 });
    await page.locator("#framePickerViewer canvas").waitFor({ timeout: 15_000 });
    await page.selectOption("#framePickerSlot", "gallery-2");
    await page.locator("#framePickerLabel").fill("Gallery test frame");
    await page.getByRole("button", { name: "Save current view" }).click();
    await page.getByText("Saved Gallery test frame.").waitFor({ timeout: 10_000 });
    const saved = await requestJson(`${baseUrl}/__tour-editor/frame-selections?workspace=1`);
    assert(saved.selections.frames["gallery-2"]?.label === "Gallery test frame", "Frame picker did not persist the chosen slot.");
    assert(saved.selections.frames["gallery-2"]?.panorama === "panoramas/scene-001.jpg", "Frame picker saved the wrong panorama reference.");
    assert(consoleErrors.length === 0, `Frame picker emitted console errors: ${consoleErrors.join("\n")}`);
  } finally {
    await browser?.close().catch(() => {});
    server.kill();
    if (server.exitCode && server.exitCode !== 0) throw new Error(`Frame picker server failed: ${serverError}`);
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
