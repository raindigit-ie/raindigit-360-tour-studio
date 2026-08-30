import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  sentryBrowserBundle,
  tourMonitoringRuntimeBundle,
} from "./tour-monitoring-contract.mjs";

export const PUBLIC_RUNTIME_INVENTORY = Object.freeze([
  { source: "css/pannellum.css", target: "css/pannellum.css", referenceFrom: "entrypoint" },
  { source: "css/tour.css", target: "css/tour.css", referenceFrom: "entrypoint", transform: "release-styles" },
  { source: "assets/raindigit-mark.svg", target: "assets/raindigit-mark.svg" },
  { source: "js/tour-chrome.js", target: "js/tour-chrome.js", referenceFrom: "entrypoint", optionalReference: true },
  { source: "js/pannellum.js", target: "js/pannellum.js", referenceFrom: "bootstrap" },
  { source: "js/bounded-media-runtime.js", target: "js/bounded-media-runtime.js", referenceFrom: "bootstrap" },
  { source: "js/tour-transition.js", target: "js/tour-transition.js", referenceFrom: "bootstrap" },
  { source: "js/tour.js", target: "js/tour.js", referenceFrom: "bootstrap", transform: "release-runtime" },
  { source: "js/tour-bootstrap-release.js", target: "js/tour-bootstrap.js", referenceFrom: "entrypoint" },
  { source: tourMonitoringRuntimeBundle, target: "js/tour-monitoring.js", referenceFrom: "entrypoint" },
  { source: sentryBrowserBundle, target: sentryBrowserBundle },
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function releaseTourStyles(source) {
  const stripStart = "/* RELEASE_STRIP_START: studio-only styles */";
  const stripEnd = "/* RELEASE_STRIP_END: studio-only styles */";
  const stripStartIndex = source.indexOf(stripStart);
  const stripEndIndex = source.indexOf(stripEnd);
  assert(
    stripStartIndex >= 0 && stripEndIndex > stripStartIndex,
    "The canonical Studio stylesheet has invalid release-strip markers.",
  );
  const release = `${source.slice(0, stripStartIndex).trimEnd()}\n`;
  assert(
    !/\.editor-panel|\.frame-picker-app/.test(release),
    "Studio-only styles leaked into the public tour stylesheet.",
  );
  return release;
}

export function releaseTourRuntime(source) {
  const stripStart = "/* RELEASE_STRIP_START: local editor bridge */";
  const stripEnd = "/* RELEASE_STRIP_END: local editor bridge */";
  const stripStartIndex = source.indexOf(stripStart);
  const stripEndIndex = source.indexOf(stripEnd);
  assert(
    stripStartIndex >= 0 && stripEndIndex > stripStartIndex,
    "The canonical Studio runtime has invalid release-strip markers.",
  );
  const withoutEditorBridge = `${source.slice(0, stripStartIndex)}${source.slice(stripEndIndex + stripEnd.length)}`;
  const release = withoutEditorBridge
    .replace(
      /const isLocalEditorRequest = viewParams\.get\("edit"\) === "1"[\s\S]*?const localEditorDefaultHfov = 94;/,
      "const isLocalEditorRequest = false;\nconst isLocalDraftPreview = false;\nconst localEditorDefaultHfov = 94;",
    )
    .replace(
      /if \(isLocal(?:EditorRequest \|\| isLocal)?DraftPreview\) setNavigatorOpen\(true\);/,
      "setNavigatorOpen(false);",
    );
  assert(
    release.includes("const isLocalEditorRequest = false;") &&
      release.includes("const isLocalDraftPreview = false;"),
    "The public runtime must disable Studio-only modes.",
  );
  assert(
    !/tour-editor|tour-preview|__TOUR_EDITOR|__TOUR_DRAFT_PREVIEW/.test(release),
    "Studio-only runtime code leaked into the public tour slice.",
  );
  return release;
}

export function publicRuntimeReferences(referenceFrom, referenceSource = null) {
  return PUBLIC_RUNTIME_INVENTORY.filter(
    (entry) =>
      entry.referenceFrom === referenceFrom &&
      (!entry.optionalReference ||
        referenceSource === null ||
        referenceSource.includes(entry.target)),
  ).map((entry) => entry.target);
}

export async function installPublicRuntime({
  sourceRoot,
  targetRoot,
  transformTourRuntime = (source) => source,
}) {
  await Promise.all(
    PUBLIC_RUNTIME_INVENTORY.map(async (entry) => {
      const sourcePath = join(sourceRoot, entry.source);
      const targetPath = join(targetRoot, entry.target);
      await mkdir(dirname(targetPath), { recursive: true });
      if (!entry.transform) {
        await cp(sourcePath, targetPath);
        return;
      }
      const source = await readFile(sourcePath, "utf8");
      const release = entry.transform === "release-styles"
        ? releaseTourStyles(source)
        : transformTourRuntime(releaseTourRuntime(source));
      await writeFile(targetPath, release, "utf8");
    }),
  );
}

async function contentDigest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function assertPublicRuntimeSliceEqual(leftRoot, rightRoot) {
  for (const entry of PUBLIC_RUNTIME_INVENTORY) {
    const [left, right] = await Promise.all([
      contentDigest(join(leftRoot, entry.target)),
      contentDigest(join(rightRoot, entry.target)),
    ]);
    assert(
      left === right,
      `Public runtime slice differs at ${entry.target}: ${left} != ${right}.`,
    );
  }
}
