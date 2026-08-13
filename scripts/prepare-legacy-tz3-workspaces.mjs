#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import vm from "node:vm";

const projectRoot = resolve(import.meta.dirname, "..");
const websiteRoot = resolve(projectRoot, "..", "raindigit.ie");
const cameraRoot = "/Users/mk/Desktop/Camera01";
const interiorWorkspace = "/Users/mk/Documents/Personal/Pending Storage Archive/RainDigit 3D Tours/2026-08-01 Killarney Interior 360 Tour - legacy desktop bundle/studio-workspace";
const homeRecoveryWorkspace = join(projectRoot, "qa", "recovery-backups", "studio-workspace-before-recovery-20260810-181148");
const outputRoot = join(projectRoot, ".artifacts", "tz3", "workspaces");
const legacyRoot = join(websiteRoot, ".artifacts", "r2-tours", "tours");

const tours = [
  {
    slug: "killarney-360-property-tour-demo",
    version: "legacy-813a4c97ee71",
    sourceProject: join(interiorWorkspace, "tour-project.json"),
    sourceDraft: join(interiorWorkspace, "draft.json")
  },
  {
    slug: "killarney-home-360-tour",
    version: "legacy-a05959359490",
    sourceProject: join(homeRecoveryWorkspace, "tour-project.json"),
    sourceDraft: join(homeRecoveryWorkspace, "draft.json"),
    kitchenSource: join(cameraRoot, "IMG_20260807_085513_00_019.jpg")
  }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readConfig(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert(context.window.TOUR_CONFIG, "Legacy release has no TOUR_CONFIG.");
  return structuredClone(context.window.TOUR_CONFIG);
}

async function sourceIndex() {
  const index = new Map();
  for (const name of await readdir(cameraRoot)) {
    if (!name.toLowerCase().endsWith(".jpg")) continue;
    const path = join(cameraRoot, name);
    index.set(hash(await readFile(path)), path);
  }
  return index;
}

async function dimensions(path) {
  const bytes = await readFile(path);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return null;
}

async function prepareTour(tour, sources) {
  const releaseRoot = join(legacyRoot, tour.slug, tour.version);
  const legacyConfig = readConfig(await readFile(join(releaseRoot, "js", "tour-config.js"), "utf8"));
  const sourceProject = JSON.parse(await readFile(tour.sourceProject, "utf8"));
  const sourceDraft = JSON.parse(await readFile(tour.sourceDraft, "utf8"));
  const sourceByScene = new Map(sourceProject.scenes.map((scene) => [scene.id, scene]));
  const workspace = join(outputRoot, tour.slug);
  const provenance = [];
  await mkdir(join(workspace, "panoramas"), { recursive: true });
  await mkdir(join(workspace, "thumbnails"), { recursive: true });

  for (const scene of legacyConfig.scenes) {
    const legacyPanorama = scene.panorama;
    let sourceScene = sourceByScene.get(scene.id);
    let originalPath = sourceScene ? sources.get(sourceScene.sourceHash) : null;
    if (!originalPath && scene.id === "scene-004" && tour.kitchenSource) {
      originalPath = tour.kitchenSource;
      sourceScene = { sourceHash: hash(await readFile(originalPath)) };
    }
    assert(originalPath, `${tour.slug}/${scene.id}: original source panorama was not found.`);
    const actualHash = hash(await readFile(originalPath));
    assert(actualHash === sourceScene.sourceHash, `${tour.slug}/${scene.id}: original source hash mismatch.`);
    const size = await dimensions(originalPath);
    assert(size?.width === 11904 && size?.height === 5952, `${tour.slug}/${scene.id}: expected 11904x5952 original, found ${size?.width}x${size?.height}.`);
    const panorama = `panoramas/${scene.id}.jpg`;
    const thumb = `thumbnails/${scene.id}.jpg`;
    await copyFile(originalPath, join(workspace, panorama));
    await copyFile(join(releaseRoot, scene.thumb), join(workspace, thumb));
    scene.panorama = panorama;
    scene.thumb = thumb;
    scene.sourceHash = actualHash;
    for (const hotspot of scene.hotspots || []) {
      hotspot.positionConfirmed = true;
      hotspot.arrivalConfirmed = true;
    }
    provenance.push({
      sceneId: scene.id,
      title: scene.title,
      original: originalPath,
      originalFile: basename(originalPath),
      sourceHash: actualHash,
      width: size.width,
      height: size.height,
      legacyPanorama: `${tour.slug}/${tour.version}/${legacyPanorama}`
    });
  }

  const neutralDraft = {
    schema: sourceDraft.schema || "raindigit-tour-hotspot-overrides/v1",
    overrides: {},
    addedHotspots: {},
    sceneViews: {},
    sceneAdjustments: {},
    localAdjustments: {}
  };
  await writeFile(join(workspace, "tour-project.json"), `${JSON.stringify(legacyConfig, null, 2)}\n`, "utf8");
  await writeFile(join(workspace, "draft.json"), `${JSON.stringify(neutralDraft, null, 2)}\n`, "utf8");
  await writeFile(join(workspace, "source-provenance.json"), `${JSON.stringify({ schema: "raindigit-tz3-source-provenance/v1", slug: tour.slug, version: tour.version, scenes: provenance }, null, 2)}\n`, "utf8");
  return { slug: tour.slug, workspace, scenes: provenance.length, hotspots: legacyConfig.scenes.reduce((sum, scene) => sum + (scene.hotspots?.length || 0), 0) };
}

async function main() {
  const sources = await sourceIndex();
  const prepared = [];
  for (const tour of tours) prepared.push(await prepareTour(tour, sources));
  assert(prepared.reduce((sum, tour) => sum + tour.scenes, 0) === 26, "Prepared inventory is not 26 scenes.");
  await mkdir(dirname(join(outputRoot, "manifest.json")), { recursive: true });
  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify({ schema: "raindigit-tz3-workspaces/v1", prepared }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputRoot, prepared }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
