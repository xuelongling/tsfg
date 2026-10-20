// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';

// External next-slice entry test against the frozen Root Core checkout. This
// records no C++/RNE algorithm/Source admission/Runtime execution qualification.
const fixture = name => new URL('./fixtures/reference-source/' + name, import.meta.url);
const sha256 = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
// Handwritten IEEE f64 expectations. No product numeric helper or host numeric
// conversion generates the expected values. SHA only binds files and members.
/** @type {[string,string,string,string][]} */
const expected = [
  ['integer','1','i32','3ff0000000000000'],
  ['decimal','1.0','f64','3ff0000000000000'],
  ['exponent','1e0','f64','3ff0000000000000'],
  ['hexadecimal','0x1','i32','3ff0000000000000'],
  ['hexadecimalE','0xDEAD','i32','40ebd5a000000000'],
  ['exactLarge','9007199254740992','i32','4340000000000000'],
  ['roundedLarge','9007199254740993','i32','4340000000000000'],
];
let loaded;
async function actual() {
  if (!loaded) loaded = load();
  return loaded;
}
async function load() {
  const [bytes, bindingBytes, sourceBytes, declarationBytes] = await Promise.all([
    readFile(fixture('literal-facts.facts.json')), readFile(fixture('literal-facts.binding.json')),
    readFile(fixture('literal-facts.source.ts')),
    // Shared actual original bytes with the declared 362B/d629 identity. The
    // 394B production compiler/minimal-scalars-v2.d.ts is a different input.
    readFile(fixture('ancestor-super-method.declaration.d.ts')),
  ]);
  assert.equal(bytes.length, 9697); assert.equal(bindingBytes.length, 955);
  assert.equal(sourceBytes.length, 245); assert.equal(declarationBytes.length, 362);
  assert.equal(sha256(bytes), 'sha256:060ef5ebb3e0dbbad2203089262a1e54b055caed1c74f8861c17a263d580e7bb');
  assert.equal(sha256(bindingBytes), 'sha256:776a618825d7bcaf706ac9c52d4972b73953defcf8219563f7b043229d235aa3');
  assert.equal(sha256(sourceBytes), 'sha256:7a9081fd9db518f06b99150d1334f082c643bbc8f807d7cac3173f7a10675839');
  assert.equal(sha256(declarationBytes), 'sha256:d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141');
  const binding = JSON.parse(bindingBytes.toString('utf8')), source = sourceBytes.toString('utf8');
  assert.equal(binding.semanticProfile, 'tsfg-owned-class-facts-candidate-v5'); assert.equal(binding.sources.length, 2);
  /** @type {[string,Buffer,boolean][]} */
  const originals = [['/original/main.ts',sourceBytes,false], ['/original/minimal-scalars-v2.d.ts',declarationBytes,true]];
  for (const [path, content, declaration] of originals) {
    const origin = binding.sources.find(value => value.path === path); assert.ok(origin);
    assert.equal(origin.sha256, sha256(content)); assert.equal(origin.utf16Length, content.toString('utf8').length);
    assert.equal(origin.declaration, declaration); assert.deepEqual(origin.surrogateStarts, []);
  }
  const facts = decodeReferenceFacts(bytes, binding), owned = buildReferenceHir(facts);
  const unresolved = printReferenceHir(owned), persisted = Buffer.from(unresolved), hir = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(hir, owned); assert.equal(printReferenceHir(hir), unresolved);
  assert.equal(hir.format.version, 5); assert.equal(hir.format.semanticProfile, binding.semanticProfile);
  assert.equal(hir.classes.length, 1);
  const owner = hir.classes[0]; assert.equal(owner.name, 'Literals'); assert.equal(owner.fields.length, 7);
  assert.equal(owner.methods.length, 0); assert.equal(owner.constructor.kind, 'implicit-base');
  assert.equal(owner.constructor.access, 'public'); assert.deepEqual(owner.constructor.body, []);
  assert.deepEqual(owner.constructor.initializationFields, owner.fields.map(field => field.id));
  for (const [index, [name, token, defaultScalar]] of expected.entries()) {
    const field = owner.fields[index], value = field.initializer;
    assert.equal(field.name, name); assert.equal(field.ordinal, index);
    assert.equal(value.kind, 'scalar.literal.unresolved'); assert.equal(value.token, token);
    assert.deepEqual(value.numericLiteral, {state:'unresolved',officialType:value.type,defaultScalar,contextType:field.type});
    const narrow = hir.types.find(type => type.id === value.type), context = hir.types.find(type => type.id === field.type);
    assert.ok(narrow); assert.equal(narrow.kind, 'number-literal'); assert.equal(narrow.scalar, '');
    assert.ok(context); assert.equal(context.kind, 'number'); assert.equal(context.scalar, 'f64');
    assert.deepEqual(field.initializerCompatibility, {assignable:true,members:[],origin:value.origin,sourceType:value.type,targetType:field.type});
    assert.equal(source.slice(value.origin.start, value.origin.end), token);
    for (const record of [value,value.numericLiteral]) for (const key of ['bits','resolvedScalar'])
      assert.equal(Object.hasOwn(record, key), false, 'facts and HIR keep numeric literals unresolved');
  }
  assert.equal(owner.fields[5].initializer.type, owner.fields[6].initializer.type);
  assert.notEqual(owner.fields[5].initializer.token, owner.fields[6].initializer.token);
  assert.deepEqual(facts.graph.classes[0].fields.map(field => field.initializer.numericLiteral.state), Array(7).fill('unresolved'));
  return { hir, owner, unresolved };
}
function operations(body, name) {
  return body.split('\n').flatMap(line => {
    const match = line.match(/^\s*(?:(%[A-Za-z0-9_]+) = )?"([^"]+)"\(([^)]*)\) \{(.*)\} : \(([^)]*)\) -> (.*)$/);
    return !match || match[2] !== name ? [] : [{value:match[1],operands:match[3] ? match[3].split(/,\s*/) : [],
      attributes:match[4],inputs:match[5] ? match[5].split(/,\s*/) : [],result:match[6]}];
  });
}

