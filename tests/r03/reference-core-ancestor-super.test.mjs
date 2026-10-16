// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';
import { sha256 } from '../../compiler/identity.mjs';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';

const fixture = suffix => new URL('./fixtures/reference-source/ancestor-super-method.' + suffix, import.meta.url);
let loaded;
async function actual() {
  if (!loaded) loaded = load();
  return loaded;
}
async function load() {
  const [bytes, bindingBytes, sourceBytes, declarationBytes] = await Promise.all([
    readFile(fixture('facts.json')), readFile(fixture('binding.json')),
    readFile(fixture('source.ts')), readFile(fixture('declaration.d.ts')),
  ]);
  assert.equal(bytes.length, 9154);
  assert.equal(sha256(bytes), 'sha256:49e38f027ef9eacc9165d63619c40ab2d4696ceb2b136e5ed0d0770d5a6d5603');
  assert.equal(sha256(bindingBytes), 'sha256:d87750d8d4e57ae255e403a64b4f782c747e880e9cd363c130ce8ab41776c2b1');
  assert.equal(sourceBytes.length, 208); assert.equal(declarationBytes.length, 362);
  assert.equal(sha256(sourceBytes), 'sha256:71676826939f0d8f7d6481ec5c1e7650048ea8ae31c18180ff54309d72a32fc2');
  assert.equal(sha256(declarationBytes), 'sha256:d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141');
  const binding = JSON.parse(bindingBytes.toString('utf8'));
  assert.equal(binding.sources.length, 2);
  /** @type {[string,Buffer,boolean,number[]][]} */
  const originals = [['/original/main.ts',sourceBytes,false,[3]],
    ['/original/minimal-scalars-v2.d.ts',declarationBytes,true,[]]];
  for (const [path, content, declaration, surrogates] of originals) {
    const origin = binding.sources.find(value => value.path === path); assert.ok(origin);
    assert.equal(origin.sha256, sha256(content)); assert.equal(origin.utf16Length, content.toString('utf8').length);
    assert.equal(origin.declaration, declaration); assert.deepEqual(origin.surrogateStarts, surrogates);
  }
  const owned = buildReferenceHir(decodeReferenceFacts(bytes, binding));
  const persisted = Buffer.from(printReferenceHir(owned)), hir = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(hir, owned); assert.equal(hir.format.version, 4);
  assert.equal(hir.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v4');
  const root = hir.classes.find(value => value.name === 'Root'), middle = hir.classes.find(value => value.name === 'Middle');
  const leaf = hir.classes.find(value => value.name === 'Leaf'); assert.ok(root); assert.ok(middle); assert.ok(leaf);
  assert.equal(middle.base, root.id); assert.equal(leaf.base, middle.id);
  const touch = root.methods.find(value => value.name === 'touch'), call = leaf.methods.find(value => value.name === 'call');
  assert.ok(touch); assert.ok(call);
  const expression = call.body[0].expression;
  assert.equal(expression.kind, 'ref.method.call'); assert.equal(expression.dispatch, 'direct-base-method');
  assert.equal(expression.staticTarget, touch.id); assert.equal(expression.receiver.kind, 'ref.super');
  const receiver = hir.types.find(value => value.id === expression.receiver.type); assert.ok(receiver);
  assert.equal(receiver.kind, 'class-this-view'); assert.equal(receiver.declaration, middle.id);
  assert.equal(receiver.thisArgument, leaf.thisType);
  const core = lowerHir(hir); assert.equal(typeof core, 'string');
  return { core, root, middle, leaf };
}
function callable(core, owner, name) {
  const matches = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  \}/gm)].filter(value =>
    value[1].includes('tsfg_core.reference_owner = ' + JSON.stringify(owner))
    && value[1].includes('tsfg_core.logical_name = ' + JSON.stringify(name)));
  assert.equal(matches.length, 1);
  const [, header, body] = matches[0];
  const parameters = [...header.matchAll(/(%[A-Za-z0-9_]+):\s*(!tsfg_core\.ref<"[^"]+">|f64)/g)]
    .map(([, value,type]) => ({ value,type }));
  return { header, body, parameters, symbol:header.match(/^(@(?:"[^"]+"|[A-Za-z0-9_]+))\(/)[1] };
}
function operations(body, name) {
  return body.split('\n').flatMap(line => {
    const match = line.match(/^\s*(?:(%[A-Za-z0-9_]+) = )?"([^"]+)"\(([^)]*)\) \{(.*)\} : \(([^)]*)\) -> (.*)$/);
    return !match || match[2] !== name ? [] : [{ value:match[1], operands:match[3] ? match[3].split(/,\s*/) : [],
      attributes:match[4], inputs:match[5] ? match[5].split(/,\s*/) : [], result:match[6] }];
  });
}

test('actual ancestor-super Source binding survives cold HIR4 and reaches public lowerHir', async () => {
  await actual();
});
test('actual inherited super method reaches the real C++ consumer and preserves its ancestor receiver', async () => {
  const a = await actual();
  // Invoke the real consumer before checking any emitted operation text. The
  // initial RED must expose the CLI type failure, not a representation regex.
  const first = await invokeCore(a.core); accepted(first);
  const roundtrip = await invokeCore(first.stdout); accepted(roundtrip);
  const optimized = await invokeCore(first.stdout, '--optimize'); accepted(optimized);
  assert.deepEqual(roundtrip.stdout, first.stdout); assert.deepEqual(optimized.stdout, first.stdout);
  const target = callable(a.core, a.root.runtimeKey, 'touch'), fn = callable(a.core, a.leaf.runtimeKey, 'call');
  const calls = operations(fn.body, 'func.call'); assert.equal(calls.length, 1);
  const call = calls[0]; assert.ok(call.attributes.includes('callee = ' + target.symbol));
  assert.deepEqual(call.inputs, [target.parameters[0].type, 'f64']); assert.equal(call.result, 'f64');
  assert.equal(call.operands[1], fn.parameters[1].value);
  const bases = new Map();
  for (const value of operations(fn.body, 'tsfg_core.ref.base')) bases.set(value.value, value);
  const lineage = [a.leaf, a.middle, a.root], positions = new Map();
  lineage.forEach((owner,index) => positions.set(owner.runtimeKey,index));
  let receiver = call.operands[0], previous = 3;
  const visited = new Set();
  while (bases.has(receiver)) {
    assert.ok(!visited.has(receiver)); visited.add(receiver);
    const base = bases.get(receiver), key = base.attributes.match(/class = "([^"]+)"/)[1];
    assert.ok(positions.has(key)); const position = positions.get(key);
    assert.ok(position > 0 && position < previous, 'every receiver adaptation follows the known ancestor chain');
    previous = position; assert.equal(base.operands.length, 1); receiver = base.operands[0];
  }
  assert.ok(visited.size > 0); assert.equal(receiver, fn.parameters[0].value);
  assert.doesNotMatch(fn.body, /"tsfg_core\.ref\.view"/, 'ancestor super needs no invented structural projection');
  const returned = operations(fn.body, 'func.return'); assert.equal(returned.length, 1);
  assert.deepEqual(returned[0].operands, [call.value]);
});
