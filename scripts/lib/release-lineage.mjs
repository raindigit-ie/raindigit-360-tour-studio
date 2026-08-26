function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertReleaseLineage({
  manifest,
  changelog,
  migrationFromVersion,
  migrationToVersion,
  label = manifest?.slug || "Tour"
}) {
  assert(
    changelog?.schema === "raindigit-tour-changelog-ledger/v1" &&
      Array.isArray(changelog.releases),
    `${label}: tour changelog ledger is invalid.`
  );
  const current = changelog.releases.find(
    (entry) => entry.tourVersion === manifest.tourVersion
  );
  assert(current, `${label}: changelog has no entry for ${manifest.tourVersion}.`);
  assert(
    manifest.tourVersion === migrationToVersion,
    `${label}: package capability differs from the migration target.`
  );
  assert(
    manifest.previousTourVersion === current.previousTourVersion,
    `${label}: package previousTourVersion differs from its capability changelog.`
  );

  if (migrationFromVersion !== migrationToVersion) {
    assert(
      manifest.previousTourVersion === migrationFromVersion,
      `${label}: capability upgrade does not point to the actual prior capability.`
    );
  } else {
    assert(
      manifest.previousTourVersion !== manifest.tourVersion,
      `${label}: same-capability package revision cannot point to itself as the prior capability.`
    );
  }
}
