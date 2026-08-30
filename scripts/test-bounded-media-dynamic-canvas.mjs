#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit } from "@playwright/test";
import sharp from "sharp";

const projectRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function panorama(width, color, accent) {
  return sharp({
    create: {
      width,
      height: width / 2,
      channels: 4,
      background: { ...color, alpha: 1 },
    },
  })
    .composite([{
      input: {
        create: {
          width: width / 4,
          height: width / 2,
          channels: 4,
          background: { ...accent, alpha: 1 },
        },
      },
      left: width * 3 / 8,
      top: 0,
    }])
    .webp({ quality: 82, effort: 1 })
    .toBuffer();
}

function prototypeDocument() {
  return "<!doctype html>" +
    "<html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<link rel=\"stylesheet\" href=\"/pannellum.css\"></head>" +
    "<body style=\"margin:0;background:#10110e\"><div id=\"panorama\" style=\"width:640px;height:360px\"></div>" +
    "<script src=\"/pannellum.js\"></script><script>" +
    "(() => {" +
    "const state = window.__boundedPrototype = {" +
    "phase: 'loading-base', baseLoaded: false, baseRendered: false, detailLoaded: false," +
    "baseUpdateSuspended: false, detailUpdateSuspended: false, setUpdateCalled: false, sameCanvas: false, scene: null," +
    "baseRenderedAt: null, detailLoadedAt: null," +
    "pitch: null, yaw: null, hfov: null, loadCount: 0, widthBefore: null, widthAfter: null" +
    "};" +
    "const loadImage = (source) => new Promise((resolve, reject) => {" +
    "const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source;" +
    "});" +
    "(async () => {" +
    "const base = await loadImage('/assets/base.webp');" +
    "const canvas = document.createElement('canvas'); canvas.width = base.naturalWidth; canvas.height = base.naturalHeight;" +
    "const context = canvas.getContext('2d', { alpha: false }); context.drawImage(base, 0, 0);" +
    "state.baseLoaded = true; state.phase = 'base-canvas-ready';" +
    "const viewer = pannellum.viewer('panorama', {" +
    "default: { firstScene: 'target', autoLoad: true, sceneFadeDuration: 0, hfov: 92 }," +
    "scenes: { target: { type: 'equirectangular', panorama: canvas, dynamic: true, dynamicUpdate: true, pitch: 7, yaw: -31, hfov: 92 }}" +
    "});" +
    "state.viewer = viewer; viewer.on('load', () => { state.loadCount += 1; state.phase = 'base-rendered'; });" +
    "const baseDeadline = performance.now() + 3000; while (!viewer.isLoaded() && performance.now() < baseDeadline) await new Promise((resolve) => setTimeout(resolve, 16));" +
    "if (!viewer.isLoaded()) throw new Error('dynamic base renderer did not initialize');" +
    "state.baseRendered = true; state.baseRenderedAt = performance.now(); viewer.setUpdate(false); state.baseUpdateSuspended = true; state.phase = 'base-rendered';" +
    "await new Promise((resolve) => setTimeout(resolve, 140));" +
    "state.pitch = viewer.getPitch(); state.yaw = viewer.getYaw(); state.hfov = viewer.getHfov();" +
    "const detail = await loadImage('/assets/detail.webp'); state.detailLoadedAt = performance.now(); state.widthBefore = canvas.width; canvas.width = detail.naturalWidth; canvas.height = detail.naturalHeight; context.drawImage(detail, 0, 0, canvas.width, canvas.height); state.widthAfter = canvas.width;" +
    "state.detailLoaded = true; state.phase = 'detail-drawn'; viewer.setUpdate(true); state.setUpdateCalled = true;" +
    "state.sameCanvas = viewer.getConfig().panorama === canvas; state.scene = viewer.getScene();" +
    "state.pitchAfter = viewer.getPitch(); state.yawAfter = viewer.getYaw(); state.hfovAfter = viewer.getHfov();" +
    "await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); viewer.setUpdate(false); state.detailUpdateSuspended = true; state.phase = 'detail-rendered';" +
    "})().catch((error) => { state.phase = 'error'; state.error = String(error); });" +
    "})();" +
    "</script></body></html>";
}