test('actual literal bindings and original Source bytes preserve unresolved context witnesses through cold HIR4', async () => {
  await actual();
});
test('public lowerHir resolves seven actual number initializers to exact f64 constants and ordered initialization stores', async () => {
  const { hir, owner, unresolved } = await actual();
  // The current frozen consumer must first reach its explicit unresolved-literal
  // capability refusal. This is an entry RED, not an RNE or C++ consumer RED.
  const core = lowerHir(hir);
  const functions = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  \}/gm)]; assert.equal(functions.length, 1);
  const [, header, body] = functions[0];
  assert.ok(header.includes('tsfg_core.reference_kind = "constructor"'));
  assert.ok(header.includes('tsfg_core.reference_owner = ' + JSON.stringify(owner.runtimeKey)));
  const receiver = header.match(/(%[A-Za-z0-9_]+):\s*(!tsfg_core\.ref<"[^"]+">)/); assert.ok(receiver);
  const constants = operations(body, 'tsfg_core.constant'), stores = operations(body, 'tsfg_core.ref.field.write');
  assert.equal(constants.length, 7); assert.equal(stores.length, 7);
  for (const [index, [name, token, , bits]] of expected.entries()) {
    const field = owner.fields[index], literal = field.initializer, store = stores[index];
    const constant = constants.find(value => value.value === store.operands[1]); assert.ok(constant, name);
    assert.deepEqual(constant.operands, []); assert.equal(constant.result, 'f64');
    assert.ok(constant.attributes.includes('value = ' + JSON.stringify(bits)), token + ' has independently fixed f64 bits');
    assert.ok(constant.attributes.includes('tsfg_source.start = ' + literal.origin.start + ' : i64'));
    assert.ok(constant.attributes.includes('tsfg_source.end = ' + literal.origin.end + ' : i64'));
    assert.deepEqual(store.inputs, [receiver[2],'f64']); assert.equal(store.result, '()');
    assert.equal(store.operands[0], receiver[1]);
    const fieldKey = sha256(['tsfg.core-reference.member.v1',owner.runtimeKey,'field',field.origin.source,
      String(field.origin.start),String(field.origin.end),field.name].join('\0'));
    assert.ok(store.attributes.includes('field = ' + JSON.stringify(fieldKey)), name + ' keeps its actual owned field identity');
    assert.ok(store.attributes.includes('initialize = true'));
  }
  assert.equal(printReferenceHir(hir), unresolved, 'lowering resolves occurrences without rewriting cold HIR facts');
});
