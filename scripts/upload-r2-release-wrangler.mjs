#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(process.env.TOUR_RELEASE_PACKAGE_ROOT || "");
const bucket = String(process.env.R2_BUCKET || "");
const origin = String(process.env.R2_CDN_ORIGIN || "").replace(/\/$/, "");
const jurisdiction = String(process.env.R2_JURISDICTION || "eu");
const uploadConcurrency = positiveInteger("R2_UPLOAD_CONCURRENCY", 12);
const verifyConcurrency = positiveInteger("R2_VERIFY_CONCURRENCY", 24);
if (uploadConcurrency > 12) {
  throw new Error("R2_UPLOAD_CONCURRENCY must stay at or below the verified Cloudflare limit of 12.");
}
if (verifyConcurrency > 24) {
  throw new Error("R2_VERIFY_CONCURRENCY must stay at or below the verified CDN limit of 24.");
}
const evidencePath = process.env.R2_UPLOAD_EVIDENCE
  ? resolve(process.env.R2_UPLOAD_EVIDENCE)
  : null;
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const wrangler = process.env.WRANGLER_BIN || join(projectRoot, "node_modules", ".bin", "wrangler");
const immutable = "public, max-age=31536000, immutable";
const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function contentType(path) {
  return mime.get(extname(path).toLowerCase()) || "application/octet-stream";
}

async function pool(items, concurrency, worker, label) {
  let cursor = 0;
  let completed = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index], index);
        completed += 1;
        if (completed % 50 === 0 || completed === items.length) {
          console.error(`${label}: ${completed}/${items.length}`);
        }
      }
    }),
  );
}

async function retry(worker, label, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await worker();
    } catch (error) {
      lastError = error;
      const diagnostic = `${error?.stderr || ""}\n${error?.stdout || ""}`;
      if (/Unknown argument|Unknown arguments|not enough non-option arguments/i.test(diagnostic)) {
        throw error;
      }
      if (attempt === attempts - 1) break;
      const delay = Number.isFinite(error.retryAfterMs)
        ? error.retryAfterMs
        : Math.min(15_000, 750 * 2 ** attempt) + Math.floor(Math.random() * 300);
      console.error(`${label}: retry ${attempt + 1}/${attempts - 1} in ${delay}ms`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    }
  }
  throw lastError;
}

async function wranglerContract() {
  const [{ stdout: versionOutput }, { stdout: putHelp }] = await Promise.all([
    execFileAsync(wrangler, ["--version"], { timeout: 30_000 }),
    execFileAsync(wrangler, ["r2", "object", "put", "--help"], { timeout: 30_000 }),
  ]);
  assert(/--file\b/.test(putHelp), "Wrangler R2 put does not expose the required --file option.");
  assert(/--content-type\b/.test(putHelp), "Wrangler R2 put does not expose --content-type.");
  assert(/--cache-control\b/.test(putHelp), "Wrangler R2 put does not expose --cache-control.");
  return Object.freeze({
    version: String(versionOutput).trim(),
    remoteFlag: /--remote\b/.test(putHelp),
    jurisdictionFlag: /--jurisdiction\b/.test(putHelp),
    forceFlag: /--force\b/.test(putHelp),
  });
}

async function localFile(path, key, expected = null) {
  const body = await readFile(path);
  const file = {
    path,
    key,
    bytes: body.byteLength,
    sha256: sha256(body),
    contentType: contentType(path),
  };
  if (expected) {
    assert(file.bytes === expected.bytes, `${expected.path}: local byte count changed.`);
    assert(file.sha256 === expected.sha256, `${expected.path}: local SHA-256 changed.`);
  }
  return file;
}

