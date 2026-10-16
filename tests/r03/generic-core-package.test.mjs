// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { lowerGenericHir } from '../../compiler/generic-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';
import { scalarCoreFixtures } from '../../eng/scalar-core-emitter-fixtures.mjs';
import { officialHir, structuralClosure, extraNativeFunction } from './generic-core-package-fixtures.mjs';
import { invokeCore, accepted, rejected } from './generic-core-package-capture.mjs';
import { readPacket, rehashPacket } from './generic-core-package-wire.mjs';

// Agreed public seam: cold owned HIR -> unique scalar emitter -> real Core CLI
// -> complete independent R04 reader. No SourceEXE/VM/native inspector is called.
async function compiled(input) {
  const first = await invokeCore(input); accepted(first);
  const second = await invokeCore(first.stdout); accepted(second);
  assert.deepEqual(second.stdout, first.stdout, 'canonical printing is stable');
  const emission = await invokeCore(first.stdout, '--emit-bytecode'); accepted(emission);
  return { canonical: first.stdout.toString('utf8'), bytes: emission.stdout, wire: readPacket(emission.stdout) };
}
async function official() { return compiled(lowerGenericHir(officialHir())); }

test('qualified owned response cold HIR uses the real same-version scalar Core and full R04', async () => {
  const hir = officialHir(), result = await compiled(lowerGenericHir(hir));
  assert.equal(result.wire.functions.length, 6);
  assert.equal(result.wire.sourcePath, hir.source.path);
  assert.equal(result.wire.sourceHash, hir.source.digest);
  assert.deepEqual(result.wire.functions.map(fn => 'sha256:' + fn.id), hir.functions.map(fn => fn.id));
  assert.deepEqual(result.wire.functions.map(fn => [fn.start, fn.end]), hir.functions.map(fn => [fn.range.start, fn.range.end]));
  assert.equal(result.wire.functions.filter(fn => fn.instructions.some(op => op.opcode === 27)).length, 2);
});

test('ordinary owned HIR uses that same consumer and retains bool/f64 branching and calls', async () => {
  const ordinary = scalarCoreFixtures()[0].hir;
  const result = await compiled(lowerHir(ordinary));
  assert.equal(result.wire.functions.length, 2);
  assert.ok(result.wire.functions.some(fn => fn.result === 13));
  assert.ok(result.wire.functions.some(fn => fn.instructions.some(op => op.opcode === 25)));
});

for (const count of [256, 257, 512]) test('complete structural concrete closure retains ' + count + ' functions and its colon path', async () => {
  const hir = structuralClosure(count), result = await compiled(lowerGenericHir(hir));
  assert.equal(result.wire.functions.length, count);
  assert.equal(result.wire.sourcePath, '/structural/owned:scalar.ts');
  assert.deepEqual(result.wire.functions.map(fn => 'sha256:' + fn.id), hir.functions.map(fn => fn.id));
  const calls = result.wire.functions.flatMap(fn => fn.instructions.filter(op => op.opcode === 27));
  assert.ok(calls.length > 0);
  if (count === 512) assert.ok(calls.some(op => op.immediate > 255), 'u16 high function indices survive');
});

test('native Core rejects513 without truncating an otherwise complete512 closure', async () => {
  const hir = structuralClosure(512), core = lowerGenericHir(hir);
  const closing = core.lastIndexOf('}');
  const input = core.slice(0, closing) + extraNativeFunction(hir.source.path) + '\n' + core.slice(closing);
  rejected(await invokeCore(input, '--emit-bytecode'));
});

test('actual Core rejects old or mixed exchange version and schema identities', async () => {
  const { canonical } = await official();
  const cases = [canonical.replace('tsfg_core.version = "0.9.0"', 'tsfg_core.version = "0.8.0"'),
    canonical.replace(/tsfg_core.bytecode_schema = "sha256:[0-9a-f]{64}"/, 'tsfg_core.bytecode_schema = "sha256:' + '0'.repeat(64) + '"')];
  for (const input of cases) { assert.notEqual(input, canonical); rejected(await invokeCore(input, '--emit-bytecode')); }
});

test('actual Core rejects malformed logical paths and invalid UTF8 before packet output', async () => {
  const { canonical } = await official();
  for (const source of ['/bad/../main.ts', '/bad/./main.ts', '/bad//main.ts', '/bad\\main.ts', '/bad/\0main.ts']) {
    const input = canonical.replace(/tsfg_core.source_path = "[^"]*"/, 'tsfg_core.source_path = ' + JSON.stringify(source));
    assert.notEqual(input, canonical); rejected(await invokeCore(input, '--emit-bytecode'));
  }
  const invalid = canonical.replace(/tsfg_core.source_path = "[^"]*"/, 'tsfg_core.source_path = "/bad/\\FF.ts"');
  rejected(await invokeCore(invalid, '--emit-bytecode'));
});

test('actual Core rejects missing callee and forged call signature instead of emitting a partial packet', async () => {
  const { canonical } = await official();
  const missing = canonical.replace(/callee = @(?:"[^"]+"|[A-Za-z0-9_.$-]+)/, 'callee = @"missing"');
  assert.notEqual(missing, canonical); rejected(await invokeCore(missing, '--emit-bytecode'));
  const line = canonical.split('\n').find(value => value.includes('"func.call"'));
  const forged = line.replace(/tsfg_core.signature_hash = "sha256:[0-9a-f]{64}"/, 'tsfg_core.signature_hash = "sha256:' + '0'.repeat(64) + '"');
  assert.notEqual(forged, line);
  rejected(await invokeCore(canonical.replace(line, forged), '--emit-bytecode'));
});

test('independent R04 reader rejects truncation and trailing records even with repaired length/integrity', async () => {
  const { bytes } = await official();
  assert.throws(() => readPacket(bytes.subarray(0, 79)));
  assert.throws(() => readPacket(rehashPacket(bytes.subarray(0, bytes.length - 1))));
  assert.throws(() => readPacket(rehashPacket(Buffer.concat([bytes, Buffer.from([0])]))));
  const mixed = Buffer.from(bytes); mixed.writeUInt32LE(8, 8);
  assert.throws(() => readPacket(mixed));
});
