#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { releaseIdentity, studioVersion } from "./lib/release-contract.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const server = await readFile(join(projectRoot, "scripts", "tour-editor-server.mjs"), "utf8");
const editor = await readFile(join(projectRoot, "web-tour", "js", "tour-editor.js"), "utf8");

const identity = releaseIdentity({});
assert.equal(identity.studioVersion, studioVersion);
assert.equal(identity.tourVersion, studioVersion);
assert(server.includes("pointer.packageVersion === packageVersion"), "releaseStatus must validate v1 pointer.packageVersion");
assert(server.includes("pointer.studioVersion === identity.studioVersion"), "releaseStatus must validate Studio capability version");
assert(server.includes("pointer.tourVersion === identity.tourVersion"), "releaseStatus must validate tour capability version");
assert(server.includes("releaseIdentity: identity"), "releaseStatus must expose the server release identity");
assert(server.includes("changeSummary: metadata.changeSummary"), "releaseStatus must expose the release change summary");
assert(editor.includes('readonly maxlength="32"'), "Release version input must be locked in the UI");
assert(editor.includes("state.release.releaseIdentity?.tourVersion"), "UI must source the release version from server identity");
assert(editor.includes("elements.ReleaseVersion.readOnly = true"), "UI must keep the release version locked");
assert(editor.includes('tourVersion: state.release.releaseIdentity?.tourVersion || ""'), "Build request must use the server release version");

console.log(`Release status contract passed: Studio/tour capability ${studioVersion}`);
