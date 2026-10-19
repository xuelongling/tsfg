// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeGenericPackage, encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, printGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';

// These are fresh private6 records from the passing Source35864 named case,
// captured after official diagnostics and source-free cold import. Identity literals were independently calculated from
// protocol preimages, without a production identity helper. The complete Core
// oracle is independently hand-worked for the current v1 identities and sorted
// four-function SSA, never current emitter output;
// this test grants no C++/SourceEXE/VM execution credit.
const rows = [{"key":"01fa351467cb0fb5b922a792ec099e003c24e875c3245821f55f8cb106c4db0a","definition":"687fa67b1f43e2e94aa1f8c5aeb8184422c54c2d40494746c7dd72c39b61831b","name":"route","scalar":"bool","argument":"boolean","signature":"sha256:176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395","functionId":"sha256:e2819d092fa44772c9b7224b1e03fc172a7720b282ebe3cf84a9527b57cf9153"},{"key":"1f6fa4533dba0058c46b98124e95ebc13b727bc9dd34f13e0bc1716ac106e092","definition":"849780ec99159f78393505e159003d11b694f6387149cadc1398deab4c2a8db1","name":"leaf","scalar":"bool","argument":"boolean","signature":"sha256:176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395","functionId":"sha256:d8582cf60ce1603b959dfd4f27811afc7192e17a1a8f7ac5ccfd3eb8251e8c18"},{"key":"921ab4589cb37e8e438939c6a01f0868e6653080306599398efc82391a681575","definition":"849780ec99159f78393505e159003d11b694f6387149cadc1398deab4c2a8db1","name":"leaf","scalar":"f64","argument":"number","signature":"sha256:f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059","functionId":"sha256:bba01dbd434bdbefb3819ba78de8fe16c77cb052ac7f6d985672064c10778d0a"},{"key":"980850427745740acd76bef8a2c710435975d9865ea066428ed4a0b72d62dcb2","definition":"687fa67b1f43e2e94aa1f8c5aeb8184422c54c2d40494746c7dd72c39b61831b","name":"route","scalar":"f64","argument":"number","signature":"sha256:f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059","functionId":"sha256:845f0988a21203796fdeaf9f4853c431658587288a16f5075a767dc1c9020104"}];
const expectedPackageId = "sha256:4189655c791bbe9d93ef5bfd3bb6bb988350d06d697a4795b5e00ae79a441f7b";
const expectedInputId = "sha256:5deb63d61e7328ca2c64df7f3f8c1ce64cb0c0f39cbcfc2b95914c1ebc9c6fd0";
const expectedTarget = {"llvmDataLayout":"e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128","target":"windows-x86_64-msvc","triple":"x86_64-pc-windows-msvc"};
const expectedSource = "// 😀\nexport function leaf<U>(value: U extends boolean ? boolean : number): U extends boolean ? boolean : number { return value; }\nexport function route<T>(value: T extends boolean ? boolean : number): T extends boolean ? boolean : number { return leaf<T>(value); }";
const schema = 'c6b6baa76be25f6ac4f619867273208c9adb595030f12e7c54a200ed8c677789';
const profile = 'tsfg-owned-scalar-generics-host-v6';
const pins = [
  ['generic-conditional-call-package-v6.json', 3097, '6600f1e9f20865e4e2abc92a3f281fa8dd18b1766d9ac848b21193ebedbbc35f'],
  ['generic-conditional-call-instance-v6.json', 2722, '644cec181a838ab74daa98ca6945afa4403ea53dc94cca2dea6609dd61a8d303'],
  ['generic-conditional-call.source.ts', 267, '0f7d41e4184bea4af390fd1e4671be1eee5847fc4fa092e95a39dbce55297fda'],
  ['generic-conditional-call.declaration.d.ts', 362, 'd629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141'],
  ['generic-conditional-call-core-v6.mlir', 4268, '3675f0f5e91d6403a088ce5bb5228781994acf067e54aaee09d08d467d249d6d'],
];
/** @type {Record<string,string>} */
const scalarIds = {
  bool: 'sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721',
  f64: 'sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c',
};
const hash = value => createHash('sha256').update(value).digest('hex');
const fixture = name => readFile(new URL('./fixtures/' + name, import.meta.url));

