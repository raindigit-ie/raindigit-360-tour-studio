import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../..");
const packageMetadata = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
export const releaseContract = Object.freeze(JSON.parse(readFileSync(join(projectRoot, "config", "release-contract.json"), "utf8")));
export const studioVersion = packageMetadata.version;

export function assertSemver(value, label) {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(value || ""))) {
    throw new Error(`${label} must be a Semantic Version such as 1.0.0.`);
  }
  return String(value);
}

export function assertReleaseContract() {
  if (releaseContract.schema !== "raindigit-tour-release-contract/v1") throw new Error("Unsupported release contract schema.");
  assertSemver(studioVersion, "Studio version");
  assertSemver(releaseContract.formatVersion, "Portable format version");
  assertSemver(releaseContract.runtimeVersion, "Runtime version");
  if (!/^raindigit-portable-tour-v\d+$/.test(releaseContract.verificationProfile)) throw new Error("Invalid verification profile.");
  if (!Array.isArray(releaseContract.capabilities) || releaseContract.capabilities.length < 1 || new Set(releaseContract.capabilities).size !== releaseContract.capabilities.length) {
    throw new Error("Release capabilities must be a non-empty unique list.");
  }
  if (!releaseContract.capabilities.includes("self-contained-media")) throw new Error("The current release contract must require self-contained media.");
}

export function releaseIdentity({ tourVersion, previousTourVersion = null }) {
  assertReleaseContract();
  const requestedTourVersion = tourVersion == null || tourVersion === '' ? studioVersion : assertSemver(tourVersion, "Tour version");
  if (requestedTourVersion !== studioVersion) {
    throw new Error(`Tour capability version must equal Studio ${studioVersion}; received ${requestedTourVersion}. Package version remains the independent content identity.`);
  }
  return {
    studioVersion,
    formatVersion: releaseContract.formatVersion,
    runtimeVersion: releaseContract.runtimeVersion,
    tourVersion: studioVersion,
    previousTourVersion: previousTourVersion ? assertSemver(previousTourVersion, "Previous tour version") : null,
    verificationProfile: releaseContract.verificationProfile,
    capabilities: [...releaseContract.capabilities]
  };
}

function normalizeSummary(summary) {
  const value = String(summary || "").trim().replace(/\s+/g, " ");
  if (value.length < 8 || value.length > 240) throw new Error("--change-summary must describe this tour version in 8..240 characters.");
  return value;
}

export async function writeReleaseChangelog(root, { slug, title, tourVersion, previousTourVersion = null, changeSummary }) {
  const identity = releaseIdentity({ tourVersion, previousTourVersion });
  const summary = normalizeSummary(changeSummary);
  const entry = {
    schema: "raindigit-tour-changelog/v1",
    slug,
    title,
    tourVersion: identity.tourVersion,
    previousTourVersion: identity.previousTourVersion,
    studioVersion: identity.studioVersion,
    formatVersion: identity.formatVersion,
    runtimeVersion: identity.runtimeVersion,
    summary,
    capabilities: identity.capabilities,
    verificationProfile: identity.verificationProfile
  };
  await writeFile(join(root, "CHANGELOG.json"), `${JSON.stringify({ schema: "raindigit-tour-changelog-ledger/v1", releases: [entry] }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "CHANGELOG.md"), [
    `# ${title} — tour changelog`,
    "",
    `## ${identity.tourVersion}`,
    "",
    summary,
    "",
    `- Studio: ${identity.studioVersion}`,
    `- Portable format: ${identity.formatVersion}`,
    `- Viewer runtime: ${identity.runtimeVersion}`,
    `- Previous tour version: ${identity.previousTourVersion || "none"}`,
    `- Verification profile: ${identity.verificationProfile}`,
    `- Capabilities: ${identity.capabilities.join(", ")}`,
    ""
  ].join("\n"), "utf8");
  return entry;
}

function executableOrMediaReference(value) {
  return /(?:\.css|\.m?js|\.webp|\.avif|\.jpe?g|\.png|\.svg)(?:[?#]|$)/i.test(value) || value.startsWith("data:");
}

export async function assertPortableRelease(root, config) {
  if (config?.scenes?.length < 1) throw new Error("Portable release has no scenes.");
  if (config.scenes.some((scene) => /^https?:\/\//i.test(scene.thumb || "") || /^https?:\/\//i.test(scene.panorama || "") || /^https?:\/\//i.test(scene.multiRes?.basePath || ""))) {
    throw new Error("Portable release contains an external scene-media dependency.");
  }
  const required = ["index.html", "css/pannellum.css", "css/tour.css", "js/pannellum.js", "js/tour-bootstrap.js", "js/tour-config.js", "js/tour-monitoring.js", "js/generated/sentry-browser-10.71.0.min.js", "js/tour-transition.js", "js/tour.js", "CHANGELOG.json", "CHANGELOG.md", "INSTALL.txt"];
  await Promise.all(required.map(async (path) => {
    const body = await readFile(join(root, path));
    if (body.byteLength === 0) throw new Error(`Portable release file is empty: ${path}`);
  }));
  const sources = await Promise.all(["index.html", "js/tour-bootstrap.js", "js/tour-config.js", "js/tour-monitoring.js"].map(async (path) => [path, await readFile(join(root, path), "utf8")]));
  for (const [path, source] of sources) {
    for (const match of source.matchAll(/(?:src|href|basePath|thumb|panorama)["']?\s*[:=]\s*["']([^"']+)/g)) {
      const reference = match[1];
      if (/^https?:\/\//i.test(reference) && executableOrMediaReference(reference)) throw new Error(`${path} contains an external executable/media reference: ${reference}`);
    }
  }
}

export function digestInventory(files) {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(String(file.bytes));
    digest.update("\0");
    digest.update(file.sha256);
    digest.update("\0");
  }
  return digest.digest("hex");
}

export function devChannelPointer({ slug, packageVersion, previousPackageVersion, immutablePrefix, contentDigest, generatedAt, identity, manifestPath }) {
  return {
    schema: "raindigit-tour-channel/v1",
    environment: "dev",
    slug,
    studioVersion: identity.studioVersion,
    formatVersion: identity.formatVersion,
    runtimeVersion: identity.runtimeVersion,
    tourVersion: identity.tourVersion,
    packageVersion,
    previousPackageVersion: previousPackageVersion || null,
    prefix: immutablePrefix,
    entrypoint: `${immutablePrefix}index.html`,
    releaseManifest: manifestPath,
    contentDigest,
    verificationProfile: identity.verificationProfile,
    updatedAt: generatedAt
  };
}
