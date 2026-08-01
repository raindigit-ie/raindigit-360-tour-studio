#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
const releaseRoot = join(projectRoot, "release");
const releaseZipPath = join(projectRoot, "dist", "raindigit-360-tour.zip");
const host = "127.0.0.1";
const previewMode = process.argv.includes("--preview");
const portArgument = process.argv.indexOf("--port");
const port = portArgument >= 0 ? Number(process.argv[portArgument + 1]) : previewMode ? 8768 : 8767;
const endpoint = previewMode ? "/__tour-preview" : "/__tour-editor";
const maxUploadBytes = 128 * 1024 * 1024;

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Use a valid local port between 1024 and 65535.");
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
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
  return { schema: "raindigit-tour-hotspot-overrides/v1", overrides: {}, sceneAdjustments: {} };
}

function emptyWorkspaceProject(title = "Untitled 3D Tour") {
  return {
    schema: "raindigit-tour-project/v1",
    title,
    firstScene: null,
    scenes: []
  };
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

function isValidSceneMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return typeof value.title === "string" && value.title.trim().length >= 1 && value.title.length <= 80 &&
    typeof value.subtitle === "string" && value.subtitle.length <= 120;
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
    Number.isFinite(value.targetHfov) && value.targetHfov >= 58 && value.targetHfov <= 112;
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
  const validLocalAdjustments = value.localAdjustments === undefined || (
    typeof value.localAdjustments === "object" && !Array.isArray(value.localAdjustments) &&
    Object.entries(value.localAdjustments).every(([sceneId, adjustments]) => /^scene-[a-z0-9-]+$/i.test(sceneId) && Array.isArray(adjustments) && adjustments.length <= 30 && adjustments.every(isValidLocalAdjustment))
  );
  const validAddedHotspots = value.addedHotspots === undefined || (
    typeof value.addedHotspots === "object" && !Array.isArray(value.addedHotspots) &&
    Object.entries(value.addedHotspots).every(([sceneId, hotspots]) => /^scene-[a-z0-9-]+$/i.test(sceneId) && Array.isArray(hotspots) && hotspots.length <= 60 && hotspots.every(isValidAddedHotspot))
  );
  return validCoordinates && validAdjustments && validMetadata && validLocalAdjustments && validAddedHotspots;
}

