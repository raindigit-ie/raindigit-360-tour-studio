#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const css = readFileSync(resolve(root, "web-tour/css/tour.css"), "utf8");
const runtime = readFileSync(resolve(root, "web-tour/js/tour-transition.js"), "utf8");

assert.match(
  css,
  /\.tour-shell\s*>\s*\.tour-scene-transition\s*\{[\s\S]*?z-index:\s*8\s*;/,
  "Runtime scene guard must stay below the persistent control surface."
);
assert.match(
  css,
  /\.tour-shell\s*>\s*\.tour-scene-transition--static,[\s\S]*?data-phase="initial-loading"[\s\S]*?z-index:\s*34\s*;/,
  "Cold-start guard must retain full-viewport ownership."
);
assert.match(
  css,
  /\.topbar,[\s\S]*?\.scene-panel,[\s\S]*?\.floorplan-panel\s*\{[\s\S]*?position:\s*absolute\s*;[\s\S]*?z-index:\s*10\s*;/,
  "Persistent controls must share the canonical positioned layer above scene transitions."
);

const phaseAssignment = runtime.indexOf(
  'overlay.dataset.phase = initial ? "initial-loading" : "loading";'
);
const staticRemoval = runtime.indexOf(
  'overlay.classList.remove("tour-scene-transition--static")'
);
assert(phaseAssignment >= 0, "Transition runtime must declare initial versus scene scope.");
assert(
  phaseAssignment < staticRemoval,
  "Transition scope must be declared before the static cold-start class is removed."
);

console.log("Transition stacking contract passed: cold start 34, controls 10, scene guard 8.");
