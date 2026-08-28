#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const packageRoot = resolve(process.env.TOUR_RELEASE_PACKAGE_ROOT || "");
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "2c27f07dd34ae7433a723fad1cfdf139");
const bucket = String(process.env.R2_BUCKET || "");
const origin = String(process.env.R2_CDN_ORIGIN || "").replace(/\/$/, "");
const jurisdiction = String(process.env.R2_JURISDICTION || "eu");
const uploadConcurrency = positiveInteger("R2_UPLOAD_CONCURRENCY", 6, 8);
const verifyConcurrency = positiveInteger("R2_VERIFY_CONCURRENCY", 24, 24);
const evidencePath = process.env.R2_UPLOAD_EVIDENCE ? resolve(process.env.R2_UPLOAD_EVIDENCE) : null;
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

function positiveInteger(name, fallback, maximum) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

function digest(algorithm, body) {
  return createHash(algorithm).update(body).digest("hex");
}

function encodedKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function oauthToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    const { stdout } = await execFileAsync("/usr/bin/security", [
      "find-generic-password",
      "-s", process.env.CLOUDFLARE_KEYCHAIN_SERVICE || "Cloudflare RainDigit primary operator token",
      "-a", process.env.CLOUDFLARE_KEYCHAIN_ACCOUNT || "stekolshchykov@gmail.com",
      "-w",
    ], { maxBuffer: 1024 * 1024 });
    if (stdout.trim()) return stdout.trim();
  } catch {
    // Fall through to the existing Wrangler refresh session.
  }
  const configPath = join(homedir(), "Library", "Preferences", ".wrangler", "config", "default.toml");
  const config = await readFile(configPath, "utf8");
  const refreshToken = config.match(/^refresh_token = "(.+)"$/m)?.[1];
  if (!refreshToken) throw new Error("Cloudflare OAuth refresh session was not found; run `npx wrangler login`.");

  // Refresh at the beginning of every release. Wrangler access tokens can be
  // invalidated before their recorded expiry, so trusting expiration_time made
  // an otherwise valid unattended upload fail part-way through the workflow.
  const response = await fetch("https://dash.cloudflare.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "54d11594-84e4-41aa-b438-e81b8fa78ee7",
    }),
  });
  const grant = await response.json().catch(() => null);
  if (!response.ok || !grant?.access_token) {
    throw new Error(`Cloudflare OAuth refresh failed (${response.status}, ${String(grant?.error || "unknown_error")}).`);
  }
  const expiresAt = new Date(Date.now() + Number(grant.expires_in || 3600) * 1000).toISOString();
  const nextRefreshToken = grant.refresh_token || refreshToken;
  const quoteToml = (value) => JSON.stringify(String(value));
  const updated = config
    .replace(/^oauth_token = .*$/m, `oauth_token = ${quoteToml(grant.access_token)}`)
    .replace(/^expiration_time = .*$/m, `expiration_time = ${quoteToml(expiresAt)}`)
    .replace(/^refresh_token = .*$/m, `refresh_token = ${quoteToml(nextRefreshToken)}`);
  assert(updated !== config, "Wrangler OAuth configuration could not be refreshed safely.");
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, updated, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, configPath);
  return grant.access_token;
}

async function api(token, path, init = {}, attempt = 0) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "cf-r2-jurisdiction": jurisdiction,
      ...(init.headers || {}),
    },
  });
  if ((response.status === 429 || response.status >= 500) && attempt < 12) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30_000, 750 * 2 ** attempt) + Math.floor(Math.random() * 500);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    return api(token, path, init, attempt + 1);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(`${init.method || "GET"} ${path} returned ${response.status}: ${JSON.stringify(payload?.errors || payload)}`);
  }
  return payload;
}

async function pool(items, concurrency, worker, label) {
  let cursor = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
      completed += 1;
      if (completed % 100 === 0 || completed === items.length) {
        console.error(`${label}: ${completed}/${items.length}`);
      }
    }
  }));
}

async function listPrefix(token, prefix) {
  const objects = [];
  let cursor;
  do {
    const query = new URLSearchParams({ prefix, per_page: "1000" });
    if (cursor) query.set("cursor", cursor);
    const payload = await api(token, `/r2/buckets/${bucket}/objects?${query}`);
    objects.push(...payload.result);
    cursor = payload.result_info?.is_truncated ? payload.result_info.cursor : undefined;
  } while (cursor);
  return objects;
}

async function localFile(path, key, expected = null) {
  const body = await readFile(path);
  const file = {
    path,
    key,
    body,
    bytes: body.byteLength,
    md5: digest("md5", body),
    sha256: digest("sha256", body),
    contentType: mime.get(extname(path).toLowerCase()) || "application/octet-stream",
  };
  if (expected) {
    assert(file.bytes === expected.bytes, `${expected.path}: local byte count changed.`);
    assert(file.sha256 === expected.sha256, `${expected.path}: local SHA-256 changed.`);
  }
  return file;
}

async function upload(token, file) {
  await api(token, `/r2/buckets/${bucket}/objects/${encodedKey(file.key)}`, {
    method: "PUT",
    headers: { "Content-Type": file.contentType, "Cache-Control": immutable },
    body: file.body,
  });
}