function validateWorkspaceProject(value) {
  if (!value || value.schema !== "raindigit-tour-project/v1" || typeof value.title !== "string" || !Array.isArray(value.scenes)) return false;
  const ids = new Set();
  return value.title.trim().length >= 1 && value.title.length <= 100 && value.scenes.length <= 100 && value.scenes.every((scene) => {
    if (!scene || typeof scene !== "object" || !/^scene-\d{3,}$/i.test(scene.id) || ids.has(scene.id)) return false;
    ids.add(scene.id);
    return typeof scene.title === "string" && scene.title.trim().length >= 1 && scene.title.length <= 80 &&
      typeof scene.subtitle === "string" && scene.subtitle.length <= 120 &&
      typeof scene.space === "string" && /^[a-z0-9-]{1,60}$/i.test(scene.space) &&
      typeof scene.spaceLabel === "string" && scene.spaceLabel.trim().length >= 1 && scene.spaceLabel.length <= 80 &&
      typeof scene.panorama === "string" && /^panoramas\/scene-\d{3,}\.jpg$/i.test(scene.panorama) &&
      typeof scene.thumb === "string" && /^thumbnails\/scene-\d{3,}\.jpg$/i.test(scene.thumb) &&
      Number.isFinite(scene.pitch) && Number.isFinite(scene.yaw) && Number.isFinite(scene.hfov) &&
      Array.isArray(scene.hotspots);
  });
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
    const [archive, manifest] = await Promise.all([stat(releaseZipPath), stat(workspaceProjectPath)]);
    let latestInput = manifest.mtimeMs;
    try {
      latestInput = Math.max(latestInput, (await stat(workspaceDraftPath)).mtimeMs);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return {
      ready: archive.mtimeMs >= latestInput,
      bytes: archive.size,
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

async function readWorkspaceProject() {
  try {
    const value = JSON.parse(await readFile(workspaceProjectPath, "utf8"));
    if (!validateWorkspaceProject(value)) throw new Error("Workspace project manifest is invalid.");
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
  try {
    await execFileAsync("magick", args, { maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(`Image preparation failed: ${error.stderr || error.message}`);
  }
}

function workspaceConfig(project, scope) {
  const prefix = scope.startsWith("/") ? scope : `/${scope}`;
  const scenes = project.scenes.map((scene) => ({
    ...scene,
    panorama: `${prefix}/workspace/${scene.panorama}`,
    thumb: `${prefix}/workspace/${scene.thumb}`
  }));
  return {
    title: project.title,
    firstScene: project.firstScene || scenes[0]?.id || null,
    scenes
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
    const workspace = isWorkspaceRequest(url);
    if (url.pathname === `${endpoint}/status` && request.method === "GET") {
      replyJson(response, 200, {
        editor: previewMode ? "raindigit-tour-draft-preview" : "raindigit-tour-editor",
        writable: !previewMode,
        draftPath: activeDraftPath(url),
        workspace,
        workspaceAvailable: Boolean(await readWorkspaceProject())
      });
      return;
    }
    if (url.pathname === `${endpoint}/overrides` && request.method === "GET") {
      replyJson(response, 200, await readDraft(activeDraftPath(url)));
      return;
    }
    if (url.pathname === `${endpoint}/workspace-config.js` && request.method === "GET") {
      if (!workspace) {
        replyJson(response, 400, { error: "Workspace mode is required." });
        return;
      }
      const project = await readWorkspaceProject();
      if (!project || project.scenes.length === 0) {
        replyJson(response, 404, { error: "Create a workspace and import at least one panorama first." });
        return;
      }
      response.writeHead(200, responseHeaders("application/javascript; charset=utf-8"));
      response.end(`window.TOUR_CONFIG = ${JSON.stringify(workspaceConfig(project, endpoint))};\n`);
      return;
    }
    if (url.pathname.startsWith(`${endpoint}/workspace/`) && request.method === "GET") {
      const relativePath = decodeURIComponent(url.pathname.slice(`${endpoint}/workspace/`.length));
      await serveFile(response, workspaceRoot, relativePath, "no-store");
      return;
    }
    if (url.pathname === `${endpoint}/workspace-project` && request.method === "GET") {
      const project = await readWorkspaceProject();
      replyJson(response, 200, { project });
      return;
    }
    if (!previewMode && url.pathname === `${endpoint}/workspace-project` && request.method === "POST") {
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
          replyJson(response, 400, { error: "Workspace structure must contain every panorama exactly once." });
          return;
        }
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 100) : existing.title;
        if (!title) {
          replyJson(response, 400, { error: "A project title is required." });
          return;
        }
        const nextScenes = [];
        for (const original of existing.scenes) {
          const incoming = incomingById.get(original.id);
          const sceneTitle = typeof incoming.title === "string" ? incoming.title.trim().slice(0, 80) : "";
          const subtitle = typeof incoming.subtitle === "string" ? incoming.subtitle.trim().slice(0, 120) : "";
          const space = typeof incoming.space === "string" && /^[a-z0-9-]{1,60}$/i.test(incoming.space) ? incoming.space : "";
          const spaceLabel = typeof incoming.spaceLabel === "string" ? incoming.spaceLabel.trim().slice(0, 80) : "";
          if (!sceneTitle || !space || !spaceLabel) {
            replyJson(response, 400, { error: `Panorama ${original.id} needs a room, title and room label.` });
            return;
          }
          nextScenes.push({ ...original, title: sceneTitle, subtitle, space, spaceLabel });
        }
        const order = Array.isArray(body.sceneIds) ? body.sceneIds : nextScenes.map((scene) => scene.id);
        if (order.length !== nextScenes.length || new Set(order).size !== nextScenes.length || order.some((id) => !incomingById.has(id))) {
          replyJson(response, 400, { error: "Panorama order must contain every workspace panorama exactly once." });
          return;
        }
        existing.title = title;
        existing.scenes = order.map((id) => nextScenes.find((scene) => scene.id === id));
        existing.firstScene = typeof body.firstScene === "string" && incomingById.has(body.firstScene) ? body.firstScene : existing.scenes[0]?.id || null;
        await writeWorkspaceProject(existing);
        replyJson(response, 200, existing);
        return;
      }
      replyJson(response, 400, { error: "Unsupported workspace action." });
      return;
    }
    if (!previewMode && url.pathname === `${endpoint}/workspace-import` && request.method === "POST") {
      const project = await readWorkspaceProject();
      if (!project) {
        replyJson(response, 409, { error: "Create a local workspace before importing panoramas." });
        return;
      }
      const fileName = cleanHeader(request.headers["x-tour-file-name"]).replace(/[\\/]/g, "");
      if (!fileName || !/\.jpe?g$/i.test(fileName)) {
        replyJson(response, 400, { error: "Only JPEG equirectangular panoramas are accepted." });
        return;
      }
      const source = await readBody(request, maxUploadBytes);
      const dimensions = jpegDimensions(source);
      const ratio = dimensions ? dimensions.width / dimensions.height : 0;
      if (!dimensions || dimensions.width < 1600 || Math.abs(ratio - 2) > 0.02) {
        replyJson(response, 400, { error: "The image must be a stitched 2:1 equirectangular JPEG panorama." });
        return;
      }
      const sourceHash = createHash("sha256").update(source).digest("hex");
      if (project.scenes.some((scene) => scene.sourceHash === sourceHash)) {
        replyJson(response, 409, { error: "This panorama is already in the local workspace." });
        return;
      }
      const id = nextSceneId(project.scenes);
      const requestedRoomLabel = cleanHeader(request.headers["x-tour-room-label"]).slice(0, 80);
      const requestedRoomId = cleanHeader(request.headers["x-tour-room-id"]);
      const existingRoom = project.scenes.find((scene) => scene.space === requestedRoomId);
      const spaceLabel = existingRoom?.spaceLabel || requestedRoomLabel || fileNameToTitle(fileName);
      const space = existingRoom?.space || roomId(spaceLabel, requestedRoomId);
      const panorama = `panoramas/${id}.jpg`;
      const thumb = `thumbnails/${id}.jpg`;
      const temporaryInput = join(workspaceRoot, `.upload-${process.pid}-${Date.now()}.jpg`);
      const outputPanorama = join(workspaceRoot, panorama);
      const outputThumb = join(workspaceRoot, thumb);
      await mkdir(dirname(outputPanorama), { recursive: true });
      await mkdir(dirname(outputThumb), { recursive: true });
      await writeFile(temporaryInput, source);
      try {
        await runMagick([temporaryInput, "-auto-orient", "-strip", "-interlace", "Plane", "-sampling-factor", "4:2:0", "-quality", "92", outputPanorama]);
        await runMagick([outputPanorama, "-thumbnail", "480x240^", "-gravity", "center", "-extent", "480x240", "-strip", "-interlace", "Plane", "-quality", "84", outputThumb]);
      } finally {
        await rm(temporaryInput, { force: true });
      }
      const scene = {
        id,
        title: fileNameToTitle(fileName),
        subtitle: "Imported panorama",
        space,
        spaceLabel,
        thumb,
        panorama,
        pitch: -8,
        yaw: 0,
        hfov: 94,
        hotspots: [],
        sourceHash
      };
      project.scenes.push(scene);
      project.firstScene ||= id;
      await writeWorkspaceProject(project);
      replyJson(response, 201, { scene, project });
      return;
    }
    if (!previewMode && url.pathname === `${endpoint}/build-release` && request.method === "POST") {
      if (!workspace) {
        replyJson(response, 400, { error: "Workspace mode is required to build a release." });
        return;
      }
      const project = await readWorkspaceProject();
      if (!project || project.scenes.length === 0) {
        replyJson(response, 409, { error: "Import at least one panorama before building a release." });
        return;
      }
      const builder = join(projectRoot, "scripts", "build-tour-release.mjs");
      await execFileAsync(process.execPath, [builder, "--workspace", workspaceRoot, "--output", releaseRoot, "--zip", releaseZipPath, "--replace"], {
        cwd: projectRoot,
        maxBuffer: 4 * 1024 * 1024,
        timeout: 10 * 60 * 1000
      });
      replyJson(response, 200, await releaseStatus());
      return;
    }
    if (!previewMode && url.pathname === `${endpoint}/release-status` && request.method === "GET") {
      replyJson(response, 200, await releaseStatus());
      return;
    }
    if (!previewMode && url.pathname === `${endpoint}/release-download` && request.method === "GET") {
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
    if (!previewMode && url.pathname.startsWith(`${endpoint}/release/`) && request.method === "GET") {
      const status = await releaseStatus();
      if (!status.ready) {
        replyJson(response, 404, { error: "Build the current workspace before opening its release." });
        return;
      }
      const relativePath = decodeURIComponent(url.pathname.slice(`${endpoint}/release/`.length)) || "index.html";
      await serveFile(response, releaseRoot, relativePath, "no-store");
      return;
    }
    if (!previewMode && url.pathname === `${endpoint}/save` && request.method === "POST") {
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
    const statusCode = error.code === "ENOENT" ? 404 : error.code === "ETOOLARGE" ? 413 : 500;
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