async function upload(file, cli) {
  const arguments_ = [
    "r2",
    "object",
    "put",
    `${bucket}/${file.key}`,
  ];
  if (cli.remoteFlag) arguments_.push("--remote");
  if (cli.jurisdictionFlag) arguments_.push("--jurisdiction", jurisdiction);
  arguments_.push(
    "--file",
    file.path,
    "--content-type",
    file.contentType,
    "--cache-control",
    immutable,
  );
  if (cli.forceFlag) arguments_.push("--force");
  await retry(
    () =>
      execFileAsync(
        wrangler,
        arguments_,
        { maxBuffer: 8 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      ),
    `upload ${file.key}`,
  );
}

async function fetchVerified(file, verificationTag) {
  await retry(async () => {
    const url = `${origin}/${file.key}?rdverify=${verificationTag}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      const error = new Error(`${file.key}: CDN returned ${response.status}.`);
      const retryAfter = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        error.retryAfterMs = retryAfter * 1000;
      }
      throw error;
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength !== file.bytes || sha256(body) !== file.sha256) {
      throw new Error(`${file.key}: CDN bytes differ from the local release.`);
    }
    if (!String(response.headers.get("cache-control") || "").includes("immutable")) {
      throw new Error(`${file.key}: immutable cache policy is missing.`);
    }
  }, `verify ${file.key}`, 8);
}

assert(packageRoot !== resolve(""), "TOUR_RELEASE_PACKAGE_ROOT is required.");
assert(bucket.endsWith("-dev"), "This candidate uploader accepts only an explicit DEV R2 bucket.");
assert(origin.startsWith("https://"), "R2_CDN_ORIGIN must be an HTTPS origin.");
const cli = await wranglerContract();

const manifestPath = join(packageRoot, "release-manifest.json");
const manifestBody = await readFile(manifestPath);
const manifest = JSON.parse(manifestBody.toString("utf8"));
assert(manifest.schema === "raindigit-tour-multires-release/v2", "Unsupported release manifest.");
assert(
  manifest.immutablePrefix === `tours/${manifest.slug}/${manifest.packageVersion}/`,
  "Release prefix is not the canonical immutable package path.",
);
assert(manifest.fileCount === manifest.files.length, "Manifest inventory count is invalid.");

const payloadFiles = await Promise.all(
  manifest.files.map((entry) =>
    localFile(join(packageRoot, entry.path), `${manifest.immutablePrefix}${entry.path}`, entry),
  ),
);
const manifestFile = await localFile(
  manifestPath,
  `${manifest.immutablePrefix}release-manifest.json`,
);
const allFiles = [...payloadFiles, manifestFile];
const verificationTag = manifest.contentDigest.slice(0, 16);
const remoteManifestUrl = `${origin}/${manifestFile.key}?rdverify=${verificationTag}`;
const remoteManifestResponse = await fetch(remoteManifestUrl, { cache: "no-store" });
let uploaded = 0;
let reused = 0;
const uploadStartedAt = performance.now();

if (remoteManifestResponse.ok) {
  const remoteManifest = await remoteManifestResponse.json();
  assert(
    remoteManifest.contentDigest === manifest.contentDigest,
    "Immutable prefix collision: remote manifest has a different digest.",
  );
  reused = allFiles.length;
} else {
  assert(remoteManifestResponse.status === 404, `Remote manifest probe returned ${remoteManifestResponse.status}.`);
  await pool(payloadFiles, uploadConcurrency, (file) => upload(file, cli), "R2 upload");
  // The manifest is the immutable completion marker and is always written last.
  await upload(manifestFile, cli);
  uploaded = allFiles.length;
}
const uploadMs = Math.round(performance.now() - uploadStartedAt);

const verifyStartedAt = performance.now();
await pool(
  allFiles,
  verifyConcurrency,
  (file) => fetchVerified(file, verificationTag),
  "R2 full-byte verify",
);
const verifyMs = Math.round(performance.now() - verifyStartedAt);

const evidence = {
  schema: "raindigit-r2-wrangler-upload-evidence/v1",
  generatedAt: new Date().toISOString(),
  environment: "dev",
  bucket,
  origin,
  slug: manifest.slug,
  packageVersion: manifest.packageVersion,
  contentDigest: manifest.contentDigest,
  files: allFiles.length,
  bytes: allFiles.reduce((sum, file) => sum + file.bytes, 0),
  uploaded,
  reused,
  uploadConcurrency,
  verifyConcurrency,
  wrangler: cli,
  fullByteVerified: allFiles.length,
  timings: { uploadMs, verifyMs, totalMs: uploadMs + verifyMs },
  entrypoint: `${origin}/${manifest.entrypoint}`,
};

if (evidencePath) {
  await mkdir(resolve(evidencePath, ".."), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(evidence, null, 2));
