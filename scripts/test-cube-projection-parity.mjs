#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { FACE_VIEWS, projectCubeFace } from "./lib/media-pyramid.mjs";

const execFileAsync = promisify(execFile);
const faces = ["f", "b", "u", "d", "l", "r"].map((name, index) => ({ name, index, ...FACE_VIEWS[name] }));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runMagick(arguments_) {
  for (const binary of ["magick", "convert"]) {
    try { return await execFileAsync(binary, arguments_); }
    catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error("ImageMagick is required.");
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "raindigit-projection-parity-"));
  const source = join(root, "source.jpg");
  const strip = join(root, "reference-strip.png");
  const cubeSize = 1024;
  try {
    await mkdir(join(root, "reference"));
    await mkdir(join(root, "candidate"));
    await runMagick([
      "-size", "2048x1024", "gradient:#0d2740-#d4a852",
      "-stroke", "#f7f0df", "-strokewidth", "8", "-fill", "none",
      "-draw", "line 0,512 2048,512 line 512,0 512,1024 line 1024,0 1024,1024 line 1536,0 1536,1024",
      "-quality", "94", source
    ]);
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", source,
      "-vf", `v360=input=equirect:output=c6x1:out_forder=fbudlr:interp=lanczos:w=${cubeSize * 6}:h=${cubeSize}`,
      "-frames:v", "1", strip
    ]);

    const observations = [];
    for (const face of faces) {
      const reference = join(root, "reference", `${face.name}.png`);
      const candidate = join(root, "candidate", `${face.name}.png`);
      await runMagick([strip, "-crop", `${cubeSize}x${cubeSize}+${face.index * cubeSize}+0`, "+repage", reference]);
      await projectCubeFace({ source, face: face.name, output: candidate, cubeSize });
      let comparison = "";
      try {
        await runMagick(["compare", "-metric", "RMSE", reference, candidate, "null:"]);
      } catch (error) {
        comparison = String(error.stderr || error.message);
      }
      const normalized = Number(comparison.match(/\(([-+\de.]+)\)/i)?.[1] || 0);
      assert(Number.isFinite(normalized) && normalized <= 0.002, `${face.name} projection drifted beyond the visual parity limit: ${comparison}`);
      observations.push({ face: face.name, normalizedRmse: normalized });
    }
    console.log(`Cube projection parity passed: ${observations.map((item) => `${item.face}=${item.normalizedRmse.toFixed(6)}`).join(", ")}.`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
