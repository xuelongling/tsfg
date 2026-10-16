// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts, verifyReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, verifyReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';

const pins = {
  scalars: '79b3dfcba9ba961ffe55b884a5dcb38d7c4200888cfc4f9a9274acc858491ab9',
  constructor: '55aed6fff72963bd12591ca45eca19d53dfebdb07f48eb6b05fa2d6c0dd4ec5d',
  'literal-facts': 'c414558cf0f8af41632dfcfc9d4c3ea4073f83f09a8d4b365c25aed417867423',
};
async function actual(name) {
  const fixture = suffix => new URL('./fixtures/reference-source/' + name + suffix, import.meta.url);
  const bytes = await readFile(fixture('.facts.json'));
  assert.equal(sha256(bytes), 'sha256:' + pins[name]);
  const binding = JSON.parse(await readFile(fixture('.binding.json'), 'utf8'));
  return { bytes, binding, graph: JSON.parse(bytes.toString('utf8')) };
}
const encode = value => Buffer.from(canonical(value));
function rejected(callback, category, label) {
  assert.throws(callback, error => error instanceof Error && Object.hasOwn(error, 'code')
    && Reflect.get(error, 'code') === 'reference-facts-' + category, label);
}
function roundTrip(hir) {
  assert.deepEqual(verifyReferenceHir(hir), hir);
  assert.deepEqual(readReferenceHir(Buffer.from(printReferenceHir(hir))), hir);
}
function bothRepresentations(data, mutate, category, label) {
  const graph = structuredClone(data.graph); mutate(graph);
  rejected(() => decodeReferenceFacts(encode(graph), data.binding), category, label + ' decode');
  const hir = structuredClone(buildReferenceHir(decodeReferenceFacts(data.bytes, data.binding)));
  mutate(hir);
  // Do not recompute factsDigest: only the named structural cause can pass.
  rejected(() => verifyReferenceHir(hir), category, label + ' cold');
}

test('actual scalar and literal graphs retain roles after all local type IDs are alpha renamed', async () => {
  for (const name of ['scalars','literal-facts']) {
    const data = await actual(name), graph = structuredClone(data.graph);
    const replacements = new Map(graph.types.map((type, index) => [type.id, 'opaque-local-type-' + index]));
    // Rename every occurrence of an owned type ID, including symbol/signature/
    // witness/narrow/context references. Environment and declaration are unchanged.
    function rename(value) {
      if (!value || typeof value !== 'object') return;
      for (const key of Object.keys(value)) {
        if (typeof value[key] === 'string') value[key] = replacements.get(value[key]) ?? value[key];
        else rename(value[key]);
      }
    }
    rename(graph);
    assert.ok(graph.types.every(type => !replacements.has(type.id)));
    const hir = buildReferenceHir(decodeReferenceFacts(encode(graph), data.binding));
    assert.deepEqual(hir.classes.map(item => item.runtimeKey), data.graph.classes.map(item => item.runtimeKey));
    const types = new Map(hir.types.map(type => [type.id, type]));
    if (name === 'scalars') {
      assert.deepEqual(hir.classes[0].fields.map(field => types.get(field.type).scalar), ['i32','f32','f64','bool']);
      assert.equal(hir.classes[0].constructor.body[0].expression.right.kind, 'ref.parameter');
    } else {
      const fields = hir.classes[0].fields;
      assert.equal(new Set(fields.slice(0,4).map(field => field.initializer.type)).size, 1);
      for (const field of fields) {
        assert.equal(field.initializer.kind, 'scalar.literal.unresolved');
        assert.equal(types.get(field.initializer.type).kind, 'number-literal');
        assert.equal(types.get(field.type).scalar, 'f64');
        assert.equal(field.initializer.numericLiteral.officialType, field.initializer.type);
        assert.equal(field.initializer.numericLiteral.contextType, field.type);
      }
    }
    roundTrip(hir);
  }
});

