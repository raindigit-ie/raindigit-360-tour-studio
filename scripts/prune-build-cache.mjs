#!/usr/bin/env node

import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

function parseArguments(argv) {
  const options = { cache: null, maxBytes: 8 * 1024 ** 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--cache") options.cache = resolve(argv[++index] || "");
    else if (argument === "--max-bytes") options.maxBytes = Number(argv[++index]);
    else if (argument === "--max-gb") options.maxBytes = Number(argv[++index]) * 1024 ** 3;
    else if (argument === "--help") {
      console.log("Usage: node scripts/prune-build-cache.mjs --cache path [--max-gb 8 | --max-bytes number]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.cache) throw new Error("--cache is required.");
  if (!Number.isFinite(options.maxBytes) || options.maxBytes < 256 * 1024 ** 2) throw new Error("Cache budget must be at least 256 MB.");
  return options;
}

async function directoryBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) bytes += await directoryBytes(path);
    else bytes += (await stat(path)).size;
  }
  return bytes;
}

async function cacheEntries(cacheRoot) {
  const entries = [];
  for (const namespace of ["release-scenes-v1", "multires-scenes-v2"]) {
    const namespaceRoot = join(cacheRoot, namespace);
    let children = [];
    try {
      children = await readdir(namespaceRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith(".")) continue;
      const path = join(namespaceRoot, child.name);
      const metadata = join(path, "metadata.json");
      const access = await stat(metadata).catch(() => stat(path));
      let bytes = null;
      try {
        const parsed = JSON.parse(await readFile(metadata, "utf8"));
        if (Array.isArray(parsed.files)) bytes = parsed.files.reduce((sum, file) => sum + Number(file.bytes || 0), 0) + access.size;
        else if (Number.isFinite(parsed.panoramaBytes) && Number.isFinite(parsed.thumbnailBytes)) bytes = parsed.panoramaBytes + parsed.thumbnailBytes + access.size;
      } catch {}
      entries.push({ namespace, key: child.name, path, bytes: Number.isFinite(bytes) ? bytes : await directoryBytes(path), lastAccessMs: access.mtimeMs });
    }
  }
  return entries;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const entries = await cacheEntries(options.cache);
  const beforeBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const targetBytes = Math.floor(options.maxBytes * 0.9);
  let afterBytes = beforeBytes;
  const removed = [];
  if (beforeBytes > options.maxBytes) {
    for (const entry of entries.sort((left, right) => left.lastAccessMs - right.lastAccessMs)) {
      if (afterBytes <= targetBytes) break;
      await rm(entry.path, { recursive: true, force: true });
      afterBytes -= entry.bytes;
      removed.push({ namespace: entry.namespace, key: entry.key, bytes: entry.bytes });
    }
  }
  console.log(JSON.stringify({
    cache: options.cache,
    maxBytes: options.maxBytes,
    beforeBytes,
    afterBytes,
    entries: entries.length,
    removed
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
