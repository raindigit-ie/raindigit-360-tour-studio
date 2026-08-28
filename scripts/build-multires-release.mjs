#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import {
  buildFacePyramid,
  hybridMediaProfile,
  mediaRecipeVersion,
  mediaWorkerMetadata,
  projectCubeFaceRaw,
} from "./lib/media-pyramid.mjs";
import {
  assertPortableRelease,
  devChannelPointer,
  releaseIdentity,
  writeReleaseChangelog,
} from "./lib/release-contract.mjs";
import {
  injectTourMonitoringConfig,
  productionTourMonitoringEnvironment,
  sentryBrowserBundle,
  tourMonitoringRuntimeBundle,
  tourMonitoringConfig,
} from "./lib/tour-monitoring-contract.mjs";
import { versionTourRuntime } from "./lib/version-tour-runtime.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const faceLetters = ["f", "b", "u", "d", "l", "r"];

function parseArguments(argv) {
  const options = {
    workspace: join(projectRoot, "studio-workspace"),
    output: join(projectRoot, "release-multires"),
    zip: null,
    cacheDir: null,
    progressFile: null,
    slug: null,
    rollbackVersion: null,
    tourVersion: null,
    previousTourVersion: null,
    changeSummary: null,
    runtimeTemplate: null,
    baseSize: 512,
    tileSize: 2048,
    fallbackSize: 1024,
    webpQuality: 78,
    webpEffort: 2,
    jpegQuality: 86,
    projectionInterpolation: "spline16",
    faceConcurrency: 2,
    replace: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--workspace")
      options.workspace = resolve(argv[++index] || "");
    else if (argument === "--output")
      options.output = resolve(argv[++index] || "");
    else if (argument === "--zip") options.zip = resolve(argv[++index] || "");
    else if (argument === "--cache-dir")
      options.cacheDir = resolve(argv[++index] || "");
    else if (argument === "--progress-file")
      options.progressFile = resolve(argv[++index] || "");
    else if (argument === "--slug") options.slug = String(argv[++index] || "");
    else if (argument === "--rollback-version")
      options.rollbackVersion = String(argv[++index] || "");
    else if (argument === "--tour-version")
      options.tourVersion = String(argv[++index] || "");
    else if (argument === "--previous-tour-version")
      options.previousTourVersion = String(argv[++index] || "");
    else if (argument === "--change-summary")
      options.changeSummary = String(argv[++index] || "");
    else if (argument === "--runtime-template")
      options.runtimeTemplate = resolve(argv[++index] || "");
    else if (argument === "--tile-size")
      options.tileSize = Number(argv[++index]);
    else if (argument === "--base-size")
      options.baseSize = Number(argv[++index]);
    else if (argument === "--fallback-size")
      options.fallbackSize = Number(argv[++index]);
    else if (argument === "--webp-quality")
      options.webpQuality = Number(argv[++index]);
    else if (argument === "--webp-effort")
      options.webpEffort = Number(argv[++index]);
    else if (argument === "--jpeg-quality")
      options.jpegQuality = Number(argv[++index]);
    else if (argument === "--projection-interpolation")
      options.projectionInterpolation = String(argv[++index] || "");
    else if (argument === "--face-concurrency")
      options.faceConcurrency = Number(argv[++index]);
    else if (argument === "--replace") options.replace = true;
    else if (argument === "--help") {
      console.log(
        "Usage: node scripts/build-multires-release.mjs --workspace path --output package-root --slug project-slug --tour-version <Studio version> --change-summary 'Initial portable release' [--previous-tour-version <prior Studio version>] [--zip package.zip] [--cache-dir path] [--progress-file path] [--rollback-version package-version] [--runtime-template release-root] [--base-size 512] [--tile-size 2048] [--fallback-size 1024] [--webp-quality 78] [--webp-effort 2] [--jpeg-quality 86] [--projection-interpolation spline16] [--face-concurrency 2] [--replace]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug))
    throw new Error("--slug must be a lowercase URL slug.");
  releaseIdentity({
    tourVersion: options.tourVersion,
    previousTourVersion: options.previousTourVersion,
  });
  if (String(options.changeSummary || "").trim().length < 8)
    throw new Error("--change-summary must describe this tour version.");
  if (
    options.rollbackVersion &&
    !/^(?:legacy|multires)-[a-f0-9]{8,64}$/.test(options.rollbackVersion)
  )
    throw new Error(
      "--rollback-version must be a legacy-* or multires-* content version.",
    );
  if (![512, 1024, 2048].includes(options.tileSize))
    throw new Error("Detail tile size must be 512, 1024 or 2048 pixels.");
  if (
    !Number.isInteger(options.baseSize) ||
    options.baseSize < 256 ||
    options.baseSize > 1024 ||
    options.baseSize > options.tileSize
  )
    throw new Error("Base face size must be 256..1024 pixels and no larger than the detail tile.");
  if (
    !Number.isInteger(options.fallbackSize) ||
    options.fallbackSize < 512 ||
    options.fallbackSize > 2048
  )
    throw new Error("Fallback size must be 512..2048 pixels.");
  if (
    !Number.isInteger(options.webpQuality) ||
    options.webpQuality < 75 ||
    options.webpQuality > 80
  )
    throw new Error("WebP quality must be 75..80.");
  if (
    !Number.isInteger(options.webpEffort) ||
    options.webpEffort < 0 ||
    options.webpEffort > 6
  )
    throw new Error("WebP effort must be 0..6.");
  if (
    !Number.isInteger(options.jpegQuality) ||
    options.jpegQuality < 84 ||
    options.jpegQuality > 94
  )
    throw new Error("JPEG quality must be 84..94.");
  if (!["linear", "cubic", "spline16", "lanczos"].includes(options.projectionInterpolation))
    throw new Error("Projection interpolation must be linear, cubic, spline16 or lanczos.");
  if (!Number.isInteger(options.faceConcurrency) || options.faceConcurrency < 1 || options.faceConcurrency > 3)
    throw new Error("Face concurrency must be an integer from 1 to 3.");
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function reportProgress(options, phase, percent, message, extra = {}) {
  if (!options.progressFile) return;
  const temporary = `${options.progressFile}.${process.pid}.tmp`;
  await mkdir(dirname(options.progressFile), { recursive: true });
  await writeFile(
    temporary,
    `${JSON.stringify({ phase, percent, message, updatedAt: new Date().toISOString(), ...extra })}\n`,
    "utf8",
  );
  await rename(temporary, options.progressFile);
}

async function run(command, arguments_, options = {}) {
  try {
    return await execFileAsync(command, arguments_, {
      maxBuffer: 8 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    throw new Error(`${command} failed: ${error.stderr || error.message}`);
  }
}

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  try {
    // Native cp batches traversal and data transfer in one process. Node's
    // recursive fs.cp performs hundreds of individual JS operations for a
    // complete tour cache, which dominated otherwise warm builds.
    await execFileAsync("cp", ["-R", `${source}/.`, `${destination}/`], {
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(`Native cache copy failed: ${error.stderr || error.message}`);
    await cp(source, destination, { recursive: true, force: true });
  }
}

async function runMagick(arguments_) {
  for (const binary of ["magick", "convert"]) {
    try {
      return await execFileAsync(binary, arguments_, {
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`${binary} failed: ${error.stderr || error.message}`);
    }
  }
  throw new Error("ImageMagick is required for multires export.");
}

async function imageDimensions(path) {
  const { stdout } = await runMagick(["identify", "-format", "%w %h", path]);
  const [width, height] = stdout.trim().split(/\s+/).map(Number);
  return { width, height };
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

async function mapWithConcurrency(values, limit, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await worker(values[index], index);
      }
    }),
  );
  return output;
}

async function fileInventory(directory) {
  const paths = (await walk(directory)).sort();
  return mapWithConcurrency(paths, 32, async (file) => {
    const body = await readFile(file);
    return {
      path: relative(directory, file).split("\\").join("/"),
      bytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
  });
}

async function fileSizeInventory(directory) {
  const paths = (await walk(directory)).sort();
  return mapWithConcurrency(paths, 32, async (file) => ({
    path: relative(directory, file).split("\\").join("/"),
    bytes: (await stat(file)).size,
  }));
}

async function createZip(directory, zipPath) {
  await mkdir(dirname(zipPath), { recursive: true });
  await rm(zipPath, { force: true });
  await run("zip", ["-X", "-r", zipPath, "."], { cwd: directory });
}

function readTourConfig(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert(context.window.TOUR_CONFIG, "Generated release has no TOUR_CONFIG.");
  return context.window.TOUR_CONFIG;
}

function deferRuntimeStyles(entrypoint) {
  const stylesheets = [];
  const deferred = entrypoint.replace(
    /<link rel="stylesheet" href="([^"]+\.css[^"]*)" \/>/g,
    (_match, href) => {
      stylesheets.push(href);
      return `<noscript><link rel="stylesheet" href="${href}" /></noscript>`;
    },
  );
  assert(
    stylesheets.length === 2,
    `Expected two runtime stylesheets, found ${stylesheets.length}.`,
  );
  // This is deliberately complete enough to render before the deferred full
  // stylesheet arrives. An unstyled static loader previously painted white
  // inline spans for a few frames on cold mobile navigation.
  const criticalStyles = `<style data-runtime-critical>html,body,.tour-shell,.viewer{width:100%;height:100%;margin:0}html,body{overflow:hidden;background:#070807;color:#f8f1df}.tour-shell{position:relative;min-height:100svh;background:#070807}.viewer{position:absolute;inset:0}.tour-first-frame{position:absolute;inset:0;z-index:1;width:100%;height:100%;object-fit:cover;pointer-events:none;opacity:1}.is-tour-ready .tour-first-frame{opacity:0;transition:opacity 180ms ease}.is-tour-transition-boot .tour-first-frame,.tour-shell.is-transition-guarded>.tour-first-frame{z-index:1;visibility:hidden;opacity:0;transition:none}.tour-scene-transition--static{position:absolute;z-index:34;inset:0;display:block;visibility:visible;opacity:1;overflow:hidden;pointer-events:none;background:#070807;color:#f8f1df}.tour-scene-transition--static .tour-scene-transition__stage{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:#070807}.tour-scene-transition--static .tour-scene-transition__tiles{position:absolute;inset:0;display:grid;width:100%;height:100%;grid-template-columns:repeat(6,minmax(0,1fr));grid-template-rows:repeat(4,minmax(0,1fr));background:#070807}.tour-scene-transition--static .tour-scene-transition__tile{display:block;box-sizing:border-box;min-width:0;min-height:0;border:1px solid rgba(229,185,96,.18);background:linear-gradient(135deg,#080907,#17140d 52%,#090a08)}.tour-scene-transition--static .tour-scene-transition__mobile-status{position:absolute;z-index:1;left:50%;top:50%;display:flex;align-items:center;gap:7px;transform:translate(-50%,-50%);padding:7px 10px;border:1px solid rgba(229,185,96,.52);border-radius:999px;background:#090a08;color:#f8f1df;font:600 10px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}.tour-scene-transition--static .tour-scene-transition__mobile-mark{width:7px;height:7px;border-radius:50%;background:#e5b960;box-shadow:0 0 12px rgba(229,185,96,.72)}@media(prefers-reduced-motion:reduce){.is-tour-ready .tour-first-frame{transition:none}}</style>`;
  const styleLoader = `<script data-runtime-style-loader>(()=>{const d=document.documentElement,h=${JSON.stringify(stylesheets)};d.dataset.runtimeStyles="pending";const load=()=>Promise.all(h.map((u)=>new Promise((resolve,reject)=>{const l=document.createElement("link");l.rel="stylesheet";l.href=u;l.dataset.runtimeStyle="";l.onload=resolve;l.onerror=reject;document.head.appendChild(l)}))).then(()=>{d.dataset.runtimeStyles="ready"}).catch(()=>{d.dataset.runtimeStyles="error"});setTimeout(load,0)})()</script>`;
  assert(
    deferred.includes("</head>"),
    "The runtime entrypoint has no closing head element.",
  );
  return deferred.replace(
    "<head>",
    `<head>\n    ${criticalStyles}\n    ${styleLoader}`,
  );
}

function staticTourLoaderMarkup() {
  const tiles = Array.from({ length: 24 }, (_, index) => {
    const row = Math.floor(index / 6);
    const column = index % 6;
    const distance = Math.abs(column - 2.5) + Math.abs(row - 1.5);
    return `<span class="tour-scene-transition__tile tour-scene-transition__mobile-tile" style="--tour-cell-delay:${Math.round(distance * 42)}ms"></span>`;
  }).join("");
  return `<div class="tour-scene-transition tour-scene-transition--mobile-entry tour-scene-transition--static is-active is-waiting" data-tour-static-loader aria-hidden="true"><div class="tour-scene-transition__stage"><img class="tour-scene-transition__image tour-scene-transition__outgoing" alt="" draggable="false" /><div class="tour-scene-transition__tiles" aria-hidden="true">${tiles}</div><div class="tour-scene-transition__mobile-status"><span class="tour-scene-transition__mobile-mark" aria-hidden="true"></span><span>Loading tour</span></div></div></div>`;
}

async function deferRuntimeChrome(entrypoint, stagedRoot) {
  const viewer =
    '<div id="panorama" class="viewer" aria-label="360 virtual tour"></div>';
  const viewerIndex = entrypoint.indexOf(viewer);
  const chromeStart = viewerIndex + viewer.length;
  const mainEnd = entrypoint.indexOf("</main>", chromeStart);
  assert(
    viewerIndex >= 0 && mainEnd > chromeStart,
    "The runtime chrome could not be separated from the first-frame shell.",
  );
  const chromeMarkup = entrypoint.slice(chromeStart, mainEnd).trim();
  assert(
    chromeMarkup.includes('class="topbar"') &&
      chromeMarkup.includes('id="navigatorPanel"'),
    "The runtime chrome is incomplete.",
  );
  const chromeRuntime = `(()=>{const s=document.querySelector(".tour-shell");if(!s||s.querySelector(".topbar"))return;s.insertAdjacentHTML("beforeend",${JSON.stringify(chromeMarkup)})})();\n`;
  await writeFile(
    join(stagedRoot, "js", "tour-chrome.js"),
    chromeRuntime,
    "utf8",
  );
  let shellOnly = `${entrypoint.slice(0, chromeStart)}\n    ${entrypoint.slice(mainEnd)}`;
  const bootstrapPattern =
    /<script(?: defer)? src="(js\/tour-bootstrap\.js[^"]*)"><\/script>/;
  const bootstrapMatch = shellOnly.match(bootstrapPattern);
  assert(
    bootstrapMatch,
    "The runtime bootstrap script could not be deferred until after first paint.",
  );
  const loader = `<script data-runtime-loader>(()=>{const l=(s)=>new Promise((resolve,reject)=>{const e=document.createElement("script");e.src=s;e.onload=resolve;e.onerror=reject;document.body.appendChild(e)});setTimeout(async()=>{try{await l("js/tour-chrome.js");await l(${JSON.stringify(bootstrapMatch[1])})}catch(error){window.__rainDigitShowRuntimeRecovery?.(error)}},0)})()</script>`;
  shellOnly = shellOnly.replace(bootstrapPattern, loader);
  return shellOnly;
}

function cubeResolution(width) {
  const idealFace = Math.max(512, width / Math.PI);
  return 2 ** Math.ceil(Math.log2(idealFace));
}

function maxLevel(size, tileSize) {
  let levels = Math.ceil(Math.log2(size / Math.min(tileSize, size))) + 1;
  if (levels > 1 && Math.floor(size / 2 ** (levels - 2)) === tileSize)
    levels -= 1;
  return levels;
}

function multiresCacheKey(
  sourceHash,
  cubeSize,
  levels,
  baseSize,
  detailTileSize,
  options,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schema: "raindigit-multires-scene-cache/v2",
        sourceHash,
        cubeSize,
        levels,
        mediaProfile: hybridMediaProfile(baseSize, detailTileSize),
        baseSize,
        detailTileSize,
        fallbackSize: options.fallbackSize,
        webpQuality: options.webpQuality,
        webpEffort: options.webpEffort,
        jpegQuality: options.jpegQuality,
        mediaRecipe: mediaRecipeVersion(
          baseSize,
          detailTileSize,
          options.webpEffort,
          options.projectionInterpolation,
        ),
      }),
    )
    .digest("hex");
}

async function restoreMultiresCache(cacheDir, cacheKey, targetRoot) {
  if (!cacheDir) return null;
  const entry = join(cacheDir, "multires-scenes-v2", cacheKey);
  try {
    const metadata = JSON.parse(
      await readFile(join(entry, "metadata.json"), "utf8"),
    );
    assert(
      metadata.schema === "raindigit-multires-scene-cache/v2" &&
        metadata.key === cacheKey,
      "Multires cache metadata is invalid.",
    );
    await mapWithConcurrency(metadata.files || [], 32, async (file) => {
      const info = await stat(join(entry, "assets", file.path));
      assert(
        info.size === file.bytes,
        `Multires cache size mismatch: ${file.path}`,
      );
    });
    await copyTree(join(entry, "assets"), targetRoot);
    const accessedAt = new Date();
    await utimes(join(entry, "metadata.json"), accessedAt, accessedAt);
    return {
      tileCount: metadata.tileCount,
      config: metadata.config,
      cacheHit: true,
    };
  } catch (error) {
    if (error.code !== "ENOENT")
      await rm(entry, { recursive: true, force: true });
    return null;
  }
}

async function storeMultiresCache(
  cacheDir,
  cacheKey,
  targetRoot,
  tileCount,
  config,
) {
  if (!cacheDir) return;
  const parent = join(cacheDir, "multires-scenes-v2");
  const entry = join(parent, cacheKey);
  const temporary = join(
    parent,
    `.${cacheKey}.${process.pid}.${Date.now()}.tmp`,
  );
  const files = await fileSizeInventory(targetRoot);
  await mkdir(parent, { recursive: true });
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  try {
    await copyTree(targetRoot, join(temporary, "assets"));
    await writeFile(
      join(temporary, "metadata.json"),
      `${JSON.stringify(
        {
          schema: "raindigit-multires-scene-cache/v2",
          key: cacheKey,
          tileCount,
          config,
          files,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await rename(temporary, entry).catch(async (error) => {
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
      await rm(temporary, { recursive: true, force: true });
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function makePreview(input) {
  const directory = await mkdtemp(join(tmpdir(), "raindigit-tour-preview-"));
  const output = join(directory, "preview.webp");
  try {
    await runMagick([
      input,
      "-resize",
      "256x128!",
      "-strip",
      "-quality",
      "72",
      output,
    ]);
    return `data:image/webp;base64,${(await readFile(output)).toString("base64")}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function seoDescription(title) {
  const base = `Explore ${title}, a self-hosted interactive 360° tour by Rain Digit with connected scenes, clear navigation and mobile-ready viewing.`;
  const suffix = " Open the tour and understand the space before you arrive.";
  const combined = `${base}${suffix}`;
  if (combined.length <= 160 && combined.length >= 140) return combined;
  if (combined.length < 140)
    return `${combined} Available on desktop and mobile.`.slice(0, 160);
  const candidate = combined.slice(0, 159);
  return `${candidate.slice(0, candidate.lastIndexOf(" ")).replace(/[\s,;:.-]+$/g, "")}.`;
}

async function buildSeoAssets(input, stagedRoot, project, sceneBuilds) {
  const targetRoot = join(stagedRoot, "assets", "seo");
  const previewPath = join(targetRoot, "preview.webp");
  const posterPath = join(targetRoot, "poster.webp");
  await mkdir(targetRoot, { recursive: true });
  await runMagick([
    input,
    "-resize",
    "512x256!",
    "-strip",
    "-quality",
    "66",
    previewPath,
  ]);
  await runMagick([
    input,
    "-resize",
    "1200x630^",
    "-gravity",
    "center",
    "-extent",
    "1200x630",
    "-strip",
    "-quality",
    "82",
    posterPath,
  ]);
  const previewBytes = (await stat(previewPath)).size;
  assert(
    previewBytes <= 30 * 1024,
    `Generated preview is ${previewBytes} bytes; budget is 30720 bytes.`,
  );
  const firstScene = project.scenes.find(
    (scene) => scene.id === project.firstScene,
  );
  const firstBuild = sceneBuilds.get(project.firstScene);
  assert(firstScene && firstBuild, "First-scene multires output is missing.");
  const firstLevelRoot = join(stagedRoot, firstBuild.relativeRoot, "1");
  const firstLevelTiles = (await readdir(firstLevelRoot))
    .filter((file) => file.endsWith(".webp"))
    .sort()
    .map((file) => `${firstBuild.relativeRoot}/1/${file}`);
  const fallbackFiles = faceLetters.map(
    (face) => `${firstBuild.relativeRoot}/fallback/${face}.jpg`,
  );
  const seoDraft = {
    schema: "raindigit-tour-seo/v1",
    title: project.title,
    seoTitle: `360° Tour: ${project.title} | Rain Digit`.slice(0, 60),
    seoDescription: seoDescription(project.title),
    landingDescriptionDraft: `Explore ${project.title} as a self-hosted interactive 360-degree experience. The tour connects ${project.scenes.length} real viewpoints with clear scene navigation and mobile-ready controls. Add the verified place, visible features, intended audience and linked Rain Digit project story before publication; this draft must be reviewed by a person and expanded to 80–150 factual words.`,
    poster: "assets/seo/poster.webp",
    posterAltDraft: `${project.title} — opening view before the interactive 360-degree tour`,
    posterWidth: 1200,
    posterHeight: 630,
    preview: "assets/seo/preview.webp",
  };
  await mkdir(join(stagedRoot, "seo"), { recursive: true });
  await writeFile(
    join(stagedRoot, "seo", "tour.json"),
    `${JSON.stringify(seoDraft, null, 2)}\n`,
  );
  return {
    preview: seoDraft.preview,
    previewBytes,
    poster: seoDraft.poster,
    posterWidth: seoDraft.posterWidth,
    posterHeight: seoDraft.posterHeight,
    seoDraft: "seo/tour.json",
    fallbackFiles,
    criticalFiles: [
      "index.html",
      "css/pannellum.css",
      "css/tour.css",
      "js/tour-chrome.js",
      "js/tour-bootstrap.js",
      "js/tour-monitoring.js",
      "js/pannellum.js",
      "js/tour-transition.js",
      "js/tour.js",
      "js/tour-config.js",
      ...firstLevelTiles,
    ],
  };
}

async function buildSceneMultires(scene, stagedRoot, temporaryRoot, options) {
  const source = join(stagedRoot, scene.panorama);
  const dimensions = await imageDimensions(source);
  assert(
    dimensions.width >= 1600 &&
      Math.abs(dimensions.width / dimensions.height - 2) <= 0.02,
    `${scene.id} is not a full 2:1 equirectangular panorama.`,
  );

  const cubeSize = cubeResolution(dimensions.width);
  const detailTileSize = Math.min(cubeSize, options.tileSize);
  const levels = maxLevel(cubeSize, detailTileSize);
  const sourceHash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex");
  const cacheKey = multiresCacheKey(
    sourceHash,
    cubeSize,
    levels,
    options.baseSize,
    detailTileSize,
    options,
  );
  const contentHash = cacheKey.slice(0, 20);
  const relativeRoot = `assets/mr/${contentHash}`;
  const targetRoot = join(stagedRoot, relativeRoot);
  const sceneTemporaryRoot = join(temporaryRoot, `multires-${scene.id}`);
  await mkdir(sceneTemporaryRoot, { recursive: true });
  await mkdir(targetRoot, { recursive: true });
  try {
    const cached = await restoreMultiresCache(
      options.cacheDir,
      cacheKey,
      targetRoot,
    );
    if (cached) return { relativeRoot, ...cached };

    const faceTileCounts = await mapWithConcurrency(
      faceLetters,
      options.faceConcurrency,
      async (face) => {
        const projected = await projectCubeFaceRaw({
          source,
          face,
          cubeSize,
          interpolation: options.projectionInterpolation,
        });
        return buildFacePyramid({
          input: projected,
          face,
          targetRoot,
          temporaryRoot: sceneTemporaryRoot,
          levels,
          baseSize: options.baseSize,
          tileSize: detailTileSize,
          fallbackSize: options.fallbackSize,
          webpQuality: options.webpQuality,
          webpEffort: options.webpEffort,
          jpegQuality: options.jpegQuality,
        });
      },
    );
    const tileCount = faceTileCounts.reduce((sum, count) => sum + count, 0);

    const preview = await makePreview(source);
    const config = {
      basePath: relativeRoot,
      path: "/%l/%s%y_%x",
      fallbackPath: "/fallback/%s",
      extension: "webp",
      fallbackExtension: "jpg",
      tileResolution: detailTileSize,
      maxLevel: levels,
      cubeResolution: cubeSize,
      mediaProfile: hybridMediaProfile(options.baseSize, detailTileSize),
      baseResolution: options.baseSize,
      equirectangularThumbnail: preview,
    };
    await storeMultiresCache(
      options.cacheDir,
      cacheKey,
      targetRoot,
      tileCount,
      config,
    );
    return { relativeRoot, tileCount, config, cacheHit: false };
  } finally {
    await rm(sceneTemporaryRoot, { recursive: true, force: true });
  }
}

async function applyRuntimeTemplate(stagedRoot, templateRoot) {
  if (!templateRoot) return;
  await Promise.all([
    cp(join(templateRoot, "index.html"), join(stagedRoot, "index.html")),
    cp(join(templateRoot, "css"), join(stagedRoot, "css"), {
      recursive: true,
      force: true,
    }),
    cp(
      join(templateRoot, "assets", "raindigit-mark.svg"),
      join(stagedRoot, "assets", "raindigit-mark.svg"),
    ),
    cp(
      join(templateRoot, "js", "pannellum.js"),
      join(stagedRoot, "js", "pannellum.js"),
    ),
    cp(
      join(templateRoot, "js", "tour-transition.js"),
      join(stagedRoot, "js", "tour-transition.js"),
    ),
    cp(join(templateRoot, "js", "tour.js"), join(stagedRoot, "js", "tour.js")),
    cp(
      join(templateRoot, "js", "tour-bootstrap.js"),
      join(stagedRoot, "js", "tour-bootstrap.js"),
    ),
    cp(
      join(templateRoot, tourMonitoringRuntimeBundle),
      join(stagedRoot, "js", "tour-monitoring.js"),
    ),
    cp(
      join(templateRoot, sentryBrowserBundle),
      join(stagedRoot, sentryBrowserBundle),
    ),
  ]);

  const cssPath = join(stagedRoot, "css", "tour.css");
  let css = await readFile(cssPath, "utf8");
  const studioStylesStart = "/* RELEASE_STRIP_START: studio-only styles */";
  const studioStylesEnd = "/* RELEASE_STRIP_END: studio-only styles */";
  const studioStylesStartIndex = css.indexOf(studioStylesStart);
  const studioStylesEndIndex = css.indexOf(studioStylesEnd);
  assert(
    studioStylesStartIndex >= 0 &&
      studioStylesEndIndex > studioStylesStartIndex,
    "The runtime stylesheet is missing the studio-only release markers.",
  );
  css = `${css.slice(0, studioStylesStartIndex).trimEnd()}\n`;
  assert(
    !css.includes(".editor-panel") && !css.includes(".frame-picker-app"),
    "Studio-only styles leaked into the public release.",
  );
  if (!css.includes(".tour-first-frame")) {
    css = `${css.trimEnd()}\n\n.tour-first-frame { position:absolute; inset:0; z-index:1; width:100%; height:100%; object-fit:cover; pointer-events:none; opacity:1; transition:opacity 180ms ease; }\n.is-tour-ready .tour-first-frame { opacity:0; }\n@media (prefers-reduced-motion: reduce) { .tour-first-frame { transition:none; } }\n`;
  }
  await writeFile(cssPath, css, "utf8");

  const runtimePath = join(stagedRoot, "js", "tour.js");
  let runtime = await readFile(runtimePath, "utf8");
  const legacySceneConfig = `    type: "equirectangular",
    panorama: scene.panorama,`;
  const multiresSceneConfig = `    type: scene.type === "multires" ? "multires" : "equirectangular",
    ...(scene.type === "multires" ? { multiRes: scene.multiRes } : { panorama: scene.panorama }),`;
  if (runtime.includes(legacySceneConfig))
    runtime = runtime.replace(legacySceneConfig, multiresSceneConfig);
  assert(
    runtime.includes("multiRes: scene.multiRes") &&
      runtime.includes('"multires"'),
    "The runtime does not support multires scene configuration.",
  );
  if (!runtime.includes("window.__tourViewer = viewer")) {
    runtime += `\nwindow.__tourViewer = viewer;\n`;
  }
  if (!runtime.includes("__rainDigitTourTransition?.attach(viewer)")) {
    runtime += `\nwindow.__rainDigitTourTransition?.attach(viewer);\n`;
  }
  if (!runtime.includes("function revealRenderedTour")) {
    runtime = runtime.replace(
      'viewer.on("load", () => {',
      'function revealRenderedTour() {\n  const canvas = viewer.getContainer().querySelector(".pnlm-render-container canvas");\n  const runtimeStylesState = document.documentElement.dataset.runtimeStyles;\n  const runtimeStylesReady = !runtimeStylesState || runtimeStylesState === "ready";\n  const transition = window.__rainDigitTourTransition?.state?.();\n  const transitionReady = !window.__rainDigitTourTransition || transition?.phase === "ready";\n  if (viewer.isLoaded() && canvas?.width > 0 && canvas?.height > 0 && runtimeStylesReady && transitionReady) {\n    document.documentElement.classList.add("is-tour-ready");\n    return;\n  }\n  // Animation frames may be suspended indefinitely while this tour is\n  // embedded below the fold. A timer keeps the portable tour booting before\n  // the host scrolls it into view.\n  window.setTimeout(revealRenderedTour, 16);\n}\nviewer.on("load", () => {\n  revealRenderedTour();',
    );
    runtime = runtime.replace(
      "setActiveScene(initialScene);",
      "revealRenderedTour();\nsetActiveScene(initialScene);",
    );
  }
  assert(
    runtime.includes('type: "raindigit-tour-ready"') &&
      runtime.includes("window.parent.postMessage"),
    "The generated runtime does not publish the honest host-readiness contract.",
  );
  assert(
    runtime.includes("window.__tourViewer = viewer") &&
      runtime.includes("__rainDigitTourTransition?.attach(viewer)"),
    "The generated runtime must expose and attach its viewer before readiness can be trusted.",
  );
  await writeFile(runtimePath, runtime, "utf8");
}

function digestInventory(files) {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(String(file.bytes));
    digest.update("\0");
    digest.update(file.sha256);
    digest.update("\0");
  }
  return digest.digest("hex");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const buildStartedAt = performance.now();
  const timings = {};
  const finalParent = dirname(options.output);
  await mkdir(finalParent, { recursive: true });
  // Keep the publish staging directory on the same filesystem as the final
  // package. Docker mounts /data separately from /tmp, and an atomic rename
  // across those filesystems fails with EXDEV.
  const temporaryRoot = await mkdtemp(
    join(finalParent, ".raindigit-multires-"),
  );
  const stagedRoot = join(temporaryRoot, "staged-release");
  const packageRoot = join(temporaryRoot, "package");
  try {
    await reportProgress(
      options,
      "derivatives",
      12,
      "Preparing source panoramas",
    );
    let phaseStartedAt = performance.now();
    const baseArguments = [
      join(projectRoot, "scripts", "build-tour-release.mjs"),
      "--workspace",
      options.workspace,
      "--output",
      stagedRoot,
      // This temporary derivative carries Studio colour / local-area edits into
      // the pyramid. Keep the complete equirectangular resolution and use a
      // high-quality intermediate; the delivery fallback is encoded separately.
      "--quality",
      "94",
      "--preserve-resolution",
      "--preserve-neutral-source",
      "--replace",
    ];
    if (options.cacheDir) baseArguments.push("--cache-dir", options.cacheDir);
    const { stdout: baseOutput } = await run(process.execPath, baseArguments, {
      cwd: projectRoot,
      timeout: 20 * 60 * 1000,
    });
    const baseMetadata = JSON.parse(baseOutput);
    timings.baseDerivativesMs = Math.round(performance.now() - phaseStartedAt);

    await reportProgress(
      options,
      "tiles",
      20,
      "Building optimized scene tiles",
      { completedScenes: 0, totalScenes: baseMetadata.scenes },
    );
    phaseStartedAt = performance.now();
    await applyRuntimeTemplate(stagedRoot, options.runtimeTemplate);
    const configPath = join(stagedRoot, "js", "tour-config.js");
    const pannellumPath = join(stagedRoot, "js", "pannellum.js");
    const pannellumSource = await readFile(pannellumPath, "utf8");
    const pannellumFallbackPatches = [
      [
        'H.replace("%s",Q[t])+"."+m.extension:m[t].src',
        'H.replace("%s",Q[t])+"."+(m.fallbackExtension||m.extension):m[t].src',
      ],
    ];
    const matchingFallbackPatch = pannellumFallbackPatches.find(([needle]) =>
      pannellumSource.includes(needle)
    );
    const modernFallbackPattern = /([\w$]+)\.replace\("%s",([\w$]+)\[([\w$]+)\]\)\+\(([\w$]+)\.extension\?"\."\+\4\.extension:""\)/;
    const patchedPannellum = matchingFallbackPatch
      ? pannellumSource.replace(...matchingFallbackPatch)
      : pannellumSource.replace(
          modernFallbackPattern,
          (_, path, sides, side, media) =>
            `${path}.replace("%s",${sides}[${side}])+(${media}.fallbackExtension||${media}.extension?"."+(${media}.fallbackExtension||${media}.extension):"")`,
        );
    assert(
      patchedPannellum !== pannellumSource,
      "Pannellum fallback-extension compatibility patch did not apply.",
    );
    await writeFile(pannellumPath, patchedPannellum, "utf8");
    const project = readTourConfig(await readFile(configPath, "utf8"));
    const identity = releaseIdentity({
      tourVersion: options.tourVersion,
      previousTourVersion: options.previousTourVersion,
    });
    const firstSceneSource = join(
      stagedRoot,
      project.scenes.find((scene) => scene.id === project.firstScene)
        ?.panorama || "",
    );
    assert(
      await stat(firstSceneSource).catch(() => null),
      "First-scene panorama is missing before multires conversion.",
    );
    const firstSceneDimensions = await imageDimensions(firstSceneSource);
    const sceneIds = project.scenes.map((scene) => scene.id);
    const sceneBuilds = new Map();
    let tileCount = 0;
    let multiresCacheHits = 0;
    let multiresCacheMisses = 0;
    const sceneTimings = [];
    for (const [sceneIndex, scene] of project.scenes.entries()) {
      const sceneStartedAt = performance.now();
      const generated = await buildSceneMultires(
        scene,
        stagedRoot,
        temporaryRoot,
        options,
      );
      sceneBuilds.set(scene.id, generated);
      scene.type = "multires";
      scene.multiRes = generated.config;
      delete scene.panorama;
      tileCount += generated.tileCount;
      if (generated.cacheHit) multiresCacheHits += 1;
      else multiresCacheMisses += 1;
      sceneTimings.push({
        id: scene.id,
        durationMs: Math.round(performance.now() - sceneStartedAt),
        cacheHit: generated.cacheHit,
      });
      const completedScenes = sceneIndex + 1;
      await reportProgress(
        options,
        "tiles",
        Math.round(20 + (completedScenes / project.scenes.length) * 65),
        `${generated.cacheHit ? "Reused" : "Optimized"} view ${completedScenes} of ${project.scenes.length}`,
        {
          completedScenes,
          totalScenes: project.scenes.length,
          sceneId: scene.id,
          cacheHit: generated.cacheHit,
        },
      );
    }
    timings.runtimeAndTilesMs = Math.round(performance.now() - phaseStartedAt);
    phaseStartedAt = performance.now();
    await writeFile(
      configPath,
      `window.TOUR_CONFIG = ${JSON.stringify(project)};\n`,
      "utf8",
    );
    await reportProgress(
      options,
      "assembling",
      88,
      "Assembling and verifying the website tour",
    );
    const seoPerformance = await buildSeoAssets(
      firstSceneSource,
      stagedRoot,
      project,
      sceneBuilds,
    );
    const entrypointPath = join(stagedRoot, "index.html");
    const entrypointSource = deferRuntimeStyles(
      await deferRuntimeChrome(
        await readFile(entrypointPath, "utf8"),
        stagedRoot,
      ),
    );
    const firstFrameData = project.scenes.find(
      (scene) => scene.id === project.firstScene,
    )?.multiRes?.equirectangularThumbnail;
    assert(
      firstFrameData?.startsWith("data:image/webp;base64,"),
      "The inline first-frame preview is missing.",
    );
    const entrypointWithPreview = entrypointSource.replace(
      '<div id="panorama" class="viewer" aria-label="360 virtual tour"></div>',
      `<div id="panorama" class="viewer" aria-label="360 virtual tour"></div>\n      <img class="tour-first-frame" src="${firstFrameData}" alt="" aria-hidden="true" width="512" height="256" fetchpriority="high" style="visibility:hidden!important;opacity:0!important" />\n      ${staticTourLoaderMarkup()}`,
    );
    assert(
      entrypointWithPreview !== entrypointSource,
      "The first-frame preview could not be inserted into the tour entrypoint.",
    );
    const monitoredEntrypoint = injectTourMonitoringConfig(
      entrypointWithPreview,
      tourMonitoringConfig({
        identity,
        slug: options.slug,
        environment: productionTourMonitoringEnvironment(),
      }),
    );
    await writeFile(entrypointPath, monitoredEntrypoint, "utf8");
    const changelog = await writeReleaseChangelog(stagedRoot, {
      slug: options.slug,
      title: project.title,
      tourVersion: options.tourVersion,
      previousTourVersion: options.previousTourVersion,
      changeSummary: options.changeSummary,
    });
    await versionTourRuntime(stagedRoot);
    await rm(join(stagedRoot, "assets", "p"), { recursive: true, force: true });
    await assertPortableRelease(stagedRoot, project);
    seoPerformance.criticalBytes = (
      await Promise.all(
        seoPerformance.criticalFiles.map(
          async (path) => (await stat(join(stagedRoot, path))).size,
        ),
      )
    ).reduce((sum, bytes) => sum + bytes, 0);
    seoPerformance.criticalBudgetBytes = 1024 * 1024;
    assert(
      seoPerformance.criticalBytes <= seoPerformance.criticalBudgetBytes,
      `First-scene critical payload is ${seoPerformance.criticalBytes} bytes; budget is ${seoPerformance.criticalBudgetBytes} bytes.`,
    );
    const payloadFiles = await fileInventory(stagedRoot);
    const digest = digestInventory(payloadFiles);
    const version = `multires-${digest.slice(0, 12)}`;
    const immutablePrefix = `tours/${options.slug}/${version}/`;
    const payloadBytes = payloadFiles.reduce(
      (sum, file) => sum + file.bytes,
      0,
    );
    timings.seoAndInventoryMs = Math.round(performance.now() - phaseStartedAt);
    const sceneViews = Object.fromEntries(
      project.scenes.map((scene) => [
        scene.id,
        {
          pitch: scene.pitch,
          yaw: scene.yaw,
          hfov: scene.hfov,
        },
      ]),
    );
    const hotspotGraph = project.scenes.flatMap((scene) =>
      scene.hotspots.map((hotspot) => ({
        source: scene.id,
        target: hotspot.target,
        kind: hotspot.kind,
        pitch: hotspot.pitch,
        yaw: hotspot.yaw,
        targetPitch: hotspot.targetPitch,
        targetYaw: hotspot.targetYaw,
        targetHfov: hotspot.targetHfov,
      })),
    );
    const manifest = {
      schema: "raindigit-tour-multires-release/v2",
      title: project.title,
      slug: options.slug,
      version,
      packageVersion: version,
      releaseState: "immutable-candidate",
      studioVersion: identity.studioVersion,
      formatVersion: identity.formatVersion,
      runtimeVersion: identity.runtimeVersion,
      tourVersion: identity.tourVersion,
      previousTourVersion: identity.previousTourVersion,
      capabilities: identity.capabilities,
      verificationProfile: identity.verificationProfile,
      changelog: {
        human: "CHANGELOG.md",
        machine: "CHANGELOG.json",
        summary: changelog.summary,
      },
      generatedAt: new Date().toISOString(),
      rollbackVersion: options.rollbackVersion,
      firstScene: project.firstScene,
      sceneIds,
      sceneViews,
      hotspotGraph,
      mediaProfile: hybridMediaProfile(options.baseSize, options.tileSize),
      baseSize: options.baseSize,
      tileSize: options.tileSize,
      sourceWidth: firstSceneDimensions.width,
      sourceHeight: firstSceneDimensions.height,
      webpQuality: options.webpQuality,
      webpEffort: options.webpEffort,
      fallbackFormat: "jpeg",
      fallbackSize: options.fallbackSize,
      fileCount: payloadFiles.length,
      bytes: payloadBytes,
      files: payloadFiles,
      contentDigest: digest,
      immutablePrefix,
      entrypoint: `${immutablePrefix}index.html`,
      performance: seoPerformance,
    };
    await writeFile(
      join(stagedRoot, "release-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    const immutableRoot = join(packageRoot, immutablePrefix);
    await mkdir(dirname(immutableRoot), { recursive: true });
    await rename(stagedRoot, immutableRoot);
    const pointer = devChannelPointer({
      slug: options.slug,
      packageVersion: version,
      previousPackageVersion: options.rollbackVersion,
      immutablePrefix,
      contentDigest: digest,
      generatedAt: manifest.generatedAt,
      identity,
      manifestPath: `${immutablePrefix}release-manifest.json`,
    });
    const pointerPath = join(
      packageRoot,
      "channels",
      "dev",
      options.slug,
      "current.json",
    );
    await mkdir(dirname(pointerPath), { recursive: true });
    await writeFile(
      pointerPath,
      `${JSON.stringify(pointer, null, 2)}\n`,
      "utf8",
    );

    if (!options.replace) {
      try {
        await stat(options.output);
        throw new Error(
          `Release directory already exists: ${options.output}. Use --replace.`,
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await rm(options.output, { recursive: true, force: true });
    await rename(packageRoot, options.output);
    phaseStartedAt = performance.now();
    await reportProgress(
      options,
      "packaging",
      96,
      "Packaging the verified tour",
    );
    if (options.zip) await createZip(options.output, options.zip);
    timings.packageMs = Math.round(performance.now() - phaseStartedAt);
    timings.totalMs = Math.round(performance.now() - buildStartedAt);
    const cache = {
      enabled: Boolean(options.cacheDir),
      base: baseMetadata.cache || {
        enabled: false,
        hits: 0,
        misses: project.scenes.length,
      },
      multires: { hits: multiresCacheHits, misses: multiresCacheMisses },
    };
    await reportProgress(options, "complete", 100, "Tour package ready", {
      cache,
    });
    console.log(
      JSON.stringify(
        {
          output: options.output,
          zip: options.zip,
          slug: options.slug,
          version,
          packageVersion: version,
          studioVersion: identity.studioVersion,
          formatVersion: identity.formatVersion,
          runtimeVersion: identity.runtimeVersion,
          tourVersion: identity.tourVersion,
          changeSummary: changelog.summary,
          environment: "dev",
          immutablePrefix,
          entrypoint: manifest.entrypoint,
          releaseManifest: `${immutablePrefix}release-manifest.json`,
          pointer: `channels/dev/${options.slug}/current.json`,
          rollbackVersion: options.rollbackVersion,
          scenes: project.scenes.length,
          hotspots: hotspotGraph.length,
          tiles: tileCount,
          files: payloadFiles.length,
          bytes: payloadBytes,
          contentDigest: digest,
          cache,
          mediaWorker: mediaWorkerMetadata({
            baseSize: options.baseSize,
            tileSize: options.tileSize,
            webpEffort: options.webpEffort,
            projectionInterpolation: options.projectionInterpolation,
            faceConcurrency: options.faceConcurrency,
          }),
          buildMetrics: { timings, scenes: sceneTimings },
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
