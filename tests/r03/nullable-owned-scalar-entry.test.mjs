// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

// Root supplies actual private-command records and an independently worked Core
// oracle before this test runs. Missing records fail; no synthetic facts/skip.
// A predecessor origin/family rejection is an API boundary RED, not a new
// official nullable semantic failure. No SourceEXE/Core CLI/VM is invoked.
const fixture = new URL('./fixtures/nullable-owned/v3/', import.meta.url);
const schema = 'sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71';
const coreSchema = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
const source = '// 😀\nfunction echo(value: i32 | null): i32 | null { return value; }\n'
  + 'export function entry(value: i32): i32 { const result: i32 | null = echo(value); return value; }';
const path = '/src/main.ts';
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
/** @param {any} value @returns {string} */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? assert.fail('non-JSON identity preimage');
}
const span = (start, end) => ({ start, end });
const candidate = (domain, value) => hash(domain + '\0' + coreSchema + '\0' + canonical(value));
const nullableType = candidate('tsfg.core-nullable-candidate.type.v1',
  { kind: 'nullable-i32', undefined: false, null: true });
const scalarType = candidate('tsfg.core-nullable-candidate.type.v1', { kind: 'scalar', name: 'i32' });
function identity(name, type) {
  const signature = candidate('tsfg.core-nullable-candidate.signature.v1', { parameters: [type], returnType: type });
  return { signature, id: candidate('tsfg.core-nullable-candidate.function.v1',
    { name, signatureHash: signature, source: { path, digest: hash(source) } }) };
}
function anchor(line, start, end) {
  assert.ok(line.includes('tsfg_source.start = ' + start + ' : i64, tsfg_source.end = ' + end + ' : i64'));
}

// Full independent bytes constrain normalized types/SSA without inventing a
// private HIR body layout. The observable unread initializer must still call.
function checkCore(core) {
  assert.ok(core.includes('tsfg_core.nullable = {family = "tsfg.core-nullable-candidate"'));
  assert.ok(core.includes('schema = "' + coreSchema + '"'));
  assert.ok(core.includes('tsfg_core.source_hash = "' + hash(source) + '"'));
  assert.ok(core.includes('tsfg_core.source_path = "' + path + '"'));
  assert.ok(core.includes('tsfg_core.source_length = 165 : i64'));
  const functions = [...core.matchAll(/^ *func\.func @"([^"]+)"\(([^)]*)\) -> ([^\n]+?) attributes \{([^\n]+)\} \{\n([\s\S]*?)^ *\}/gm)];
  assert.deepEqual(functions.map(fn => fn[1]), ['echo', 'entry']);
  for (const fn of functions) {
    const internal = fn[1] === 'echo', type = internal ? nullableType : scalarType;
    const mlir = internal ? '!tsfg_nullable.i32<2>' : 'i32', expected = identity(fn[1], type);
    assert.equal(fn[2], '%v0: ' + mlir); assert.equal(fn[3], mlir);
    assert.ok(fn[4].includes('tsfg_core.function_id = "' + expected.id + '"'));
    assert.ok(fn[4].includes('tsfg_core.signature_hash = "' + expected.signature + '"'));
    assert.ok(fn[4].includes('tsfg_core.type_id = "' + type + '"'));
    assert.ok(fn[4].includes('tsfg_nullable.role = "' + (internal ? 'internal' : 'entry') + '"'));
    const operations = [...fn[5].matchAll(/"([^"]+)"\(/g)].map(match => match[1]);
    assert.deepEqual(operations, internal ? ['tsfg_core.fuel', 'func.return']
      : ['tsfg_core.fuel', 'tsfg_nullable.wrap_i32', 'func.call', 'func.return']);
    const returned = fn[5].split('\n').find(line => line.includes('"func.return"')); assert.ok(returned);
    assert.ok(returned.includes('"func.return"(%v0)'));
    assert.ok(returned.endsWith(': (' + mlir + ') -> ()'));
    anchor(returned, internal ? 52 : 149, internal ? 66 : 163);
    if (internal) continue;
    const wrap = fn[5].match(/(%v\d+) = "tsfg_nullable\.wrap_i32"\(%v0\)[^\n]+/); assert.ok(wrap);
    assert.ok(wrap[0].endsWith(': (i32) -> !tsfg_nullable.i32<2>'));
    const call = fn[5].match(/(%v\d+) = "func\.call"\((%v\d+)\)[^\n]+/); assert.ok(call);
    assert.equal(call[2], wrap[1]); assert.notEqual(call[1], '%v0');
    const callee = identity('echo', nullableType);
    assert.ok(call[0].includes('callee = @"echo"'));
    assert.ok(call[0].includes('tsfg_core.function_id = "' + callee.id + '"'));
    assert.ok(call[0].includes('tsfg_core.signature_hash = "' + callee.signature + '"'));
    assert.ok(call[0].endsWith(': (!tsfg_nullable.i32<2>) -> !tsfg_nullable.i32<2>'));
    anchor(call[0], 136, 148);
  }
}

