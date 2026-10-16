// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, verifyReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { sha256 } from '../../compiler/identity.mjs';

// Actual public Program/checker capture: PID24384, 45 producer inputs,
// candidate-graphs-v3-locals-green/README.json. Correspondence, not Source admission.
const fixture = name => new URL('./fixtures/reference-source/' + name, import.meta.url);
async function official(name, digest, utf16Length) {
  const bytes = await readFile(fixture(name + '.facts.json'));
  assert.equal(sha256(bytes), 'sha256:' + digest);
  const binding = JSON.parse(await readFile(fixture(name + '.binding.json'), 'utf8'));
  const source = await readFile(fixture(name + '.source.ts'), 'utf8');
  const origin = binding.sources.find(value => !value.declaration);
  assert.ok(origin);
  assert.equal(sha256(source), origin.sha256);
  assert.equal(source.length, utf16Length); assert.equal(origin.utf16Length, utf16Length);
  assert.deepEqual(origin.surrogateStarts, [3]);
  assert.equal(source.slice(3,5), '😀');
  const facts = decodeReferenceFacts(bytes, binding);
  assert.equal(facts.format.version, 3);
  const hir = buildReferenceHir(facts);
  assert.equal(hir.format.version, 3);
  return { facts, hir, source };
}
function projection(owner) {
  return [...owner.fields, ...owner.methods].map(member => ({ source: member.symbol, target: member.symbol }));
}
function view(value, owner, kind, symbol) {
  assert.equal(value.kind, 'ref.view');
  assert.equal(value.sourceType, owner.instanceType); assert.equal(value.targetType, owner.instanceType);
  assert.deepEqual(value.members, projection(owner));
  assert.equal(value.value.kind, kind); assert.equal(value.value.symbol, symbol);
  assert.equal(value.value.type, owner.instanceType);
  assert.deepEqual(value.origin, value.value.origin);
  return value.value;
}
function declaration(method, owner, source, expectedKind, scalar = false) {
  const statement = method.body[0];
  assert.deepEqual(Object.keys(statement).sort(), ['compatibility','expression','kind','local','origin']);
  assert.equal(statement.kind, 'local');
  assert.equal(statement.expression, null); assert.equal(statement.compatibility, null);
  assert.deepEqual(Object.keys(statement.local).sort(), ['bindings','kind']);
  assert.equal(statement.local.kind, expectedKind); assert.equal(statement.local.bindings.length, 1);
  const binding = statement.local.bindings[0];
  assert.deepEqual(Object.keys(binding).sort(), ['compatibility','initializer','origin','symbol','type']);
  assert.equal(source.slice(statement.origin.start, statement.origin.end), expectedKind + ' alias: ' + (scalar ? 'number = seed;' : 'Box = other;'));
  assert.equal(source.slice(binding.origin.start, binding.origin.end), scalar ? 'alias: number = seed' : 'alias: Box = other');
  assert.ok(statement.origin.start < binding.origin.start && binding.origin.end < statement.origin.end);
  const parameter = method.signature.parameters[0];
  const initializer = scalar ? binding.initializer : view(binding.initializer, owner, 'ref.parameter', parameter.symbol);
  assert.equal(initializer.kind, 'ref.parameter'); assert.equal(initializer.symbol, parameter.symbol);
  assert.equal(initializer.type, parameter.type); assert.equal(binding.type, parameter.type);
  assert.deepEqual(binding.compatibility, { assignable: true, members: scalar ? [] : projection(owner),
    origin: initializer.origin, sourceType: initializer.type, targetType: binding.type });
  assert.equal(source.slice(initializer.origin.start, initializer.origin.end), scalar ? 'seed' : 'other');
  return binding;
}
function localSymbols(hir, bindings, source) {
  assert.equal(new Set(bindings.map(binding => binding.symbol)).size, 3);
  const symbols = bindings.map(binding => hir.symbols.find(symbol => symbol.id === binding.symbol));
  assert.ok(symbols.every(symbol => symbol && symbol.kind === 'local' && symbol.name === 'alias'));
  for (const [index, symbol] of symbols.entries()) {
    const binding = bindings[index];
    assert.equal(symbol.type, binding.type);
    assert.deepEqual(symbol.declaration, { source: '/original/main.ts', start: binding.origin.start, end: binding.origin.start + 5 });
    assert.equal(source.slice(symbol.declaration.start, symbol.declaration.end), 'alias');
    assert.ok(symbol.declaration.end < binding.origin.end);
  }
}
function returnsLocal(method, owner, binding, scalar = false) {
  const statement = method.body.at(-1);
  assert.equal(statement.kind, 'return'); assert.equal(statement.local, null);
  const value = scalar ? statement.expression : view(statement.expression, owner, 'local.read', binding.symbol);
  assert.equal(value.kind, 'local.read'); assert.equal(value.symbol, binding.symbol); assert.equal(value.type, binding.type);
  assert.deepEqual(statement.compatibility, { assignable: true, members: scalar ? [] : projection(owner),
    origin: value.origin, sourceType: value.type, targetType: method.signature.return });
  return value;
}
function scalarCopy(method, owner, source, hir) {
  assert.equal(method.name, 'passScalar'); assert.deepEqual(method.body.map(value => value.kind), ['local','return']);
  const binding = declaration(method, owner, source, 'const', true);
  const type = hir.types.find(value => value.id === binding.type);
  assert.ok(type); assert.equal(type.kind, 'number'); assert.equal(type.scalar, 'f64');
  assert.equal(binding.initializer.numericLiteral, null);
  assert.equal(Object.hasOwn(binding.initializer, 'bits'), false);
  assert.equal(Object.hasOwn(binding.initializer, 'resolvedScalar'), false);
  const returned = returnsLocal(method, owner, binding, true);
  assert.equal(returned.numericLiteral, null);
  return binding;
}
function fieldWrite(statement, owner, binding) {
  assert.equal(statement.kind, 'expression'); assert.equal(statement.local, null);
  const write = statement.expression;
  assert.equal(write.kind, 'ref.field.write'); assert.equal(write.left.kind, 'ref.field.location');
  assert.equal(write.left.symbol, owner.fields[0].symbol);
  assert.equal(write.left.receiver.kind, 'local.read'); assert.equal(write.left.receiver.symbol, binding.symbol);
  assert.equal(write.left.permission.writable, true); assert.equal(write.left.permission.writeUse, true);
  assert.equal(write.left.permission.readonly, false);
  assert.equal(write.right.kind, 'ref.field.read'); assert.equal(write.right.symbol, owner.fields[0].symbol);
  assert.equal(write.right.receiver.kind, 'ref.this'); assert.equal(write.right.receiver.symbol, owner.symbol);
}
function roundTrip(hir) {
  assert.deepEqual(verifyReferenceHir(hir), hir);
  const bytes = Buffer.from(printReferenceHir(hir));
  const cold = readReferenceHir(bytes); bytes.fill(0);
  assert.deepEqual(cold, hir);
}

