#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/__tour-editor/status`);
      if (response.ok) return;
    } catch {
      // The isolated browser-test server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Timed out waiting for the browser-test server.");
}

async function main() {
  const suppliedUrl = process.env.TOUR_RELEASE_URL;
  const port = 20000 + Math.floor(Math.random() * 20000);
  const baseUrl = suppliedUrl || `http://127.0.0.1:${port}`;
  const server = suppliedUrl ? null : spawn(process.execPath, ["scripts/tour-editor-server.mjs", "--port", String(port)], {
    cwd: projectRoot,
    stdio: ["ignore", "ignore", "pipe"]
  });
  let serverError = "";
  server?.stderr.on("data", (chunk) => { serverError += chunk.toString(); });

  try {
    if (server) await waitForServer(baseUrl);
    await execFileAsync(process.platform === "win32" ? "npx.cmd" : "npx", ["playwright", "test", "tests/release-mobile.spec.mjs", "tests/transition-control-stacking.spec.mjs", ...process.argv.slice(2)], {
      cwd: projectRoot,
      env: { ...process.env, TOUR_RELEASE_URL: baseUrl },
      maxBuffer: 8 * 1024 * 1024
    });
  } finally {
    server?.kill("SIGTERM");
    if (server) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  if (server?.exitCode && server.exitCode !== 0) throw new Error(`Browser-test server failed: ${serverError}`);
}

main().catch((error) => {
  console.error(error.stdout || error.stderr || error.stack || error.message);
  process.exitCode = 1;
});
