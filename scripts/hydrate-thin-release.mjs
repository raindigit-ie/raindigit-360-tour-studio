#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

function parseArguments(argv) {
  const options = { packageRoot: null, output: null, cdnOrigin: "https://cdn.raindigit.ie", concurrency: 24 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--package") options.packageRoot = resolve(argv[++index] || "");
    else if (argument === "--output") options.output = resolve(argv[++index] || "");
    else if (argument === "--cdn-origin") options.cdnOrigin = String(argv[++index] || "").replace(/\/$/, "");
    else if (argument === "--concurrency") options.concurrency = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.packageRoot || !options.output || options.packageRoot === options.output) throw new Error("Distinct --package and --output paths are required.");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 64) throw new Error("--concurrency must be 1..64.");
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function fetchBytes(url, attempt = 0) {
  const response = await fetch(url, { cache: "no-store" });
  if ((response.status === 429 || response.status >= 500) && attempt < 8) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(10_000, 250 * 2 ** attempt)));
    return fetchBytes(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function parallel(items, concurrency, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }));
}

async function inventory(root) {
  const files = [];
  for (const file of (await walk(root)).sort()) {
    const path = relative(root, file).replaceAll("\\", "/");
    if (path === "release-manifest.json") continue;
    const body = await readFile(file);
    files.push({ path, bytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") });
  }
  return files;
}

function digestInventory(files) {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path); digest.update("\0");
    digest.update(String(file.bytes)); digest.update("\0");
    digest.update(file.sha256); digest.update("\0");
  }
  return digest.digest("hex");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifestPaths = (await walk(options.packageRoot)).filter((path) => path.endsWith("/release-manifest.json"));
  assert(manifestPaths.length === 1, `Expected one thin release manifest, found ${manifestPaths.length}.`);
  const sourceManifest = JSON.parse(await readFile(manifestPaths[0], "utf8"));
  assert(sourceManifest.mediaDependency?.immutablePrefix, "Source package has no media dependency to hydrate.");
  const dependencyUrl = `${options.cdnOrigin}/${sourceManifest.mediaDependency.immutablePrefix}release-manifest.json`;
  const dependencyManifest = JSON.parse((await fetchBytes(dependencyUrl)).toString("utf8"));
  assert(dependencyManifest.slug === sourceManifest.slug && dependencyManifest.contentDigest === sourceManifest.mediaDependency.contentDigest, "Remote media dependency identity does not match the thin package.");
  const mediaFiles = dependencyManifest.files.filter((file) => file.path.startsWith("assets/mr/") || file.path.startsWith("assets/t/"));
  assert(mediaFiles.length === sourceManifest.mediaDependency.files && mediaFiles.length > 0, "Remote media inventory is incomplete.");
  const temporary = await mkdtemp(join(tmpdir(), "raindigit-hydrate-release-"));
  const stagedRelease = join(temporary, "release");
  try {
    await cp(dirname(manifestPaths[0]), stagedRelease, { recursive: true });
    await parallel(mediaFiles, options.concurrency, async (file, index) => {
      const body = await fetchBytes(`${options.cdnOrigin}/${sourceManifest.mediaDependency.immutablePrefix}${file.path}`);
      assert(body.byteLength === file.bytes && createHash("sha256").update(body).digest("hex") === file.sha256, `Media integrity mismatch: ${file.path}`);
      const target = join(stagedRelease, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
      if ((index + 1) % 1000 === 0) console.log(`Hydrated ${index + 1}/${mediaFiles.length} media files.`);
    });
    const configPath = join(stagedRelease, "js", "tour-config.js");
    const configSource = await readFile(configPath, "utf8");
    const remotePrefix = `${options.cdnOrigin}/${sourceManifest.mediaDependency.immutablePrefix}`;
    assert(configSource.includes(remotePrefix), "Tour config does not reference its declared media dependency.");
    await writeFile(configPath, configSource.replaceAll(remotePrefix, ""), "utf8");
    const files = await inventory(stagedRelease);
    const contentDigest = digestInventory(files);
    const version = `multires-${contentDigest.slice(0, 12)}`;
    const immutablePrefix = `tours/${sourceManifest.slug}/${version}/`;
    const manifest = {
      ...sourceManifest,
      version,
      generatedAt: new Date().toISOString(),
      fileCount: files.length,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files,
      contentDigest,
      immutablePrefix,
      entrypoint: `${immutablePrefix}index.html`
    };
    delete manifest.mediaDependency;
    await writeFile(join(stagedRelease, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const packageRoot = join(temporary, "package");
    const target = join(packageRoot, immutablePrefix);
    await mkdir(dirname(target), { recursive: true });
    await rename(stagedRelease, target);
    await rm(options.output, { recursive: true, force: true });
    await rename(packageRoot, options.output);
    console.log(JSON.stringify({ hydrated: true, slug: manifest.slug, version, files: manifest.fileCount, bytes: manifest.bytes, sourceMediaVersion: dependencyManifest.version }, null, 2));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
