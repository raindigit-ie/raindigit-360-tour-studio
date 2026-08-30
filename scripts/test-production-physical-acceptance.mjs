#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  isValidProductionPhysicalAcceptance,
  physicalAcceptanceSchema
} from './lib/production-physical-acceptance.mjs';

const valid = {
  schema: physicalAcceptanceSchema,
  result: 'pass',
  releaseSetDigest: 'a'.repeat(64),
  device: 'Vee · physical iPhone',
  browser: 'Safari 26',
  checks: ['first-frame', 'touch', 'scene-transition', 'rotation', 'recovery']
};

assert.equal(isValidProductionPhysicalAcceptance(valid, valid.releaseSetDigest), true);
assert.equal(
  isValidProductionPhysicalAcceptance(
    { ...valid, schema: 'raindigit-tour-physical-acceptance/v1', device: 'AWS Device Farm iPhone' },
    valid.releaseSetDigest
  ),
  false
);
assert.equal(isValidProductionPhysicalAcceptance(valid, 'b'.repeat(64)), false);
console.log('Production physical-acceptance summary contract rejects legacy, AWS and mismatched evidence.');