test('actual private nullable scalar entry preserves official exports, unread call and cold Core SSA', async () => {
  const bytes = await Promise.all(['request.json', 'response.json', 'origin.json', 'expected.core.mlir']
    .map(name => readFile(new URL(name, fixture))));
  const before = bytes.map(hash), [requestBytes, responseBytes, originBytes, expectedCore] = bytes;
  const request = JSON.parse(requestBytes.toString('utf8')), response = JSON.parse(responseBytes.toString('utf8'));
  const origin = JSON.parse(originBytes.toString('utf8')), originBefore = canonical(origin);
  assert.deepEqual(Buffer.from(canonical(request)), requestBytes);
  assert.deepEqual(Buffer.from(canonical(response)), responseBytes);
  assert.deepEqual([request.family, request.version, request.schemaHash],
    ['tsfg.nullable-facts-request-candidate', 3, schema]);
  assert.deepEqual([response.family, response.version, response.schemaHash],
    ['tsfg.nullable-facts-package-candidate', 3, schema]);
  assert.equal(response.requestId, hash('tsfg.nullable-facts.request.v3\0' + requestBytes.toString('utf8')));
  assert.equal(response.packageId, hash('tsfg.nullable-facts.package.v3\0' + schema + '\0' + canonical(response.payload)));
  const input = request.input, facts = response.payload.facts;
  assert.equal(input.rootFile, path); assert.equal(source.length, 165);
  assert.equal(input.files.find(file => file.path === path)?.content, source);
  assert.deepEqual(input.declarations, { version: 'minimal-integers-v3', paths: ['/src/minimal-integers-v3.d.ts'] });
  assert.deepEqual(facts.inputs, [path, '/src/minimal-integers-v3.d.ts']);
  assert.equal(facts.status, 'ok'); assert.deepEqual(facts.functions.map(fn => fn.name), ['echo', 'entry']);
  const [echo, entry] = facts.functions;
  assert.deepEqual(response.payload.exports, [{ name: 'entry', target: entry.symbol, sourcePath: path,
    range: span(68, 165), definition: span(84, 90) }]);
  assert.notEqual(echo.symbol, entry.symbol);
  assert.deepEqual(echo.returnPresence, { undefined: false, null: true, range: span(0, 68), annotation: span(40, 50) });
  assert.equal(entry.returnPresence, undefined); assert.equal(entry.returnType, 'i32');
  assert.deepEqual(entry.body.map(statement => statement.kind), ['variable', 'return']);
  const local = entry.body[0], call = local.initializer;
  assert.equal(local.symbol.name, 'result'); assert.equal(local.symbol.writable, false);
  assert.equal(local.symbol.presence.null, true); assert.equal(local.symbol.presence.undefined, false);
  assert.equal(call.kind, 'call'); assert.equal(call.target, echo.symbol); assert.deepEqual(call.range, span(136, 148));
  assert.equal(call.arguments.length, 1); assert.equal(call.arguments[0].symbol, entry.parameters[0].id);
  assert.deepEqual(call.arguments[0].range, span(142, 147));
  assert.deepEqual(call.presenceFlow, { undefined: false, null: true });
  assert.equal(entry.body[1].expression.symbol, entry.parameters[0].id);
  assert.notEqual(entry.body[1].expression.symbol, local.symbol.id);
  assert.equal(origin.kind, 'owned-go-nullable-response'); assert.equal(origin.producerDirty, true);
  assert.equal(origin.producerBaseOid, 'b6e156608803b08c4f62f258487484b1656e8213');
  assert.equal(origin.requestSha256, hash(requestBytes)); assert.equal(origin.responseSha256, hash(responseBytes));
  assert.match(origin.testedInputSetHash, /^sha256:[0-9a-f]{64}$/);

  const imported = await importCapturedFrontendResponse(requestBytes, responseBytes, origin);
  assert.equal(imported.status, 'ok', JSON.stringify(imported));
  const snapshot = imported.snapshot; validateFrontendSnapshot(snapshot);
  assert.equal(snapshot.format.family, 'tsfg.frontend-nullable-candidate'); assert.equal(snapshot.format.version, 3);
  const built = buildHir(snapshot); assert.equal(built.status, 'ok', JSON.stringify(built));
  const hir = verifyHir(built.hir);
  assert.equal(hir.format.family, 'tsfg.nullable-hir-candidate'); assert.equal(hir.format.version, 3);
  const printed = printHir(hir), cold = readHir(Buffer.from(printed));
  assert.deepEqual(verifyHir(cold), hir); assert.equal(printHir(cold), printed);
  const core = lowerHir(cold); checkCore(core);
  assert.deepEqual(Buffer.from(core), expectedCore, 'complete independent Core oracle retains typed wrap, unread call and original scalar return');
  assert.equal(lowerHir(readHir(Buffer.from(printed))), core);
  assert.equal(canonical(origin), originBefore); assert.deepEqual(bytes.map(hash), before);
});
