// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir } from '../../compiler/hir.mjs';
import { lowerClosureEnvironments, verifyClosureEnvironments, printClosureEnvironments, readClosureEnvironments } from '../../compiler/closure-environments.mjs';
import { emitClosureCore } from '../../compiler/closure-core-emitter.mjs';

const fixture = new URL('../fixtures/r03/m19-function-values/', import.meta.url);
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
// Independent JCS for the finite JSON schema; no producer formatting/hash helpers.
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
/** @param {any[]} functions @param {string} name @param {number} start @param {number} end */
function declaration(functions, name, start, end) {
  const found = functions.filter(fn => fn.name === name && fn.range.start === start && fn.range.end === end);
  assert.equal(found.length, 1, 'one original owned declaration: ' + name);
  return found[0];
}
// The pinned fixture uses ASCII strings, whose JSON and MLIR quote spellings
// coincide. This is an independent golden, not a general MLIR printer/parser.
const quote = value => JSON.stringify(value);
const integer = value => value + ' : i64';
const array = values => '[' + values.join(', ') + ']';
const dictionary = fields => '{' + Object.entries(fields).map(([key, value]) => key + ' = ' + value).join(', ') + '}';
const symbol = fn => 'f' + fn.id.slice(7);
/** @param {any} fn */
function functionAttributes(fn) {
  return [
    'tsfg_core.function_id = ' + quote(fn.id),
    'tsfg_core.signature_hash = ' + quote(fn.signatureHash),
    'tsfg_core.type_id = ' + quote(fn.returnType),
    'tsfg_core.function_start = ' + integer(fn.range.start),
    'tsfg_core.function_end = ' + integer(fn.range.end),
    'tsfg_closure.signature = ' + quote(fn.signature),
    'tsfg_closure.lexical_environment = ' + quote(fn.lexicalEnvironment ?? ''),
    'tsfg_closure.activation_environment = ' + quote(fn.activationEnvironment ?? ''),
  ].join(', ');
}
/** @param {any} program @param {string} schemaHash @param {string} programHash @param {string} bytecodeSchema */
function moduleAttributes(program, schemaHash, programHash, bytecodeSchema) {
  /** @type {Map<string, any>} */
  const bindings = new Map(program.bindings.map(binding => [binding.id, binding]));
  const types = program.types.map(type => dictionary(type.kind === 'scalar'
    ? { id: quote(type.id), kind: quote(type.kind), name: quote(type.name) }
    : { id: quote(type.id), kind: quote(type.kind), parameters: array(type.parameters.map(quote)), returnType: quote(type.returnType) }));
  const environments = program.environments.map(layout => dictionary({
    id: quote(layout.id), owner: quote(layout.owner), parent: quote(layout.parent ?? ''),
    slots: array(layout.slots.map(slot => dictionary({ binding: quote(slot.binding), type: quote(slot.type),
      writable: slot.writable ? 'true' : 'false', role: quote(bindings.get(slot.binding).role) }))),
  }));
  const functions = program.functions.map(fn => dictionary({
    id: quote(fn.id), name: quote(fn.name), symbol: quote(symbol(fn)), lexical_parent: quote(fn.lexicalParent ?? ''),
    lexical_scope: quote(fn.lexicalScope), signature: quote(fn.signature), signature_hash: quote(fn.signatureHash),
    lexical_environment: quote(fn.lexicalEnvironment ?? ''), activation_environment: quote(fn.activationEnvironment ?? ''),
    parameters: array(fn.parameters.map(id => dictionary({ binding: quote(id), type: quote(bindings.get(id).type) }))),
    return_type: quote(fn.returnType), start: integer(fn.range.start), end: integer(fn.range.end),
  }));
  const closure = dictionary({ family: quote('tsfg.core-closure-candidate'), version: integer(1), schema: quote(schemaHash),
    program_hash: quote(programHash), hir_hash: quote(program.hirHash), root_policy: quote('consumer-recompute-required'),
    types: array(types), environments: array(environments), functions: array(functions) });
  return [
    'tsfg_core.version = "0.9.0"',
    'tsfg_core.input_identity = ' + quote(program.inputIdentity),
    'tsfg_core.source_hash = ' + quote(program.source.hash),
    'tsfg_core.source_path = ' + quote(program.source.path),
    'tsfg_core.target = ' + quote(program.target.target),
    'tsfg_core.triple = ' + quote(program.target.triple),
    'tsfg_core.data_layout = ' + quote(program.target.llvmDataLayout),
    'tsfg_core.bytecode_schema = ' + quote(bytecodeSchema),
    'tsfg_core.source_length = ' + integer(program.source.content.length),
    'tsfg_core.closure = ' + closure,
  ].join(', ');
}

