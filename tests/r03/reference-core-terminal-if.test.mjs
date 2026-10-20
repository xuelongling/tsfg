// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';

const fixture = suffix => new URL('./fixtures/reference-source/terminal-reference-if.' + suffix, import.meta.url);
let loaded;
async function actual() {
  if (!loaded) loaded = load();
  return loaded;
}
async function load() {
  const [bytes, bindingBytes, sourceBytes, declarationBytes] = await Promise.all([
    readFile(fixture('facts.json')), readFile(fixture('binding.json')), readFile(fixture('source.ts')),
    readFile(new URL('./fixtures/reference-source/ancestor-super-method.declaration.d.ts', import.meta.url)),
  ]);
  assert.equal(bytes.length, 5706); assert.equal(bindingBytes.length, 973);
  assert.equal(sha256(bytes), 'sha256:64029f8d2ee659c3260c3793b2e4f401ffc1a94a09f73d434981a67ac3180a19');
  assert.equal(sha256(bindingBytes), 'sha256:522a04ce2a3cb429a668de309038c1b0c3b8c486bdb1fc924a86095f5536f964');
  assert.equal(sourceBytes.length, 126); assert.equal(declarationBytes.length, 362);
  assert.equal(sha256(sourceBytes), 'sha256:3d2709b9614df06e174a43c76ebb25ae16d5efdac38d5055c58fcb9ee2ee0c10');
  assert.equal(sha256(declarationBytes), 'sha256:d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141');
  const binding = JSON.parse(bindingBytes.toString('utf8')), source = sourceBytes.toString('utf8');
  assert.equal(source.length, 124); assert.equal(binding.sources.length, 2);
  assert.equal(binding.semanticProfile, 'tsfg-owned-class-facts-candidate-v5');
  assert.equal(binding.scope, 'class:terminal-reference-if');
  /** @type {[string,Buffer,boolean,number[]][]} */
  const originals = [['/original/main.ts',sourceBytes,false,[3]],
    ['/original/minimal-scalars-v2.d.ts',declarationBytes,true,[]]];
  for (const [path, content, declaration, surrogates] of originals) {
    const origin = binding.sources.find(value => value.path === path); assert.ok(origin);
    assert.equal(origin.sha256, sha256(content)); assert.equal(origin.utf16Length, content.toString('utf8').length);
    assert.equal(origin.declaration, declaration); assert.deepEqual(origin.surrogateStarts, surrogates);
  }
  const graph = JSON.parse(bytes.toString('utf8')), facts = decodeReferenceFacts(bytes, binding);
  assert.equal(facts.format.version, 5);
  const owned = buildReferenceHir(facts), persisted = Buffer.from(printReferenceHir(owned));
  const hir = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(hir, owned); assert.equal(hir.format.version, 5);
  assert.equal(hir.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v5');
  assert.equal(hir.classes.length, 1);
  const box = hir.classes[0]; assert.equal(box.name, 'Box'); assert.equal(box.methods.length, 1);
  assert.equal(box.runtimeKey, 'sha256:cb37efe7cd62c7d216e1c950b7aadc5fac62da7c789ad8d8d7530993f3af4128');
  const method = box.methods[0]; assert.equal(method.name, 'choose');
  assert.deepEqual(method.signature.parameters.map(value => value.type), ['t:boolean',box.instanceType]);
  assert.equal(method.signature.return, box.instanceType); assert.equal(method.body.length, 1);
  const statement = method.body[0], branch = statement.branch;
  assert.equal(statement.kind, 'if'); assert.equal(statement.local, null);
  assert.equal(statement.expression, null); assert.equal(statement.compatibility, null);
  assert.equal(branch.condition.kind, 'ref.parameter'); assert.equal(branch.condition.type, 't:boolean');
  assert.equal(branch.condition.symbol, method.signature.parameters[0].symbol);
  assert.deepEqual(branch.conditionCompatibility, {assignable:true,members:[],sourceType:'t:boolean',targetType:'t:boolean',
    origin:branch.condition.origin});
  /** @type {[any,number,number,string][]} */
  const anchors = [[statement.origin,69,118,'if (flag) { return this; } else { return other; }'],
    [branch.condition.origin,73,77,'flag'],[branch.then.origin,79,95,'{ return this; }'],
    [branch.else.origin,101,118,'{ return other; }']];
  for (const [origin,start,end,text] of anchors) {
    assert.deepEqual(origin, {source:'/original/main.ts',start,end}); assert.equal(source.slice(start,end), text);
  }
  const expected = [{block:branch.then,kind:'ref.this',symbol:box.symbol,type:box.thisType,start:81,end:93,
    valueStart:88,valueEnd:92,text:'this'}, {block:branch.else,kind:'ref.parameter',symbol:method.signature.parameters[1].symbol,
    type:box.instanceType,start:103,end:116,valueStart:110,valueEnd:115,text:'other'}];
  for (const value of expected) {
    assert.equal(value.block.body.length, 1);
    const returned = value.block.body[0], view = returned.expression;
    assert.equal(returned.kind, 'return'); assert.equal(returned.local, null);
    assert.deepEqual(returned.origin, {source:'/original/main.ts',start:value.start,end:value.end});
    assert.equal(source.slice(value.start,value.end), 'return ' + value.text + ';');
    assert.equal(view.kind, 'ref.view'); assert.equal(view.sourceType, value.type); assert.equal(view.targetType, box.instanceType);
    assert.deepEqual(view.members, [{source:method.symbol,target:method.symbol}]);
    assert.equal(view.value.kind, value.kind); assert.equal(view.value.symbol, value.symbol); assert.equal(view.value.type, value.type);
    assert.deepEqual(view.origin, {source:'/original/main.ts',start:value.valueStart,end:value.valueEnd});
    assert.deepEqual(view.origin, view.value.origin); assert.equal(source.slice(value.valueStart,value.valueEnd), value.text);
    assert.deepEqual(returned.compatibility, {assignable:true,members:view.members,origin:view.origin,
      sourceType:value.type,targetType:box.instanceType});
  }
  return {graph,binding,hir,box,method,branch};
}
/** @param {() => unknown} run @param {string} category @param {string} label */
function fails(run, category, label) {
  assert.throws(run, error => error instanceof Error && Object.hasOwn(error, 'code')
    && Reflect.get(error, 'code') === 'reference-facts-' + category, label);
}

test('actual Source5 terminal reference branch retains exact binding witnesses anchors and cold HIR', async () => {
  const data = await actual();
  // Malformed owned inputs, never substitute Source/checker facts. Their exact
  // shape/condition/witness/origin failures must precede the unchanged digest.
  /** @type {ReadonlyArray<readonly [string,string,(branch:any) => void]>} */
  const changes = [
    ['missing else','schema', branch => { delete branch.else; }],
    ['unknown field','schema', branch => { branch.safe = true; }],
    ['nonboolean condition','condition', branch => { branch.condition.type = 't:number'; }],
    ['missing condition witness','schema', branch => { delete branch.conditionCompatibility; }],
    ['false witness','witness', branch => { branch.conditionCompatibility.assignable = false; }],
    ['wrong witness source','witness', branch => { branch.conditionCompatibility.sourceType = 't:number'; }],
    ['wrong witness target','witness', branch => { branch.conditionCompatibility.targetType = 't:number'; }],
    ['wrong witness anchor','witness', branch => { branch.conditionCompatibility.origin.start++; }],
    ['condition outside if','origin', branch => { branch.condition.origin.start = 68; }],
    ['swapped blocks','origin', branch => { [branch.then,branch.else] = [branch.else,branch.then]; }],
    ['empty then','body', branch => { branch.then.body = []; }],
    ['extra else return','body', branch => { branch.else.body.push(structuredClone(branch.else.body[0])); }],
    ['return outside block','origin', branch => { branch.then.body[0].origin = structuredClone(branch.else.origin); }],
  ];
  for (const [label,category,change] of changes) {
    const graph = structuredClone(data.graph), hir = structuredClone(data.hir);
    change(graph.classes[0].methods[0].body[0].branch); change(hir.classes[0].methods[0].body[0].branch);
    fails(() => decodeReferenceFacts(Buffer.from(canonical(graph)), data.binding), category, 'facts ' + label);
    fails(() => readReferenceHir(Buffer.from(canonical(hir))), category, 'cold HIR ' + label);
  }
});
/** @param {string} core */
function chooseFunction(core) {
  const functions = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  \}/gm)];
  assert.equal(functions.length, 2, 'actual Box has one constructor and choose');
  const matches = functions.filter(value => value[1].includes('tsfg_core.logical_name = "choose"'));
  assert.equal(matches.length, 1); const [,header,body] = matches[0];
  const parameters = [...header.matchAll(/(%[A-Za-z0-9_]+):\s*(!tsfg_core\.ref<"[^"]+">|i1)/g)]
    .map(([,value,type]) => ({value,type}));
  assert.equal(parameters.length, 3);
  assert.ok(parameters[0].type.startsWith('!tsfg_core.ref<')); assert.equal(parameters[1].type, 'i1');
  assert.equal(parameters[2].type, parameters[0].type);
  return {header,body,parameters};
}
/** @param {string} body */
function returnedObject(body) {
  const views = new Map([...body.matchAll(/(%[A-Za-z0-9_]+) = "tsfg_core\.ref\.view"\((%[A-Za-z0-9_]+)\)/g)]
    .map(value => [value[1],value[2]]));
  const matches = [...body.matchAll(/"func\.return"\((%[A-Za-z0-9_]+)\).* -> \(\)/g)];
  assert.equal(matches.length, 1); let value = matches[0][1]; const seen = new Set();
  while (views.has(value)) { assert.ok(!seen.has(value)); seen.add(value); value = views.get(value); }
  return value;
}

test('public lowerHir terminal reference branch reaches real C++ CFG roots and rejects wire9', async () => {
  const data = await actual();
  // First producer action: baseline must fail here with its real if capability
  // cause, before a representation assertion or any C++ process can substitute.
  const core = lowerHir(data.hir);
  const first = await invokeCore(core); accepted(first);
  const roundtrip = await invokeCore(first.stdout); accepted(roundtrip);
  const optimized = await invokeCore(first.stdout, '--optimize'); accepted(optimized);
  assert.deepEqual(roundtrip.stdout, first.stdout); assert.deepEqual(optimized.stdout, first.stdout);
  const fn = chooseFunction(core);
  const edges = [...fn.body.matchAll(/cf\.cond_br\s+(%[A-Za-z0-9_]+),\s*\^([A-Za-z0-9_]+),\s*\^([A-Za-z0-9_]+)/g)];
  assert.equal(edges.length, 1); assert.equal(edges[0][1], fn.parameters[1].value);
  const blocks = new Map([...fn.body.matchAll(/^  \^([A-Za-z0-9_]+):\n([\s\S]*?)(?=^  \^|(?![\s\S]))/gm)]
    .map(value => [value[1],value[2]]));
  assert.equal(blocks.size, 2); assert.notEqual(edges[0][2], edges[0][3]);
  assert.ok(blocks.has(edges[0][2])); assert.ok(blocks.has(edges[0][3]));
  assert.equal(returnedObject(blocks.get(edges[0][2])), fn.parameters[0].value);
  assert.equal(returnedObject(blocks.get(edges[0][3])), fn.parameters[2].value);
  assert.equal([...fn.body.matchAll(/"tsfg_core\.fuel"\(/g)].length, 1, 'entry fuel stays exactly once');
  assert.equal([...fn.body.matchAll(/"func\.return"\(/g)].length, 2);
  assert.doesNotMatch(fn.body, /"(?:tsfg_core\.ref\.(?:alloc|call)|func\.call)"/);
  assert.doesNotMatch(fn.body, /^\s*cf\.br\b/m, 'two terminal returns need no merge block');
  for (const origin of [data.method.origin,data.method.body[0].origin,data.branch.then.body[0].origin,data.branch.else.body[0].origin]) {
    assert.ok(core.includes('tsfg_source.start = ' + origin.start + ' : i64, tsfg_source.end = ' + origin.end + ' : i64'));
  }
  const canonicalCore = first.stdout.toString('utf8');
  assert.equal([...canonicalCore.matchAll(/tsfg_core\.reference_roots\s*=\s*\[\]/g)].length, 2,
    'both real call-free functions have exact empty safepoint tables; this asserts no runtime GC execution');
  const wire = await invokeCore(first.stdout, '--emit-bytecode');
  assert.equal(wire.close.code, 3); assert.equal(wire.stdout.length, 0);
  assert.match(wire.stderr.toString('utf8'), /\[r04-core-reference-unsupported\]/);
});
