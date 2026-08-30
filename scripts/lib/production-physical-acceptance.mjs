export const physicalAcceptanceSchema = 'raindigit-tour-physical-acceptance/v2';

const requiredChecks = Object.freeze([
  'first-frame',
  'touch',
  'scene-transition',
  'rotation',
  'recovery'
]);

/**
 * Historical selector summaries are deliberately weaker than the full site
 * evidence. They are still never allowed to re-authorize production unless
 * they identify the exact v2 non-AWS physical-iPhone run that created them.
 */
export function isValidProductionPhysicalAcceptance(acceptance, releaseSetDigest) {
  if (!acceptance || acceptance.schema !== physicalAcceptanceSchema) return false;
  if (acceptance.result !== 'pass' || acceptance.releaseSetDigest !== releaseSetDigest) return false;
  if (!/iphone/i.test(acceptance.device || '') || !/safari/i.test(acceptance.browser || '')) return false;
  if (!Array.isArray(acceptance.checks) || !requiredChecks.every((check) => acceptance.checks.includes(check))) return false;
  return !/aws/i.test(JSON.stringify(acceptance));
}
