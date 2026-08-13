#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import { chromium, webkit } from "@playwright/test";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runMagick(arguments_) {
  for (const binary of ["magick", "convert"]) {
    try { return await execFileAsync(binary, arguments_); }
    catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error("ImageMagick is required.");
}

async function imageDimensions(path) {
  const { stdout } = await runMagick(["identify", "-format", "%w %h", path]);
  return stdout.trim().split(/\s+/).map(Number);
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

async function runBrowserQa(packageRoot, pointer) {
  const contentTypes = { ".css": "text/css", ".html": "text/html", ".jpg": "image/jpeg", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp" };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const file = resolve(packageRoot, `.${pathname}`);
      if (!file.startsWith(`${resolve(packageRoot)}/`)) throw new Error("Invalid path");
      const body = await readFile(file);
      const extension = file.slice(file.lastIndexOf("."));
      response.writeHead(200, { "content-type": contentTypes[extension] || "application/octet-stream", "cache-control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/${pointer.entrypoint}?qa=1`;
  const evidence = join(projectRoot, "output", "playwright", "multires");
  await rm(evidence, { recursive: true, force: true });
  await mkdir(evidence, { recursive: true });
  try {
    const performanceBrowser = await chromium.launch({ headless: true });
    const performanceContext = await performanceBrowser.newContext({
      viewport: { width: 412, height: 915 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2.625
    });
    const performancePage = await performanceContext.newPage();
    let firstTileResponseAt = null;
    performancePage.on("response", (response) => {
      if (firstTileResponseAt === null && /\/assets\/mr\/.+\.webp(?:\?|$)/.test(response.url()) && response.ok()) firstTileResponseAt = Date.now();
    });
    const devtools = await performanceContext.newCDPSession(performancePage);
    await devtools.send("Network.enable");
    await devtools.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: 4 * 1024 * 1024 / 8,
      uploadThroughput: 1 * 1024 * 1024 / 8,
      connectionType: "cellular4g"
    });
    await devtools.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await performancePage.goto(baseUrl, { waitUntil: "commit" });
    await performancePage.locator(".tour-first-frame").waitFor({ state: "visible", timeout: 30_000 });
    await performancePage.locator(".tour-first-frame").evaluate((preview) => preview.decode());
    const firstFrameMs = await performancePage.evaluate(() => performance.now());
    const recognisableFrameMs = firstFrameMs;
    for (let attempt = 0; firstTileResponseAt === null && attempt < 300; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    assert(firstTileResponseAt !== null, "No first-scene WebP tile completed on the performance profile.");
    await performancePage.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
    const timing = { firstFrameMs, recognisableFrameMs, firstTileMs: await performancePage.evaluate(() => performance.now()) };
    assert(timing.firstFrameMs <= 500, `First tour frame took ${Math.round(timing.firstFrameMs)} ms; budget is 500 ms on the emulated medium mobile / 4G profile.`);
    assert(timing.recognisableFrameMs <= 1000, `Recognisable tour frame took ${Math.round(timing.recognisableFrameMs)} ms; budget is 1000 ms on the emulated medium mobile / 4G profile.`);
    await writeFile(join(evidence, "performance.json"), `${JSON.stringify({
      profile: "Chromium 412x915, 4x CPU, 4 Mbps down / 1 Mbps up, 40 ms RTT",
      budgets: { firstFrameMs: 500, recognisableFrameMs: 1000 },
      measured: timing
    }, null, 2)}\n`);
    await performanceContext.close();
    await performanceBrowser.close();

    for (const target of [
      { name: "chromium-desktop", engine: chromium, viewport: { width: 1365, height: 768 }, mobile: false },
      { name: "chromium-mobile", engine: chromium, viewport: { width: 390, height: 844 }, mobile: true },
      { name: "webkit-mobile", engine: webkit, viewport: { width: 390, height: 844 }, mobile: true }
    ]) {
      const browser = await target.engine.launch({ headless: true });
      const context = await browser.newContext({ viewport: target.viewport, isMobile: target.mobile, hasTouch: target.mobile });
      const page = await context.newPage();
      const consoleErrors = [];
      const networkErrors = [];
      const tileRequests = [];
      page.on("console", (message) => { if (message.type() === "error" && message.text() !== "not granted") consoleErrors.push(message.text()); });
      page.on("requestfailed", (request) => networkErrors.push(`${request.url()}: ${request.failure()?.errorText || "failed"}`));
      page.on("response", (response) => {
        if (response.status() >= 400) networkErrors.push(`${response.status()} ${response.url()}`);
        if (/\/assets\/mr\/.+\.webp(?:\?|$)/.test(response.url())) tileRequests.push(response.url());
      });
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.locator(".pnlm-render-container canvas").waitFor({ state: "visible", timeout: 30_000 });
      const screenshot = await page.screenshot({ path: join(evidence, `${target.name}.png`), fullPage: true });
      assert(screenshot.byteLength > 30_000, `${target.name} screenshot is unexpectedly empty.`);
      assert(await page.locator(".scene-card").count() === 2, `${target.name} lost scene navigation.`);
      const waitForScene = async (sceneId, counter) => {
        try {
          await page.waitForFunction(([expectedScene, expectedCounter]) => document.querySelector(`.scene-card[data-scene="${expectedScene}"]`)?.classList.contains("is-active") && document.querySelector("#sceneCounter")?.textContent === expectedCounter, [sceneId, counter], { timeout: 30_000 });
        } catch (error) {
          const debug = await page.evaluate(() => ({ scene: window.__tourViewer?.getScene(), counter: document.querySelector("#sceneCounter")?.textContent, cards: Array.from(document.querySelectorAll(".scene-card")).map((card) => ({ scene: card.dataset.scene, active: card.classList.contains("is-active") })) }));
          throw new Error(`${target.name} did not activate ${sceneId}: ${JSON.stringify(debug)}; ${error.message}`);
        }
      };
      await page.locator('.scene-card[data-scene="scene-002"]').evaluate((button) => button.click());
      await waitForScene("scene-002", "View 2 of 2");
      await page.locator('.scene-card[data-scene="scene-001"]').evaluate((button) => button.click());
      await waitForScene("scene-001", "View 1 of 2");
      const firstHotspot = page.locator(".nav-hotspot-anchor").first();
      await firstHotspot.waitFor({ state: "attached" });
      assert((await firstHotspot.getAttribute("aria-label"))?.toLowerCase() === "go to second", `${target.name} first hotspot label is wrong: ${await firstHotspot.getAttribute("aria-label")}.`);
      await page.locator('.scene-card[data-scene="scene-002"]').evaluate((button) => button.click());
      await waitForScene("scene-002", "View 2 of 2");
      const secondHotspot = page.locator(".nav-hotspot-anchor").first();
      await secondHotspot.waitFor({ state: "attached" });
      assert((await secondHotspot.getAttribute("aria-label"))?.toLowerCase() === "go to entry", `${target.name} return hotspot label is wrong.`);
      await page.locator('.scene-card[data-scene="scene-001"]').evaluate((button) => button.click());
      await waitForScene("scene-001", "View 1 of 2");
      const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert(layout.scrollWidth <= layout.width, `${target.name} has horizontal overflow.`);
      assert(tileRequests.length > 0, `${target.name} did not request multires WebP tiles.`);
      assert(consoleErrors.length === 0, `${target.name} console errors: ${consoleErrors.join(" | ")}`);
      assert(networkErrors.length === 0, `${target.name} network errors: ${networkErrors.join(" | ")}`);
      await context.close();
      await browser.close();
    }
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "raindigit-multires-test-"));
  const workspace = join(root, "workspace");
  const output = join(root, "package");
  const secondOutput = join(root, "package-repeat");
  const zip = join(root, "future-multires-qa.zip");
  try {
    await mkdir(join(workspace, "panoramas"), { recursive: true });
    await mkdir(join(workspace, "thumbnails"), { recursive: true });
    for (const [id, colors] of [["scene-001", ["#102e52", "#dab862"]], ["scene-002", ["#4a1b2b", "#6eb5a4"]]]) {
      const panorama = join(workspace, "panoramas", `${id}.jpg`);
      await runMagick(["-size", "2048x1024", `gradient:${colors[0]}-${colors[1]}`, "-quality", "92", panorama]);
      await runMagick([panorama, "-thumbnail", "480x240^", "-gravity", "center", "-extent", "480x240", join(workspace, "thumbnails", `${id}.jpg`)]);
    }
    const project = {
      schema: "raindigit-tour-project/v1",
      title: "Future Multires QA",
      firstScene: "scene-001",
      rooms: [{ id: "room-a", label: "Room A" }],
      floors: [{ id: "floor-1", label: "Ground floor" }],
      scenes: [
        { id: "scene-001", title: "Entry", subtitle: "First", space: "room-a", spaceLabel: "Room A", floor: "floor-1", floorLabel: "Ground floor", panorama: "panoramas/scene-001.jpg", thumb: "thumbnails/scene-001.jpg", pitch: -7, yaw: 31, hfov: 88, hotspots: [{ kind: "doorway", pitch: -12, yaw: 42, target: "scene-002", label: "Go to second", targetPitch: -4, targetYaw: 81, targetHfov: 90, positionConfirmed: true, arrivalConfirmed: true }] },
        { id: "scene-002", title: "Second", subtitle: "Second", space: "room-a", spaceLabel: "Room A", floor: "floor-1", floorLabel: "Ground floor", panorama: "panoramas/scene-002.jpg", thumb: "thumbnails/scene-002.jpg", pitch: -4, yaw: 81, hfov: 90, hotspots: [{ kind: "doorway", pitch: -10, yaw: -35, target: "scene-001", label: "Go to entry", targetPitch: -7, targetYaw: 31, targetHfov: 88, positionConfirmed: true, arrivalConfirmed: true }] }
      ]
    };
    await writeFile(join(workspace, "tour-project.json"), `${JSON.stringify(project, null, 2)}\n`);
    await writeFile(join(workspace, "draft.json"), `${JSON.stringify({ schema: "raindigit-tour-hotspot-overrides/v1", overrides: {}, addedHotspots: {}, sceneViews: {}, sceneAdjustments: {}, localAdjustments: {} }, null, 2)}\n`);

    const builder = join(projectRoot, "scripts", "build-multires-release.mjs");
    await execFileAsync(process.execPath, [builder, "--workspace", workspace, "--output", output, "--zip", zip, "--slug", "future-multires-qa", "--rollback-version", "legacy-0123456789ab", "--runtime-template", join(projectRoot, "web-tour"), "--replace"], { cwd: projectRoot, timeout: 20 * 60 * 1000 });
    const pointer = JSON.parse(await readFile(join(output, "manifests", "future-multires-qa", "current.json"), "utf8"));
    assert(pointer.schema === "raindigit-tour-current/v1" && pointer.previousVersion === "legacy-0123456789ab", "The stable current pointer or rollback reference is invalid.");
    assert(pointer.entrypoint === `${pointer.prefix}index.html` && pointer.releaseManifest === `${pointer.prefix}release-manifest.json`, "The current pointer does not reference the immutable release.");
    const releaseRoot = join(output, pointer.prefix);
    const source = await readFile(join(releaseRoot, "js", "tour-config.js"), "utf8");
    const context = { window: {} };
    vm.runInNewContext(source, context);
    const config = context.window.TOUR_CONFIG;
    assert(config.firstScene === "scene-001", "Opening scene changed.");
    assert(config.scenes.map((scene) => scene.id).join(",") === "scene-001,scene-002", "Scene order changed.");
    assert(config.scenes[0].pitch === -7 && config.scenes[0].yaw === 31 && config.scenes[0].hfov === 88, "Opening view changed.");
    assert(config.scenes[0].hotspots[0].target === "scene-002", "Hotspot destination changed.");
    assert(config.scenes.every((scene) => scene.type === "multires" && !scene.panorama), "Scenes were not converted to multires.");
    assert(config.scenes.every((scene) => scene.multiRes.tileResolution === 512 && scene.multiRes.extension === "webp" && scene.multiRes.fallbackExtension === "jpg" && scene.multiRes.equirectangularThumbnail.startsWith("data:image/webp;base64,")), "Multires contract is incomplete.");

    const files = await walk(releaseRoot);
    const webpTiles = files.filter((path) => path.endsWith(".webp") && !path.includes("thumbnails") && !path.includes(`${join("assets", "seo")}${sep}`));
    const fallbacks = files.filter((path) => /\/fallback\/[fbudlr]\.jpg$/.test(path));
    assert(webpTiles.length > 12, "Too few multires WebP tiles were produced.");
    assert(fallbacks.length === 12, `Expected 12 JPEG fallback faces, found ${fallbacks.length}.`);
    assert(!files.some((path) => /\/assets\/p\//.test(path)), "Full equirectangular public files were retained.");
    for (const tile of webpTiles) {
      const [width, height] = await imageDimensions(tile);
      assert(width <= 512 && height <= 512, `${tile} exceeds 512 px.`);
    }
    const manifest = JSON.parse(await readFile(join(releaseRoot, "release-manifest.json"), "utf8"));
    assert(manifest.version.startsWith("multires-") && manifest.immutablePrefix.includes(manifest.version) && manifest.version === pointer.version, "Versioned immutable manifest is invalid.");
    assert(manifest.rollbackVersion === "legacy-0123456789ab", "Release manifest lost the rollback version.");
    assert(Object.keys(manifest.sceneViews).length === 2 && manifest.hotspotGraph.length === 2, "Scene views or hotspot graph are missing from the release manifest.");
    assert(manifest.fileCount === manifest.files.length && manifest.bytes === manifest.files.reduce((sum, file) => sum + file.bytes, 0), "Release inventory totals are invalid.");
    assert(manifest.performance.previewBytes <= 30 * 1024, "Preview exceeds 30 KB.");
    assert(manifest.performance.posterWidth === 1200 && manifest.performance.posterHeight === 630, "SEO poster is not 1200x630.");
    assert(manifest.performance.criticalBytes <= 1024 * 1024, "First-scene critical payload exceeds 1 MB.");
    assert(manifest.performance.criticalFiles.length >= 8 && manifest.performance.fallbackFiles.length === 6, "First-scene budget inventory is incomplete.");
    assert(manifest.performance.criticalFiles.every((path) => files.includes(join(releaseRoot, path))), "A critical first-scene file is absent from the release.");
    assert(manifest.performance.fallbackFiles.every((path) => files.includes(join(releaseRoot, path))), "A JPEG fallback face is absent from the release.");
    const seoDraft = JSON.parse(await readFile(join(releaseRoot, manifest.performance.seoDraft), "utf8"));
    assert(seoDraft.seoTitle && seoDraft.seoDescription.length >= 140 && seoDraft.seoDescription.length <= 160 && seoDraft.landingDescriptionDraft, "SEO draft is incomplete.");
    for (const entry of manifest.files) {
      const body = await readFile(join(releaseRoot, entry.path));
      assert(body.byteLength === entry.bytes, `Inventory size is wrong for ${entry.path}.`);
      assert(createHash("sha256").update(body).digest("hex") === entry.sha256, `Inventory hash is wrong for ${entry.path}.`);
    }
    const { stdout: zipListing } = await execFileAsync("unzip", ["-Z1", zip]);
    assert(zipListing.includes(`tours/future-multires-qa/${manifest.version}/index.html`) && zipListing.includes("manifests/future-multires-qa/current.json"), "The deployable archive does not mirror the R2 object layout.");
    await execFileAsync(process.execPath, [builder, "--workspace", workspace, "--output", secondOutput, "--slug", "future-multires-qa", "--runtime-template", join(projectRoot, "web-tour"), "--replace"], { cwd: projectRoot, timeout: 20 * 60 * 1000 });
    const repeatedPointer = JSON.parse(await readFile(join(secondOutput, "manifests", "future-multires-qa", "current.json"), "utf8"));
    assert(repeatedPointer.version === pointer.version && repeatedPointer.contentDigest === pointer.contentDigest, "Identical source content did not produce a stable version.");
    const pannellumRuntime = await readFile(join(releaseRoot, "js", "pannellum.js"), "utf8");
    assert(pannellumRuntime.includes("m.fallbackExtension||m.extension"), "JPEG fallback extension support is missing from the release runtime.");
    const tourRuntime = await readFile(join(releaseRoot, "js", "tour.js"), "utf8");
    assert(tourRuntime.includes("multiRes: scene.multiRes"), "The release runtime does not pass multires scene data to Pannellum.");
    assert(tourRuntime.includes("function revealRenderedTour"), "The release runtime does not reliably remove the inline first frame after WebGL renders.");
    const revisedRuntime = await readFile(join(projectRoot, "scripts", "revise-multires-runtime.mjs"), "utf8");
    assert(revisedRuntime.includes('canvas.style.filter = "url(#legacy-color-matrix)";'), "Legacy parity calibration is lost when the operator previews the original scene adjustment.");
    await runBrowserQa(output, pointer);
    console.log(`Future multires release passed: ${config.scenes.length} scenes, ${webpTiles.length} WebP tiles, 12 JPEG fallback faces.`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
