// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir } from '../../compiler/hir.mjs';
import { lowerClosureEnvironments, verifyClosureEnvironments, printClosureEnvironments } from '../../compiler/closure-environments.mjs';
import { emitClosureCore } from '../../compiler/closure-core-emitter.mjs';
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
// Independent pinned custody avoids importing/registering another test file.
const cases = {
  "shared-mutable": {"family":"m19-closure-boundaries","frames":{"request":[1997,"sha256:f4bfa8f354caf312c86b88092dd8c2bbfd7923dd7ad757e82423ac51c81a63ac"],"response":[4015,"sha256:f1772e4e0bd90317535e08bead1b2d5b8071d8b81ec621975a7b722e8f6c4181"],"original":[1637,"sha256:e752c628052fdb6e98f8ea812482afc13cf8f774b24d27fef6d63a2107a2a960"],"provenance":[1625,"sha256:bb432e8db6c0b8426fe6152f23ef06c8313be3ba064453150a29a5f197a779a3"]},"origin":{"kind":"owned-go-response","producerBaseOid":"8d106b6768521c21b9ef4e7a69df023977d71b09","producerDirty":true,"testedInputSetHash":"sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b","requestSha256":"sha256:f4bfa8f354caf312c86b88092dd8c2bbfd7923dd7ad757e82423ac51c81a63ac","responseSha256":"sha256:f1772e4e0bd90317535e08bead1b2d5b8071d8b81ec621975a7b722e8f6c4181"},"delivery":"d954555abfc9f0a9886fb28e81fdb18828a4a314","pid":956,"rawLog":"sha256:83978c2e439eb19832368d4894a004c6de599b2319f43d6f4d95e36eac910fd8"},
  "write-only": {"family":"m19-closure-boundaries","frames":{"request":[1948,"sha256:b04536d47445fdbfc739a908a291f111a06efcbe86fe48a3b7fe5728e2e479d5"],"response":[3155,"sha256:c498cee1c2fe1a1c6cf9e3163250e7ddfe91de8389d506ac02880559446730ae"],"original":[1588,"sha256:4b52ac6a53fe8b345770fb01eef4a1602289f8df9b9adf917ecfe5815fe1259d"],"provenance":[1646,"sha256:9352c6ac1ee5f47d9196223370350f99c7820d985343b2bc23928045c3e12f5a"]},"origin":{"kind":"owned-go-response","producerBaseOid":"8d106b6768521c21b9ef4e7a69df023977d71b09","producerDirty":true,"testedInputSetHash":"sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b","requestSha256":"sha256:b04536d47445fdbfc739a908a291f111a06efcbe86fe48a3b7fe5728e2e479d5","responseSha256":"sha256:c498cee1c2fe1a1c6cf9e3163250e7ddfe91de8389d506ac02880559446730ae"},"delivery":"d954555abfc9f0a9886fb28e81fdb18828a4a314","pid":956,"rawLog":"sha256:83978c2e439eb19832368d4894a004c6de599b2319f43d6f4d95e36eac910fd8"},
  "ancestor": {"family":"m19-closure-boundaries","frames":{"request":[1963,"sha256:5fdedb8c443be9ffe047fca5ce18a750d0b82d0f8d9bc90af4a914c35614860e"],"response":[2787,"sha256:4c3dfa83995bc302f9e891ff9ea3b3a9352762ac95a58de825395a9d038c5091"],"original":[1603,"sha256:a156843d49c079b3ddeec6200a9caeee9fd952643645b812c5a72c0f9ebc5075"],"provenance":[1650,"sha256:3654f3e0c132ca96f5fc4c7df1d11550620840467f897ba4e76bff0934f9db53"]},"origin":{"kind":"owned-go-response","producerBaseOid":"8d106b6768521c21b9ef4e7a69df023977d71b09","producerDirty":true,"testedInputSetHash":"sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b","requestSha256":"sha256:5fdedb8c443be9ffe047fca5ce18a750d0b82d0f8d9bc90af4a914c35614860e","responseSha256":"sha256:4c3dfa83995bc302f9e891ff9ea3b3a9352762ac95a58de825395a9d038c5091"},"delivery":"d954555abfc9f0a9886fb28e81fdb18828a4a314","pid":956,"rawLog":"sha256:83978c2e439eb19832368d4894a004c6de599b2319f43d6f4d95e36eac910fd8"},
  "sharedCallableWrites": {"family":"m19-closure-flow","frames":{"request":[2160,"sha256:ddc69f9f4559bd27eec1b93a80bc47c62e2ca058ef0a95a2c62560a3c6473b47"],"response":[6685,"sha256:1983a4e1d59f636c9dbc60391677106f9343f59f9beae23363bc7d174e623266"],"original":[1800,"sha256:4db7ecbc4435619caed85a709e290375012d891d3411e74010ba22d5f10b1acf"],"provenance":[14741,"sha256:002e3b58995ccfc3162c20c6a8272c25e8be81810710a1ecb9b9d036c4280cbc"]},"origin":{"kind":"owned-go-response","producerBaseOid":"6bab7de3ed66f5e4ca913b8387d21d7b46748a2f","producerDirty":true,"requestSha256":"sha256:ddc69f9f4559bd27eec1b93a80bc47c62e2ca058ef0a95a2c62560a3c6473b47","responseSha256":"sha256:1983a4e1d59f636c9dbc60391677106f9343f59f9beae23363bc7d174e623266","testedInputSetHash":"sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28"},"delivery":null,"pid":36700,"rawLog":"9e5594fedccd7ae2b281cb01afa71ee57f8ecfd5a9b47a197f8bf24d56c31630"},
  "transitiveExternalRootEnvironment": {"family":"m19-closure-flow","frames":{"request":[2066,"sha256:c60167a16423b628a9026c41fb5f63d5bedbb1124a43967b7b9dfb06fc77bb73"],"response":[4420,"sha256:4fd9db8ffb55ac075a866fab65f4ff7f9b29d8fe45abb38345e36bfb62044f1a"],"original":[1706,"sha256:b78fdca5b757d2c587fc0ab08d3caa3c841120b8d8aa4534970660751eb33f7b"],"provenance":[14960,"sha256:32776cdff6f98d27b4a9b482a363f69b3b58e6ce61ead9fd5bcd95be8c4bbcb7"]},"origin":{"kind":"owned-go-response","producerBaseOid":"a8dc34ed0d7c96fe09070446b2e4e729dbad97b7","producerDirty":true,"requestSha256":"sha256:c60167a16423b628a9026c41fb5f63d5bedbb1124a43967b7b9dfb06fc77bb73","responseSha256":"sha256:4fd9db8ffb55ac075a866fab65f4ff7f9b29d8fe45abb38345e36bfb62044f1a","testedInputSetHash":"sha256:0ae8c1010eaeee5162fb180bbaac3669a2812b7c98a4e255e33e37f1b5d6b965"},"delivery":null,"pid":30716,"rawLog":"aa2ea9d97a940f92648fa641af7d0d08ab85e78a6ccfeeeba8e78addac02c9a9"},
  "capturedBlockLocal": {"family":"m19-closure-flow","frames":{"request":[2029,"sha256:eb9308ad55f3bc6172e7e8884a862901e8a16f6016a66d7b2ddf05a617e812bc"],"response":[3857,"sha256:6500153c45e3b98b015e0e78a1acb7002b3ecb31e6688e5ea8ec8638b1064479"],"original":[1669,"sha256:32d0d1e5d71fea8026c599f544118d91e20b91f73e6fa060d1ea5b861eb779d6"],"provenance":[15065,"sha256:e3eba9eb22414d859c2fe3d85229de7b26bcb1d9ad348708d09334e711ee512e"]},"origin":{"kind":"owned-go-response","producerBaseOid":"4ceaa5079f29f3be54f55f31488f23078f242daf","producerDirty":true,"requestSha256":"sha256:eb9308ad55f3bc6172e7e8884a862901e8a16f6016a66d7b2ddf05a617e812bc","responseSha256":"sha256:6500153c45e3b98b015e0e78a1acb7002b3ecb31e6688e5ea8ec8638b1064479","testedInputSetHash":"sha256:ede3f8326ecc9abd5ba97530484d802da63eab34674654ce04d978458c4460c3"},"delivery":"3a9461a09934e5a932a5a51ad81bd53c9c2b00e7","pid":35208,"rawLog":"454e4bd854affc530391e15036f6421e24c9cad1372cc1d99642c635b88e66a3"},
  "capturedLoopLocal": {"family":"m19-closure-flow","frames":{"request":[2083,"sha256:2e148a39faf41d1bb6cc4092989e48357cc6298422f727236df4da2f38b6fc96"],"response":[4645,"sha256:8385e9cd23e7d0dd47ab29ab5243304667c6f323f5e4a9781371e89f2d0214e3"],"original":[1723,"sha256:f4534adcc14a7bff6557024468a1d03dd9bb5ca242f8b010eea34927887e3d2c"],"provenance":[15063,"sha256:3afc8bc612d182fe77d464c6a5c450f1dfab1a067e7bd18632531ef7c8f7ddb0"]},"origin":{"kind":"owned-go-response","producerBaseOid":"4ceaa5079f29f3be54f55f31488f23078f242daf","producerDirty":true,"requestSha256":"sha256:2e148a39faf41d1bb6cc4092989e48357cc6298422f727236df4da2f38b6fc96","responseSha256":"sha256:8385e9cd23e7d0dd47ab29ab5243304667c6f323f5e4a9781371e89f2d0214e3","testedInputSetHash":"sha256:ede3f8326ecc9abd5ba97530484d802da63eab34674654ce04d978458c4460c3"},"delivery":"3a9461a09934e5a932a5a51ad81bd53c9c2b00e7","pid":35208,"rawLog":"454e4bd854affc530391e15036f6421e24c9cad1372cc1d99642c635b88e66a3"},
};
const one = values => { assert.equal(values.length, 1); return values[0]; };
const named = (functions, name) => one(functions.filter(fn => fn.name === name));
const symbol = fn => 'f' + fn.id.slice(7);
const env = layout => '!tsfg_closure.env<"' + layout.id + '">';
const callable = type => '!tsfg_closure.value<"' + type + '">';
const anchor = range => 'tsfg_source.start = ' + range.start + ' : i64, tsfg_source.end = ' + range.end + ' : i64';
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
async function publicHir(name) {
  const pin = cases[name], directory = new URL('../fixtures/r03/' + pin.family + '/' + name + '/', import.meta.url);
  /** @type {Record<string, Buffer>} */ const frames = {};
  for (const kind of ['request', 'response', 'original', 'provenance']) {
    frames[kind] = await readFile(new URL(kind + '.json', directory));
    assert.equal(frames[kind].length, pin.frames[kind][0]); assert.equal(digest(frames[kind]), pin.frames[kind][1]);
  }
  const metadata = JSON.parse(frames.provenance.toString('utf8'));
  assert.deepEqual(metadata.origin, pin.origin); assert.equal(metadata.deliveryOid, pin.delivery);
  assert.equal(metadata.execution.pid, pin.pid); assert.equal(metadata.execution.rawLogSha256 ?? metadata.execution.rawLog?.sha256, pin.rawLog);
  const request = JSON.parse(frames.request.toString('utf8')), original = JSON.parse(frames.original.toString('utf8'));
  assert.deepEqual(request.files, original.files); assert.equal(request.rootFile, original.rootFile);
  const raw = JSON.parse(frames.response.toString('utf8')); assert.equal(raw.status, 'ok');
  const imported = await importCapturedFrontendResponse(frames.request, frames.response, metadata.origin);
  assert.equal(imported.status, 'ok', JSON.stringify(imported)); validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot); assert.equal(built.status, 'ok', JSON.stringify(built));
  const before = printHir(verifyHir(built.hir)), hir = readHir(Buffer.from(before)); assert.deepEqual(verifyHir(hir), built.hir);
  return { hir, before };
}
async function owned(name) {
  const c = await publicHir(name), program = lowerClosureEnvironments(c.hir);
  assert.deepEqual(verifyClosureEnvironments(program, c.hir), program);
  return { ...c, program, programBefore: printClosureEnvironments(program, c.hir) };
}
// Observe finite operation lines and SSA uses only; no MLIR parser/interpreter.
function body(core, fn) {
  const start = core.indexOf('  func.func @"' + symbol(fn) + '"('); assert.ok(start >= 0);
  const end = core.indexOf('\n  }', start); assert.ok(end > start); return core.slice(start, end).split('\n');
}
const operation = (lines, name, range) => one(lines.filter(line => line.includes('"' + name + '"(') && line.includes(anchor(range))));
const result = line => one([...line.matchAll(/^    (%v[0-9]+) = /g)])[1];
function operands(line, name) {
  const start = line.indexOf('"' + name + '"('); assert.ok(start >= 0);
  const text = line.slice(start + name.length + 3).split(')')[0]; return text ? text.split(', ') : [];
}
function ordered(lines, left, right) { assert.ok(lines.indexOf(left) < lines.indexOf(right)); }
const original = (c, name) => named(c.hir.functions, name);
const lowered = (c, name) => named(c.program.functions, name);
const local = (c, owner, name) => one(owner.body.filter(item => item.kind === 'local' && item.binding.name === name));
async function emitted(c) {
  const core = emitClosureCore(c.program, c.hir);
  const schema = JSON.parse(await readFile(new URL('../../contracts/core-closure-candidate.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.family, 'tsfg.core-closure-candidate'); assert.equal(schema.version, 2);
  const metadata = core.slice(0, core.indexOf('\n'));
  assert.ok(metadata.includes('family = "' + schema.family + '", version = 2 : i64, schema = "' + digest(jcs(schema)) + '"'));
  assert.ok(metadata.includes('program_hash = "' + digest(c.programBefore) + '"'));
  assert.ok(metadata.includes('hir_hash = "' + c.program.hirHash + '"'));
  assert.ok(metadata.includes('root_policy = "consumer-recompute-required"'));
  assert.equal([...core.matchAll(/^  func[.]func /gm)].length, c.program.functions.length);
  for (const fn of c.program.functions) {
    assert.match(fn.id, /^sha256:[0-9a-f]{64}$/); const lines = body(core, fn);
    assert.ok(lines[0].includes('tsfg_core.function_id = "' + fn.id + '"'));
    assert.ok(lines[0].includes('tsfg_core.signature_hash = "' + fn.signatureHash + '"'));
  }
  for (const layout of c.program.environments) {
    const owner = one(c.hir.functions.filter(fn => fn.id === layout.owner));
    const out = one(c.program.functions.filter(fn => fn.id === layout.owner)), lines = body(core, out);
    const alloc = operation(lines, 'tsfg_closure.env.alloc', owner.definitionRange);
    for (const slot of layout.slots) {
      const binding = one(c.program.bindings.filter(item => item.id === slot.binding));
      const declarations = binding.role === 'parameter' ? owner.parameters : owner.body.filter(item => item.kind === 'local').map(item => item.binding);
      const index = declarations.findIndex(item => item.id === binding.id); assert.ok(index >= 0);
      const expected = '{binding = "' + binding.id + '", type = "' + binding.type + '", writable = ' + slot.writable
        + ', role = "' + binding.role + '", declaration_index = ' + index + ' : i64}';
      assert.ok(metadata.includes(expected), 'slot index comes from original declarations including noncaptured locals');
      const init = one(out.body.filter(item => item.kind === 'initializeEnvironment' && item.binding === binding.id));
      assert.equal(init.anchor.kind, binding.role === 'parameter' ? 'parameter' : 'source');
      assert.deepEqual(init.anchor.range, binding.role === 'parameter' ? binding.range : one(owner.body.filter(item => item.kind === 'local' && item.binding.id === binding.id)).range);
      const line = operation(lines, 'tsfg_closure.env.init', init.anchor.range);
      assert.equal(operands(line, 'tsfg_closure.env.init')[0], result(alloc));
      assert.ok(line.includes('binding = "' + binding.id + '", anchor_kind = "' + init.anchor.kind + '"')); ordered(lines, alloc, line);
    }
  }
  assert.ok(core.endsWith('\n') && !core.endsWith('\n\n')); assert.doesNotMatch(core, /undefined|NaN|\r/);
  assert.ok(Buffer.byteLength(core) <= 8388608); assert.equal(emitClosureCore(c.program, c.hir), core);
  assert.equal(printHir(c.hir), c.before); assert.equal(printClosureEnvironments(c.program, c.hir), c.programBefore);
  return core;
}

test('shared scalar local uses its source seed initialization and both nested functions share the original slot', async () => {
  const c = await owned('shared-mutable'), core = await emitted(c), entry = original(c, 'entry'), state = local(c, entry, 'state').binding;
  const e = body(core, lowered(c, 'entry')), w = body(core, lowered(c, 'write')), r = body(core, lowered(c, 'read'));
  const layout = one(c.program.environments), alloc = operation(e, 'tsfg_closure.env.alloc', entry.definitionRange);
  const init = operation(e, 'tsfg_closure.env.init', entry.body[0].range);
  assert.deepEqual(operands(init, 'tsfg_closure.env.init'), [result(alloc), '%v0']);
  for (const item of [entry.body[3].value, entry.body[4].value]) {
    const call = operation(e, 'func.call', item.range); assert.equal(operands(call, 'func.call')[0], result(alloc)); ordered(e, init, call);
  }
  const write = original(c, 'write'), store = operation(w, 'tsfg_closure.env.store', write.body[0].range);
  assert.deepEqual(operands(store, 'tsfg_closure.env.store'), ['%v0', '%v1']); assert.ok(store.includes('binding = "' + state.id + '"'));
  for (const [fn, lines] of [[write, w], [original(c, 'read'), r]]) {
    assert.ok(lines[0].includes('%v0: ' + env(layout)));
    const load = operation(lines, 'tsfg_closure.env.load', fn.body.at(-1).value.range);
    assert.deepEqual(operands(load, 'tsfg_closure.env.load'), ['%v0']); assert.ok(load.includes('binding = "' + state.id + '"'));
    assert.deepEqual(operands(operation(lines, 'func.return', fn.body.at(-1).range), 'func.return'), [result(load)]);
  }
});

test('write-only local capture stores the real argument without inventing a read or another initialization', async () => {
  const c = await owned('write-only'), core = await emitted(c), write = original(c, 'write'), w = body(core, lowered(c, 'write'));
  assert.deepEqual(write.captures.map(item => [item.read, item.write]), [[false, true]]);
  assert.deepEqual(operands(operation(w, 'tsfg_closure.env.store', write.body[0].range), 'tsfg_closure.env.store'), ['%v0', '%v1']);
  assert.deepEqual(operands(operation(w, 'func.return', write.body[1].range), 'func.return'), ['%v1']);
  assert.equal(w.filter(line => line.includes('"tsfg_closure.env.load"(')).length, 0);
  assert.equal([...core.matchAll(/"tsfg_closure[.]env[.]init"/g)].length, 1);
});

test('constant ancestor local remains readonly and its environment crosses a middle with no direct capture', async () => {
  const c = await owned('ancestor'), core = await emitted(c), layout = one(c.program.environments);
  const entry = original(c, 'entry'), state = local(c, entry, 'state').binding, middle = original(c, 'middle'), read = original(c, 'read');
  assert.equal(state.writable, false); assert.equal(layout.slots[0].writable, false); assert.deepEqual(middle.captures, []);
  const e = body(core, lowered(c, 'entry')), m = body(core, lowered(c, 'middle')), r = body(core, lowered(c, 'read'));
  const alloc = operation(e, 'tsfg_closure.env.alloc', entry.definitionRange);
  assert.deepEqual(operands(operation(e, 'func.call', entry.body.at(-1).value.range), 'func.call'), [result(alloc)]);
  assert.deepEqual(operands(operation(m, 'func.call', middle.body.at(-1).value.range), 'func.call'), ['%v0']);
  assert.deepEqual(operands(operation(r, 'tsfg_closure.env.load', read.body[0].value.range), 'tsfg_closure.env.load'), ['%v0']);
  assert.equal(m.filter(line => line.includes('"tsfg_closure.env.alloc"(')).length, 0);
  assert.equal([...core.matchAll(/"tsfg_closure[.]env[.]store"/g)].length, 0);
});

test('captured callable local shares later writes while an earlier noncaptured alias retains its copied pair', async () => {
  const c = await owned('sharedCallableWrites'), core = await emitted(c), entry = original(c, 'entry'), first = original(c, 'first');
  const selected = local(c, entry, 'selected'), alias = local(c, entry, 'alias'), e = body(core, lowered(c, 'entry'));
  const selectedMake = operation(e, 'tsfg_closure.make', selected.initializer.range), init = operation(e, 'tsfg_closure.env.init', selected.range);
  assert.ok(selectedMake.includes('function_id = "' + first.id + '"'));
  assert.equal(operands(init, 'tsfg_closure.env.init')[1], result(selectedMake)); ordered(e, selectedMake, init);
  const aliasLoad = operation(e, 'tsfg_closure.env.load', alias.initializer.range);
  assert.ok(aliasLoad.includes('binding = "' + selected.binding.id + '"')); assert.ok(aliasLoad.endsWith('-> ' + callable(selected.binding.type)));
  const changed = operation(e, 'func.call', entry.body[6].value.range), returned = entry.body[7].value;
  ordered(e, aliasLoad, changed); ordered(e, changed, operation(e, 'func.call', returned.left.range));
  assert.deepEqual(operands(operation(e, 'tsfg_closure.call', returned.right.range), 'tsfg_closure.call'), [result(aliasLoad)]);
  for (const name of ['write', 'read']) {
    const fn = original(c, name), lines = body(core, lowered(c, name)), call = fn.body.at(-1).value;
    const load = operation(lines, 'tsfg_closure.env.load', call.callee.range), invoked = operation(lines, 'tsfg_closure.call', call.range);
    assert.ok(load.includes('binding = "' + selected.binding.id + '"')); assert.deepEqual(operands(load, 'tsfg_closure.env.load'), ['%v0']);
    assert.deepEqual(operands(invoked, 'tsfg_closure.call'), [result(load)]); ordered(lines, load, invoked);
    if (name === 'write') {
      const store = operation(lines, 'tsfg_closure.env.store', fn.body[0].range);
      assert.deepEqual(operands(store, 'tsfg_closure.env.store'), ['%v0', '%v1']); ordered(lines, store, load);
    }
  }
});

test('transitive helper receives the initialized local environment despite an empty middle capture list', async () => {
  const c = await owned('transitiveExternalRootEnvironment'), core = await emitted(c), entry = original(c, 'entry');
  const selected = local(c, entry, 'selected'), middle = original(c, 'middle'), helper = original(c, 'helper'); assert.deepEqual(middle.captures, []);
  const e = body(core, lowered(c, 'entry')), m = body(core, lowered(c, 'middle')), h = body(core, lowered(c, 'helper'));
  const alloc = operation(e, 'tsfg_closure.env.alloc', entry.definitionRange), init = operation(e, 'tsfg_closure.env.init', selected.range);
  const entered = operation(e, 'func.call', entry.body.at(-1).value.range); ordered(e, init, entered);
  assert.deepEqual(operands(entered, 'func.call'), [result(alloc)]);
  const forwarded = operation(m, 'func.call', middle.body.at(-1).value.range);
  assert.deepEqual(operands(forwarded, 'func.call'), ['%v0']); assert.ok(forwarded.includes('tsfg_core.function_id = "' + helper.id + '"'));
  const call = helper.body.at(-1).value, load = operation(h, 'tsfg_closure.env.load', call.callee.range);
  assert.ok(load.includes('binding = "' + selected.binding.id + '"'));
  assert.deepEqual(operands(operation(h, 'tsfg_closure.call', call.range), 'tsfg_closure.call'), [result(load)]);
  assert.equal(m.filter(line => line.includes('"tsfg_closure.env.alloc"(')).length, 0);
});

for (const name of ['capturedBlockLocal', 'capturedLoopLocal']) test(name + ' remains valid public HIR with a precise 19f scope capability', async () => {
  const c = await publicHir(name), entry = original(c, 'entry'), read = original(c, 'read');
  const block = name === 'capturedBlockLocal' ? entry.body[2] : entry.body[3].body[0];
  assert.equal(block.kind, 'block'); const value = block.body[0].binding; assert.equal(value.name, 'value');
  assert.equal(value.owner, entry.id); assert.deepEqual(read.captures, [{ binding: value.id, read: true, write: false }]);
  assert.throws(() => lowerClosureEnvironments(c.hir), /** @param {any} error */ error => {
    assert.equal(error.code, 'r03-d-capability'); assert.equal(error.ruleId, 'r01-ts-baseline'); assert.equal(error.phase, 'lowering');
    assert.ok(error.message.includes('captured block/loop local environment activation is not implemented'));
    assert.deepEqual(error.primary, { source: c.hir.source.path, start: value.range.start, end: value.range.end, owner: entry.id, binding: value.id });
    return true;
  });
  assert.equal(printHir(c.hir), c.before);
});

test('forged local programs keep hirHash but fail 19f cold verification before the new Core consumer', async () => {
  const c = await owned('shared-mutable');
  for (const edit of [
    p => { p.environments[0].owner = named(p.functions, 'read').id; },
    p => { p.environments[0].slots[0].type = named(p.functions, 'entry').signature; },
    p => { named(p.functions, 'entry').body.splice(1, 1); },
    p => { const body = named(p.functions, 'entry').body; body.splice(2, 0, JSON.parse(JSON.stringify(body[1]))); },
    p => { const body = named(p.functions, 'entry').body; body.push(body.splice(1, 1)[0]); },
  ]) {
    const changed = JSON.parse(c.programBefore); edit(changed); assert.equal(changed.hirHash, c.program.hirHash);
    assert.throws(() => emitClosureCore(changed, c.hir), /** @param {any} error */ error => /^r03-closure-environments-/.test(error.code) && error.phase === 'lowering');
  }
  const constant = await owned('ancestor'), forged = JSON.parse(constant.programBefore), read = named(forged.functions, 'read');
  const load = read.body[0].value;
  read.body.unshift({ kind: 'environmentStore', range: read.body[0].range,
    target: { binding: load.binding, type: load.type, range: load.range, environment: load.environment }, value: load });
  assert.equal(forged.hirHash, constant.program.hirHash);
  assert.throws(() => emitClosureCore(forged, constant.hir), /** @param {any} error */ error => /^r03-closure-environments-/.test(error.code) && error.phase === 'lowering');
  assert.throws(() => emitClosureCore(c.program, constant.hir), /** @param {any} error */ error => /^r03-closure-environments-/.test(error.code) && error.phase === 'lowering');
  assert.equal(printHir(c.hir), c.before); assert.equal(printClosureEnvironments(c.program, c.hir), c.programBefore);
});
