#!/usr/bin/env node

import {
  assertPackageRollbackLineage,
  assertReleaseLineage
} from "./lib/release-lineage.mjs";

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

const previous = {
  packageVersion: "multires-aaaaaaaaaaaa",
  contentDigest: "a".repeat(64),
  rollbackVersion: "multires-999999999999"
};
assertPackageRollbackLineage({
  selected: { ...previous },
  previous,
  manifest: { rollbackVersion: previous.rollbackVersion },
  label: "same-package"
});
assertPackageRollbackLineage({
  selected: {
    packageVersion: "multires-bbbbbbbbbbbb",
    contentDigest: "b".repeat(64)
  },
  previous,
  manifest: { rollbackVersion: previous.packageVersion },
  label: "new-package"
});
expectFailure(
  {
    selected: { ...previous },
    previous,
    manifest: { rollbackVersion: previous.packageVersion },
    label: "same-package"
  },
  "Idempotent attestation accepted a self-rollback target."
);

console.log("Release lineage contract passed for upgrades and same-capability revisions.");
