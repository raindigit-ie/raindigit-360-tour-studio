#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium, webkit } from "@playwright/test";
import sharp from "sharp";

const url = String(process.env.TOUR_RELEASE_URL || "");
const manifestPath = resolve(process.env.TOUR_RELEASE_MANIFEST || "");
const evidencePath = resolve(
  process.env.TOUR_BROWSER_EVIDENCE || "remote-tour-browser-evidence.json",
);
const screenshotRoot = resolve(
  process.env.TOUR_BROWSER_SCREENSHOTS || "remote-tour-browser-evidence",
);
const iphoneUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const requestedTargets = new Set(
  String(process.env.TOUR_RELEASE_TARGETS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const startupIterations = Number(process.env.TOUR_RELEASE_STARTUP_ITERATIONS || "1");
const skipEdges = process.env.TOUR_RELEASE_SKIP_EDGES === "1";
const edgesEachIteration =
  process.env.TOUR_RELEASE_EDGES_EACH_ITERATION === "1";
const allowVisualFailures = process.env.TOUR_RELEASE_ALLOW_VISUAL_FAILURES === "1";
const transitionOverridePath = String(
  process.env.TOUR_TRANSITION_OVERRIDE || "",
).trim();
const pannellumOverridePath = String(
  process.env.TOUR_PANNELLUM_OVERRIDE || "",
).trim();
const maximumPureBlackRatio = 0.01;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(url.startsWith("https://"), "TOUR_RELEASE_URL must be an HTTPS URL.");
assert(
  manifestPath !== resolve(""),
  "TOUR_RELEASE_MANIFEST must identify the local release manifest.",
);
assert(
  Number.isInteger(startupIterations) && startupIterations > 0,
  "TOUR_RELEASE_STARTUP_ITERATIONS must be a positive integer.",
);

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const expectedEntrypoint = new URL(manifest.entrypoint, `${new URL(url).origin}/`).href;
assert(
  new URL(url).pathname === new URL(expectedEntrypoint).pathname,
  "Remote URL does not match the local immutable release manifest.",
);

async function waitReady(page, sceneId, previousCompleteCount = 0) {
  await page.waitForFunction(
    ([expectedScene, priorCount]) => {
      const state = window.__rainDigitTourTransition?.state?.();
      const complete = (window.__remoteTourTransitions || []).filter(
        (entry) => entry.phase === "complete",
      );
      return (
        window.__tourViewer?.getScene?.() === expectedScene &&
        document.documentElement.classList.contains("is-tour-ready") &&
        state?.phase === "ready" &&
        complete.length > priorCount
      );
    },
    [sceneId, previousCompleteCount],
    { timeout: 45_000 },
  );
}

async function captureFrameHealth(page, evidenceName, keepScreenshot = false) {
  const screenshot = await page.screenshot();
  const { data, info } = await sharp(screenshot)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const firstMeasuredRow = Math.min(64, info.height - 1);
  let pureBlackPixels = 0;
  let measuredPixels = 0;
  for (let y = firstMeasuredRow; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      measuredPixels += 1;
      if (
        data[offset] <= 4 &&
        data[offset + 1] <= 4 &&
        data[offset + 2] <= 4
      ) {
        pureBlackPixels += 1;
      }
    }
  }
  const pureBlackRatio = pureBlackPixels / measuredPixels;
  const failed = pureBlackRatio > maximumPureBlackRatio;
  if (keepScreenshot || failed) {
    await mkdir(screenshotRoot, { recursive: true });
    await writeFile(resolve(screenshotRoot, `${evidenceName}.png`), screenshot);
  }
  return {
    pureBlackPixels,
    measuredPixels,
    pureBlackRatio: Number(pureBlackRatio.toFixed(6)),
    maximumPureBlackRatio,
    failed,
  };
}

async function captureRecoveryFrames(page, evidenceName, initialFrame) {
  if (!initialFrame.failed) return [];
  const samples = [];
  let elapsedMs = 0;
  for (const delayMs of [100, 150, 250, 500]) {
    await page.waitForTimeout(delayMs);
    elapsedMs += delayMs;
    samples.push({
      elapsedMs,
      ...(await captureFrameHealth(
        page,
        `${evidenceName}-plus-${elapsedMs}`,
        true,
      )),
    });
  }
  return samples;
}

async function runTarget(target, iteration, verifyEdges) {
  const browser = await target.engine.launch({ headless: true });
  const context = await browser.newContext({
    viewport: target.viewport,
    isMobile: target.mobile,
    hasTouch: target.mobile,
    userAgent: target.userAgent,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  if (transitionOverridePath) {
    const transitionOverride = await readFile(
      resolve(transitionOverridePath),
      "utf8",
    );
    await page.route(/\/js\/tour-transition\.js(?:\?|$)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: transitionOverride,
      }),
    );
  }
  if (pannellumOverridePath) {
    const pannellumOverride = await readFile(
      resolve(pannellumOverridePath),
      "utf8",
    );
    await page.route(/\/js\/pannellum\.js(?:\?|$)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: pannellumOverride,
      }),
    );
  }
  const consoleErrors = [];
  const networkErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text() !== "not granted") {
      consoleErrors.push(message.text());
    }
  });
  page.on("requestfailed", (request) => {
    networkErrors.push(
      `${request.url()}: ${request.failure()?.errorText || "failed"}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.addInitScript(() => {
    window.__remoteTourTransitions = [];
    document.addEventListener("raindigit:tour-transition", (event) => {
      window.__remoteTourTransitions.push({
        ...event.detail,
        at: performance.now(),
      });
    });
  });

  const runUrl = new URL(url);
  runUrl.searchParams.set(
    "visual-probe",
    `${target.name}-${iteration}-${Date.now()}`,
  );
  const navigationStartedAt = performance.now();
  await page.goto(runUrl.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const initialScene = manifest.firstScene;
  await waitReady(page, initialScene, 0);
  const firstReadyWallMs = Math.round(performance.now() - navigationStartedAt);
  const initial = await page.evaluate(() => {
    const events = window.__remoteTourTransitions || [];
    const complete = events.find(
      (entry) => entry.phase === "complete" && entry.initial === true,
    );
    const overlay = document.querySelector("[data-tour-static-loader]");
    const overlayStyle = overlay ? getComputedStyle(overlay) : null;
    return {
      complete,
      scene: window.__tourViewer?.getScene?.(),
      loaded: window.__tourViewer?.isLoaded?.(),
      canvas: Boolean(
        document.querySelector(".pnlm-render-container canvas")?.isConnected,
      ),
      overlayActive: overlay?.classList.contains("is-active"),
      overlayOpacity: overlayStyle?.opacity,
      overlayVisibility: overlayStyle?.visibility,
      config: window.TOUR_CONFIG,
      transitionVariant:
        document.documentElement.dataset.tourSceneTransition || null,
      resourceEntries: performance
        .getEntriesByType("resource")
        .filter((entry) => /\/assets\/mr\//.test(entry.name))
        .map((entry) => ({
          name: entry.name,
          duration: entry.duration,
          transferSize: entry.transferSize,
          decodedBodySize: entry.decodedBodySize,
        })),
    };
  });
  assert(initial.scene === initialScene && initial.loaded && initial.canvas, `${target.name}: first scene did not render.`);
  if (transitionOverridePath) {
    assert(
      initial.transitionVariant === "target-base-progressive-v8",
      `${target.name}: local transition override was not applied.`,
    );
  }
  assert(initial.complete?.baseLoaded === 6, `${target.name}: first base cube was incomplete.`);
  assert(initial.complete?.baseFailed === 0, `${target.name}: first base cube failed.`);
  assert(initial.complete?.basePending === 0, `${target.name}: first base cube remained pending.`);
  assert(
    !initial.overlayActive &&
      initial.overlayOpacity === "0" &&
      initial.overlayVisibility === "hidden",
    `${target.name}: loader did not settle cleanly.`,
  );
  assert(initial.config.scenes.length === manifest.sceneIds.length, `${target.name}: scene count changed.`);

  const runLabel = `${target.name}-run-${String(iteration).padStart(2, "0")}`;
  const initialFrame = await captureFrameHealth(
    page,
    `${runLabel}-first-ready`,
    true,
  );
  initialFrame.recoveryFrames = await captureRecoveryFrames(
    page,
    `${runLabel}-first-ready`,
    initialFrame,
  );
  if (!allowVisualFailures) {
    assert(
      !initialFrame.failed,
      `${target.name}: first ready frame contains ${(initialFrame.pureBlackRatio * 100).toFixed(2)}% pure-black pixels.`,
    );
  }

  const edges = initial.config.scenes.flatMap((scene) =>
    scene.hotspots.map((hotspot, index) => ({
      source: scene.id,
      index,
      target: hotspot.target,
      targetPitch: hotspot.targetPitch,
      targetYaw: hotspot.targetYaw,
      targetHfov: hotspot.targetHfov,
    })),
  );
  assert(edges.length === manifest.hotspotGraph.length, `${target.name}: hotspot graph changed.`);
  const edgeResults = [];

  for (const [edgeNumber, edge] of (verifyEdges ? edges : []).entries()) {
    console.error(
      `${target.name}: edge ${edgeNumber + 1}/${edges.length} ${edge.source} -> ${edge.target}`,
    );
    const currentScene = await page.evaluate(() => window.__tourViewer?.getScene?.());
    if (currentScene !== edge.source) {
      const before = await page.evaluate(
        () =>
          (window.__remoteTourTransitions || []).filter(
            (entry) => entry.phase === "complete",
          ).length,
      );
      await page.evaluate(
        (sourceScene) => window.__tourViewer?.loadScene?.(sourceScene),
        edge.source,
      );
      await waitReady(page, edge.source, before);
    }

    const before = await page.evaluate(
      () =>
        (window.__remoteTourTransitions || []).filter(
          (entry) => entry.phase === "complete",
        ).length,
    );
    const transitionStartedAt = performance.now();
    const hotspot = page.locator(
      `[data-editor-hotspot-id="${edge.source}::${edge.index}"]`,
    );
    await hotspot.dispatchEvent("pointerdown");
    await hotspot.dispatchEvent("click");
    await waitReady(page, edge.target, before);
    const durationMs = Math.round(performance.now() - transitionStartedAt);
    const result = await page.evaluate(
      ({ source, target, priorCount }) => {
        const events = (window.__remoteTourTransitions || []).slice();
        const relevant = events.filter(
          (entry) =>
            entry.targetSceneId === target &&
            entry.sourceSceneId === source &&
            entry.phase === "complete",
        );
        const complete = relevant.at(-1);
        const loadingObserved = events.some(
          (entry) =>
            entry.targetSceneId === target &&
            entry.sourceSceneId === source &&
            ["loading", "recovering"].includes(entry.phase),
        );
        return {
          complete,
          loadingObserved,
          completeCount: events.filter((entry) => entry.phase === "complete").length,
          scene: window.__tourViewer?.getScene?.(),
          pitch: window.__tourViewer?.getPitch?.(),
          yaw: window.__tourViewer?.getYaw?.(),
          hfov: window.__tourViewer?.getHfov?.(),
          ready: document.documentElement.classList.contains("is-tour-ready"),
          priorCount,
        };
      },
      { source: edge.source, target: edge.target, priorCount: before },
    );
    assert(result.scene === edge.target && result.ready, `${target.name}: ${edge.source} -> ${edge.target} did not settle.`);
    assert(result.loadingObserved, `${target.name}: ${edge.source} -> ${edge.target} bypassed the loader guard.`);
    assert(result.complete?.baseLoaded === 6, `${target.name}: ${edge.source} -> ${edge.target} exposed an incomplete base cube.`);
    assert(result.complete?.baseFailed === 0 && result.complete?.basePending === 0, `${target.name}: ${edge.source} -> ${edge.target} ended with failed or pending base tiles.`);
    const keepScreenshot = [
      0,
      Math.floor(edges.length / 2),
      edges.length - 1,
    ].includes(edgeNumber);
    const frame = await captureFrameHealth(
      page,
      `${runLabel}-edge-${String(edgeNumber + 1).padStart(2, "0")}`,
      keepScreenshot,
    );
    frame.recoveryFrames = await captureRecoveryFrames(
      page,
      `${runLabel}-edge-${String(edgeNumber + 1).padStart(2, "0")}`,
      frame,
    );
    if (!allowVisualFailures) {
      assert(
        !frame.failed,
        `${target.name}: ${edge.source} -> ${edge.target} contains ${(frame.pureBlackRatio * 100).toFixed(2)}% pure-black pixels.`,
      );
    }
    edgeResults.push({ ...edge, durationMs, complete: result.complete, frame });
  }

  assert(consoleErrors.length === 0, `${target.name}: console errors: ${consoleErrors.join(" | ")}`);
  assert(networkErrors.length === 0, `${target.name}: network errors: ${networkErrors.join(" | ")}`);
  const durations = edgeResults.map((edge) => edge.durationMs).sort((a, b) => a - b);
  const report = {
    target: target.name,
    firstReadyWallMs,
    iteration,
    initialFrame,
    initialCompleteAtMs: Math.round(initial.complete.at),
    firstLoadMediaRequests: initial.resourceEntries.length,
    firstLoadDecodedMediaBytes: initial.resourceEntries.reduce(
      (sum, entry) => sum + entry.decodedBodySize,
      0,
    ),
    edgesVerified: edgeResults.length,
    transitionMs: durations.length
      ? {
          min: durations[0],
          average: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
          p95: durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)],
          max: durations.at(-1),
        }
      : null,
    consoleErrors,
    networkErrors,
    edges: edgeResults,
  };
  await context.close();
  await browser.close();
  return report;
}

const targets = [
  {
    name: "chromium-desktop",
    engine: chromium,
    viewport: { width: 1365, height: 768 },
    mobile: false,
  },
  {
    name: "webkit-mobile",
    engine: webkit,
    viewport: { width: 390, height: 844 },
    mobile: true,
    userAgent: iphoneUserAgent,
  },
];
const selectedTargets = requestedTargets.size
  ? targets.filter((target) => requestedTargets.has(target.name))
  : targets;
assert(selectedTargets.length > 0, "TOUR_RELEASE_TARGETS did not match a known target.");
const results = [];
for (const target of selectedTargets) {
  for (let iteration = 1; iteration <= startupIterations; iteration += 1) {
    results.push(
      await runTarget(
        target,
        iteration,
        !skipEdges && (iteration === 1 || edgesEachIteration),
      ),
    );
  }
}

const visualFailures = results.flatMap((result) => [
  ...(result.initialFrame.failed
    ? [{ target: result.target, iteration: result.iteration, frame: "initial", ...result.initialFrame }]
    : []),
  ...result.edges
    .filter((edge) => edge.frame.failed)
    .map((edge) => ({
      target: result.target,
      iteration: result.iteration,
      frame: `${edge.source}->${edge.target}`,
      ...edge.frame,
    })),
]);
assert(
  allowVisualFailures || visualFailures.length === 0,
  `${visualFailures.length} visually incomplete frame(s) detected.`,
);

const evidence = {
  schema: "raindigit-remote-tour-browser-evidence/v1",
  generatedAt: new Date().toISOString(),
  url,
  slug: manifest.slug,
  packageVersion: manifest.packageVersion,
  contentDigest: manifest.contentDigest,
  expectedScenes: manifest.sceneIds.length,
  expectedEdges: manifest.hotspotGraph.length,
  startupIterations,
  visualFailures,
  results,
};
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(evidence, null, 2));
