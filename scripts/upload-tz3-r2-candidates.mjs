import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "2c27f07dd34ae7433a723fad1cfdf139";
const BUCKET = process.env.R2_BUCKET || "raindigit-tours";
const JURISDICTION = process.env.R2_JURISDICTION || "eu";
const CDN_ORIGIN = (process.env.R2_CDN_ORIGIN || "https://cdn.raindigit.ie").replace(/\/$/, "");
const packagesRoot = resolve(process.env.TZ3_PACKAGES_ROOT || ".artifacts/tz3/packages");
const immutable = "public, max-age=31536000, immutable";
const concurrency = Number(process.env.TZ3_UPLOAD_CONCURRENCY || 6);
const expectedReleaseCount = Number(process.env.TZ3_EXPECTED_RELEASES || 2);
const releaseSlugs = new Set((process.env.TZ3_RELEASE_SLUGS || "")
  .split(",")
  .map((slug) => slug.trim())
  .filter(Boolean));
const evidencePath = resolve(process.env.TZ3_UPLOAD_EVIDENCE || ".artifacts/tz3/r2-candidate-upload.json");
const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"],
  [".svg", "image/svg+xml"], [".txt", "text/plain; charset=utf-8"]
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }))).flat();
}

async function oauthToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const config = await readFile(join(homedir(), "Library/Preferences/.wrangler/config/default.toml"), "utf8");
  const token = config.match(/^oauth_token = "(.+)"$/m)?.[1];
  if (!token) throw new Error("Cloudflare OAuth token was not found. Run `npx wrangler login`.");
  return token;
}

function encodedKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function api(token, path, init = {}, attempt = 0) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "cf-r2-jurisdiction": JURISDICTION,
      ...(init.headers || {})
    }
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

async function listPrefix(token, prefix) {
  const objects = [];
  let cursor;
  do {
    const query = new URLSearchParams({ prefix, per_page: "1000" });
    if (cursor) query.set("cursor", cursor);
    const payload = await api(token, `/r2/buckets/${BUCKET}/objects?${query}`);
    objects.push(...payload.result);
    cursor = payload.result_info?.is_truncated ? payload.result_info.cursor : undefined;
  } while (cursor);
  return objects;
}

async function parallel(items, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }));
}

const token = await oauthToken();
if (!Number.isInteger(expectedReleaseCount) || expectedReleaseCount < 1) {
  throw new Error("TZ3_EXPECTED_RELEASES must be a positive integer.");
}
const packageDirectories = (await readdir(packagesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packagesRoot, entry.name));
const releases = [];
for (const packageDirectory of packageDirectories) {
  const releaseDirectories = (await walk(join(packageDirectory, "tours")))
    .filter((path) => path.endsWith("/release-manifest.json"));
  for (const manifestPath of releaseDirectories) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!manifest.version.startsWith("multires-")) continue;
    const root = resolve(manifestPath, "..");
    releases.push({ manifest, root });
  }
}
if (releases.length !== expectedReleaseCount) {
  throw new Error(
    `Expected exactly ${expectedReleaseCount} candidate release(s), found ${releases.length}.`,
  );
}
const selectedReleases = releaseSlugs.size
  ? releases.filter((release) => releaseSlugs.has(release.manifest.slug))
  : releases;
if (selectedReleases.length !== (releaseSlugs.size || releases.length)) {
  throw new Error(`Requested ${releaseSlugs.size} candidate releases, found ${selectedReleases.length}.`);
}

