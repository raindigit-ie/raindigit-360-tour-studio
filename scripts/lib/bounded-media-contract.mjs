import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export const DELIVERY_CAPABILITY = "bounded-media-v1";
export const MEDIA_PROFILE =
  "bounded-equirect-base-mobile4096-desktop8192-fallback-v1";
export const MEDIA_RECIPE_VERSION = "progressive-equirectangular-v1";
export const COMPILER_RECIPE =
  "sharp-bounded-equirect-base2048-mobile4096-desktop8192-fallback1024-webp82-jpeg86-v1";
export const MIN_OBJECTS = 2;
export const HARD_MAX_OBJECTS = 5;
export const REQUIRED_OBJECT_ROLES = Object.freeze([
  "base",
  "mobile-detail",
  "desktop-detail",
  "fallback",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function releasePath(value, label) {
  assert(typeof value === "string" && value.length > 0, label + " path is missing.");
  assert(!value.startsWith("/") && !value.includes("\0"), label + " path must be relative.");
  const normal = value.split("\\").join("/");
  assert(!normal.split("/").includes(".."), label + " path escapes the package.");
  return normal;
}

function mediaObjects(media, sceneId) {
  assert(media && typeof media === "object", sceneId + " bounded media metadata is missing.");
  assert(media.deliveryCapability === DELIVERY_CAPABILITY, sceneId + " delivery capability is incompatible.");
  assert(media.mediaProfile === MEDIA_PROFILE, sceneId + " media profile is incompatible.");
  assert(media.mediaRecipeVersion === MEDIA_RECIPE_VERSION, sceneId + " media recipe version is incompatible.");
  assert(media.compilerRecipe === COMPILER_RECIPE, sceneId + " compiler recipe is incompatible.");
  assert(Array.isArray(media.objects), sceneId + " bounded media object list is missing.");
  assert(
    Number.isInteger(media.objectCount) &&
      media.objectCount >= MIN_OBJECTS &&
      media.objectCount <= HARD_MAX_OBJECTS,
    `${sceneId} must contain ${MIN_OBJECTS}..${HARD_MAX_OBJECTS} bounded media objects.`,
  );
  assert(
    media.objectCount === media.objects.length,
    sceneId + " declared media object count does not match its object list.",
  );
  assert(
    media.objectCount === REQUIRED_OBJECT_ROLES.length,
    sceneId + " current bounded recipe must declare exactly four media objects.",
  );
  const roles = media.objects.map((object) => object?.role);
  assert(
    JSON.stringify(roles) === JSON.stringify(REQUIRED_OBJECT_ROLES),
    sceneId + " bounded media roles are not canonical.",
  );
  const fieldByRole = {
    base: "base",
    "mobile-detail": "mobileDetail",
    "desktop-detail": "desktopDetail",
    fallback: "fallback",
  };
  return media.objects.map((object) => {
    const path = releasePath(object.path, sceneId + " " + object.role);
    assert(media[fieldByRole[object.role]] === path, sceneId + " " + object.role + " path is not bound to the object.");
    assert(Number.isInteger(object.width) && object.width > 0, sceneId + " " + object.role + " width is invalid.");
    assert(Number.isInteger(object.height) && object.height > 0, sceneId + " " + object.role + " height is invalid.");
    assert(object.height * 2 === object.width, sceneId + " " + object.role + " must remain 2:1.");
    assert(typeof object.codec === "string" && object.codec.length > 0, sceneId + " " + object.role + " codec is missing.");
    assert(["all", "mobile-webkit", "desktop", "non-webgl"].includes(object.target), sceneId + " " + object.role + " target is invalid.");
    const digest = media.mediaDigests?.[object.role];
    assert(digest?.path === path, sceneId + " " + object.role + " digest path is not bound.");
    assert(Number.isInteger(digest.bytes) && digest.bytes > 0, sceneId + " " + object.role + " digest byte count is invalid.");
    assert(/^[a-f0-9]{64}$/.test(digest.sha256 || ""), sceneId + " " + object.role + " digest is invalid.");
    assert(object.bytes === digest.bytes, sceneId + " " + object.role + " object byte count is not bound to its digest.");
    assert(object.sha256 === digest.sha256, sceneId + " " + object.role + " object digest is not bound to its digest.");
    return { ...object, path };
  });
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else output.push(path);
  }
  return output;
}

export function expectedMediaInventory(config) {
  assert(config?.scenes?.length > 0, "Bounded release has no scenes.");
  assert(config.deliveryCapability === DELIVERY_CAPABILITY, "Bounded package delivery capability is incompatible.");
  assert(config.mediaProfile === MEDIA_PROFILE, "Bounded package media profile is incompatible.");
  assert(config.mediaRecipeVersion === MEDIA_RECIPE_VERSION, "Bounded package media recipe version is incompatible.");
  assert(config.mediaRecipe === MEDIA_RECIPE_VERSION, "Bounded package media recipe alias is incompatible.");
  assert(config.compilerRecipe === COMPILER_RECIPE, "Bounded package compiler recipe is incompatible.");
  return config.scenes.flatMap((scene) =>
    mediaObjects(scene.boundedMedia, scene.id).map((object) => {
      const digest = scene.boundedMedia.mediaDigests[object.role];
      return {
        sceneId: scene.id,
        role: object.role,
        path: object.path,
        bytes: digest.bytes,
        sha256: digest.sha256,
        width: object.width,
        height: object.height,
        codec: object.codec,
        target: object.target,
      };
    }),
  ).sort((left, right) => left.path.localeCompare(right.path));
}

export async function assertBoundedMediaInventory(root, config, manifest = null) {
  const expected = expectedMediaInventory(config);
  const expectedPaths = new Set(expected.map((file) => file.path));
  let actualPaths = [];
  try {
    actualPaths = (await walk(join(root, "assets", "bm"))).map((file) =>
      relative(root, file).split("\\").join("/"),
    ).sort();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  assert(
    actualPaths.length === expectedPaths.size &&
      actualPaths.every((path) => expectedPaths.has(path)),
    "Actual bounded-media topology does not match the declared object inventory.",
  );
  const actual = [];
  for (const item of expected) {
    const body = await readFile(join(root, item.path));
    const sha256 = createHash("sha256").update(body).digest("hex");
    assert(body.byteLength === item.bytes, "Bounded-media byte count mismatch: " + item.path);
    assert(sha256 === item.sha256, "Bounded-media digest mismatch: " + item.path);
    actual.push(item);
  }
  assert(JSON.stringify(actual) === JSON.stringify(expected), "Bounded-media inventory is not deterministic.");
  if (manifest) {
    assert(manifest.deliveryCapability === DELIVERY_CAPABILITY, "Manifest delivery capability is incompatible.");
    assert(manifest.mediaProfile === MEDIA_PROFILE, "Manifest media profile is incompatible.");
    assert(manifest.mediaRecipeVersion === MEDIA_RECIPE_VERSION, "Manifest media recipe version is incompatible.");
    assert(manifest.mediaRecipe === MEDIA_RECIPE_VERSION, "Manifest media recipe alias is incompatible.");
    assert(manifest.compilerRecipe === COMPILER_RECIPE, "Manifest compiler recipe is incompatible.");
    assert(
      JSON.stringify(manifest.mediaInventory || []) === JSON.stringify(expected),
      "Manifest media inventory does not match actual topology and digests.",
    );
  }
  return expected;
}
