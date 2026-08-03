#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const webRoot = join(projectRoot, "web-tour");
const defaultDraftPath = join(projectRoot, "qa", "manual-hotspot-overrides.json");
const defaultWorkspaceRoot = join(projectRoot, "studio-workspace");
const draftPath = process.env.INSTA360_TOUR_DRAFT_PATH ? resolve(process.env.INSTA360_TOUR_DRAFT_PATH) : defaultDraftPath;
const workspaceRoot = process.env.INSTA360_TOUR_WORKSPACE ? resolve(process.env.INSTA360_TOUR_WORKSPACE) : defaultWorkspaceRoot;
const workspaceProjectPath = join(workspaceRoot, "tour-project.json");
const workspaceDraftPath = join(workspaceRoot, "draft.json");
const studioLogPath = join(workspaceRoot, "studio-debug.ndjson");
const artifactRoot = process.env.INSTA360_TOUR_ARTIFACTS ? resolve(process.env.INSTA360_TOUR_ARTIFACTS) : join(projectRoot, "dist");
const releaseRoot = process.env.INSTA360_TOUR_RELEASE ? resolve(process.env.INSTA360_TOUR_RELEASE) : join(projectRoot, "release");
const releaseZipPath = join(artifactRoot, "raindigit-360-tour.zip");
const releaseSinglePath = join(artifactRoot, "raindigit-360-tour.html");
const releaseEmbedPath = join(artifactRoot, "raindigit-360-tour-embed.html");
const projectBackupPath = join(artifactRoot, "raindigit-tour-project.rdtour");
const host = process.env.TOUR_SERVER_HOST || "127.0.0.1";
const previewMode = process.argv.includes("--preview");
const portArgument = process.argv.indexOf("--port");
const port = portArgument >= 0 ? Number(process.argv[portArgument + 1]) : previewMode ? 8768 : 8767;
const endpoint = previewMode ? "/__tour-preview" : "/__tour-editor";
const previewEndpoint = "/__tour-preview";
// X4 DNG files are commonly about 140 MB. The raw source is processed locally,
// then discarded from the workspace; only the derived panorama is retained.
const maxUploadBytes = 256 * 1024 * 1024;
const maxFloorplanBytes = 15 * 1024 * 1024;
const maxProjectBytes = 512 * 1024 * 1024;
const maxStudioLogBytes = 5 * 1024 * 1024;

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Use a valid local port between 1024 and 65535.");
}

if (!["127.0.0.1", "0.0.0.0"].includes(host)) {
  throw new Error("TOUR_SERVER_HOST must be 127.0.0.1 or 0.0.0.0.");
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".rdtour": "application/zip",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".zip": "application/zip"
};

function responseHeaders(contentType, cacheControl = "no-store") {
  return {
    "content-type": contentType,
    "cache-control": cacheControl,
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noimageindex"
  };
}

function replyJson(response, statusCode, body) {
  response.writeHead(statusCode, responseHeaders("application/json; charset=utf-8"));
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function emptyDraft() {
  return { schema: "raindigit-tour-hotspot-overrides/v1", overrides: {}, sceneAdjustments: {}, placementGuides: {} };
}

function emptyWorkspaceProject(title = "Untitled 3D Tour") {
  return {
    schema: "raindigit-tour-project/v1",
    title,
    firstScene: null,
    rooms: [],
    scenes: []
  };
}

function isValidFloorplanMap(value, sceneIds = new Set()) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.enabled !== "boolean") return false;
  if (value.asset !== undefined && value.asset !== null && value.asset !== "floorplan/map.jpg") return false;
  if (value.enabled && value.asset !== "floorplan/map.jpg") return false;
  if (value.pins !== undefined && (!value.pins || typeof value.pins !== "object" || Array.isArray(value.pins))) return false;
  return Object.entries(value.pins || {}).every(([sceneId, pin]) =>
    /^scene-\d{3,}$/i.test(sceneId) && (sceneIds.size === 0 || sceneIds.has(sceneId)) && pin && typeof pin === "object" && !Array.isArray(pin) &&
    Number.isFinite(pin.x) && pin.x >= 0 && pin.x <= 100 && Number.isFinite(pin.y) && pin.y >= 0 && pin.y <= 100
  );
}

function isWorkspaceRequest(url) {
  return url.searchParams.get("workspace") === "1";
}

function activeDraftPath(url) {
  return isWorkspaceRequest(url) ? workspaceDraftPath : draftPath;
}

function isValidSceneAdjustment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ranges = {
    brightness: [70, 130],
    contrast: [70, 130],
    saturation: [0, 160],
    warmth: [-20, 20]
  };
  return Object.entries(value).every(([key, adjustment]) => {
    const range = ranges[key];
    return Boolean(range) && Number.isFinite(adjustment) && adjustment >= range[0] && adjustment <= range[1];
  });
}

function isValidPlacementGuides(value) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([roomId, guide]) =>
    /^[a-z0-9-]{1,60}$/i.test(roomId) && guide && typeof guide === "object" && !Array.isArray(guide) &&
    Number.isFinite(guide.defaultPitch) && guide.defaultPitch >= -85 && guide.defaultPitch <= 85 &&
    (guide.snapEnabled === undefined || typeof guide.snapEnabled === "boolean") &&
    (guide.snapToleranceDeg === undefined || (Number.isFinite(guide.snapToleranceDeg) && guide.snapToleranceDeg >= 0.5 && guide.snapToleranceDeg <= 12))
  );
}

function isValidSceneMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return typeof value.title === "string" && value.title.trim().length >= 1 && value.title.length <= 80 &&
    typeof value.subtitle === "string" && value.subtitle.length <= 120;
}

function isValidSceneView(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Number.isFinite(value.pitch) && value.pitch >= -85 && value.pitch <= 85 &&
    Number.isFinite(value.yaw) && value.yaw >= -180 && value.yaw <= 180 &&
    Number.isFinite(value.hfov) && value.hfov >= 58 && value.hfov <= 112;
}

