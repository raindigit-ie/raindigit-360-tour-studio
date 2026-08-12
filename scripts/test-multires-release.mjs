#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runMagick(arguments_) {
  for (const binary of ["magick", "convert"]) {
    try { return await execFileAsync(binary, arguments_); }
    catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error("ImageMagick is required.");
}

async function imageDimensions(path) {
  const { stdout } = await runMagick(["identify", "-format", "%w %h", path]);
  return stdout.trim().split(/\s+/).map(Number);
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

async function main() {
  const root = await mkdtemp(join(tmpdir(), "raindigit-multires-test-"));
  const workspace = join(root, "workspace");
  const output = join(root, "release");
  try {
    await mkdir(join(workspace, "panoramas"), { recursive: true });
    await mkdir(join(workspace, "thumbnails"), { recursive: true });
    for (const [id, colors] of [["scene-001", ["#102e52", "#dab862"]], ["scene-002", ["#4a1b2b", "#6eb5a4"]]]) {
      const panorama = join(workspace, "panoramas", `${id}.jpg`);
      await runMagick(["-size", "2048x1024", `gradient:${colors[0]}-${colors[1]}`, "-quality", "92", panorama]);
      await runMagick([panorama, "-thumbnail", "480x240^", "-gravity", "center", "-extent", "480x240", join(workspace, "thumbnails", `${id}.jpg`)]);
    }
    const project = {
      schema: "raindigit-tour-project/v1",
      title: "Future Multires QA",
      firstScene: "scene-001",
      rooms: [{ id: "room-a", label: "Room A" }],
      floors: [{ id: "floor-1", label: "Ground floor" }],
      scenes: [
        { id: "scene-001", title: "Entry", subtitle: "First", space: "room-a", spaceLabel: "Room A", floor: "floor-1", floorLabel: "Ground floor", panorama: "panoramas/scene-001.jpg", thumb: "thumbnails/scene-001.jpg", pitch: -7, yaw: 31, hfov: 88, hotspots: [{ kind: "doorway", pitch: -12, yaw: 42, target: "scene-002", label: "Go to second", targetPitch: -4, targetYaw: 81, targetHfov: 90, positionConfirmed: true, arrivalConfirmed: true }] },
        { id: "scene-002", title: "Second", subtitle: "Second", space: "room-a", spaceLabel: "Room A", floor: "floor-1", floorLabel: "Ground floor", panorama: "panoramas/scene-002.jpg", thumb: "thumbnails/scene-002.jpg", pitch: -4, yaw: 81, hfov: 90, hotspots: [{ kind: "doorway", pitch: -10, yaw: -35, target: "scene-001", label: "Go to entry", targetPitch: -7, targetYaw: 31, targetHfov: 88, positionConfirmed: true, arrivalConfirmed: true }] }
      ]
    };
    await writeFile(join(workspace, "tour-project.json"), `${JSON.stringify(project, null, 2)}\n`);
    await writeFile(join(workspace, "draft.json"), `${JSON.stringify({ schema: "raindigit-tour-hotspot-overrides/v1", overrides: {}, addedHotspots: {}, sceneViews: {}, sceneAdjustments: {}, localAdjustments: {} }, null, 2)}\n`);

    await execFileAsync(process.execPath, [join(projectRoot, "scripts", "build-multires-release.mjs"), "--workspace", workspace, "--output", output, "--slug", "future-multires-qa", "--replace"], { cwd: projectRoot, timeout: 20 * 60 * 1000 });
    const source = await readFile(join(output, "js", "tour-config.js"), "utf8");
    const context = { window: {} };
    vm.runInNewContext(source, context);
    const config = context.window.TOUR_CONFIG;
    assert(config.firstScene === "scene-001", "Opening scene changed.");
    assert(config.scenes.map((scene) => scene.id).join(",") === "scene-001,scene-002", "Scene order changed.");
    assert(config.scenes[0].pitch === -7 && config.scenes[0].yaw === 31 && config.scenes[0].hfov === 88, "Opening view changed.");
    assert(config.scenes[0].hotspots[0].target === "scene-002", "Hotspot destination changed.");
    assert(config.scenes.every((scene) => scene.type === "multires" && !scene.panorama), "Scenes were not converted to multires.");
    assert(config.scenes.every((scene) => scene.multiRes.tileResolution === 512 && scene.multiRes.extension === "webp" && scene.multiRes.fallbackExtension === "jpg" && scene.multiRes.equirectangularThumbnail.startsWith("data:image/webp;base64,")), "Multires contract is incomplete.");

    const files = await walk(output);
    const webpTiles = files.filter((path) => path.endsWith(".webp") && !path.includes("thumbnails"));
    const fallbacks = files.filter((path) => /\/fallback\/[fbudlr]\.jpg$/.test(path));
    assert(webpTiles.length > 12, "Too few multires WebP tiles were produced.");
    assert(fallbacks.length === 12, `Expected 12 JPEG fallback faces, found ${fallbacks.length}.`);
    assert(!files.some((path) => /\/assets\/p\//.test(path)), "Full equirectangular public files were retained.");
    for (const tile of webpTiles) {
      const [width, height] = await imageDimensions(tile);
      assert(width <= 512 && height <= 512, `${tile} exceeds 512 px.`);
    }
    const manifest = JSON.parse(await readFile(join(output, "release-manifest.json"), "utf8"));
    assert(manifest.version.startsWith("multires-") && manifest.immutablePrefix.includes(manifest.version), "Versioned immutable manifest is invalid.");
    const pannellumRuntime = await readFile(join(output, "js", "pannellum.js"), "utf8");
    assert(pannellumRuntime.includes("m.fallbackExtension||m.extension"), "JPEG fallback extension support is missing from the release runtime.");
    console.log(`Future multires release passed: ${config.scenes.length} scenes, ${webpTiles.length} WebP tiles, 12 JPEG fallback faces.`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
