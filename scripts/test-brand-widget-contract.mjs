#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const css = readFileSync(resolve(root, "web-tour/css/tour.css"), "utf8");
const mark = readFileSync(
  resolve(root, "web-tour/assets/raindigit-mark.svg"),
  "utf8",
);
const markRule = css.match(/\.tour-brand__mark\s*\{([^}]*)\}/)?.[1] || "";
const mobileRule =
  css.match(
    /@media \(max-width:\s*760px\)[\s\S]*?\.tour-brand__mark\s*\{([^}]*)\}/,
  )?.[1] || "";

assert.match(
  markRule,
  /width:\s*36px;/,
  "Desktop 3D mark must keep its approved size.",
);
assert.match(
  markRule,
  /height:\s*36px;/,
  "Desktop 3D mark must keep its approved size.",
);
assert.match(
  markRule,
  /padding:\s*0;/,
  "The transparent mark must not regain an inset tile.",
);
assert.match(
  markRule,
  /background:\s*transparent;/,
  "The transparent 3D mark must not render on an opaque square.",
);
assert.match(
  markRule,
  /filter:\s*drop-shadow\(/,
  "The 3D mark must retain visible depth.",
);
assert.match(
  mobileRule,
  /width:\s*38px;/,
  "The iPhone mark must remain legible.",
);
assert.match(
  mobileRule,
  /height:\s*38px;/,
  "The iPhone mark must remain legible.",
);
assert.match(
  mark,
  /<linearGradient\b/,
  "The canonical mark lost its dimensional gradient.",
);
assert.match(
  mark,
  /<radialGradient\b/,
  "The canonical mark lost its dimensional highlight.",
);
assert.doesNotMatch(
  mark,
  /<rect\b/i,
  "The canonical mark must not contain a background plate.",
);

console.log("Transparent 3D tour-brand widget contract passed.");
