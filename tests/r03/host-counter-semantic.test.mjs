// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import oracle from './host-counter-semantic-oracle.json' with { type: 'json' };
import { createCounterHostContract, verifyCounterHostContract } from '../../eng/host-semantic-contract.mjs';

// Independent oracle formula; no producer output is used to create expected data.
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const jcs = value => value && typeof value === 'object'
  ? Array.isArray(value) ? '[' + value.map(jcs).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}'
  : JSON.stringify(value);
const seal = value => { const { digest, ...body } = value; return { ...body, digest: hash('tsfg.host-semantic-contract.v1\0' + jcs(body)) }; };
function rehashIdentity(identity) {
  const { digest: oldInputs, ...inputs } = identity.buildInputSet;
  identity.buildInputSet.digest = hash(jcs(inputs));
  identity.buildIdentity.buildInputSetDigest = identity.buildInputSet.digest;
  const { digest: oldIdentity, ...body } = identity.buildIdentity;
  identity.buildIdentity.digest = hash(jcs(body));
  return identity;
}

test('M22 complete independent Counter profile and fixed identity recipe', () => {
  const actual = createCounterHostContract(oracle.identity);
  assert.deepEqual(actual.contract, oracle.expectedContract);
  assert.equal(actual.contractText, oracle.expectedCanonicalText);
  assert.equal(actual.identitySource, oracle.expectedGeneratedZig);
  assert.deepEqual(verifyCounterHostContract(Buffer.from(oracle.expectedCanonicalText), oracle.identity), oracle.expectedContract);
  const { digest, ...body } = oracle.expectedContract;
  assert.equal(hash('tsfg.host-semantic-contract.v1\0' + jcs(body)), digest);
  assert.notEqual(hash('tsfg.host-semantic-contract.v1\0' + jcs(body) + '\n'), digest);
  assert.equal(actual.contract.semantics.effects.length, 2);
  assert.deepEqual(actual.contract.semantics.borrowedParameters, []);
  assert.deepEqual(actual.contract.semantics.callbacks, []);
  assert.deepEqual(actual.contract.semantics.retainedParameters, []);
});

test('M22 self-consistent changed version, ABI, implementation, effect or identity is untrusted', async t => {
  /** @type {Array<[string, (value: any) => void]>} Mutants intentionally violate the frozen schema. */
  const mutations = [
    ['version', value => { value.version = 2; }],
    ['ABI', value => { value.abi.native.parameters[1] = 'reference'; }],
    ['layout', value => { value.abi.context.bytes = 24; }],
    ['implementation', value => { value.implementation[0].sha256 = 'sha256:' + '0'.repeat(64); }],
    ['BuildIdentity', value => { value.buildIdentityDigest = 'sha256:' + '1'.repeat(64); }],
    ['retained callback', value => { value.semantics.callbacks.push({ retained: true }); }],
    ['effect', value => { value.semantics.effects[0].operation = 'pure'; }],
    ['binding', value => { value.binding.id = 32; }],
    ['caller safety flags', value => { value.safe = true; }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, () => {
    const value = structuredClone(oracle.expectedContract);
    mutate(value);
    const text = jcs(seal(value)) + '\n';
    assert.throws(() => verifyCounterHostContract(Buffer.from(text), oracle.identity), /contract mismatch/);
  });
});

test('M22 identity verification rejects tampering and matching arbitrary caller strings', async t => {
  /** @type {Array<[string, (value: any) => void]>} Untrusted identity shapes. */
  const variants = [
    ['digest', value => { value.buildIdentity.digest = 'sha256:' + '0'.repeat(64); }],
    ['mode', value => { value.buildInputSet.entries[0].normalizedMode = '120000'; }],
    ['duplicate', value => { value.buildInputSet.entries.push(value.buildInputSet.entries[0]); }],
    ['source', value => { value.buildInputSet.entries.find(e => e.repositoryRelativePath === 'runtime/host_counter.c').sha256 = 'sha256:' + '0'.repeat(64); rehashIdentity(value); }],
    ['missing source', value => { value.buildInputSet.entries = value.buildInputSet.entries.filter(e => e.repositoryRelativePath !== 'runtime/host_counter_bridge.c'); rehashIdentity(value); }],
    ['target', value => { value.buildIdentity.target = 'other'; rehashIdentity(value); }],
    ['unbound arbitrary strings', value => { value.buildInputSet.digest = value.buildIdentity.buildInputSetDigest = value.buildIdentity.digest = 'sha256:' + '1'.repeat(64); }],
  ];
  for (const [name, mutate] of variants) await t.test(name, () => {
    const value = structuredClone(oracle.identity); mutate(value);
    assert.throws(() => createCounterHostContract(value), /host-semantic-contract/);
  });
});

test('M22 identity changes force a different contract and reject the old claim', () => {
  const next = structuredClone(oracle.identity);
  next.buildIdentity.source_date_epoch = String(BigInt(next.buildIdentity.source_date_epoch) + 1n);
  rehashIdentity(next);
  const current = createCounterHostContract(next);
  assert.notEqual(current.contract.digest, oracle.expectedContract.digest);
  assert.notEqual(current.contract.buildIdentityDigest, oracle.expectedContract.buildIdentityDigest);
  assert.throws(() => verifyCounterHostContract(Buffer.from(oracle.expectedCanonicalText), next), /contract mismatch/);
});

test('M22 transport is exact canonical UTF-8 and bounded, with no hidden safety metadata', () => {
  for (const bytes of [Buffer.alloc(16385), Buffer.from([255]), Buffer.from('{}'),
      Buffer.from(oracle.expectedCanonicalText.trimEnd()), Buffer.from(' ' + oracle.expectedCanonicalText)])
    assert.throws(() => verifyCounterHostContract(bytes, oracle.identity), /host-semantic-contract/);
});

test('M18 Counter source binding matches actual reviewed leaf and bridge', async () => {
  const profile = JSON.parse(await readFile(new URL('../../contracts/host-counter-semantic-v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(profile.implementation, oracle.expectedContract.implementation);
  for (const source of oracle.expectedContract.implementation) {
    const bytes = await readFile(new URL('../../' + source.path, import.meta.url));
    assert.equal(hash(bytes), source.sha256, source.path);
  }
});
