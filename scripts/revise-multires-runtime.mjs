#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

function parseArguments(argv) {
  const options = { packageRoot: null, runtimeTemplate: resolve("web-tour"), colorMatrix: null, thinMedia: false, cdnOrigin: "https://cdn.raindigit.ie" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--package") options.packageRoot = resolve(argv[++index] || "");
    else if (argument === "--runtime-template") options.runtimeTemplate = resolve(argv[++index] || "");
    else if (argument === "--color-matrix") options.colorMatrix = String(argv[++index] || "").trim();
    else if (argument === "--thin-media") options.thinMedia = true;
    else if (argument === "--cdn-origin") options.cdnOrigin = String(argv[++index] || "").replace(/\/$/, "");
    else if (argument === "--help") {
      console.log("Usage: node scripts/revise-multires-runtime.mjs --package package-root [--runtime-template web-tour] [--color-matrix '20 SVG matrix values'] [--thin-media] [--cdn-origin URL]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.packageRoot) throw new Error("--package is required.");
  if (options.colorMatrix) {
    const values = options.colorMatrix.split(/\s+/).map(Number);
    if (values.length !== 20 || values.some((value) => !Number.isFinite(value))) {
      throw new Error("--color-matrix must contain exactly 20 finite SVG feColorMatrix values.");
    }
  }
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function inventory(directory) {
  const files = [];
  for (const file of (await walk(directory)).sort()) {
    const path = relative(directory, file).replaceAll("\\", "/");
    if (path === "release-manifest.json") continue;
    const body = await readFile(file);
    files.push({ path, bytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") });
  }
  return files;
}

function contentDigest(files, bodies) {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(bodies.get(file.path));
    digest.update("\0");
  }
  return digest.digest("hex");
}

function reviseRuntime(source, colorMatrix = null) {
  const legacySceneConfig = `    type: "equirectangular",\n    panorama: scene.panorama,`;
  const multiresSceneConfig = `    type: scene.type === "multires" ? "multires" : "equirectangular",\n    ...(scene.type === "multires" ? { multiRes: scene.multiRes } : { panorama: scene.panorama }),`;
  let runtime = source.replace(legacySceneConfig, multiresSceneConfig);
  assert(runtime.includes("multiRes: scene.multiRes"), "Runtime multires adapter could not be installed.");
  runtime = runtime.replace('  document.documentElement.classList.add("is-tour-ready");\n', "");
  if (!runtime.includes("function revealRenderedTour")) {
    runtime = runtime.replace(
      'viewer.on("load", () => {',
      'function revealRenderedTour() {\n  const canvas = viewer.getContainer().querySelector(".pnlm-render-container canvas");\n  if (viewer.isLoaded() && canvas) {\n    document.documentElement.classList.add("is-tour-ready");\n    return;\n  }\n  window.requestAnimationFrame(revealRenderedTour);\n}\nviewer.on("load", () => {\n  revealRenderedTour();'
    );
    runtime = runtime.replace("setActiveScene(initialScene);", "revealRenderedTour();\nsetActiveScene(initialScene);");
  }
  assert(runtime.includes("function revealRenderedTour"), "Reliable first-frame reveal could not be installed.");
  if (!runtime.includes("window.__tourViewer = viewer")) {
    runtime += '\nif (new URLSearchParams(window.location.search).get("qa") === "1") window.__tourViewer = viewer;\n';
  }
  if (colorMatrix) {
    const marker = "const adjustmentPreviewDisabled = new Set();";
    const calibration = `${marker}\nconst legacyColorMatrix = ${JSON.stringify(colorMatrix)};\n\nfunction ensureLegacyColorMatrix() {\n  let svg = document.querySelector(\"#legacy-color-matrix-svg\");\n  if (svg) return;\n  svg = document.createElementNS(\"http://www.w3.org/2000/svg\", \"svg\");\n  svg.id = \"legacy-color-matrix-svg\";\n  svg.setAttribute(\"width\", \"0\");\n  svg.setAttribute(\"height\", \"0\");\n  svg.setAttribute(\"aria-hidden\", \"true\");\n  svg.innerHTML = \`<filter id=\"legacy-color-matrix\" color-interpolation-filters=\"sRGB\"><feColorMatrix type=\"matrix\" values=\"\${legacyColorMatrix}\" /></filter>\`;\n  document.body.append(svg);\n}\nensureLegacyColorMatrix();`;
    runtime = runtime.replace(marker, calibration);
    assert(runtime.includes("legacyColorMatrix"), "Legacy color calibration could not be installed.");
    runtime = runtime.replace(
      "canvas.style.filter = `brightness(${adjustment.brightness}%) contrast(${adjustment.contrast}%) saturate(${adjustment.saturation}%) sepia(${warmTint.toFixed(2)}) hue-rotate(${-coolHueShift.toFixed(1)}deg)`;",
      "canvas.style.filter = `url(#legacy-color-matrix) brightness(${adjustment.brightness}%) contrast(${adjustment.contrast}%) saturate(${adjustment.saturation}%) sepia(${warmTint.toFixed(2)}) hue-rotate(${-coolHueShift.toFixed(1)}deg)`;"
    );
    runtime = runtime.replace('    canvas.style.filter = "none";', '    canvas.style.filter = "url(#legacy-color-matrix)";');
    assert(runtime.includes("url(#legacy-color-matrix)"), "Legacy color calibration was not connected to the panorama canvas.");
    runtime = runtime.replace(
      "viewer.on(\"load\", () => {\n  revealRenderedTour();",
      "viewer.on(\"load\", () => {\n  applySceneAdjustment(viewer.getScene());\n  revealRenderedTour();"
    );
    runtime = runtime.replace(
      "setActiveScene(initialScene);",
      "applySceneAdjustment(initialScene);\nsetActiveScene(initialScene);"
    );
    assert(runtime.includes("applySceneAdjustment(initialScene);"), "Legacy color calibration was not attached to the initial rendered scene.");
  }
  return runtime;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifests = (await walk(options.packageRoot)).filter((path) => path.endsWith("/release-manifest.json"));
  assert(manifests.length === 1, `Expected one source release manifest, found ${manifests.length}.`);
  const sourceManifest = JSON.parse(await readFile(manifests[0], "utf8"));
  assert(sourceManifest.schema === "raindigit-tour-multires-release/v1", "Source package is not a multires release.");
  const sourceRelease = dirname(manifests[0]);
  const temporary = await mkdtemp(join(tmpdir(), "raindigit-runtime-revision-"));
  const stagedRelease = join(temporary, "release");
  const stagedPackage = join(temporary, "package");
  try {
    await cp(sourceRelease, stagedRelease, { recursive: true });
    const mediaBefore = new Map(sourceManifest.files
      .filter((file) => file.path.startsWith("assets/mr/") || file.path.startsWith("assets/t/"))
      .map((file) => [file.path, file.sha256]));

    const currentIndex = await readFile(join(stagedRelease, "index.html"), "utf8");
    const firstFrame = currentIndex.match(/\s*<img class="tour-first-frame"[^>]+\/>/)?.[0];
    assert(firstFrame, "The source multires release has no inline first frame.");
    const templateIndex = await readFile(join(options.runtimeTemplate, "index.html"), "utf8");
    const inlineFirstFrameCss = "<style>.tour-first-frame{position:absolute;inset:0;z-index:1;width:100%;height:100%;object-fit:cover;pointer-events:none;opacity:1}.is-tour-ready .tour-first-frame{opacity:0}html:not(.is-tour-ready) .tour-shell,html:not(.is-tour-ready) .tour-first-frame{visibility:visible!important}</style>";
    const indexWithCriticalCss = templateIndex.includes("</head>") ? templateIndex.replace("</head>", `${inlineFirstFrameCss}</head>`) : templateIndex;
    const revisedIndex = indexWithCriticalCss.replace(
      '<div id="panorama" class="viewer" aria-label="360 virtual tour"></div>',
      `<div id="panorama" class="viewer" aria-label="360 virtual tour"></div>${options.colorMatrix ? `<svg id="legacy-color-matrix-svg" width="0" height="0" aria-hidden="true"><filter id="legacy-color-matrix" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${options.colorMatrix}" /></filter></svg>` : ""}${firstFrame}`
    );
    assert(revisedIndex !== templateIndex, "The production-shell first frame could not be installed.");
    await writeFile(join(stagedRelease, "index.html"), revisedIndex, "utf8");

    const runtimeSource = await readFile(join(options.runtimeTemplate, "js", "tour.js"), "utf8");
    await writeFile(join(stagedRelease, "js", "tour.js"), reviseRuntime(runtimeSource, options.colorMatrix), "utf8");
    await cp(join(options.runtimeTemplate, "js", "tour-bootstrap.js"), join(stagedRelease, "js", "tour-bootstrap.js"));
    await cp(join(options.runtimeTemplate, "assets", "raindigit-mark.svg"), join(stagedRelease, "assets", "raindigit-mark.svg"));
    const templateCss = await readFile(join(options.runtimeTemplate, "css", "tour.css"), "utf8");
    const firstFrameCss = templateCss.includes(".tour-first-frame") ? "" : "\n.tour-first-frame { position:absolute; inset:0; z-index:1; width:100%; height:100%; object-fit:cover; pointer-events:none; opacity:1; transition:opacity 180ms ease; }\n.is-tour-ready .tour-first-frame { opacity:0; }\n@media (prefers-reduced-motion: reduce) { .tour-first-frame { transition:none; } }\n";
    const calibrationCss = options.colorMatrix ? "\n.tour-first-frame { filter:url(#legacy-color-matrix); }\n" : "";
    const readinessCss = "\nhtml:not(.is-tour-ready) .tour-shell, html:not(.is-tour-ready) .tour-first-frame { visibility:visible !important; }\n";
    await writeFile(join(stagedRelease, "css", "tour.css"), `${templateCss.trimEnd()}${firstFrameCss}${calibrationCss}${readinessCss}\n`, "utf8");

    if (options.thinMedia) {
      const configPath = join(stagedRelease, "js", "tour-config.js");
      const configSource = await readFile(configPath, "utf8");
      const prefix = "window.TOUR_CONFIG = ";
      assert(configSource.startsWith(prefix) && configSource.trimEnd().endsWith(";"), "Thin release could not parse TOUR_CONFIG.");
      const config = JSON.parse(configSource.slice(prefix.length).trim().replace(/;$/, ""));
      const mediaOrigin = `${options.cdnOrigin}/${sourceManifest.immutablePrefix}`;
      for (const scene of config.scenes) {
        if (scene.thumb && !/^https?:\/\//.test(scene.thumb)) scene.thumb = `${mediaOrigin}${scene.thumb}`;
        if (scene.multiRes?.basePath && !/^https?:\/\//.test(scene.multiRes.basePath)) {
          scene.multiRes.basePath = `${mediaOrigin}${scene.multiRes.basePath}`;
        }
      }
      await writeFile(configPath, `${prefix}${JSON.stringify(config)};\n`, "utf8");
      await rm(join(stagedRelease, "assets", "mr"), { recursive: true, force: true });
      await rm(join(stagedRelease, "assets", "t"), { recursive: true, force: true });
    }

    const files = await inventory(stagedRelease);
    const bodies = new Map(await Promise.all(files.map(async (file) => [file.path, await readFile(join(stagedRelease, file.path))])));
    const dependencyDigest = options.thinMedia ? (sourceManifest.mediaDependency?.contentDigest || sourceManifest.contentDigest) : null;
    const digest = dependencyDigest
      ? createHash("sha256").update(`media:${dependencyDigest}\0${contentDigest(files, bodies)}`).digest("hex")
      : contentDigest(files, bodies);
    const version = `multires-${digest.slice(0, 12)}`;
    const immutablePrefix = `tours/${sourceManifest.slug}/${version}/`;
    const mediaAfter = new Map(files
      .filter((file) => file.path.startsWith("assets/mr/") || file.path.startsWith("assets/t/"))
      .map((file) => [file.path, file.sha256]));
    if (!options.thinMedia) {
      assert(mediaBefore.size === mediaAfter.size, "Runtime revision changed the media-file count.");
      for (const [path, sha256] of mediaBefore) assert(mediaAfter.get(path) === sha256, `Runtime revision changed media: ${path}`);
    } else {
      assert(mediaAfter.size === 0, "Thin runtime release unexpectedly contains panorama media.");
    }

    const sourceFiles = new Map(sourceManifest.files.map((file) => [file.path, file]));
    const sourceShellCriticalBytes = sourceManifest.performance.criticalFiles.reduce((sum, path) => sum + (sourceFiles.get(path)?.bytes || 0), 0);
    const dependencyCriticalBytes = sourceManifest.mediaDependency
      ? Math.max(0, sourceManifest.performance.criticalBytes - sourceShellCriticalBytes)
      : 0;
    const criticalBytes = sourceManifest.performance.criticalFiles.reduce((sum, path) => {
      const file = files.find((candidate) => candidate.path === path) || sourceFiles.get(path);
      return sum + (file?.bytes || 0);
    }, dependencyCriticalBytes);
    const generatedAt = new Date().toISOString();
    const manifest = {
      ...sourceManifest,
      version,
      generatedAt,
      fileCount: files.length,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files,
      contentDigest: digest,
      immutablePrefix,
      entrypoint: `${immutablePrefix}index.html`,
      ...(options.thinMedia ? {
        mediaDependency: sourceManifest.mediaDependency || {
          version: sourceManifest.version,
          immutablePrefix: sourceManifest.immutablePrefix,
          contentDigest: sourceManifest.contentDigest,
          files: mediaBefore.size,
          bytes: sourceManifest.files.filter((file) => file.path.startsWith("assets/mr/") || file.path.startsWith("assets/t/")).reduce((sum, file) => sum + file.bytes, 0)
        }
      } : {}),
      ...(options.colorMatrix ? {
        renderCalibration: {
          type: "svg-color-matrix",
          values: options.colorMatrix,
          purpose: "Legacy production-tone parity derived from source-to-reference regression; media bytes remain unchanged."
        }
      } : {}),
      performance: { ...sourceManifest.performance, criticalBytes }
    };
    assert(criticalBytes <= manifest.performance.criticalBudgetBytes, "Runtime revision exceeds the first-interactive budget.");
    await writeFile(join(stagedRelease, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const targetRelease = join(stagedPackage, immutablePrefix);
    await mkdir(dirname(targetRelease), { recursive: true });
    await rename(stagedRelease, targetRelease);
    const pointer = {
      schema: "raindigit-tour-current/v1",
      slug: manifest.slug,
      version,
      previousVersion: manifest.rollbackVersion,
      prefix: immutablePrefix,
      entrypoint: manifest.entrypoint,
      releaseManifest: `${immutablePrefix}release-manifest.json`,
      contentDigest: digest,
      updatedAt: generatedAt
    };
    const pointerPath = join(stagedPackage, "manifests", manifest.slug, "current.json");
    await mkdir(dirname(pointerPath), { recursive: true });
    await writeFile(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
    const replacement = `${options.packageRoot}.replacement`;
    await rm(replacement, { recursive: true, force: true });
    await rename(stagedPackage, replacement);
    await rm(options.packageRoot, { recursive: true, force: true });
    await rename(replacement, options.packageRoot);
    console.log(JSON.stringify({
      slug: manifest.slug,
      previousVersion: sourceManifest.version,
      version,
      files: manifest.fileCount,
      bytes: manifest.bytes,
      mediaFilesVerifiedUnchanged: mediaBefore.size,
      thinMedia: options.thinMedia,
      criticalBytes
    }, null, 2));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