function isValidLocalAdjustment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return typeof value.id === "string" && /^[a-z0-9-]{1,40}$/i.test(value.id) &&
    ["ellipse", "rectangle"].includes(value.shape) &&
    Number.isFinite(value.pitch) && value.pitch >= -85 && value.pitch <= 85 &&
    Number.isFinite(value.yaw) && value.yaw >= -180 && value.yaw <= 180 &&
    Number.isFinite(value.width) && value.width >= 80 && value.width <= 720 &&
    Number.isFinite(value.height) && value.height >= 80 && value.height <= 520 &&
    Number.isFinite(value.intensity) && value.intensity >= -100 && value.intensity <= 100 &&
    typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color);
}

function isValidAddedHotspot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return ["doorway", "viewpoint"].includes(value.kind) &&
    Number.isFinite(value.pitch) && value.pitch >= -85 && value.pitch <= 85 &&
    Number.isFinite(value.yaw) && value.yaw >= -180 && value.yaw <= 180 &&
    typeof value.target === "string" && /^scene-[a-z0-9-]+$/i.test(value.target) &&
    typeof value.label === "string" && value.label.trim().length >= 1 && value.label.length <= 80 &&
    Number.isFinite(value.targetPitch) && value.targetPitch >= -85 && value.targetPitch <= 85 &&
    Number.isFinite(value.targetYaw) && value.targetYaw >= -180 && value.targetYaw <= 180 &&
    Number.isFinite(value.targetHfov) && value.targetHfov >= 58 && value.targetHfov <= 112 &&
    (value.positionConfirmed === undefined || typeof value.positionConfirmed === "boolean") &&
    (value.arrivalConfirmed === undefined || typeof value.arrivalConfirmed === "boolean");
}

function validateDraft(value) {
  if (!value || value.schema !== "raindigit-tour-hotspot-overrides/v1" || typeof value.overrides !== "object" || Array.isArray(value.overrides)) {
    return false;
  }
  const validCoordinates = Object.entries(value.overrides).every(([key, coordinate]) => {
    const validArrival = (coordinate.targetPitch === undefined && coordinate.targetYaw === undefined && coordinate.targetHfov === undefined) || (
      Number.isFinite(coordinate.targetPitch) && coordinate.targetPitch >= -85 && coordinate.targetPitch <= 85 &&
      Number.isFinite(coordinate.targetYaw) && coordinate.targetYaw >= -180 && coordinate.targetYaw <= 180 &&
      Number.isFinite(coordinate.targetHfov) && coordinate.targetHfov >= 58 && coordinate.targetHfov <= 112
    );
    return /^scene-[a-z0-9-]+::\d+$/i.test(key) &&
      Number.isFinite(coordinate?.pitch) && coordinate.pitch >= -90 && coordinate.pitch <= 90 &&
      Number.isFinite(coordinate?.yaw) && coordinate.yaw >= -180 && coordinate.yaw <= 180 && validArrival;
  });
  const validAdjustments = value.sceneAdjustments === undefined || (
    typeof value.sceneAdjustments === "object" && !Array.isArray(value.sceneAdjustments) &&
    Object.entries(value.sceneAdjustments).every(([sceneId, adjustment]) => /^scene-[a-z0-9-]+$/i.test(sceneId) && isValidSceneAdjustment(adjustment))
  );
  const validMetadata = value.sceneMetadata === undefined || (
    typeof value.sceneMetadata === "object" && !Array.isArray(value.sceneMetadata) &&
    Object.entries(value.sceneMetadata).every(([sceneId, metadata]) => /^scene-[a-z0-9-]+$/i.test(sceneId) && isValidSceneMetadata(metadata))
  );
  const validSceneViews = value.sceneViews === undefined || (
    typeof value.sceneViews === "object" && !Array.isArray(value.sceneViews) &&
    Object.entries(value.sceneViews).every(([sceneId, view]) => /^scene-[a-z0-9-]+$/i.test(sceneId) && isValidSceneView(view))
  );
  const validLocalAdjustments = value.localAdjustments === undefined || (
    typeof value.localAdjustments === "object" && !Array.isArray(value.localAdjustments) &&
    Object.entries(value.localAdjustments).every(([sceneId, adjustments]) => /^scene-[a-z0-9-]+$/i.test(sceneId) && Array.isArray(adjustments) && adjustments.length <= 30 && adjustments.every(isValidLocalAdjustment))
  );
  const validAddedHotspots = value.addedHotspots === undefined || (
    typeof value.addedHotspots === "object" && !Array.isArray(value.addedHotspots) &&
    Object.entries(value.addedHotspots).every(([sceneId, hotspots]) => /^scene-[a-z0-9-]+$/i.test(sceneId) && Array.isArray(hotspots) && hotspots.length <= 60 && hotspots.every(isValidAddedHotspot))
  );
  const validUiState = value.uiState === undefined || (
    value.uiState && typeof value.uiState === "object" && !Array.isArray(value.uiState) &&
    ["upload", "rooms", "light", "links", "arrival", "export"].includes(value.uiState.stage) &&
    (value.uiState.linkStep === undefined || ["choose", "place", "review"].includes(value.uiState.linkStep)) &&
    (value.uiState.lookSceneIndex === undefined || Number.isInteger(value.uiState.lookSceneIndex)) &&
    (
      value.uiState.selected === undefined || value.uiState.selected === null || (
        value.uiState.selected && typeof value.uiState.selected === "object" && !Array.isArray(value.uiState.selected) &&
        /^scene-[a-z0-9-]+$/i.test(value.uiState.selected.sceneId) &&
        Number.isInteger(value.uiState.selected.hotspotIndex) &&
        value.uiState.selected.hotspotIndex >= 0
      )
    )
  );
  return validCoordinates && validAdjustments && validMetadata && validSceneViews && validLocalAdjustments && validAddedHotspots && isValidPlacementGuides(value.placementGuides) && validUiState;
}

