#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertContentVersion(source, pathname, targetPath) {
  const version = createHash("sha256").update(await readFile(targetPath)).digest("hex").slice(0, 12);
  assert(source.includes(`${pathname}?v=${version}`), `${pathname} is not linked by its content version.`);
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

async function uploadFloorplan(baseUrl, filePath, expected = 201) {
  return requestJson(`${baseUrl}/__tour-editor/workspace-map?workspace=1`, {
    method: "POST",
    headers: {
      "content-type": "image/png",
      "x-tour-file-name": encodeURIComponent(filePath.split("/").pop())
    },
    body: await readFile(filePath)
  }, expected);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "raindigit-360-product-test-"));
  const workspace = join(root, "workspace");
  const output = join(root, "release");
  const zip = join(root, "raindigit-360-tour.zip");
  const singleHtml = join(root, "raindigit-360-tour.html");
  const embedHtml = join(root, "raindigit-360-tour-embed.html");
  const artifacts = join(root, "artifacts");
  const port = 18000 + Math.floor(Math.random() * 20000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [join(projectRoot, "scripts", "tour-editor-server.mjs"), "--port", String(port)], {
    cwd: projectRoot,
    env: { ...process.env, INSTA360_TOUR_WORKSPACE: workspace, INSTA360_TOUR_ARTIFACTS: artifacts, INSTA360_TOUR_RELEASE: join(root, "server-release") },
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
      spaceLabel: scene.space === "room-kitchen" ? "Kitchen" : "Hall",
      floor: index === 2 ? "floor-2" : "floor-1",
      floorLabel: index === 2 ? "First floor" : "Ground floor"
    }));
    const structured = await requestJson(`${baseUrl}/__tour-editor/workspace-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "structure",
        title: "Product QA Tour",
        rooms: [{ id: "room-kitchen", label: "Kitchen" }, { id: "room-hall", label: "Hall" }],
        floors: [{ id: "floor-1", label: "Ground floor" }, { id: "floor-2", label: "First floor" }],
        firstScene: "scene-001",
        sceneIds: ["scene-002", "scene-001", "scene-003"],
        scenes: structuredScenes
      })
    });
    assert(structured.firstScene === "scene-002", "The first visible viewpoint order must define the opening scene.");
    assert(structured.scenes[0].id === "scene-002", "Viewpoint order must persist.");
    const versionedStructure = {
      action: "structure",
      editorStructureRevision: 1,
      title: structured.title,
      rooms: structured.rooms,
      floors: structured.floors,
      sceneIds: structured.scenes.map((scene) => scene.id),
      scenes: structured.scenes.map(({ id, title, titleAutoGenerated, subtitle, space, spaceLabel, floor, floorLabel, plannedTargets }) => ({ id, title, titleAutoGenerated, subtitle, space, spaceLabel, floor, floorLabel, plannedTargets }))
    };
    const versionedStructureSave = await requestJson(`${baseUrl}/__tour-editor/workspace-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(versionedStructure)
    });
    assert(versionedStructureSave.editorStructureRevision === 1, "A versioned setup save must advance the structure revision.");
    await requestJson(`${baseUrl}/__tour-editor/workspace-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...versionedStructure, title: "Stale competing title" })
    }, 409);

    const floorplanPath = join(root, "floorplan.png");
    await runMagick(["-size", "1200x800", "xc:#efe4c5", "-fill", "#254b42", "-draw", "rectangle 120,120 1080,680", floorplanPath]);
    const uploadedMap = await uploadFloorplan(baseUrl, floorplanPath);
    assert(uploadedMap.project.map.enabled === true && uploadedMap.project.map.asset === "floorplan/map.jpg", "Floorplan upload must create an enabled normalized map.");
    assert(Object.keys(uploadedMap.project.map.pins).length === 3, "Floorplan upload must create one pin for every viewpoint.");
    const mapPins = { ...uploadedMap.project.map.pins, "scene-002": { x: 72.5, y: 31.5 } };
    const savedMap = await requestJson(`${baseUrl}/__tour-editor/workspace-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "map", enabled: true, pins: mapPins })
    });
    assert(savedMap.map.pins["scene-002"].x === 72.5 && savedMap.map.pins["scene-002"].y === 31.5, "Floorplan pin positions must persist exactly.");

    const draft = {
      schema: "raindigit-tour-hotspot-overrides/v1",
      updatedAt: new Date().toISOString(),
      overrides: {
        "scene-001::0": { pitch: -18.5, yaw: 42.5, targetPitch: -4, targetYaw: 90, targetHfov: 82 },
        "scene-002::0": { pitch: -12, yaw: -30, targetPitch: -12, targetYaw: 35, targetHfov: 88 }
      },
      addedHotspots: {
        "scene-001": [{ kind: "doorway", pitch: -18.5, yaw: 42.5, target: "scene-003", label: "Walk to Hall", targetPitch: -4, targetYaw: 90, targetHfov: 82, positionConfirmed: false, arrivalConfirmed: false }],
        "scene-002": [{ kind: "doorway", pitch: -12, yaw: -30, target: "scene-001", label: "Walk to Kitchen entrance", targetPitch: -12, targetYaw: 35, targetHfov: 88, positionConfirmed: true, arrivalConfirmed: true }],
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
    const firstDraftSave = await requestJson(`${baseUrl}/__tour-editor/save?workspace=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft)
    });
    draft.editorDraftRevision = firstDraftSave.editorDraftRevision;
    draft.updatedAt = new Date().toISOString();
    const secondDraftSave = await requestJson(`${baseUrl}/__tour-editor/save?workspace=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft)
    });
    const staleDraft = { ...draft, updatedAt: new Date().toISOString() };
    await requestJson(`${baseUrl}/__tour-editor/save?workspace=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(staleDraft)
    }, 409);
    draft.editorDraftRevision = secondDraftSave.editorDraftRevision;

    const configResponse = await fetch(`${baseUrl}/__tour-editor/workspace-config.js?workspace=1`);
    const config = await configResponse.text();
    assert(configResponse.ok && config.includes("room-kitchen") && config.includes("room-hall"), "Workspace preview config must contain both rooms.");
    assert(config.includes('"map":{"enabled":true') && config.includes("floorplan/map.jpg"), "Workspace preview config must contain the optional floorplan.");

    const sameOriginPreviewStatus = await requestJson(`${baseUrl}/__tour-preview/status?workspace=1`);
    assert(sameOriginPreviewStatus.writable === false && sameOriginPreviewStatus.workspaceAvailable === true, "The studio must expose a same-origin read-only preview.");
    const sameOriginPreviewConfigResponse = await fetch(`${baseUrl}/__tour-preview/workspace-config.js?workspace=1`);
    const sameOriginPreviewConfig = await sameOriginPreviewConfigResponse.text();
    assert(sameOriginPreviewConfigResponse.ok && sameOriginPreviewConfig.includes("/__tour-preview/workspace/"), "Same-origin preview assets must use the read-only endpoint.");
    const rejectedPreviewWrite = await fetch(`${baseUrl}/__tour-preview/save?workspace=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft)
    });
    assert(!rejectedPreviewWrite.ok, "The same-origin preview endpoint must reject writes.");

    let incompleteBuildRejected = false;
    try {
      await execFileAsync(process.execPath, [join(projectRoot, "scripts", "build-tour-release.mjs"), "--workspace", workspace, "--output", output, "--zip", zip, "--single", singleHtml, "--embed", embedHtml, "--replace"], { cwd: projectRoot });
    } catch (error) {
      incompleteBuildRejected = /Place every transition point/.test(error.stderr || error.message);
    }
    assert(incompleteBuildRejected, "The release builder must reject an unreviewed transition.");
    draft.addedHotspots["scene-001"][0].positionConfirmed = true;
    draft.addedHotspots["scene-001"][0].arrivalConfirmed = true;
    await requestJson(`${baseUrl}/__tour-editor/save?workspace=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft)
    });
    await execFileAsync(process.execPath, [join(projectRoot, "scripts", "build-tour-release.mjs"), "--workspace", workspace, "--output", output, "--zip", zip, "--single", singleHtml, "--embed", embedHtml, "--replace"], { cwd: projectRoot });
    await execFileAsync("unzip", ["-t", zip]);
    const { stdout: listing } = await execFileAsync("unzip", ["-Z1", zip]);
    assert(listing.includes("INSTALL.txt"), "The package must contain installation instructions.");
    assert(listing.includes("index.html") && listing.includes("js/tour-config.js"), "The package must contain a deployable tour.");
    assert(listing.includes("assets/m/"), "The release archive must include the enabled floorplan asset.");
    assert(!/draft\.json|tour-editor|tour-preview|studio-workspace/i.test(listing), "Editor or draft data leaked into the release archive.");
    const releaseConfig = await readFile(join(output, "js", "tour-config.js"), "utf8");
    assert(releaseConfig.includes('"firstScene":"scene-002"'), "The release must open on the first visible viewpoint, not a stale firstScene.");
    assert(releaseConfig.includes('"map":{"enabled":true') && /"asset":"assets\/m\/[a-f0-9]{20}\.jpg"/.test(releaseConfig), "The release must use a hashed floorplan asset.");
    assert(releaseConfig.includes('"pitch":-8') && releaseConfig.includes('"yaw":-60') && releaseConfig.includes('"hfov":92'), "Saved default viewpoints must be baked into the release.");
    const releaseCss = await readFile(join(output, "css", "tour.css"), "utf8");
    assert(releaseCss.includes(".pnlm-dragfix") && releaseCss.includes("pointer-events: auto"), "The release must retain panorama drag rotation.");
    assert(!releaseConfig.includes("positionConfirmed") && !releaseConfig.includes("arrivalConfirmed") && !releaseConfig.includes("plannedTargets"), "Editor planning or review metadata must not leak into the public release.");
    const releaseEntrypoint = await readFile(join(output, "index.html"), "utf8");
    const releaseBootstrap = await readFile(join(output, "js", "tour-bootstrap.js"), "utf8");
    await assertContentVersion(releaseEntrypoint, "css/pannellum.css", join(output, "css", "pannellum.css"));
    await assertContentVersion(releaseEntrypoint, "css/tour.css", join(output, "css", "tour.css"));
    await assertContentVersion(releaseEntrypoint, "js/tour-bootstrap.js", join(output, "js", "tour-bootstrap.js"));
    await assertContentVersion(releaseBootstrap, "js/pannellum.js", join(output, "js", "pannellum.js"));
    await assertContentVersion(releaseBootstrap, "js/tour-config.js", join(output, "js", "tour-config.js"));
    await assertContentVersion(releaseBootstrap, "js/tour-transition.js", join(output, "js", "tour-transition.js"));
    await assertContentVersion(releaseBootstrap, "js/tour.js", join(output, "js", "tour.js"));
    const singleRelease = await readFile(singleHtml, "utf8");
    const singleRuntime = singleRelease.match(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/)?.[1];
    assert(singleRuntime, "The single HTML must embed its runtime.");
    assert(!singleRelease.includes("\n"), "The single HTML must stay on one line.");
    const singleRuntimeJs = Buffer.from(singleRuntime, "base64").toString("utf8");
    assert(singleRuntimeJs.includes("data:image/jpeg;base64,") && singleRuntimeJs.includes('"firstScene":"scene-002"') && singleRuntimeJs.includes('"map":{"enabled":true'), "The single HTML runtime must embed the tour, floorplan and first visible viewpoint.");
    assert(singleRuntimeJs.includes("const isLocalEditorRequest = false;") && singleRuntimeJs.includes("const isLocalDraftPreview = false;"), "The single HTML runtime must keep disabled local-editor flags defined.");
    assert(!/<(?:link|script)[^>]+(?:href|src)=\"(?:css|js|assets)\//i.test(singleRelease), "The single HTML must not depend on local files.");
    const embedRelease = await readFile(embedHtml, "utf8");
    assert(embedRelease.includes("Loading 360 tour...") && embedRelease.includes("requestIdleCallback") && embedRelease.includes("srcdoc"), "The paste-in HTML must preload and lazy-start the self-contained tour.");
    assert(embedRelease.includes("raindigit-tour-fullscreen-fallback") && embedRelease.includes("raindigit-tour-fullscreen-state") && embedRelease.includes("webkitallowfullscreen") && embedRelease.includes("mozallowfullscreen"), "The paste-in HTML must let the generated tour control manage mobile iframe fullscreen fallback.");
    assert(!embedRelease.includes("Exit 360 tour fullscreen"), "The paste-in HTML must not add a competing parent-side fullscreen control.");
    const embedRuntime = embedRelease.match(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/)?.[1];
    const embedRuntimeJs = embedRuntime ? Buffer.from(embedRuntime, "base64").toString("utf8") : "";
    assert(embedRuntimeJs.includes('"firstScene":"scene-002"'), "The paste-in HTML must preserve the first visible viewpoint.");
    assert(embedRuntimeJs.includes("const isLocalEditorRequest = false;") && embedRuntimeJs.includes("const isLocalDraftPreview = false;"), "The paste-in HTML runtime must keep disabled local-editor flags defined.");
    assert(!embedRelease.includes("\n"), "The paste-in HTML must stay on one line for copy/paste.");
    assert(!/<(?:link|script)[^>]+(?:href|src)=\"(?:css|js|assets)\//i.test(embedRelease), "The paste-in HTML must not depend on local files.");

    const workspaceProjectPath = join(workspace, "tour-project.json");
    const workspaceDraftPath = join(workspace, "draft.json");
    const projectWithOrphan = JSON.parse(await readFile(workspaceProjectPath, "utf8"));
    await writeFile(join(workspace, "panoramas", "scene-099.jpg"), await readFile(join(workspace, "panoramas", "scene-003.jpg")));
    await writeFile(join(workspace, "thumbnails", "scene-099.jpg"), await readFile(join(workspace, "thumbnails", "scene-003.jpg")));
    projectWithOrphan.rooms.push({ id: "room-unused", label: "Unused room" });
    projectWithOrphan.scenes.push({
      id: "scene-099",
      title: "Unused view",
      titleAutoGenerated: false,
      subtitle: "Not connected",
      space: "room-unused",
      spaceLabel: "Unused room",
      floor: "floor-1",
      floorLabel: "Ground floor",
      thumb: "thumbnails/scene-099.jpg",
      panorama: "panoramas/scene-099.jpg",
      pitch: -8,
      yaw: 0,
      hfov: 94,
      hotspots: [],
      plannedTargets: [],
      sourceHash: "unused-fixture"
    });
    await writeFile(workspaceProjectPath, `${JSON.stringify(projectWithOrphan, null, 2)}\n`);
    const draftWithOrphan = JSON.parse(await readFile(workspaceDraftPath, "utf8"));
    draftWithOrphan.addedHotspots["scene-099"] = [];
    draftWithOrphan.sceneMetadata["scene-099"] = { title: "Unused view", subtitle: "Not connected" };
    draftWithOrphan.sceneViews["scene-099"] = { pitch: -8, yaw: 0, hfov: 94 };
    draftWithOrphan.sceneAdjustments["scene-099"] = { brightness: 100, contrast: 100, saturation: 100, warmth: 0 };
    draftWithOrphan.localAdjustments["scene-099"] = [];
    await writeFile(workspaceDraftPath, `${JSON.stringify(draftWithOrphan, null, 2)}\n`);
    const rejectedBuild = await requestJson(`${baseUrl}/__tour-editor/build-release?workspace=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "unreachable-fixture", tourVersion: "0.2.5", changeSummary: "Unreachable scene validation fixture" })
    }, 400);
    assert(rejectedBuild.error.includes("Unreachable: Unused view"), `Server did not explain the unreachable photo: ${JSON.stringify(rejectedBuild)}`);
    const preservedProject = JSON.parse(await readFile(workspaceProjectPath, "utf8"));
    const preservedDraft = JSON.parse(await readFile(workspaceDraftPath, "utf8"));
    assert(preservedProject.scenes.some((scene) => scene.id === "scene-099") && preservedDraft.sceneMetadata?.["scene-099"], "A failed preflight must preserve the employee's panorama and draft data.");
    preservedProject.scenes = preservedProject.scenes.filter((scene) => scene.id !== "scene-099");
    preservedProject.rooms = preservedProject.rooms.filter((room) => room.id !== "room-unused");
    delete preservedDraft.addedHotspots["scene-099"];
    delete preservedDraft.sceneMetadata["scene-099"];
    delete preservedDraft.sceneViews["scene-099"];
    delete preservedDraft.sceneAdjustments["scene-099"];
    delete preservedDraft.localAdjustments["scene-099"];
    await writeFile(workspaceProjectPath, `${JSON.stringify(preservedProject, null, 2)}\n`);
    await writeFile(workspaceDraftPath, `${JSON.stringify(preservedDraft, null, 2)}\n`);

    const projectDownload = await fetch(`${baseUrl}/__tour-editor/project-download?workspace=1`);
    assert(projectDownload.ok, "Editable project download must succeed.");
    const projectBackup = Buffer.from(await projectDownload.arrayBuffer());
    const backupPath = join(root, "product-qa.rdtour");
    await writeFile(backupPath, projectBackup);
    const { stdout: backupListing } = await execFileAsync("unzip", ["-Z1", backupPath]);
    assert(backupListing.includes("tour-project.json") && backupListing.includes("draft.json") && backupListing.includes("panoramas/scene-001.jpg") && backupListing.includes("floorplan/map.jpg"), "Editable project must include JSON, media and the optional floorplan.");

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

    const restored = await requestJson(`${baseUrl}/__tour-editor/project-import`, {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: projectBackup
    });
    assert(restored.project.scenes.length === 3 && restored.project.rooms.length === 2 && restored.project.floors.length === 2, "Editable project backup must restore rooms, floors, scenes and settings.");

    console.log(JSON.stringify({
      passed: true,
      rooms: 2,
      floors: 2,
      viewpoints: 3,
      transitions: 1,
      singlePanorama: true,
      editableProjectRoundTrip: true,
      releaseReadinessGate: true,
      sameOriginPreview: true,
      singleHtml: true,
      pasteInHtml: true,
      optionalFloorplan: true,
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