const evidence = [];
for (const release of selectedReleases.sort((a, b) => a.manifest.slug.localeCompare(b.manifest.slug))) {
  const prefix = release.manifest.immutablePrefix;
  if (!prefix.startsWith(`tours/${release.manifest.slug}/multires-`)) throw new Error(`${prefix}: unsafe candidate prefix.`);
  const files = (await walk(release.root)).sort();
  const local = await Promise.all(files.map(async (path) => {
    const body = await readFile(path);
    const key = `${prefix}${relative(release.root, path).replaceAll("\\", "/")}`;
    return {
      path, key, body, bytes: body.byteLength,
      md5: createHash("md5").update(body).digest("hex"),
      sha256: createHash("sha256").update(body).digest("hex")
    };
  }));
  const remoteBefore = await listPrefix(token, prefix);
  const remoteByKey = new Map(remoteBefore.map((object) => [object.key, object]));
  let reused = 0;
  let uploaded = 0;
  const syncStartedAt = performance.now();
  await parallel(local, async (file, index) => {
    const existing = remoteByKey.get(file.key);
    if (existing) {
      if (existing.etag !== file.md5 || Number(existing.size) !== file.bytes) {
        throw new Error(`${file.key}: immutable collision; refusing to overwrite existing R2 object.`);
      }
      reused += 1;
      return;
    }
    await api(token, `/r2/buckets/${BUCKET}/objects/${encodedKey(file.key)}`, {
      method: "PUT",
      headers: {
        "Content-Type": mime.get(extname(file.path).toLowerCase()) || "application/octet-stream",
        "Cache-Control": immutable
      },
      body: file.body
    });
    uploaded += 1;
    if ((index + 1) % 1000 === 0) console.log(`${release.manifest.slug}: processed ${index + 1}/${local.length}`);
  });
  const syncMs = Math.round(performance.now() - syncStartedAt);

  const inventoryVerifyStartedAt = performance.now();
  const remoteAfter = await listPrefix(token, prefix);
  if (remoteAfter.length !== local.length) throw new Error(`${prefix}: R2 object count ${remoteAfter.length} != local ${local.length}.`);
  const remoteBytes = remoteAfter.reduce((sum, object) => sum + Number(object.size), 0);
  const localBytes = local.reduce((sum, file) => sum + file.bytes, 0);
  if (remoteBytes !== localBytes) throw new Error(`${prefix}: R2 byte count ${remoteBytes} != local ${localBytes}.`);
  const remoteAfterByKey = new Map(remoteAfter.map((object) => [object.key, object]));
  for (const file of local) {
    const remote = remoteAfterByKey.get(file.key);
    const etag = String(remote?.etag || "").replace(/^\"|\"$/g, "");
    if (!remote || Number(remote.size) !== file.bytes || etag !== file.md5) {
      throw new Error(`${file.key}: full R2 inventory verification failed.`);
    }
  }
  const inventoryVerifyMs = Math.round(
    performance.now() - inventoryVerifyStartedAt,
  );

  const sampleVerifyStartedAt = performance.now();
  const samples = [0, 1, 2, ...Array.from({ length: 7 }, (_, index) => Math.floor(index * (local.length - 1) / 6))]
    .map((index) => local[index])
    .filter((file, index, list) => list.findIndex((candidate) => candidate.key === file.key) === index);
  const verifiedSamples = [];
  for (const file of samples) {
    const response = await fetch(`${CDN_ORIGIN}/${file.key}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${file.key}: CDN returned ${response.status}.`);
    const body = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (sha256 !== file.sha256) throw new Error(`${file.key}: CDN SHA-256 mismatch.`);
    verifiedSamples.push({ key: file.key, bytes: body.byteLength, sha256, cacheControl: response.headers.get("cache-control") });
  }
  const sampleVerifyMs = Math.round(performance.now() - sampleVerifyStartedAt);
  evidence.push({
    slug: release.manifest.slug,
    version: release.manifest.version,
    prefix,
    localFiles: local.length,
    localBytes,
    uploaded,
    reused,
    remoteFiles: remoteAfter.length,
    remoteBytes,
    fullInventoryVerified: local.length,
    timings: {
      syncMs,
      inventoryVerifyMs,
      sampleVerifyMs,
      totalMs: syncMs + inventoryVerifyMs + sampleVerifyMs,
    },
    verifiedSamples
  });
  console.log(`${release.manifest.slug}: ${uploaded} uploaded, ${reused} reused, ${remoteAfter.length} verified.`);
}

const report = { generatedAt: new Date().toISOString(), bucket: BUCKET, jurisdiction: JURISDICTION, releases: evidence };
await mkdir(resolve(evidencePath, ".."), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
