#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const commit = "99f4afd686e807d374a764231a58255f7dd853b6";
const upstream = "https://raw.githubusercontent.com/mpetroff/pannellum";
const inputs = Object.freeze([
  {
    name: "libpannellum.js",
    sha256: "5d6a3ad0f9ab60c094a2ba425f5aae9b5296bd83435fa26a9e33f8ee39b49dab",
  },
  {
    name: "pannellum.js",
    sha256: "9765531ab1c24f1b92529e568f5160ab6f0c88c5a50d089c46c8b7993982c974",
  },
]);
const license = Object.freeze({
  name: "COPYING",
  sha256: "e20b384f83f8f580d69e32d2419e093d777830689b3ab48cafbe4284b6ebc3c1",
});
const expectedOutputSha256 = "4e8c5b5841964f0f5004179b11b88f99c6b1df4c65c0564a87f95fe414696a6d";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function download(path, expectedSha256) {
  const url = `${upstream}/${commit}/${path}`;
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`Pannellum source fetch failed (${response.status}): ${url}`);
  const body = Buffer.from(await response.arrayBuffer());
  const actualSha256 = digest(body);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Pannellum source digest mismatch for ${path}: ${actualSha256}`);
  }
  return body;
}

const sources = [];
for (const input of inputs) {
  sources.push(await download(`src/js/${input.name}`, input.sha256));
}
const licenseBody = await download(license.name, license.sha256);
let source = sources.map((value) => value.toString("utf8")).join("\n");
const asynchronousPreviewNeedle = `                previewProgram.texture = gl.createTexture();
                gl.bindTexture(glBindType, previewProgram.texture);

                // Upload preview image to the texture
                var previewImage, vext, voff;
                var uploadPreview = function() {
                    gl.useProgram(previewProgram);

                    gl.uniform1i(gl.getUniformLocation(previewProgram, 'u_splitImage'), 0);`;
const asynchronousPreviewReplacement = `                previewProgram.texture = gl.createTexture();
                gl.bindTexture(glBindType, previewProgram.texture);

                // Upload preview image to the texture
                var previewImage, vext, voff;
                var uploadProgram = previewProgram;
                var uploadPreview = function() {
                    // Data-URI decode is asynchronous. A later scene may have
                    // replaced the renderer program, and tile loads may have
                    // rebound the texture before this callback runs.
                    if (uploadProgram !== previewProgram)
                        return;
                    gl.useProgram(uploadProgram);
                    gl.bindTexture(glBindType, uploadProgram.texture);

                    gl.uniform1i(gl.getUniformLocation(uploadProgram, 'u_splitImage'), 0);`;
if (!source.includes(asynchronousPreviewNeedle)) {
  throw new Error("Pinned Pannellum source no longer matches the WebKit preview-race patch.");
}
source = source
  .replace(asynchronousPreviewNeedle, asynchronousPreviewReplacement)
  .replace("gl.uniform1f(previewProgram.v, vext);", "gl.uniform1f(uploadProgram.v, vext);")
  .replace("gl.uniform1f(previewProgram.vo, voff);", "gl.uniform1f(uploadProgram.vo, voff);");
const output = await transform(source, {
  loader: "js",
  minify: true,
  target: "es2018",
});
const outputSha256 = digest(output.code);
if (outputSha256 !== expectedOutputSha256) {
  throw new Error(`Pannellum output digest mismatch: ${outputSha256}`);
}
if (!output.code.includes("equirectangularThumbnail") || !output.code.includes("shtHash")) {
  throw new Error("Pinned Pannellum build lacks multires preview support.");
}

const outputPath = join(projectRoot, "web-tour", "js", "pannellum.js");
const licensePath = join(projectRoot, "web-tour", "licenses", "pannellum-LICENSE.txt");
const provenancePath = join(projectRoot, "web-tour", "vendor", "pannellum.json");
await mkdir(dirname(licensePath), { recursive: true });
await mkdir(dirname(provenancePath), { recursive: true });
await writeFile(outputPath, output.code, "utf8");
await writeFile(licensePath, licenseBody);
await writeFile(
  provenancePath,
  `${JSON.stringify({
    schema: "raindigit-vendored-javascript/v1",
    project: "Pannellum",
    repository: "https://github.com/mpetroff/pannellum",
    commit,
    fetchedFrom: `${upstream}/${commit}`,
    inputs,
    license,
    build: {
      tool: "esbuild",
      version: "0.28.2",
      target: "es2018",
      minify: true,
    },
    patches: [
      {
        id: "webkit-async-preview-texture-race",
        reason: "Ignore stale thumbnail callbacks and rebind the preview texture before asynchronous upload.",
      },
    ],
    output: {
      path: "web-tour/js/pannellum.js",
      sha256: outputSha256,
      bytes: Buffer.byteLength(output.code),
    },
  }, null, 2)}\n`,
  "utf8",
);

// Read back every generated artifact before reporting success. This catches
// unexpected filesystem redirection and makes the command safe for CI use.
if (digest(await readFile(outputPath)) !== expectedOutputSha256) {
  throw new Error("Vendored Pannellum read-back verification failed.");
}
if (digest(await readFile(licensePath)) !== license.sha256) {
  throw new Error("Vendored Pannellum license read-back verification failed.");
}

console.log(JSON.stringify({ commit, output: outputPath, outputSha256, license: licensePath }));
