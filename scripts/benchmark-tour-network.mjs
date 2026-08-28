#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const candidates = JSON.parse(process.env.TOUR_NETWORK_CANDIDATES || "[]");
const outputPath = resolve(process.env.TOUR_NETWORK_EVIDENCE || "tour-network-evidence.json");
const repetitions = Number(process.env.TOUR_NETWORK_REPETITIONS || "3");
const profiles = Object.freeze([
  { id: "wifi", label: "Wi-Fi 50 Mbps", latencyMs: 20, downloadMbps: 50, uploadMbps: 20 },
  { id: "4g", label: "4G 10 Mbps", latencyMs: 80, downloadMbps: 10, uploadMbps: 3 },
  { id: "slow-4g", label: "Slow 4G 1.6 Mbps", latencyMs: 150, downloadMbps: 1.6, uploadMbps: 0.75 },
]);
const maximumPureBlackRatio = 0.01;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
}

async function frameHealth(page) {
  const screenshot = await page.screenshot();
  const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const firstMeasuredRow = Math.min(64, info.height - 1);
  let black = 0;
  let measured = 0;
  for (let y = firstMeasuredRow; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      measured += 1;
      if (data[offset] <= 4 && data[offset + 1] <= 4 && data[offset + 2] <= 4) black += 1;
    }
  }
  return Number((black / measured).toFixed(6));
}

async function run(browser, candidate, profile, repetition) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__rainDigitDetailSettledAt = null;
    const timer = setInterval(() => {
      if (
        document.documentElement.classList.contains("is-tour-ready") &&
        window.__tourViewer?.getRenderer?.()?.isLoading?.() === false
      ) {
        window.__rainDigitDetailSettledAt = performance.now();
        clearInterval(timer);
      }
    }, 25);
  });
  const cdp = await context.newCDPSession(page);
  const loading = new Map();
  let transferredBytes = 0;
  let requestCount = 0;
  const consoleErrors = [];
  const networkErrors = [];
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.latencyMs,
    downloadThroughput: profile.downloadMbps * 125_000,
    uploadThroughput: profile.uploadMbps * 125_000,
    connectionType: "cellular4g",
  });
  cdp.on("Network.requestWillBeSent", ({ requestId, request }) => {
    if (request.url.startsWith("data:")) return;
    loading.set(requestId, request.url);
    requestCount += 1;
  });
  cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
    if (!loading.has(requestId)) return;
    transferredBytes += Number(encodedDataLength || 0);
    loading.delete(requestId);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && message.text() !== "not granted") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    networkErrors.push(`${request.url()}: ${request.failure()?.errorText || "failed"}`);
  });

  const target = new URL(candidate.url);
  target.searchParams.set("scene", candidate.scene);
  target.searchParams.set("autostart", "1");
  target.searchParams.set("embed", "1");
  target.searchParams.set("rdbench", `${profile.id}-${repetition}-${Date.now()}`);
  const started = performance.now();
  await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(
    (scene) => {
      const state = window.__rainDigitTourTransition?.state?.();
      return window.__tourViewer?.getScene?.() === scene &&
        document.documentElement.classList.contains("is-tour-ready") &&
        state?.phase === "ready";
    },
    candidate.scene,
    { timeout: 90_000 },
  );
  const readyMs = Math.round(performance.now() - started);
  let pureBlackRatio = await frameHealth(page);
  let firstCorrectFrameMs = readyMs;
  while (pureBlackRatio > maximumPureBlackRatio && firstCorrectFrameMs - readyMs < 10_000) {
    await page.waitForTimeout(50);
    pureBlackRatio = await frameHealth(page);
    firstCorrectFrameMs = Math.round(performance.now() - started);
  }
  const firstFrameTransferredBytes = transferredBytes;
  const firstFrameRequestCount = requestCount;
  await page.waitForFunction(
    () => Number.isFinite(window.__rainDigitDetailSettledAt),
    undefined,
    { timeout: 90_000 },
  );
  const detailSettledMs = Math.round(
    await page.evaluate(() => window.__rainDigitDetailSettledAt),
  );
  await page.waitForTimeout(100);
  const result = {
    candidate: candidate.id,
    profile: profile.id,
    repetition,
    readyMs,
    firstCorrectFrameMs,
    detailSettledMs,
    pureBlackRatio,
    firstFrameTransferredBytes,
    firstFrameRequestCount,
    detailTransferredBytes: transferredBytes,
    detailRequestCount: requestCount,
    consoleErrors,
    networkErrors,
    clean: pureBlackRatio <= maximumPureBlackRatio &&
      consoleErrors.length === 0 &&
      networkErrors.length === 0,
  };
  await context.close();
  if (candidate.requireClean) {
    assert(result.clean, `${candidate.id}/${profile.id}: clean-load contract failed: ${JSON.stringify(result)}`);
  }
  return result;
}

assert(Array.isArray(candidates) && candidates.length >= 2, "TOUR_NETWORK_CANDIDATES must contain at least two candidates.");
assert(candidates.every((candidate) => candidate.id && /^https:\/\//.test(candidate.url) && candidate.scene), "Each network candidate needs id, HTTPS url and scene.");
assert(Number.isInteger(repetitions) && repetitions >= 3, "At least three repetitions are required.");

const browser = await chromium.launch({ headless: true });
const runs = [];
try {
  for (const profile of profiles) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      // Alternate old/new within every repetition so CDN and machine drift do
      // not systematically favour either package.
      const ordered = repetition % 2 ? candidates : [...candidates].reverse();
      for (const candidate of ordered) {
        console.error(`${profile.id}: ${candidate.id} ${repetition}/${repetitions}`);
        runs.push(await run(browser, candidate, profile, repetition));
      }
    }
  }
} finally {
  await browser.close();
}

const summary = profiles.flatMap((profile) => candidates.map((candidate) => {
  const selected = runs.filter((run) => run.profile === profile.id && run.candidate === candidate.id);
  return {
    profile: profile.id,
    label: profile.label,
    candidate: candidate.id,
    repetitions: selected.length,
    firstCorrectFrameMedianMs: median(selected.map((run) => run.firstCorrectFrameMs)),
    detailSettledMedianMs: median(selected.map((run) => run.detailSettledMs)),
    firstFrameTransferredMedianBytes: median(selected.map((run) => run.firstFrameTransferredBytes)),
    detailTransferredMedianBytes: median(selected.map((run) => run.detailTransferredBytes)),
  };
}));
const evidence = {
  schema: "raindigit-tour-network-benchmark/v1",
  generatedAt: new Date().toISOString(),
  methodology: {
    engine: "Playwright Chromium CDP",
    cache: "disabled; fresh context per run",
    viewport: "390x844 touch",
    timingStart: "navigation start",
    firstCorrectFrame: "requested scene + runtime ready + <=1% pure-black pixels",
    detailSettled: "Pannellum renderer isLoading() false (measurement only; never a reveal gate)",
  },
  profiles,
  candidates,
  repetitions,
  summary,
  runs,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(evidence, null, 2));
