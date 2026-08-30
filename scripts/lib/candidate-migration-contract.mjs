function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameContract(left, right) {
  return [
    'studioVersion',
    'formatVersion',
    'runtimeVersion',
    'verificationProfile'
  ].every((field) => left?.[field] === right?.[field]);
}

export function assertStudioSourceCompatibility({ registry, studioPackage, contract }) {
  const source = {
    studioVersion: studioPackage.version,
    formatVersion: contract.formatVersion,
    runtimeVersion: contract.runtimeVersion,
    verificationProfile: contract.verificationProfile
  };
  if (sameContract(registry.contract, source)) return { mode: 'active', source };
  const pending = registry.pendingMigration;
  assert(pending?.status === 'candidate-build-pending', 'Studio source differs from the active registry without a declared candidate migration.');
  assert(sameContract(pending.fromContract, registry.contract), 'Candidate migration source contract differs from the active registry.');
  assert(sameContract(pending.toContract, source), 'Candidate migration target differs from the canonical Studio source.');
  return { mode: 'candidate-pending', source };
}
