#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function requestJson(url, options = {}, expected = 200) {
  const response = await fetch(url, options);
  const body = await response.json();
  assert(response.status === expected, `${options.method || "GET"} ${url} returned ${response.status}: ${body.error || JSON.stringify(body)}`);
  return body;
}

async function runMagick(arguments_) {
  for (const binary of ["magick", "convert"]) {
    try {
      return await execFileAsync(binary, arguments_);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error("ImageMagick is not installed (expected magick or convert).");
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/__tour-editor/status`);
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Timed out waiting for the product test server.");
}

async function importPanorama(baseUrl, filePath, roomId, roomLabel, expected = 201) {
  return requestJson(`${baseUrl}/__tour-editor/workspace-import?workspace=1`, {
    method: "POST",
    headers: {
      "content-type": "image/jpeg",
      "x-tour-file-name": encodeURIComponent(filePath.split("/").pop()),
      "x-tour-room-id": encodeURIComponent(roomId),
      "x-tour-room-label": encodeURIComponent(roomLabel)
    },
    body: await readFile(filePath)
  }, expected);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "raindigit-360-product-test-"));
  const workspace = join(root, "workspace");
  const output = join(root, "release");
  const zip = join(root, "raindigit-360-tour.zip");
  const port = 18000 + Math.floor(Math.random() * 20000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [join(projectRoot, "scripts", "tour-editor-server.mjs"), "--port", String(port)], {
    cwd: projectRoot,
    env: { ...process.env, INSTA360_TOUR_WORKSPACE: workspace },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverError = "";
  server.stderr.on("data", (chunk) => { serverError += chunk.toString(); });

  try {
    await waitForServer(baseUrl);
    const create = await requestJson(`${baseUrl}/__tour-editor/workspace-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", title: "Product QA Tour", replace: false })
    }, 201);
    assert(create.scenes.length === 0, "A new project must start empty.");

    const fixtures = [
      ["kitchen-near.jpg", "#162c3d", "#d6af5c"],
      ["kitchen-window.jpg", "#294a3b", "#e8d7a6"],
      ["hall.jpg", "#3c283f", "#8bc6b1"]
    ];
    for (const [name, start, end] of fixtures) {
      await runMagick(["-size", "2000x1000", `gradient:${start}-${end}`, "-quality", "92", join(root, name)]);
    }

    await importPanorama(baseUrl, join(root, fixtures[0][0]), "room-kitchen", "Kitchen");
    await importPanorama(baseUrl, join(root, fixtures[1][0]), "room-kitchen", "Kitchen");
    const firstThird = await importPanorama(baseUrl, join(root, fixtures[2][0]), "room-hall", "Hall");
    const removed = await requestJson(`${baseUrl}/__tour-editor/workspace-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "remove", sceneId: firstThird.project.scenes[2].id })
    });
    assert(removed.scenes.length === 2, "Removing a viewpoint must preserve the rest of the project.");
    await stat(join(root, fixtures[2][0]));
    const third = await importPanorama(baseUrl, join(root, fixtures[2][0]), "room-hall", "Hall");
    await importPanorama(baseUrl, join(root, fixtures[0][0]), "room-kitchen", "Kitchen", 409);

    const imported = third.project;
    assert(imported.scenes.length === 3, "The project must contain three viewpoints.");
    assert(imported.scenes.filter((scene) => scene.space === "room-kitchen").length === 2, "Two viewpoints must remain grouped in Kitchen.");

    const structuredScenes = imported.scenes.map((scene, index) => ({
      id: scene.id,
      title: ["Kitchen entrance", "Kitchen window", "Hall overview"][index],
      subtitle: ["Near the door", "Window side", "Hallway"][index],
      space: scene.space,
      spaceLabel: scene.space === "room-kitchen" ? "Kitchen" : "Hall"
    }));
    const structured = await requestJson(`${baseUrl}/__tour-editor/workspace-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "structure",
        title: "Product QA Tour",
        firstScene: "scene-002",
        sceneIds: ["scene-002", "scene-001", "scene-003"],
        scenes: structuredScenes
      })
    });
    assert(structured.firstScene === "scene-002", "The selected opening viewpoint must persist.");
    assert(structured.scenes[0].id === "scene-002", "Viewpoint order must persist.");

    const draft = {
      schema: "raindigit-tour-hotspot-overrides/v1",
      updatedAt: new Date().toISOString(),
      overrides: {
        "scene-001::0": { pitch: -18.5, yaw: 42.5, targetPitch: -4, targetYaw: 90, targetHfov: 82 }
      },
      addedHotspots: {
        "scene-001": [{ kind: "doorway", pitch: -18.5, yaw: 42.5, target: "scene-003", label: "Walk to Hall", targetPitch: -4, targetYaw: 90, targetHfov: 82 }],
        "scene-002": [],
        "scene-003": []
      },
      sceneMetadata: Object.fromEntries(structured.scenes.map((scene) => [scene.id, { title: scene.title, subtitle: scene.subtitle }])),
      sceneViews: {
        "scene-001": { pitch: -12, yaw: 35, hfov: 88 },
        "scene-002": { pitch: -8, yaw: -60, hfov: 92 },
        "scene-003": { pitch: -4, yaw: 90, hfov: 82 }
      },
      sceneAdjustments: {
        "scene-001": { brightness: 106, contrast: 104, saturation: 108, warmth: 3 },
        "scene-002": { brightness: 100, contrast: 100, saturation: 100, warmth: 0 },
        "scene-003": { brightness: 100, contrast: 100, saturation: 100, warmth: 0 }
      },
      localAdjustments: {
        "scene-001": [{ id: "area-window", shape: "ellipse", pitch: 4, yaw: 38, width: 260, height: 180, intensity: 24, color: "#fff1b8" }],
        "scene-002": [],
        "scene-003": []
      }
    };
    await requestJson(`${baseUrl}/__tour-editor/save?workspace=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft)
    });

    const configResponse = await fetch(`${baseUrl}/__tour-editor/workspace-config.js?workspace=1`);
    const config = await configResponse.text();
    assert(configResponse.ok && config.includes("room-kitchen") && config.includes("room-hall"), "Workspace preview config must contain both rooms.");

    await execFileAsync(process.execPath, [join(projectRoot, "scripts", "build-tour-release.mjs"), "--workspace", workspace, "--output", output, "--zip", zip, "--replace"], { cwd: projectRoot });
    await execFileAsync("unzip", ["-t", zip]);
    const { stdout: listing } = await execFileAsync("unzip", ["-Z1", zip]);
    assert(listing.includes("INSTALL.txt"), "The package must contain installation instructions.");
    assert(listing.includes("index.html") && listing.includes("js/tour-config.js"), "The package must contain a deployable tour.");
    assert(!/draft\.json|tour-editor|tour-preview|studio-workspace/i.test(listing), "Editor or draft data leaked into the release archive.");
    const releaseConfig = await readFile(join(output, "js", "tour-config.js"), "utf8");
    assert(releaseConfig.includes('"pitch":-8') && releaseConfig.includes('"yaw":-60') && releaseConfig.includes('"hfov":92'), "Saved default viewpoints must be baked into the release.");
    const releaseCss = await readFile(join(output, "css", "tour.css"), "utf8");
    assert(releaseCss.includes(".pnlm-dragfix") && releaseCss.includes("pointer-events: auto"), "The release must retain panorama drag rotation.");

    const singleOutput = join(root, "release-single");
    const singleZip = join(root, "raindigit-single-tour.zip");
    await requestJson(`${baseUrl}/__tour-editor/workspace-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", title: "Single Panorama Tour", replace: true })
    }, 201);
    await importPanorama(baseUrl, join(root, fixtures[0][0]), "room-studio", "Studio");
    const singleDraft = {
      schema: "raindigit-tour-hotspot-overrides/v1",
      updatedAt: new Date().toISOString(),
      overrides: {},
      addedHotspots: { "scene-001": [] },
      sceneMetadata: { "scene-001": { title: "Studio overview", subtitle: "Single viewpoint" } },
      sceneViews: { "scene-001": { pitch: -6, yaw: 20, hfov: 90 } },
      sceneAdjustments: { "scene-001": { brightness: 100, contrast: 100, saturation: 100, warmth: 0 } },
      localAdjustments: { "scene-001": [] }
    };
    await requestJson(`${baseUrl}/__tour-editor/save?workspace=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(singleDraft)
    });
    await execFileAsync(process.execPath, [join(projectRoot, "scripts", "build-tour-release.mjs"), "--workspace", workspace, "--output", singleOutput, "--zip", singleZip, "--replace"], { cwd: projectRoot });
    await execFileAsync("unzip", ["-t", singleZip]);
    const singleConfig = await readFile(join(singleOutput, "js", "tour-config.js"), "utf8");
    assert((singleConfig.match(/scene-001/g) || []).length >= 1 && !singleConfig.includes("scene-002"), "A one-panorama tour must export without invented destinations.");

    console.log(JSON.stringify({
      passed: true,
      rooms: 2,
      viewpoints: 3,
      transitions: 1,
      singlePanorama: true,
      archiveBytes: (await stat(zip)).size
    }, null, 2));
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    await rm(root, { recursive: true, force: true });
    if (server.exitCode && server.exitCode !== 0) throw new Error(`Product test server failed: ${serverError}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
