#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { verifyPortableRelease } from "./verify-portable-release.mjs";

function parseArguments(argv) {
  const options = { packageRoot: null, slug: null, evidence: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--package") options.packageRoot = resolve(argv[++index] || "");
    else if (argument === "--slug") options.slug = String(argv[++index] || "");
    else if (argument === "--evidence") options.evidence = resolve(argv[++index] || "");
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.packageRoot || !options.slug || !options.evidence) throw new Error("--package, --slug and --evidence are required.");
  return options;
}

function assertPhysicalEvidence(evidence, pointer) {
  const requiredChecks = ["first-frame", "touch", "scene-transition", "rotation", "recovery"];
  if (evidence.schema !== "raindigit-tour-physical-acceptance/v1" || evidence.passed !== true) throw new Error("Passing physical iPhone evidence is required for promotion.");
  if (evidence.slug !== pointer.slug || evidence.packageVersion !== pointer.packageVersion || evidence.contentDigest !== pointer.contentDigest) throw new Error("Physical evidence is not bound to the exact DEV package digest.");
  if (!/iphone/i.test(evidence.device || "") || !/safari/i.test(evidence.browser || "")) throw new Error("Physical evidence must identify iPhone Safari.");
  if (!requiredChecks.every((check) => evidence.checks?.includes(check))) throw new Error("Physical evidence is missing a required acceptance check.");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { pointer } = await verifyPortableRelease(options.packageRoot, options.slug, "dev");
  const evidence = JSON.parse(await readFile(options.evidence, "utf8"));
  assertPhysicalEvidence(evidence, pointer);
  const prodPointer = {
    ...pointer,
    environment: "prod",
    promotedFrom: {
      environment: "dev",
      packageVersion: pointer.packageVersion,
      contentDigest: pointer.contentDigest,
      physicalAcceptance: evidence.id || null
    },
    promotedAt: new Date().toISOString()
  };
  const output = join(options.packageRoot, "channels", "prod", options.slug, "current.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(prodPointer, null, 2)}\n`, "utf8");
  await verifyPortableRelease(options.packageRoot, options.slug, "prod");
  console.log(JSON.stringify({ promoted: true, slug: pointer.slug, packageVersion: pointer.packageVersion, contentDigest: pointer.contentDigest, output }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exit(1); });