test('official const method-local aliases preserve writable receivers independent scopes and cold HIR', async () => {
  const { facts, hir, source } = await official('locals-const', '2f6a2acab5295fd1e3820499456b90132525020003a8225b90602ebb9d7d6b70', 352);
  const owner = hir.classes[0], [share, keep, scalar] = owner.methods;
  assert.equal(owner.name, 'Box'); assert.equal(owner.fields[0].initializer, null);
  assert.deepEqual(owner.methods.map(method => method.name), ['share','keep','passScalar']);
  assert.deepEqual(share.body.map(value => value.kind), ['local','expression','return']);
  const alias = declaration(share, owner, source, 'const');
  fieldWrite(share.body[1], owner, alias);
  const returned = returnsLocal(share, owner, alias);
  assert.equal(returned.symbol, share.body[1].expression.left.receiver.symbol);
  assert.deepEqual(keep.body.map(value => value.kind), ['local','return']);
  const kept = declaration(keep, owner, source, 'const'); returnsLocal(keep, owner, kept);
  localSymbols(hir, [alias, kept, scalarCopy(scalar, owner, source, hir)], source);
  assert.notEqual(alias.initializer.value, facts.graph.classes[0].methods[0].body[0].local.bindings[0].initializer);
  assert.equal(owner.constructor.body[0].local, null);
  roundTrip(hir);
});

test('official let method-local rebinding preserves locations receivers scalar copies and cold HIR', async () => {
  const { hir, source } = await official('locals-let', '29754d930121cd9cd992a5146e1e0d7f4c1ac03b665061d9236142c5d531d197', 393);
  const owner = hir.classes[0], [share, keep, scalar] = owner.methods;
  assert.equal(owner.name, 'Box'); assert.equal(owner.fields[0].initializer, null);
  assert.deepEqual(owner.methods.map(method => method.name), ['share','keep','passScalar']);
  assert.deepEqual(share.body.map(value => value.kind), ['local','expression','expression','return']);
  const alias = declaration(share, owner, source, 'let');
  const statement = share.body[1], rebind = statement.expression;
  assert.equal(statement.local, null); assert.equal(statement.compatibility, null);
  assert.equal(rebind.kind, 'local.write'); assert.equal(rebind.operator, '=');
  assert.equal(rebind.left.kind, 'local.location'); assert.equal(rebind.left.symbol, alias.symbol);
  assert.equal(rebind.left.type, alias.type);
  const replacement = view(rebind.right, owner, 'ref.parameter', share.signature.parameters[1].symbol);
  assert.equal(rebind.type, replacement.type);
  assert.deepEqual(rebind.compatibility, { assignable: true, members: projection(owner),
    origin: replacement.origin, sourceType: replacement.type, targetType: alias.type });
  assert.equal(source.slice(rebind.origin.start, rebind.origin.end), 'alias = replacement');
  fieldWrite(share.body[2], owner, alias);
  assert.equal(returnsLocal(share, owner, alias).symbol, rebind.left.symbol);
  const kept = declaration(keep, owner, source, 'const'); returnsLocal(keep, owner, kept);
  localSymbols(hir, [alias, kept, scalarCopy(scalar, owner, source, hir)], source);
  roundTrip(hir);
});