function validateWorkspaceProject(value) {
  if (!value || value.schema !== "raindigit-tour-project/v1" || typeof value.title !== "string" || !Array.isArray(value.scenes)) return false;
  if (value.rooms !== undefined) {
    if (!Array.isArray(value.rooms) || value.rooms.length > 100) return false;
    const roomIds = new Set();
    if (!value.rooms.every((room) => room && typeof room.id === "string" && /^[a-z0-9-]{1,60}$/i.test(room.id) && !roomIds.has(room.id) && roomIds.add(room.id) && typeof room.label === "string" && room.label.trim().length >= 1 && room.label.length <= 80)) return false;
  }
  const ids = new Set();
  const validScenes = value.title.trim().length >= 1 && value.title.length <= 100 && value.scenes.length <= 100 && value.scenes.every((scene) => {
    if (!scene || typeof scene !== "object" || !/^scene-\d{3,}$/i.test(scene.id) || ids.has(scene.id)) return false;
    ids.add(scene.id);
    const validPlannedTargets = scene.plannedTargets === undefined || (
      Array.isArray(scene.plannedTargets) && scene.plannedTargets.length <= 99 &&
      new Set(scene.plannedTargets).size === scene.plannedTargets.length &&
      scene.plannedTargets.every((target) => typeof target === "string" && /^scene-\d{3,}$/i.test(target) && target !== scene.id)
    );
    return validPlannedTargets && typeof scene.title === "string" && scene.title.trim().length >= 1 && scene.title.length <= 80 &&
      typeof scene.subtitle === "string" && scene.subtitle.length <= 120 &&
      typeof scene.space === "string" && /^[a-z0-9-]{1,60}$/i.test(scene.space) &&
      typeof scene.spaceLabel === "string" && scene.spaceLabel.trim().length >= 1 && scene.spaceLabel.length <= 80 &&
      typeof scene.panorama === "string" && /^panoramas\/scene-\d{3,}\.jpg$/i.test(scene.panorama) &&
      typeof scene.thumb === "string" && /^thumbnails\/scene-\d{3,}\.jpg$/i.test(scene.thumb) &&
      Number.isFinite(scene.pitch) && Number.isFinite(scene.yaw) && Number.isFinite(scene.hfov) &&
      Array.isArray(scene.hotspots);
  });
  return validScenes && isValidFloorplanMap(value.map, ids) && value.scenes.every((scene) => (scene.plannedTargets || []).every((target) => ids.has(target)));
}

function cleanHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function roomId(label, preferred = "") {
  if (/^[a-z0-9-]{1,60}$/i.test(preferred)) return preferred;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
  return `room-${slug || Date.now().toString(36)}`;
}

async function releaseStatus() {
  try {
    const [archive, single, embed, manifest] = await Promise.all([stat(releaseZipPath), stat(releaseSinglePath), stat(releaseEmbedPath), stat(workspaceProjectPath)]);
    let latestInput = manifest.mtimeMs;
    try {
      latestInput = Math.max(latestInput, (await stat(workspaceDraftPath)).mtimeMs);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return {
      ready: archive.mtimeMs >= latestInput && single.mtimeMs >= latestInput && embed.mtimeMs >= latestInput,
      embedReady: embed.mtimeMs >= latestInput,
      bytes: archive.size,
      singleBytes: single.size,
      embedBytes: embed.size,
      updatedAt: archive.mtime.toISOString()
    };
  } catch (error) {
    if (error.code === "ENOENT") return { ready: false };
    throw error;
  }
}

async function readBody(request, maximumBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > maximumBytes) throw Object.assign(new Error("Request is too large."), { code: "ETOOLARGE" });
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  return JSON.parse((await readBody(request)).toString("utf8"));
}