test('actual nominal provenance rejects altered alias brand source hash and version before cold hashing', async () => {
  const data = await actual('scalars');
  const nominal = value => value.types.find(type => type.kind === 'scalar' && type.scalar === 'i32').nominal;
  const changes = {
    'alias anchor': value => { nominal(value).alias.start++; },
    'brand anchor': value => { nominal(value).brand.end--; },
    'declaration source': value => { nominal(value).source = '/original/main.ts'; },
    'alias source': value => { nominal(value).alias.source = '/original/main.ts'; },
    'brand source': value => { nominal(value).brand.source = '/original/main.ts'; },
    'declaration hash': value => { nominal(value).sha256 = 'sha256:' + '0'.repeat(64); },
    'declaration version': value => { nominal(value).version = 'forged-version'; },
  };
  for (const [label, mutate] of Object.entries(changes)) bothRepresentations(data, mutate, 'nominal', label);
});

test('actual literal metadata and cold operations reject silent widening resolution and extra references', async () => {
  const data = await actual('constructor');
  const literal = value => value.classes[0].fields[0].initializer;
  const changes = {
    'wrong source default': { category: 'literal', mutate: value => { literal(value).numericLiteral.defaultScalar = 'f64'; } },
    'wrong slot context': { category: 'literal', mutate: value => { literal(value).numericLiteral.contextType = literal(value).type; } },
    'wide official ref': { category: 'literal', mutate: value => { literal(value).numericLiteral.officialType = value.classes[0].fields[0].type; } },
    'wide expression ref': { category: 'expression', mutate: value => { literal(value).type = value.classes[0].fields[0].type; } },
    'settled narrow type': { category: 'scalar', mutate: value => { value.types.find(type => type.id === literal(value).type).scalar = 'f64'; } },
    'resolved literal state': { category: 'literal', mutate: value => { literal(value).numericLiteral.state = 'resolved'; } },
    'unknown literal reference': { category: 'schema', mutate: value => { literal(value).numericLiteral.extraReference = 'foreign'; } },
    'invented bits': { category: 'schema', mutate: value => { literal(value).bits = '3ff0000000000000'; } },
    'invented resolved scalar': { category: 'schema', mutate: value => { literal(value).resolvedScalar = 'f64'; } },
  };
  for (const [label, { mutate, category }] of Object.entries(changes)) bothRepresentations(data, mutate, category, label);
  const hir = structuredClone(buildReferenceHir(decodeReferenceFacts(data.bytes, data.binding)));
  literal(hir).kind = 'scalar.number';
  rejected(() => verifyReferenceHir(hir), 'unsupported', 'old execution-looking numeric operation');
});

test('private facts and HIR readers reject old versions and Source profiles without a legacy branch', async () => {
  const data = await actual('constructor');
  const facts = decodeReferenceFacts(data.bytes, data.binding), hir = buildReferenceHir(facts);
  const oldFacts = structuredClone(facts); oldFacts.format.version = 1;
  rejected(() => verifyReferenceFacts(oldFacts), 'profile', 'facts wrapper version one');
  const oldHir = structuredClone(hir); oldHir.format.version = 1;
  rejected(() => verifyReferenceHir(oldHir), 'profile', 'HIR version one');
  rejected(() => readReferenceHir(encode(oldHir)), 'profile', 'persisted HIR version one');
  const oldGraph = structuredClone(data.graph), binding = structuredClone(data.binding);
  oldGraph.semanticProfile = 'tsfg-owned-class-facts-candidate-v1'; binding.semanticProfile = oldGraph.semanticProfile;
  rejected(() => decodeReferenceFacts(encode(oldGraph), binding), 'profile', 'Source profile one');
  const oldHirProfile = structuredClone(hir); oldHirProfile.format.semanticProfile = oldGraph.semanticProfile;
  rejected(() => verifyReferenceHir(oldHirProfile), 'profile', 'cold Source profile one');
});
