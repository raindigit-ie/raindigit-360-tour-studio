#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const studioRoot = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);

function value(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function has(name) {
  return args.includes(name);
}

function run(label, command, commandArgs, cwd) {
  console.log(`\n[studio-review] ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd,
    env: process.env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

function discoverTour(packageRoot, requestedSlug) {
  const manifestsRoot = join(packageRoot, 'manifests');
  if (!existsSync(manifestsRoot)) throw new Error(`No candidate manifests found in ${packageRoot}. Build the web package first.`);
  const slugs = readdirSync(manifestsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((slug) => !requestedSlug || slug === requestedSlug);
  if (slugs.length !== 1) throw new Error(`Expected one candidate tour, found ${slugs.length}. Pass --tour <slug>.`);
  const slug = slugs[0];
  const pointer = JSON.parse(readFileSync(join(manifestsRoot, slug, 'current.json'), 'utf8'));
  if (pointer.schema !== 'raindigit-tour-current/v1' || pointer.slug !== slug) {
    throw new Error(`${slug}: invalid candidate pointer.`);
  }
  return slug;
}

const siteRoot = resolve(studioRoot, value('--site', '../raindigit.ie'));
const packageRoot = resolve(studioRoot, value('--package', 'release-multires'));
if (!existsSync(join(siteRoot, 'package.json'))) throw new Error(`Rain Digit site repository was not found at ${siteRoot}.`);
const slug = discoverTour(packageRoot, value('--tour'));
const page = value('--page', `/stories/${slug}`);

run('Build and test the integrated site + tour review', 'npm', [
  'run', 'review:prepare', '--',
  '--tour-package', packageRoot,
  '--tour', slug,
  '--page', page
], siteRoot);

if (has('--deploy')) {
  const branch = value('--branch', `review-${slug}`);
  run('Deploy an isolated Cloudflare Pages review', 'npm', [
    'run', 'review:deploy', '--',
    '--branch', branch
  ], siteRoot);
} else {
  console.log('\n[studio-review] Local artefact is ready.');
  console.log(`[studio-review] Start it with: npm --prefix "${siteRoot}" run review:serve`);
  console.log(`[studio-review] Review hub: http://127.0.0.1:4173/__review/`);
}

console.log(`[studio-review] Candidate accepted for review: ${basename(packageRoot)}/${slug}`);