// Frozen 19g contract: complete output for the genuine four-function source.
// Every placeholder is replaced with cold-verified input identities below.
const completeGolden = `module attributes {<<A>>} {
  func.func @"<<SYM_E>>"(%v0: i1) -> i1 attributes {<<FA_E>>} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 269 : i64} : () -> ()
    %v1 = "func.call"(%v0) {callee = @"<<SYM_M>>", tsfg_core.function_id = "<<F_M>>", tsfg_core.signature_hash = "<<S_M>>", tsfg_source.start = 209 : i64, tsfg_source.end = 220 : i64} : (i1) -> !tsfg_closure.value<"<<T_C>>">
    %v2 = "func.call"(%v1) {callee = @"<<SYM_I>>", tsfg_core.function_id = "<<F_I>>", tsfg_core.signature_hash = "<<S_I>>", tsfg_source.start = 252 : i64, tsfg_source.end = 266 : i64} : (!tsfg_closure.value<"<<T_C>>">) -> i1
    "func.return"(%v2) {tsfg_source.start = 245 : i64, tsfg_source.end = 267 : i64} : (i1) -> ()
  }
  func.func @"<<SYM_M>>"(%v0: i1) -> !tsfg_closure.value<"<<T_C>>"> attributes {<<FA_M>>} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 41 : i64, tsfg_source.end = 137 : i64} : () -> ()
    %v1 = "tsfg_closure.env.alloc"() {layout = "<<L>>", anchor_kind = "function-entry", tsfg_source.start = 50 : i64, tsfg_source.end = 55 : i64} : () -> !tsfg_closure.env<"<<L>>">
    "tsfg_closure.env.init"(%v1, %v0) {binding = "<<B>>", anchor_kind = "parameter", tsfg_source.start = 56 : i64, tsfg_source.end = 61 : i64} : (!tsfg_closure.env<"<<L>>">, i1) -> ()
    %v2 = "tsfg_closure.make"(%v1) {function_id = "<<F_R>>", signature_hash = "<<S_R>>", tsfg_source.start = 129 : i64, tsfg_source.end = 134 : i64} : (!tsfg_closure.env<"<<L>>">) -> !tsfg_closure.value<"<<T_C>>">
    "func.return"(%v2) {tsfg_source.start = 122 : i64, tsfg_source.end = 135 : i64} : (!tsfg_closure.value<"<<T_C>>">) -> ()
  }
  func.func @"<<SYM_R>>"(%v0: !tsfg_closure.env<"<<L>>">) -> i1 attributes {<<FA_R>>} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 82 : i64, tsfg_source.end = 122 : i64} : () -> ()
    %v1 = "tsfg_closure.env.load"(%v0) {binding = "<<B>>", tsfg_source.start = 113 : i64, tsfg_source.end = 119 : i64} : (!tsfg_closure.env<"<<L>>">) -> i1
    "func.return"(%v1) {tsfg_source.start = 106 : i64, tsfg_source.end = 120 : i64} : (i1) -> ()
  }
  func.func @"<<SYM_I>>"(%v0: !tsfg_closure.value<"<<T_C>>">) -> i1 attributes {<<FA_I>>} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 137 : i64, tsfg_source.end = 192 : i64} : () -> ()
    %v1 = "tsfg_closure.call"(%v0) {signature = "<<T_C>>", signature_hash = "<<S_R>>", tsfg_source.start = 184 : i64, tsfg_source.end = 189 : i64} : (!tsfg_closure.value<"<<T_C>>">) -> i1
    "func.return"(%v1) {tsfg_source.start = 177 : i64, tsfg_source.end = 190 : i64} : (i1) -> ()
  }
}
`;