async function runEngine(name, engine, assets) {
  const browser = await engine.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 760, height: 460 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(assets.origin + "/bounded-media-dynamic-canvas.html", { waitUntil: "networkidle" });
  try {
    await page.waitForFunction(() => window.__boundedPrototype && ["detail-rendered", "error"].includes(window.__boundedPrototype.phase), null, { timeout: 10_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => window.__boundedPrototype ? { ...window.__boundedPrototype, viewer: undefined } : null);
    throw new Error(name + " timed out waiting for the dynamic canvas: " + JSON.stringify({ diagnostic, pageErrors: errors, cause: String(error) }));
  }
  const state = await page.evaluate(() => {
    const value = { ...window.__boundedPrototype };
    delete value.viewer;
    return value;
  });
  assert(!errors.length, name + " page errors: " + errors.join(" | "));
  assert(state.phase === "detail-rendered", name + " did not complete dynamic canvas update: " + JSON.stringify(state));
  assert(state.baseLoaded && state.baseRendered && state.detailLoaded, name + " did not render base before loading detail: " + JSON.stringify(state));
  assert(state.baseRenderedAt < state.detailLoadedAt, name + " loaded detail before proving the base frame: " + JSON.stringify(state));
  assert(state.baseUpdateSuspended && state.detailUpdateSuspended, name + " left continuous dynamic texture uploads enabled: " + JSON.stringify(state));
  assert(state.setUpdateCalled && state.sameCanvas, name + " did not use the same dynamic canvas: " + JSON.stringify(state));
  assert(state.widthBefore === 1024 && state.widthAfter === 1536, name + " did not upgrade the same canvas from POT base to NPOT detail dimensions: " + JSON.stringify(state));
  assert(state.scene === "target", name + " changed scene during detail update: " + JSON.stringify(state));
  for (const key of ["pitch", "yaw", "hfov"]) {
    assert(Math.abs(state[key] - state[key + "After"]) < 0.01, name + " changed " + key + " during detail update: " + JSON.stringify(state));
  }
  const panoramaScreenshot = await page.locator("#panorama").screenshot();
  const screenshotStats = await sharp(panoramaScreenshot).stats();
  const visibleChannels = screenshotStats.channels.slice(0, 3);
  const screenshotMean = visibleChannels.reduce((sum, channel) => sum + channel.mean, 0) / visibleChannels.length;
  const screenshotStdev = visibleChannels.reduce((sum, channel) => sum + channel.stdev, 0) / visibleChannels.length;
  assert(screenshotMean > 10 && screenshotStdev > 5, name + " produced an incomplete or black NPOT WebGL texture: " + JSON.stringify({ screenshotMean, screenshotStdev, state }));
  await page.screenshot({ path: resolve(projectRoot, "output", "playwright", "bounded-media-dynamic-" + name + ".png") });
  await browser.close();
  return { engine: name, phase: state.phase, loadCount: state.loadCount, sameCanvas: state.sameCanvas, canvasUpgrade: [state.widthBefore, state.widthAfter], screenshot: { mean: screenshotMean, stdev: screenshotStdev }, scene: state.scene, view: { pitch: state.pitchAfter, yaw: state.yawAfter, hfov: state.hfovAfter } };
}

const base = await panorama(1024, { r: 22, g: 40, b: 31 }, { r: 117, g: 77, b: 30 });
const detail = await panorama(1536, { r: 42, g: 72, b: 55 }, { r: 232, g: 171, b: 68 });
const pannellum = await readFile(resolve(projectRoot, "web-tour", "js", "pannellum.js"));
const pannellumCss = await readFile(resolve(projectRoot, "web-tour", "css", "pannellum.css"));
const server = createServer((request, response) => {
  if (request.url === "/bounded-media-dynamic-canvas.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(prototypeDocument()); return;
  }
  if (request.url === "/pannellum.js") { response.writeHead(200, { "content-type": "text/javascript" }); response.end(pannellum); return; }
  if (request.url === "/pannellum.css") { response.writeHead(200, { "content-type": "text/css" }); response.end(pannellumCss); return; }
  if (request.url === "/assets/base.webp") { response.writeHead(200, { "content-type": "image/webp", "cache-control": "no-store" }); response.end(base); return; }
  if (request.url === "/assets/detail.webp") { response.writeHead(200, { "content-type": "image/webp", "cache-control": "no-store" }); response.end(detail); return; }
  response.writeHead(404); response.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
try {
  const results = [await runEngine("chromium", chromium, { origin }), await runEngine("webkit", webkit, { origin })];
  console.log(JSON.stringify({ ok: true, candidate: "bounded-equirect-base-mobile-desktop-fallback-v1", profileObjects: 4, exercisedRoles: ["base", "desktop-detail"], results }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
