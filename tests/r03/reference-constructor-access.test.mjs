// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts, verifyReferenceFacts } from '../../compiler/reference-facts.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
import { buildReferenceHir, verifyReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';

/** @type {ReadonlyArray<readonly [label: string, fixture: string, digest: string, constructorIndex: number]>} */
const cases = [
  ['explicit', 'constructor', '024212e6f2c2b1e69cde17989f6edd7b1a7f71b16daa2dab9dc4c7c1e4bef16b', 0],
  ['implicit root', 'reference-identity', '12155186f4c0d39c006599a27b1d7fb987ce2cd6368f034adef824f01a22dedb', 0],
  ['derived base', 'implicit-derived', '2b5187362be1515f0f6cc28ab232f14d09f6304931a78597ac04f91d856b6f29', 0],
  ['implicit derived', 'implicit-derived', '2b5187362be1515f0f6cc28ab232f14d09f6304931a78597ac04f91d856b6f29', 1],
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
    // actual V5 graph must reject the same omission at the public facts boundary.
    delete graph.classes[constructorIndex].constructor.access;
    assert.throws(() => decodeReferenceFacts(Buffer.from(canonical(graph)), binding),
      error => error instanceof Error && Object.hasOwn(error, 'code')
        && Reflect.get(error, 'code') === 'reference-facts-schema'
        && /constructor\.access.*(?:required|must be (?:present|explicitly provided))/i.test(error.message));
  });
}

/** @type {ReadonlyArray<readonly [name: string, digest: string]>} */
const actualPins = [
  ['constructor', '024212e6f2c2b1e69cde17989f6edd7b1a7f71b16daa2dab9dc4c7c1e4bef16b'],
  ['inheritance', 'e29f6d0c595e936e73066c00d7ae053e1f41fde18bb159ca414e7f3603681779'],
  ['readonly', 'f666c821e48ad8dbe0d094b55ccc9871924a37a0754a3a3b55e6606ab5d48028'],
  ['implicit-derived', '2b5187362be1515f0f6cc28ab232f14d09f6304931a78597ac04f91d856b6f29'],
  ['construct', 'c34e080d2dedff74ad8676ef1bdd59e3d58536bdbbdc9e463ac589c2b3402483'],
  ['reference-identity', '12155186f4c0d39c006599a27b1d7fb987ce2cd6368f034adef824f01a22dedb'],
  ['scalars', 'bcd796436dc6ee44b4b24e1722372c9db935c6452735845bc4d755061e472562'],
  ['literal-facts', '060ef5ebb3e0dbbad2203089262a1e54b055caed1c74f8861c17a263d580e7bb'],
  ['implicit-middle', '940e69d1f309eef8d5e7a9cb2f673058476be9bca6e688b267484c75225487df'],
  ['locals-const', '32b102d37534052fc90d305ee8d4a1092696f32c6b072520f7a0de43683cfaf5'],
  ['locals-let', '4dc738d2bc0d7b9a8cd6c63d57de76d914af97ae8257b3bf5cf7d31ba465ee51'],
  ['multiple-sources', '593093a1772fff01f8c6c82802e50edf44b24f29042c2e3ace494957e6a93db7'],
  ['local-assignment-result', '2510da5b02fb93613ebcf4fbd3e43fb64436f144b3be7df1ce2602795dfb4552'],
  ['ancestor-super-method', 'd17ba75dc99b358a0e370aa3cc7e66cc1128230483b975c5b38c5dd99a4f64cd'],
  ['field-initialization-order', 'fa0b10d0f1dc9cb5522355ff89e11939ef35178f89bdd3e280f17efadfcc652d'],
  ['terminal-reference-if', '64029f8d2ee659c3260c3793b2e4f401ffc1a94a09f73d434981a67ac3180a19'],
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

test('actual sixteen profile5 graphs retain public constructor access through owned and cold HIR', async () => {
  for (const [name, digest] of actualPins) {
    const data = await actual(name, digest);
    const facts = decodeReferenceFacts(data.bytes, data.binding); data.bytes.fill(0);
    assert.equal(facts.format.version, 5, name);
    assert.equal(facts.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v5', name);
    const hir = buildReferenceHir(facts);
    assert.equal(hir.format.version, 5, name);
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

test('private profile5 readers reject facts HIR and Source profiles one through four', async () => {
  const [name, digest] = actualPins[0], data = await actual(name, digest);
  const facts = decodeReferenceFacts(data.bytes, data.binding), hir = buildReferenceHir(facts);
  for (const version of [1,2,3,4]) {
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
