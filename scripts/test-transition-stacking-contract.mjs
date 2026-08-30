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
assert.match(
  css,
  /\.viewer\.pnlm-container\s*>\s*\.pnlm-ui\s*\{\s*z-index:\s*3\s*;\s*\}[\s\S]*?\.pnlm-render-container\s*\{\s*z-index:\s*2\s*;/,
  "The complete Pannellum UI parent must paint above the compositor-promoted panorama."
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

assert.doesNotMatch(
  runtime,
  /image\.decode\s*\(/,
  "A second image.decode() must not gate an already successful base-face load in Safari."
);
assert.match(
  runtime,
  /image\.complete\s*&&\s*image\.naturalWidth\s*>\s*0/,
  "Base-face success must use the browser load event and non-zero intrinsic dimensions."
);
assert.match(
  runtime,
  /function enterFallback[\s\S]*?__rainDigitShowRuntimeRecovery/,
  "Exhausted tile retries must replace the spinner with the explicit runtime recovery action."
);

console.log("Transition contract passed: stacking, Safari load semantics and bounded recovery.");
