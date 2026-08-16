#!/usr/bin/env node

import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const output = resolve(process.argv[2] || join(projectRoot, "dist", "raindigit-360-tour-studio.zip"));
const packageName = "raindigit-360-tour-studio";
const included = [
  "Dockerfile",
  "docker-compose.yml",
  "package.json",
  "README.md",
  "Start RainDigit 360 Studio.command",
  "Stop RainDigit 360 Studio.command",
  "docker",
  "docs/client-handoff.md",
  "docs/product-workflow.md",
  "docs/operator-playbook.md",
  "docs/product-readiness.md",
  "docs/asset-protection.md",
  "scripts/build-tour-release.mjs",
  "scripts/build-multires-release.mjs",
  "scripts/start-studio.sh",
  "scripts/stop-studio.sh",
  "scripts/tour-editor-server.mjs",
  "web-tour"
];

const temporaryRoot = await mkdtemp(join(tmpdir(), "raindigit-studio-kit-"));
const packageRoot = join(temporaryRoot, packageName);

try {
  for (const relativePath of included) {
    const target = join(packageRoot, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(projectRoot, relativePath), target, { recursive: true });
  }
  for (const mediaFolder of ["panoramas", "thumbnails"]) {
    const target = join(packageRoot, "web-tour", mediaFolder);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(target, ".gitkeep"), "", "utf8");
  }
  await mkdir(dirname(output), { recursive: true });
  await rm(output, { force: true });
  await execFileAsync("zip", ["-X", "-r", output, packageName], { cwd: temporaryRoot, maxBuffer: 4 * 1024 * 1024 });
  console.log(JSON.stringify({ output, packageName, included: included.length }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