async function readDraft(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return validateDraft(value) ? value : emptyDraft();
  } catch (error) {
    if (error.code === "ENOENT") return emptyDraft();
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function sanitiseLogValue(value, key = "", depth = 0) {
  if (depth > 7) return "[depth limit]";
  if (typeof value === "string") {
    if (/token|password|secret|authorization|cookie/i.test(key)) return "[redacted]";
    if (/^(?:data|blob):/i.test(value)) return `[${value.split(":", 1)[0]} URL omitted]`;
    return value.length > 2000 ? `${value.slice(0, 2000)}...[truncated]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitiseLogValue(item, key, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 200).map(([childKey, childValue]) => [childKey, sanitiseLogValue(childValue, childKey, depth + 1)]));
  }
  return value;
}

async function rotateStudioLog() {
  try {
    if ((await stat(studioLogPath)).size < maxStudioLogBytes) return;
    await rm(`${studioLogPath}.1`, { force: true });
    await rename(studioLogPath, `${studioLogPath}.1`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function appendStudioLogs(entries) {
  await mkdir(workspaceRoot, { recursive: true });
  await rotateStudioLog();
  const receivedAt = new Date().toISOString();
  const lines = entries.slice(0, 100).map((entry) => JSON.stringify({
    receivedAt,
    ...sanitiseLogValue(entry)
  }));
  if (lines.length) await appendFile(studioLogPath, `${lines.join("\n")}\n`, "utf8");
  return lines.length;
}

async function readStudioLogTail() {
  try {
    const contents = await readFile(studioLogPath, "utf8");
    return contents.trim().split(/\r?\n/).filter(Boolean).slice(-500).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { event: "invalid-log-line", raw: line.slice(0, 500) };
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readWorkspaceProject() {
  try {
    const value = JSON.parse(await readFile(workspaceProjectPath, "utf8"));
    if (!validateWorkspaceProject(value)) throw new Error("Workspace project manifest is invalid.");
    if (!Array.isArray(value.rooms)) {
      const rooms = new Map();
      value.scenes.forEach((scene) => {
        if (scene.space !== "room-unassigned" && !rooms.has(scene.space)) rooms.set(scene.space, { id: scene.space, label: scene.spaceLabel });
      });
      value.rooms = [...rooms.values()];
    }
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeWorkspaceProject(project) {
  if (!validateWorkspaceProject(project)) throw new Error("Workspace project manifest is invalid.");
  await writeJsonAtomic(workspaceProjectPath, project);
}

async function createProjectBackup() {
  const project = await readWorkspaceProject();
  if (!project || project.scenes.length === 0) throw new Error("Add at least one 360 photo before downloading a saved tour.");
  try {
    await stat(workspaceDraftPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeJsonAtomic(workspaceDraftPath, emptyDraft());
  }
  await mkdir(dirname(projectBackupPath), { recursive: true });
  await rm(projectBackupPath, { force: true });
  const entries = ["tour-project.json", "draft.json", "panoramas", "thumbnails"];
  if (project.map?.asset === "floorplan/map.jpg") entries.push("floorplan");
  await execFileAsync("zip", ["-X", "-r", projectBackupPath, ...entries], { cwd: workspaceRoot, maxBuffer: 1024 * 1024 });
  return stat(projectBackupPath);
}

async function restoreProjectBackup(source) {
  await mkdir(dirname(workspaceRoot), { recursive: true });
  const temporaryRoot = await mkdtemp(join(dirname(workspaceRoot), ".rdtour-import-"));
  const archivePath = join(temporaryRoot, "project.rdtour");
  const extractedRoot = join(temporaryRoot, "workspace");
  await writeFile(archivePath, source);
  try {
    const { stdout } = await execFileAsync("unzip", ["-Z1", archivePath], { maxBuffer: 1024 * 1024 });
    const entries = stdout.split(/\r?\n/).filter(Boolean);
    if (!entries.includes("tour-project.json") || !entries.includes("draft.json")) throw new Error("This is not a RainDigit editable project.");
    if (entries.length > 270 || entries.some((entry) => entry.startsWith("/") || entry.includes("..") || !/^(tour-project\.json|draft\.json|panoramas\/(?:scene-\d{3,}\.jpg)?|thumbnails\/(?:scene-\d{3,}\.jpg)?|floorplan\/?|floorplan\/map\.jpg)$/i.test(entry))) {
      throw new Error("Project backup contains unsupported files.");
    }
    await mkdir(extractedRoot, { recursive: true });
    await execFileAsync("unzip", ["-q", archivePath, "-d", extractedRoot], { maxBuffer: 1024 * 1024 });
    const project = JSON.parse(await readFile(join(extractedRoot, "tour-project.json"), "utf8"));
    const draft = JSON.parse(await readFile(join(extractedRoot, "draft.json"), "utf8"));
    if (!validateWorkspaceProject(project) || !validateDraft(draft)) throw new Error("Project backup data is invalid.");
    for (const scene of project.scenes) {
      const [panorama, thumb] = await Promise.all([stat(join(extractedRoot, scene.panorama)), stat(join(extractedRoot, scene.thumb))]);
      if (!panorama.isFile() || !thumb.isFile()) throw new Error(`Project media is missing for ${scene.id}.`);
    }
    if (project.map?.asset === "floorplan/map.jpg") {
      const floorplan = await stat(join(extractedRoot, project.map.asset));
      if (!floorplan.isFile()) throw new Error("Project floorplan is missing.");
    }
    await rm(workspaceRoot, { recursive: true, force: true });
    await rename(extractedRoot, workspaceRoot);
    return project;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function nextSceneId(scenes) {
  let number = 1;
  const ids = new Set(scenes.map((scene) => scene.id));
  while (ids.has(`scene-${String(number).padStart(3, "0")}`)) number += 1;
  return `scene-${String(number).padStart(3, "0")}`;
}

function fileNameToTitle(value) {
  return value.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled scene";
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
    const marker = buffer[offset];
    offset += 1;
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

async function runMagick(args) {
  for (const binary of ["magick", "convert"]) {
    try {
      await execFileAsync(binary, args, { maxBuffer: 1024 * 1024 });
      return;
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`Image preparation failed: ${error.stderr || error.message}`);
    }
  }
  throw new Error("Image preparation failed: ImageMagick is not installed.");
}

async function processX4Dng(inputPath, referencePath, outputPath, metricsPath) {
  const processor = join(projectRoot, "scripts", "x4-raw-process.py");
  try {
    await execFileAsync("/usr/bin/python3", [
      processor,
      "--dng", inputPath,
      "--reference", referencePath,
      "--output", outputPath,
      "--metrics", metricsPath
    ], {
      cwd: projectRoot,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30 * 60 * 1000
    });
  } catch (error) {
    throw new Error(`Container RAW processing failed: ${error.stderr || error.stdout || error.message}`);
  }
}

function workspaceConfig(project, scope) {
  const prefix = scope.startsWith("/") ? scope : `/${scope}`;
  const scenes = project.scenes.map((scene) => ({
    ...scene,
    panorama: `${prefix}/workspace/${scene.panorama}`,
    thumb: `${prefix}/workspace/${scene.thumb}`
  }));
  const map = project.map?.asset === "floorplan/map.jpg"
    ? { enabled: project.map.enabled === true, asset: `${prefix}/workspace/${project.map.asset}`, pins: project.map.pins || {} }
    : { enabled: false, asset: null, pins: {} };
  return {
    title: project.title,
    firstScene: scenes[0]?.id || null,
    scenes,
    map
  };
}

async function serveFile(response, root, relativePath, cacheControl = "no-store") {
  const filePath = resolve(root, normalize(relativePath));
  if (!filePath.startsWith(`${root}/`) && filePath !== join(root, "index.html")) {
    response.writeHead(403, responseHeaders("text/plain; charset=utf-8"));
    response.end("Forbidden");
    return;
  }
  const details = await stat(filePath);
  if (!details.isFile()) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
  response.writeHead(200, responseHeaders(contentTypes[extname(filePath)] || "application/octet-stream", cacheControl));
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  try {
    const routeEndpoint = !previewMode && url.pathname.startsWith(`${previewEndpoint}/`) ? previewEndpoint : endpoint;
    const readOnly = previewMode || routeEndpoint === previewEndpoint;
    const workspace = isWorkspaceRequest(url);
    if (url.pathname === `${routeEndpoint}/status` && request.method === "GET") {
      replyJson(response, 200, {
        editor: readOnly ? "raindigit-tour-draft-preview" : "raindigit-tour-editor",
        writable: !readOnly,
        draftPath: activeDraftPath(url),
        studioLogPath,
        workspace,
        workspaceAvailable: Boolean(await readWorkspaceProject())
      });
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/studio-log` && request.method === "GET") {
      replyJson(response, 200, { entries: await readStudioLogTail() });
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/debug-bundle` && request.method === "GET") {
      const project = await readWorkspaceProject();
      const draft = await readDraft(workspaceDraftPath);
      replyJson(response, 200, {
        schema: "raindigit-tour-studio-debug/v1",
        createdAt: new Date().toISOString(),
        app: { node: process.version, commit: process.env.RAINDIGIT_TOUR_COMMIT || "local-dev" },
        project,
        draft,
        log: await readStudioLogTail()
      });
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/studio-log` && request.method === "POST") {
      const body = await readJsonBody(request);
      const entries = Array.isArray(body?.entries) ? body.entries : [];
      if (!entries.length) {
        replyJson(response, 400, { error: "At least one studio log entry is required." });
        return;
      }
      replyJson(response, 202, { accepted: await appendStudioLogs(entries) });
      return;
    }
    if (url.pathname === `${routeEndpoint}/overrides` && request.method === "GET") {
      replyJson(response, 200, await readDraft(activeDraftPath(url)));
      return;
    }
    if (url.pathname === `${routeEndpoint}/workspace-config.js` && request.method === "GET") {
      if (!workspace) {
        replyJson(response, 400, { error: "Workspace mode is required." });
        return;
      }
      const project = await readWorkspaceProject();
      if (!project || project.scenes.length === 0) {
        replyJson(response, 404, { error: "Create a tour and add at least one 360 photo first." });
        return;
      }
      response.writeHead(200, responseHeaders("application/javascript; charset=utf-8"));
      response.end(`window.TOUR_CONFIG = ${JSON.stringify(workspaceConfig(project, routeEndpoint))};\n`);
      return;
    }
    if (url.pathname.startsWith(`${routeEndpoint}/workspace/`) && request.method === "GET") {
      const relativePath = decodeURIComponent(url.pathname.slice(`${routeEndpoint}/workspace/`.length));
      await serveFile(response, workspaceRoot, relativePath, "no-store");
      return;
    }
    if (url.pathname === `${routeEndpoint}/workspace-project` && request.method === "GET") {
      const project = await readWorkspaceProject();
      replyJson(response, 200, { project });
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/workspace-project` && request.method === "POST") {
      const body = await readJsonBody(request);
      const existing = await readWorkspaceProject();
      if (body?.action === "create") {
        if (existing && body.replace !== true) {
          replyJson(response, 409, { error: "A local workspace already exists. Confirm replace before creating a new one." });
          return;
        }
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 100) : "Untitled 3D Tour";
        if (!title) {
          replyJson(response, 400, { error: "A project title is required." });
          return;
        }
        if (existing && body.replace === true) await rm(workspaceRoot, { recursive: true, force: true });
        const project = emptyWorkspaceProject(title);
        await writeWorkspaceProject(project);
        replyJson(response, 201, project);
        return;
      }
      if (body?.action === "reorder") {
        if (!existing || !Array.isArray(body.sceneIds)) {
          replyJson(response, 400, { error: "A workspace and complete scene order are required." });
          return;
        }
        const currentIds = existing.scenes.map((scene) => scene.id);
        if (body.sceneIds.length !== currentIds.length || new Set(body.sceneIds).size !== currentIds.length || body.sceneIds.some((id) => !currentIds.includes(id))) {
          replyJson(response, 400, { error: "Scene order must contain every workspace scene exactly once." });
          return;
        }
        existing.scenes = body.sceneIds.map((id) => existing.scenes.find((scene) => scene.id === id));
        existing.firstScene = existing.scenes[0]?.id || null;
        await writeWorkspaceProject(existing);
        replyJson(response, 200, existing);
        return;
      }
      if (body?.action === "structure") {
        if (!existing || !Array.isArray(body.scenes) || body.scenes.length !== existing.scenes.length) {
          replyJson(response, 400, { error: "A complete workspace structure is required." });
          return;
        }
        const incomingById = new Map(body.scenes.map((scene) => [scene?.id, scene]));
        if (incomingById.size !== existing.scenes.length || existing.scenes.some((scene) => !incomingById.has(scene.id))) {
          replyJson(response, 400, { error: "Every 360 photo must appear once." });
          return;
        }
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 100) : existing.title;
        if (!title) {
          replyJson(response, 400, { error: "A project title is required." });
          return;
        }
        const rooms = Array.isArray(body.rooms)
          ? body.rooms.map((room) => ({
            id: typeof room?.id === "string" ? room.id : "",
            label: typeof room?.label === "string" ? room.label.trim().slice(0, 80) : ""
          }))
          : existing.rooms || [];
        const roomIds = new Set(rooms.map((room) => room.id));
        if (!rooms.length || roomIds.size !== rooms.length || rooms.some((room) => !/^[a-z0-9-]{1,60}$/i.test(room.id) || !room.label)) {
          replyJson(response, 400, { error: "Create at least one valid room." });
          return;
        }
        const nextScenes = [];
        for (const original of existing.scenes) {
          const incoming = incomingById.get(original.id);
          const sceneTitle = typeof incoming.title === "string" ? incoming.title.trim().slice(0, 80) : "";
          const subtitle = typeof incoming.subtitle === "string" ? incoming.subtitle.trim().slice(0, 120) : "";
          const space = typeof incoming.space === "string" && /^[a-z0-9-]{1,60}$/i.test(incoming.space) ? incoming.space : "";
          const spaceLabel = typeof incoming.spaceLabel === "string" ? incoming.spaceLabel.trim().slice(0, 80) : "";
          const titleAutoGenerated = incoming.titleAutoGenerated === true;
          if (!sceneTitle || !space || !spaceLabel || !roomIds.has(space)) {
            replyJson(response, 400, { error: `Photo ${original.id} needs a room and a name.` });
            return;
          }
          const plannedTargets = Array.isArray(incoming.plannedTargets)
            ? [...new Set(incoming.plannedTargets.filter((target) => typeof target === "string" && target !== original.id && incomingById.has(target)))].slice(0, 99)
            : Array.isArray(original.plannedTargets) ? original.plannedTargets : [];
          nextScenes.push({ ...original, title: sceneTitle, subtitle, space, spaceLabel, titleAutoGenerated, plannedTargets });
        }
        const order = Array.isArray(body.sceneIds) ? body.sceneIds : nextScenes.map((scene) => scene.id);
        if (order.length !== nextScenes.length || new Set(order).size !== nextScenes.length || order.some((id) => !incomingById.has(id))) {
          replyJson(response, 400, { error: "Every 360 photo must appear once." });
          return;
        }
        existing.title = title;
        existing.rooms = rooms;
        existing.scenes = order.map((id) => nextScenes.find((scene) => scene.id === id));
        existing.firstScene = existing.scenes[0]?.id || null;
        await writeWorkspaceProject(existing);
        replyJson(response, 200, existing);
        return;
      }
      if (body?.action === "remove") {
        const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
        const scene = existing?.scenes.find((candidate) => candidate.id === sceneId);
        if (!existing || !scene) {
          replyJson(response, 404, { error: "The selected viewpoint no longer exists." });
          return;
        }
        await Promise.all([
          rm(join(workspaceRoot, scene.panorama), { force: true }),
          rm(join(workspaceRoot, scene.thumb), { force: true })
        ]);
        existing.scenes = existing.scenes
          .filter((candidate) => candidate.id !== sceneId)
          .map((candidate) => ({
            ...candidate,
            hotspots: candidate.hotspots.filter((hotspot) => hotspot.target !== sceneId),
            plannedTargets: (candidate.plannedTargets || []).filter((target) => target !== sceneId)
          }));
        if (existing.map?.pins) delete existing.map.pins[sceneId];
        existing.firstScene = existing.firstScene === sceneId ? existing.scenes[0]?.id || null : existing.firstScene;
        await writeWorkspaceProject(existing);

        const draft = await readDraft(workspaceDraftPath);
        Object.keys(draft.overrides).filter((key) => key.startsWith(`${sceneId}::`)).forEach((key) => delete draft.overrides[key]);
        for (const collection of ["sceneMetadata", "sceneViews", "sceneAdjustments", "localAdjustments"]) {
          if (draft[collection]) delete draft[collection][sceneId];
        }
        if (draft.addedHotspots) {
          delete draft.addedHotspots[sceneId];
          Object.keys(draft.addedHotspots).forEach((sourceId) => {
            draft.addedHotspots[sourceId] = draft.addedHotspots[sourceId].filter((hotspot) => hotspot.target !== sceneId);
          });
        }
        await writeJsonAtomic(workspaceDraftPath, draft);
        replyJson(response, 200, existing);
        return;
      }
      if (body?.action === "map") {
        if (!existing) {
          replyJson(response, 409, { error: "Create a tour before configuring its floorplan." });
          return;
        }
        const current = existing.map || { enabled: false, asset: null, pins: {} };
        const pins = body.pins === undefined ? current.pins || {} : body.pins;
        const next = { enabled: body.enabled === true, asset: current.asset, pins };
        if (next.enabled && next.asset !== "floorplan/map.jpg") {
          replyJson(response, 400, { error: "Upload a floorplan before showing it in the finished tour." });
          return;
        }
        if (!isValidFloorplanMap(next, new Set(existing.scenes.map((scene) => scene.id)))) {
          replyJson(response, 400, { error: "Floorplan pins are invalid." });
          return;
        }
        existing.map = next;
        await writeWorkspaceProject(existing);
        replyJson(response, 200, existing);
        return;
      }
      replyJson(response, 400, { error: "Unsupported workspace action." });
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/workspace-map` && request.method === "POST") {
      const project = await readWorkspaceProject();
      if (!project) {
        replyJson(response, 409, { error: "Create a tour before adding a floorplan." });
        return;
      }
      const fileName = cleanHeader(request.headers["x-tour-file-name"]).replace(/[\\/]/g, "");
      if (!fileName || !/\.(?:jpe?g|png|webp)$/i.test(fileName)) {
        replyJson(response, 400, { error: "Choose a JPG, PNG or WebP floorplan image." });
        return;
      }
      const source = await readBody(request, maxFloorplanBytes);
      const temporaryInput = join(workspaceRoot, `.floorplan-${process.pid}-${Date.now()}${extname(fileName).toLowerCase()}`);
      const output = join(workspaceRoot, "floorplan", "map.jpg");
      await mkdir(dirname(output), { recursive: true });
      await writeFile(temporaryInput, source);
      try {
        await runMagick([temporaryInput, "-auto-orient", "-resize", "1920x1920>", "-strip", "-interlace", "Plane", "-sampling-factor", "4:2:0", "-quality", "90", output]);
      } finally {
        await rm(temporaryInput, { force: true });
      }
      const existingPins = project.map?.pins || {};
      const pins = Object.fromEntries(project.scenes.map((scene, index) => {
        const fallback = { x: Math.round(18 + (index % 4) * 21), y: Math.round(22 + (Math.floor(index / 4) % 4) * 21) };
        return [scene.id, isValidFloorplanMap({ enabled: false, pins: { [scene.id]: existingPins[scene.id] } }, new Set([scene.id])) ? existingPins[scene.id] : fallback];
      }));
      project.map = { enabled: true, asset: "floorplan/map.jpg", pins };
      await writeWorkspaceProject(project);
      replyJson(response, 201, { map: project.map, project });
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/workspace-raw-reference` && request.method === "POST") {
      const project = await readWorkspaceProject();
      if (!project) {
        replyJson(response, 409, { error: "Create a tour before adding photos." });
        return;
      }
      const fileName = cleanHeader(request.headers["x-tour-file-name"]).replace(/[\\/]/g, "");
      if (!/\.jpe?g$/i.test(fileName)) {
        replyJson(response, 400, { error: "Choose the camera JPG recorded with this DNG." });
        return;
      }
      const source = await readBody(request, maxUploadBytes);
      const dimensions = jpegDimensions(source);
      if (!dimensions || dimensions.width < 1600 || Math.abs(dimensions.width / dimensions.height - 2) > 0.02) {
        replyJson(response, 400, { error: "The matching camera JPG must be a finished 2:1 panorama." });
        return;
      }
      const token = createHash("sha256").update(source).update(String(Date.now())).digest("hex");
      await mkdir(workspaceRoot, { recursive: true });
      await writeFile(join(workspaceRoot, `.raw-reference-${token}.jpg`), source);
      replyJson(response, 201, { token });
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/workspace-import` && request.method === "POST") {
      const project = await readWorkspaceProject();
      if (!project) {
        replyJson(response, 409, { error: "Create a tour before adding photos." });
        return;
      }
      const fileName = cleanHeader(request.headers["x-tour-file-name"]).replace(/[\\/]/g, "");
      const isDng = /\.dng$/i.test(fileName);
      const isJpeg = /\.jpe?g$/i.test(fileName);
      if (!fileName || (!isJpeg && !isDng)) {
        replyJson(response, 400, { error: "Choose a stitched 2:1 JPG, or an exported stitched 2:1 DNG." });
        return;
      }
      const source = await readBody(request, maxUploadBytes);
      const sourceHash = createHash("sha256").update(source).digest("hex");
      if (project.scenes.some((scene) => scene.sourceHash === sourceHash)) {
        replyJson(response, 409, { error: "This photo is already in the tour." });
        return;
      }
      const temporaryInput = join(workspaceRoot, `.upload-${process.pid}-${Date.now()}${isDng ? ".dng" : ".jpg"}`);
      const temporaryStitched = join(workspaceRoot, `.stitched-${process.pid}-${Date.now()}.jpg`);
      const temporaryMetrics = join(workspaceRoot, `.raw-metrics-${process.pid}-${Date.now()}.json`);
      const referenceToken = cleanHeader(request.headers["x-tour-reference-token"]);
      const temporaryReference = /^[a-f0-9]{64}$/.test(referenceToken)
        ? join(workspaceRoot, `.raw-reference-${referenceToken}.jpg`)
        : "";
      await writeFile(temporaryInput, source);
      let developed;
      let sourceFormat = isDng ? "dng" : "jpeg";
      let sourceQuality;
      try {
        if (isDng) {
          if (!temporaryReference) throw new Error("Select the matching camera DNG and JPG together. The JPG supplies the exact camera tone; the DNG supplies additional detail.");
          try {
            await stat(temporaryReference);
          } catch {
            throw new Error("The matching JPG upload expired. Select the DNG and JPG together again.");
          }
          await processX4Dng(temporaryInput, temporaryReference, temporaryStitched, temporaryMetrics);
          developed = await readFile(temporaryStitched);
          sourceQuality = JSON.parse(await readFile(temporaryMetrics, "utf8"));
          sourceFormat = "dng-x4-calibrated";
        } else {
          developed = source;
        }
      } finally {
        await rm(temporaryInput, { force: true });
        await rm(temporaryStitched, { force: true });
        await rm(temporaryMetrics, { force: true });
        if (temporaryReference) await rm(temporaryReference, { force: true });
      }
      const dimensions = jpegDimensions(developed);
      const ratio = dimensions ? dimensions.width / dimensions.height : 0;
      if (!dimensions || dimensions.width < 1600 || Math.abs(ratio - 2) > 0.02) {
        replyJson(response, 400, { error: isDng ? "The X4 DNG pair could not be converted to a finished 2:1 panorama." : "This is not a ready 360 photo. Export it as a 2:1 JPG from your camera app first." });
        return;
      }
      const id = nextSceneId(project.scenes);
      const requestedRoomLabel = cleanHeader(request.headers["x-tour-room-label"]).slice(0, 80);
      const requestedRoomId = cleanHeader(request.headers["x-tour-room-id"]);
      const existingRoom = project.rooms?.find((room) => room.id === requestedRoomId) || project.scenes.find((scene) => scene.space === requestedRoomId);
      const spaceLabel = existingRoom?.label || existingRoom?.spaceLabel || requestedRoomLabel || fileNameToTitle(fileName);
      const space = existingRoom?.space || existingRoom?.id || roomId(spaceLabel, requestedRoomId);
      const panorama = `panoramas/${id}.jpg`;
      const thumb = `thumbnails/${id}.jpg`;
      const outputPanorama = join(workspaceRoot, panorama);
      const outputThumb = join(workspaceRoot, thumb);
      await mkdir(dirname(outputPanorama), { recursive: true });
      await mkdir(dirname(outputThumb), { recursive: true });
      const preparedInput = join(workspaceRoot, `.prepared-${process.pid}-${Date.now()}.jpg`);
      await writeFile(preparedInput, developed);
      try {
        const panoramaQuality = isDng ? "96" : "92";
        const panoramaSampling = isDng ? "4:4:4" : "4:2:0";
        await runMagick([preparedInput, "-auto-orient", "-strip", "-interlace", "Plane", "-sampling-factor", panoramaSampling, "-quality", panoramaQuality, outputPanorama]);
        await runMagick([outputPanorama, "-thumbnail", "480x240^", "-gravity", "center", "-extent", "480x240", "-strip", "-interlace", "Plane", "-quality", "84", outputThumb]);
      } finally {
        await rm(preparedInput, { force: true });
      }
      const scene = {
        id,
        title: `View ${project.scenes.length + 1}`,
        titleAutoGenerated: true,
        subtitle: "360 photo",
        space,
        spaceLabel,
        thumb,
        panorama,
        pitch: -8,
        yaw: 0,
        hfov: 94,
        hotspots: [],
        sourceHash,
        sourceFormat,
        ...(sourceQuality ? { sourceQuality } : {})
      };
      project.scenes.push(scene);
      project.firstScene ||= id;
      await writeWorkspaceProject(project);
      replyJson(response, 201, { scene, project });
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/build-release` && request.method === "POST") {
      if (!workspace) {
        replyJson(response, 400, { error: "Workspace mode is required to build a release." });
        return;
      }
      const project = await readWorkspaceProject();
      if (!project || project.scenes.length === 0) {
        replyJson(response, 409, { error: "Add at least one 360 photo before building the tour." });
        return;
      }
      const builder = join(projectRoot, "scripts", "build-tour-release.mjs");
      await execFileAsync(process.execPath, [builder, "--workspace", workspaceRoot, "--output", releaseRoot, "--zip", releaseZipPath, "--single", releaseSinglePath, "--embed", releaseEmbedPath, "--replace"], {
        cwd: projectRoot,
        maxBuffer: 4 * 1024 * 1024,
        timeout: 10 * 60 * 1000
      });
      replyJson(response, 200, await releaseStatus());
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/release-status` && request.method === "GET") {
      replyJson(response, 200, await releaseStatus());
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/release-download` && request.method === "GET") {
      const status = await releaseStatus();
      if (!workspace || !status.ready) {
        replyJson(response, 404, { error: "Build the current workspace before downloading it." });
        return;
      }
      response.writeHead(200, {
        ...responseHeaders("application/zip"),
        "content-disposition": "attachment; filename=raindigit-360-tour.zip",
        "content-length": status.bytes
      });
      createReadStream(releaseZipPath).pipe(response);
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/release-single-download` && request.method === "GET") {
      const status = await releaseStatus();
      if (!workspace || !status.ready) {
        replyJson(response, 404, { error: "Build the current workspace before downloading it." });
        return;
      }
      response.writeHead(200, {
        ...responseHeaders("text/html; charset=utf-8"),
        "content-disposition": "attachment; filename=raindigit-360-tour.html",
        "content-length": status.singleBytes
      });
      createReadStream(releaseSinglePath).pipe(response);
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/release-embed-download` && request.method === "GET") {
      const status = await releaseStatus();
      if (!workspace || !status.ready) {
        replyJson(response, 404, { error: "Build the current workspace before downloading paste-in code." });
        return;
      }
      response.writeHead(200, {
        ...responseHeaders("text/html; charset=utf-8"),
        "content-disposition": "attachment; filename=raindigit-360-tour-embed.html",
        "content-length": status.embedBytes
      });
      createReadStream(releaseEmbedPath).pipe(response);
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/release-single-preview.html` && request.method === "GET") {
      const status = await releaseStatus();
      if (!workspace || !status.ready) {
        replyJson(response, 404, { error: "Build the current workspace before previewing it." });
        return;
      }
      response.writeHead(200, {
        ...responseHeaders("text/html; charset=utf-8"),
        "content-length": status.singleBytes
      });
      createReadStream(releaseSinglePath).pipe(response);
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/project-download` && request.method === "GET") {
      if (!workspace) {
        replyJson(response, 400, { error: "Workspace mode is required." });
        return;
      }
      const details = await createProjectBackup();
      response.writeHead(200, {
        ...responseHeaders("application/zip"),
        "content-disposition": "attachment; filename=raindigit-tour-project.rdtour",
        "content-length": details.size
      });
      createReadStream(projectBackupPath).pipe(response);
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/project-import` && request.method === "POST") {
      const source = await readBody(request, maxProjectBytes);
      const project = await restoreProjectBackup(source);
      replyJson(response, 200, { restored: true, project });
      return;
    }
    if (!readOnly && url.pathname.startsWith(`${routeEndpoint}/release/`) && request.method === "GET") {
      const status = await releaseStatus();
      if (!status.ready) {
        replyJson(response, 404, { error: "Build the current workspace before opening its release." });
        return;
      }
      const relativePath = decodeURIComponent(url.pathname.slice(`${routeEndpoint}/release/`.length)) || "index.html";
      await serveFile(response, releaseRoot, relativePath, "no-store");
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/release-embed-test.html` && request.method === "GET") {
      const status = await releaseStatus();
      if (!status.ready) {
        replyJson(response, 404, { error: "Build the current workspace before testing its embed." });
        return;
      }
      response.writeHead(200, responseHeaders("text/html; charset=utf-8"));
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RainDigit embed test</title><style>html{font-family:Arial,sans-serif;color:#20231f;background:#f4f5f2}body{max-width:1180px;margin:0 auto;padding:24px}h1{font-size:24px;margin:0 0 8px}p{color:#59605a;margin:0 0 18px}.frame{overflow:hidden;border:1px solid #c9cec8;background:#10110e;box-shadow:0 12px 30px rgba(16,17,14,.12)}iframe{display:block;width:100%;aspect-ratio:16/9;border:0}@media(max-width:640px){body{padding:12px}h1{font-size:19px}.frame{margin-inline:-12px;border-inline:0}}</style></head><body><h1>Website embed test</h1><p>This page embeds the same one-file HTML delivered to a customer.</p><div class="frame"><iframe src="${routeEndpoint}/release-single-preview.html?workspace=1" title="360 virtual tour" allow="fullscreen" allowfullscreen loading="eager"></iframe></div></body></html>`);
      return;
    }
    if (!readOnly && url.pathname === `${routeEndpoint}/save` && request.method === "POST") {
      const draft = await readJsonBody(request);
      if (!validateDraft(draft)) {
        replyJson(response, 400, { error: "Invalid hotspot draft." });
        return;
      }
      const selectedDraftPath = activeDraftPath(url);
      await writeJsonAtomic(selectedDraftPath, draft);
      replyJson(response, 200, { saved: true, draftPath: selectedDraftPath, updatedAt: draft.updatedAt });
      return;
    }

    const relativePath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    await serveFile(response, webRoot, relativePath);
  } catch (error) {
    const statusCode = error.code === "ENOENT" ? 404 : error.code === "ETOOLARGE" ? 413 : error.code === "EINPUT" ? 400 : 500;
    if (!previewMode && statusCode >= 500) {
      try {
        await appendStudioLogs([{
          time: new Date().toISOString(),
          sessionId: "server",
          event: "server-request-error",
          details: {
            method: request.method,
            pathname: url.pathname,
            message: error.message,
            stack: error.stack || ""
          }
        }]);
      } catch (logError) {
        console.warn(`Could not write studio diagnostics: ${logError.message}`);
      }
    }
    replyJson(response, statusCode, { error: statusCode === 404 ? "Not found" : error.message });
  }
});

server.listen(port, host, () => {
  console.log(previewMode
    ? `Tour draft preview: http://${host}:${port}/?preview=1`
    : `Tour editor: http://${host}:${port}/?edit=1`);
  console.log(`Draft file: ${draftPath}`);
  console.log(`Workspace: ${workspaceRoot}`);
});
