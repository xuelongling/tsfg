// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

// Independent finite JCS/preimages. Do not import the frozen first tracer or
// production private helpers. General budgets/old packet controls remain in
// nullable-owned-boundaries.test.mjs. Mutations below are counterfactual NEGATIVES,
// never new Source captures; lhs-call/nested originals were absent at first freeze.
// The later Go22200 top below adds those actual captured positives.
const schema = 'sha256:badc9425050a8f538fcb7b9397e5ef31fbde96391989dfeebb8cab6a122783bd';
const v1Schema = 'sha256:3da58c2cabf44bd6c337120300ac688bafa3d8e487c36f1ab0a48a4498699218';
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? assert.fail('non-JSON witness');
}
const wire = value => Buffer.from(jcs(value));
function seal(q, p, o) {
  const request = wire(q);
  p.requestId = hash('tsfg.nullable-facts.request.v2\0' + request.toString('utf8'));
  p.packageId = hash('tsfg.nullable-facts.package.v2\0' + p.schemaHash + '\0' + jcs(p.payload));
  const response = wire(p); o.requestSha256 = hash(request); o.responseSha256 = hash(response);
  return { request, response, origin: o };
}
function inputIdentity(q, p) {
  const files = q.input.files.map(f => ({ path: f.path, content: f.content }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  p.payload.inputIdentity = hash(jcs({ ...q.input, files }));
  p.payload.files = files.map(f => ({ path: f.path, digest: hash(f.content),
    byteLength: Buffer.byteLength(f.content), length: f.content.length, positionUnit: 'utf16' }));
}
function body(p) {
  const [fallback, coalesce, entry] = p.payload.facts.functions, value = coalesce.body[0].expression;
  return { fallback, coalesce, entry, value, left: value.left, right: value.right };
}
function diagnostic(result) {
  assert.equal(result.status, 'error'); assert.ok(result.diagnostics?.length > 0);
  const first = result.diagnostics[0];
  assert.match(first.code, /^r03-(?:nullable-|d-snapshot)/, 'an unrelated internal error is not boundary credit');
  throw Object.assign(new Error(first.message || first.code), { code: first.code });
}
async function complete(c) {
  const imported = await importCapturedFrontendResponse(c.request, c.response, c.origin);
  if (imported.status !== 'ok') diagnostic(imported);
  const snapshot = imported.snapshot; validateFrontendSnapshot(copy(snapshot));
  const built = buildHir(copy(snapshot)); if (built.status !== 'ok') diagnostic(built);
  const hir = verifyHir(built.hir), printed = printHir(hir), cold = readHir(Buffer.from(printed));
  assert.deepEqual(verifyHir(cold), hir); assert.equal(printHir(cold), printed);
  return { snapshot, hir: cold, core: lowerHir(cold) };
}
async function reject(t, action) {
  let failure;
  try { await action(); } catch (error) { failure = error; }
  assert.ok(failure instanceof Error, 'forged coalesce unexpectedly completed');
  const code = 'code' in failure ? String(failure.code) : failure.message.split(':')[0];
  assert.match(code, /^r03-(?:nullable-|d-snapshot|hir-invalid|hir-canonical|closure-schema)/,
    'arbitrary exceptions do not prove a checked rejection');
  t.diagnostic(code);
}
async function fixture(name) {
  const root = new URL('./fixtures/' + name + '/v2/', import.meta.url);
  const bytes = await Promise.all(['request.json', 'response.json', 'origin.json', 'expected.core.mlir']
    .map(file => readFile(new URL(file, root))));
  const [request, response, origin, golden] = bytes;
  const q = JSON.parse(request.toString()), p = JSON.parse(response.toString()), o = JSON.parse(origin.toString());
  assert.equal(q.version, 2); assert.equal(p.version, 2); assert.equal(q.schemaHash, schema); assert.equal(p.schemaHash, schema);
  const rebuilt = seal(copy(q), copy(p), copy(o));
  assert.deepEqual(rebuilt.request, request); assert.deepEqual(rebuilt.response, response); assert.deepEqual(rebuilt.origin, o);
  const checked = copy(p); inputIdentity(q, checked);
  assert.equal(checked.payload.inputIdentity, p.payload.inputIdentity); assert.deepEqual(checked.payload.files, p.payload.files);
  return { q, p, o, bytes, pins: bytes.map(hash), golden, capture: { request, response, origin: o } };
}
// Repair all public capture/snapshot identity fields, not merely packageId.
// Rebuilding still must reject the forged Source facts before trusting cold HIR.
function repairSnapshot(snapshot, q, p, c) {
  snapshot.capture = { request: c.request.toString(), response: c.response.toString() };
  snapshot.sourceOrigin = copy(c.origin); snapshot.inputIdentity = p.payload.inputIdentity;
  snapshot.snapshotId = hash('tsfg.frontend-nullable-candidate.snapshot.v2\0' + schema + '\0'
    + jcs({ inputIdentity: snapshot.inputIdentity, sourceOrigin: snapshot.sourceOrigin }));
  snapshot.identityInput = copy(q.input);
  snapshot.identityInput.files = q.input.files.map(f => ({ path: f.path, content: f.content }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  snapshot.inputs = copy(p.payload.files); snapshot.functions = copy(p.payload.facts.functions);
  snapshot.symbols = copy(p.payload.facts.symbols); snapshot.exports = copy(p.payload.exports); snapshot.target = copy(q.input.target);
  const source = q.input.files.find(f => f.path === q.input.rootFile);
  snapshot.source = { path: source.path, content: source.content, hash: hash(source.content) };
}

test('actual v2 coalesce rejects rehashed packet and cold node forgeries', { concurrency: true }, async t => {
  const baseline = await fixture('nullable-owned-scalar-entry'), actual = await fixture('nullable-owned-coalesce');
  const base = await complete(baseline.capture); assert.deepEqual(Buffer.from(base.core), baseline.golden);
  const control = await complete(actual.capture); assert.deepEqual(Buffer.from(control.core), actual.golden);
  assert.equal(actual.golden.length, 4257);
  assert.equal(hash(actual.golden), 'sha256:0aa16711f6e4c4f8bf1cfe3a8046cd35b612dc16ae246e3f49d7ee2fb5d0608a');
  assert.equal(hash(actual.capture.response), 'sha256:39731f0843e60ee2283be99c1d8d250de5c4863dd4d437606dba53ff861b519f');
  t.diagnostic('both actual baseline/coalesce public cold/Core controls passed before negatives');
  /** @type {[string, ((q:any,p:any,o:any)=>void)][]} */
  const cases = [
    ['assignment operator', (q, p) => { body(p).value.operator = '??='; }],
    ['eager binary kind', (q, p) => { body(p).value.kind = 'binary'; }],
    ['write kind', (q, p) => { body(p).value.kind = 'write'; }],
    ['reverse operands', (q, p) => { const v = body(p).value; [v.left, v.right] = [v.right, v.left]; }],
    ['duplicate lhs as rhs', (q, p) => { body(p).value.right = copy(body(p).left); }],
    ['false lhs null flow', (q, p) => { body(p).left.presenceFlow.null = false; }],
    ['undefined lhs flow', (q, p) => { body(p).left.presenceFlow.undefined = true; }],
    ['nullable result flow', (q, p) => { body(p).value.presenceFlow.null = true; }],
    ['undefined result flow', (q, p) => { body(p).value.presenceFlow.undefined = true; }],
    ['forged rhs flow', (q, p) => { body(p).right.presenceFlow = { undefined: false, null: true }; }],
    ['wrong result payload', (q, p) => { body(p).value.type = 'f64'; }],
    ['wrong lhs payload', (q, p) => { body(p).left.type = 'f64'; }],
    ['wrong rhs payload', (q, p) => { body(p).right.type = 'f64'; }],
    ['rhs signature payload', (q, p) => { body(p).right.signature.parameters[0] = 'f64'; }],
    ['rhs signature presence', (q, p) => { body(p).right.signature.presence[0].null = true; }],
    ['rhs signature result', (q, p) => { body(p).right.signature.returnType = 'f64'; }],
    ['wrong rhs target', (q, p) => { body(p).right.target = body(p).entry.symbol; }],
    ['foreign same-spelled lhs', (q, p) => { body(p).left.symbol = body(p).fallback.parameters[0].id; }],
    ['wrong lhs caller binding', (q, p) => { body(p).left.symbol = body(p).coalesce.parameters[1].id; }],
    ['foreign rhs argument', (q, p) => { body(p).right.arguments[0].symbol = body(p).entry.parameters[0].id; }],
    ['whole range', (q, p) => { body(p).value.range.end--; }],
    ['lhs range', (q, p) => { body(p).left.range.start++; }],
    ['rhs range', (q, p) => { body(p).right.range.start++; }],
    ['forged coalesce field', (q, p) => { body(p).value.present = true; }],
    ['nullable exported ABI', (q, p) => {
      const entry = body(p).entry, parameter = entry.parameters[0]; parameter.presence.null = true;
      p.payload.facts.symbols.find(s => s.id === parameter.id).presence.null = true;
    }],
    ['mixed package family', (q, p) => { p.family = 'tsfg.generic-package'; }],
    ['old request version', q => { q.version = 1; }],
    ['old package version', (q, p) => { p.version = 1; }],
    ['old private schema', (q, p) => { q.schemaHash = v1Schema; p.schemaHash = v1Schema; }],
    ['source split question marks with repaired spans', (q, p) => {
      const source = q.input.files.find(f => f.path === q.input.rootFile), at = source.content.indexOf('??') + 1;
      assert.ok(at > 0); source.content = source.content.slice(0, at) + ' ' + source.content.slice(at);
      function shift(value) {
        if (!value || typeof value !== 'object') return;
        if (Number.isInteger(value.start) && Number.isInteger(value.end)) {
          if (value.start >= at) value.start++;
          if (value.end > at) value.end++;
        }
        for (const child of Object.values(value)) shift(child);
      }
      shift(p.payload.facts); shift(p.payload.exports); inputIdentity(q, p);
    }],
  ];
  await Promise.all(cases.map(([name, mutate]) => t.test(name, async sub => {
    const q = copy(actual.q), p = copy(actual.p), o = copy(actual.o), before = jcs([q, p, o]);
    mutate(q, p, o); assert.notEqual(jcs([q, p, o]), before, 'mutation must not be a no-op');
    const c = seal(q, p, o), originBefore = jcs(c.origin), bytePins = [hash(c.request), hash(c.response)];
    await reject(sub, () => complete(c));
    assert.equal(jcs(c.origin), originBefore); assert.deepEqual([hash(c.request), hash(c.response)], bytePins);
  })));

  const node = hir => {
    const found = hir.functions.find(fn => fn.name === 'coalesce')?.body[0]?.value;
    assert.equal(found?.kind, 'nullableCoalesce'); return found;
  };
  /** @type {[string, ((hir:any)=>void)][]} */
  const coldCases = [
    ['old typed node kind', hir => { node(hir).kind = 'shortCircuit'; }],
    ['unknown typed operator field', hir => { node(hir).operator = '??'; }],
    ['reverse typed operands', hir => { const value = node(hir); [value.left, value.right] = [value.right, value.left]; }],
    ['duplicate typed operand', hir => { node(hir).right = copy(node(hir).left); }],
    ['nullable typed result', hir => { node(hir).type = hir.functions.find(fn => fn.name === 'coalesce').parameters[0].type; }],
    ['foreign typed binding', hir => { node(hir).left.binding = hir.functions[0].parameters[0].id; }],
    ['forged typed signature hash', hir => { node(hir).right.signatureHash = hash('forged signature'); }],
    ['changed typed range', hir => { node(hir).range.start++; }],
    ['old HIR version', hir => { hir.format.version = 1; }],
    ['mixed HIR family', hir => { hir.format.family = 'tsfg.closure-hir-candidate'; }],
  ];
  await Promise.all(coldCases.map(([name, mutate]) => t.test(name, async sub => {
    const hir = copy(control.hir), before = jcs(hir); mutate(hir);
    assert.notEqual(jcs(hir), before, 'cold mutation must change a field');
    await reject(sub, () => verifyHir(hir));
    await reject(sub, () => readHir(Buffer.from(jcs(hir) + '\n')));
    await reject(sub, () => lowerHir(hir));
  })));
  await t.test('cold capture repaired through package origin and snapshot IDs', async sub => {
    const q = copy(actual.q), p = copy(actual.p), o = copy(actual.o); body(p).value.presenceFlow.null = true;
    const c = seal(q, p, o), snapshot = copy(control.snapshot); repairSnapshot(snapshot, q, p, c);
    assert.notEqual(snapshot.snapshotId, control.snapshot.snapshotId);
    await reject(sub, () => validateFrontendSnapshot(snapshot));
    const built = buildHir(snapshot); assert.equal(built.status, 'error');
    const hir = copy(control.hir); hir.snapshot = snapshot; hir.source = copy(snapshot.source); hir.inputIdentity = snapshot.inputIdentity;
    await reject(sub, () => verifyHir(hir)); await reject(sub, () => readHir(Buffer.from(jcs(hir) + '\n')));
  });
  assert.deepEqual(actual.bytes.map(hash), actual.pins); assert.deepEqual(baseline.bytes.map(hash), baseline.pins);
});

// This later top adds the three raw Go22200 captures that were absent when the
// negative-only top above was frozen. No re-enveloped or synthetic positives.
// Core observations are finite CFG/dataflow checks, not a general MLIR parser.
function observedFunction(core) {
  const start = core.indexOf('  func.func @"coalesce"('), end = core.indexOf('\n  }', start);
  assert.ok(start >= 0 && end > start); const lines = core.slice(start, end).split('\n');
  const parameters = [...lines[0].matchAll(/(%v\d+): (?:!tsfg_nullable\.i32<2>|i32)/g)].map(m => m[1]);
  const text = lines.slice(1).join('\n'), labels = [...text.matchAll(/^  \^(bb\d+)(?:\(([^)]*)\))?:$/gm)];
  const blocks = new Map([['entry', { parameters: '', text: text.slice(0, labels[0]?.index ?? text.length) }]]);
  for (const [index, label] of labels.entries()) blocks.set(label[1], { parameters: label[2] ?? '',
    text: text.slice(label.index + label[0].length, index + 1 < labels.length ? labels[index + 1].index : text.length) });
  assert.ok(blocks.size <= 8);
  const predecessors = new Map([...blocks.keys()].map(name => [name, []]));
  for (const [name, block] of blocks) {
    const conditional = block.text.match(/cf\.cond_br %v\d+, \^(bb\d+), \^(bb\d+)/);
    const direct = block.text.match(/cf\.br \^(bb\d+)/);
    const targets = conditional ? conditional.slice(1) : direct ? [direct[1]] : [];
    for (const target of targets) { assert.ok(predecessors.has(target)); predecessors.get(target).push(name); }
  }
  const dominators = new Map([...blocks.keys()].map(name => [name, new Set(name === 'entry' ? ['entry'] : blocks.keys())]));
  let changed = true, steps = 0;
  while (changed) {
    assert.ok(++steps <= blocks.size * blocks.size); changed = false;
    for (const name of blocks.keys()) if (name !== 'entry') {
      const incoming = predecessors.get(name); assert.ok(incoming.length > 0);
      const next = new Set([...dominators.get(incoming[0])].filter(value => incoming.every(from => dominators.get(from).has(value))));
      next.add(name);
      if (next.size !== dominators.get(name).size || [...next].some(value => !dominators.get(name).has(value))) { dominators.set(name, next); changed = true; }
    }
  }
  return { parameters, blocks, dominators };
}
const sourceAnchor = range => 'tsfg_source.start = ' + range.start + ' : i64, tsfg_source.end = ' + range.end + ' : i64';
function operationIn(graph, operation, range) {
  const found = [...graph.blocks].flatMap(([block, value]) => value.text.split('\n')
    .filter(line => line.includes('"' + operation + '"(') && line.includes(sourceAnchor(range))).map(line => ({ block, line })));
  assert.equal(found.length, 1, 'one original anchored ' + operation); return found[0];
}
function coalesceCfg(graph, raw) {
  const tag = operationIn(graph, 'tsfg_nullable.tag_test', raw.left.range);
  const tested = tag.line.match(/(%v\d+) = "tsfg_nullable\.tag_test"\((%v\d+)\)/); assert.ok(tested);
  assert.ok(tag.line.includes('tag = 0 : i32')); assert.ok(tag.line.endsWith('-> i1'));
  const conditional = graph.blocks.get(tag.block).text.match(/cf\.cond_br (%v\d+), \^(bb\d+), \^(bb\d+)/); assert.ok(conditional);
  assert.equal(conditional[1], tested[1]);
  const get = operationIn(graph, 'tsfg_nullable.get', raw.left.range);
  assert.equal(get.block, conditional[2]); assert.ok(get.line.includes('"tsfg_nullable.get"(' + tested[2] + ')'));
  const extracted = get.line.match(/(%v\d+) = /); assert.ok(extracted);
  const outgoing = [...graph.blocks].flatMap(([block, value]) => value.text.split('\n')
    .filter(line => line.includes('cf.br ') && line.includes(sourceAnchor(raw.range))).map(line => {
      const edge = line.match(/cf\.br \^(bb\d+)\((%v\d+) : i32\)/); assert.ok(edge);
      return { block, target: edge[1], value: edge[2] };
    }));
  assert.equal(outgoing.length, 2); assert.equal(outgoing[0].target, outgoing[1].target);
  const present = outgoing.find(edge => edge.block === get.block), absent = outgoing.find(edge => edge.block !== get.block);
  assert.ok(present); assert.ok(absent); assert.equal(present.value, extracted[1]);
  assert.ok(graph.dominators.get(absent.block).has(conditional[3]), 'fallback exit is dominated by the absent arm');
  const join = graph.blocks.get(present.target), phi = join.parameters.match(/^(%v\d+): i32$/); assert.ok(phi);
  return { tag, tested, get, present, absent, absentEntry: conditional[3], join: present.target, phi: phi[1] };
}

test('actual Go22200 reference lhs-call and nested coalesce retain one evaluation and real CFG exits', { concurrency: true }, async t => {
  /** @type {[string, string, string][]} */
  const cases = [
    ['referenceRhs', 'function coalesce(value: i32 | null, replacement: i32): i32 { return value ?? replacement; }\nexport function entry(value: i32): i32 { return coalesce(value, value); }', '777bf9494e8427d42d2f0ffc03e80576817af2ce025e265bff71b23926d3f6d7'],
    ['nullableCallLhs', 'function echo(value: i32 | null): i32 | null { return value; }\nfunction coalesce(value: i32 | null, replacement: i32): i32 { return echo(value) ?? replacement; }\nexport function entry(value: i32): i32 { return coalesce(value, value); }', '909f4dac0efda39e0e9b2498f0d311de6ed216a07d383d1d6587013054308ed6'],
    ['nestedCallArgument', 'function fallback(value: i32): i32 { return value; }\nfunction coalesce(value: i32 | null, other: i32 | null, replacement: i32): i32 { return value ?? fallback(other ?? replacement); }\nexport function entry(value: i32): i32 { return coalesce(value, value, value); }', '48fd4fa07d956af97a5771568b8bd49acd03e8627938cd7cf54063c88fbf0f71'],
  ];
  const records = new Map();
  await Promise.all(cases.map(([name, source, pin]) => t.test(name, async sub => {
    const directory = new URL('./fixtures/nullable-owned-coalesce/' + name.replace(/[A-Z]/g, char => '-' + char.toLowerCase()) + '/v2/', import.meta.url);
    const bytes = await Promise.all(['request.json', 'response.json', 'origin.json'].map(file => readFile(new URL(file, directory))));
    const pins = bytes.map(hash), [request, response, origin] = bytes;
    const q = JSON.parse(request.toString()), p = JSON.parse(response.toString()), o = JSON.parse(origin.toString());
    assert.equal(hash(response), 'sha256:' + pin);
    assert.equal(q.input.files.find(file => file.path === q.input.rootFile).content, source);
    assert.equal(q.version, 2); assert.equal(p.version, 2); assert.equal(q.schemaHash, schema); assert.equal(p.schemaHash, schema);
    const resealed = seal(copy(q), copy(p), copy(o));
    assert.deepEqual(resealed.request, request); assert.deepEqual(resealed.response, response); assert.deepEqual(resealed.origin, o);
    const refreshed = copy(p); inputIdentity(q, refreshed);
    assert.equal(refreshed.payload.inputIdentity, p.payload.inputIdentity); assert.deepEqual(refreshed.payload.files, p.payload.files);
    assert.equal(o.kind, 'owned-go-nullable-response'); assert.equal(o.producerBaseOid, 'e0bb12b15d073c2bdc42a834a5cb1fef6514c94e');
    assert.equal(o.producerDirty, true); assert.equal(o.testedInputSetHash, 'sha256:8689c2060135a54922a8edf7d974e2360607732ebb95335a22fc177f19bd5ef0');
    const result = await complete({ request, response, origin: o });
    const facts = p.payload.facts, fn = facts.functions.find(item => item.name === 'coalesce'), entry = facts.functions.find(item => item.name === 'entry');
    const entrySymbol = facts.symbols.find(item => item.id === entry.symbol);
    assert.deepEqual(p.payload.exports, [{ name: 'entry', target: entry.symbol, sourcePath: q.input.rootFile, range: entry.range, definition: entrySymbol.range }]);
    assert.equal(entry.returnType, 'i32'); assert.equal(entry.returnPresence, undefined);
    for (const parameter of entry.parameters) assert.deepEqual([parameter.presence.null, parameter.presence.undefined, parameter.presence.optional, parameter.presence.default], [false, false, false, false]);
    const raw = fn.body[0].expression, hirFn = result.hir.functions.find(item => item.name === 'coalesce');
    assert.equal(raw.kind, 'shortCircuit'); assert.equal(raw.operator, '??'); assert.equal(raw.type, 'i32');
    assert.deepEqual(raw.presenceFlow, { null: false, undefined: false });
    assert.equal(hirFn.body[0].value.kind, 'nullableCoalesce'); assert.deepEqual(hirFn.body[0].value.range, raw.range);
    assert.ok(result.core.includes('tsfg_core.source_hash = "' + hash(source) + '"'));
    assert.ok(result.core.includes('tsfg_core.source_length = ' + source.length + ' : i64'));
    const graph = observedFunction(result.core), outer = coalesceCfg(graph, raw);
    assert.ok(graph.blocks.get(outer.join).text.includes('"func.return"(' + outer.phi + ')'));
    const allOps = [...graph.blocks.values()].flatMap(block => [...block.text.matchAll(/"([^"]+)"\(/g)].map(match => match[1]));
    if (name === 'referenceRhs') {
      assert.equal(raw.left.symbol, fn.parameters[0].id); assert.equal(raw.right.symbol, fn.parameters[1].id);
      assert.equal(outer.tested[2], graph.parameters[0]); assert.equal(outer.absent.value, graph.parameters[1]);
      assert.deepEqual(allOps.filter(op => op === 'func.call'), []);
    } else if (name === 'nullableCallLhs') {
      const echo = facts.functions.find(item => item.name === 'echo');
      assert.equal(raw.left.kind, 'call'); assert.equal(raw.left.target, echo.symbol);
      assert.equal(raw.left.arguments.length, 1); assert.equal(raw.left.arguments[0].symbol, fn.parameters[0].id);
      assert.equal(raw.right.symbol, fn.parameters[1].id);
      const call = operationIn(graph, 'func.call', raw.left.range), callResult = call.line.match(/(%v\d+) = /); assert.ok(callResult);
      assert.ok(call.line.includes('callee = @"echo"')); assert.equal(outer.tested[2], callResult[1]);
      assert.ok(graph.dominators.get(outer.tag.block).has(call.block));
      if (call.block === outer.tag.block) assert.ok(graph.blocks.get(call.block).text.indexOf(call.line) < graph.blocks.get(call.block).text.indexOf(outer.tag.line));
      assert.equal(outer.absent.value, graph.parameters[1]); assert.equal(allOps.filter(op => op === 'func.call').length, 1);
    } else {
      assert.equal(raw.left.symbol, fn.parameters[0].id); assert.equal(raw.right.kind, 'call');
      const innerRaw = raw.right.arguments[0]; assert.equal(innerRaw.kind, 'shortCircuit'); assert.equal(innerRaw.operator, '??');
      assert.equal(innerRaw.left.symbol, fn.parameters[1].id); assert.equal(innerRaw.right.symbol, fn.parameters[2].id);
      const inner = coalesceCfg(graph, innerRaw), call = operationIn(graph, 'func.call', raw.right.range);
      const callResult = call.line.match(/(%v\d+) = "func.call"\((%v\d+)\)/); assert.ok(callResult);
      assert.ok(call.line.includes('callee = @"fallback"')); assert.equal(callResult[2], inner.phi);
      assert.equal(inner.tested[2], graph.parameters[1]); assert.equal(inner.absent.value, graph.parameters[2]);
      assert.equal(call.block, inner.join); assert.equal(outer.absent.block, inner.join);
      assert.notEqual(outer.absent.block, outer.absentEntry, 'outer edge comes from real nested exit');
      assert.ok(graph.dominators.get(inner.tag.block).has(outer.absentEntry));
      assert.ok(graph.dominators.get(call.block).has(outer.absentEntry));
      assert.equal(outer.absent.value, callResult[1]); assert.equal(allOps.filter(op => op === 'func.call').length, 1);
    }
    const count = name === 'nestedCallArgument' ? 2 : 1;
    assert.equal(allOps.filter(op => op === 'tsfg_nullable.tag_test').length, count);
    assert.equal(allOps.filter(op => op === 'tsfg_nullable.get').length, count);
    assert.deepEqual(bytes.map(hash), pins); records.set(name, { q, p, o });
    sub.diagnostic('actual named-Go package cold reconstruction and finite CFG/dataflow oracle passed');
  })));
  await t.test('lhs-call canonical raw start survives identity repair', async sub => {
    const record = records.get('nullableCallLhs'); assert.ok(record);
    const q = copy(record.q), p = copy(record.p), o = copy(record.o), left = body(p).left;
    assert.equal(left.kind, 'call'); assert.equal(left.range.start + 1, body(p).value.range.start);
    assert.equal(q.input.files[0].content[left.range.start], ' ');
    left.range.start++; const changed = seal(q, p, o);
    await reject(sub, () => complete(changed));
  });
});
