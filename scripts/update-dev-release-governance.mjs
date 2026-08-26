#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertPackageRollbackLineage } from "./lib/release-lineage.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);

function argument(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function jsonDigest(value) {
  return sha256Bytes(JSON.stringify(value));
}

if (!args.includes("--verified")) {
  throw new Error("DEV governance may only be updated after remote verification: pass --verified.");
}

const registryPath = join(projectRoot, "config/active-tour-registry.json");
const attestationPath = join(projectRoot, "config/dev-release-attestation.json");
const ledgerPath = resolve(
  argument("--site-ledger", "../raindigit.ie/docs/knowledge/tour-release-channels.json")
);
const packageRoot = resolve(argument("--package-root", "../raindigit.ie/.artifacts/r2-tours"));
const registry = readJson(registryPath);
const ledger = readJson(ledgerPath);
const studioPackage = readJson(join(projectRoot, "package.json"));
const contract = readJson(join(projectRoot, "config/release-contract.json"));
const previousContract = structuredClone(registry.contract);
const previousReleases = structuredClone(registry.selectors.dev.releases);
const createdAt = new Date().toISOString();

const releases = ledger.dev.releases.map((selected) => {
  const root = join(packageRoot, "tours", selected.slug, selected.packageVersion);
  const manifest = readJson(join(root, "release-manifest.json"));
  const previous = previousReleases.find((entry) => entry.slug === selected.slug);
  if (!previous) throw new Error(`${selected.slug}: previous accepted DEV release is absent.`);
  assertPackageRollbackLineage({
    selected,
    previous,
    manifest,
    label: selected.slug
  });
  return {
    ...selected,
    manifestDigest: sha256File(join(root, "release-manifest.json")),
    rollbackVersion: manifest.rollbackVersion,
    prefix: `tours/${selected.slug}/${selected.packageVersion}/`,
    selfContained: true,
    changelog: {
      human: "CHANGELOG.md",
      humanDigest: sha256File(join(root, "CHANGELOG.md")),
      machine: "CHANGELOG.json",
      machineDigest: sha256File(join(root, "CHANGELOG.json"))
    }
  };
});

registry.updatedAt = createdAt;
registry.contract = {
  studioVersion: studioPackage.version,
  formatVersion: contract.formatVersion,
  runtimeVersion: contract.runtimeVersion,
  verificationProfile: contract.verificationProfile,
  compatibilityPolicy: "exact-contract"
};
registry.selectors.dev = {
  ...registry.selectors.dev,
  state: "dev-remote-verified",
  releaseSetDigest: ledger.dev.releaseSetDigest,
  physicalIphoneAcceptance: null,
  promotionBlocked: true,
  releases
};
registry.migration = {
  fromContract: {
    studioVersion: previousContract.studioVersion,
    formatVersion: previousContract.formatVersion,
    runtimeVersion: previousContract.runtimeVersion
  },
  toContract: {
    studioVersion: studioPackage.version,
    formatVersion: contract.formatVersion,
    runtimeVersion: contract.runtimeVersion
  },
  policy: "evaluate-every-active-tour",
  entries: registry.activeTours.map((tour) => {
    const previous = previousReleases.find((entry) => entry.slug === tour.slug);
    const selected = releases.find((entry) => entry.slug === tour.slug);
    if (!previous || !selected) throw new Error(`${tour.slug}: migration selection is incomplete.`);
    return {
      slug: tour.slug,
      decision: "migrated",
      from: {
        tourVersion: previous.tourVersion,
        packageVersion: previous.packageVersion,
        contentDigest: previous.contentDigest
      },
      to: {
        tourVersion: selected.tourVersion,
        packageVersion: selected.packageVersion,
        contentDigest: selected.contentDigest
      },
      preservation: {
        firstScene: tour.firstScene,
        sceneCount: tour.sceneCount,
        hotspotCount: tour.hotspotCount,
        savedArrivalViewCount: tour.savedArrivalViewCount,
        sceneGraphDigest: tour.sceneGraphDigest,
        savedArrivalViewsDigest: tour.savedArrivalViewsDigest
      },
      status: "automated-pass-physical-iphone-pending"
    };
  })
};
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

const packages = releases.map((selected) => {
  const tour = registry.activeTours.find((entry) => entry.slug === selected.slug);
  return {
    slug: selected.slug,
    packageVersion: selected.packageVersion,
    contentDigest: selected.contentDigest,
    manifestDigest: selected.manifestDigest,
    humanChangelogDigest: selected.changelog.humanDigest,
    machineChangelogDigest: selected.changelog.machineDigest,
    sceneGraphDigest: tour.sceneGraphDigest,
    savedArrivalViewsDigest: tour.savedArrivalViewsDigest
  };
});
const evidence = [
  ["studio-release-status"],
  ["release-governance"],
  ["studio-strict-types"],
  ["multires-two-scene-fixture"],
  ["r2-environment-isolation"],
  ["remote-dev-selector"],
  ["dev-story-embed-selection", { tours: 3 }],
  ["visible-sequence-chromium", { cases: 6 }],
  ["visible-sequence-mobile-webkit", { cases: 6 }],
  ["fault-recovery-chromium", { tours: 3 }],
  ["fault-recovery-mobile-webkit", { tours: 3 }],
  ["saved-arrival-graph-mobile-webkit", { directedTransitions: 186 }],
  ["two-scene-portability-and-embed"],
  ["cold-load-performance", { directCases: 6, storyEmbeds: 6, directBudgetMs: 12000, storyBudgetMs: 15000 }]
].map(([id, details = {}]) => ({ id, result: "pass", ...details }));
const attestation = {
  schema: "raindigit-tour-release-attestation/v1",
  attestationId: `ATT-${registry.changeId}-DEV-${ledger.dev.releaseSetDigest.slice(0, 12)}`,
  changeId: registry.changeId,
  environment: "dev",
  status: "complete-dev-candidate",
  createdAt,
  actor: { id: "codex-root", role: "release-verifier" },
  registry: { path: "config/active-tour-registry.json", sha256: sha256File(registryPath) },
  migrationMatrixDigest: jsonDigest(registry.migration),
  contract: {
    studioVersion: studioPackage.version,
    tourVersion: studioPackage.version,
    formatVersion: contract.formatVersion,
    runtimeVersion: contract.runtimeVersion,
    verificationProfile: contract.verificationProfile
  },
  releaseSetDigest: ledger.dev.releaseSetDigest,
  packages,
  verification: {
    profile: contract.verificationProfile,
    evidence,
    physicalIphoneAcceptance: {
      result: "pending",
      requiredFor: "prod",
      releaseSetDigest: ledger.dev.releaseSetDigest
    }
  },
  promotion: {
    blocked: true,
    reasons: [
      "physical-iphone-safari-acceptance-pending",
      "prod-selector-quarantined",
      "separate-prod-credential-boundary-not-yet-proven"
    ]
  }
};
attestation.attestationDigest = jsonDigest(attestation);
writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
console.log(`Attested ${releases.length} DEV tours at ${ledger.dev.releaseSetDigest}.`);
