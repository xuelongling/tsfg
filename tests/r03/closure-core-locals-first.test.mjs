// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir } from '../../compiler/hir.mjs';
import { lowerClosureEnvironments, verifyClosureEnvironments, printClosureEnvironments, readClosureEnvironments } from '../../compiler/closure-environments.mjs';
import { emitClosureCore } from '../../compiler/closure-core-emitter.mjs';

const fixture = new URL('../fixtures/r03/m19-closure-boundaries/shared-mutable/', import.meta.url);
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const symbol = fn => 'f' + fn.id.slice(7);
const source = range => 'tsfg_source.start = ' + range.start + ' : i64, tsfg_source.end = ' + range.end + ' : i64';
/** @param {any[]} functions @param {string} name @param {number} start @param {number} end */
function declaration(functions, name, start, end) {
  const found = functions.filter(fn => fn.name === name && fn.range.start === start && fn.range.end === end);
  assert.equal(found.length, 1, 'one original owned declaration: ' + name); return found[0];
}
// Finite golden observation, not an MLIR parser or execution model.
function functionText(core, fn) {
  const start = core.indexOf('  func.func @"' + symbol(fn) + '"('); assert.ok(start >= 0);
  const split = core.indexOf('\n', start), end = core.indexOf('\n  }', split); assert.ok(end > split);
  return { header: core.slice(start, split), body: core.slice(split + 1, end) };
}

