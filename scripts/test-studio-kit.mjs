#!/usr/bin/env node

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const root = await mkdtemp(join(tmpdir(), "raindigit-studio-kit-test-"));
const archive = join(root, "studio.zip");
const extracted = join(root, "extracted");
const suffix = `${process.pid}-${Date.now()}`;
const imageName = `raindigit-studio-kit-test:${suffix}`;
const containerName = `raindigit-studio-kit-test-${suffix}`;
const port = 30000 + Math.floor(Math.random() * 20000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await execFileAsync(process.execPath, [join(projectRoot, "scripts", "package-studio-kit.mjs"), archive], { cwd: projectRoot });
  await execFileAsync("unzip", ["-t", archive]);
  const { stdout: listing } = await execFileAsync("unzip", ["-Z1", archive]);
  assert(listing.includes("raindigit-360-tour-studio/Start RainDigit 360 Studio.command"), "The start launcher is missing from the operator kit.");
  assert(listing.includes("raindigit-360-tour-studio/web-tour/index.html"), "The studio runtime is missing from the operator kit.");
  assert(listing.includes("raindigit-360-tour-studio/config/insta360-x4-calibration.pto"), "The X4 lens calibration is missing from the operator kit.");
  assert(listing.includes("raindigit-360-tour-studio/scripts/assess-x4-raw-benefit.py"), "The RAW benefit assessment is missing from the operator kit.");
  assert(listing.includes("raindigit-360-tour-studio/scripts/x4-raw-process.py"), "The RAW processor is missing from the operator kit.");
  assert(listing.includes("raindigit-360-tour-studio/scripts/x4-raw-align.py"), "The RAW aligner is missing from the operator kit.");
  assert(!/(studio-workspace|originals|panoramas\/scene-|thumbnails\/scene-|manual-hotspot|\/release\/|\/dist\/|node_modules|\.git\/)/i.test(listing), "Private or generated project data leaked into the operator kit.");
  await execFileAsync("unzip", ["-q", archive, "-d", extracted]);
  const packageRoot = join(extracted, "raindigit-360-tour-studio");
  await execFileAsync("sh", ["-n", join(packageRoot, "scripts", "start-studio.sh")]);
  await execFileAsync("sh", ["-n", join(packageRoot, "scripts", "stop-studio.sh")]);
  const launcher = await stat(join(packageRoot, "Start RainDigit 360 Studio.command"));
  assert((launcher.mode & 0o111) !== 0, "The extracted macOS launcher is not executable.");
  const compose = await readFile(join(packageRoot, "docker-compose.yml"), "utf8");
  assert(compose.includes("127.0.0.1:8767:8767"), "The operator kit must keep the studio bound to localhost.");
  await execFileAsync("docker", ["build", "--target", "studio", "-t", imageName, packageRoot], { maxBuffer: 8 * 1024 * 1024 });
  await execFileAsync("docker", ["run", "-d", "--name", containerName, "-e", "TOUR_SERVER_HOST=0.0.0.0", "-p", `127.0.0.1:${port}:8767`, imageName]);
  let cleanServerReady = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__tour-editor/status`);
      if (response.ok) {
        const status = await response.json();
        cleanServerReady = status.writable === true && status.workspaceAvailable === false;
        if (cleanServerReady) break;
      }
    } catch {
      // The isolated clean server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  assert(cleanServerReady, "The extracted operator kit did not start as an empty writable studio.");
  console.log(JSON.stringify({ passed: true, archiveBytes: (await stat(archive)).size, privateDataExcluded: true, executableLauncher: true, cleanDockerStart: true }, null, 2));
} finally {
  await execFileAsync("docker", ["rm", "-f", containerName]).catch(() => {});
  await execFileAsync("docker", ["image", "rm", "-f", imageName]).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
