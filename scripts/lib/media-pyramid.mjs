import { execFile } from "node:child_process";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { availableParallelism, totalmem } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

export const MEDIA_RECIPE_VERSION =
  "ffmpeg-raw-faces+sharp-hybrid-512-2048-effort2-spline16-v3";
export const HYBRID_MEDIA_PROFILE = "hybrid-512-2048-v1";
const GIB = 1024 ** 3;

export function recommendedFaceConcurrency({
  parallelism = availableParallelism(),
  memoryBytes = totalmem(),
} = {}) {
  const cpuLimit = Math.max(1, Math.floor(Number(parallelism) / 4));
  const memoryLimit = Math.max(
    1,
    Math.floor((Number(memoryBytes) - 4 * GIB) / (2.5 * GIB)),
  );
  return Math.max(1, Math.min(6, cpuLimit, memoryLimit));
}

export function recommendedSceneConcurrency({
  parallelism = availableParallelism(),
  memoryBytes = totalmem(),
  faceConcurrency = recommendedFaceConcurrency({ parallelism, memoryBytes }),
} = {}) {
  const cpuLimit = Math.max(1, Math.floor(Number(parallelism) / 10));
  const memoryPerScene = Math.max(8 * GIB, Number(faceConcurrency) * 2 * GIB);
  const memoryLimit = Math.max(
    1,
    Math.floor((Number(memoryBytes) - 8 * GIB) / memoryPerScene),
  );
  return Math.max(1, Math.min(3, cpuLimit, memoryLimit));
}

export function hybridMediaProfile(baseSize, tileSize) {
  return `hybrid-${baseSize}-${tileSize}-v1`;
}
export function mediaRecipeVersion(
  baseSize,
  tileSize,
  webpEffort,
  projectionInterpolation = "spline16",
) {
  return `ffmpeg-raw-faces+sharp-hybrid-${baseSize}-${tileSize}-effort${webpEffort}-${projectionInterpolation}-v3`;
}
export const FACE_VIEWS = Object.freeze({
  f: Object.freeze({ yaw: 0, pitch: 0 }),
  b: Object.freeze({ yaw: 180, pitch: 0 }),
  u: Object.freeze({ yaw: 0, pitch: 90 }),
  d: Object.freeze({ yaw: 0, pitch: -90 }),
  l: Object.freeze({ yaw: -90, pitch: 0 }),
  r: Object.freeze({ yaw: 90, pitch: 0 })
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function projectCubeFace({
  source,
  face,
  output,
  cubeSize,
  interpolation = "lanczos",
}) {
  const view = FACE_VIEWS[face];
  assert(view, `Unknown cube face: ${face}`);
  await mkdir(dirname(output), { recursive: true });
  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", source,
      "-vf", `v360=input=equirect:output=flat:h_fov=90:v_fov=90:yaw=${view.yaw}:pitch=${view.pitch}:roll=0:w=${cubeSize}:h=${cubeSize}:interp=${interpolation}`,
      "-frames:v", "1",
      "-compression_level", "1",
      output
    ], { maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`FFmpeg cube projection failed for ${face}: ${error.stderr || error.message}`);
  }
}

export async function projectCubeFaceRaw({
  source,
  face,
  cubeSize,
  interpolation = "spline16",
}) {
  const view = FACE_VIEWS[face];
  assert(view, `Unknown cube face: ${face}`);
  try {
    const { stdout } = await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", source,
      "-vf", `v360=input=equirect:output=flat:h_fov=90:v_fov=90:yaw=${view.yaw}:pitch=${view.pitch}:roll=0:w=${cubeSize}:h=${cubeSize}:interp=${interpolation}`,
      "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ], {
      encoding: null,
      maxBuffer: cubeSize * cubeSize * 3 + 16 * 1024 * 1024,
    });
    assert(
      Buffer.isBuffer(stdout) && stdout.byteLength === cubeSize * cubeSize * 3,
      `FFmpeg raw cube projection returned an incomplete ${face} face.`,
    );
    return {
      data: stdout,
      width: cubeSize,
      height: cubeSize,
      channels: 3,
    };
  } catch (error) {
    throw new Error(`FFmpeg raw cube projection failed for ${face}: ${error.stderr || error.message}`);
  }
}

