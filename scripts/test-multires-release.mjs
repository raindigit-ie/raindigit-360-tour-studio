#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import { chromium, webkit } from "@playwright/test";
import sharp from "sharp";
import {
  releaseContract,
  releaseIdentity,
  studioVersion,
} from "./lib/release-contract.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function visibleHotspotPixelRatio(page, hotspot) {
  const marker = hotspot.locator(".nav-hotspot");
  await marker.waitFor({ state: "visible" });
  const clip = await marker.boundingBox();
  assert(clip, "Hotspot marker has no paintable bounding box.");

  const painted = await page.screenshot({ clip });
  try {
    await marker.evaluate((element) => {
      element.style.visibility = "hidden";
    });
    await page.waitForTimeout(50);
    const underlay = await page.screenshot({ clip });
    const [paintedPixels, underlayPixels] = await Promise.all([
      sharp(painted).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(underlay).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);
    assert(
      paintedPixels.info.width === underlayPixels.info.width &&
        paintedPixels.info.height === underlayPixels.info.height &&
        paintedPixels.info.channels === underlayPixels.info.channels,
      "Hotspot paint comparison changed image geometry.",
    );

    const channels = paintedPixels.info.channels;
    const pixelCount = paintedPixels.info.width * paintedPixels.info.height;
    let changedPixels = 0;
    for (let offset = 0; offset < paintedPixels.data.length; offset += channels) {
      let maximumDifference = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        maximumDifference = Math.max(
          maximumDifference,
          Math.abs(
            paintedPixels.data[offset + channel] -
              underlayPixels.data[offset + channel],
          ),
        );
      }
      if (maximumDifference >= 16) changedPixels += 1;
    }
    return changedPixels / pixelCount;
  } finally {
    await marker.evaluate((element) => {
      element.style.removeProperty("visibility");
    });
  }
}

async function assertContentVersion(source, pathname, targetPath) {
  const version = createHash("sha256")
    .update(await readFile(targetPath))
    .digest("hex")
    .slice(0, 12);
  assert(
    source.includes(`${pathname}?v=${version}`),
    `${pathname} is not linked by its content version.`,
  );
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
  throw new Error("ImageMagick is required.");
}

