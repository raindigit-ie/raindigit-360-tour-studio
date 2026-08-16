#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function makeEntry(cache, namespace, key, bytes, ageMinutes) {
  const root = join(cache, namespace, key);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "metadata.json"), `${JSON.stringify({ key })}\n`);
  await writeFile(join(root, "payload.bin"), "");
  await truncate(join(root, "payload.bin"), bytes);
  const accessedAt = new Date(Date.now() - ageMinutes * 60_000);
  await utimes(join(root, "metadata.json"), accessedAt, accessedAt);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "raindigit-cache-prune-test-"));
  const cache = join(root, "cache");
  try {
    await makeEntry(cache, "release-scenes-v1", "oldest", 100 * 1024 ** 2, 30);
    await makeEntry(cache, "multires-scenes-v2", "middle", 100 * 1024 ** 2, 20);
    await makeEntry(cache, "multires-scenes-v2", "newest", 100 * 1024 ** 2, 10);
    const { stdout } = await execFileAsync(process.execPath, [
      join(projectRoot, "scripts", "prune-build-cache.mjs"),
      "--cache", cache,
      "--max-bytes", String(256 * 1024 ** 2)
    ]);
    const result = JSON.parse(stdout);
    assert(result.removed.length === 1 && result.removed[0].key === "oldest", "Cache pruning did not remove the least-recently-used entry.");
    assert(result.afterBytes <= Math.floor(result.maxBytes * 0.9), "Cache pruning did not return below the target budget.");
    assert(!(await stat(join(cache, "release-scenes-v1", "oldest")).catch(() => null)), "Pruned cache entry still exists.");
    assert(await stat(join(cache, "multires-scenes-v2", "middle")), "A newer cache entry was removed unexpectedly.");
    assert(await stat(join(cache, "multires-scenes-v2", "newest")), "The newest cache entry was removed unexpectedly.");
    console.log("Build cache pruning passed: oldest entry removed, recent entries retained.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