async function decodedPixels(input) {
  if (
    input?.data && Buffer.isBuffer(input.data) &&
    Number.isInteger(input.width) && Number.isInteger(input.height) &&
    Number.isInteger(input.channels)
  ) {
    assert(
      input.data.byteLength === input.width * input.height * input.channels,
      "Raw cube face byte count is invalid.",
    );
    return input;
  }
  const { data, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

export async function buildFacePyramid({
  input,
  face,
  targetRoot,
  temporaryRoot,
  levels,
  baseSize,
  tileSize,
  fallbackSize,
  webpQuality,
  webpEffort,
  jpegQuality
}) {
  assert(FACE_VIEWS[face], `Unknown cube face: ${face}`);
  assert(
    Number.isInteger(baseSize) && baseSize >= 256 && baseSize <= tileSize,
    `Base face size ${baseSize} must be 256..${tileSize}.`,
  );
  const pixels = await decodedPixels(input);
  const image = () => sharp(pixels.data, {
    raw: {
      width: pixels.width,
      height: pixels.height,
      channels: pixels.channels,
    },
  });
  const descriptor = join(temporaryRoot, `${face}-tiles.dz`);
  const generatedRoot = join(temporaryRoot, `${face}-tiles_files`);
  const fallbackRoot = join(targetRoot, "fallback");
  await mkdir(fallbackRoot, { recursive: true });

  if (
    levels === 2 &&
    pixels.width === tileSize * 2 &&
    pixels.height === tileSize * 2
  ) {
    const baseRoot = join(targetRoot, "1");
    const detailRoot = join(targetRoot, "2");
    await Promise.all([
      mkdir(baseRoot, { recursive: true }),
      mkdir(detailRoot, { recursive: true }),
    ]);
    await Promise.all([
      ...[0, 1].flatMap((y) => [0, 1].map((x) =>
        image()
          .extract({
            left: x * tileSize,
            top: y * tileSize,
            width: tileSize,
            height: tileSize,
          })
          .webp({ quality: webpQuality, effort: webpEffort })
          .toFile(join(detailRoot, `${face}${y}_${x}.webp`)),
      )),
      image()
        .resize(baseSize, baseSize, {
          fit: "fill",
          kernel: sharp.kernel.lanczos3,
        })
        .webp({ quality: webpQuality, effort: webpEffort })
        .toFile(join(baseRoot, `${face}0_0.webp`)),
      image()
        .resize(fallbackSize, fallbackSize, {
          fit: "fill",
          kernel: sharp.kernel.lanczos3,
        })
        .jpeg({
          quality: jpegQuality,
          progressive: true,
          chromaSubsampling: "4:2:0",
        })
        .toFile(join(fallbackRoot, `${face}.jpg`)),
    ]);
    return 5;
  }

  await image()
    .webp({ quality: webpQuality, effort: webpEffort })
    .tile({ size: tileSize, overlap: 0, depth: "onetile", layout: "dz", container: "fs" })
    .toFile(descriptor);
  await image()
    .resize(fallbackSize, fallbackSize, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: jpegQuality, progressive: true, chromaSubsampling: "4:2:0" })
    .toFile(join(fallbackRoot, `${face}.jpg`));

  const generatedLevels = (await readdir(generatedRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .sort((left, right) => Number(left.name) - Number(right.name));
  assert(generatedLevels.length === levels, `${face} generated ${generatedLevels.length} pyramid levels; expected ${levels}.`);

  let tileCount = 0;
  for (const [levelIndex, generatedLevel] of generatedLevels.entries()) {
    const targetLevel = join(targetRoot, String(levelIndex + 1));
    await mkdir(targetLevel, { recursive: true });
    const tiles = (await readdir(join(generatedRoot, generatedLevel.name), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.webp$/i.test(entry.name));
    for (const tile of tiles) {
      const match = basename(tile.name, ".webp").match(/^(\d+)_(\d+)$/);
      assert(match, `Unexpected Deep Zoom tile name: ${tile.name}`);
      const [, x, y] = match;
      await rename(join(generatedRoot, generatedLevel.name, tile.name), join(targetLevel, `${face}${y}_${x}.webp`));
      tileCount += 1;
    }
  }
  // Pannellum maps level 1 across a complete cube face regardless of the
  // image's intrinsic dimensions. Keep that readiness layer deliberately
  // small while level 2 carries the 2x2 high-detail grid.
  await image()
    .resize(baseSize, baseSize, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .webp({ quality: webpQuality, effort: webpEffort })
    .toFile(join(targetRoot, "1", `${face}0_0.webp`));
  await rm(descriptor, { force: true });
  await rm(generatedRoot, { recursive: true, force: true });
  return tileCount;
}

export function mediaWorkerMetadata({
  baseSize = 512,
  tileSize = 2048,
  webpEffort = 2,
  projectionInterpolation = "spline16",
  faceConcurrency = 2,
  faceConcurrencyMode = "fixed",
  sceneConcurrency = 1,
  sceneConcurrencyMode = "fixed",
} = {}) {
  return {
    recipe: mediaRecipeVersion(
      baseSize,
      tileSize,
      webpEffort,
      projectionInterpolation,
    ),
    profile: hybridMediaProfile(baseSize, tileSize),
    projectionInterpolation,
    faceConcurrency,
    faceConcurrencyMode,
    sceneConcurrency,
    sceneConcurrencyMode,
    intermediate: "rgb24-pipe",
    availableParallelism: availableParallelism(),
    totalMemoryBytes: totalmem(),
    uvThreadpoolSize: Number(process.env.UV_THREADPOOL_SIZE || 4),
    sharp: sharp.versions.sharp,
    libvips: sharp.versions.vips,
    sharpConcurrency: sharp.concurrency()
  };
}
