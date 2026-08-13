#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

function parseArguments(argv) {
  const options = { packageRoot: null, mediaPrefix: null, cdnOrigin: "https://cdn.raindigit.ie" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--package") options.packageRoot = resolve(argv[++index] || "");
    else if (argument === "--media-prefix") options.mediaPrefix = String(argv[++index] || "").replace(/^\/+|\/+$/g, "") + "/";
    else if (argument === "--cdn-origin") options.cdnOrigin = String(argv[++index] || "").replace(/\/$/, "");
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.packageRoot || !options.mediaPrefix) throw new Error("--package and --media-prefix are required.");
  if (!/^tours\/[^/]+\/multires-[a-f0-9]{12}\/$/.test(options.mediaPrefix)) throw new Error("Unsafe --media-prefix.");
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

async function inventory(directory) {
  const files = [];
  for (const file of (await walk(directory)).sort()) {
    const path = relative(directory, file).replaceAll("\\", "/");
    if (path === "release-manifest.json") continue;
    const body = await readFile(file);
    files.push({ path, bytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") });
  }
  return files;
}

const options = parseArguments(process.argv.slice(2));
const manifestPaths = (await walk(options.packageRoot)).filter((path) => path.endsWith("/release-manifest.json"));
assert(manifestPaths.length === 1, `Expected one release manifest, found ${manifestPaths.length}.`);
const currentManifest = JSON.parse(await readFile(manifestPaths[0], "utf8"));
assert(currentManifest.mediaDependency, "The package is not a thin-media release.");
assert(options.mediaPrefix.startsWith(`tours/${currentManifest.slug}/`), "Media dependency belongs to another tour.");

const mediaResponse = await fetch(`${options.cdnOrigin}/${options.mediaPrefix}release-manifest.json`, { cache: "no-store" });
assert(mediaResponse.ok, `Media release manifest returned ${mediaResponse.status}.`);
const mediaManifest = await mediaResponse.json();
assert(mediaManifest.schema === "raindigit-tour-multires-release/v1", "Media dependency manifest has an unexpected schema.");
assert(mediaManifest.slug === currentManifest.slug && mediaManifest.immutablePrefix === options.mediaPrefix, "Media dependency identity mismatch.");

const currentRelease = dirname(manifestPaths[0]);
const temporary = await mkdtemp(join(tmpdir(), "raindigit-thin-retarget-"));
const stagedRelease = join(temporary, "release");
try {
  await cp(currentRelease, stagedRelease, { recursive: true });
  const configPath = join(stagedRelease, "js", "tour-config.js");
  const configSource = await readFile(configPath, "utf8");
  const oldOrigin = `${options.cdnOrigin}/${currentManifest.mediaDependency.immutablePrefix}`;
  const newOrigin = `${options.cdnOrigin}/${mediaManifest.immutablePrefix}`;
  assert(configSource.includes(oldOrigin), "TOUR_CONFIG does not reference the current media dependency.");
  await writeFile(configPath, configSource.replaceAll(oldOrigin, newOrigin), "utf8");

  const files = await inventory(stagedRelease);
  assert(files.every((file) => !file.path.startsWith("assets/mr/") && !file.path.startsWith("assets/t/")), "Thin release contains panorama media.");
  const digest = createHash("sha256");
  digest.update(`media:${mediaManifest.contentDigest}\0`);
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(await readFile(join(stagedRelease, file.path)));
    digest.update("\0");
  }
  const contentDigest = digest.digest("hex");
  const version = `multires-${contentDigest.slice(0, 12)}`;
  const immutablePrefix = `tours/${currentManifest.slug}/${version}/`;
  const mediaFiles = mediaManifest.files.filter((file) => file.path.startsWith("assets/mr/") || file.path.startsWith("assets/t/"));
  const manifest = {
    ...currentManifest,
    version,
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
    contentDigest,
    immutablePrefix,
    entrypoint: `${immutablePrefix}index.html`,
    mediaDependency: {
      version: mediaManifest.version,
      immutablePrefix: mediaManifest.immutablePrefix,
      contentDigest: mediaManifest.contentDigest,
      files: mediaFiles.length,
      bytes: mediaFiles.reduce((sum, file) => sum + file.bytes, 0)
    }
  };
  await writeFile(join(stagedRelease, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const targetRelease = join(temporary, "package", immutablePrefix);
  await mkdir(dirname(targetRelease), { recursive: true });
  await rename(stagedRelease, targetRelease);
  const pointerPath = join(temporary, "package", "manifests", manifest.slug, "current.json");
  await mkdir(dirname(pointerPath), { recursive: true });
  await writeFile(pointerPath, `${JSON.stringify({
    schema: "raindigit-tour-current/v1",
    slug: manifest.slug,
    version,
    previousVersion: currentManifest.version,
    prefix: immutablePrefix,
    entrypoint: manifest.entrypoint,
    releaseManifest: `${immutablePrefix}release-manifest.json`,
    contentDigest,
    updatedAt: manifest.generatedAt
  }, null, 2)}\n`, "utf8");
  const replacement = `${options.packageRoot}.replacement`;
  await rm(replacement, { recursive: true, force: true });
  await rename(join(temporary, "package"), replacement);
  await rm(options.packageRoot, { recursive: true, force: true });
  await rename(replacement, options.packageRoot);
  console.log(JSON.stringify({ slug: manifest.slug, version, files: files.length, bytes: manifest.bytes, mediaDependency: manifest.mediaDependency }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
