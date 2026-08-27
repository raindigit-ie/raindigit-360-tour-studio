#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseTourConfig, tourGraphIdentity } from "./lib/tour-graph-identity.mjs";
import { assertReleaseLineage } from "./lib/release-lineage.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);

function argument(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function releaseSetDigest(releases) {
  const digest = createHash("sha256");
  for (const release of [...releases].sort((left, right) => left.slug.localeCompare(right.slug))) {
    digest.update(release.slug);
    digest.update("\0");
    digest.update(release.contentDigest);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function jsonDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function exactSlugs(items) {
  return items.map((item) => item.slug).sort().join("\0");
}

const registryPath = resolve(argument("--registry", join(projectRoot, "config/active-tour-registry.json")));
const attestationPath = resolve(
  argument("--attestation", join(projectRoot, "config/dev-release-attestation.json"))
);
const siteLedgerPath = argument("--site-ledger");
const packageRoot = argument("--package-root");
const registry = readJson(registryPath);
const attestation = readJson(attestationPath);
const studioPackage = readJson(join(projectRoot, "package.json"));
const contract = readJson(join(projectRoot, "config/release-contract.json"));

assert(registry.schema === "raindigit-active-tour-registry/v1", "Active-tour registry schema is invalid.");
assert(registry.contract.studioVersion === studioPackage.version, "Registry Studio version differs from package.json.");
assert(registry.contract.formatVersion === contract.formatVersion, "Registry format version differs from the Studio contract.");
assert(registry.contract.runtimeVersion === contract.runtimeVersion, "Registry runtime version differs from the Studio contract.");
assert(registry.contract.verificationProfile === contract.verificationProfile, "Registry verification profile differs from the Studio contract.");
assert(attestation.schema === "raindigit-tour-release-attestation/v1", "DEV attestation schema is invalid.");
assert(attestation.changeId === registry.changeId, "DEV attestation change differs from the registry.");
assert(attestation.environment === "dev", "DEV attestation environment is invalid.");
assert(attestation.status === "complete-dev-candidate", "DEV attestation is incomplete.");
assert(attestation.actor?.id && attestation.actor?.role, "DEV attestation actor is missing.");
assert(!Number.isNaN(Date.parse(attestation.createdAt)), "DEV attestation timestamp is invalid.");
assert(attestation.registry.path === "config/active-tour-registry.json", "DEV attestation registry path is invalid.");
assert(attestation.registry.sha256 === sha256(registryPath), "DEV attestation registry digest is stale.");
assert(attestation.migrationMatrixDigest === jsonDigest(registry.migration), "DEV attestation migration digest is stale.");
for (const field of ["studioVersion", "formatVersion", "runtimeVersion", "verificationProfile"])
  assert(attestation.contract[field] === registry.contract[field], `DEV attestation ${field} differs from the registry.`);
assert(attestation.contract.tourVersion === registry.contract.studioVersion, "DEV attestation tour capability differs from Studio.");

const active = registry.activeTours.filter((tour) => tour.status === "active");
assert(active.length > 0, "The registry contains no active tours.");
assert(new Set(active.map((tour) => tour.slug)).size === active.length, "Active-tour slugs must be unique.");

const dev = registry.selectors.dev;
const prod = registry.selectors.prod;
const productionStaged =
  prod.state === "staged-exact-dev-selection" && prod.releaseSetDigest === dev.releaseSetDigest;
const previousProductionAccepted = prod.state === "accepted-production-selection";
assert(dev.environment === "dev" && prod.environment === "prod", "DEV and PROD selectors must declare their environment.");
assert(dev.resource.bucket !== prod.resource.bucket, "DEV and PROD buckets must be independent.");
assert(dev.resource.origin !== prod.resource.origin, "DEV and PROD origins must be independent.");
assert(dev.resource.namespace !== prod.resource.namespace, "DEV and PROD namespaces must be independent.");
assert(exactSlugs(dev.releases) === exactSlugs(active), "Every active tour must have exactly one DEV release.");
assert(exactSlugs(prod.releases) === exactSlugs(active), "Every active tour must have exactly one PROD release state.");
assert(dev.releaseSetDigest === releaseSetDigest(dev.releases), "DEV release-set digest is stale.");
assert(prod.releaseSetDigest === releaseSetDigest(prod.releases), "PROD release-set digest is stale.");
if (productionStaged) {
  assert(dev.promotionBlocked === false, "Physically accepted DEV must be eligible for exact-byte promotion.");
  assert(prod.promotionBlocked === false, "Staged exact-byte PROD selection must not remain blocked.");
  assert(dev.releaseSetDigest === prod.releaseSetDigest, "Staged PROD must select the exact accepted DEV release set.");
  assert(exactSlugs(dev.releases) === exactSlugs(prod.releases), "Staged PROD package set differs from DEV.");
  assert(
    dev.physicalIphoneAcceptance?.result === "pass" &&
      dev.physicalIphoneAcceptance?.releaseSetDigest === dev.releaseSetDigest,
    "Passing exact-digest physical iPhone acceptance is missing from DEV."
  );
  assert(
    prod.physicalIphoneAcceptance?.result === "pass" &&
      prod.physicalIphoneAcceptance?.releaseSetDigest === prod.releaseSetDigest,
    "Passing exact-digest physical iPhone acceptance is missing from staged PROD."
  );
} else {
  assert(dev.promotionBlocked === true && dev.physicalIphoneAcceptance === null, "DEV must remain promotion-blocked until physical iPhone acceptance.");
  if (previousProductionAccepted) {
    assert(prod.promotionBlocked === false, "The accepted current PROD selection must remain available.");
    assert(
      prod.physicalIphoneAcceptance?.result === "pass" &&
        prod.physicalIphoneAcceptance?.releaseSetDigest === prod.releaseSetDigest,
      "The accepted current PROD selection is missing exact-digest physical iPhone evidence."
    );
  } else {
    assert(prod.promotionBlocked === true && prod.state.startsWith("quarantined"), "The current legacy PROD selector must remain quarantined.");
  }
}
assert(attestation.releaseSetDigest === dev.releaseSetDigest, "DEV attestation release-set digest is stale.");
assert(exactSlugs(attestation.packages) === exactSlugs(dev.releases), "DEV attestation package set is incomplete.");

for (const selected of dev.releases) {
  const attested = attestation.packages.find((candidate) => candidate.slug === selected.slug);
  const tour = active.find((candidate) => candidate.slug === selected.slug);
  for (const field of ["packageVersion", "contentDigest", "manifestDigest"])
    assert(attested[field] === selected[field], `${selected.slug}: attested ${field} differs from the selector.`);
  assert(attested.humanChangelogDigest === selected.changelog.humanDigest, `${selected.slug}: attested human changelog is stale.`);
  assert(attested.machineChangelogDigest === selected.changelog.machineDigest, `${selected.slug}: attested machine changelog is stale.`);
  assert(attested.sceneGraphDigest === tour.sceneGraphDigest, `${selected.slug}: attested scene graph is stale.`);
  assert(attested.savedArrivalViewsDigest === tour.savedArrivalViewsDigest, `${selected.slug}: attested arrival graph is stale.`);
}

const evidence = new Map(
  attestation.verification.evidence.map((entry) => [entry.id, entry])
);
for (const id of [
  "studio-release-status",
  "release-governance",
  "studio-strict-types",
  "multires-two-scene-fixture",
  "r2-environment-isolation",
  "remote-dev-selector",
  "dev-story-embed-selection",
  "visible-sequence-chromium",
  "visible-sequence-mobile-webkit",
  "fault-recovery-chromium",
  "fault-recovery-mobile-webkit",
  "safari-loaded-image-decode-tolerance-mobile-webkit",
  "terminal-recovery-action-mobile-webkit",
  "remote-immutable-object-integrity",
  "saved-arrival-graph-mobile-webkit",
  "two-scene-portability-and-embed",
  "cold-load-performance"
])
  assert(evidence.get(id)?.result === "pass", `DEV attestation evidence ${id} is missing or failed.`);
assert(
  evidence.get("cold-load-performance")?.directCases === 6 &&
    evidence.get("cold-load-performance")?.storyEmbeds === 6,
  "DEV attestation performance evidence does not cover all tours in both release engines."
);
assert(
  evidence.get("saved-arrival-graph-mobile-webkit")?.directedTransitions ===
    2 * active.reduce((total, tour) => total + tour.hotspotCount, 0) &&
    evidence.get("saved-arrival-graph-mobile-webkit")?.passes === 2 &&
    evidence.get("saved-arrival-graph-mobile-webkit")?.apiSceneResets === 0 &&
    evidence.get("saved-arrival-graph-mobile-webkit")?.documentReloads === 0,
  "DEV attestation does not cover every directed route twice."
);
assert(
  evidence.get("safari-loaded-image-decode-tolerance-mobile-webkit")?.tours === active.length &&
    evidence.get("terminal-recovery-action-mobile-webkit")?.sharedRuntimePackages === active.length,
  "DEV attestation does not cover Safari decode pressure and bounded terminal recovery."
);
assert(
  attestation.verification.physicalIphoneAcceptance?.releaseSetDigest === dev.releaseSetDigest &&
    attestation.verification.physicalIphoneAcceptance?.result === (productionStaged ? "pass" : "pending"),
  "DEV attestation physical acceptance state differs from the release state."
);
assert(
  attestation.promotion.blocked === !productionStaged,
  "DEV attestation promotion state differs from the canonical selectors."
);
const attestationForDigest = structuredClone(attestation);
delete attestationForDigest.attestationDigest;
assert(
  attestation.attestationDigest === jsonDigest(attestationForDigest),
  "DEV attestation self-digest is invalid."
);

for (const release of dev.releases) {
  assert(/^multires-[0-9a-f]{12}$/.test(release.packageVersion), `${release.slug}: invalid immutable package identity.`);
  assert(/^[0-9a-f]{64}$/.test(release.contentDigest), `${release.slug}: invalid content digest.`);
  assert(release.packageVersion === `multires-${release.contentDigest.slice(0, 12)}`, `${release.slug}: package identity is not derived from its digest.`);
  assert(release.tourVersion === release.studioVersion, `${release.slug}: tour and Studio capability versions differ.`);
  assert(release.studioVersion === registry.contract.studioVersion, `${release.slug}: Studio capability is stale.`);
  assert(release.formatVersion === registry.contract.formatVersion, `${release.slug}: format capability is stale.`);
  assert(release.runtimeVersion === registry.contract.runtimeVersion, `${release.slug}: runtime capability is stale.`);
  assert(release.selfContained === true, `${release.slug}: selected package is not declared self-contained.`);
  assert(release.prefix === `tours/${release.slug}/${release.packageVersion}/`, `${release.slug}: immutable prefix is inconsistent.`);
}

for (const release of prod.releases) {
  assert(/^multires-[0-9a-f]{12}$/.test(release.packageVersion), `${release.slug}: invalid PROD package identity.`);
  assert(release.packageVersion === `multires-${release.contentDigest.slice(0, 12)}`, `${release.slug}: PROD package identity differs from its digest.`);
  if (productionStaged) {
    const accepted = dev.releases.find((candidate) => candidate.slug === release.slug);
    assert(
      accepted?.packageVersion === release.packageVersion && accepted?.contentDigest === release.contentDigest,
      `${release.slug}: staged PROD is not byte-identical to accepted DEV.`
    );
    for (const field of ["studioVersion", "tourVersion", "formatVersion", "runtimeVersion"])
      assert(release[field] === accepted[field], `${release.slug}: staged PROD ${field} differs from DEV.`);
  } else if (!previousProductionAccepted) {
    assert(release.contractStatus === "legacy-blocked", `${release.slug}: current PROD release must stay blocked until migration acceptance.`);
  }
}

const migration = registry.migration;
assert(migration.policy === "evaluate-every-active-tour", "Migration policy must cover every active tour.");
assert(exactSlugs(migration.entries) === exactSlugs(active), "Migration matrix is incomplete or contains an unknown tour.");
assert(migration.toContract.studioVersion === registry.contract.studioVersion, "Migration target Studio version is stale.");
assert(migration.toContract.runtimeVersion === registry.contract.runtimeVersion, "Migration target runtime version is stale.");
for (const entry of migration.entries) {
  const selected = dev.releases.find((release) => release.slug === entry.slug);
  const tour = active.find((candidate) => candidate.slug === entry.slug);
  assert(entry.decision === "migrated", `${entry.slug}: migration decision is not complete.`);
  assert(entry.from.tourVersion === migration.fromContract.studioVersion, `${entry.slug}: migration source capability is ambiguous.`);
  assert(entry.to.tourVersion === migration.toContract.studioVersion, `${entry.slug}: migration target capability is stale.`);
  assert(entry.to.packageVersion === selected.packageVersion && entry.to.contentDigest === selected.contentDigest, `${entry.slug}: migration target and DEV selector differ.`);
  assert(entry.preservation.firstScene === tour.firstScene, `${entry.slug}: first scene was not preserved.`);
  for (const field of [
    "sceneCount",
    "hotspotCount",
    "savedArrivalViewCount",
    "sceneGraphDigest",
    "savedArrivalViewsDigest"
  ])
    assert(entry.preservation[field] === tour[field], `${entry.slug}: ${field} preservation is unproven.`);
  assert(
    entry.status ===
      (productionStaged
        ? "automated-and-physical-iphone-pass"
        : "automated-pass-physical-iphone-pending"),
    `${entry.slug}: migration physical acceptance state is stale.`
  );
}

if (siteLedgerPath) {
  const ledger = readJson(resolve(siteLedgerPath));
  for (const environment of ["dev", "prod"]) {
    const expected = registry.selectors[environment];
    const actual = ledger[environment];
    assert(actual.environment === expected.environment, `${environment}: site ledger environment differs from registry.`);
    assert(actual.resource.bucket === expected.resource.bucket && actual.resource.origin === expected.resource.origin, `${environment}: site resource differs from registry.`);
    assert(actual.releaseSetDigest === expected.releaseSetDigest, `${environment}: site release-set digest differs from registry.`);
    for (const release of expected.releases) {
      const selected = actual.releases.find((candidate) => candidate.slug === release.slug);
      assert(selected?.packageVersion === release.packageVersion && selected?.contentDigest === release.contentDigest, `${environment}/${release.slug}: site selection differs from registry.`);
    }
  }
}

if (packageRoot) {
  for (const release of dev.releases) {
    const root = resolve(packageRoot, "tours", release.slug, release.packageVersion);
    const manifestPath = join(root, "release-manifest.json");
    const configPath = join(root, "js", "tour-config.js");
    assert(existsSync(manifestPath), `${release.slug}: selected package manifest is absent.`);
    assert(existsSync(configPath), `${release.slug}: selected package tour-config.js is absent.`);
    const manifest = readJson(manifestPath);
    assert(sha256(manifestPath) === release.manifestDigest, `${release.slug}: manifest digest differs from registry.`);
    for (const field of ["slug", "packageVersion", "contentDigest", "studioVersion", "tourVersion", "formatVersion", "runtimeVersion"])
      assert(manifest[field] === release[field], `${release.slug}: manifest ${field} differs from registry.`);
    assertReleaseLineage({
      manifest,
      changelog: readJson(join(root, "CHANGELOG.json")),
      migrationFromVersion: migration.fromContract.studioVersion,
      migrationToVersion: migration.toContract.studioVersion,
      label: release.slug
    });
    const graph = tourGraphIdentity(parseTourConfig(readFileSync(configPath, "utf8"), configPath));
    const tour = active.find((candidate) => candidate.slug === release.slug);
    for (const field of [
      "firstScene",
      "sceneCount",
      "hotspotCount",
      "savedArrivalViewCount",
      "sceneGraphDigest",
      "savedArrivalViewsDigest"
    ])
      assert(graph[field] === tour[field], `${release.slug}: package ${field} differs from the registry.`);
    assert(sha256(join(root, release.changelog.human)) === release.changelog.humanDigest, `${release.slug}: human changelog digest differs from registry.`);
    assert(sha256(join(root, release.changelog.machine)) === release.changelog.machineDigest, `${release.slug}: machine changelog digest differs from registry.`);
  }
}

console.log(
  `Release governance passed: ${active.length} active tours, independent DEV/PROD state, complete ${migration.fromContract.studioVersion} → ${migration.toContract.studioVersion} migration matrix and integrity-bound DEV attestation.`
);
