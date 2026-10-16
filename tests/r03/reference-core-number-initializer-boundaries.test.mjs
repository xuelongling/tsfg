// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';
import { canonical } from '../../compiler/identity.mjs';
import schema from '../../contracts/core-reference-candidate.schema.json' with { type: 'json' };
import { invokeCore, accepted } from './generic-core-package-capture.mjs';

const fixture = name => new URL('./fixtures/reference-source/' + name, import.meta.url);
const sha256 = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
// Handwritten expectations, independent of floatBits and host numeric parsing.
/** @type {[string,string][]} */
const expected = [['integer','3ff0000000000000'], ['decimal','3ff0000000000000'],
  ['exponent','3ff0000000000000'], ['hexadecimal','3ff0000000000000'],
  ['hexadecimalE','40ebd5a000000000'], ['exactLarge','4340000000000000'], ['roundedLarge','4340000000000000']];
let loaded;
async function actual() {
  if (!loaded) loaded = load();
  return loaded;
}
async function load() {
  const [bytes, bindingBytes, sourceBytes, declarationBytes] = await Promise.all([
    readFile(fixture('literal-facts.facts.json')), readFile(fixture('literal-facts.binding.json')),
    readFile(fixture('literal-facts.source.ts')), readFile(fixture('ancestor-super-method.declaration.d.ts')),
  ]);
  assert.equal(bytes.length, 9697); assert.equal(bindingBytes.length, 955);
  assert.equal(sourceBytes.length, 245); assert.equal(declarationBytes.length, 362);
  assert.equal(sha256(bytes), 'sha256:26bc6e6d9a987ee5f146830dfcdae1132297c62b35a8d18dcdf4e500d72fa910');
  assert.equal(sha256(bindingBytes), 'sha256:6ab211f68d949bf75a135c045ce484cd3cbf5ce2153c7ed2a05f72ac4e1abb73');
  assert.equal(sha256(sourceBytes), 'sha256:7a9081fd9db518f06b99150d1334f082c643bbc8f807d7cac3173f7a10675839');
  assert.equal(sha256(declarationBytes), 'sha256:d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141');
  const binding = JSON.parse(bindingBytes.toString('utf8'));
  /** @type {[string,Buffer,boolean][]} */
  const originals = [['/original/main.ts',sourceBytes,false], ['/original/minimal-scalars-v2.d.ts',declarationBytes,true]];
  assert.equal(binding.sources.length, 2);
  for (const [path, bytes, declaration] of originals) {
    const origin = binding.sources.find(value => value.path === path); assert.ok(origin);
    assert.equal(origin.sha256, sha256(bytes)); assert.equal(origin.utf16Length, bytes.toString('utf8').length);
    assert.equal(origin.declaration, declaration); assert.deepEqual(origin.surrogateStarts, []);
  }
  const owned = buildReferenceHir(decodeReferenceFacts(bytes, binding));
  const unresolved = printReferenceHir(owned), persisted = Buffer.from(unresolved), hir = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(hir, owned); assert.equal(hir.format.version, 4);
  assert.equal(hir.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v4');
  assert.equal(hir.classes.length, 1);
  const owner = hir.classes[0]; assert.equal(owner.name, 'Literals'); assert.equal(owner.fields.length, 7);
  for (const field of owner.fields) {
    assert.equal(field.initializer.kind, 'scalar.literal.unresolved');
    assert.equal(field.initializer.numericLiteral.state, 'unresolved');
  }
  return { hir, owner, unresolved };
}
function hirRejected(callback, category, label) {
  assert.throws(callback, error => error instanceof Error && Reflect.get(error, 'code') === 'reference-facts-' + category, label);
}
function operations(core, name) {
  return core.split('\n').flatMap((line,index) => {
    const match = line.match(/^\s*(?:(%[A-Za-z0-9_]+) = )?"([^"]+)"\(([^)]*)\) \{(.*)\} : \(([^)]*)\) -> (.*)$/);
    return !match || match[2] !== name ? [] : [{line:index,value:match[1],operands:match[3] ? match[3].split(/,\s*/) : [],
      attributes:match[4],inputs:match[5] ? match[5].split(/,\s*/) : [],result:match[6]}];
  });
}
function anchor(attributes, origin) {
  assert.ok(attributes.includes('tsfg_source.start = ' + origin.start + ' : i64'));
  assert.ok(attributes.includes('tsfg_source.end = ' + origin.end + ' : i64'));
}
function exactInitializers(core, owner) {
  const constants = operations(core, 'tsfg_core.constant'), stores = operations(core, 'tsfg_core.ref.field.write');
  assert.equal(constants.length, 7); assert.equal(stores.length, 7);
  const receiver = stores[0].operands[0];
  const reference = '!tsfg_core.ref<' + JSON.stringify(sha256('tsfg.core-reference.access.v1\0' + owner.runtimeKey)) + '>';
  for (const [index, [name,bits]] of expected.entries()) {
    const field = owner.fields[index], store = stores[index]; assert.equal(field.name, name);
    const constant = constants.find(value => value.value === store.operands[1]); assert.ok(constant);
    assert.equal(constants.indexOf(constant), index); assert.ok(constant.line < store.line);
    if (index) assert.ok(stores[index - 1].line < constant.line, 'field initializers keep original source order');
    assert.equal(constant.result, 'f64'); assert.deepEqual(constant.operands, []);
    assert.ok(constant.attributes.includes('value = ' + JSON.stringify(bits)), name + ' retains the independent exact bits');
    anchor(constant.attributes, field.initializer.origin); anchor(store.attributes, field.origin);
    assert.equal(store.operands[0], receiver); assert.deepEqual(store.inputs, [reference,'f64']); assert.equal(store.result, '()');
    const fieldKey = sha256(['tsfg.core-reference.member.v1',owner.runtimeKey,'field',field.origin.source,
      String(field.origin.start),String(field.origin.end),field.name].join('\0'));
    assert.ok(store.attributes.includes('field = ' + JSON.stringify(fieldKey)));
    assert.ok(store.attributes.includes('initialize = true'));
  }
}
function changeMetadata(core, before, after) {
  const end = core.indexOf('\n'), header = core.slice(0, end); assert.ok(end > 0 && header.startsWith('module '));
  assert.equal(header.split(before).length, 2); return header.replace(before, after) + core.slice(end);
}
function changeConstant(core, bits) {
  const lines = core.split('\n'), at = lines.findIndex(line => line.includes('"tsfg_core.constant"(')); assert.ok(at >= 0);
  const changed = lines[at].replace(/value = "[0-9a-f]{16}"/, 'value = ' + JSON.stringify(bits));
  assert.notEqual(changed, lines[at]); lines[at] = changed; return lines.join('\n');
}
async function cppRejected(core, cause, command = '--canonicalize') {
  const result = await invokeCore(core, command);
  assert.equal(result.close.code, 3, result.stderr.toString('utf8')); assert.equal(result.stdout.length, 0);
  assert.match(result.stderr.toString('utf8'), cause);
}

