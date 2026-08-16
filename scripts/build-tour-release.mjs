#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

function parseArguments(argv) {
  const options = {
    workspace: join(projectRoot, "studio-workspace"),
    output: join(projectRoot, "release"),
    zip: null,
    single: null,
    embed: null,
    cacheDir: null,
    quality: 86,
    preserveResolution: false,
    preserveSource: false,
    replace: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--workspace") options.workspace = resolve(argv[++index] || "");
    else if (argument === "--output") options.output = resolve(argv[++index] || "");
    else if (argument === "--zip") options.zip = resolve(argv[++index] || "");
    else if (argument === "--single") options.single = resolve(argv[++index] || "");
    else if (argument === "--embed") options.embed = resolve(argv[++index] || "");
    else if (argument === "--cache-dir") options.cacheDir = resolve(argv[++index] || "");
    else if (argument === "--quality") options.quality = Number(argv[++index]);
    else if (argument === "--preserve-resolution") options.preserveResolution = true;
    else if (argument === "--preserve-source") options.preserveSource = true;
    else if (argument === "--replace") options.replace = true;
    else if (argument === "--help") {
      console.log("Usage: node scripts/build-tour-release.mjs [--workspace path] [--output path] [--zip file.zip] [--single file.html] [--embed file.html] [--cache-dir path] [--quality 84..94] [--preserve-resolution] [--preserve-source] [--replace]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!Number.isInteger(options.quality) || options.quality < 84 || options.quality > 94) {
    throw new Error("JPEG quality must be an integer from 84 to 94.");
  }
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 1 >= buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

async function run(command, arguments_, options = {}) {
  try {
    return await execFileAsync(command, arguments_, { maxBuffer: 1024 * 1024, ...options });
  } catch (error) {
    throw new Error(`${command} failed: ${error.stderr || error.message}`);
  }
}

async function runMagick(arguments_) {
  for (const binary of ["magick", "convert"]) {
    try {
      return await execFileAsync(binary, arguments_, { maxBuffer: 1024 * 1024 });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`${binary} failed: ${error.stderr || error.message}`);
    }
  }
  throw new Error("ImageMagick is not installed (expected magick or convert).");
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

function isSceneId(value) {
  return typeof value === "string" && /^scene-\d{3,}$/i.test(value);
}

function normaliseProject(project) {
  assert(project?.schema === "raindigit-tour-project/v1", "Missing raindigit-tour-project/v1 manifest.");
  assert(typeof project.title === "string" && project.title.trim(), "Project title is required.");
  assert(Array.isArray(project.scenes) && project.scenes.length >= 1 && project.scenes.length <= 100, "A release needs from 1 to 100 scenes.");
  const ids = new Set();
  project.scenes.forEach((scene) => {
    assert(isSceneId(scene.id) && !ids.has(scene.id), `Invalid or duplicate scene id: ${scene.id}`);
    ids.add(scene.id);
    assert(typeof scene.title === "string" && scene.title.trim(), `Scene ${scene.id} needs a title.`);
    assert(typeof scene.panorama === "string" && /^panoramas\/scene-\d{3,}\.jpg$/i.test(scene.panorama), `Invalid panorama path for ${scene.id}.`);
    assert(typeof scene.thumb === "string" && /^thumbnails\/scene-\d{3,}\.jpg$/i.test(scene.thumb), `Invalid thumbnail path for ${scene.id}.`);
    assert(Array.isArray(scene.hotspots), `Scene ${scene.id} must define hotspots.`);
  });
  assert(ids.has(project.firstScene || project.scenes[0].id), "Initial scene must exist in the project.");
  const normalised = structuredClone(project);
  normalised.firstScene = normalised.scenes[0].id;
  const sceneIds = new Set(normalised.scenes.map((scene) => scene.id));
  const map = normalised.map;
  if (!map || map.enabled !== true || map.asset !== "floorplan/map.jpg") {
    normalised.map = { enabled: false, asset: null, pins: {} };
  } else {
    assert(map.pins && typeof map.pins === "object" && !Array.isArray(map.pins), "Floorplan pins must be an object.");
    normalised.map = {
      enabled: true,
      asset: "floorplan/map.jpg",
      pins: Object.fromEntries(Object.entries(map.pins)
        .filter(([sceneId, pin]) => sceneIds.has(sceneId) && Number.isFinite(pin?.x) && Number.isFinite(pin?.y))
        .map(([sceneId, pin]) => [sceneId, { x: clamp(pin.x, 0, 100, 50), y: clamp(pin.y, 0, 50) }]))
    };
  }
  return normalised;
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function applyDraft(project, draft) {
  if (!draft || draft.schema !== "raindigit-tour-hotspot-overrides/v1") return project;
  const byId = Object.fromEntries(project.scenes.map((scene) => [scene.id, scene]));
  Object.entries(draft.addedHotspots || {}).forEach(([sceneId, hotspots]) => {
    if (!byId[sceneId] || !Array.isArray(hotspots)) return;
    byId[sceneId].hotspots.push(...hotspots.filter((hotspot) => byId[hotspot?.target]).map((hotspot) => ({ ...hotspot })));
  });
  Object.entries(draft.overrides || {}).forEach(([key, override]) => {
    const [sceneId, indexValue] = key.split("::");
    const hotspot = byId[sceneId]?.hotspots[Number(indexValue)];
    if (!hotspot) return;
    hotspot.pitch = clamp(override.pitch, -85, 85, hotspot.pitch);
    hotspot.yaw = clamp(override.yaw, -180, 180, hotspot.yaw);
    hotspot.targetPitch = clamp(override.targetPitch, -85, 85, hotspot.targetPitch);
    hotspot.targetYaw = clamp(override.targetYaw, -180, 180, hotspot.targetYaw);
    hotspot.targetHfov = clamp(override.targetHfov, 58, 112, hotspot.targetHfov);
  });
  Object.entries(draft.sceneViews || {}).forEach(([sceneId, view]) => {
    if (!byId[sceneId]) return;
    byId[sceneId].pitch = clamp(view?.pitch, -85, 85, byId[sceneId].pitch);
    byId[sceneId].yaw = clamp(view?.yaw, -180, 180, byId[sceneId].yaw);
    byId[sceneId].hfov = clamp(view?.hfov, 58, 112, byId[sceneId].hfov);
  });
  project.scenes.forEach((scene) => {
    scene.hotspots.forEach((hotspot) => {
      const target = byId[hotspot.target];
      if (target) hotspot.label = `Go to ${target.title}`;
    });
  });
  return project;
}

function reachableSceneIds(project) {
  const sceneIds = new Set(project.scenes.map((scene) => scene.id));
  const firstSceneId = sceneIds.has(project.firstScene) ? project.firstScene : project.scenes[0]?.id;
  const reachable = new Set();
  const queue = firstSceneId ? [firstSceneId] : [];
  while (queue.length > 0) {
    const sceneId = queue.shift();
    if (reachable.has(sceneId)) continue;
    reachable.add(sceneId);
    const scene = project.scenes.find((candidate) => candidate.id === sceneId);
    for (const hotspot of scene?.hotspots || []) {
      if (sceneIds.has(hotspot.target) && !reachable.has(hotspot.target)) queue.push(hotspot.target);
    }
  }
  return reachable;
}

function pruneUnreachableScenes(project) {
  if (project.scenes.length <= 1) return [];
  const reachable = reachableSceneIds(project);
  const removed = project.scenes.filter((scene) => !reachable.has(scene.id));
  if (!removed.length) return [];
  const keptIds = new Set(project.scenes.filter((scene) => reachable.has(scene.id)).map((scene) => scene.id));
  project.scenes = project.scenes
    .filter((scene) => keptIds.has(scene.id))
    .map((scene) => ({
      ...scene,
      hotspots: scene.hotspots.filter((hotspot) => keptIds.has(hotspot.target))
    }));
  project.firstScene = project.scenes[0]?.id || null;
  const usedRooms = new Set(project.scenes.map((scene) => scene.space));
  const usedFloors = new Set(project.scenes.map((scene) => scene.floor));
  if (Array.isArray(project.rooms)) project.rooms = project.rooms.filter((room) => usedRooms.has(room.id));
  if (Array.isArray(project.floors)) project.floors = project.floors.filter((floor) => usedFloors.has(floor.id));
  if (project.map?.pins) {
    project.map.pins = Object.fromEntries(Object.entries(project.map.pins).filter(([sceneId]) => keptIds.has(sceneId)));
  }
  return removed;
}

function assertReleaseReady(project) {
  const sceneIds = new Set(project.scenes.map((scene) => scene.id));
  for (const source of project.scenes) {
    for (const hotspot of source.hotspots || []) {
      assert(hotspot.positionConfirmed !== false, `Place every transition point before publishing (${hotspot.label}).`);
      assert(hotspot.arrivalConfirmed !== false, `Save every arrival view before publishing (${hotspot.label}).`);
      assert(sceneIds.has(hotspot.target), `Transition destination does not exist: ${hotspot.target}.`);
    }
  }
}

function stripEditorMetadata(project) {
  project.scenes.forEach((scene) => {
    delete scene.plannedTargets;
    delete scene.titleAutoGenerated;
    scene.hotspots.forEach((hotspot) => {
      delete hotspot.positionConfirmed;
      delete hotspot.arrivalConfirmed;
    });
  });
}

function releaseDimensions(source, preserveResolution = false) {
  if (preserveResolution) return { width: source.width, height: source.height };
  let width = source.width;
  while (width > 8192) width = Math.floor(width / 2);
  if (width % 2 !== 0) width -= 1;
  return { width, height: Math.round(width / 2) };
}

function imageCommands(input, output, adjustment, quality, dimensions) {
  const brightness = clamp(adjustment?.brightness, 70, 130, 100) - 100;
  const contrast = clamp(adjustment?.contrast, 70, 130, 100) - 100;
  const saturation = clamp(adjustment?.saturation, 0, 160, 100);
  const warmth = clamp(adjustment?.warmth, -20, 20, 0);
  const commands = [
    "-define", `jpeg:size=${dimensions.width}x${dimensions.height}`,
    input,
    "-auto-orient",
    "-resize", `${dimensions.width}x${dimensions.height}>`,
    "-strip",
    "-brightness-contrast", `${brightness}x${contrast}`,
    "-modulate", `100,${saturation},100`
  ];
  if (warmth !== 0) {
    commands.push("-fill", warmth > 0 ? "#e5ad62" : "#6ea6dd", "-colorize", `${Math.abs(warmth) * 1.1}%`);
  }
  commands.push("-interlace", "Plane", "-sampling-factor", "4:2:0", "-quality", String(quality), output);
  return commands;
}

function localOverlaySvg(area, image) {
  const width = clamp(area.width, 80, 720, 240) * image.width / 1000;
  const height = clamp(area.height, 80, 520, 180) * image.height / 600;
  const yaw = clamp(area.yaw, -180, 180, 0);
  const pitch = clamp(area.pitch, -85, 85, 0);
  const centerX = (yaw + 180) / 360 * image.width;
  const centerY = (90 - pitch) / 180 * image.height;
  const opacity = Math.min(0.72, Math.abs(clamp(area.intensity, -100, 100, 30)) / 100 * 0.72);
  const color = typeof area.color === "string" && /^#[0-9a-f]{6}$/i.test(area.color) ? area.color : "#fff1b8";
  const blur = Math.max(8, Math.min(width, height) * 0.22);
  const shape = area.shape === "rectangle"
    ? `<rect x="${centerX - width / 2}" y="${centerY - height / 2}" width="${width}" height="${height}" rx="${Math.min(width, height) * 0.07}" />`
    : `<ellipse cx="${centerX}" cy="${centerY}" rx="${width / 2}" ry="${height / 2}" />`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}"><defs><filter id="fade" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${blur}" /></filter></defs><g fill="${color}" fill-opacity="${opacity}" filter="url(#fade)">${shape}</g></svg>`;
}

async function applyLocalAreas(input, output, areas, image, temporaryRoot) {
  let current = input;
  for (const [index, area] of areas.entries()) {
    const overlayPath = join(temporaryRoot, `area-${index}.svg`);
    const nextPath = join(temporaryRoot, `area-${index}.jpg`);
    await writeFile(overlayPath, localOverlaySvg(area, image), "utf8");
    const compose = clamp(area.intensity, -100, 100, 30) >= 0 ? "screen" : "multiply";
    await runMagick([current, overlayPath, "-compose", compose, "-composite", nextPath]);
    current = nextPath;
  }
  await rename(current, output);
}

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function sceneDerivativeCacheKey(sourceHash, adjustment, areas, quality, dimensions, preserveResolution, preserveSource) {
  return createHash("sha256").update(JSON.stringify({
    schema: "raindigit-release-scene-cache/v1",
    sourceHash,
    adjustment: adjustment || null,
    areas,
    quality,
    dimensions,
    preserveResolution,
    preserveSource
  })).digest("hex");
}

async function restoreSceneDerivative(cacheDir, cacheKey, output) {
  if (!cacheDir) return null;
  const entry = join(cacheDir, "release-scenes-v1", cacheKey);
  try {
    const metadata = JSON.parse(await readFile(join(entry, "metadata.json"), "utf8"));
    assert(metadata.schema === "raindigit-release-scene-cache/v1" && metadata.key === cacheKey, "Scene cache metadata is invalid.");
    const panoramaSource = join(entry, "panorama.jpg");
    const thumbnailSource = join(entry, "thumbnail.jpg");
    const [panoramaStat, thumbnailStat] = await Promise.all([stat(panoramaSource), stat(thumbnailSource)]);
    assert(panoramaStat.size === metadata.panoramaBytes && thumbnailStat.size === metadata.thumbnailBytes, "Scene cache file size does not match metadata.");
    const panoramaOutput = join(output, metadata.panorama);
    const thumbnailOutput = join(output, metadata.thumb);
    await Promise.all([mkdir(dirname(panoramaOutput), { recursive: true }), mkdir(dirname(thumbnailOutput), { recursive: true })]);
    await Promise.all([copyFile(panoramaSource, panoramaOutput), copyFile(thumbnailSource, thumbnailOutput)]);
    const accessedAt = new Date();
    await utimes(join(entry, "metadata.json"), accessedAt, accessedAt);
    return { panorama: metadata.panorama, thumb: metadata.thumb, bytes: panoramaStat.size + thumbnailStat.size, cacheHit: true };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    await rm(entry, { recursive: true, force: true });
    return null;
  }
}

async function storeSceneDerivative(cacheDir, cacheKey, panoramaPath, thumbnailPath, result) {
  if (!cacheDir) return;
  const parent = join(cacheDir, "release-scenes-v1");
  const entry = join(parent, cacheKey);
  const temporary = join(parent, `.${cacheKey}.${process.pid}.${Date.now()}.tmp`);
  const [panoramaStat, thumbnailStat] = await Promise.all([stat(panoramaPath), stat(thumbnailPath)]);
  await mkdir(parent, { recursive: true });
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  try {
    await Promise.all([
      copyFile(panoramaPath, join(temporary, "panorama.jpg")),
      copyFile(thumbnailPath, join(temporary, "thumbnail.jpg"))
    ]);
    await writeFile(join(temporary, "metadata.json"), `${JSON.stringify({
      schema: "raindigit-release-scene-cache/v1",
      key: cacheKey,
      panorama: result.panorama,
      thumb: result.thumb,
      panoramaBytes: panoramaStat.size,
      thumbnailBytes: thumbnailStat.size,
      createdAt: new Date().toISOString()
    }, null, 2)}\n`, "utf8");
    await rename(temporary, entry).catch(async (error) => {
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
      await rm(temporary, { recursive: true, force: true });
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function isNeutralAdjustment(adjustment) {
  return !adjustment || (
    clamp(adjustment.brightness, 70, 130, 100) === 100 &&
    clamp(adjustment.contrast, 70, 130, 100) === 100 &&
    clamp(adjustment.saturation, 0, 160, 100) === 100 &&
    clamp(adjustment.warmth, -20, 20, 0) === 0
  );
}

async function buildScene(scene, workspace, output, draft, temporaryRoot, quality, preserveResolution, preserveSource, cacheDir) {
  const input = join(workspace, scene.panorama);
  const source = await readFile(input);
  const dimensions = jpegDimensions(source);
  assert(dimensions && dimensions.width >= 1600 && Math.abs(dimensions.width / dimensions.height - 2) <= 0.02, `${scene.id} is not a valid 2:1 JPEG panorama.`);
  const outputDimensions = releaseDimensions(dimensions, preserveResolution);
  const areas = Array.isArray(draft.localAdjustments?.[scene.id]) ? draft.localAdjustments[scene.id] : [];
  const adjustment = draft.sceneAdjustments?.[scene.id] || null;
  const sourceHash = createHash("sha256").update(source).digest("hex");
  const cacheKey = sceneDerivativeCacheKey(sourceHash, adjustment, areas, quality, outputDimensions, preserveResolution, preserveSource);
  const cached = await restoreSceneDerivative(cacheDir, cacheKey, output);
  if (cached) return cached;
  const finishedImage = join(temporaryRoot, `${scene.id}-finished.jpg`);
  if (preserveSource) {
    assert(preserveResolution, "--preserve-source requires --preserve-resolution.");
    assert(isNeutralAdjustment(draft.sceneAdjustments?.[scene.id]) && areas.length === 0, `${scene.id} has image adjustments and cannot use --preserve-source.`);
    await copyFile(input, finishedImage);
  } else {
    const workImage = join(temporaryRoot, `${scene.id}-base.jpg`);
    await runMagick(imageCommands(input, workImage, adjustment, quality, outputDimensions));
    if (areas.length > 0) await applyLocalAreas(workImage, finishedImage, areas, outputDimensions, temporaryRoot);
    else await rename(workImage, finishedImage);
  }
  const panoramaHash = await hashFile(finishedImage);
  const panoramaRelative = `assets/p/${panoramaHash.slice(0, 20)}.jpg`;
  const panoramaOutput = join(output, panoramaRelative);
  await mkdir(dirname(panoramaOutput), { recursive: true });
  await rename(finishedImage, panoramaOutput);
  const thumbnailWork = join(temporaryRoot, `${scene.id}-thumb.jpg`);
  await runMagick([panoramaOutput, "-thumbnail", "480x240^", "-gravity", "center", "-extent", "480x240", "-strip", "-interlace", "Plane", "-sampling-factor", "4:2:0", "-quality", "82", thumbnailWork]);
  const thumbnailHash = await hashFile(thumbnailWork);
  const thumbnailRelative = `assets/t/${thumbnailHash.slice(0, 20)}.jpg`;
  const thumbnailOutput = join(output, thumbnailRelative);
  await mkdir(dirname(thumbnailOutput), { recursive: true });
  await rename(thumbnailWork, thumbnailOutput);
  const result = { panorama: panoramaRelative, thumb: thumbnailRelative, bytes: (await stat(panoramaOutput)).size + (await stat(thumbnailOutput)).size, cacheHit: false };
  await storeSceneDerivative(cacheDir, cacheKey, panoramaOutput, thumbnailOutput, result);
  return result;
}

async function buildFloorplan(project, workspace, output, temporaryRoot) {
  if (project.map?.enabled !== true || project.map.asset !== "floorplan/map.jpg") return 0;
  const input = join(workspace, project.map.asset);
  const source = await readFile(input);
  assert(source.length > 0, "Floorplan image is empty.");
  const work = join(temporaryRoot, "floorplan.jpg");
  await runMagick([input, "-auto-orient", "-resize", "1600x1600>", "-strip", "-interlace", "Plane", "-sampling-factor", "4:2:0", "-quality", "88", work]);
  const hash = await hashFile(work);
  const relative = `assets/m/${hash.slice(0, 20)}.jpg`;
  const target = join(output, relative);
  await mkdir(dirname(target), { recursive: true });
  await rename(work, target);
  project.map.asset = relative;
  return (await stat(target)).size;
}

async function copyRuntime(output) {
  const source = join(projectRoot, "web-tour");
  await cp(join(source, "index.html"), join(output, "index.html"));
  await cp(join(source, "css"), join(output, "css"), { recursive: true });
  await mkdir(join(output, "js"), { recursive: true });
  await cp(join(source, "js", "pannellum.js"), join(output, "js", "pannellum.js"));
  await cp(join(source, "js", "tour-bootstrap-release.js"), join(output, "js", "tour-bootstrap.js"));
  const studioRuntime = await readFile(join(source, "js", "tour.js"), "utf8");
  const stripStart = "/* RELEASE_STRIP_START: local editor bridge */";
  const stripEnd = "/* RELEASE_STRIP_END: local editor bridge */";
  const stripStartIndex = studioRuntime.indexOf(stripStart);
  const stripEndIndex = studioRuntime.indexOf(stripEnd);
  assert(stripStartIndex >= 0 && stripEndIndex > stripStartIndex, "Release strip markers are missing or out of order.");
  const runtimeWithoutEditorBridge = `${studioRuntime.slice(0, stripStartIndex)}${studioRuntime.slice(stripEndIndex + stripEnd.length)}`;
  const releaseRuntime = runtimeWithoutEditorBridge
    .replace(/const isLocalEditorRequest = viewParams\.get\("edit"\) === "1"[\s\S]*?const localEditorDefaultHfov = 94;/, "const isLocalEditorRequest = false;\nconst isLocalDraftPreview = false;\nconst localEditorDefaultHfov = 94;")
    .replace(/if \(isLocal(?:EditorRequest \|\| isLocal)?DraftPreview\) setNavigatorOpen\(true\);/, "setNavigatorOpen(false);");
  assert(releaseRuntime.includes("const isLocalEditorRequest = false;") && releaseRuntime.includes("const isLocalDraftPreview = false;"), "Release runtime must define disabled local-editor flags.");
  assert(!/tour-editor|tour-preview|__TOUR_EDITOR|__TOUR_DRAFT_PREVIEW/.test(releaseRuntime), "Release runtime still references local studio code.");
  await writeFile(join(output, "js", "tour.js"), releaseRuntime, "utf8");
  await cp(join(source, "assets"), join(output, "assets"), { recursive: true });
  await writeFile(join(output, "robots.txt"), "User-agent: *\nDisallow: /\n", "utf8");
  await writeFile(join(output, "INSTALL.txt"), [
    "RainDigit 360 Tour - installation",
    "",
    "1. Upload every file and folder from this archive to one public directory.",
    "2. Open that directory URL to verify the tour.",
    "3. Embed it on another page with:",
    '<iframe src="https://example.com/tour/" title="360 virtual tour" allow="fullscreen" allowfullscreen loading="lazy" style="width:100%;aspect-ratio:16/9;border:0"></iframe>',
    "",
    "Keep the archive structure unchanged. The exported package contains no editor or local draft data."
  ].join("\n"), "utf8");
}

async function createZip(output, zipPath) {
  await mkdir(dirname(zipPath), { recursive: true });
  await rm(zipPath, { force: true });
  await run("zip", ["-X", "-r", zipPath, "."], { cwd: output });
}

function inlineScript(value) {
  return value.replace(/<\/script/gi, "<\\/script");
}

function minifyCss(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>+~])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

function compactHtml(value) {
  return value
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

async function dataUrl(path, mimeType) {
  return `data:${mimeType};base64,${(await readFile(path)).toString("base64")}`;
}

async function createSingleHtml(output, project, singlePath) {
  const singleProject = structuredClone(project);
  for (const scene of singleProject.scenes) {
    scene.panorama = await dataUrl(join(output, scene.panorama), "image/jpeg");
    scene.thumb = await dataUrl(join(output, scene.thumb), "image/jpeg");
  }
  if (singleProject.map?.enabled === true && singleProject.map.asset) {
    singleProject.map.asset = await dataUrl(join(output, singleProject.map.asset), "image/jpeg");
  }
  const [template, pannellumCss, tourCss, pannellumJs, tourJs, logo] = await Promise.all([
    readFile(join(output, "index.html"), "utf8"),
    readFile(join(output, "css", "pannellum.css"), "utf8"),
    readFile(join(output, "css", "tour.css"), "utf8"),
    readFile(join(output, "js", "pannellum.js"), "utf8"),
    readFile(join(output, "js", "tour.js"), "utf8"),
    dataUrl(join(output, "assets", "raindigit-mark.svg"), "image/svg+xml")
  ]);
  const configJs = `window.TOUR_CONFIG = ${JSON.stringify(singleProject)};`;
  const runtimeDataUrl = `data:text/javascript;base64,${Buffer.from(`${configJs}\n${pannellumJs}\n${tourJs}`, "utf8").toString("base64")}`;
  const html = compactHtml(template
    .replace(/<link rel="stylesheet" href="css\/pannellum\.css[^"]*" \/>/, `<style>${minifyCss(pannellumCss)}</style>`)
    .replace(/<link rel="stylesheet" href="css\/tour\.css[^"]*" \/>/, `<style>${minifyCss(tourCss)}</style>`)
    .replace('src="assets/raindigit-mark.svg"', `src="${logo}"`)
    .replace(/<script(?: defer)? src="js\/tour-bootstrap\.js[^"]*"><\/script>/, `<script src="${runtimeDataUrl}"></script>`));
  assert(!/\n/.test(html), "Single-file release must stay on one line.");
  assert(!/<(?:link|script)[^>]+(?:href|src)="(?!data:|https?:|#)/i.test(html), "Single-file release still has a local runtime dependency.");
  await mkdir(dirname(singlePath), { recursive: true });
  await rm(singlePath, { force: true });
  await writeFile(singlePath, html, "utf8");
  return html;
}

async function createEmbedHtml(singleHtml, embedPath) {
  const id = `raindigit-tour-${createHash("sha256").update(singleHtml).digest("hex").slice(0, 12)}`;
  const srcdoc = JSON.stringify(singleHtml);
  const shellStyle = "width:100%;aspect-ratio:16/9;min-height:360px;background:#10110e;color:#f7f2df;display:grid;place-items:center;overflow:hidden;border:0;position:relative";
  const loaderStyle = "font:600 14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#d6af5c";
  const script = `(()=>{const r=document.getElementById(${JSON.stringify(id)}),h=${srcdoc};if(!r)return;let f=null;const base=r.getAttribute("style")||"",o={html:document.documentElement.style.overflow,body:document.body.style.overflow};const n=a=>f?.contentWindow?.postMessage({type:"raindigit-tour-fullscreen-state",active:a},"*");const c=()=>{r.setAttribute("data-fullscreen","0");r.setAttribute("style",base);document.documentElement.style.overflow=o.html;document.body.style.overflow=o.body;n(false)};const e=()=>{r.setAttribute("data-fullscreen","1");r.setAttribute("style",base+";position:fixed;inset:0;width:100dvw;height:100dvh;min-height:0;aspect-ratio:auto;z-index:2147483646;border-radius:0");document.documentElement.style.overflow="hidden";document.body.style.overflow="hidden";n(true)};addEventListener("keydown",a=>{if(a.key==="Escape")c()});addEventListener("message",a=>{if(a.data?.type==="raindigit-tour-fullscreen-fallback"&&f&&a.source===f.contentWindow)(a.data.action==="exit"?c:e)()});const s=()=>{f=document.createElement("iframe");f.title="RainDigit 360 tour";f.loading="lazy";f.allow="fullscreen";f.allowFullscreen=true;f.setAttribute("allowfullscreen","");f.setAttribute("webkitallowfullscreen","");f.setAttribute("mozallowfullscreen","");f.style.cssText="display:block;width:100%;height:100%;border:0;background:#10110e";f.onload=()=>r.setAttribute("data-loaded","1");r.textContent="";r.appendChild(f);f.srcdoc=h};const q=()=>("requestIdleCallback"in window?requestIdleCallback(s,{timeout:1500}):setTimeout(s,1));document.readyState==="complete"?q():addEventListener("load",q,{once:true})})();`;
  const html = `<div id="${id}" data-raindigit-tour="1" style="${shellStyle}"><div style="${loaderStyle}">Loading 360 tour...</div></div><script>${inlineScript(script)}</script>`;
  assert(!/\n/.test(html), "Paste-in embed code must stay on one line.");
  assert(!/<(?:link|script)[^>]+(?:href|src)="(?!data:|https?:|#)/i.test(html), "Paste-in embed still has a local runtime dependency.");
  await mkdir(dirname(embedPath), { recursive: true });
  await rm(embedPath, { force: true });
  await writeFile(embedPath, html, "utf8");
  return html;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const workspace = options.workspace;
  const draft = await readJson(join(workspace, "draft.json"), null);
  const project = applyDraft(normaliseProject(await readJson(join(workspace, "tour-project.json"))), draft);
  const prunedScenes = pruneUnreachableScenes(project);
  assertReleaseReady(project);
  stripEditorMetadata(project);
  if (existsSync(options.output)) {
    if (!options.replace) throw new Error(`Release directory already exists: ${options.output}. Use --replace to regenerate it.`);
    await rm(options.output, { recursive: true, force: true });
  }
  await mkdir(options.output, { recursive: true });
  const temporaryRoot = join(options.output, ".build-tmp");
  await mkdir(temporaryRoot, { recursive: true });
  try {
    await copyRuntime(options.output);
    let totalBytes = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    for (const scene of project.scenes) {
      const result = await buildScene(scene, workspace, options.output, draft || {}, temporaryRoot, options.quality, options.preserveResolution, options.preserveSource, options.cacheDir);
      scene.panorama = result.panorama;
      scene.thumb = result.thumb;
      delete scene.sourceHash;
      totalBytes += result.bytes;
      if (result.cacheHit) cacheHits += 1;
      else cacheMisses += 1;
    }
    totalBytes += await buildFloorplan(project, workspace, options.output, temporaryRoot);
    await writeFile(join(options.output, "js", "tour-config.js"), `window.TOUR_CONFIG = ${JSON.stringify(project)};\n`, "utf8");
    await rm(temporaryRoot, { recursive: true, force: true });
    if (options.zip) await createZip(options.output, options.zip);
    let singleHtml = null;
    if (options.single || options.embed) {
      const singleTarget = options.single || join(options.output, "raindigit-360-tour.html");
      singleHtml = await createSingleHtml(options.output, project, singleTarget);
    }
    if (options.embed) await createEmbedHtml(singleHtml, options.embed);
    console.log(JSON.stringify({ output: options.output, zip: options.zip, single: options.single, embed: options.embed, scenes: project.scenes.length, prunedScenes: prunedScenes.map((scene) => ({ id: scene.id, title: scene.title })), mediaBytes: totalBytes, quality: options.quality, preserveResolution: options.preserveResolution, preserveSource: options.preserveSource, cache: { enabled: Boolean(options.cacheDir), hits: cacheHits, misses: cacheMisses } }, null, 2));
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