// Owned Go response custody is unchanged from 19f. This test only compiles
// text in Node; it never runs Source, generated closures, Core, VM or an MLIR parser.
test('real returned closure emits all four typed SSA functions with activation allocation and preserved alias dataflow', async () => {
  /** @type {[string, number, string][]} */
  const identities = [
    ['request.json', 2073, 'sha256:1a8fdc95a48caaf4ceef02f291b7f18cffae12743e234072934b952f364efe33'],
    ['response.json', 5678, 'sha256:f329aca7fdbcefea2eeca81317d00f04bb18447b03d243cf1a5593b631eb5b41'],
    ['original.json', 1713, 'sha256:1748bb2bebfe1cac05a5a5b1ac2c6e28e457e56f3c57e9a0c426a75adf9b02a0'],
    ['provenance.json', 17306, 'sha256:53875a3dd1b5171e7b50ac5650cc496d43332389f1cb9e7fef162a408b7facc9'],
  ];
  const frames = await Promise.all(identities.map(([name]) => readFile(new URL(name, fixture))));
  frames.forEach((bytes, index) => {
    assert.equal(bytes.length, identities[index][1]);
    assert.equal(digest(bytes), identities[index][2]);
  });
  const [request, response, original, provenance] = frames;
  const metadata = JSON.parse(provenance.toString('utf8'));
  assert.deepEqual(metadata.origin, { kind: 'owned-go-response',
    producerBaseOid: '8d106b6768521c21b9ef4e7a69df023977d71b09', producerDirty: true,
    testedInputSetHash: 'sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b',
    requestSha256: identities[0][2], responseSha256: identities[1][2] });
  assert.equal(metadata.deliveryOid, 'd954555abfc9f0a9886fb28e81fdb18828a4a314');
  assert.equal(metadata.execution.rawLogSha256, 'sha256:83978c2e439eb19832368d4894a004c6de599b2319f43d6f4d95e36eac910fd8');
  assert.deepEqual(metadata.credit, { ownedGoResponse: true, sourceExecutable: false, admitted: false, executionAuthority: false });
  const input = JSON.parse(request.toString('utf8')), untouched = JSON.parse(original.toString('utf8'));
  assert.deepEqual(input.files, untouched.files);
  assert.equal(input.rootFile, untouched.rootFile);
  assert.equal(input.files.find(file => file.path === input.rootFile).content,
    'export function entry(seed: bool): bool { function make(value: bool): () => bool { function read(): bool { return value; } return read; } function invoke(fn: () => bool): bool { return fn(); } const selected = make(seed); const alias = selected; return invoke(alias); }');
  const raw = JSON.parse(response.toString('utf8'));
  assert.equal(raw.status, 'ok');
  assert.deepEqual(raw.functions.map(fn => fn.name), ['entry', 'make', 'read', 'invoke']);
  const imported = await importCapturedFrontendResponse(request, response, metadata.origin);
  assert.equal(imported.status, 'ok', JSON.stringify(imported));
  validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot);
  assert.equal(built.status, 'ok', JSON.stringify(built));
  const hirBefore = printHir(verifyHir(built.hir)), hir = readHir(Buffer.from(hirBefore));
  assert.deepEqual(verifyHir(hir), built.hir);
  assert.equal(printHir(hir), hirBefore);
  const lowered = lowerClosureEnvironments(hir);
  assert.deepEqual(verifyClosureEnvironments(lowered, hir), lowered);
  const programBefore = printClosureEnvironments(lowered, hir);
  const program = readClosureEnvironments(Buffer.from(programBefore), hir);
  assert.deepEqual(verifyClosureEnvironments(program, hir), lowered);
  assert.equal(printClosureEnvironments(program, hir), programBefore);

  // First new capability call: phase-1's genuine not-implemented diagnostic
  // escapes naturally as RED, after every public owned-input gate succeeded.
  const core = emitClosureCore(program, hir);

  const schema = JSON.parse(await readFile(new URL('../../contracts/core-closure-candidate.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.family, 'tsfg.core-closure-candidate');
  assert.equal(schema.version, 1);
  assert.equal(schema.status, 'private Node producer candidate');
  const registry = JSON.parse(await readFile(new URL('../../contracts/registry.json', import.meta.url), 'utf8'));
  assert.equal(registry['tsfg.bytecode'].semver, '0.9.0');
  const wireHash = registry['tsfg.bytecode'].schemaHash;
  assert.equal(wireHash, 'sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6');
  const entry = declaration(program.functions, 'entry', 0, 269), make = declaration(program.functions, 'make', 41, 137);
  const read = declaration(program.functions, 'read', 82, 122), invoke = declaration(program.functions, 'invoke', 137, 192);
  assert.deepEqual(program.functions.map(fn => fn.id), [entry.id, make.id, read.id, invoke.id]);
  assert.equal(program.environments.length, 1);
  const layout = program.environments[0], value = program.bindings.find(binding => binding.id === make.parameters[0]);
  assert.ok(value);
  assert.equal(value.name, 'value'); assert.equal(value.role, 'parameter');
  assert.equal(layout.owner, make.id); assert.equal(layout.parent, null);
  assert.deepEqual(layout.slots, [{ binding: value.id, type: value.type, writable: value.writable }]);
  assert.equal(make.activationEnvironment, layout.id); assert.equal(make.lexicalEnvironment, null);
  assert.equal(read.lexicalEnvironment, layout.id); assert.equal(read.activationEnvironment, null);
  assert.equal(invoke.lexicalEnvironment, null); assert.equal(entry.lexicalEnvironment, null);
  const fullId = /^sha256:[0-9a-f]{64}$/;
  for (const fn of program.functions) for (const id of [fn.id, fn.signature, fn.signatureHash, fn.returnType]) assert.match(id, fullId);
  for (const type of program.types) assert.match(type.id, fullId);
  for (const binding of program.bindings) for (const id of [binding.id, binding.owner, binding.type]) assert.match(id, fullId);
  assert.match(layout.id, fullId);
  const replacements = { A: moduleAttributes(program, digest(jcs(schema)), digest(programBefore), wireHash),
    L: layout.id, B: value.id, T_C: read.signature };
  for (const [key, fn] of [['E', entry], ['M', make], ['R', read], ['I', invoke]]) {
    replacements['SYM_' + key] = symbol(fn); replacements['F_' + key] = fn.id;
    replacements['S_' + key] = fn.signatureHash; replacements['FA_' + key] = functionAttributes(fn);
  }
  const expected = completeGolden.replace(/<<([A-Z_]+)>>/g, (_, key) => {
    assert.ok(Object.hasOwn(replacements, key), 'golden placeholder is defined: ' + key);
    return replacements[key];
  });
  assert.equal(typeof core, 'string');
  assert.equal(core, expected, 'complete metadata and all four bodies retain exact typed SSA operands, operation order and original anchors');
  assert.equal([...core.matchAll(/^  func[.]func /gm)].length, 4);
  assert.equal([...core.matchAll(/"tsfg_closure[.]env[.]alloc"/g)].length, 1);
  assert.equal([...core.matchAll(/"tsfg_closure[.]env[.]init"/g)].length, 1);
  assert.equal([...core.matchAll(/"tsfg_closure[.]env[.]load"/g)].length, 1);
  assert.equal([...core.matchAll(/"tsfg_closure[.]call"/g)].length, 1);
  assert.doesNotMatch(core, /<<|>>|undefined|NaN|\r/);
  assert.ok(core.endsWith('\n') && !core.endsWith('\n\n'));
  assert.ok(Buffer.byteLength(core, 'utf8') <= 8388608);
  assert.equal(emitClosureCore(program, hir), core, 'same complete input emits identical bytes');
  assert.equal(printHir(hir), hirBefore, 'emission preserves every original HIR byte');
  assert.equal(printClosureEnvironments(program, hir), programBefore, 'emission preserves every closure-explicit program byte');
});