test('actual private6 conditional calls preserve four cold functions and original SSA forwarding', async () => {
  const inputs = await Promise.all(pins.map(async ([name, length, sha]) => {
    const bytes = await fixture(name); assert.equal(bytes.length, length); assert.equal(hash(bytes), sha); return bytes;
  }));
  const [packageBytes, instanceBytes, sourceBytes, declarationBytes, coreOracle] = inputs;
  const pkg = decodeGenericPackage(packageBytes), record = JSON.parse(instanceBytes.toString('utf8'));
  const before = JSON.stringify({ pkg, record });
  assert.equal(pkg.version, 6); assert.equal(pkg.schemaHash, schema); assert.equal(pkg.packageId, expectedPackageId);
  assert.equal(pkg.payload.semanticProfile, profile); assert.equal(pkg.payload.scope, 'package:conditional-call');
  assert.deepEqual(pkg.payload.capabilities, ['conditional-generic-call', 'conditional-signature', 'explicit-type-arguments',
    'mapped-indexed-generic-call', 'mapped-indexed-signature', 'number-add', 'scalar-generics', 'single-module']);
  assert.deepEqual(Buffer.from(encodeGenericPackage(pkg)), packageBytes);
  assert.equal(sourceBytes.toString('utf8'), expectedSource); assert.equal(expectedSource.length, 265);
  assert.deepEqual(pkg.payload.source, { path: '/original/main.ts', digest: pins[2][2], length: 265,
    positionUnit: 'utf16', surrogateStarts: [3] });
  assert.deepEqual(pkg.payload.environment, { profile: 'minimal-scalars-v2', files: [{
    path: '/original/minimal-scalars-v2.d.ts', digest: pins[3][2], content: declarationBytes.toString('utf8') }] });
  const conditional = { kind: 'conditional', parameter: 0, checkType: { kind: 'parameter', parameter: 0 },
    extendsType: { kind: 'boolean', parameter: 0 }, trueType: { kind: 'boolean', parameter: 0 },
    falseType: { kind: 'number', parameter: 0 } };
  assert.equal(pkg.payload.definitions.length, 2);
  for (const name of ['leaf', 'route']) {
    const def = pkg.payload.definitions.find(d => d.name === name); assert.ok(def);
    const leaf = name === 'leaf', witness = rows.find(r => r.name === name); assert.ok(witness);
    assert.equal(def.key, witness.definition); assert.equal(def.exported, true);
    assert.deepEqual(def.typeParameters, [leaf ? 'U' : 'T']);
    assert.deepEqual(def.origin, leaf ? { start: 6, end: 130 } : { start: 131, end: 265 });
    assert.deepEqual(def.parameters, [{ name: 'value', type: conditional,
      origin: leaf ? { start: 30, end: 73 } : { start: 156, end: 199 } }]);
    assert.deepEqual(def.returnType, conditional);
  }
  const routeRow = rows.find(r => r.name === 'route'); assert.ok(routeRow);
  const routeDefinition = routeRow.definition;
  assert.deepEqual(record.requests, ['boolean', 'number'].map(kind =>
    ({ definition: routeDefinition, typeArguments: [{ kind, parameter: 0 }] })));
  assert.deepEqual(validateGenericInstanceResult(packageBytes, record.result, record.requests), record.result);
  assert.equal(record.result.instances.length, 4);
  assert.deepEqual(record.result.roots, rows.filter(r => r.name === 'route').map(r => r.key));
  assert.deepEqual(record.result.instances.map(i => i.key), rows.map(r => r.key));

  const hir = buildGenericHir(packageBytes, record.result, record.requests), text = printGenericHir(hir);
  const cold = readGenericHir(Buffer.from(text)); assert.deepEqual(verifyGenericHir(cold), hir);
  assert.equal(printGenericHir(cold), text);
  assert.deepEqual(cold.format, { family: 'tsfg.generic-concrete-hir-candidate', version: 6,
    linkageAlgorithm: 'tsfg.generic-linkage.v1', semanticProfile: profile });
  assert.deepEqual(cold.context, { packageId: expectedPackageId, scope: 'package:conditional-call', semanticProfile: profile });
  assert.deepEqual(cold.source, pkg.payload.source); assert.equal(Object.hasOwn(cold.source, 'content'), false);
  assert.deepEqual(cold.target, expectedTarget); assert.equal(cold.inputIdentity, expectedInputId);
  assert.equal(cold.functions.length, 4);
  for (const [index, row] of rows.entries()) {
    const fn = cold.functions[index], type = scalarIds[row.scalar], leaf = row.name === 'leaf';
    const target = rows.find(r => r.name === 'leaf' && r.scalar === row.scalar); assert.ok(target);
    const range = leaf ? { start: 6, end: 130 } : { start: 131, end: 265 };
    const bodyRange = leaf ? { start: 122, end: 127 } : { start: 248, end: 262 };
    const argument = { kind: 'reference', binding: 'p0', type,
      range: leaf ? bodyRange : { start: 256, end: 261 } };
    const value = leaf ? argument : { kind: 'call', target: target.functionId, signatureHash: target.signature,
      type, arguments: [argument], range: bodyRange };
    assert.deepEqual(fn, { id: row.functionId, signatureHash: row.signature, instanceKey: row.key,
      definition: row.definition, typeArguments: [{ kind: row.argument, parameter: 0 }], name: row.name,
      linkageName: '__tsfg_generic_v1_' + row.key, range, returnType: { kind: 'scalar', name: row.scalar, id: type },
      parameters: [{ id: 'p0', name: 'value', type, writable: true,
        range: leaf ? { start: 30, end: 73 } : { start: 156, end: 199 } }],
      body: [{ kind: 'return', range: bodyRange, value }] });
    assert.equal(row.signature, 'sha256:' + hash('tsfg.signature\0(' + row.scalar + ')->' + row.scalar));
    assert.equal(row.functionId, 'sha256:' + hash('tsfg.function\0/original/main.ts\0__tsfg_generic_v1_'
      + row.key + '\0' + row.signature.slice(7)));
  }
  assert.deepEqual(cold.closure, { roots: rows.filter(r => r.name === 'route').map(r => r.functionId),
    functions: rows.map(r => r.functionId).sort() });
  assert.equal(new Set(cold.functions.map(fn => fn.id)).size, 4);
  assert.equal(new Set(cold.functions.map(fn => fn.signatureHash)).size, 2);
  const core = lowerGenericHir(cold);
  assert.deepEqual(Buffer.from(core), coreOracle, 'complete hand-worked call(p0) -> leaf -> return SSA example');
  assert.equal((core.match(/"func.call"/g) ?? []).length, 2);
  assert.equal((core.match(/"func.return"/g) ?? []).length, 4);
  assert.equal((core.match(/"tsfg_core.fuel"/g) ?? []).length, 4);
  assert.equal(lowerGenericHir(readGenericHir(Buffer.from(text))), core);
  assert.equal(JSON.stringify({ pkg, record }), before);
  inputs.forEach((bytes, index) => assert.equal(hash(bytes), pins[index][2]));
});