async function imageDimensions(path) {
  for (const [binary, arguments_] of [
    ["magick", ["identify", "-format", "%w %h", path]],
    ["identify", ["-format", "%w %h", path]],
  ]) {
    try {
      const { stdout } = await execFileAsync(binary, arguments_);
      return stdout.trim().split(/\s+/).map(Number);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error("ImageMagick identify is required.");
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else output.push(path);
  }
  return output;
}

async function runBrowserQa(packageRoot, pointer) {
  const contentTypes = {
    ".css": "text/css",
    ".html": "text/html",
    ".jpg": "image/jpeg",
    ".js": "application/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://127.0.0.1").pathname,
      );
      const file = resolve(packageRoot, `.${pathname}`);
      if (!file.startsWith(`${resolve(packageRoot)}/`))
        throw new Error("Invalid path");
      const body = await readFile(file);
      const extension = file.slice(file.lastIndexOf("."));
      response.writeHead(200, {
        "content-type": contentTypes[extension] || "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/${pointer.entrypoint}?qa=1`;
  const clientServer = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (!["/embed", "/embed-offscreen"].includes(pathname)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const offscreen = pathname === "/embed-offscreen";
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "strict-origin-when-cross-origin",
    });
    response.end(
      `<!doctype html><html data-tour-client-ready="false"><body style="margin:0;min-height:${offscreen ? "300vh" : "100vh"}"><iframe id="tour" src="${baseUrl}" style="display:block;width:100vw;height:100vh;border:0;${offscreen ? "margin-top:200vh" : ""}"></iframe><script>const frame=document.getElementById('tour');addEventListener('message',(event)=>{const payload=event.data;if(event.origin!==${JSON.stringify(new URL(baseUrl).origin)}||event.source!==frame.contentWindow)return;if(payload?.type==='raindigit-tour-ready'&&payload.version===1&&payload.slug==='future-multires-qa')document.documentElement.dataset.tourClientReady='true'});<\/script></body></html>`,
    );
  });
  await new Promise((resolvePromise) =>
    clientServer.listen(0, "127.0.0.1", resolvePromise),
  );
  const clientAddress = clientServer.address();
  const clientUrl = `http://127.0.0.1:${clientAddress.port}/embed`;
  const evidence = join(projectRoot, "output", "playwright", "multires");
  await rm(evidence, { recursive: true, force: true });
  await mkdir(evidence, { recursive: true });
  try {
    const performanceBrowser = await chromium.launch({ headless: true });
    const performanceContext = await performanceBrowser.newContext({
      viewport: { width: 412, height: 915 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2.625,
    });
    const performancePage = await performanceContext.newPage();
    await performancePage.addInitScript(() => {
      window.__tourFirstFramePaintedAt = null;
      window.__tourLargestContentfulPaintAt = null;
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const latest = entries.at(-1);
          if (latest) window.__tourLargestContentfulPaintAt = latest.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {}
      const observer = new MutationObserver(() => {
        const preview = document.querySelector(".tour-first-frame");
        if (!preview || preview.dataset.qaPaintObserved === "true") return;
        preview.dataset.qaPaintObserved = "true";
        const recordPaint = async () => {
          try {
            await preview.decode();
          } catch {}
          requestAnimationFrame(() => {
            window.__tourFirstFramePaintedAt = performance.now();
          });
        };
        if (preview.complete) void recordPaint();
        else preview.addEventListener("load", recordPaint, { once: true });
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    let firstTileResponseAt = null;
    performancePage.on("response", (response) => {
      if (
        firstTileResponseAt === null &&
        /\/assets\/bm\/.+\/base\.webp(?:\?|$)/.test(response.url()) &&
        response.ok()
      )
        firstTileResponseAt = Date.now();
    });
    const devtools = await performanceContext.newCDPSession(performancePage);
    await devtools.send("Network.enable");
    await devtools.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: (4 * 1024 * 1024) / 8,
      uploadThroughput: (1 * 1024 * 1024) / 8,
      connectionType: "cellular4g",
    });
    await devtools.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await performancePage.goto(baseUrl, { waitUntil: "commit" });
    await performancePage.waitForFunction(
      () => Number.isFinite(window.__tourFirstFramePaintedAt),
      null,
      { timeout: 30_000 },
    );
    const firstFrameObservation = await performancePage.evaluate(() => ({
      lcp: window.__tourLargestContentfulPaintAt,
      frameReady: window.__tourFirstFramePaintedAt,
    }));
    const firstFrameMs =
      firstFrameObservation.lcp ?? firstFrameObservation.frameReady;
    const harnessObservedFirstFrameMs = await performancePage.evaluate(() =>
      performance.now(),
    );
    const recognisableFrameMs = firstFrameMs;
    for (
      let attempt = 0;
      firstTileResponseAt === null && attempt < 300;
      attempt += 1
    ) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    assert(
      firstTileResponseAt !== null,
      "No first-scene bounded base completed on the performance profile.",
    );
    await performancePage.evaluate(
      () =>
        new Promise((resolvePromise) =>
          requestAnimationFrame(() => requestAnimationFrame(resolvePromise)),
        ),
    );
    const timing = {
      firstFrameMs,
      recognisableFrameMs,
      firstFrameReadyMs: firstFrameObservation.frameReady,
      harnessObservedFirstFrameMs,
      firstTileMs: await performancePage.evaluate(() => performance.now()),
    };
    const browserTiming = await performancePage.evaluate(() => ({
      navigation: performance
        .getEntriesByType("navigation")
        .map((entry) => entry.toJSON()),
      resources: performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        startTime: entry.startTime,
        responseEnd: entry.responseEnd,
        duration: entry.duration,
        transferSize: entry.transferSize,
      })),
    }));
    await writeFile(
      join(evidence, "performance.json"),
      `${JSON.stringify(
        {
          profile:
            "Chromium 412x915, 4x CPU, 4 Mbps down / 1 Mbps up, 40 ms RTT",
          budgets: { firstFrameMs: 500, recognisableFrameMs: 1000 },
          measured: timing,
          browserTiming,
        },
        null,
        2,
      )}\n`,
    );
    assert(
      timing.firstFrameMs <= 500,
      `First tour frame took ${Math.round(timing.firstFrameMs)} ms; budget is 500 ms on the emulated medium mobile / 4G profile.`,
    );
    assert(
      timing.recognisableFrameMs <= 1000,
      `Recognisable tour frame took ${Math.round(timing.recognisableFrameMs)} ms; budget is 1000 ms on the emulated medium mobile / 4G profile.`,
    );
    await performanceContext.close();
    await performanceBrowser.close();

    const iphoneUserAgent =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
    for (const target of [
      {
        name: "chromium-desktop",
        engine: chromium,
        viewport: { width: 1365, height: 768 },
        mobile: false,
        nativeMobile: false,
      },
      {
        name: "chromium-mobile",
        engine: chromium,
        viewport: { width: 390, height: 844 },
        mobile: true,
        nativeMobile: true,
        userAgent: iphoneUserAgent,
      },
      {
        name: "webkit-mobile",
        engine: webkit,
        viewport: { width: 390, height: 844 },
        mobile: true,
        nativeMobile: true,
        userAgent: iphoneUserAgent,
      },
    ]) {
      const browser = await target.engine.launch({ headless: true });
      const context = await browser.newContext({
        viewport: target.viewport,
        isMobile: target.mobile,
        hasTouch: target.mobile,
        userAgent: target.userAgent,
      });
      const page = await context.newPage();
      const consoleErrors = [];
      const networkErrors = [];
      const tileRequests = [];
      const expectedFailureCounts = new Map();
      let rejectedBaseTiles = 0;
      let rejectBaseTilesUntil = 0;
      let delayedDetailResponses = 0;
      let expectedDocumentCancellationUntil = 0;
      await page.route(
        /\/assets\/bm\/.+\/(?:mobile-detail|desktop-detail)\.webp(?:\?.*)?$/,
        async (route) => {
          if (target.name === "chromium-desktop") {
            await new Promise((resolve) => setTimeout(resolve, 1_200));
            delayedDetailResponses += 1;
          }
          await route.continue();
        },
      );
      await page.route(
        /\/assets\/bm\/.+\/base\.webp(?:\?.*)?$/,
        async (route) => {
          if (
            target.name !== "webkit-mobile" ||
            Date.now() >= rejectBaseTilesUntil
          ) {
            await route.continue();
            return;
          }
          const url = route.request().url();
          expectedFailureCounts.set(
            url,
            (expectedFailureCounts.get(url) || 0) + 1,
          );
          rejectedBaseTiles += 1;
          await route.abort("failed");
        },
      );
      await page.addInitScript((hideResourceTiming) => {
        if (hideResourceTiming) {
          const nativeGetEntriesByType =
            performance.getEntriesByType.bind(performance);
          Object.defineProperty(performance, "getEntriesByType", {
            configurable: true,
            value: (entryType) =>
              entryType === "resource" ? [] : nativeGetEntriesByType(entryType),
          });
        }
        window.__tourTransitionEvents = [];
        window.__tourReadyMessages = [];
        document.addEventListener("raindigit:tour-transition", (event) => {
          window.__tourTransitionEvents.push({
            ...event.detail,
            at: performance.now(),
          });
        });
        window.addEventListener("message", (event) => {
          if (event.data?.type === "raindigit-tour-ready")
            window.__tourReadyMessages.push(event.data);
        });
      }, target.name === "webkit-mobile");
      page.on("console", (message) => {
        if (message.type() === "error" && message.text() !== "not granted")
          consoleErrors.push(message.text());
      });
      page.on("requestfailed", (request) => {
        const expectedCount = expectedFailureCounts.get(request.url()) || 0;
        if (expectedCount > 0) {
          expectedFailureCounts.set(request.url(), expectedCount - 1);
          return;
        }
        const failure = request.failure()?.errorText || "failed";
        if (
          Date.now() < expectedDocumentCancellationUntil &&
          failure.toLowerCase() === "cancelled"
        )
          return;
        networkErrors.push(`${request.url()}: ${failure}`);
      });
      page.on("response", (response) => {
        if (response.status() >= 400)
          networkErrors.push(`${response.status()} ${response.url()}`);
        if (/\/assets\/bm\/.+\/.+\.webp(?:\?|$)/.test(response.url()))
          tileRequests.push(response.url());
      });
      // Do not let navigation-level network idleness hide whether the runtime
      // releases on the base cube while detail requests remain delayed.
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page
        .locator(".pnlm-render-container canvas")
        .waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForFunction(
        () =>
          document.documentElement.classList.contains("is-tour-ready") &&
          window.__tourReadyMessages.length === 1,
        null,
        { timeout: 30_000 },
      );
      const readiness = await page.evaluate(() => ({
        canvas: Boolean(
          document.querySelector(".pnlm-render-container canvas"),
        ),
        runtimeStyles: document.documentElement.dataset.runtimeStyles,
        messages: window.__tourReadyMessages,
      }));
      assert(
        readiness.canvas && readiness.runtimeStyles === "ready",
        `${target.name} announced readiness before the rendered runtime was ready.`,
      );
      assert(
        readiness.messages.length === 1 &&
          readiness.messages[0].version === 1 &&
          readiness.messages[0].slug === "future-multires-qa",
        `${target.name} did not emit exactly one versioned, identified readiness message.`,
      );
      await page.waitForFunction(
        () =>
          window.__tourTransitionEvents.some(
            (entry) =>
              entry.phase === "complete" &&
              entry.initial === true &&
              entry.patchCount === 0,
          ),
        null,
        { timeout: 30_000 },
      );
      const initialTransition = await page.evaluate(() => ({
        bootGuard: document.documentElement.classList.contains(
          "is-tour-transition-boot",
        ),
        shellGuard: document
          .querySelector(".tour-shell")
          ?.classList.contains("is-transition-guarded"),
        variant: document.documentElement.dataset.tourSceneTransition,
        firstFrameConnected: Boolean(
          document.querySelector(".tour-first-frame")?.isConnected,
        ),
        events: window.__tourTransitionEvents,
      }));
      assert(
        !initialTransition.bootGuard && !initialTransition.shellGuard,
        `${target.name} did not release the first-scene transition guard.`,
      );
      assert(
        initialTransition.variant === "target-base-progressive-v8",
        `${target.name} selected ${initialTransition.variant || "no transition"}.`,
      );
      const initialComplete = initialTransition.events.find(
        (entry) => entry.phase === "complete" && entry.initial === true,
      );
      assert(
        initialComplete?.baseRequired === 1 &&
          initialComplete.baseLoaded === 1 &&
          initialComplete.baseFailed === 0 &&
          initialComplete.basePending === 0 &&
          initialComplete.boundedBaseReady === true,
        `${target.name} released before the bounded base was decoded: ${JSON.stringify(initialComplete)}.`,
      );
      if (target.name === "chromium-desktop")
        assert(
          delayedDetailResponses === 0,
          "The first reveal incorrectly waited for delayed bounded detail media.",
        );
      if (target.nativeMobile)
        assert(
          initialTransition.firstFrameConnected,
          `${target.name} removed the persistent mobile preview guard.`,
        );
      const screenshot = await page.screenshot({
        path: join(evidence, `${target.name}.png`),
        fullPage: true,
      });
      assert(
        screenshot.byteLength > 30_000,
        `${target.name} screenshot is unexpectedly empty.`,
      );
      assert(
        (await page.locator(".scene-card").count()) === 2,
        `${target.name} lost scene navigation.`,
      );
      const waitForScene = async (sceneId, counter) => {
        try {
          await page.waitForFunction(
            ([expectedScene, expectedCounter]) =>
              document
                .querySelector(`.scene-card[data-scene="${expectedScene}"]`)
                ?.classList.contains("is-active") &&
              document.querySelector("#sceneCounter")?.textContent ===
                expectedCounter,
            [sceneId, counter],
            { timeout: 30_000 },
          );
        } catch (error) {
          const debug = await page.evaluate(() => ({
            scene: window.__tourViewer?.getScene(),
            counter: document.querySelector("#sceneCounter")?.textContent,
            cards: Array.from(document.querySelectorAll(".scene-card")).map(
              (card) => ({
                scene: card.dataset.scene,
                active: card.classList.contains("is-active"),
              }),
            ),
          }));
          throw new Error(
            `${target.name} did not activate ${sceneId}: ${JSON.stringify(debug)}; ${error.message}`,
          );
        }
      };
      await page
        .locator('.scene-card[data-scene="scene-002"]')
        .evaluate((button) => button.click());
      await waitForScene("scene-002", "View 2 of 2");
      await page.waitForFunction(
        () =>
          window.__tourTransitionEvents.filter(
            (entry) => entry.phase === "complete",
          ).length >= 2,
        null,
        { timeout: 30_000 },
      );
      const sceneTransition = await page.evaluate(() =>
        window.__tourTransitionEvents
          .filter((entry) => entry.phase === "complete")
          .at(-1),
      );
      assert(
        sceneTransition.initial === false && sceneTransition.patchCount === 0,
        `${target.name} used the wrong scene-transition strategy.`,
      );
      await page
        .locator('.scene-card[data-scene="scene-001"]')
        .evaluate((button) => button.click());
      await waitForScene("scene-001", "View 1 of 2");
      await page.waitForFunction(
        () =>
          window.__tourTransitionEvents.filter(
            (entry) => entry.phase === "complete",
          ).length >= 3,
        null,
        { timeout: 30_000 },
      );
      const firstHotspot = page.locator(".nav-hotspot-anchor").first();
      await firstHotspot.waitFor({ state: "attached" });
      const hotspotStacking = await firstHotspot.evaluate((hotspot) => {
        const userInterface = hotspot.closest(".pnlm-ui");
        const renderer = document.querySelector(".pnlm-render-container");
        const box = hotspot.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return {
          userInterfaceZ: Number(getComputedStyle(userInterface).zIndex),
          rendererZ: Number(getComputedStyle(renderer).zIndex),
          ownsHitTarget: hit === hotspot || hotspot.contains(hit),
        };
      });
      assert(
        hotspotStacking.userInterfaceZ > hotspotStacking.rendererZ &&
          hotspotStacking.ownsHitTarget,
        `${target.name} hotspot is interactive but its parent layer is below the panorama: ${JSON.stringify(hotspotStacking)}.`,
      );
      const changedPixelRatio = await visibleHotspotPixelRatio(
        page,
        firstHotspot,
      );
      assert(
        changedPixelRatio > 0.25,
        `${target.name} hotspot is clickable but does not paint above the panorama: ${JSON.stringify({ changedPixelRatio })}.`,
      );
      const nativeNavigationHandlers = await firstHotspot.evaluate((hotspot) => ({
        click: hotspot.onclick?.toString() ?? null,
        touchend: hotspot.ontouchend?.toString() ?? null,
      }));
      assert(
        nativeNavigationHandlers.click === null &&
          nativeNavigationHandlers.touchend === null,
        `${target.name} installed a second native scene-navigation owner on the hotspot: ${JSON.stringify(nativeNavigationHandlers)}.`,
      );
      assert(
        (await firstHotspot.getAttribute("aria-label"))?.toLowerCase() ===
          "go to second",
        `${target.name} first hotspot label is wrong: ${await firstHotspot.getAttribute("aria-label")}.`,
      );
      const expectedForwardArrival = await page.evaluate(
        () =>
          window.TOUR_CONFIG.scenes.find((scene) => scene.id === "scene-001")
            .hotspots[0],
      );
      await firstHotspot.dispatchEvent("pointerdown", {
        pointerType: "mouse",
        button: 0,
      });
      await firstHotspot.evaluate((button) => button.click());
      await waitForScene("scene-002", "View 2 of 2");
      await page.waitForFunction(
        () =>
          window.__tourTransitionEvents.filter(
            (entry) => entry.phase === "complete",
          ).length >= 4,
        null,
        { timeout: 30_000 },
      );
      const forwardArrival = await page.evaluate(() => ({
        pitch: window.__tourViewer.getPitch(),
        yaw: window.__tourViewer.getYaw(),
        hfov: window.__tourViewer.getHfov(),
      }));
      const yawDistance = (left, right) =>
        Math.abs(((left - right + 540) % 360) - 180);
      assert(
        Math.abs(forwardArrival.pitch - expectedForwardArrival.targetPitch) <=
          0.6 &&
          yawDistance(forwardArrival.yaw, expectedForwardArrival.targetYaw) <=
            0.6 &&
          Math.abs(forwardArrival.hfov - expectedForwardArrival.targetHfov) <=
            0.6,
        `${target.name} lost the forward hotspot arrival view: ${JSON.stringify({ expected: expectedForwardArrival, actual: forwardArrival })}.`,
      );
      const secondHotspot = page.locator(".nav-hotspot-anchor").first();
      await secondHotspot.waitFor({ state: "attached" });
      assert(
        (await secondHotspot.getAttribute("aria-label"))?.toLowerCase() ===
          "go to entry",
        `${target.name} return hotspot label is wrong.`,
      );
      const expectedReturnArrival = await page.evaluate(
        () =>
          window.TOUR_CONFIG.scenes.find((scene) => scene.id === "scene-002")
            .hotspots[0],
      );
      await secondHotspot.dispatchEvent("pointerdown", {
        pointerType: "mouse",
        button: 0,
      });
      await secondHotspot.evaluate((button) => button.click());
      await waitForScene("scene-001", "View 1 of 2");
      await page.waitForFunction(
        () =>
          window.__tourTransitionEvents.filter(
            (entry) => entry.phase === "complete",
          ).length >= 5,
        null,
        { timeout: 30_000 },
      );
      const returnArrival = await page.evaluate(() => ({
        pitch: window.__tourViewer.getPitch(),
        yaw: window.__tourViewer.getYaw(),
        hfov: window.__tourViewer.getHfov(),
      }));
      assert(
        Math.abs(returnArrival.pitch - expectedReturnArrival.targetPitch) <=
          0.6 &&
          yawDistance(returnArrival.yaw, expectedReturnArrival.targetYaw) <=
            0.6 &&
          Math.abs(returnArrival.hfov - expectedReturnArrival.targetHfov) <=
            0.6,
        `${target.name} lost the return hotspot arrival view: ${JSON.stringify({ expected: expectedReturnArrival, actual: returnArrival })}.`,
      );
      if (target.nativeMobile) {
        const mobileSteadyState = await page.evaluate(() => ({
          firstFrameConnected: Boolean(
            document.querySelector(".tour-first-frame")?.isConnected,
          ),
          guarded: document
            .querySelector(".tour-shell")
            ?.classList.contains("is-transition-guarded"),
          state: window.__rainDigitTourTransition?.state?.(),
        }));
        assert(
          mobileSteadyState.firstFrameConnected &&
            !mobileSteadyState.guarded &&
            mobileSteadyState.state?.phase === "ready",
          `${target.name} did not return to a reusable mobile steady state: ${JSON.stringify(mobileSteadyState)}.`,
        );
      }

      if (target.name === "webkit-mobile") {
        await page.reload({ waitUntil: "networkidle" });
        await page.waitForFunction(
          () =>
            document.documentElement.classList.contains("is-tour-ready") &&
            window.__rainDigitTourTransition?.state?.().phase === "ready",
          null,
          { timeout: 30_000 },
        );
        rejectBaseTilesUntil = Date.now() + 2_500;
        const targetCard = page.locator('.scene-card[data-scene="scene-002"]');
        await targetCard.dispatchEvent("pointerdown", {
          pointerType: "touch",
          clientX: 32,
          clientY: 32,
        });
        await page.waitForFunction(
          () =>
            document
              .querySelector(".tour-shell")
              ?.classList.contains("is-transition-guarded"),
          null,
          { timeout: 2_000 },
        );
        const guardedPreview = await page.evaluate(() => {
          const preview = document.querySelector(".tour-first-frame");
          const style = preview ? getComputedStyle(preview) : null;
          const loader = document.querySelector("[data-tour-static-loader]");
          const loaderStyle = loader ? getComputedStyle(loader) : null;
          return {
            connected: Boolean(preview?.isConnected),
            opacity: style?.opacity,
            visibility: style?.visibility,
            zIndex: Number(style?.zIndex || 0),
            loaderActive: loader?.classList.contains("is-active"),
            loaderOpacity: loaderStyle?.opacity,
            loaderVisibility: loaderStyle?.visibility,
          };
        });
        assert(
          guardedPreview.connected &&
            guardedPreview.opacity === "0" &&
            guardedPreview.visibility === "hidden" &&
            guardedPreview.loaderActive &&
            guardedPreview.loaderOpacity === "1" &&
            guardedPreview.loaderVisibility !== "hidden",
          `webkit-mobile did not cover the WebGL reset with the static square loader: ${JSON.stringify(guardedPreview)}.`,
        );
        await targetCard.evaluate((button) => button.click());
        await waitForScene("scene-002", "View 2 of 2");
        // Pannellum can recover a short tile outage internally before the
        // controller's deliberately conservative 20 s reload threshold. The
        // contract is eventual rendered readiness with the preview guard held
        // throughout, regardless of which layer performs that recovery.
        await page.waitForFunction(
          () =>
            window.__rainDigitTourTransition?.state?.().phase === "ready" &&
            !document
              .querySelector(".tour-shell")
              ?.classList.contains("is-transition-guarded"),
          null,
          { timeout: 30_000 },
        );
        const recovered = await page.evaluate(() => ({
          scene: window.__tourViewer?.getScene?.(),
          firstFrameConnected: Boolean(
            document.querySelector(".tour-first-frame")?.isConnected,
          ),
          state: window.__rainDigitTourTransition?.state?.(),
          events: window.__tourTransitionEvents,
        }));
        assert(
          rejectedBaseTiles > 0,
          "webkit-mobile fault injection did not reject any target-scene base tiles.",
        );
        assert(
          recovered.scene === "scene-002" &&
            recovered.firstFrameConnected &&
            recovered.state?.phase === "ready",
          `webkit-mobile did not recover from a transient base-tile failure: ${JSON.stringify(recovered)}.`,
        );

        const contextRecoveryView = await page.evaluate(() => ({
          scene: window.__tourViewer?.getScene?.(),
          pitch: window.__tourViewer?.getPitch?.(),
          yaw: window.__tourViewer?.getYaw?.(),
          hfov: window.__tourViewer?.getHfov?.(),
        }));
        const contextRecoveryNavigation = page.waitForNavigation({
          waitUntil: "commit",
          timeout: 10_000,
        });
        // Losing WebGL deliberately reloads the document. WebKit cancels any
        // outstanding progressive detail requests owned by the old document;
        // those cancellations are navigation cleanup, not delivery failures.
        expectedDocumentCancellationUntil = Date.now() + 5_000;
        const contextLossSupported = await page.evaluate(() => {
          const canvas = Array.from(
            document.querySelectorAll(".pnlm-render-container canvas"),
          ).at(-1);
          const gl =
            canvas?.getContext("webgl") ||
            canvas?.getContext("experimental-webgl");
          const extension = gl?.getExtension("WEBGL_lose_context");
          if (!extension) return false;
          extension.loseContext();
          return true;
        });
        assert(
          contextLossSupported,
          "webkit-mobile cannot exercise the real WEBGL_lose_context recovery contract.",
        );
        await page.waitForFunction(
          () => {
            const loader = document.querySelector("[data-tour-static-loader]");
            const style = loader ? getComputedStyle(loader) : null;
            const bounds = loader?.getBoundingClientRect();
            return Boolean(
              loader?.classList.contains("is-active") &&
              style?.visibility !== "hidden" &&
              Number(style?.opacity) > 0.98 &&
              bounds &&
              bounds.width >= innerWidth * 0.98 &&
              bounds.height >= innerHeight * 0.98,
            );
          },
          null,
          { timeout: 2_000 },
        );
        await contextRecoveryNavigation;
        await page.waitForFunction(
          () =>
            document.documentElement.classList.contains("is-tour-ready") &&
            window.__rainDigitTourTransition?.state?.().phase === "ready",
          null,
          { timeout: 30_000 },
        );
        const contextRecovered = await page.evaluate(() => ({
          scene: window.__tourViewer?.getScene?.(),
          pitch: window.__tourViewer?.getPitch?.(),
          yaw: window.__tourViewer?.getYaw?.(),
          hfov: window.__tourViewer?.getHfov?.(),
          markerPresent: new URLSearchParams(location.search).has(
            "webgl-recovery",
          ),
          navigatorControls:
            document.querySelectorAll("#navigatorToggle").length,
          resetControls: document.querySelectorAll("#resetView").length,
          captureControls: document.querySelectorAll("#captureView").length,
          fullscreenControls: document.querySelectorAll("#fullscreen").length,
        }));
        assert(
          contextRecovered.scene === contextRecoveryView.scene &&
            Math.abs(contextRecovered.pitch - contextRecoveryView.pitch) <=
              0.6 &&
            yawDistance(contextRecovered.yaw, contextRecoveryView.yaw) <= 0.6 &&
            Math.abs(contextRecovered.hfov - contextRecoveryView.hfov) <= 0.6,
          `webkit-mobile lost the scene/view during document-level WebGL recovery: ${JSON.stringify({ before: contextRecoveryView, after: contextRecovered })}.`,
        );
        assert(
          !contextRecovered.markerPresent &&
            contextRecovered.navigatorControls === 1 &&
            contextRecovered.resetControls === 1 &&
            contextRecovered.captureControls === 1 &&
            contextRecovered.fullscreenControls === 1,
          `webkit-mobile left a recovery marker or duplicated controls: ${JSON.stringify(contextRecovered)}.`,
        );
      }
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      assert(
        layout.scrollWidth <= layout.width,
        `${target.name} has horizontal overflow.`,
      );
      assert(
        tileRequests.length > 0,
        `${target.name} did not request bounded WebP media.`,
      );
      assert(
        consoleErrors.length === 0,
        `${target.name} console errors: ${consoleErrors.join(" | ")}`,
      );
      assert(
        networkErrors.length === 0,
        `${target.name} network errors: ${networkErrors.join(" | ")}`,
      );

      await page.goto(clientUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => document.documentElement.dataset.tourClientReady === "true",
        null,
        { timeout: 30_000 },
      );
      const clientFrameElement = await page.locator("#tour").elementHandle();
      const clientFrame = await clientFrameElement?.contentFrame();
      assert(
        clientFrame,
        `${target.name} could not embed the portable release from an independent site origin.`,
      );
      await clientFrame.waitForFunction(
        () =>
          document.documentElement.classList.contains("is-tour-ready") &&
          Boolean(document.querySelector(".pnlm-render-container canvas")),
        null,
        { timeout: 30_000 },
      );

      // Chromium and WebKit may suspend compositor callbacks below the fold.
      // The viewer may prepare off-screen, but the visual-ready contract must
      // keep its opaque guard until the iframe receives a real presentation
      // frame after entering the viewport.
      await page.goto(`${clientUrl}-offscreen`, {
        waitUntil: "domcontentloaded",
      });
      const offscreenFrameElement = await page.locator("#tour").elementHandle();
      const offscreenFrame = await offscreenFrameElement?.contentFrame();
      assert(
        offscreenFrame,
        `${target.name} could not initialise the off-screen embedded release.`,
      );
      // Some engines defer the complete iframe document below the fold. The
      // package-level shell contract already proves that its first parsed
      // paint is the neutral guard; runtime readiness is asserted after the
      // real viewport intersection below.
      await page.locator("#tour").scrollIntoViewIfNeeded();
      await offscreenFrame.waitForFunction(
        () =>
          document.documentElement.classList.contains("is-tour-ready") &&
          Boolean(document.querySelector(".pnlm-render-container canvas")),
        null,
        { timeout: 30_000 },
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.tourClientReady === "true",
        null,
        { timeout: 30_000 },
      );
      await context.close();
      await browser.close();
    }
  } finally {
    await new Promise((resolvePromise) => clientServer.close(resolvePromise));
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

async function main() {
  assert(
    releaseIdentity({ tourVersion: studioVersion }).tourVersion ===
      studioVersion,
    "Studio capability identity is not canonical.",
  );
  let mismatchRejected = false;
  try {
    releaseIdentity({ tourVersion: "1.0.0" });
  } catch {
    mismatchRejected = true;
  }
  assert(
    mismatchRejected,
    "Studio accepted a tour capability version that differs from Studio.",
  );
  const root = await mkdtemp(join(tmpdir(), "raindigit-multires-test-"));
  const workspace = join(root, "workspace");
  const output = join(root, "package");
  const secondOutput = join(root, "package-repeat");
  const metadataOnlyOutput = join(root, "package-metadata-only");
  const oneSceneOutput = join(root, "package-one-scene-change");
  const cache = join(root, "build-cache");
  const zip = join(root, "future-multires-qa.zip");
  try {
    await mkdir(join(workspace, "panoramas"), { recursive: true });
    await mkdir(join(workspace, "thumbnails"), { recursive: true });
    for (const [id, colors] of [
      ["scene-001", ["#102e52", "#dab862"]],
      ["scene-002", ["#4a1b2b", "#6eb5a4"]],
    ]) {
      const panorama = join(workspace, "panoramas", `${id}.jpg`);
      await runMagick([
        "-size",
        // Exercise the real two-level hybrid contract in the browser test.
        // A 2048x1024 fixture only creates a 1024px cube face, so it cannot
        // prove that readiness ignores delayed level-2 detail tiles.
        "8192x4096",
        `gradient:${colors[0]}-${colors[1]}`,
        "-quality",
        "92",
        panorama,
      ]);
      await runMagick([
        panorama,
        "-thumbnail",
        "480x240^",
        "-gravity",
        "center",
        "-extent",
        "480x240",
        join(workspace, "thumbnails", `${id}.jpg`),
      ]);
    }
    const project = {
      schema: "raindigit-tour-project/v1",
      title: "Future Multires QA",
      firstScene: "scene-001",
      rooms: [{ id: "room-a", label: "Room A" }],
      floors: [{ id: "floor-1", label: "Ground floor" }],
      scenes: [
        {
          id: "scene-001",
          title: "Entry",
          subtitle: "First",
          space: "room-a",
          spaceLabel: "Room A",
          floor: "floor-1",
          floorLabel: "Ground floor",
          panorama: "panoramas/scene-001.jpg",
          thumb: "thumbnails/scene-001.jpg",
          pitch: -7,
          yaw: 31,
          hfov: 88,
          hotspots: [
            {
              kind: "doorway",
              pitch: -12,
              yaw: 42,
              target: "scene-002",
              label: "Go to second",
              targetPitch: -4,
              targetYaw: 81,
              targetHfov: 90,
              positionConfirmed: true,
              arrivalConfirmed: true,
            },
          ],
        },
        {
          id: "scene-002",
          title: "Second",
          subtitle: "Second",
          space: "room-a",
          spaceLabel: "Room A",
          floor: "floor-1",
          floorLabel: "Ground floor",
          panorama: "panoramas/scene-002.jpg",
          thumb: "thumbnails/scene-002.jpg",
          pitch: -4,
          yaw: 81,
          hfov: 90,
          hotspots: [
            {
              kind: "doorway",
              pitch: -10,
              yaw: -35,
              target: "scene-001",
              label: "Go to entry",
              targetPitch: -7,
              targetYaw: 31,
              targetHfov: 88,
              positionConfirmed: true,
              arrivalConfirmed: true,
            },
          ],
        },
      ],
    };
    await writeFile(
      join(workspace, "tour-project.json"),
      `${JSON.stringify(project, null, 2)}\n`,
    );
    await writeFile(
      join(workspace, "draft.json"),
      `${JSON.stringify({ schema: "raindigit-tour-hotspot-overrides/v1", overrides: {}, addedHotspots: {}, sceneViews: {}, sceneAdjustments: {}, localAdjustments: {} }, null, 2)}\n`,
    );

    const builder = join(projectRoot, "scripts", "build-multires-release.mjs");
    const releaseArguments = [
      "--tour-version",
      studioVersion,
      "--change-summary",
      "Automated portable release contract fixture",
    ];
    const { stdout: coldBuildOutput } = await execFileAsync(
      process.execPath,
      [
        builder,
        "--workspace",
        workspace,
        "--output",
        output,
        "--zip",
        zip,
        "--cache-dir",
        cache,
        "--slug",
        "future-multires-qa",
        "--rollback-version",
        "legacy-0123456789ab",
        "--runtime-template",
        join(projectRoot, "web-tour"),
        ...releaseArguments,
        "--replace",
      ],
      { cwd: projectRoot, timeout: 20 * 60 * 1000 },
    );
    const coldBuild = JSON.parse(coldBuildOutput);
    assert(
      coldBuild.cache.enabled &&
        coldBuild.cache.base.hits === 0 &&
        coldBuild.cache.base.misses === 2,
      "Cold build did not populate both base-scene cache entries.",
    );
    assert(
      coldBuild.cache.boundedMedia.hits === 0 &&
        coldBuild.cache.boundedMedia.misses === 2,
      "Cold build did not populate both bounded-media cache entries.",
    );
    const pointer = JSON.parse(
      await readFile(
        join(output, "channels", "dev", "future-multires-qa", "current.json"),
        "utf8",
      ),
    );
    assert(
      pointer.schema === "raindigit-tour-channel/v1" &&
        pointer.environment === "dev" &&
        pointer.previousPackageVersion === "legacy-0123456789ab",
      "The isolated DEV channel or rollback reference is invalid.",
    );
    assert(
      pointer.entrypoint === `${pointer.prefix}index.html` &&
        pointer.releaseManifest === `${pointer.prefix}release-manifest.json`,
      "The current pointer does not reference the immutable release.",
    );
    const releaseRoot = join(output, pointer.prefix);
    const source = await readFile(
      join(releaseRoot, "js", "tour-config.js"),
      "utf8",
    );
    const context = { window: {} };
    vm.runInNewContext(source, context);
    const config = context.window.TOUR_CONFIG;
    assert(config.firstScene === "scene-001", "Opening scene changed.");
    assert(
      config.scenes.map((scene) => scene.id).join(",") ===
        "scene-001,scene-002",
      "Scene order changed.",
    );
    assert(
      config.scenes[0].pitch === -7 &&
        config.scenes[0].yaw === 31 &&
        config.scenes[0].hfov === 88,
      "Opening view changed.",
    );
    assert(
      config.scenes[0].hotspots[0].target === "scene-002",
      "Hotspot destination changed.",
    );
    assert(
      config.scenes.every(
        (scene) => scene.type === "bounded-media" && !scene.panorama,
      ),
      "Scenes were not converted to bounded media.",
    );
    assert(
      config.scenes.every(
        (scene) =>
          scene.boundedMedia.deliveryCapability === "bounded-media-v1" &&
          scene.boundedMedia.mediaProfile ===
            "bounded-equirect-base-mobile4096-desktop8192-fallback-v1" &&
          scene.boundedMedia.objectCount === 4 &&
          scene.boundedMedia.objects.length === 4 &&
          scene.boundedMedia.preview.startsWith("data:image/webp;base64,") &&
          scene.boundedMedia.objects.map((object) => object.role).join(",") ===
            "base,mobile-detail,desktop-detail,fallback",
      ),
      "Bounded-media contract is incomplete.",
    );

    const files = await walk(releaseRoot);
    const boundedMediaFiles = files.filter((path) =>
      path.includes(`${join("assets", "bm")}${sep}`),
    );
    const webpMedia = boundedMediaFiles.filter((path) =>
      path.endsWith(".webp"),
    );
    const fallbacks = boundedMediaFiles.filter((path) =>
      path.endsWith("fallback.jpg"),
    );
    assert(
      webpMedia.length === 6,
      `Expected 6 bounded WebP objects, found ${webpMedia.length}.`,
    );
    assert(
      fallbacks.length === 2,
      `Expected 2 bounded JPEG fallbacks, found ${fallbacks.length}.`,
    );
    assert(
      !files.some((path) => /\/assets\/p\//.test(path)),
      "Full equirectangular public files were retained.",
    );
    for (const media of boundedMediaFiles) {
      const [width, height] = await imageDimensions(media);
      assert(
        width <= 8192 && height <= 4096,
        `${media} exceeds the bounded 8192x4096 ceiling.`,
      );
    }
    const manifest = JSON.parse(
      await readFile(join(releaseRoot, "release-manifest.json"), "utf8"),
    );
    assert(
      manifest.version.startsWith("bounded-") &&
        manifest.immutablePrefix.includes(manifest.version) &&
        manifest.packageVersion === pointer.packageVersion,
      "Versioned immutable manifest is invalid.",
    );
    assert(
      manifest.schema === "raindigit-tour-bounded-release/v1" &&
        manifest.deliveryCapability === "bounded-media-v1" &&
        manifest.mediaProfile ===
          "bounded-equirect-base-mobile4096-desktop8192-fallback-v1" &&
        manifest.mediaRecipeVersion === "progressive-equirectangular-v1" &&
        manifest.compilerRecipe ===
          "sharp-bounded-equirect-base2048-mobile4096-desktop8192-fallback1024-webp82-jpeg86-v1" &&
        manifest.mediaTopology.actualObjectsPerScene === 4 &&
        manifest.mediaTopology.hardMaxObjectsPerScene === 5 &&
        manifest.studioVersion === studioVersion &&
        manifest.formatVersion === releaseContract.formatVersion &&
        manifest.runtimeVersion === releaseContract.runtimeVersion &&
        manifest.tourVersion === manifest.studioVersion,
      "Capability release identity is invalid.",
    );
    assert(
      manifest.capabilities.includes("self-contained-media") &&
        !manifest.mediaDependency,
      "Release is not explicitly self-contained.",
    );
    assert(
      (await readFile(join(releaseRoot, "CHANGELOG.md"), "utf8")).includes(
        "Automated portable release contract fixture",
      ),
      "Human tour changelog is missing.",
    );
    assert(
      JSON.parse(await readFile(join(releaseRoot, "CHANGELOG.json"), "utf8"))
        .releases[0].verificationProfile === manifest.verificationProfile,
      "Machine tour changelog is incompatible with the manifest.",
    );
    assert(
      manifest.rollbackVersion === "legacy-0123456789ab",
      "Release manifest lost the rollback version.",
    );
    assert(
      Object.keys(manifest.sceneViews).length === 2 &&
        manifest.hotspotGraph.length === 2,
      "Scene views or hotspot graph are missing from the release manifest.",
    );
    assert(
      manifest.fileCount === manifest.files.length &&
        manifest.bytes ===
          manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      "Release inventory totals are invalid.",
    );
    assert(
      manifest.performance.previewBytes <= 30 * 1024,
      "Preview exceeds 30 KB.",
    );
    assert(
      manifest.performance.posterWidth === 1200 &&
        manifest.performance.posterHeight === 630,
      "SEO poster is not 1200x630.",
    );
    assert(
      manifest.performance.criticalBytes <= 1024 * 1024,
      "First-scene critical payload exceeds 1 MB.",
    );
    const inventoryByPath = new Map(
      manifest.files.map((file) => [file.path, file.bytes]),
    );
    assert(
      manifest.performance.criticalBytes ===
        manifest.performance.criticalFiles.reduce(
          (sum, path) => sum + (inventoryByPath.get(path) || 0),
          0,
        ),
      "First-scene critical byte accounting differs from the immutable inventory.",
    );
    assert(
      manifest.performance.criticalFiles.length >= 8 &&
        manifest.performance.fallbackFiles.length === 1,
      "First-scene budget inventory is incomplete.",
    );
    assert(
      manifest.performance.criticalFiles.every((path) =>
        files.includes(join(releaseRoot, path)),
      ),
      "A critical first-scene file is absent from the release.",
    );
    assert(
      manifest.performance.fallbackFiles.every((path) =>
        files.includes(join(releaseRoot, path)),
      ),
      "The first-scene bounded fallback is absent from the release.",
    );
    const seoDraft = JSON.parse(
      await readFile(join(releaseRoot, manifest.performance.seoDraft), "utf8"),
    );
    assert(
      seoDraft.seoTitle &&
        seoDraft.seoDescription.length >= 140 &&
        seoDraft.seoDescription.length <= 160 &&
        seoDraft.landingDescriptionDraft,
      "SEO draft is incomplete.",
    );
    for (const entry of manifest.files) {
      const body = await readFile(join(releaseRoot, entry.path));
      assert(
        body.byteLength === entry.bytes,
        `Inventory size is wrong for ${entry.path}.`,
      );
      assert(
        createHash("sha256").update(body).digest("hex") === entry.sha256,
        `Inventory hash is wrong for ${entry.path}.`,
      );
    }
    await execFileAsync(
      process.execPath,
      [
        join(projectRoot, "scripts", "verify-portable-release.mjs"),
        "--package",
        output,
        "--slug",
        "future-multires-qa",
        "--environment",
        "dev",
      ],
      { cwd: projectRoot },
    );
    const devPointerPath = join(
      output,
      "channels",
      "dev",
      "future-multires-qa",
      "current.json",
    );
    const devPointerBeforePromotion = await readFile(devPointerPath, "utf8");
    const evidencePath = join(root, "physical-acceptance.json");
    await writeFile(
      evidencePath,
      `${JSON.stringify(
        {
          schema: "raindigit-tour-physical-acceptance/v1",
          id: "fixture-physical-acceptance",
          passed: true,
          slug: pointer.slug,
          packageVersion: pointer.packageVersion,
          contentDigest: pointer.contentDigest,
          device: "Physical iPhone fixture",
          browser: "Safari fixture",
          checks: [
            "first-frame",
            "touch",
            "scene-transition",
            "rotation",
            "recovery",
          ],
        },
        null,
        2,
      )}\n`,
    );
    await execFileAsync(
      process.execPath,
      [
        join(projectRoot, "scripts", "promote-tour-channel.mjs"),
        "--package",
        output,
        "--slug",
        "future-multires-qa",
        "--evidence",
        evidencePath,
      ],
      { cwd: projectRoot },
    );
    assert(
      (await readFile(devPointerPath, "utf8")) === devPointerBeforePromotion,
      "Promotion mutated the independent DEV channel.",
    );
    const prodPointer = JSON.parse(
      await readFile(
        join(output, "channels", "prod", "future-multires-qa", "current.json"),
        "utf8",
      ),
    );
    assert(
      prodPointer.environment === "prod" &&
        prodPointer.packageVersion === pointer.packageVersion &&
        prodPointer.contentDigest === pointer.contentDigest,
      "Production promotion rebuilt or changed the verified DEV digest.",
    );
    const invalidEvidencePath = join(root, "invalid-physical-acceptance.json");
    await writeFile(
      invalidEvidencePath,
      `${JSON.stringify({ ...JSON.parse(await readFile(evidencePath, "utf8")), contentDigest: "0".repeat(64) }, null, 2)}\n`,
    );
    let rejectedMismatchedPromotion = false;
    try {
      await execFileAsync(
        process.execPath,
        [
          join(projectRoot, "scripts", "promote-tour-channel.mjs"),
          "--package",
          output,
          "--slug",
          "future-multires-qa",
          "--evidence",
          invalidEvidencePath,
        ],
        { cwd: projectRoot },
      );
    } catch {
      rejectedMismatchedPromotion = true;
    }
    assert(
      rejectedMismatchedPromotion,
      "Promotion accepted physical evidence for a different package digest.",
    );
    const { stdout: zipListing } = await execFileAsync("unzip", ["-Z1", zip]);
    assert(
      zipListing.includes(
        `tours/future-multires-qa/${manifest.version}/index.html`,
      ) && zipListing.includes("channels/dev/future-multires-qa/current.json"),
      "The deployable archive does not mirror the isolated DEV object layout.",
    );
    const { stdout: warmBuildOutput } = await execFileAsync(
      process.execPath,
      [
        builder,
        "--workspace",
        workspace,
        "--output",
        secondOutput,
        "--cache-dir",
        cache,
        "--slug",
        "future-multires-qa",
        "--runtime-template",
        join(projectRoot, "web-tour"),
        ...releaseArguments,
        "--replace",
      ],
      { cwd: projectRoot, timeout: 20 * 60 * 1000 },
    );
    const warmBuild = JSON.parse(warmBuildOutput);
    assert(
      warmBuild.cache.base.hits === 2 && warmBuild.cache.base.misses === 0,
      "Warm build reprocessed unchanged base panoramas.",
    );
    assert(
      warmBuild.cache.boundedMedia.hits === 2 &&
        warmBuild.cache.boundedMedia.misses === 0,
      "Warm build reprocessed unchanged bounded media.",
    );
    const repeatedPointer = JSON.parse(
      await readFile(
        join(
          secondOutput,
          "channels",
          "dev",
          "future-multires-qa",
          "current.json",
        ),
        "utf8",
      ),
    );
    assert(
      repeatedPointer.packageVersion === pointer.packageVersion &&
        repeatedPointer.contentDigest === pointer.contentDigest,
      "Identical source content did not produce a stable version.",
    );

    project.title = "Future Multires QA — revised description";
    await writeFile(
      join(workspace, "tour-project.json"),
      `${JSON.stringify(project, null, 2)}\n`,
    );
    const { stdout: metadataBuildOutput } = await execFileAsync(
      process.execPath,
      [
        builder,
        "--workspace",
        workspace,
        "--output",
        metadataOnlyOutput,
        "--cache-dir",
        cache,
        "--slug",
        "future-multires-qa",
        "--runtime-template",
        join(projectRoot, "web-tour"),
        ...releaseArguments,
        "--replace",
      ],
      { cwd: projectRoot, timeout: 20 * 60 * 1000 },
    );
    const metadataBuild = JSON.parse(metadataBuildOutput);
    assert(
      metadataBuild.cache.base.hits === 2 &&
        metadataBuild.cache.base.misses === 0,
      "Metadata-only edit reprocessed base panoramas.",
    );
    assert(
      metadataBuild.cache.boundedMedia.hits === 2 &&
        metadataBuild.cache.boundedMedia.misses === 0,
      "Metadata-only edit reprocessed bounded media.",
    );
    assert(
      metadataBuild.version !== pointer.version,
      "Metadata-only edit did not create a new immutable release version.",
    );

    const changedDraft = {
      schema: "raindigit-tour-hotspot-overrides/v1",
      overrides: {},
      addedHotspots: {},
      sceneViews: {},
      sceneAdjustments: {
        "scene-002": {
          brightness: 100,
          contrast: 100,
          saturation: 108,
          warmth: 0,
        },
      },
      localAdjustments: {},
    };
    await writeFile(
      join(workspace, "draft.json"),
      `${JSON.stringify(changedDraft, null, 2)}\n`,
    );
    const { stdout: oneSceneBuildOutput } = await execFileAsync(
      process.execPath,
      [
        builder,
        "--workspace",
        workspace,
        "--output",
        oneSceneOutput,
        "--cache-dir",
        cache,
        "--slug",
        "future-multires-qa",
        "--runtime-template",
        join(projectRoot, "web-tour"),
        ...releaseArguments,
        "--replace",
      ],
      { cwd: projectRoot, timeout: 20 * 60 * 1000 },
    );
    const oneSceneBuild = JSON.parse(oneSceneBuildOutput);
    assert(
      oneSceneBuild.cache.base.hits === 1 &&
        oneSceneBuild.cache.base.misses === 1,
      "One-scene colour edit did not invalidate exactly one base derivative.",
    );
    assert(
      oneSceneBuild.cache.boundedMedia.hits === 1 &&
        oneSceneBuild.cache.boundedMedia.misses === 1,
      "One-scene colour edit did not invalidate exactly one bounded-media set.",
    );
    const pannellumRuntime = await readFile(
      join(releaseRoot, "js", "pannellum.js"),
      "utf8",
    );
    assert(
      pannellumRuntime.includes("equirectangularThumbnail") &&
        pannellumRuntime.includes("texParameteri"),
      "Pinned preview or dynamic texture-parameter support is missing from the release runtime.",
    );
    const tourRuntime = await readFile(
      join(releaseRoot, "js", "tour.js"),
      "utf8",
    );
    assert(
      tourRuntime.includes("boundedMediaRuntime") &&
        tourRuntime.includes("prepareScene") &&
        tourRuntime.includes("configureScene") &&
        tourRuntime.includes("setUpdate(false)"),
      "The release runtime does not configure and suspend bounded dynamic media.",
    );
    assert(
      tourRuntime.includes("sceneFadeDuration: 0"),
      "The native scene fade can replay on top of the RainDigit scene transition.",
    );
    assert(
      !/type:\s*"scene",\s*sceneId:\s*hotspot\.target/.test(tourRuntime),
      "The release runtime lets Pannellum race RainDigit for hotspot navigation.",
    );
    const transitionBeginIndex = tourRuntime.indexOf(
      "window.__rainDigitTourTransition?.beginScene?.(sceneId);",
    );
    const boundedPrepareIndex = tourRuntime.indexOf(
      "await boundedMediaRuntime.prepareScene(sceneId)",
    );
    assert(
      transitionBeginIndex >= 0 &&
        boundedPrepareIndex >= 0 &&
        transitionBeginIndex < boundedPrepareIndex,
      "Keyboard or programmatic navigation can await bounded media before arming the opaque transition guard.",
    );
    assert(
      tourRuntime.includes("window.__tourViewer = viewer"),
      "The release runtime does not expose the live viewer to the host readiness contract.",
    );
    assert(
      tourRuntime.includes("__rainDigitTourTransition?.attach(viewer)"),
      "The shared initial and scene transition is not attached to the release viewer.",
    );
    assert(
      tourRuntime.includes("function revealRenderedTour"),
      "The release runtime does not reliably remove the inline first frame after WebGL renders.",
    );
    assert(
      tourRuntime.includes("runtimeStylesReady"),
      "The first frame can disappear before deferred runtime styles are ready.",
    );
    assert(
      tourRuntime.includes("transitionReady") &&
        tourRuntime.includes("canvas?.width > 0") &&
        tourRuntime.includes("canvas?.height > 0"),
      "The first frame can disappear before the mobile transition and WebGL canvas are ready.",
    );
    assert(
      !tourRuntime.includes("requestAnimationFrame(revealRenderedTour)"),
      "The rendered-tour reveal can stall forever in an off-screen iframe.",
    );
    const releaseEntrypoint = await readFile(
      join(releaseRoot, "index.html"),
      "utf8",
    );
    const monitoringRuntime = await readFile(
      join(releaseRoot, "js", "tour-monitoring.js"),
      "utf8",
    );
    assert(
      releaseEntrypoint.includes("data-tour-monitoring-config") &&
        releaseEntrypoint.includes('"enabled":true') &&
        releaseEntrypoint.includes(
          '"productionOrigins":["https://cdn.raindigit.ie"]',
        ) &&
        releaseEntrypoint.includes("ingest.de.sentry.io/4511985294901328"),
      "A production package can be built without canonical exact-origin monitoring.",
    );
    assert(
      monitoringRuntime.includes("__rainDigitTourMonitoring") &&
        monitoringRuntime.includes("captureTerminal"),
      "The portable release is missing its semantic terminal-error boundary.",
    );
    assert(
      releaseEntrypoint.includes("data-runtime-style-loader"),
      "Runtime stylesheets are not loaded after the inline first frame.",
    );
    assert(
      releaseEntrypoint.includes("data-runtime-loader") &&
        !releaseEntrypoint.includes('class="topbar"'),
      "Runtime controls still delay the first-frame shell.",
    );
    assert(
      (
        await readFile(join(releaseRoot, "js", "tour-chrome.js"), "utf8")
      ).includes('class=\\"topbar\\"'),
      "Deferred runtime controls are missing.",
    );
    assert(
      releaseEntrypoint.includes("data-runtime-critical"),
      "Inline first-frame critical styles are missing.",
    );
    assert(
      !/data-runtime-(?:style-)?loader[^<]*requestAnimationFrame/.test(
        releaseEntrypoint,
      ),
      "Runtime loading still depends on animation frames and can stall in an off-screen embed.",
    );
    assert(
      releaseEntrypoint.includes('class="is-tour-transition-boot"'),
      "The first scene is not guarded before runtime JavaScript starts.",
    );
    assert(
      releaseEntrypoint.includes("is-tour-transition-boot .tour-first-frame"),
      "Critical CSS can expose raw first-scene tiles before the selected transition starts.",
    );
    assert(
      releaseEntrypoint.includes("data-tour-static-loader"),
      "The first-paint square loader is missing from the portable release shell.",
    );
    assert(
      releaseEntrypoint.includes(
        "grid-template-columns:repeat(6,minmax(0,1fr))",
      ) &&
        releaseEntrypoint.includes("background:#070807") &&
        releaseEntrypoint.includes("tour-scene-transition__mobile-status"),
      "The first parsed portable loader can paint unstyled white content before deferred CSS arrives.",
    );
    assert(
      releaseEntrypoint.indexOf("data-runtime-critical") <
        releaseEntrypoint.indexOf('<link rel="stylesheet"'),
      "Critical first-paint CSS must precede every blocking stylesheet.",
    );
    assert(
      releaseEntrypoint.includes("visibility:hidden;opacity:0") ||
        releaseEntrypoint.includes(
          "visibility:hidden!important;opacity:0!important",
        ),
      "The portable release can expose the wrong first frame before the transition starts.",
    );
    const transitionRuntime = await readFile(
      join(releaseRoot, "js", "tour-transition.js"),
      "utf8",
    );
    assert(
      transitionRuntime.includes('variant: "target-base-progressive"') &&
        transitionRuntime.includes("initial-loading"),
      "The selected target-base progressive guard runtime is incomplete.",
    );
    assert(
      transitionRuntime.includes("target-base-progressive-v8") &&
        transitionRuntime.includes('tourWebglReadback = "disabled"'),
      "The release runtime lacks the zero-readback cross-device transition guard.",
    );
    assert(
      transitionRuntime.includes("viewer-canvas-settled") &&
        transitionRuntime.includes("preloadTargetBaseTiles") &&
        transitionRuntime.includes("baseAttemptIsHealthy") &&
        transitionRuntime.includes("baseLoaded") &&
        transitionRuntime.includes("detailPending") &&
        transitionRuntime.includes("renderSettleDelay") &&
        transitionRuntime.includes("armBeforeSceneReset") &&
        transitionRuntime.includes("primeInitial") &&
        transitionRuntime.includes("waitForPresentedCanvas") &&
        transitionRuntime.includes("presentationSettleDelay"),
      "The release runtime can construct WebGL before the initial opaque guard or release before the physical canvas has settled.",
    );
    assert(
      transitionRuntime.includes("scheduleDocumentContextRecovery") &&
        transitionRuntime.includes('searchParams.set("webgl-recovery"') &&
        transitionRuntime.includes("window.location.replace(recoveryUrl.href)"),
      "The release runtime can deadlock after a real mobile WebGL context loss.",
    );
    assert(
      transitionRuntime.includes("data-tour-static-loader") &&
        transitionRuntime.includes("releaseGuard"),
      "The release runtime does not adopt and release the static opaque guard.",
    );
    assert(
      !transitionRuntime.includes('getEntriesByType("resource")') &&
        !transitionRuntime.includes("getEntriesByType('resource')"),
      "The release runtime still relies on Resource Timing hidden by cross-origin iPhone Safari.",
    );
    const transitionStyles = await readFile(
      join(releaseRoot, "css", "tour.css"),
      "utf8",
    );
    for (const marker of [
      ".tour-shell > .tour-scene-transition",
      ".tour-scene-transition.is-active",
      ".tour-scene-transition__tile",
      "tour-cell-gold-pulse",
      "tour-final-arrival",
    ]) {
      assert(
        transitionStyles.includes(marker),
        `The generated release lost the Gold Pulse UI Kit style ${marker}.`,
      );
    }
    const bootstrapRuntime = await readFile(
      join(releaseRoot, "js", "tour-bootstrap.js"),
      "utf8",
    );
    for (const marker of [
      "data-runtime-recovery-boundary",
      "__rainDigitShowRuntimeRecovery",
      "Could not load ${source.src}",
    ])
      assert(
        releaseEntrypoint.includes(marker),
        `The release entrypoint cannot recover when bootstrap itself fails (${marker}).`,
      );
    assert(
      releaseEntrypoint.includes(
        "window.__rainDigitShowRuntimeRecovery?.(error)",
      ),
      "The deferred bootstrap loader does not hand its own fetch failure to the recovery boundary.",
    );
    assert(
      bootstrapRuntime.includes('tourWebglBuffer = "default"'),
      "The release does not declare its default WebGL buffer contract.",
    );
    assert(
      !bootstrapRuntime.includes("preserveDrawingBuffer") &&
        !bootstrapRuntime.includes("HTMLCanvasElement.prototype.getContext ="),
      "The release still monkeypatches WebGL capture buffers.",
    );
    for (const marker of [
      "data-tour-runtime-recovery",
      "Reload tour",
      'searchParams.set("runtime"',
      "is-tour-transition-boot",
    ])
      assert(
        bootstrapRuntime.includes(marker),
        `The release bootstrap lost the cache-busting runtime recovery boundary (${marker}).`,
      );
    await assertContentVersion(
      releaseEntrypoint,
      "css/pannellum.css",
      join(releaseRoot, "css", "pannellum.css"),
    );
    await assertContentVersion(
      releaseEntrypoint,
      "css/tour.css",
      join(releaseRoot, "css", "tour.css"),
    );
    await assertContentVersion(
      releaseEntrypoint,
      "js/tour-chrome.js",
      join(releaseRoot, "js", "tour-chrome.js"),
    );
    await assertContentVersion(
      releaseEntrypoint,
      "js/tour-monitoring.js",
      join(releaseRoot, "js", "tour-monitoring.js"),
    );
    await assertContentVersion(
      releaseEntrypoint,
      "js/tour-bootstrap.js",
      join(releaseRoot, "js", "tour-bootstrap.js"),
    );
    await assertContentVersion(
      bootstrapRuntime,
      "js/pannellum.js",
      join(releaseRoot, "js", "pannellum.js"),
    );
    await assertContentVersion(
      bootstrapRuntime,
      "js/tour-config.js",
      join(releaseRoot, "js", "tour-config.js"),
    );
    await assertContentVersion(
      bootstrapRuntime,
      "js/tour-transition.js",
      join(releaseRoot, "js", "tour-transition.js"),
    );
    await assertContentVersion(
      bootstrapRuntime,
      "js/tour.js",
      join(releaseRoot, "js", "tour.js"),
    );
    assert(
      (await stat(join(releaseRoot, "css", "tour.css"))).size <= 20 * 1024,
      "The public tour stylesheet still contains studio-only UI.",
    );
    const revisedRuntime = await readFile(
      join(projectRoot, "scripts", "revise-multires-runtime.mjs"),
      "utf8",
    );
    assert(
      revisedRuntime.includes(
        'join(options.runtimeTemplate, "css", "tour.css")',
      ) &&
        revisedRuntime.includes(
          'join(stagedRelease, "css", "tour.css")',
        ) &&
        revisedRuntime.includes("releaseTourStyles(stylesheetSource)"),
      "Runtime-only fleet revisions must install the stripped canonical Studio stylesheet.",
    );
    assert(
      revisedRuntime.includes(
        'canvas.style.filter = "url(#legacy-color-matrix)";',
      ),
      "Legacy parity calibration is lost when the operator previews the original scene adjustment.",
    );
    await runBrowserQa(output, pointer);
    console.log(
      `Future bounded release passed: ${config.scenes.length} scenes, ${webpMedia.length} WebP objects, ${fallbacks.length} JPEG fallbacks.`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  // Keep the failing assertion location in CI evidence; a generic timeout is
  // not actionable for a first-frame/mobile regression.
  console.error(error.stack || error.message);
  process.exit(1);
});
