import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function contentVersion(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex").slice(0, 12);
}

function versionedUrl(source, version) {
  const [pathname, hash = ""] = source.split("#", 2);
  const [base] = pathname.split("?", 1);
  return `${base}?v=${version}${hash ? `#${hash}` : ""}`;
}

function replaceRuntimeReference(source, pathname, version) {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.replace(new RegExp(`${escaped}(?:\\?[^\"']*)?`, "g"), versionedUrl(pathname, version));
}

function hasRuntimeReference(source, pathname) {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?:\\?[^\"']*)?`).test(source);
}

/**
 * Makes every mutable viewer runtime reference content-addressed. This keeps
 * packages coherent even when a customer uploads a new export over an older
 * directory and a long-lived mobile Safari cache still has previous files.
 */
export async function versionTourRuntime(root) {
  const bootstrapPath = join(root, "js", "tour-bootstrap.js");
  const bootstrapFiles = new Map([
    ["js/pannellum.js", join(root, "js", "pannellum.js")],
    ["js/tour-config.js", join(root, "js", "tour-config.js")],
    ["js/bounded-media-runtime.js", join(root, "js", "bounded-media-runtime.js")],
    ["js/tour-transition.js", join(root, "js", "tour-transition.js")],
    ["js/tour.js", join(root, "js", "tour.js")]
  ]);
  let bootstrap = await readFile(bootstrapPath, "utf8");
  for (const [pathname, path] of bootstrapFiles) {
    assert(existsSync(path), `Missing exported viewer runtime: ${path}`);
    assert(hasRuntimeReference(bootstrap, pathname), `Viewer bootstrap does not reference ${pathname}.`);
    const version = await contentVersion(path);
    const next = replaceRuntimeReference(bootstrap, pathname, version);
    assert(next.includes(versionedUrl(pathname, version)), `Viewer bootstrap could not version ${pathname}.`);
    bootstrap = next;
  }
  await writeFile(bootstrapPath, bootstrap, "utf8");

  const indexPath = join(root, "index.html");
  const entrypointFiles = new Map([
    ["css/pannellum.css", join(root, "css", "pannellum.css")],
    ["css/tour.css", join(root, "css", "tour.css")],
    ["js/tour-monitoring.js", join(root, "js", "tour-monitoring.js")],
    ["js/tour-bootstrap.js", bootstrapPath]
  ]);
  const chromePath = join(root, "js", "tour-chrome.js");
  if (existsSync(chromePath)) entrypointFiles.set("js/tour-chrome.js", chromePath);

  let entrypoint = await readFile(indexPath, "utf8");
  for (const [pathname, path] of entrypointFiles) {
    assert(hasRuntimeReference(entrypoint, pathname), `Viewer entrypoint does not reference ${pathname}.`);
    const version = await contentVersion(path);
    const next = replaceRuntimeReference(entrypoint, pathname, version);
    assert(next.includes(versionedUrl(pathname, version)), `Viewer entrypoint could not version ${pathname}.`);
    entrypoint = next;
  }
  await writeFile(indexPath, entrypoint, "utf8");
}
