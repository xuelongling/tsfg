// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts, verifyReferenceFacts } from '../../compiler/reference-facts.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
import { buildReferenceHir, verifyReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';

/** @type {ReadonlyArray<readonly [label: string, fixture: string, digest: string, constructorIndex: number]>} */
const cases = [
  ['explicit', 'constructor', '42ac0214d881e9bf708fb9846bc9e578e2262b3d406c6a76be1d16444105c414', 0],
  ['implicit root', 'reference-identity', '43725ab7a1bec4096e84bbde4431584a9fc96236cfbd42578d99879ca9a52861', 0],
  ['derived base', 'implicit-derived', '162e8e77789a86d5e9c295d93066fb34e366189d0cf1bc43d9280141f13a5bca', 0],
  ['implicit derived', 'implicit-derived', '162e8e77789a86d5e9c295d93066fb34e366189d0cf1bc43d9280141f13a5bca', 1],
];

for (const [label, name, digest, constructorIndex] of cases) {
  test('actual ' + label + ' constructor access is required by facts decoder', async () => {
    /** @type {(suffix: string) => URL} */
    const fixture = suffix => new URL('./fixtures/reference-source/' + name + suffix, import.meta.url);
    const bytes = await readFile(fixture('.facts.json'));
    assert.equal(sha256(bytes), 'sha256:' + digest);
    const binding = JSON.parse(await readFile(fixture('.binding.json'), 'utf8'));
    /** @type {{ classes: Array<{ constructor: Record<string, unknown> }> }} */
    const graph = structuredClone(JSON.parse(bytes.toString('utf8')));
    // This missing-field regression first failed against actual V3 graphs; the
    // actual V4 graph must reject the same omission at the public facts boundary.
    delete graph.classes[constructorIndex].constructor.access;
    assert.throws(() => decodeReferenceFacts(Buffer.from(canonical(graph)), binding),
      error => error instanceof Error && Object.hasOwn(error, 'code')
        && Reflect.get(error, 'code') === 'reference-facts-schema'
        && /constructor\.access.*(?:required|must be (?:present|explicitly provided))/i.test(error.message));
  });
}

/** @type {ReadonlyArray<readonly [name: string, digest: string]>} */
const actualPins = [
  ['constructor', '42ac0214d881e9bf708fb9846bc9e578e2262b3d406c6a76be1d16444105c414'],
  ['inheritance', '35c6b595bf1cac693089749fde20f48aeaaed83b2235e0e58428d9200b8b678d'],
  ['readonly', 'd6e963a23c6b628951fd722ed8179ea900e21a823c91bcc0b35b831f04b67782'],
  ['implicit-derived', '162e8e77789a86d5e9c295d93066fb34e366189d0cf1bc43d9280141f13a5bca'],
  ['construct', 'e0dcbfba0174a9e5f02f36018bde40ddcb9e7afe7ae51450c7d0e3a81a5d82f3'],
  ['reference-identity', '43725ab7a1bec4096e84bbde4431584a9fc96236cfbd42578d99879ca9a52861'],
  ['scalars', 'e9a9c6cfedc125189f9efb6c8862798f082d5707837182c0ab348d5616cff56a'],
  ['literal-facts', '26bc6e6d9a987ee5f146830dfcdae1132297c62b35a8d18dcdf4e500d72fa910'],
  ['implicit-middle', 'fbb28a45bce47cb4a636cad783581b5bca535c5883a6dd679eea7b922fbaebd4'],
  ['locals-const', '762c1c1ee23174b046b00903af2e90ca7c7e08b54c4c970a1ba0d810b8be6fe6'],
  ['locals-let', '4003f2e1ed2d4ef84ef54f7d480792d2a6c78a8e59d9e89593b6936a1aed5a22'],
  ['multiple-sources', 'b49b569266659fb9aed15dfacf677687dd4e3b57bc1b0405b2e8dcc10604ae32'],
  ['local-assignment-result', 'f577d1cf1f157f6bf9b8ccd8ebe5d11d30ec40d4f8967ccc96adb11672919c09'],
];
/** @typedef {{ classes: Array<{ constructor: { access?: unknown, origin: unknown } }>, semanticProfile: string }} AccessGraph */
/** @param {string} name @param {string} digest */
async function actual(name, digest) {
  const base = new URL('./fixtures/reference-source/' + name, import.meta.url);
  const bytes = await readFile(new URL(base.href + '.facts.json'));
  assert.equal(sha256(bytes), 'sha256:' + digest);
  const binding = JSON.parse(await readFile(new URL(base.href + '.binding.json'), 'utf8'));
  /** @type {AccessGraph} */
  const graph = JSON.parse(bytes.toString('utf8'));
  return { bytes, binding, graph };
}
/** @param {() => unknown} run @param {string} category @param {RegExp} detail @param {unknown} [origin] */
function rejected(run, category, detail, origin) {
  assert.throws(run, error => error instanceof Error && Object.hasOwn(error, 'code')
    && Reflect.get(error, 'code') === 'reference-facts-' + category && detail.test(error.message)
    && (origin === undefined || canonical(Reflect.get(error, 'origin')) === canonical(origin)));
}

test('actual thirteen profile4 graphs retain public constructor access through owned and cold HIR', async () => {
  for (const [name, digest] of actualPins) {
    const data = await actual(name, digest);
    const facts = decodeReferenceFacts(data.bytes, data.binding); data.bytes.fill(0);
    assert.equal(facts.format.version, 4, name);
    assert.equal(facts.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v4', name);
    const hir = buildReferenceHir(facts);
    assert.equal(hir.format.version, 4, name);
    for (const item of facts.graph.classes) {
      assert.equal(Object.hasOwn(item.constructor, 'access'), true, name);
      assert.equal(item.constructor.access, 'public', name);
    }
    for (const item of hir.classes) {
      assert.equal(Object.hasOwn(item.constructor, 'access'), true, name);
      assert.equal(item.constructor.access, 'public', name);
    }
    assert.deepEqual(verifyReferenceHir(hir), hir, name);
    const bytes = Buffer.from(printReferenceHir(hir)), cold = readReferenceHir(bytes); bytes.fill(0);
    assert.deepEqual(cold, hir, name);
    assert.notEqual(cold, hir, name);
  }
});

/** @type {ReadonlyArray<readonly [label: string, value: unknown, category: string, detail: RegExp]>} */
const corruptAccess = [
  ['missing', undefined, 'schema', /constructor\.access.*required/i],
  ['empty', '', 'schema', /constructor\.access.*must be public/i],
  ['null', null, 'schema', /constructor\.access.*must be public/i],
  ['number', 17, 'schema', /constructor\.access.*must be public/i],
  ['unknown', 'internal', 'schema', /constructor\.access.*must be public/i],
  ['private', 'private', 'unsupported', /non-public constructor\.access.*unsupported/i],
  ['protected', 'protected', 'unsupported', /non-public constructor\.access.*unsupported/i],
];
for (const [label, name, digest, constructorIndex] of cases) {
  test('actual ' + label + ' access corruption fails facts and cold HIR for its contract cause before hashing', async () => {
    const data = await actual(name, digest);
    const hir = buildReferenceHir(decodeReferenceFacts(data.bytes, data.binding));
    for (const [change, access, category, detail] of corruptAccess) {
      const graph = structuredClone(data.graph), cold = structuredClone(hir);
      const constructor = graph.classes[constructorIndex].constructor;
      if (change === 'missing') {
        delete constructor.access; delete cold.classes[constructorIndex].constructor.access;
      } else {
        constructor.access = access; cold.classes[constructorIndex].constructor.access = access;
      }
      // Leave factsDigest unchanged: identity failure cannot satisfy these checks.
      rejected(() => decodeReferenceFacts(Buffer.from(canonical(graph)), data.binding), category, detail, constructor.origin);
      rejected(() => verifyReferenceHir(cold), category, detail, constructor.origin);
      rejected(() => readReferenceHir(Buffer.from(canonical(cold))), category, detail, constructor.origin);
    }
  });
}

test('private access4 readers reject facts HIR and Source profiles one through three', async () => {
  const [name, digest] = actualPins[0], data = await actual(name, digest);
  const facts = decodeReferenceFacts(data.bytes, data.binding), hir = buildReferenceHir(facts);
  for (const version of [1,2,3]) {
    const oldFacts = structuredClone(facts); oldFacts.format.version = version;
    rejected(() => verifyReferenceFacts(oldFacts), 'profile', /reference-facts-profile/);
    const oldHir = structuredClone(hir); oldHir.format.version = version;
    rejected(() => verifyReferenceHir(oldHir), 'profile', /reference-facts-profile/);
    rejected(() => readReferenceHir(Buffer.from(canonical(oldHir))), 'profile', /reference-facts-profile/);
    const graph = structuredClone(data.graph), binding = structuredClone(data.binding);
    graph.semanticProfile = 'tsfg-owned-class-facts-candidate-v' + version; binding.semanticProfile = graph.semanticProfile;
    rejected(() => decodeReferenceFacts(Buffer.from(canonical(graph)), binding), 'profile', /reference-facts-profile/);
    const oldProfileHir = structuredClone(hir); oldProfileHir.format.semanticProfile = graph.semanticProfile;
    rejected(() => readReferenceHir(Buffer.from(canonical(oldProfileHir))), 'profile', /reference-facts-profile/);
  }
});