async function fetchVerified(file, verificationTag, attempt = 0) {
  const response = await fetch(`${origin}/${file.key}?rdverify=${verificationTag}`, { cache: "no-store" });
  if ((response.status === 404 || response.status === 429 || response.status >= 500) && attempt < 8) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(15_000, 750 * 2 ** attempt) + Math.floor(Math.random() * 300);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    return fetchVerified(file, verificationTag, attempt + 1);
  }
  assert(response.ok, `${file.key}: CDN returned ${response.status}.`);
  const body = Buffer.from(await response.arrayBuffer());
  assert(body.byteLength === file.bytes && digest("sha256", body) === file.sha256, `${file.key}: CDN bytes differ from local release.`);
  assert(String(response.headers.get("cache-control") || "").includes("immutable"), `${file.key}: immutable cache policy is missing.`);
}

assert(packageRoot !== resolve(""), "TOUR_RELEASE_PACKAGE_ROOT is required.");
assert(bucket.endsWith("-dev"), "This candidate uploader accepts only an explicit DEV R2 bucket.");
assert(origin.startsWith("https://"), "R2_CDN_ORIGIN must be an HTTPS origin.");
assert(/^[a-f0-9]{32}$/.test(accountId), "CLOUDFLARE_ACCOUNT_ID is invalid.");

const token = await oauthToken();
const manifestPath = join(packageRoot, "release-manifest.json");
const manifestBody = await readFile(manifestPath);
const manifest = JSON.parse(manifestBody.toString("utf8"));
assert(manifest.schema === "raindigit-tour-multires-release/v2", "Unsupported release manifest.");
assert(manifest.immutablePrefix === `tours/${manifest.slug}/${manifest.packageVersion}/`, "Release prefix is not canonical and immutable.");
assert(manifest.fileCount === manifest.files.length, "Manifest inventory count is invalid.");

const payloadFiles = await Promise.all(manifest.files.map((entry) =>
  localFile(join(packageRoot, entry.path), `${manifest.immutablePrefix}${entry.path}`, entry)
));
const manifestFile = await localFile(manifestPath, `${manifest.immutablePrefix}release-manifest.json`);
const allFiles = [...payloadFiles, manifestFile];
const remoteBefore = await listPrefix(token, manifest.immutablePrefix);
const remoteByKey = new Map(remoteBefore.map((object) => [object.key, object]));
const missingPayload = [];
let reused = 0;
for (const file of payloadFiles) {
  const remote = remoteByKey.get(file.key);
  if (!remote) {
    missingPayload.push(file);
    continue;
  }
  const etag = String(remote.etag || "").replace(/^"|"$/g, "");
  assert(Number(remote.size) === file.bytes && etag === file.md5, `${file.key}: immutable collision; refusing overwrite.`);
  reused += 1;
}
const remoteManifest = remoteByKey.get(manifestFile.key);
if (remoteManifest) {
  const response = await fetch(`${origin}/${manifestFile.key}?rdverify=${manifest.contentDigest.slice(0, 16)}`, { cache: "no-store" });
  assert(response.ok, "Remote manifest inventory exists but CDN retrieval failed.");
  const body = Buffer.from(await response.arrayBuffer());
  assert(digest("sha256", body) === manifestFile.sha256, "Immutable manifest collision.");
  reused += 1;
}

const uploadStartedAt = performance.now();
await pool(missingPayload, uploadConcurrency, (file) => upload(token, file), "R2 API upload");
let uploaded = missingPayload.length;
if (!remoteManifest) {
  await upload(token, manifestFile);
  uploaded += 1;
}
const uploadMs = Math.round(performance.now() - uploadStartedAt);

const inventoryVerifyStartedAt = performance.now();
const remoteAfter = await listPrefix(token, manifest.immutablePrefix);
assert(remoteAfter.length === allFiles.length, `R2 object count ${remoteAfter.length} != local ${allFiles.length}.`);
const remoteAfterByKey = new Map(remoteAfter.map((object) => [object.key, object]));
for (const file of allFiles) {
  const remote = remoteAfterByKey.get(file.key);
  const etag = String(remote?.etag || "").replace(/^"|"$/g, "");
  assert(remote && Number(remote.size) === file.bytes && etag === file.md5, `${file.key}: R2 inventory verification failed.`);
}
const inventoryVerifyMs = Math.round(performance.now() - inventoryVerifyStartedAt);

const cdnVerifyStartedAt = performance.now();
const verificationTag = manifest.contentDigest.slice(0, 16);
await pool(allFiles, verifyConcurrency, (file) => fetchVerified(file, verificationTag), "CDN full-byte verify");
const cdnVerifyMs = Math.round(performance.now() - cdnVerifyStartedAt);

const evidence = {
  schema: "raindigit-r2-cloudflare-upload-evidence/v1",
  generatedAt: new Date().toISOString(),
  transport: "Cloudflare REST API with environment, Keychain, or refreshed Wrangler OAuth authentication",
  environment: "dev",
  bucket,
  jurisdiction,
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
  fullInventoryVerified: allFiles.length,
  fullCdnBytesVerified: allFiles.length,
  timings: {
    uploadMs,
    inventoryVerifyMs,
    cdnVerifyMs,
    totalMs: uploadMs + inventoryVerifyMs + cdnVerifyMs,
  },
  manifestLast: true,
  entrypoint: `${origin}/${manifest.entrypoint}`,
};
if (evidencePath) {
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(evidence, null, 2));
