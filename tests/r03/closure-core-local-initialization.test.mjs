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
// Owned Go frames are pinned independently; no Source response or HIR is synthesized.
const pins = {
  "initializedReturnedLocal": {"request":[2057,"sha256:9ab4ecc72426bd5a9bfa47e1bca994df3e7314027dcb46c92beb325966dfaeba"],"response":[4696,"sha256:280814d25505f19efaf69d3fafe3b6aefeb167af3892432e461483bd33d69c53"],"original":[1697,"sha256:dc4c4a2dee275dde3642c4fa397e283dee76da77d51a5d015a2f6a424357195b"],"provenance":[1188,"sha256:3f832d1f59b0f3d8cffe169edf1f860f75104ffac66616823895ee7ae3006905"]},
  "initializedCallbackLocal": {"request":[1982,"sha256:5688898d3f5766888b70cdf8fb657f2e61a81eceeff0d391ffc98169d3522d9a"],"response":[3494,"sha256:41d421954710596fb2998a56bcc6566e717ff18546890595adc0edfd5833102b"],"original":[1622,"sha256:b9c1ec446db187cbcdc1491922dbf91523fe2592271eb0a596ceec9b2e874266"],"provenance":[1188,"sha256:56199dc4814cc84c264b10135555b32ea86383e2eb9725811c2b86ac1863fef4"]},
  "recursiveFreshLocal": {"request":[2090,"sha256:2828e3c91b0edb1046d799ece00fe9bd96c9770285dd6c99acea3dc227dd0d91"],"response":[5659,"sha256:2b97ba76d5d49a369c2418ea774d4e4a31d046adf59f25ed0a3e72bcde92aa28"],"original":[1730,"sha256:bc515f852a983c0537fd215004f3ed3fd0a1e7ae7daa2fc376a04176dc218764"],"provenance":[1183,"sha256:fd5098da2f305b44555170473261a61d5a8d0b63a156bb387c61202379876b10"]},
  "selfInitializerLocalRead": {"request":[1917,"sha256:975ec4704d96e43233ac52c75dfa0a7939ba1f74de6d87f9a80c0383433bab1d"],"response":[2119,"sha256:cd2ddc653d75ac786d714a6dddbcb20f5f8a625a766514138e2e6b441e4a1ba8"],"original":[1557,"sha256:8018c8f99ca16415a51dab670a6b0e673015e78c72e59e93aa01e29cbcb5e7cc"],"provenance":[1188,"sha256:f7aadf416f92e0b1fdec479b7117fd40d196aa64c87bddb9006b33e802f3e872"]},
  "earlyTransitiveLocalRead": {"request":[1990,"sha256:ce74516939f35b15714d67beae83c81f3ebf3ed356d8781a491da3e27efb3aad"],"response":[3191,"sha256:201bb38607b21c724258bca9e31d4ce520078893d3538371d9ac92ebb31dd217"],"original":[1630,"sha256:8d2585ff917075f77c04446096e064c542941177d8ab04bd2ca97e7f4c81b5f7"],"provenance":[1188,"sha256:eabb6928046d9f68ad6f705c902284313b261bfaacac464c4932d83b38817c2f"]},
  "earlyMakeThenInitialize": {"request":[1960,"sha256:ae3132fddc8a303038fc82971d645389a7db961b9db474557cd085e1cdc05fe0"],"response":[2840,"sha256:0828315d5297258d37cc09a6422839f93cc683680e39ff1fbbab481b78ba1e05"],"original":[1600,"sha256:dc6aa1b99e39e3d8e497a01101f07f1aa3713c2d4984203559b7ef05c81c2e8b"],"provenance":[1187,"sha256:ea7e7e9da338ccc23ed84c6a3bac97851ff97b4f7533db0cfc56369260c7b9c4"]},
  "callbackInitializerLocalWrite": {"request":[2044,"sha256:a4fa31e6e41c2da10fbc0f6a6aa47963ddd3a3900d1b8a86ead242525d883364"],"response":[5088,"sha256:de354805a02ea57eacee2452a4de33b9b410b1f9e9b18606ebc8c86c27b56d19"],"original":[1684,"sha256:8380c8f575166ccd0c7e65542d8728042771f2884baa50e32f8ef65bf00b643f"],"provenance":[1193,"sha256:2cc411e8c05d662d540213f5f1e4d3549eeddcc13e64d3f96cbd8ee1121c1527"]},
  "earlyTransitiveLocalMake": {"request":[2016,"sha256:f7fd7c8e5c5023e44624633b4f0a13e9426bd747d38584e48f0cb7dea4ac1cd1"],"response":[3690,"sha256:dfa02e2904581fc7fb59e94a99a20aed61e27569af979137d64427684bd5bba3"],"original":[1656,"sha256:0e990f9e3dece74540b220eeea60aa36b758590ab3448d262a7d0a5554a3427f"],"provenance":[1188,"sha256:9711e0bb80aed61c6e8ceda9311eb04b21215faaf1754262cb32978fa4271196"]},
};
const inputHash = 'sha256:0a3cba29831a9ed1333ad2c195e98ca7f87564a6614e2c44f8d4dcf43d33dc36';
const inputFileHash = 'sha256:3ab5c58dd5ea1ccbb44435d920bcbfa4f56135a65b1c275857a8058525843cd1';
const rawHash = 'sha256:973d2db57f5174d07f5e8c0d7eefdebf0950041dbd7332380c8d95d54f129adf';
const one = values => { assert.equal(values.length, 1); return values[0]; };
const named = (functions, name) => one(functions.filter(fn => fn.name === name));
const original = (c, name) => named(c.hir.functions, name);
const lowered = (c, name) => named(c.program.functions, name);
const local = (fn, name) => one(fn.body.filter(item => item.kind === 'local' && item.binding.name === name));
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
async function owned(name, functions) {
  const directory = new URL('../fixtures/r03/m19-closure-local-initialization/' + name + '/', import.meta.url);
  /** @type {Record<string, Buffer>} */ const frames = {};
  for (const kind of ['request', 'response', 'original', 'provenance']) {
    frames[kind] = await readFile(new URL(kind + '.json', directory));
    assert.equal(frames[kind].length, pins[name][kind][0]); assert.equal(digest(frames[kind]), pins[name][kind][1]);
  }
  const provenance = JSON.parse(frames.provenance.toString('utf8'));
  assert.deepEqual(provenance.origin, { kind: 'owned-go-response', producerBaseOid: 'e73eafaf80eeffc5040f4eef7cd2a58951cfbce1', producerDirty: true,
    requestSha256: pins[name].request[1], responseSha256: pins[name].response[1], testedInputSetHash: inputHash });
  assert.deepEqual(provenance.credit, { admitted: false, executionAuthority: false, ownedGoResponse: true, sourceExecutable: false });
  assert.deepEqual(provenance.execution, { actualNodes: 25, close: 0, exit: 0, first: [], pid: 33652,
    rawLogPath: 'E:/ws/pro_tsfg/.scratch/tsfg_r03/M19-local-environments-checks-20261017/source-cases/public-go-eight-corrected/stdout.bin', rawLogSha256: rawHash });
  assert.equal(provenance.sourceTest, 'TestFrontendCommandClosureFlowFacts/' + name + '/ownedProjection');
  assert.deepEqual(provenance.testedInputSetReference, { canonicalSetHash: inputHash, hashPreimage: 'JCS array without final LF; file has one LF',
    path: '../tested-inputs.json', sha256: inputFileHash });
  const inputBytes = await readFile(new URL('../tested-inputs.json', directory));
  assert.equal(inputBytes.length, 13260); assert.equal(digest(inputBytes), inputFileHash);
  const inputs = JSON.parse(inputBytes.toString('utf8')); assert.equal(inputs.length, 90); assert.equal(digest(jcs(inputs)), inputHash);
  const request = JSON.parse(frames.request.toString('utf8')), source = JSON.parse(frames.original.toString('utf8'));
  assert.deepEqual(request.files, source.files); assert.equal(request.rootFile, source.rootFile);
  const raw = JSON.parse(frames.response.toString('utf8')); assert.equal(raw.status, 'ok');
  assert.deepEqual(raw.inputs, ['/src/main.ts', '/src/minimal-integers-v3.d.ts']); assert.deepEqual(raw.functions.map(fn => fn.name), functions);
  const imported = await importCapturedFrontendResponse(frames.request, frames.response, provenance.origin);
  assert.equal(imported.status, 'ok', JSON.stringify(imported)); validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot); assert.equal(built.status, 'ok', JSON.stringify(built));
  const before = printHir(verifyHir(built.hir)), hir = readHir(Buffer.from(before)); assert.deepEqual(verifyHir(hir), built.hir);
  const program = lowerClosureEnvironments(hir); assert.deepEqual(verifyClosureEnvironments(program, hir), program);
  const programBefore = printClosureEnvironments(program, hir); assert.equal(program.hirHash, digest(before));
  return { hir, before, program, programBefore, raw };
}
// Finite line observations and SSA-use comparisons, not a parser or evaluator.
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
function unchanged(c) {
  assert.equal(printHir(c.hir), c.before); assert.equal(printClosureEnvironments(c.program, c.hir), c.programBefore);
}
async function emitted(c) {
  const core = emitClosureCore(c.program, c.hir);
  const schema = JSON.parse(await readFile(new URL('../../contracts/core-closure-candidate.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.family, 'tsfg.core-closure-candidate'); assert.equal(schema.version, 2);
  const metadata = core.slice(0, core.indexOf('\n'));
  assert.ok(metadata.includes('family = "' + schema.family + '", version = 2 : i64, schema = "' + digest(jcs(schema)) + '"'));
  assert.ok(metadata.includes('program_hash = "' + digest(c.programBefore) + '", hir_hash = "' + digest(c.before) + '"'));
  assert.ok(metadata.includes('root_policy = "consumer-recompute-required"'));
  assert.equal([...core.matchAll(/^  func[.]func /gm)].length, c.program.functions.length);
  let previous = -1;
  for (const fn of c.program.functions) {
    assert.match(fn.id, /^sha256:[0-9a-f]{64}$/); const lines = body(core, fn), position = core.indexOf(lines[0]);
    assert.ok(position > previous); previous = position;
    for (const [key, value] of [['tsfg_core.function_id', fn.id], ['tsfg_core.signature_hash', fn.signatureHash],
      ['tsfg_closure.signature', fn.signature], ['tsfg_closure.lexical_environment', fn.lexicalEnvironment ?? ''], ['tsfg_closure.activation_environment', fn.activationEnvironment ?? '']])
      assert.ok(lines[0].includes(key + ' = "' + value + '"'));
    assert.equal(lines.filter(line => line.includes('"tsfg_core.fuel"()') && line.includes(anchor(fn.range))).length, 1);
  }
  for (const layout of c.program.environments) for (const slot of layout.slots) {
    const binding = one(c.program.bindings.filter(item => item.id === slot.binding)), owner = one(c.hir.functions.filter(fn => fn.id === binding.owner));
    const declarations = binding.role === 'parameter' ? owner.parameters : owner.body.filter(item => item.kind === 'local').map(item => item.binding);
    const ordinal = declarations.findIndex(item => item.id === binding.id); assert.ok(ordinal >= 0);
    assert.ok(metadata.includes('{binding = "' + binding.id + '", type = "' + binding.type + '", writable = ' + slot.writable
      + ', role = "' + binding.role + '", declaration_index = ' + ordinal + ' : i64}'));
  }
  assert.ok(core.endsWith('\n') && !core.endsWith('\n\n')); assert.doesNotMatch(core, /undefined|NaN|\r/);
  assert.ok(Buffer.byteLength(core) <= 8388608); assert.equal(emitClosureCore(c.program, c.hir), core); unchanged(c);
  return core;
}
function allocation(c, core, owner, expectedValue) {
  const lines = body(core, lowered(c, owner.name)), layout = one(c.program.environments), state = local(owner, 'state');
  assert.equal(layout.owner, owner.id); assert.equal(layout.slots[0].binding, state.binding.id); assert.equal(layout.slots.length, 1);
  const alloc = operation(lines, 'tsfg_closure.env.alloc', owner.definitionRange), init = operation(lines, 'tsfg_closure.env.init', state.range);
  assert.deepEqual(operands(alloc, 'tsfg_closure.env.alloc'), []); assert.ok(alloc.endsWith('-> ' + env(layout)));
  assert.ok(alloc.includes('anchor_kind = "function-entry"'));
  assert.deepEqual(operands(init, 'tsfg_closure.env.init'), [result(alloc), expectedValue]);
  assert.ok(init.includes('binding = "' + state.binding.id + '", anchor_kind = "source"')); assert.ok(init.endsWith(' : (' + env(layout) + ', i1) -> ()'));
  assert.equal([...core.matchAll(/"tsfg_closure[.]env[.]alloc"/g)].length, 1);
  assert.equal([...core.matchAll(/"tsfg_closure[.]env[.]init"/g)].length, 1); ordered(lines, alloc, init);
  return { lines, alloc, init, layout, state };
}
function readBody(c, core, layout, state) {
  const read = original(c, 'read'), lines = body(core, lowered(c, 'read'));
  assert.deepEqual(read.captures, [{ binding: state.binding.id, read: true, write: false }]);
  assert.ok(lines[0].includes('%v0: ' + env(layout)));
  const load = operation(lines, 'tsfg_closure.env.load', read.body[0].value.range);
  assert.deepEqual(operands(load, 'tsfg_closure.env.load'), ['%v0']); assert.ok(load.includes('binding = "' + state.binding.id + '"'));
  assert.ok(load.endsWith(' : (' + env(layout) + ') -> i1'));
  assert.deepEqual(operands(operation(lines, 'func.return', read.body[0].range), 'func.return'), [result(load)]);
}
function closureIdentity(line, fn) {
  assert.ok(line.includes('function_id = "' + fn.id + '"')); assert.ok(line.includes('signature_hash = "' + fn.signatureHash + '"'));
}

test('initialized returned local keeps declaration ordinal one and the returned closure carries the once initialized cell', async () => {
  const c = await owned('initializedReturnedLocal', ['entry', 'make', 'read']), core = await emitted(c), make = original(c, 'make');
  const a = allocation(c, core, make, '%v0'), before = local(make, 'before');
  assert.equal(make.body[0], before); assert.equal(make.body[1], a.state); assert.equal(before.initializer.binding, make.parameters[0].id);
  assert.equal(a.state.initializer.binding, before.binding.id);
  assert.ok(core.split('\n')[0].includes('role = "local", declaration_index = 1 : i64}'));
  const made = operation(a.lines, 'tsfg_closure.make', make.body.at(-1).value.range); closureIdentity(made, lowered(c, 'read'));
  assert.deepEqual(operands(made, 'tsfg_closure.make'), [result(a.alloc)]); assert.ok(made.endsWith('-> ' + callable(make.returnType)));
  ordered(a.lines, a.init, made); assert.deepEqual(operands(operation(a.lines, 'func.return', make.body.at(-1).range), 'func.return'), [result(made)]);
  const entry = original(c, 'entry'), e = body(core, lowered(c, 'entry')), selected = local(entry, 'selected');
  const called = operation(e, 'func.call', selected.initializer.range); closureIdentity(called, lowered(c, 'make'));
  assert.deepEqual(operands(called, 'func.call'), ['%v0']);
  assert.deepEqual(operands(operation(e, 'tsfg_closure.call', entry.body.at(-1).value.range), 'tsfg_closure.call'), [result(called)]);
  readBody(c, core, a.layout, a.state);
});

test('initialized callback local passes its real environment and preserves the callable parameter as callee', async () => {
  const c = await owned('initializedCallbackLocal', ['entry', 'read', 'invoke']), core = await emitted(c), entry = original(c, 'entry');
  const a = allocation(c, core, entry, '%v0'), call = entry.body.at(-1).value;
  const made = operation(a.lines, 'tsfg_closure.make', call.arguments[0].range); closureIdentity(made, lowered(c, 'read'));
  assert.deepEqual(operands(made, 'tsfg_closure.make'), [result(a.alloc)]); ordered(a.lines, a.init, made);
  const invoked = operation(a.lines, 'func.call', call.range); closureIdentity(invoked, lowered(c, 'invoke'));
  assert.deepEqual(operands(invoked, 'func.call'), [result(a.alloc), result(made)]); ordered(a.lines, made, invoked);
  const invoke = original(c, 'invoke'), lines = body(core, lowered(c, 'invoke'));
  assert.ok(lines[0].includes('%v0: ' + env(a.layout) + ', %v1: ' + callable(invoke.parameters[0].type)));
  const indirect = operation(lines, 'tsfg_closure.call', invoke.body[0].value.range);
  assert.deepEqual(operands(indirect, 'tsfg_closure.call'), ['%v1']);
  assert.deepEqual(operands(operation(lines, 'func.return', invoke.body[0].range), 'func.return'), [result(indirect)]);
  readBody(c, core, a.layout, a.state);
});

// Structural SSA credit only: this fixture does not retain two recursive closures or execute Core.
test('recursive function allocates and initializes its own cell before recursion and returns its current activation on the other path', async () => {
  const c = await owned('recursiveFreshLocal', ['entry', 'make', 'read']), core = await emitted(c), make = original(c, 'make');
  const a = allocation(c, core, make, '%v0'), branch = one(make.body.filter(item => item.kind === 'if'));
  const recursive = branch.thenBody[0].body[0].value;
  const negated = operation(a.lines, 'tsfg_core.bool_not', recursive.arguments[0].range);
  assert.deepEqual(operands(negated, 'tsfg_core.bool_not'), ['%v0']);
  const no = operation(a.lines, 'tsfg_core.constant', recursive.arguments[1].range); assert.ok(no.includes('value = 0 : i1'));
  const called = operation(a.lines, 'func.call', recursive.range); closureIdentity(called, lowered(c, 'make'));
  assert.deepEqual(operands(called, 'func.call'), [result(negated), result(no)]); assert.ok(called.includes(' : (i1, i1) -> ' + callable(make.returnType)));
  ordered(a.lines, a.init, negated); ordered(a.lines, negated, called);
  assert.deepEqual(operands(operation(a.lines, 'func.return', branch.thenBody[0].body[0].range), 'func.return'), [result(called)]);
  const made = operation(a.lines, 'tsfg_closure.make', make.body.at(-1).value.range); closureIdentity(made, lowered(c, 'read'));
  assert.deepEqual(operands(made, 'tsfg_closure.make'), [result(a.alloc)]);
  assert.deepEqual(operands(operation(a.lines, 'func.return', make.body.at(-1).range), 'func.return'), [result(made)]);
  const entry = original(c, 'entry'), e = body(core, lowered(c, 'entry')), selected = local(entry, 'selected');
  const initial = operation(e, 'func.call', selected.initializer.range); assert.deepEqual(operands(initial, 'func.call'), ['%v0', '%v0']);
  assert.deepEqual(operands(operation(e, 'tsfg_closure.call', entry.body.at(-1).value.range), 'tsfg_closure.call'), [result(initial)]);
  readBody(c, core, a.layout, a.state);
});

// Expected paths are explicit facts of these five real Source graphs, not a copy of the producer analysis.
/** @type {Array<[string, string[], string, string, number[]]>} */
const rejected = [
  ['selfInitializerLocalRead', ['entry', 'read'], 'state', 'call', [99, 106]],
  ['earlyTransitiveLocalRead', ['entry', 'middle', 'read'], 'before', 'call', [145, 154]],
  ['earlyMakeThenInitialize', ['entry', 'read'], 'selected', 'makeClosure', [110, 115]],
  ['callbackInitializerLocalWrite', ['entry', 'write'], 'state', 'makeClosure', [216, 221]],
  ['earlyTransitiveLocalMake', ['entry', 'middle', 'read'], 'selected', 'call', [157, 166]],
];
for (const [name, path, declaration, kind, range] of rejected) test(name + ' rejects at the real observation with its original local declaration and dependency chain', async () => {
  const names = name === 'callbackInitializerLocalWrite' ? ['entry', 'write', 'invoke']
    : name.startsWith('earlyTransitive') ? ['entry', 'read', 'middle'] : path;
  const c = await owned(name, names), entry = original(c, 'entry'), state = local(entry, 'state');
  const localStatement = local(entry, declaration), out = lowered(c, 'entry');
  const statement = one(out.body.filter(item => item.binding === localStatement.binding.id && ['local', 'initializeEnvironment'].includes(item.kind)));
  const value = statement.kind === 'local' ? statement.initializer : statement.value;
  const trigger = name === 'callbackInitializerLocalWrite' ? value.arguments[0] : value;
  assert.equal(trigger.kind, kind); assert.deepEqual(trigger.range, { start: range[0], end: range[1] });
  assert.equal(one(c.program.environments).slots[0].binding, state.binding.id);
  const target = original(c, path.at(-1));
  assert.deepEqual(target.captures, [{ binding: state.binding.id, read: true, write: name === 'callbackInitializerLocalWrite' }]);
  if (name.startsWith('earlyTransitive')) {
    const middle = original(c, 'middle'); assert.equal(middle.captures.some(item => item.binding === state.binding.id), false);
    const edge = middle.body.at(-1).value;
    assert.equal(edge.kind, name.endsWith('Make') ? 'functionReference' : 'call'); assert.equal(edge.target, target.id);
  }
  if (name === 'earlyMakeThenInitialize') {
    assert.ok(localStatement.range.end < state.range.start); assert.ok(state.range.end < entry.body.at(-1).value.range.start);
    assert.equal(entry.body.at(-1).value.kind, 'indirectCall');
  }
  assert.throws(() => emitClosureCore(c.program, c.hir), /** @param {any} error */ error => {
    assert.equal(error.code, 'r03-d-capability'); assert.equal(error.ruleId, 'r01-ts-baseline'); assert.equal(error.phase, 'lowering');
    assert.ok(error.message.includes('captured local initialization before closure observation is not proven'));
    assert.deepEqual(error.primary, { source: c.hir.source.path, start: range[0], end: range[1], owner: entry.id, binding: state.binding.id });
    assert.deepEqual(error.bindingDeclaration, { source: c.hir.source.path, start: state.binding.range.start, end: state.binding.range.end, owner: entry.id, binding: state.binding.id });
    assert.deepEqual(error.initializationDependency, path.map(name => original(c, name).id)); return true;
  });
  unchanged(c);
});
