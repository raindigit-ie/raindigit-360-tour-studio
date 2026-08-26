#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const image = process.argv[2] || process.env.RAINDIGIT_STUDIO_IMAGE || "raindigit-360-tour-studio:local";
const platform = process.env.RAINDIGIT_DOCKER_PLATFORM || "";
const suffix = `${process.pid}-${Date.now()}`;
const volume = `raindigit-studio-runtime-test-${suffix}`;
const container = `raindigit-studio-runtime-test-${suffix}`;
const port = 30000 + Math.floor(Math.random() * 20000);
const baseUrl = `http://127.0.0.1:${port}`;
const root = await mkdtemp(join(tmpdir(), "raindigit-studio-docker-test-"));
let browser;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function docker(arguments_, options = {}) {
  return execFileAsync("docker", arguments_, { maxBuffer: 16 * 1024 * 1024, ...options });
}

async function requestJson(path, options = {}, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  assert(response.status === expected, `${options.method || "GET"} ${path} returned ${response.status}: ${body.error || JSON.stringify(body)}`);
  return body;
}

async function waitForHealthy() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/__tour-editor/status`);
      if (response.ok) return response.json();
    } catch {
      // Container is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  const logs = await docker(["logs", container]).then(({ stdout, stderr }) => `${stdout}${stderr}`).catch(() => "");
  throw new Error(`Container did not become healthy.\n${logs}`);
}

async function startContainer() {
  const runArguments = ["run", "-d", "--name", container];
  if (platform) runArguments.push("--platform", platform);
  runArguments.push(
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=1g",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--mount", `source=${volume},target=/data`,
    "-p", `127.0.0.1:${port}:8767`,
    image
  );
  await docker(runArguments);
  return waitForHealthy();
}

try {
  const { stdout: imageInspect } = await docker(["image", "inspect", image, "--format", "{{json .Config}}"]);
  const config = JSON.parse(imageInspect);
  assert(config.User === "node", `The runtime must use the unprivileged node user, found ${config.User || "root"}.`);
  assert(config.Healthcheck?.Test?.length > 0, "The image has no built-in healthcheck.");
  assert(config.Volumes?.["/data"], "The image does not declare its persistent /data volume.");

  await docker(["volume", "create", volume]);
  const initialStatus = await startContainer();
  assert(initialStatus.writable === true && initialStatus.workspaceAvailable === false, "A clean public image must open as an empty writable studio.");

  const { stdout: uid } = await docker(["exec", container, "id", "-u"]);
  assert(uid.trim() !== "0", "The running Studio process is root.");
  await docker(["exec", container, "sh", "-lc", "test -w /data/workspace && test -w /data/artifacts && test -w /data/build-cache"]);
  await docker(["exec", container, "ffmpeg", "-version"]);
  await docker(["exec", container, "convert", "-version"]);

  const editorResponse = await fetch(`${baseUrl}/?edit=1`);
  const editorHtml = await editorResponse.text();
  assert(editorResponse.ok && editorHtml.includes("RainDigit"), "The editor HTML did not load from the container.");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto(`${baseUrl}/?edit=1`, { waitUntil: "domcontentloaded" });
  await page.locator("body").waitFor({ state: "visible" });
  await page.waitForTimeout(750);
  assert((await page.title()).includes("RainDigit"), "The containerized editor has the wrong document title.");
  assert(browserErrors.length === 0, `The clean editor emitted browser errors: ${browserErrors.join(" | ")}`);
  await browser.close();
  browser = undefined;

  const project = await requestJson("/__tour-editor/workspace-project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "create", title: "Docker Runtime Verification", replace: false })
  }, 201);
  assert(project.scenes.length === 0, "A clean project did not start empty.");

  const panoramaPath = join(root, "docker-runtime-panorama.jpg");
  await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 30, g: 55, b: 72 } } })
    .jpeg({ quality: 90 })
    .toFile(panoramaPath);
  const panorama = await readFile(panoramaPath);
  const imported = await requestJson("/__tour-editor/workspace-import?workspace=1", {
    method: "POST",
    headers: {
      "content-type": "image/jpeg",
      "x-tour-file-name": "docker-runtime-panorama.jpg",
      "x-tour-room-id": "room-verification",
      "x-tour-room-label": "Verification room"
    },
    body: panorama
  }, 201);
  const scene = imported.scene;
  await requestJson("/__tour-editor/workspace-project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "structure",
      title: "Docker Runtime Verification",
      rooms: [{ id: "room-verification", label: "Verification room" }],
      floors: [{ id: "floor-1", label: "First floor" }],
      sceneIds: [scene.id],
      scenes: [{
        id: scene.id,
        title: "Verification view",
        titleAutoGenerated: false,
        subtitle: "Portable container test",
        space: "room-verification",
        spaceLabel: "Verification room",
        floor: "floor-1",
        floorLabel: "First floor",
        plannedTargets: []
      }]
    })
  });

  const built = await requestJson("/__tour-editor/build-release?workspace=1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      slug: "docker-runtime-verification",
      tourVersion: "0.2.4",
      changeSummary: "Initial container verification release"
    })
  });
  assert(built.ready === true && built.multires?.ready === true, "The container could not build an optimized tour package.");
  const packageResponse = await fetch(`${baseUrl}/__tour-editor/release-multires-download?workspace=1`);
  const packageBytes = (await packageResponse.arrayBuffer()).byteLength;
  assert(packageResponse.ok && packageBytes > 10_000, "The container did not return the built web package.");
  const backupResponse = await fetch(`${baseUrl}/__tour-editor/project-download?workspace=1`);
  const backupBytes = (await backupResponse.arrayBuffer()).byteLength;
  assert(backupResponse.ok && backupBytes > 1_000, "The container did not return an editable project backup.");

  await docker(["rm", "-f", container]);
  const restoredStatus = await startContainer();
  assert(restoredStatus.workspaceAvailable === true, "The workspace did not survive a fresh container instance.");
  const { project: restoredProject } = await requestJson("/__tour-editor/workspace-project");
  assert(restoredProject.title === "Docker Runtime Verification" && restoredProject.scenes.length === 1, "The persisted project was not restored correctly.");
  const restoredRelease = await requestJson("/__tour-editor/release-status?workspace=1");
  assert(restoredRelease.ready === true && restoredRelease.multires?.slug === "docker-runtime-verification", "The generated package or cache did not survive restart.");

  const { stdout: privatePaths } = await docker(["exec", container, "sh", "-lc", "find /app -maxdepth 3 -type f \\( -path '*/studio-workspace/*' -o -path '*/qa/*' -o -path '*/output/*' -o -path '*/.git/*' \\) -print"]);
  assert(privatePaths.trim() === "", `Private development data leaked into the image: ${privatePaths}`);

  console.log(JSON.stringify({ passed: true, image, platform: platform || "native", nonRoot: true, readOnlyRoot: true, emptyStart: true, browserSmoke: true, imageImport: true, optimizedBuild: true, packageBytes, editableBackupBytes: backupBytes, persistentRestart: true, privateDataExcluded: true }, null, 2));
} finally {
  if (browser) await browser.close().catch(() => {});
  await docker(["rm", "-f", container]).catch(() => {});
  if (process.env.RAINDIGIT_KEEP_TEST_VOLUME !== "1") await docker(["volume", "rm", "-f", volume]).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
