// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';
import { sha256 } from '../../compiler/identity.mjs';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';

// All input facts are actual profile4 Source output. Subsequent mutations are
// Core-only verifier cases, never additional Source facts or execution claims.
const fixture = suffix => new URL('./fixtures/reference-source/multiple-sources.' + suffix, import.meta.url);
let loaded;
async function actual() {
  if (!loaded) loaded = load();
  return loaded;
}
async function load() {
  const [bytes, bindingBytes] = await Promise.all([readFile(fixture('facts.json')), readFile(fixture('binding.json'))]);
  assert.equal(sha256(bytes), 'sha256:593093a1772fff01f8c6c82802e50edf44b24f29042c2e3ace494957e6a93db7');
  assert.equal(sha256(bindingBytes), 'sha256:d0086585d8f3695ab1583767ef5b292c6f8dd4ea8a4e76bdc1c91920f7162fcb');
  const binding = JSON.parse(bindingBytes.toString('utf8'));
  /** @type {[string,string][]} */
  const originals = [['/original/a-main.ts','a-main.source.ts'], ['/original/z-base.ts','z-base.source.ts']];
  for (const [path, suffix] of originals) {
    const text = await readFile(fixture(suffix), 'utf8'), source = binding.sources.find(value => value.path === path);
    assert.ok(source); assert.equal(source.declaration, false);
    assert.equal(sha256(text), source.sha256); assert.equal(text.length, source.utf16Length);
  }
  const owned = buildReferenceHir(decodeReferenceFacts(bytes, binding));
  const persisted = Buffer.from(printReferenceHir(owned)), hir = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(hir, owned); assert.equal(hir.format.version, 5);
  assert.equal(hir.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v5');
  const core = lowerHir(hir), base = hir.classes.find(value => value.name === 'Base');
  const derived = hir.classes.find(value => value.name === 'Derived');
  assert.ok(base); assert.ok(derived); assert.equal(derived.base, base.id);
  for (const owner of hir.classes) assert.equal(owner.constructor.access, 'public');
  const baseTouch = base.methods.find(value => value.name === 'touch');
  const derivedTouch = derived.methods.find(value => value.name === 'touch');
  assert.ok(baseTouch); assert.ok(derivedTouch); assert.equal(derivedTouch.overrideTarget, baseTouch.id);
  const makeMethod = derived.methods.find(value => value.name === 'make'), rebindMethod = derived.methods.find(value => value.name === 'rebind');
  assert.ok(makeMethod); assert.ok(rebindMethod);
  return { core, base, derived, baseTouch, derivedTouch, makeMethod, rebindMethod,
    baseFn: callable(core, base.runtimeKey, 'touch'), touchFn: callable(core, derived.runtimeKey, 'touch'),
    ctor: callable(core, derived.runtimeKey, 'constructor'), make: callable(core, derived.runtimeKey, 'make'),
    rebind: callable(core, derived.runtimeKey, 'rebind') };
}
function callable(core, owner, name) {
  const matches = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  \}/gm)].filter(match =>
    match[1].includes('tsfg_core.reference_owner = ' + JSON.stringify(owner))
    && match[1].includes('tsfg_core.logical_name = ' + JSON.stringify(name)));
  assert.equal(matches.length, 1);
  const match = matches[0], header = match[1];
  const parameters = [...header.matchAll(/(%[A-Za-z0-9_]+):\s*(!tsfg_core\.ref<"[^"]+">|f64)/g)]
    .map(value => ({ value:value[1], type:value[2] }));
  const attribute = name => { const value = header.match(new RegExp(name + ' = "([^"]+)"')); assert.ok(value); return value[1]; };
  return { whole:match[0], header, body:match[2], parameters,
    symbol:header.match(/^(@(?:"[^"]+"|[A-Za-z0-9_]+))\(/)[1],
    key:attribute('tsfg_core\\.function_id'), signature:attribute('tsfg_core\\.signature_hash') };
}
function body(core, fn, text) {
  assert.ok(core.includes(fn.whole));
  return core.replace(fn.whole, '  func.func ' + fn.header + '\n' + text.trimEnd() + '\n  }');
}
function insert(core, fn, operation, pivot, after = false) {
  const lines = fn.body.trimEnd().split('\n'), matches = lines.map((line,index) => ({line,index}))
    .filter(value => value.line.includes(JSON.stringify(pivot) + '('));
  assert.equal(matches.length, 1);
  lines.splice(matches[0].index + Number(after), 0, operation);
  return body(core, fn, lines.join('\n'));
}
function metadata(core, before, after) {
  const end = core.indexOf('\n'), header = core.slice(0, end);
  assert.ok(end > 0 && header.startsWith('module '));
  assert.equal(header.split(before).length, 2, 'only the intended metadata descriptor changes');
  return header.replace(before, after) + core.slice(end);
}
function member(owner, item, kind) {
  return sha256(['tsfg.core-reference.member.v1', owner.runtimeKey, kind, item.origin.source,
    String(item.origin.start), String(item.origin.end), item.name].join('\0'));
}
function access(core, item, key, kind, value) {
  const prefix = '{access = "public", end = ' + item.origin.end + ' : i64, '
    + (kind === 'field' ? 'has_initializer = ' + (item.initializer !== null) : 'initialization = []')
    + ', key = ' + JSON.stringify(key);
  return metadata(core, prefix, prefix.replace('access = "public"', 'access = ' + JSON.stringify(value)));
}
const anchor = item => 'tsfg_source.start = ' + item.origin.start + ' : i64, tsfg_source.end = ' + item.origin.end + ' : i64';
function fieldRead(result, receiver, key, origin) {
  return '    ' + result + ' = "tsfg_core.ref.field.read"(' + receiver.value + ') {field = ' + JSON.stringify(key)
    + ', ' + anchor(origin) + '} : (' + receiver.type + ') -> f64';
}
function virtual(result, receiver, argument, owner, method, fn, origin) {
  return '    ' + result + ' = "tsfg_core.ref.call"(' + receiver.value + ', ' + argument + ') {dispatch = "virtual", method = '
    + JSON.stringify(member(owner, method, 'method')) + ', signature = ' + JSON.stringify(fn.signature)
    + ', ' + anchor(origin) + '} : (' + receiver.type + ', f64) -> f64';
}
async function positive(core) {
  const result = await invokeCore(core); accepted(result); assert.ok(result.stdout.length > 0);
}
async function negative(core, cause) {
  const result = await invokeCore(core);
  assert.equal(result.close.code, 3, result.stderr.toString('utf8')); assert.equal(result.stdout.length, 0);
  assert.match(result.stderr.toString('utf8'), cause);
}

function withoutMakeVirtual(core, a) {
  const lines = a.make.body.trimEnd().split('\n'), calls = lines.filter(line => line.includes('"tsfg_core.ref.call"('));
  assert.equal(calls.length, 1);
  return body(core, a.make, lines.filter(line => line !== calls[0]).join('\n'));
}
async function directBase(visibility) {
  const a = await actual(), self = a.touchFn.parameters[0], seed = a.touchFn.parameters[1];
  const baseType = a.baseFn.parameters[0].type, source = anchor(a.derivedTouch);
  const fuel = a.touchFn.body.split('\n').filter(line => line.includes('"tsfg_core.fuel"(')); assert.equal(fuel.length, 1);
  const replacement = [...fuel,
    '    %baseReceiver = "tsfg_core.ref.base"(' + self.value + ') {class = ' + JSON.stringify(a.base.runtimeKey)
      + ', ' + source + '} : (' + self.type + ') -> ' + baseType,
    '    %baseResult = "func.call"(%baseReceiver, ' + seed.value + ') {callee = ' + a.baseFn.symbol
      + ', tsfg_core.function_id = ' + JSON.stringify(a.baseFn.key) + ', tsfg_core.signature_hash = '
      + JSON.stringify(a.baseFn.signature) + ', ' + source + '} : (' + baseType + ', f64) -> f64',
    '    "func.return"(%baseResult) {' + source + '} : (f64) -> ()'].join('\n');
  let core = body(a.core, a.touchFn, replacement);
  // Every access variant drops the unrelated unused made.touch result. Otherwise
  // private Base.touch would hit the already enforced virtual-access gate first.
  core = withoutMakeVirtual(core, a);
  if (visibility !== 'public') core = access(core, a.baseTouch, a.baseFn.key, 'method', visibility);
  if (visibility === 'private') {
    // A private Base member cannot be an override target. The two actual views
    // remain complete; neither targets Derived, so no new projection is invented.
    const edge = 'member = ' + JSON.stringify(member(a.derived, a.derivedTouch, 'method')) + ', name = "touch", override = ';
    core = metadata(core, edge + JSON.stringify(member(a.base, a.baseTouch, 'method')), edge + '""');
  }
  return core;
}
async function constructorUse(kind, after) {
  const a = await actual(), self = a.ctor.parameters[0], seed = a.ctor.parameters[1], source = anchor(a.derived.constructor);
  const field = a.base.fields[0], key = member(a.base, field, 'field');
  let operation;
  if (kind === 'read') operation = fieldRead('%earlyRead', self, key, a.derived.constructor);
  else if (kind === 'write') operation = '    "tsfg_core.ref.field.write"(' + self.value + ', ' + seed.value
    + ') {field = ' + JSON.stringify(key) + ', initialize = false, ' + source + '} : (' + self.type + ', f64) -> ()';
  else if (kind === 'call') operation = virtual('%earlyCall', self, seed.value, a.derived, a.derivedTouch, a.touchFn, a.derived.constructor);
  else operation = '    %pureArgument = "tsfg_core.add"(' + seed.value + ', ' + seed.value + ') {' + source + '} : (f64, f64) -> f64';
  return insert(a.core, a.ctor, operation, 'func.call', after);
}
async function protectedField(receiverKind) {
  const a = await actual(), field = a.base.fields[0], key = member(a.base, field, 'field');
  let core = access(a.core, field, key, 'field', 'protected');
  if (receiverKind === 'derived') return insert(core, a.rebind,
    fieldRead('%protectedRead', a.rebind.parameters[2], key, a.rebindMethod), 'func.return');
  if (receiverKind === 'parameter') return insert(core, a.rebind,
    fieldRead('%protectedRead', a.rebind.parameters[1], key, a.rebindMethod), 'func.return');
  const allocation = a.make.body.match(/(%[A-Za-z0-9_]+) = "tsfg_core.ref.alloc"\(/); assert.ok(allocation);
  return insert(core, a.make, fieldRead('%protectedRead', {value:allocation[1],type:a.baseFn.parameters[0].type}, key, a.makeMethod), 'func.call', true);
}
async function protectedMethod(receiverKind) {
  const a = await actual();
  let core = access(a.core, a.baseTouch, a.baseFn.key, 'method', 'protected');
  if (receiverKind === 'allocation') return core; // Actual make already calls made.touch(seed).
  core = withoutMakeVirtual(core, a); // Isolate the Base-parameter receiver from that separate allocation case.
  const origin = a.rebindMethod, receiver = a.rebind.parameters[1];
  const field = a.base.fields[0], read = fieldRead('%publicSeed', receiver, member(a.base, field, 'field'), origin);
  return insert(core, a.rebind, read + '\n' + virtual('%protectedCall', receiver, '%publicSeed', a.base, a.baseTouch, a.baseFn, origin), 'func.return');
}

test('Core-only public and protected direct-super method controls retain legitimate access', async () => {
  await positive(await directBase('public')); await positive(await directBase('protected'));
});
test('Core-only Derived protected fields and constructor post-super uses or pure pre-super arguments remain legal', async () => {
  await positive(await protectedField('derived'));
  for (const kind of ['read','write','call']) await positive(await constructorUse(kind, true));
  await positive(await constructorUse('parameter', false));
});
test('Core-only direct-base call cannot expose a Base private method to Derived', async () => {
  await negative(await directBase('private'), /\[core-ir-reference-invalid\] direct base method is outside caller access/);
});
for (const kind of ['read','write','call']) test('Core-only Derived constructor rejects pre-super receiver ' + kind, async () => {
  await negative(await constructorUse(kind, false), /\[core-ir-reference-construction\] derived receiver is used before successful base construction/);
});
for (const receiver of ['parameter','allocation']) {
  test('Core-only protected field rejects a Base ' + receiver + ' receiver in Derived', async () => {
    await negative(await protectedField(receiver), /\[core-ir-reference-invalid\] protected receiver is outside caller class/);
  });
  test('Core-only protected method rejects a Base ' + receiver + ' receiver in Derived', async () => {
    await negative(await protectedMethod(receiver), /\[core-ir-reference-invalid\] protected receiver is outside caller class/);
  });
}
