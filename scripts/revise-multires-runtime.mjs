#!/usr/bin/env node

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
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import vm from "node:vm";
import {
  assertPortableRelease,
  devChannelPointer,
  digestInventory,
  releaseIdentity,
  writeReleaseChangelog,
} from "./lib/release-contract.mjs";
import { versionTourRuntime } from "./lib/version-tour-runtime.mjs";

function parseArguments(argv) {
  const options = {
    packageRoot: null,
    runtimeTemplate: resolve("web-tour"),
    colorMatrix: null,
    thinMedia: false,
    tourVersion: null,
    previousTourVersion: null,
    changeSummary: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--package")
      options.packageRoot = resolve(argv[++index] || "");
    else if (argument === "--runtime-template")
      options.runtimeTemplate = resolve(argv[++index] || "");
    else if (argument === "--color-matrix")
      options.colorMatrix = String(argv[++index] || "").trim();
    else if (argument === "--thin-media") options.thinMedia = true;
    else if (argument === "--tour-version")
      options.tourVersion = String(argv[++index] || "");
    else if (argument === "--previous-tour-version")
      options.previousTourVersion = String(argv[++index] || "");
    else if (argument === "--change-summary")
      options.changeSummary = String(argv[++index] || "");
    else if (argument === "--help") {
      console.log(
        "Usage: node scripts/revise-multires-runtime.mjs --package package-root --tour-version <Studio version> --change-summary 'Migrated to portable v2' [--previous-tour-version <prior Studio version>] [--runtime-template web-tour] [--color-matrix '20 SVG matrix values']",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.packageRoot) throw new Error("--package is required.");
  if (options.thinMedia)
    throw new Error(
      "--thin-media is no longer supported: every release must contain its own media.",
    );
  releaseIdentity({
    tourVersion: options.tourVersion,
    previousTourVersion: options.previousTourVersion,
  });
  if (String(options.changeSummary || "").trim().length < 8)
    throw new Error("--change-summary must describe this tour version.");
  if (options.colorMatrix) {
    const values = options.colorMatrix.split(/\s+/).map(Number);
    if (
      values.length !== 20 ||
      values.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(
        "--color-matrix must contain exactly 20 finite SVG feColorMatrix values.",
      );
    }
  }
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
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
    files.push({
      path,
      bytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
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
  assert(
    runtime.includes("multiRes: scene.multiRes"),
    "Runtime multires adapter could not be installed.",
  );
  if (!runtime.includes("function revealRenderedTour")) {
    runtime = runtime.replace(
      '  document.documentElement.classList.add("is-tour-ready");\n',
      "",
    );
    runtime = runtime.replace(
      'viewer.on("load", () => {',
      'function revealRenderedTour() {\n  const canvas = viewer.getContainer().querySelector(".pnlm-render-container canvas");\n  const runtimeStylesState = document.documentElement.dataset.runtimeStyles;\n  const runtimeStylesReady = !runtimeStylesState || runtimeStylesState === "ready";\n  const transition = window.__rainDigitTourTransition?.state?.();\n  const transitionReady = !window.__rainDigitTourTransition || transition?.phase === "ready";\n  if (viewer.isLoaded() && canvas?.width > 0 && canvas?.height > 0 && runtimeStylesReady && transitionReady) {\n    document.documentElement.classList.add("is-tour-ready");\n    return;\n  }\n  // Browsers may suspend animation frames in an off-screen iframe.\n  window.setTimeout(revealRenderedTour, 16);\n}\nviewer.on("load", () => {\n  revealRenderedTour();',
    );
    runtime = runtime.replace(
      "setActiveScene(initialScene);",
      "revealRenderedTour();\nsetActiveScene(initialScene);",
    );
  }
  assert(
    runtime.includes("function revealRenderedTour") &&
      runtime.includes("runtimeStylesReady") &&
      runtime.includes("transitionReady") &&
      runtime.includes("canvas?.width > 0") &&
      runtime.includes(
        'document.documentElement.classList.add("is-tour-ready")',
      ) &&
      runtime.includes("window.setTimeout(revealRenderedTour, 16)"),
    "Reliable iPhone-safe first-frame reveal could not be installed.",
  );
  if (!runtime.includes("window.__tourViewer = viewer")) {
    runtime += "\nwindow.__tourViewer = viewer;\n";
  }
  if (!runtime.includes("__rainDigitTourTransition?.attach(viewer)")) {
    runtime += "\nwindow.__rainDigitTourTransition?.attach(viewer);\n";
  }
  assert(
    runtime.includes("window.__tourViewer = viewer") &&
      runtime.includes("__rainDigitTourTransition?.attach(viewer)"),
    "The revised runtime must expose and attach its viewer before readiness can be trusted.",
  );
  if (colorMatrix) {
    const marker = "const adjustmentPreviewDisabled = new Set();";
    const calibration = `${marker}\nconst legacyColorMatrix = ${JSON.stringify(colorMatrix)};\n\nfunction ensureLegacyColorMatrix() {\n  let svg = document.querySelector(\"#legacy-color-matrix-svg\");\n  if (svg) return;\n  svg = document.createElementNS(\"http://www.w3.org/2000/svg\", \"svg\");\n  svg.id = \"legacy-color-matrix-svg\";\n  svg.setAttribute(\"width\", \"0\");\n  svg.setAttribute(\"height\", \"0\");\n  svg.setAttribute(\"aria-hidden\", \"true\");\n  svg.innerHTML = \`<filter id=\"legacy-color-matrix\" color-interpolation-filters=\"sRGB\"><feColorMatrix type=\"matrix\" values=\"\${legacyColorMatrix}\" /></filter>\`;\n  document.body.append(svg);\n}\nensureLegacyColorMatrix();`;
    runtime = runtime.replace(marker, calibration);
    assert(
      runtime.includes("legacyColorMatrix"),
      "Legacy color calibration could not be installed.",
    );
    runtime = runtime.replace(
      "canvas.style.filter = `brightness(${adjustment.brightness}%) contrast(${adjustment.contrast}%) saturate(${adjustment.saturation}%) sepia(${warmTint.toFixed(2)}) hue-rotate(${-coolHueShift.toFixed(1)}deg)`;",
      "canvas.style.filter = `url(#legacy-color-matrix) brightness(${adjustment.brightness}%) contrast(${adjustment.contrast}%) saturate(${adjustment.saturation}%) sepia(${warmTint.toFixed(2)}) hue-rotate(${-coolHueShift.toFixed(1)}deg)`;",
    );
    runtime = runtime.replace(
      '    canvas.style.filter = "none";',
      '    canvas.style.filter = "url(#legacy-color-matrix)";',
    );
    assert(
      runtime.includes("url(#legacy-color-matrix)"),
      "Legacy color calibration was not connected to the panorama canvas.",
    );
    runtime = runtime.replace(
      'viewer.on("load", () => {\n  revealRenderedTour();',
      'viewer.on("load", () => {\n  applySceneAdjustment(viewer.getScene());\n  revealRenderedTour();',
    );
    runtime = runtime.replace(
      "setActiveScene(initialScene);",
      "applySceneAdjustment(initialScene);\nsetActiveScene(initialScene);",
    );
    assert(
      runtime.includes("applySceneAdjustment(initialScene);"),
      "Legacy color calibration was not attached to the initial rendered scene.",
    );
  }
  return runtime;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifests = (await walk(options.packageRoot)).filter((path) =>
    path.endsWith("/release-manifest.json"),
  );
  assert(
    manifests.length === 1,
    `Expected one source release manifest, found ${manifests.length}.`,
  );
  const sourceManifest = JSON.parse(await readFile(manifests[0], "utf8"));
  assert(
    [
      "raindigit-tour-multires-release/v1",
      "raindigit-tour-multires-release/v2",
    ].includes(sourceManifest.schema),
    "Source package is not a supported multires release.",
  );
  const sourceRelease = dirname(manifests[0]);
  const temporary = await mkdtemp(
    join(tmpdir(), "raindigit-runtime-revision-"),
  );
  const stagedRelease = join(temporary, "release");
  const stagedPackage = join(temporary, "package");
  try {
    await cp(sourceRelease, stagedRelease, { recursive: true });
    const mediaBefore = new Map(
      sourceManifest.files
        .filter(
          (file) =>
            file.path.startsWith("assets/mr/") ||
            file.path.startsWith("assets/t/"),
        )
        .map((file) => [file.path, file.sha256]),
    );

    const currentIndex = await readFile(
      join(stagedRelease, "index.html"),
      "utf8",
    );
    const firstFrameSource = currentIndex.match(
      /\s*<img class="tour-first-frame"[^>]+\/>/,
    )?.[0];
    assert(
      firstFrameSource,
      "The source multires release has no inline first frame.",
    );
    const firstFrame = firstFrameSource.includes("style=")
      ? firstFrameSource
      : firstFrameSource.replace(
          /\s*\/>$/,
          ' style="visibility:hidden!important;opacity:0!important" />',
        );
    const templateIndex = await readFile(
      join(options.runtimeTemplate, "index.html"),
      "utf8",
    );
    const inlineFirstFrameCss =
      "<style data-runtime-critical>html,body,.tour-shell,.viewer{width:100%;height:100%;margin:0}html,body{overflow:hidden;background:#070807;color:#f8f1df}.tour-shell{position:relative;min-height:100svh;background:#070807}.viewer{position:absolute;inset:0}.tour-first-frame{position:absolute;inset:0;z-index:1;width:100%;height:100%;object-fit:cover;pointer-events:none;opacity:1}.is-tour-ready .tour-first-frame{opacity:0}.is-tour-transition-boot .tour-first-frame,.tour-shell.is-transition-guarded>.tour-first-frame{z-index:1;visibility:hidden!important;opacity:0!important;transition:none}.tour-scene-transition--static{position:absolute;z-index:34;inset:0;display:block;visibility:visible;opacity:1;overflow:hidden;pointer-events:none;background:#070807;color:#f8f1df}.tour-scene-transition--static .tour-scene-transition__stage{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:#070807}.tour-scene-transition--static .tour-scene-transition__tiles{position:absolute;inset:0;display:grid;width:100%;height:100%;grid-template-columns:repeat(6,minmax(0,1fr));grid-template-rows:repeat(4,minmax(0,1fr));background:#070807}.tour-scene-transition--static .tour-scene-transition__tile{display:block;box-sizing:border-box;min-width:0;min-height:0;border:1px solid rgba(229,185,96,.18);background:linear-gradient(135deg,#080907,#17140d 52%,#090a08)}.tour-scene-transition--static .tour-scene-transition__mobile-status{position:absolute;z-index:1;left:50%;top:50%;display:flex;align-items:center;gap:7px;transform:translate(-50%,-50%);padding:7px 10px;border:1px solid rgba(229,185,96,.52);border-radius:999px;background:#090a08;color:#f8f1df;font:600 10px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}.tour-scene-transition--static .tour-scene-transition__mobile-mark{width:7px;height:7px;border-radius:50%;background:#e5b960;box-shadow:0 0 12px rgba(229,185,96,.72)}html:not(.is-tour-ready) .tour-shell{visibility:visible!important}</style>";
    const indexWithCriticalCss = templateIndex.includes(
      '<link rel="stylesheet"',
    )
      ? templateIndex.replace(
          /(<link rel="stylesheet")/,
          `${inlineFirstFrameCss}$1`,
        )
      : templateIndex.includes("</head>")
        ? templateIndex.replace("</head>", `${inlineFirstFrameCss}</head>`)
        : templateIndex;
    const revisedIndex = indexWithCriticalCss.replace(
      '<div id="panorama" class="viewer" aria-label="360 virtual tour"></div>',
      `<div id="panorama" class="viewer" aria-label="360 virtual tour"></div>${options.colorMatrix ? `<svg id="legacy-color-matrix-svg" width="0" height="0" aria-hidden="true"><filter id="legacy-color-matrix" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${options.colorMatrix}" /></filter></svg>` : ""}${firstFrame}\n      ${staticTourLoaderMarkup()}`,
    );
    assert(
      revisedIndex !== templateIndex,
      "The production-shell first frame could not be installed.",
    );
    await writeFile(join(stagedRelease, "index.html"), revisedIndex, "utf8");
    await rm(join(stagedRelease, "js", "tour-chrome.js"), { force: true });

    const runtimeSource = await readFile(
      join(options.runtimeTemplate, "js", "tour.js"),
      "utf8",
    );
    await writeFile(
      join(stagedRelease, "js", "tour.js"),
      reviseRuntime(runtimeSource, options.colorMatrix),
      "utf8",
    );
    await cp(
      join(options.runtimeTemplate, "js", "tour-bootstrap.js"),
      join(stagedRelease, "js", "tour-bootstrap.js"),
    );
    await cp(
      join(options.runtimeTemplate, "js", "tour-transition.js"),
      join(stagedRelease, "js", "tour-transition.js"),
    );
    await cp(
      join(options.runtimeTemplate, "assets", "raindigit-mark.svg"),
      join(stagedRelease, "assets", "raindigit-mark.svg"),
    );
    const templateCss = await readFile(
      join(options.runtimeTemplate, "css", "tour.css"),
      "utf8",
    );
    const firstFrameCss = templateCss.includes(".tour-first-frame")
      ? ""
      : "\n.tour-first-frame { position:absolute; inset:0; z-index:1; width:100%; height:100%; object-fit:cover; pointer-events:none; opacity:1; transition:opacity 180ms ease; }\n.is-tour-ready .tour-first-frame { opacity:0; }\n@media (prefers-reduced-motion: reduce) { .tour-first-frame { transition:none; } }\n";
    const calibrationCss = options.colorMatrix
      ? "\n.tour-first-frame { filter:url(#legacy-color-matrix); }\n"
      : "";
    const readinessCss =
      "\nhtml:not(.is-tour-ready) .tour-shell { visibility:visible !important; }\n";
    await writeFile(
      join(stagedRelease, "css", "tour.css"),
      `${templateCss.trimEnd()}${firstFrameCss}${calibrationCss}${readinessCss}\n`,
      "utf8",
    );

    const configPath = join(stagedRelease, "js", "tour-config.js");
    const configSource = await readFile(configPath, "utf8");
    const configContext = { window: {} };
    vm.runInNewContext(configSource, configContext);
    const config = configContext.window.TOUR_CONFIG;
    const changelog = await writeReleaseChangelog(stagedRelease, {
      slug: sourceManifest.slug,
      title: sourceManifest.title,
      tourVersion: options.tourVersion,
      previousTourVersion: options.previousTourVersion,
      changeSummary: options.changeSummary,
    });
    await versionTourRuntime(stagedRelease);
    await assertPortableRelease(stagedRelease, config);

    const files = await inventory(stagedRelease);
    const digest = digestInventory(files);
    const version = `multires-${digest.slice(0, 12)}`;
    const immutablePrefix = `tours/${sourceManifest.slug}/${version}/`;
    const mediaAfter = new Map(
      files
        .filter(
          (file) =>
            file.path.startsWith("assets/mr/") ||
            file.path.startsWith("assets/t/"),
        )
        .map((file) => [file.path, file.sha256]),
    );
    assert(
      mediaBefore.size === mediaAfter.size && mediaBefore.size > 0,
      "Runtime revision changed or omitted the media-file count.",
    );
    for (const [path, sha256] of mediaBefore)
      assert(
        mediaAfter.get(path) === sha256,
        `Runtime revision changed media: ${path}`,
      );

    const sourceFiles = new Map(sourceManifest.files.map((file) => [file.path, file]));
    const revisedFiles = new Map(files.map((file) => [file.path, file]));
    const criticalFiles = [
      ...new Set([
        ...sourceManifest.performance.criticalFiles,
        "js/tour-chrome.js",
        "js/tour-transition.js",
      ]),
    ].filter((path) => revisedFiles.has(path) || sourceFiles.has(path));
    const criticalBytes = criticalFiles.reduce((sum, path) => {
      const file = revisedFiles.get(path) || sourceFiles.get(path);
      return sum + (file?.bytes || 0);
    }, 0);
    const generatedAt = new Date().toISOString();
    const identity = releaseIdentity({
      tourVersion: options.tourVersion,
      previousTourVersion: options.previousTourVersion,
    });
    const manifest = {
      ...sourceManifest,
      schema: "raindigit-tour-multires-release/v2",
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
      generatedAt,
      fileCount: files.length,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files,
      contentDigest: digest,
      immutablePrefix,
      entrypoint: `${immutablePrefix}index.html`,
      ...(options.colorMatrix
        ? {
            renderCalibration: {
              type: "svg-color-matrix",
              values: options.colorMatrix,
              purpose:
                "Legacy production-tone parity derived from source-to-reference regression; media bytes remain unchanged.",
            },
          }
        : {}),
      performance: { ...sourceManifest.performance, criticalFiles, criticalBytes },
    };
    delete manifest.mediaDependency;
    assert(
      criticalBytes <= manifest.performance.criticalBudgetBytes,
      "Runtime revision exceeds the first-interactive budget.",
    );
    await writeFile(
      join(stagedRelease, "release-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    const targetRelease = join(stagedPackage, immutablePrefix);
    await mkdir(dirname(targetRelease), { recursive: true });
    await rename(stagedRelease, targetRelease);
    const pointer = devChannelPointer({
      slug: manifest.slug,
      packageVersion: version,
      previousPackageVersion: sourceManifest.version,
      immutablePrefix,
      contentDigest: digest,
      generatedAt,
      identity,
      manifestPath: `${immutablePrefix}release-manifest.json`,
    });
    const pointerPath = join(
      stagedPackage,
      "channels",
      "dev",
      manifest.slug,
      "current.json",
    );
    await mkdir(dirname(pointerPath), { recursive: true });
    await writeFile(
      pointerPath,
      `${JSON.stringify(pointer, null, 2)}\n`,
      "utf8",
    );
    const replacement = `${options.packageRoot}.replacement`;
    await rm(replacement, { recursive: true, force: true });
    await rename(stagedPackage, replacement);
    await rm(options.packageRoot, { recursive: true, force: true });
    await rename(replacement, options.packageRoot);
    console.log(
      JSON.stringify(
        {
          slug: manifest.slug,
          previousVersion: sourceManifest.version,
          version,
          packageVersion: version,
          studioVersion: identity.studioVersion,
          formatVersion: identity.formatVersion,
          runtimeVersion: identity.runtimeVersion,
          tourVersion: identity.tourVersion,
          changeSummary: changelog.summary,
          environment: "dev",
          files: manifest.fileCount,
          bytes: manifest.bytes,
          mediaFilesVerifiedUnchanged: mediaBefore.size,
          selfContained: true,
          criticalBytes,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
