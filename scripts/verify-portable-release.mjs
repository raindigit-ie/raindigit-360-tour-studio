#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { assertPortableRelease, assertReleaseContract, assertSemver, digestInventory, releaseContract, studioVersion } from "./lib/release-contract.mjs";
import { assertBoundedMediaInventory } from "./lib/bounded-media-contract.mjs";

function parseArguments(argv) {
  const options = { packageRoot: null, slug: null, environment: "dev" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--package") options.packageRoot = resolve(argv[++index] || "");
    else if (argument === "--slug") options.slug = String(argv[++index] || "");
    else if (argument === "--environment") options.environment = String(argv[++index] || "");
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.packageRoot || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug || "")) throw new Error("--package and a valid --slug are required.");
  if (!["dev", "prod"].includes(options.environment)) throw new Error("--environment must be dev or prod.");
  return options;
}

export async function verifyPortableRelease(packageRoot, slug, environment = "dev") {
  assertReleaseContract();
  const pointerPath = join(packageRoot, "channels", environment, slug, "current.json");
  const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  if (pointer.schema !== "raindigit-tour-channel/v1" || pointer.environment !== environment || pointer.slug !== slug) throw new Error("Channel manifest identity is invalid.");
  const releaseRoot = join(packageRoot, pointer.prefix);
  const manifest = JSON.parse(await readFile(join(releaseRoot, "release-manifest.json"), "utf8"));
  if (manifest.schema !== "raindigit-tour-bounded-release/v1") throw new Error("Release is not on the bounded-media portable contract.");
  for (const [label, value] of [["Studio version", manifest.studioVersion], ["Format version", manifest.formatVersion], ["Runtime version", manifest.runtimeVersion], ["Tour version", manifest.tourVersion]]) assertSemver(value, label);
  if (manifest.studioVersion !== studioVersion || manifest.formatVersion !== releaseContract.formatVersion || manifest.runtimeVersion !== releaseContract.runtimeVersion) throw new Error("Release versions are incompatible with this Studio contract.");
  if (manifest.packageVersion !== pointer.packageVersion || manifest.version !== pointer.packageVersion || manifest.contentDigest !== pointer.contentDigest) throw new Error("Channel and package identities do not match.");
  if (manifest.mediaDependency) throw new Error("Thin media dependencies are forbidden by the portable contract.");
  if (manifest.deliveryCapability !== "bounded-media-v1" ||
      manifest.mediaProfile !== "bounded-equirect-base-mobile4096-desktop8192-fallback-v1" ||
      manifest.mediaRecipeVersion !== "progressive-equirectangular-v1" ||
      manifest.mediaRecipe !== manifest.mediaRecipeVersion ||
      manifest.compilerRecipe !== "sharp-bounded-equirect-base2048-mobile4096-desktop8192-fallback1024-webp82-jpeg86-v1") {
    throw new Error("Release bounded-media tuple is invalid.");
  }
  if (manifest.fileCount !== manifest.files.length || digestInventory(manifest.files) !== manifest.contentDigest) throw new Error("Release inventory digest is invalid.");
  for (const file of manifest.files) {
    const body = await readFile(join(releaseRoot, file.path));
    if (body.byteLength !== file.bytes || createHash("sha256").update(body).digest("hex") !== file.sha256) throw new Error(`Release inventory mismatch: ${file.path}`);
  }
  const configSource = await readFile(join(releaseRoot, "js", "tour-config.js"), "utf8");
  const context = { window: {} };
  vm.runInNewContext(configSource, context);
  await assertPortableRelease(releaseRoot, context.window.TOUR_CONFIG);
  await assertBoundedMediaInventory(releaseRoot, context.window.TOUR_CONFIG, manifest);
  const changelog = JSON.parse(await readFile(join(releaseRoot, manifest.changelog.machine), "utf8"));
  const entry = changelog.releases?.find((release) => release.tourVersion === manifest.tourVersion);
  if (!entry || entry.verificationProfile !== manifest.verificationProfile || entry.summary !== manifest.changelog.summary) throw new Error("Tour changelog does not describe the selected package.");
  return { pointer, manifest, releaseRoot };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const options = parseArguments(process.argv.slice(2));
  verifyPortableRelease(options.packageRoot, options.slug, options.environment)
    .then(({ pointer, manifest }) => console.log(JSON.stringify({ ok: true, environment: options.environment, slug: options.slug, tourVersion: manifest.tourVersion, packageVersion: pointer.packageVersion, contentDigest: pointer.contentDigest, files: manifest.fileCount }, null, 2)))
    .catch((error) => { console.error(error.message); process.exit(1); });
}
