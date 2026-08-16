import { execFile } from "node:child_process";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

export const MEDIA_RECIPE_VERSION = "ffmpeg-flat-faces+sharp-dz-v1";
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

export async function projectCubeFace({ source, face, output, cubeSize }) {
  const view = FACE_VIEWS[face];
  assert(view, `Unknown cube face: ${face}`);
  await mkdir(dirname(output), { recursive: true });
  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", source,
      "-vf", `v360=input=equirect:output=flat:h_fov=90:v_fov=90:yaw=${view.yaw}:pitch=${view.pitch}:roll=0:w=${cubeSize}:h=${cubeSize}:interp=lanczos`,
      "-frames:v", "1",
      "-compression_level", "1",
      output
    ], { maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`FFmpeg cube projection failed for ${face}: ${error.stderr || error.message}`);
  }
}

export async function buildFacePyramid({
  input,
  face,
  targetRoot,
  temporaryRoot,
  levels,
  tileSize,
  fallbackSize,
  webpQuality,
  jpegQuality
}) {
  assert(FACE_VIEWS[face], `Unknown cube face: ${face}`);
  const descriptor = join(temporaryRoot, `${face}-tiles.dz`);
  const generatedRoot = join(temporaryRoot, `${face}-tiles_files`);
  const fallbackRoot = join(targetRoot, "fallback");
  await mkdir(fallbackRoot, { recursive: true });

  await sharp(input)
    .webp({ quality: webpQuality, effort: 4 })
    .tile({ size: tileSize, overlap: 0, depth: "onetile", layout: "dz", container: "fs" })
    .toFile(descriptor);
  await sharp(input)
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
  await rm(descriptor, { force: true });
  await rm(generatedRoot, { recursive: true, force: true });
  return tileCount;
}

export function mediaWorkerMetadata() {
  return {
    recipe: MEDIA_RECIPE_VERSION,
    sharp: sharp.versions.sharp,
    libvips: sharp.versions.vips,
    sharpConcurrency: sharp.concurrency()
  };
}