test('every actual numeric occurrence rejects missing or mismatched context and field witnesses before its digest', async () => {
  const data = await actual();
  const cases = [
    {label:'missing context',category:'schema',mutate:field => { delete field.initializer.numericLiteral.contextType; }},
    {label:'empty context',category:'literal',mutate:field => { field.initializer.numericLiteral.contextType = ''; }},
    {label:'wrong context',category:'literal',mutate:field => { field.initializer.numericLiteral.contextType = field.initializer.type; }},
    {label:'missing witness',category:'schema',mutate:field => { field.initializerCompatibility = null; }},
    {label:'false assignability',category:'witness',mutate:field => { field.initializerCompatibility.assignable = false; }},
    {label:'wrong witness source',category:'witness',mutate:field => { field.initializerCompatibility.sourceType = field.type; }},
    {label:'wrong witness target',category:'witness',mutate:field => { field.initializerCompatibility.targetType = field.initializer.type; }},
    {label:'wrong witness anchor',category:'witness',mutate:field => { field.initializerCompatibility.origin.start++; }},
    {label:'wrong witness file',category:'witness',mutate:field => { field.initializerCompatibility.origin.source = '/original/minimal-scalars-v2.d.ts'; }},
  ];
  for (let index = 0; index < 7; index++) for (const item of cases) {
    const hir = structuredClone(data.hir), field = hir.classes[0].fields[index]; item.mutate(field);
    assert.equal(hir.context.factsDigest, data.hir.context.factsDigest);
    const label = field.name + ' ' + item.label;
    // Only the named HIR structural category counts. Digest/identity failure is
    // not emitter or RNE rejection evidence; no valid Source fact is invented.
    hirRejected(() => readReferenceHir(Buffer.from(canonical(hir))), item.category, label + ' cold');
    hirRejected(() => lowerHir(hir), item.category, label + ' public lower entry');
  }
});
test('actual seven number fields retain exact constants stores and anchors through real C++ roundtrip and optimization', async () => {
  const data = await actual(), core = lowerHir(data.hir);
  assert.equal(schema.version, 5);
  const first = await invokeCore(core); accepted(first);
  const roundtrip = await invokeCore(first.stdout); accepted(roundtrip);
  const optimized = await invokeCore(first.stdout, '--optimize'); accepted(optimized);
  assert.deepEqual(roundtrip.stdout, first.stdout); assert.deepEqual(optimized.stdout, first.stdout);
  exactInitializers(core, data.owner); exactInitializers(first.stdout.toString('utf8'), data.owner);
  assert.equal(printReferenceHir(data.hir), data.unresolved);
  await cppRejected(first.stdout, /\[r04-core-reference-unsupported\]/, '--emit-bytecode');
});
test('private number initializer Core rejects old versions and mixed v5 identities with old schemas', async () => {
  const { hir } = await actual(), core = lowerHir(hir);
  for (const version of [2,3,4]) await cppRejected(changeMetadata(core, 'version = 5 : i64', 'version = ' + version + ' : i64'),
    /\[core-ir-reference-metadata\] candidate version differs/);
  for (const oldSchema of ['sha256:d36b3094aa1504a71beb8b7fcb7370364b0e3b8c2d49c4d0e16a63641f07d692',
    'sha256:0120455de4db6b3c3c348f5e2504a2a4ab18026a83978874e1489cd5370ca313',
    'sha256:efd525313efdb99543e402a05f6d6fce4d5867cacde0ae2584260d4cd1dcac29'])
    await cppRejected(changeMetadata(core, 'schema = ' + JSON.stringify(sha256(canonical(schema))), 'schema = ' + JSON.stringify(oldSchema)),
      /\[core-ir-reference-metadata\] candidate schema differs/);
});
test('Core-only malformed floating constants fail the existing C++ constant verification boundary', async () => {
  const { hir } = await actual(), core = lowerHir(hir);
  // Current main exposes this generic parser/verification cause, not a detailed
  // floating diagnostic. These malformed Core values are not Source programs.
  for (const bits of ['3ff00000','gff0000000000000']) await cppRejected(changeConstant(core, bits),
    /\[core-ir-invalid\] parse or verification failed/);
});

