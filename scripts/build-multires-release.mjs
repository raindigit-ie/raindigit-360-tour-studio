#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const faceLetters = ["f", "b", "u", "d", "l", "r"];

function parseArguments(argv) {
  const options = {
    workspace: join(projectRoot, "studio-workspace"),
    output: join(projectRoot, "release-multires"),
    zip: null,
    slug: null,
    rollbackVersion: null,
    tileSize: 512,
    fallbackSize: 1024,
    webpQuality: 78,
    jpegQuality: 86,
    replace: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--workspace") options.workspace = resolve(argv[++index] || "");
    else if (argument === "--output") options.output = resolve(argv[++index] || "");
    else if (argument === "--zip") options.zip = resolve(argv[++index] || "");
    else if (argument === "--slug") options.slug = String(argv[++index] || "");
    else if (argument === "--rollback-version") options.rollbackVersion = String(argv[++index] || "");
    else if (argument === "--tile-size") options.tileSize = Number(argv[++index]);
    else if (argument === "--fallback-size") options.fallbackSize = Number(argv[++index]);
    else if (argument === "--webp-quality") options.webpQuality = Number(argv[++index]);
    else if (argument === "--jpeg-quality") options.jpegQuality = Number(argv[++index]);
    else if (argument === "--replace") options.replace = true;
    else if (argument === "--help") {
      console.log("Usage: node scripts/build-multires-release.mjs --workspace path --output package-root --slug project-slug [--zip package.zip] [--rollback-version version] [--tile-size 512] [--fallback-size 1024] [--webp-quality 78] [--jpeg-quality 86] [--replace]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug)) throw new Error("--slug must be a lowercase URL slug.");
  if (options.rollbackVersion && !/^(?:legacy|multires)-[a-f0-9]{8,64}$/.test(options.rollbackVersion)) throw new Error("--rollback-version must be a legacy-* or multires-* content version.");
  if (![256, 512, 1024].includes(options.tileSize)) throw new Error("Tile size must be 256, 512 or 1024 pixels.");
  if (!Number.isInteger(options.fallbackSize) || options.fallbackSize < 512 || options.fallbackSize > 2048) throw new Error("Fallback size must be 512..2048 pixels.");
  if (!Number.isInteger(options.webpQuality) || options.webpQuality < 75 || options.webpQuality > 80) throw new Error("WebP quality must be 75..80.");
  if (!Number.isInteger(options.jpegQuality) || options.jpegQuality < 84 || options.jpegQuality > 94) throw new Error("JPEG quality must be 84..94.");
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run(command, arguments_, options = {}) {
  try {
    return await execFileAsync(command, arguments_, { maxBuffer: 8 * 1024 * 1024, ...options });
  } catch (error) {
    throw new Error(`${command} failed: ${error.stderr || error.message}`);
  }
}

async function runMagick(arguments_) {
  for (const binary of ["magick", "convert"]) {
    try {
      return await execFileAsync(binary, arguments_, { maxBuffer: 8 * 1024 * 1024 });
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
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

async function fileInventory(directory) {
  const files = [];
  for (const file of (await walk(directory)).sort()) {
    const body = await readFile(file);
    files.push({
      path: relative(directory, file).split("\\").join("/"),
      bytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex")
    });
  }
  return files;
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

function cubeResolution(width) {
  return Math.max(512, 8 * Math.floor(width / Math.PI / 8));
}

function maxLevel(size, tileSize) {
  let levels = Math.ceil(Math.log2(size / Math.min(tileSize, size))) + 1;
  if (levels > 1 && Math.floor(size / 2 ** (levels - 2)) === tileSize) levels -= 1;
  return levels;
}

async function makePreview(input) {
  const { stdout } = await runMagick([input, "-resize", "256x128!", "-strip", "-quality", "72", "webp:-"]);
  return `data:image/webp;base64,${Buffer.from(stdout, "binary").toString("base64")}`;
}

function seoDescription(title) {
  const base = `Explore ${title}, a self-hosted interactive 360° tour by Rain Digit with connected scenes, clear navigation and mobile-ready viewing.`;
  const suffix = " Open the tour and understand the space before you arrive.";
  const combined = `${base}${suffix}`;
  if (combined.length <= 160 && combined.length >= 140) return combined;
  if (combined.length < 140) return `${combined} Available on desktop and mobile.`.slice(0, 160);
  const candidate = combined.slice(0, 159);
  return `${candidate.slice(0, candidate.lastIndexOf(" ")).replace(/[\s,;:.-]+$/g, "")}.`;
}

async function buildSeoAssets(input, stagedRoot, project, sceneBuilds) {
  const targetRoot = join(stagedRoot, "assets", "seo");
  const previewPath = join(targetRoot, "preview.webp");
  const posterPath = join(targetRoot, "poster.webp");
  await mkdir(targetRoot, { recursive: true });
  await runMagick([input, "-resize", "512x256!", "-strip", "-quality", "66", previewPath]);
  await runMagick([input, "-resize", "1200x630^", "-gravity", "center", "-extent", "1200x630", "-strip", "-quality", "82", posterPath]);
  const previewBytes = (await stat(previewPath)).size;
  assert(previewBytes <= 30 * 1024, `Generated preview is ${previewBytes} bytes; budget is 30720 bytes.`);
  const firstScene = project.scenes.find((scene) => scene.id === project.firstScene);
  const firstBuild = sceneBuilds.get(project.firstScene);
  assert(firstScene && firstBuild, "First-scene multires output is missing.");
  const firstLevelRoot = join(stagedRoot, firstBuild.relativeRoot, "1");
  const firstLevelTiles = (await readdir(firstLevelRoot)).filter((file) => file.endsWith(".webp")).sort().map((file) => `${firstBuild.relativeRoot}/1/${file}`);
  const fallbackFiles = faceLetters.map((face) => `${firstBuild.relativeRoot}/fallback/${face}.jpg`);
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
    preview: "assets/seo/preview.webp"
  };
  await mkdir(join(stagedRoot, "seo"), { recursive: true });
  await writeFile(join(stagedRoot, "seo", "tour.json"), `${JSON.stringify(seoDraft, null, 2)}\n`);
  return {
    preview: seoDraft.preview,
    previewBytes,
    poster: seoDraft.poster,
    posterWidth: seoDraft.posterWidth,
    posterHeight: seoDraft.posterHeight,
    seoDraft: "seo/tour.json",
    fallbackFiles,
    criticalFiles: ["js/tour-config.js", seoDraft.preview, ...firstLevelTiles]
  };
}

async function buildSceneMultires(scene, stagedRoot, temporaryRoot, options) {
  const source = join(stagedRoot, scene.panorama);
  const dimensions = await imageDimensions(source);
  assert(dimensions.width >= 1600 && Math.abs(dimensions.width / dimensions.height - 2) <= 0.02, `${scene.id} is not a full 2:1 equirectangular panorama.`);

  const cubeSize = cubeResolution(dimensions.width);
  const levels = maxLevel(cubeSize, options.tileSize);
  const contentHash = createHash("sha256").update(await readFile(source)).digest("hex").slice(0, 20);
  const relativeRoot = `assets/mr/${contentHash}`;
  const targetRoot = join(stagedRoot, relativeRoot);
  const stripPath = join(temporaryRoot, `${scene.id}-cube.png`);
  await mkdir(targetRoot, { recursive: true });
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", source,
    "-vf", `v360=input=equirect:output=c6x1:out_forder=fbudlr:interp=lanczos:w=${cubeSize * 6}:h=${cubeSize}`,
    "-frames:v", "1", stripPath
  ]);

  let tileCount = 0;
  for (const [faceIndex, face] of faceLetters.entries()) {
    const facePath = join(temporaryRoot, `${scene.id}-${face}.png`);
    await runMagick([stripPath, "-crop", `${cubeSize}x${cubeSize}+${faceIndex * cubeSize}+0`, "+repage", facePath]);
    await mkdir(join(targetRoot, "fallback"), { recursive: true });
    await runMagick([facePath, "-resize", `${options.fallbackSize}x${options.fallbackSize}!`, "-strip", "-interlace", "Plane", "-sampling-factor", "4:2:0", "-quality", String(options.jpegQuality), join(targetRoot, "fallback", `${face}.jpg`)]);

    for (let level = levels; level >= 1; level -= 1) {
      const size = Math.max(1, Math.floor(cubeSize / 2 ** (levels - level)));
      const levelPath = join(targetRoot, String(level));
      const levelFace = join(temporaryRoot, `${scene.id}-${face}-level-${level}.png`);
      await mkdir(levelPath, { recursive: true });
      if (level === levels) await cp(facePath, levelFace);
      else await runMagick([facePath, "-resize", `${size}x${size}!`, levelFace]);
      const tiles = Math.ceil(size / options.tileSize);
      for (let y = 0; y < tiles; y += 1) {
        for (let x = 0; x < tiles; x += 1) {
          const width = Math.min(options.tileSize, size - x * options.tileSize);
          const height = Math.min(options.tileSize, size - y * options.tileSize);
          const target = join(levelPath, `${face}${y}_${x}.webp`);
          await runMagick([levelFace, "-crop", `${width}x${height}+${x * options.tileSize}+${y * options.tileSize}`, "+repage", "-strip", "-quality", String(options.webpQuality), target]);
          tileCount += 1;
        }
      }
    }
  }

  const preview = await makePreview(source);
  return {
    relativeRoot,
    tileCount,
    config: {
      basePath: relativeRoot,
      path: "/%l/%s%y_%x",
      fallbackPath: "/fallback/%s",
      extension: "webp",
      fallbackExtension: "jpg",
      tileResolution: options.tileSize,
      maxLevel: levels,
      cubeResolution: cubeSize,
      equirectangularThumbnail: preview
    }
  };
}

async function digestDirectory(directory) {
  const digest = createHash("sha256");
  for (const file of (await walk(directory)).sort()) {
    const path = relative(directory, file).split("\\").join("/");
    if (path === "release-manifest.json") continue;
    digest.update(path);
    digest.update("\0");
    digest.update(await readFile(file));
    digest.update("\0");
  }
  return digest.digest("hex");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "raindigit-multires-"));
  const stagedRoot = join(temporaryRoot, "staged-release");
  const packageRoot = join(temporaryRoot, "package");
  const finalParent = dirname(options.output);
  try {
    await run(process.execPath, [
      join(projectRoot, "scripts", "build-tour-release.mjs"),
      "--workspace", options.workspace,
      "--output", stagedRoot,
      "--quality", String(options.jpegQuality),
      "--replace"
    ], { cwd: projectRoot, timeout: 20 * 60 * 1000 });

    const configPath = join(stagedRoot, "js", "tour-config.js");
    const pannellumPath = join(stagedRoot, "js", "pannellum.js");
    const pannellumSource = await readFile(pannellumPath, "utf8");
    const patchedPannellum = pannellumSource.replace(
      'H.replace("%s",Q[t])+"."+m.extension:m[t].src',
      'H.replace("%s",Q[t])+"."+(m.fallbackExtension||m.extension):m[t].src'
    );
    assert(patchedPannellum !== pannellumSource, "Pannellum fallback-extension compatibility patch did not apply.");
    await writeFile(pannellumPath, patchedPannellum, "utf8");
    const project = readTourConfig(await readFile(configPath, "utf8"));
    const firstSceneSource = join(stagedRoot, project.scenes.find((scene) => scene.id === project.firstScene)?.panorama || "");
    assert(await stat(firstSceneSource).catch(() => null), "First-scene panorama is missing before multires conversion.");
    const sceneIds = project.scenes.map((scene) => scene.id);
    const sceneBuilds = new Map();
    let tileCount = 0;
    for (const scene of project.scenes) {
      const generated = await buildSceneMultires(scene, stagedRoot, temporaryRoot, options);
      sceneBuilds.set(scene.id, generated);
      scene.type = "multires";
      scene.multiRes = generated.config;
      delete scene.panorama;
      tileCount += generated.tileCount;
    }
    await writeFile(configPath, `window.TOUR_CONFIG = ${JSON.stringify(project)};\n`, "utf8");
    const performance = await buildSeoAssets(firstSceneSource, stagedRoot, project, sceneBuilds);
    await rm(join(stagedRoot, "assets", "p"), { recursive: true, force: true });
    performance.criticalBytes = (await Promise.all(performance.criticalFiles.map(async (path) => (await stat(join(stagedRoot, path))).size))).reduce((sum, bytes) => sum + bytes, 0);
    performance.criticalBudgetBytes = 1024 * 1024;
    assert(performance.criticalBytes <= performance.criticalBudgetBytes, `First-scene critical payload is ${performance.criticalBytes} bytes; budget is ${performance.criticalBudgetBytes} bytes.`);
    const digest = await digestDirectory(stagedRoot);
    const version = `multires-${digest.slice(0, 12)}`;
    const immutablePrefix = `tours/${options.slug}/${version}/`;
    const payloadFiles = await fileInventory(stagedRoot);
    const payloadBytes = payloadFiles.reduce((sum, file) => sum + file.bytes, 0);
    const sceneViews = Object.fromEntries(project.scenes.map((scene) => [scene.id, {
      pitch: scene.pitch,
      yaw: scene.yaw,
      hfov: scene.hfov
    }]));
    const hotspotGraph = project.scenes.flatMap((scene) => scene.hotspots.map((hotspot) => ({
      source: scene.id,
      target: hotspot.target,
      kind: hotspot.kind,
      pitch: hotspot.pitch,
      yaw: hotspot.yaw,
      targetPitch: hotspot.targetPitch,
      targetYaw: hotspot.targetYaw,
      targetHfov: hotspot.targetHfov
    })));
    const manifest = {
      schema: "raindigit-tour-multires-release/v1",
      title: project.title,
      slug: options.slug,
      version,
      generatedAt: new Date().toISOString(),
      rollbackVersion: options.rollbackVersion,
      firstScene: project.firstScene,
      sceneIds,
      sceneViews,
      hotspotGraph,
      tileSize: options.tileSize,
      webpQuality: options.webpQuality,
      fallbackFormat: "jpeg",
      fallbackSize: options.fallbackSize,
      fileCount: payloadFiles.length,
      bytes: payloadBytes,
      files: payloadFiles,
      contentDigest: digest,
      immutablePrefix,
      entrypoint: `${immutablePrefix}index.html`,
      performance
    };
    await writeFile(join(stagedRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const immutableRoot = join(packageRoot, immutablePrefix);
    await mkdir(dirname(immutableRoot), { recursive: true });
    await rename(stagedRoot, immutableRoot);
    const pointer = {
      schema: "raindigit-tour-current/v1",
      slug: options.slug,
      version,
      previousVersion: options.rollbackVersion,
      prefix: immutablePrefix,
      entrypoint: manifest.entrypoint,
      releaseManifest: `${immutablePrefix}release-manifest.json`,
      contentDigest: digest,
      updatedAt: manifest.generatedAt
    };
    const pointerPath = join(packageRoot, "manifests", options.slug, "current.json");
    await mkdir(dirname(pointerPath), { recursive: true });
    await writeFile(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");

    if (!options.replace) {
      try {
        await stat(options.output);
        throw new Error(`Release directory already exists: ${options.output}. Use --replace.`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await rm(options.output, { recursive: true, force: true });
    await mkdir(finalParent, { recursive: true });
    await rename(packageRoot, options.output);
    if (options.zip) await createZip(options.output, options.zip);
    console.log(JSON.stringify({
      output: options.output,
      zip: options.zip,
      slug: options.slug,
      version,
      immutablePrefix,
      entrypoint: manifest.entrypoint,
      releaseManifest: `${immutablePrefix}release-manifest.json`,
      pointer: `manifests/${options.slug}/current.json`,
      rollbackVersion: options.rollbackVersion,
      scenes: project.scenes.length,
      hotspots: hotspotGraph.length,
      tiles: tileCount,
      files: payloadFiles.length,
      bytes: payloadBytes,
      contentDigest: digest
    }, null, 2));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
