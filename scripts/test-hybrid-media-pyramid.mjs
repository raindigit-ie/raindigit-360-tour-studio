import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import {
  HYBRID_MEDIA_PROFILE,
  buildFacePyramid,
  recommendedFaceConcurrency,
  recommendedSceneConcurrency,
} from "./lib/media-pyramid.mjs";

assert.equal(
  recommendedFaceConcurrency({
    parallelism: 8,
    memoryBytes: 16 * 1024 ** 3,
  }),
  2,
);
assert.equal(
  recommendedFaceConcurrency({
    parallelism: 30,
    memoryBytes: 110 * 1024 ** 3,
  }),
  6,
);
assert.equal(
  recommendedFaceConcurrency({
    parallelism: 2,
    memoryBytes: 4 * 1024 ** 3,
  }),
  1,
);
assert.equal(
  recommendedSceneConcurrency({
    parallelism: 8,
    memoryBytes: 16 * 1024 ** 3,
    faceConcurrency: 2,
  }),
  1,
);
assert.equal(
  recommendedSceneConcurrency({
    parallelism: 30,
    memoryBytes: 110 * 1024 ** 3,
    faceConcurrency: 6,
  }),
  3,
);
assert.equal(
  recommendedSceneConcurrency({
    parallelism: 30,
    memoryBytes: 16 * 1024 ** 3,
    faceConcurrency: 6,
  }),
  1,
);

const temporaryRoot = await mkdtemp(
  join(tmpdir(), "raindigit-hybrid-media-contract-"),
);
const input = join(temporaryRoot, "face.png");
const targetRoot = join(temporaryRoot, "output");
const rawTargetRoot = join(temporaryRoot, "raw-output");
const workRoot = join(temporaryRoot, "work");

try {
  await sharp({
    create: {
      width: 4096,
      height: 4096,
      channels: 3,
      background: { r: 42, g: 96, b: 148 },
    },
  })
    .png({ compressionLevel: 1 })
    .toFile(input);

  const tileCount = await buildFacePyramid({
    input,
    face: "f",
    targetRoot,
    temporaryRoot: workRoot,
    levels: 2,
    baseSize: 512,
    tileSize: 2048,
    fallbackSize: 1024,
    webpQuality: 82,
    webpEffort: 2,
    jpegQuality: 82,
  });

  const { data, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rawTileCount = await buildFacePyramid({
    input: {
      data,
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
    face: "f",
    targetRoot: rawTargetRoot,
    temporaryRoot: join(temporaryRoot, "raw-work"),
    levels: 2,
    baseSize: 512,
    tileSize: 2048,
    fallbackSize: 1024,
    webpQuality: 82,
    webpEffort: 2,
    jpegQuality: 82,
  });
  assert.equal(rawTileCount, tileCount);

  const baseTiles = (await readdir(join(targetRoot, "1"))).sort();
  const detailTiles = (await readdir(join(targetRoot, "2"))).sort();
  assert.deepEqual(baseTiles, ["f0_0.webp"]);
  assert.deepEqual(detailTiles, [
    "f0_0.webp",
    "f0_1.webp",
    "f1_0.webp",
    "f1_1.webp",
  ]);
  assert.equal(tileCount, 5);

  const baseMetadata = await sharp(join(targetRoot, "1", "f0_0.webp")).metadata();
  assert.equal(baseMetadata.width, 512);
  assert.equal(baseMetadata.height, 512);

  for (const tile of detailTiles) {
    const metadata = await sharp(join(targetRoot, "2", tile)).metadata();
    assert.equal(metadata.width, 2048);
    assert.equal(metadata.height, 2048);
  }

  const fallbackMetadata = await sharp(
    join(targetRoot, "fallback", "f.jpg"),
  ).metadata();
  assert.equal(fallbackMetadata.width, 1024);
  assert.equal(fallbackMetadata.height, 1024);

  for (const relative of [
    "1/f0_0.webp",
    "2/f0_0.webp",
    "2/f0_1.webp",
    "2/f1_0.webp",
    "2/f1_1.webp",
    "fallback/f.jpg",
  ]) {
    const [pathBytes, rawBytes] = await Promise.all([
      readFile(join(targetRoot, relative)),
      readFile(join(rawTargetRoot, relative)),
    ]);
    const digest = (value) => createHash("sha256").update(value).digest("hex");
    assert.equal(
      digest(rawBytes),
      digest(pathBytes),
      `${relative} changed between file and raw-buffer pipelines.`,
    );
  }

  console.log(
    JSON.stringify({
      ok: true,
      mediaProfile: HYBRID_MEDIA_PROFILE,
      webpTilesPerFace: tileCount,
      baseResolution: baseMetadata.width,
      detailResolution: 2048,
      fallbackResolution: fallbackMetadata.width,
    }),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