// Malformed owned HIR only. These failures belong to context/witness validation
// before the unchanged facts digest; they are not new official Source facts or
// proof that an RNE conversion was attempted.
test('actual number field assignment rejects missing or inconsistent occurrence context and official witness', async () => {
  const [bytes,bindingBytes] = await Promise.all([
    readFile(fixture('readonly.facts.json')),readFile(fixture('readonly.binding.json')),
  ]);
  assert.equal(sha256(bytes),'sha256:d6e963a23c6b628951fd722ed8179ea900e21a823c91bcc0b35b831f04b67782');
  assert.equal(sha256(bindingBytes),'sha256:d371df01bac9ed2ae818a531a86197cb6daa7bb0cb2438de84e5a673d0f8470f');
  const owned = buildReferenceHir(decodeReferenceFacts(bytes,JSON.parse(bindingBytes.toString('utf8'))));
  const hir = readReferenceHir(Buffer.from(printReferenceHir(owned))); assert.deepEqual(hir,owned);
  const cases = [
    {label:'missing context',category:'schema',mutate:write => { delete write.right.numericLiteral.contextType; }},
    {label:'empty context',category:'literal',mutate:write => { write.right.numericLiteral.contextType = ''; }},
    {label:'wrong context',category:'literal',mutate:write => { write.right.numericLiteral.contextType = write.right.type; }},
    {label:'missing witness',category:'schema',mutate:write => { write.compatibility = null; }},
    {label:'false assignability',category:'witness',mutate:write => { write.compatibility.assignable = false; }},
    {label:'wrong witness source',category:'witness',mutate:write => { write.compatibility.sourceType = write.left.type; }},
    {label:'wrong witness target',category:'witness',mutate:write => { write.compatibility.targetType = write.right.type; }},
    {label:'wrong witness anchor',category:'witness',mutate:write => { write.compatibility.origin.start++; }},
    {label:'wrong witness file',category:'witness',mutate:write => { write.compatibility.origin.source = '/original/minimal-scalars-v2.d.ts'; }},
  ];
  for (const item of cases) {
    const changed = structuredClone(hir), holder = changed.classes.find(value => value.name === 'Holder'); assert.ok(holder);
    const write = holder.constructor.body[1].expression; assert.equal(write.kind,'ref.field.write');
    assert.equal(write.right.kind,'scalar.literal.unresolved'); assert.equal(write.right.token,'2');
    item.mutate(write); assert.equal(changed.context.factsDigest,hir.context.factsDigest);
    hirRejected(() => readReferenceHir(Buffer.from(canonical(changed))),item.category,item.label + ' cold');
    hirRejected(() => lowerHir(changed),item.category,item.label + ' public lower');
  }
});

