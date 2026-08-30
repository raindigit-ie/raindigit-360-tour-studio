#!/usr/bin/env node

import assert from 'node:assert/strict';
import { assertStudioSourceCompatibility } from './lib/candidate-migration-contract.mjs';

const active = { studioVersion: '0.2.8', formatVersion: '2.0.0', runtimeVersion: '2.0.8', verificationProfile: 'v2' };
const source = { version: '0.2.9' };
const contract = { formatVersion: '2.0.0', runtimeVersion: '2.0.9', verificationProfile: 'v2' };
const registry = { contract: active, pendingMigration: { status: 'candidate-build-pending', fromContract: active, toContract: { studioVersion: '0.2.9', formatVersion: '2.0.0', runtimeVersion: '2.0.9', verificationProfile: 'v2' } } };
assert.equal(assertStudioSourceCompatibility({ registry, studioPackage: source, contract }).mode, 'candidate-pending');
assert.throws(() => assertStudioSourceCompatibility({ registry: { contract: active }, studioPackage: source, contract }));
console.log('Candidate migration contract accepts only an explicit active-to-source version plan.');
