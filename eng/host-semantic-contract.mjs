// SPDX-License-Identifier: MIT
import profileData from '../contracts/host-counter-semantic-v1.json' with { type: 'json' };
import { canonical, own, sha256 } from '../compiler/identity.mjs';

// The issuer has one reviewed implementation profile, never caller safety flags.
const profile = own(profileData);
const digestPattern = /^sha256:[0-9a-f]{64}$/;
function reject(reason) { throw new TypeError('host-semantic-contract: ' + reason); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || canonical(Object.keys(value).sort()) !== canonical([...keys].sort())) reject('identity shape');
}
function checkedIdentity(identity) {
  const bi = identity?.buildIdentity, inputs = identity?.buildInputSet;
  exact(bi, ['buildInputSetDigest','options','profile','source_date_epoch','target','toolchainClosureDigest','digest']);
  exact(inputs, ['entries','schemaVersion','digest']);
  exact(bi.options, ['sourceTarget','simdDispatch']);
  if (bi.target !== profile.abi.target || bi.profile !== 'debug' || bi.options.sourceTarget !== 'tsfg-vm'
      || bi.options.simdDispatch !== 'runtime-detected' || !/^[1-9][0-9]*$/.test(bi.source_date_epoch)
      || !digestPattern.test(bi.toolchainClosureDigest) || inputs.schemaVersion !== '1'
      || !Array.isArray(inputs.entries) || inputs.entries.length === 0 || inputs.entries.length > 4096)
    reject('unsupported identity');
  let previous = '';
  for (const entry of inputs.entries) {
    exact(entry, ['projectId','repositoryRelativePath','normalizedMode','sha256']);
    const name = entry.repositoryRelativePath;
    if (entry.projectId !== 'tsfg' || typeof name !== 'string' || !name.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part))
        || name.split('/').some(part => part === '.' || part === '..') || name <= previous
        || !['100644','100755'].includes(entry.normalizedMode) || !digestPattern.test(entry.sha256)) reject('input entry');
    previous = name;
  }
  const { digest, ...body } = bi;
  if (sha256(canonical(body)) !== digest
      || sha256(canonical({ entries: inputs.entries, schemaVersion: inputs.schemaVersion })) !== inputs.digest
      || inputs.digest !== bi.buildInputSetDigest) reject('identity digest');
  for (const source of profile.implementation) {
    if (inputs.entries.find(entry => entry.repositoryRelativePath === source.path)?.sha256 !== source.sha256)
      reject('implementation is not the reviewed Counter');
  }
  return bi;
}
function bytesLiteral(digest) { return '[_]u8{ ' + [...Buffer.from(digest.slice(7),'hex')].join(', ') + ' }'; }

/** Only executeVmTarget supplies the identity used for the compiled Runtime.
 * Unit callers may check recipes, but cannot replace the generated module in a
 * published build: the normal builder generates and retains that dependency. */
export function createCounterHostContract(identity) {
  const bi = checkedIdentity(identity);
  const body = { ...profile, family: 'tsfg.host-semantic-contract', buildIdentityDigest: bi.digest };
  const contract = own({ ...body, digest: sha256('tsfg.host-semantic-contract.v1\0' + canonical(body)) });
  const identitySource = '// SPDX-License-Identifier: MIT\n'
    + '// Generated only by the verified Runtime build; not a source Build Input.\n'
    + 'pub const version: u32 = 1;\n'
    + 'pub const capability_id: u32 = 31;\n'
    + 'pub const build_identity = ' + bytesLiteral(bi.digest) + ';\n'
    + 'pub const contract_hash = ' + bytesLiteral(contract.digest) + ';\n'
    + 'pub const signature_hash = ' + bytesLiteral(profile.binding.signatureHash) + ';\n'
    + 'pub const context_bytes = 16;\n'
    + 'pub const context_alignment = 8;\n';
  return { contract, contractText: canonical(contract) + '\n', identitySource };
}

/** A manifest/claim is untrusted until it matches the build's entire profile. */
export function verifyCounterHostContract(bytes, identity) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16384) reject('contract byte limit');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) reject('UTF-8');
  let value;
  try { value = JSON.parse(text); } catch { reject('contract JSON'); }
  const expected = createCounterHostContract(identity);
  if (canonical(value) + '\n' !== text || text !== expected.contractText) reject('contract mismatch');
  return expected.contract;
}