// Genuine pre-existing Source capture. This test compiles only producer text;
// its Source execution/admission, C++ verification and physical GC remain untested.
test('real shared mutable local emits one source initialization and a shared original slot in all three Core functions', async () => {
  /** @type {[string, number, string][]} */
  const identities = [
    ['request.json', 1997, 'sha256:f4bfa8f354caf312c86b88092dd8c2bbfd7923dd7ad757e82423ac51c81a63ac'],
    ['response.json', 4015, 'sha256:f1772e4e0bd90317535e08bead1b2d5b8071d8b81ec621975a7b722e8f6c4181'],
    ['original.json', 1637, 'sha256:e752c628052fdb6e98f8ea812482afc13cf8f774b24d27fef6d63a2107a2a960'],
    ['provenance.json', 1625, 'sha256:bb432e8db6c0b8426fe6152f23ef06c8313be3ba064453150a29a5f197a779a3'],
  ];
  const frames = await Promise.all(identities.map(([name]) => readFile(new URL(name, fixture))));
  frames.forEach((bytes, index) => { assert.equal(bytes.length, identities[index][1]); assert.equal(digest(bytes), identities[index][2]); });
  const [request, response, original, provenance] = frames, metadata = JSON.parse(provenance.toString('utf8'));
  assert.deepEqual(metadata.origin, { kind: 'owned-go-response',
    producerBaseOid: '8d106b6768521c21b9ef4e7a69df023977d71b09', producerDirty: true,
    testedInputSetHash: 'sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b',
    requestSha256: identities[0][2], responseSha256: identities[1][2] });
  assert.equal(metadata.deliveryOid, 'd954555abfc9f0a9886fb28e81fdb18828a4a314');
  assert.notEqual(metadata.deliveryOid, metadata.origin.producerBaseOid);
  assert.equal(metadata.sourceTest, 'TestFrontendCommandSharedMutableCaptureOwnedFacts/ownedProjection');
  assert.equal(metadata.execution.pid, 956);
  assert.equal(metadata.execution.rawLogSha256, 'sha256:83978c2e439eb19832368d4894a004c6de599b2319f43d6f4d95e36eac910fd8');
  assert.equal(metadata.execution.summarySha256, 'sha256:bd6c9602fe6f205afd6d51eda8605e046447608d8a1f9950c40e879ab2510772');
  const custodyBytes = await readFile(new URL(metadata.testedInputSetReference.path, fixture));
  assert.equal(digest(custodyBytes), 'sha256:53875a3dd1b5171e7b50ac5650cc496d43332389f1cb9e7fef162a408b7facc9');
  assert.equal(metadata.testedInputSetReference.sha256, digest(custodyBytes));
  const custody = JSON.parse(custodyBytes.toString('utf8'));
  assert.equal(custody.origin.testedInputSetHash, metadata.origin.testedInputSetHash);
  assert.equal(custody.origin.producerBaseOid, metadata.origin.producerBaseOid);
  const input = JSON.parse(request.toString('utf8')), untouched = JSON.parse(original.toString('utf8'));
  assert.deepEqual(input.files, untouched.files); assert.equal(input.rootFile, untouched.rootFile);
  assert.equal(input.files.find(file => file.path === input.rootFile).content,
    'export function entry(seed: bool): bool { let state: bool = seed; function write(value: bool): bool { state = value; return state; } function read(): bool { return state; } write(false); return read(); }');
  const raw = JSON.parse(response.toString('utf8')); assert.equal(raw.status, 'ok');
  assert.deepEqual(raw.functions.map(fn => fn.name), ['entry', 'write', 'read']);
  const imported = await importCapturedFrontendResponse(request, response, metadata.origin);
  assert.equal(imported.status, 'ok', JSON.stringify(imported)); validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot); assert.equal(built.status, 'ok', JSON.stringify(built));
  const hirBefore = printHir(verifyHir(built.hir)), hir = readHir(Buffer.from(hirBefore));
  assert.deepEqual(verifyHir(hir), built.hir); assert.equal(printHir(hir), hirBefore);
  const originalEntry = declaration(hir.functions, 'entry', 0, 203);
  const originalWrite = declaration(hir.functions, 'write', 65, 132), originalRead = declaration(hir.functions, 'read', 132, 172);
  const local = originalEntry.body[0], state = local.binding, seed = originalEntry.parameters[0];
  assert.equal(local.kind, 'local'); assert.equal(state.name, 'state'); assert.equal(state.owner, originalEntry.id);
  assert.equal(state.writable, true); assert.equal(local.initializer.binding, seed.id);
  assert.deepEqual(originalWrite.captures, [{ binding: state.id, read: true, write: true }]);
  assert.deepEqual(originalRead.captures, [{ binding: state.id, read: true, write: false }]);
  const lowered = lowerClosureEnvironments(hir); assert.deepEqual(verifyClosureEnvironments(lowered, hir), lowered);
  const programBefore = printClosureEnvironments(lowered, hir), program = readClosureEnvironments(Buffer.from(programBefore), hir);
  assert.deepEqual(verifyClosureEnvironments(program, hir), lowered);
  const entry = declaration(program.functions, 'entry', 0, 203), write = declaration(program.functions, 'write', 65, 132);
  const read = declaration(program.functions, 'read', 132, 172), layout = program.environments[0];
  assert.deepEqual(program.functions.map(fn => fn.id), [entry.id, write.id, read.id]); assert.equal(program.environments.length, 1);
  assert.equal(layout.owner, entry.id); assert.equal(layout.parent, null);
  assert.deepEqual(layout.slots, [{ binding: state.id, type: state.type, writable: true }]);
  assert.equal(program.bindings.find(binding => binding.id === state.id).role, 'local');
  assert.equal(entry.activationEnvironment, layout.id); assert.equal(entry.lexicalEnvironment, null);
  assert.equal(write.lexicalEnvironment, layout.id); assert.equal(read.lexicalEnvironment, layout.id);
  assert.equal(entry.body[1].kind, 'initializeEnvironment');
  assert.deepEqual(entry.body[1].anchor, { kind: 'source', range: local.range });
  assert.equal(entry.body[1].value.binding, seed.id);

  // First new capability call: the existing, precise captured-local refusal must
  // escape naturally as RED after successful public HIR and 19f verification.
  const core = emitClosureCore(program, hir);

  assert.equal(typeof core, 'string');
  const header = core.slice(0, core.indexOf('\n')), marker = header.indexOf('tsfg_core.closure = {'); assert.ok(marker >= 0);
  const extension = header.slice(marker), version = extension.match(/version = ([0-9]+) : i64/); assert.ok(version);
  assert.ok(Number(version[1]) >= 2, 'captured locals require the new private candidate schema version');
  assert.match(extension, /schema = "sha256:[0-9a-f]{64}"/);
  assert.ok(extension.includes('family = "tsfg.core-closure-candidate"'));
  assert.ok(extension.includes('program_hash = "' + digest(programBefore) + '"'));
  assert.ok(extension.includes('hir_hash = "' + program.hirHash + '"'));
  assert.ok(extension.includes('root_policy = "consumer-recompute-required"'));
  assert.ok(extension.includes('id = "' + layout.id + '", owner = "' + entry.id + '"'));
  assert.ok(extension.includes('binding = "' + state.id + '", type = "' + state.type + '"'));
  assert.equal([...extension.matchAll(/role = "local"/g)].length, 1, 'the original local slot is described with its actual role');
  const fullId = /^sha256:[0-9a-f]{64}$/;
  for (const id of [state.id, state.owner, state.type, layout.id]) assert.match(id, fullId);
  for (const fn of [entry, write, read]) for (const id of [fn.id, fn.signature, fn.signatureHash, fn.returnType]) assert.match(id, fullId);
  assert.equal([...core.matchAll(/^  func[.]func /gm)].length, 3);
  const env = '!tsfg_closure.env<"' + layout.id + '">', e = functionText(core, entry), w = functionText(core, write), r = functionText(core, read);
  assert.ok(e.header.startsWith('  func.func @"' + symbol(entry) + '"(%v0: i1) -> i1 attributes {'));
  assert.ok(w.header.startsWith('  func.func @"' + symbol(write) + '"(%v0: ' + env + ', %v1: i1) -> i1 attributes {'));
  assert.ok(r.header.startsWith('  func.func @"' + symbol(read) + '"(%v0: ' + env + ') -> i1 attributes {'));
  for (const [fn, emitted] of [[entry, e], [write, w], [read, r]]) {
    assert.ok(emitted.header.includes('tsfg_core.function_id = "' + fn.id + '"'));
    assert.ok(emitted.header.includes('tsfg_core.signature_hash = "' + fn.signatureHash + '"'));
    assert.ok(emitted.header.includes('tsfg_closure.lexical_environment = "' + (fn.lexicalEnvironment ?? '') + '"'));
  }
  assert.equal(e.body, [
    '    "tsfg_core.fuel"() {event = 1 : i32, ' + source(entry.range) + '} : () -> ()',
    '    %v1 = "tsfg_closure.env.alloc"() {layout = "' + layout.id + '", anchor_kind = "function-entry", ' + source(originalEntry.definitionRange) + '} : () -> ' + env,
    '    "tsfg_closure.env.init"(%v1, %v0) {binding = "' + state.id + '", anchor_kind = "source", ' + source(local.range) + '} : (' + env + ', i1) -> ()',
    '    %v2 = "tsfg_core.constant"() {value = 0 : i1, ' + source(originalEntry.body[3].value.arguments[0].range) + '} : () -> i1',
    '    %v3 = "func.call"(%v1, %v2) {callee = @"' + symbol(write) + '", tsfg_core.function_id = "' + write.id + '", tsfg_core.signature_hash = "' + write.signatureHash + '", ' + source(originalEntry.body[3].value.range) + '} : (' + env + ', i1) -> i1',
    '    %v4 = "func.call"(%v1) {callee = @"' + symbol(read) + '", tsfg_core.function_id = "' + read.id + '", tsfg_core.signature_hash = "' + read.signatureHash + '", ' + source(originalEntry.body[4].value.range) + '} : (' + env + ') -> i1',
    '    "func.return"(%v4) {' + source(originalEntry.body[4].range) + '} : (i1) -> ()',
  ].join('\n'), 'seed initializes the single activation slot exactly once before the ordered write/read calls');
  assert.equal(w.body, [
    '    "tsfg_core.fuel"() {event = 1 : i32, ' + source(write.range) + '} : () -> ()',
    '    "tsfg_closure.env.store"(%v0, %v1) {binding = "' + state.id + '", ' + source(originalWrite.body[0].range) + '} : (' + env + ', i1) -> ()',
    '    %v2 = "tsfg_closure.env.load"(%v0) {binding = "' + state.id + '", ' + source(originalWrite.body[1].value.range) + '} : (' + env + ') -> i1',
    '    "func.return"(%v2) {' + source(originalWrite.body[1].range) + '} : (i1) -> ()',
  ].join('\n'), 'write stores its real parameter then reads that same original shared binding');
  assert.equal(r.body, [
    '    "tsfg_core.fuel"() {event = 1 : i32, ' + source(read.range) + '} : () -> ()',
    '    %v1 = "tsfg_closure.env.load"(%v0) {binding = "' + state.id + '", ' + source(originalRead.body[0].value.range) + '} : (' + env + ') -> i1',
    '    "func.return"(%v1) {' + source(originalRead.body[0].range) + '} : (i1) -> ()',
  ].join('\n'), 'read observes the same caller activation rather than an independently copied local');
  assert.equal([...core.matchAll(/"tsfg_closure[.]env[.]alloc"/g)].length, 1);
  assert.equal([...core.matchAll(/"tsfg_closure[.]env[.]init"/g)].length, 1);
  assert.equal([...core.matchAll(/"tsfg_closure[.]env[.]store"/g)].length, 1);
  assert.equal([...core.matchAll(/"tsfg_closure[.]env[.]load"/g)].length, 2);
  assert.ok(core.endsWith('\n') && !core.endsWith('\n\n')); assert.doesNotMatch(core, /undefined|NaN|\r/);
  assert.ok(Buffer.byteLength(core, 'utf8') <= 8388608);
  assert.equal(emitClosureCore(program, hir), core, 'same complete valid input emits identical bytes');
  assert.equal(printHir(hir), hirBefore); assert.equal(printClosureEnvironments(program, hir), programBefore);
});