// These are malformed owned HIR, not successful Source graphs. Exact shape,
// selected-signature or witness causes must precede the unchanged facts digest.
test('actual number constructor argument rejects bad context witness and selected target parameter facts', async () => {
  const [bytes,bindingBytes] = await Promise.all([
    readFile(fixture('construct.facts.json')),readFile(fixture('construct.binding.json')),
  ]);
  assert.equal(sha256(bytes),'sha256:e0dcbfba0174a9e5f02f36018bde40ddcb9e7afe7ae51450c7d0e3a81a5d82f3');
  assert.equal(sha256(bindingBytes),'sha256:6b0fe5978070e44c3c1fc052d337fca3bb865610c6ea4b5a0afa7fdce0223c37');
  const owned = buildReferenceHir(decodeReferenceFacts(bytes,JSON.parse(bindingBytes.toString('utf8'))));
  const hir = readReferenceHir(Buffer.from(printReferenceHir(owned))); assert.deepEqual(hir,owned);
  const cases = [
    {label:'missing context',category:'schema',mutate:call => { delete call.arguments[0].numericLiteral.contextType; }},
    {label:'empty context',category:'literal',mutate:call => { call.arguments[0].numericLiteral.contextType = ''; }},
    {label:'wrong context',category:'literal',mutate:call => { call.arguments[0].numericLiteral.contextType = call.arguments[0].type; }},
    {label:'missing witness',category:'schema',mutate:call => { call.argumentCompatibility[0] = null; }},
    {label:'false assignability',category:'witness',mutate:call => { call.argumentCompatibility[0].assignable = false; }},
    {label:'wrong witness source',category:'witness',mutate:call => { call.argumentCompatibility[0].sourceType = call.resolvedSignature.parameters[0].type; }},
    {label:'wrong witness target',category:'witness',mutate:call => { call.argumentCompatibility[0].targetType = call.arguments[0].type; }},
    {label:'wrong witness anchor',category:'witness',mutate:call => { call.argumentCompatibility[0].origin.start++; }},
    {label:'wrong witness file',category:'witness',mutate:call => { call.argumentCompatibility[0].origin.source = '/original/minimal-scalars-v2.d.ts'; }},
    {label:'missing selected parameters',category:'schema',mutate:call => { delete call.resolvedSignature.parameters; }},
    {label:'wrong selected type',category:'unsupported',mutate:call => { call.resolvedSignature.parameters[0].type = call.arguments[0].type; }},
    {label:'wrong selected symbol',category:'unsupported',mutate:call => { call.resolvedSignature.parameters[0].symbol = call.receiver.symbol; }},
    {label:'wrong selected arity',category:'unsupported',mutate:call => { call.resolvedSignature.parameters = []; }},
    {label:'wrong static target',category:'call',mutate:(call,factory) => { call.staticTarget = factory.constructor.id; }},
  ];
  for (const item of cases) {
    const changed = structuredClone(hir), factory = changed.classes.find(value => value.name === 'Factory'); assert.ok(factory);
    const field = factory.fields.find(value => value.name === 'fresh'); assert.ok(field);
    let call = field.initializer; while (call.kind === 'ref.view') call = call.value;
    assert.equal(call.kind,'ref.construct'); assert.equal(call.arguments[0].kind,'scalar.literal.unresolved');
    assert.equal(call.arguments[0].token,'5');
    item.mutate(call,factory); assert.equal(changed.context.factsDigest,hir.context.factsDigest);
    // This asserts the real pre-emitter rejection layer, not RNE or C++ credit.
    hirRejected(() => readReferenceHir(Buffer.from(canonical(changed))),item.category,item.label + ' cold');
    hirRejected(() => lowerHir(changed),item.category,item.label + ' public lower');
  }
});
