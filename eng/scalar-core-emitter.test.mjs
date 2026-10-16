// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lowerHir, verifyHir, printHir, readHir } from '../compiler/hir.mjs';
import { buildGenericHir, lowerGenericHir, genericCoreFormat, printGenericHir, readGenericHir } from '../compiler/generic-hir.mjs';
import { scalarCoreFixtures } from './scalar-core-emitter-fixtures.mjs';
import registry from '../contracts/registry.json' with { type: 'json' };

const fixtures = scalarCoreFixtures();
const packageBytes = new Uint8Array(await readFile(new URL('../tests/r03/fixtures/generic-package-source-v1.json', import.meta.url)));
const instanceFixture = JSON.parse(await readFile(new URL('../tests/r03/fixtures/generic-instance-source-v1.json', import.meta.url), 'utf8'));
const candidate = () => buildGenericHir(packageBytes, instanceFixture.result, instanceFixture.requests);
for (const fixture of fixtures) {
  test('shared scalar emitter retains ordinary cold representation: ' + fixture.name, () => {
    const hir = verifyHir(fixture.hir), before = structuredClone(fixture.hir);
    const text = lowerHir(hir);
    assert.equal(text, lowerHir(readHir(new TextEncoder().encode(printHir(hir)))));
    assert.match(text, /tsfg_core\.version = "0\.8\.0"/);
    assert.ok(text.includes('tsfg_core.bytecode_schema = "' + registry['tsfg.bytecode'].schemaHash + '"'));
    assert.ok(text.includes('tsfg_core.source_length = ' + hir.source.content.length + ' : i64'));
    assert.ok(text.includes('tsfg_core.source_hash = "' + hir.source.hash + '"'));
    assert.doesNotMatch(text, /undefined|unadopted:|generic-concrete-core-candidate/);
    assert.equal(text.at(-1), '\n'); assert.deepEqual(fixture.hir, before);
  });
}
test('ordinary typed calls and bool branches retain explicit operands and target identities', () => {
  const hir = fixtures[0].hir, text = lowerHir(hir), pass = hir.functions[0];
  assert.match(text, /func\.func @"pass"\(%v0: f64\) -> f64/);
  assert.match(text, /func\.func @"entry"\(%v0: i1, %v1: f64\) -> f64/);
  assert.match(text, /"func\.call"\(%v1\).*callee = @"pass".*: \(f64\) -> f64/);
  assert.ok(text.includes('tsfg_core.function_id = "' + pass.id + '"'));
  assert.match(text, /cf\.cond_br/); assert.match(text, /"func\.return".*: \(f64\) -> \(\)/);
});
test('ordinary loops and short circuit keep typed CFG arguments and logical fuel', () => {
  const loop = lowerHir(fixtures[1].hir), short = lowerHir(fixtures[2].hir);
  assert.match(loop, /event = 1 : i32/); assert.match(loop, /event = 2 : i32/);
  assert.match(loop, /\^bb\d+\(%v\d+: i32, %v\d+: i32\)/);
  assert.match(loop, /"tsfg_core\.add"/); assert.match(loop, /cf\.br/);
  assert.match(short, /cf\.cond_br/); assert.match(short, /\^bb\d+\(%v\d+: i1\)/);
  assert.doesNotMatch(short, /"tsfg_core\.(?:and|or)"|undefined/);
});
test('ordinary module view retains lifecycle tables and stable emitted symbols', () => {
  const hir = fixtures[3].hir, text = lowerHir(hir);
  for (const name of ['sources', 'modules', 'globals', 'hosts', 'roots', 'initialization'])
    assert.ok(text.includes('tsfg_core.' + name + ' = '));
  for (const fn of hir.functions) assert.ok(text.includes('func.func @"f' + fn.id.slice(7) + '"'));
  assert.match(text, /tsfg_core\.logical_name = "\$moduleInit"/);
  assert.match(text, /tsfg_core\.initializer = true/);
  assert.equal((text.match(/event = 1 : i32/g) ?? []).length, 2);
});
test('real generic Source facts emit candidate SSA with explicit unadopted exchange identity', () => {
  const hir = candidate(), before = printGenericHir(hir), text = lowerGenericHir(hir);
  assert.equal(genericCoreFormat.version, 'tsfg.generic-concrete-core-candidate.v1');
  assert.equal(genericCoreFormat.bytecodeSchema, 'unadopted:tsfg.generic-concrete-core-candidate.v1');
  assert.ok(text.includes('tsfg_core.version = "' + genericCoreFormat.version + '"'));
  assert.ok(text.includes('tsfg_core.bytecode_schema = "' + genericCoreFormat.bytecodeSchema + '"'));
  assert.doesNotMatch(text, /tsfg_core\.version = "0\.8\.0"/);
  assert.ok(!text.includes(registry['tsfg.bytecode'].schemaHash));
  assert.ok(text.includes('tsfg_core.source_path = "' + hir.source.path + '"'));
  assert.ok(text.includes('tsfg_core.source_hash = "sha256:' + hir.source.digest + '"'));
  assert.ok(text.includes('tsfg_core.source_length = ' + hir.source.length + ' : i64'));
  assert.equal(Object.hasOwn(hir.source, 'content'), false);
  assert.doesNotMatch(text, /undefined|tsfg_core\.modules =|\$moduleInit/);
  assert.equal(printGenericHir(hir), before);
});
test('candidate cold round trip emits identical SSA with all original instance linkages', () => {
  const hir = candidate(), text = lowerGenericHir(hir);
  const cold = readGenericHir(new TextEncoder().encode(printGenericHir(hir)));
  assert.equal(lowerGenericHir(cold), text);
  for (const fn of hir.functions) {
    assert.ok(text.includes('func.func @"' + fn.linkageName + '"'));
    assert.ok(text.includes('tsfg_core.function_id = "' + fn.id + '"'));
    assert.ok(text.includes('tsfg_core.function_start = ' + fn.range.start + ' : i64'));
    const value = fn.body[0].value;
    assert.ok(text.includes('tsfg_source.start = ' + value.range.start + ' : i64, tsfg_source.end = ' + value.range.end + ' : i64'));
    if (value.kind === 'call') {
      const callee = hir.functions.find(item => item.id === value.target);
      assert.ok(text.includes('callee = @"' + callee.linkageName + '"'));
    }
  }
  assert.match(text, /"func\.call"/);
  assert.ok(text.includes(' -> i1')); assert.ok(text.includes(' -> f64'));
  assert.equal((text.match(/func\.func @/g) ?? []).length, hir.functions.length);
});
test('public lowerings retain their own verifier boundary and reject mixed representations', () => {
  assert.throws(() => lowerHir(candidate()), /r03-hir-invalid/);
  assert.throws(() => lowerGenericHir(fixtures[0].hir), /generic-hir-schema/);
  const invalid = structuredClone(candidate()); invalid.functions[0].linkageName += 'changed';
  assert.throws(() => lowerGenericHir(invalid), /generic-hir-identity/);
  const ordinary = structuredClone(fixtures[0].hir); ordinary.source.hash = 'sha256:' + '0'.repeat(64);
  assert.throws(() => lowerHir(ordinary), /r03-hir-invalid/);
});
