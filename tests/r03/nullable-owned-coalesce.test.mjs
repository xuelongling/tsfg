// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

// Actual Go30428 v3 captures and independently fixed Core text. A missing v3
// boundary is mechanical API/version RED; only the later ?? refusal is semantic.
// This tracer imports no executable and grants no native/VM/side-effect credit.
const schema = 'sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71';
const coreSchema = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
const sourcePath = '/src/main.ts';
const source = 'function fallback(value: i32): i32 { return value; }\n'
  + 'function coalesce(value: i32 | null, replacement: i32): i32 { return value ?? fallback(replacement); }\n'
  + 'export function entry(value: i32): i32 { return coalesce(value, value); }';
const baselineSource = '// 😀\nfunction echo(value: i32 | null): i32 | null { return value; }\n'
  + 'export function entry(value: i32): i32 { const result: i32 | null = echo(value); return value; }';
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? assert.fail('non-JSON identity');
}
const span = (start, end) => ({ start, end });
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
const candidate = (domain, value) => hash(domain + '\0' + coreSchema + '\0' + jcs(value));
const scalar = candidate('tsfg.core-nullable-candidate.type.v1', { kind: 'scalar', name: 'i32' });
const nullable = candidate('tsfg.core-nullable-candidate.type.v1', { kind: 'nullable-i32', undefined: false, null: true });
function identity(name, parameterTypes, returnType, text) {
  const signature = candidate('tsfg.core-nullable-candidate.signature.v1', { parameters: parameterTypes, returnType });
  return { signature, id: candidate('tsfg.core-nullable-candidate.function.v1',
    { name, signatureHash: signature, source: { path: sourcePath, digest: hash(text) } }) };
}
async function captured(name, text, responseHash, goldenHash, goldenBytes) {
  const directory = new URL('./fixtures/' + name + '/v3/', import.meta.url);
  const bytes = await Promise.all(['request.json', 'response.json', 'origin.json', 'expected.core.mlir']
    .map(file => readFile(new URL(file, directory))));
  const before = bytes.map(hash), [requestBytes, responseBytes, originBytes, golden] = bytes;
  const request = JSON.parse(requestBytes.toString('utf8')), packet = JSON.parse(responseBytes.toString('utf8'));
  const origin = JSON.parse(originBytes.toString('utf8')), originBefore = jcs(origin);
  for (const [value, raw] of [[request, requestBytes], [packet, responseBytes], [origin, originBytes]])
    assert.deepEqual(Buffer.from(jcs(value)), raw, 'actual fixture uses exact JCS');
  keys(request, ['family', 'version', 'schemaHash', 'input']);
  keys(packet, ['family', 'version', 'schemaHash', 'requestId', 'packageId', 'payload']);
  keys(packet.payload, ['inputIdentity', 'files', 'facts', 'exports']);
  assert.deepEqual([request.family, request.version, request.schemaHash], ['tsfg.nullable-facts-request-candidate', 3, schema]);
  assert.deepEqual([packet.family, packet.version, packet.schemaHash], ['tsfg.nullable-facts-package-candidate', 3, schema]);
  assert.equal(packet.requestId, hash('tsfg.nullable-facts.request.v3\0' + requestBytes.toString('utf8')));
  assert.equal(packet.packageId, hash('tsfg.nullable-facts.package.v3\0' + schema + '\0' + jcs(packet.payload)));
  assert.equal(hash(responseBytes), responseHash); assert.equal(hash(golden), goldenHash); assert.equal(golden.length, goldenBytes);
  const input = request.input;
  assert.equal(input.rootFile, sourcePath); assert.equal(input.sourceRoot, '/src');
  assert.equal(input.files.find(file => file.path === sourcePath)?.content, text);
  assert.deepEqual(input.declarations, { version: 'minimal-integers-v3', paths: ['/src/minimal-integers-v3.d.ts'] });
  assert.deepEqual(input.config, { strict: true, noEmit: true, allowJs: false });
  const files = input.files.map(file => ({ path: file.path, content: file.content }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  assert.equal(files.length, 2);
  assert.equal(packet.payload.inputIdentity, hash(jcs({ ...input, files })));
  assert.deepEqual(packet.payload.files, files.map(file => ({ path: file.path, digest: hash(file.content),
    byteLength: Buffer.byteLength(file.content), length: file.content.length, positionUnit: 'utf16' })));
  assert.deepEqual(packet.payload.facts.inputs, files.map(file => file.path));
  assert.equal(packet.payload.facts.status, 'ok');
  keys(origin, ['kind', 'producerBaseOid', 'producerDirty', 'requestSha256', 'responseSha256', 'testedInputSetHash']);
  assert.equal(origin.kind, 'owned-go-nullable-response'); assert.equal(origin.producerDirty, true);
  assert.equal(origin.producerBaseOid, 'b6e156608803b08c4f62f258487484b1656e8213');
  assert.equal(origin.testedInputSetHash, 'sha256:6535cdfbee610b7e32fce13ef139b813fe45cec161b17ed7563386828b224b4d');
  assert.equal(origin.requestSha256, hash(requestBytes)); assert.equal(origin.responseSha256, hash(responseBytes));
  return { requestBytes, responseBytes, origin, originBefore, bytes, before, golden, packet, text };
}
async function coldCore(record) {
  const imported = await importCapturedFrontendResponse(record.requestBytes, record.responseBytes, record.origin);
  assert.equal(imported.status, 'ok', JSON.stringify(imported));
  const snapshot = JSON.parse(jcs(imported.snapshot)); validateFrontendSnapshot(snapshot);
  assert.deepEqual(snapshot.format, { family: 'tsfg.frontend-nullable-candidate', version: 3, schemaHash: schema });
  assert.equal(snapshot.inputIdentity, record.packet.payload.inputIdentity);
  const built = buildHir(snapshot); assert.equal(built.status, 'ok', JSON.stringify(built));
  const hir = verifyHir(built.hir);
  assert.deepEqual(hir.format, { family: 'tsfg.nullable-hir-candidate', version: 3, schemaHash: schema });
  const printed = printHir(hir), cold = readHir(Buffer.from(printed));
  assert.deepEqual(verifyHir(cold), hir); assert.equal(printHir(cold), printed);
  const core = lowerHir(cold);
  assert.deepEqual(Buffer.from(core), record.golden, 'complete bytes equal the independently fixed oracle');
  assert.equal(lowerHir(readHir(Buffer.from(printed))), core);
  assert.equal(jcs(record.origin), record.originBefore); assert.deepEqual(record.bytes.map(hash), record.before);
  assert.ok(core.includes('tsfg_core.version = "0.9.0"'));
  assert.ok(core.includes('schema = "' + coreSchema + '"'));
  return { hir: cold, core };
}
function coalesceFacts(packet) {
  const facts = packet.payload.facts;
  assert.deepEqual(facts.functions.map(fn => fn.name), ['fallback', 'coalesce', 'entry']);
  assert.equal(facts.symbols.length, 7); assert.equal(new Set(facts.symbols.map(s => s.id)).size, 7);
  const [fallback, coalesce, entry] = facts.functions;
  assert.deepEqual(facts.functions.map(fn => fn.parameters.length), [1, 2, 1]);
  assert.deepEqual(packet.payload.exports, [{ name: 'entry', target: entry.symbol, sourcePath,
    range: span(155, 229), definition: span(171, 177) }]);
  assert.equal(entry.returnPresence, undefined); assert.equal(entry.returnType, 'i32');
  for (const p of entry.parameters) assert.deepEqual([p.presence.undefined, p.presence.null, p.presence.optional, p.presence.default], [false, false, false, false]);
  assert.deepEqual(coalesce.body.map(item => item.kind), ['return']);
  const value = coalesce.body[0].expression;
  keys(value, ['kind', 'operator', 'type', 'range', 'left', 'right', 'presenceFlow']);
  assert.deepEqual([value.kind, value.operator, value.type], ['shortCircuit', '??', 'i32']);
  assert.deepEqual(value.range, span(122, 152)); assert.deepEqual(value.presenceFlow, { undefined: false, null: false });
  keys(value.left, ['kind', 'type', 'symbol', 'range', 'presenceFlow']);
  assert.deepEqual([value.left.kind, value.left.type, value.left.symbol], ['reference', 'i32', coalesce.parameters[0].id]);
  assert.deepEqual(value.left.range, span(122, 127)); assert.deepEqual(value.left.presenceFlow, { undefined: false, null: true });
  keys(value.right, ['kind', 'type', 'target', 'signature', 'arguments', 'range']);
  assert.deepEqual([value.right.kind, value.right.type, value.right.target], ['call', 'i32', fallback.symbol]);
  assert.deepEqual(value.right.range, span(130, 152)); assert.equal(value.right.arguments.length, 1);
  const argument = value.right.arguments[0];
  assert.deepEqual([argument.kind, argument.type, argument.symbol], ['reference', 'i32', coalesce.parameters[1].id]);
  assert.deepEqual(argument.range, span(140, 151)); assert.equal(argument.presenceFlow, undefined);
  assert.deepEqual(value.right.signature.parameters, ['i32']); assert.equal(value.right.signature.returnType, 'i32');
  assert.deepEqual(value.right.signature.presence, [fallback.parameters[0].presence]);
  assert.equal(value.right.signature.returnPresence, undefined);
  const call = entry.body[0].expression;
  assert.deepEqual([call.kind, call.type, call.target], ['call', 'i32', coalesce.symbol]);
  assert.deepEqual(call.range, span(203, 226));
  assert.deepEqual(call.arguments.map(a => [a.kind, a.symbol, a.type]),
    [['reference', entry.parameters[0].id, 'i32'], ['reference', entry.parameters[0].id, 'i32']]);
  assert.deepEqual(call.arguments.map(a => a.range), [span(213, 218), span(219, 225)]);
  assert.deepEqual(call.signature.presence, coalesce.parameters.map(p => p.presence));
}
function typedCoalesce(hir) {
  const [fallback, coalesce, entry] = hir.functions;
  assert.deepEqual(hir.functions.map(fn => fn.name), ['fallback', 'coalesce', 'entry']);
  for (const [fn, parameters] of [[fallback, [scalar]], [coalesce, [nullable, scalar]], [entry, [scalar]]]) {
    const expected = identity(fn.name, parameters, scalar, source);
    assert.equal(fn.id, expected.id); assert.equal(fn.signatureHash, expected.signature);
    assert.equal(fn.returnType.id, scalar); assert.deepEqual(fn.parameters.map(p => p.type), parameters);
  }
  assert.deepEqual(coalesce.body.map(item => item.kind), ['return']);
  const value = coalesce.body[0].value;
  keys(value, ['kind', 'left', 'right', 'type', 'range']);
  assert.equal(value.kind, 'nullableCoalesce'); assert.equal(value.type, scalar); assert.deepEqual(value.range, span(122, 152));
  assert.equal(value.left.kind, 'reference'); assert.equal(value.left.type, nullable);
  assert.equal(value.left.binding, coalesce.parameters[0].id); assert.deepEqual(value.left.range, span(122, 127));
  assert.equal(value.right.kind, 'call'); assert.equal(value.right.type, scalar); assert.equal(value.right.target, fallback.id);
  assert.equal(value.right.signatureHash, fallback.signatureHash); assert.deepEqual(value.right.range, span(130, 152));
  assert.equal(value.right.arguments.length, 1); const arg = value.right.arguments[0];
  assert.equal(arg.kind, 'reference'); assert.equal(arg.binding, coalesce.parameters[1].id); assert.equal(arg.type, scalar);
  assert.deepEqual(arg.range, span(140, 151));
}
function lazyCore(core) {
  const functions = [...core.matchAll(/^ *func\.func @"([^"]+)"\([^\n]*\) -> [^\n]+ attributes \{[^\n]+\} \{\n([\s\S]*?)^  \}/gm)];
  assert.deepEqual(functions.map(fn => fn[1]), ['fallback', 'coalesce', 'entry']);
  const body = functions[1][2], labels = [...body.matchAll(/^  \^(\w+)(?:\(([^)]*)\))?:$/gm)];
  assert.equal(labels.length, 3);
  const tag = body.match(/(%v\d+) = "tsfg_nullable\.tag_test"\((%v\d+)\)[^\n]+/); assert.ok(tag);
  assert.equal(tag[2], '%v0'); assert.ok(tag[0].includes('tag = 0 : i32')); assert.ok(tag[0].endsWith('-> i1'));
  const branch = body.match(/cf\.cond_br (%v\d+), \^(\w+), \^(\w+)/); assert.ok(branch); assert.equal(branch[1], tag[1]);
  assert.equal(labels[0][1], branch[2]); assert.equal(labels[1][1], branch[3]);
  const block = index => body.slice(labels[index].index + labels[index][0].length,
    index + 1 < labels.length ? labels[index + 1].index : body.length);
  const before = body.slice(0, labels[0].index), present = block(0), absent = block(1), join = block(2);
  assert.ok(!before.includes('"func.call"') && !before.includes('"tsfg_nullable.get"'));
  assert.ok(!present.includes('"func.call"')); assert.ok(!absent.includes('"tsfg_nullable.get"'));
  const get = present.match(/(%v\d+) = "tsfg_nullable\.get"\((%v\d+)\)/); assert.ok(get); assert.equal(get[2], tag[2]);
  const call = absent.match(/(%v\d+) = "func\.call"\(%v1\)[^\n]+/); assert.ok(call); assert.ok(call[0].includes('callee = @"fallback"'));
  const yes = present.match(/cf\.br \^(\w+)\((%v\d+) : i32\)/), no = absent.match(/cf\.br \^(\w+)\((%v\d+) : i32\)/);
  assert.ok(yes); assert.ok(no); assert.equal(yes[1], labels[2][1]); assert.equal(no[1], labels[2][1]);
  assert.equal(yes[2], get[1]); assert.equal(no[2], call[1]);
  const phi = labels[2][2]?.match(/^(%v\d+): i32$/); assert.ok(phi);
  assert.ok(join.includes('"func.return"(' + phi[1] + ')')); assert.ok(!join.includes('"func.call"') && !join.includes('"tsfg_nullable.get"'));
  const ops = [...body.matchAll(/"([^"]+)"\(/g)].map(match => match[1]);
  assert.deepEqual(ops, ['tsfg_core.fuel', 'tsfg_nullable.tag_test', 'tsfg_nullable.get', 'func.call', 'func.return']);
}

test('actual v3 nullable baseline then coalesce preserve cold HIR and lazy typed Core', async t => {
  const baseline = await captured('nullable-owned', baselineSource,
    'sha256:ff2c46d2a7e82d005bf7bdef86a4916b0f914b73e6393eaf92b11a41e4129af2',
    'sha256:86bd8b568f2d703058093de2f0db3a71a982feede0978db6e006d4a96336e48b', 2708);
  const oldFacts = baseline.packet.payload.facts, [echo, entry] = oldFacts.functions;
  assert.deepEqual(oldFacts.functions.map(fn => fn.name), ['echo', 'entry']);
  assert.deepEqual(baseline.packet.payload.exports, [{ name: 'entry', target: entry.symbol, sourcePath,
    range: span(68, 165), definition: span(84, 90) }]);
  assert.deepEqual(entry.body.map(item => item.kind), ['variable', 'return']);
  assert.equal(entry.body[0].initializer.target, echo.symbol);
  assert.equal(entry.body[1].expression.symbol, entry.parameters[0].id);
  assert.notEqual(entry.body[1].expression.symbol, entry.body[0].symbol.id);
  await coldCore(baseline); t.diagnostic('actual v3 baseline cold/Core full2708 passed before coalesce');

  const actual = await captured('nullable-owned-coalesce', source,
    'sha256:7a23b4f53cf8625e802ef5d7cd7c8e0a3b3b78af9f1a46c58dda3a3a2d75951f',
    'sha256:0aa16711f6e4c4f8bf1cfe3a8046cd35b612dc16ae246e3f49d7ee2fb5d0608a', 4257);
  assert.equal(hash(source), 'sha256:7a250e785ef05abe46da6f8fe4953c9f50305c6d8090086f3af02f8a71552d94');
  assert.equal(source.length, 229); assert.equal(actual.responseBytes.length, 5259);
  assert.equal(actual.golden.toString('utf8').split('\n').length - 1, 25);
  coalesceFacts(actual.packet);
  const result = await coldCore(actual); typedCoalesce(result.hir); lazyCore(result.core);
  assert.deepEqual(actual.bytes.map(hash), actual.before);
});
