#!/usr/bin/env node

import { assertReleaseLineage } from "./lib/release-lineage.mjs";

function expectFailure(input, message) {
  let failed = false;
  try {
    assertReleaseLineage(input);
  } catch {
    failed = true;
  }
  if (!failed) throw new Error(message);
}

const changelog = {
  schema: "raindigit-tour-changelog-ledger/v1",
  releases: [
    { tourVersion: "0.2.3", previousTourVersion: "0.2.2" },
    { tourVersion: "0.2.2", previousTourVersion: "0.2.1" }
  ]
};
const manifest = {
  slug: "fixture-tour",
  tourVersion: "0.2.3",
  previousTourVersion: "0.2.2"
};

assertReleaseLineage({
  manifest,
  changelog,
  migrationFromVersion: "0.2.2",
  migrationToVersion: "0.2.3"
});
assertReleaseLineage({
  manifest,
  changelog,
  migrationFromVersion: "0.2.3",
  migrationToVersion: "0.2.3"
});
expectFailure(
  {
    manifest: { ...manifest, previousTourVersion: "0.2.3" },
    changelog,
    migrationFromVersion: "0.2.3",
    migrationToVersion: "0.2.3"
  },
  "Same-capability self-lineage did not fail closed."
);
expectFailure(
  {
    manifest,
    changelog,
    migrationFromVersion: "0.2.1",
    migrationToVersion: "0.2.3"
  },
  "Capability upgrade accepted a mismatched prior version."
);

console.log("Release lineage contract passed for upgrades and same-capability revisions.");
