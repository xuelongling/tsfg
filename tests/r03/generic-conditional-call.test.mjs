// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeGenericPackage, encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, printGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';

// These fresh private7 records are matched to official Source output by this
// ticket's current-fixture-qualification.json. Identity literals were independently calculated from
// protocol preimages, without a production identity helper. The complete Core
// oracle is independently hand-worked for the current v1 identities and sorted
// four-function SSA, never current emitter output;
// this test grants no C++/SourceEXE/VM execution credit.
const rows = [{"key":"870a7e4275a1e26885be2f7d1bf2f1903939a431b739d034baf4afe142864149","definition":"687fa67b1f43e2e94aa1f8c5aeb8184422c54c2d40494746c7dd72c39b61831b","name":"route","scalar":"bool","argument":"boolean","signature":"sha256:176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395","functionId":"sha256:0c678a1261f7d0b2004fd8b38b79903bbeb93e2606b09af6b87fe8bcb8558c70"},{"key":"0affb79f50d524699f70197c0d24e5931384f609cd066e5bdafc535d7e46de33","definition":"849780ec99159f78393505e159003d11b694f6387149cadc1398deab4c2a8db1","name":"leaf","scalar":"bool","argument":"boolean","signature":"sha256:176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395","functionId":"sha256:7c64403e6b4f3d605864a32613ded019533b58a61412e493e3f1413a512feb3e"},{"key":"5d1a397612ee125a0005c4732300377432c8c33e9f6598a0970ecfe31adf8e0f","definition":"849780ec99159f78393505e159003d11b694f6387149cadc1398deab4c2a8db1","name":"leaf","scalar":"f64","argument":"number","signature":"sha256:f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059","functionId":"sha256:4d712635572d84b947dceba66f7a8c31a1256e066d7c2901f0de0b8fba02d3ae"},{"key":"fa5134d2098f61a3d151b5fc1628cb2e6a0b6deb6139b546a9a71e26565114f7","definition":"687fa67b1f43e2e94aa1f8c5aeb8184422c54c2d40494746c7dd72c39b61831b","name":"route","scalar":"f64","argument":"number","signature":"sha256:f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059","functionId":"sha256:2a7f241aefa7dcba146ec1041b987904f981b382d8c7f22be4b68cb86d50f621"}].sort((a,b)=>a.key < b.key ? -1 : 1);
const expectedPackageId = "sha256:0b30dfa460bbad343483bd383280de0e0af796cb47d69ba38ed311213a1cfd91";
const expectedInputId = "sha256:c11295c6044cace67f33292d49f9d768ee1f2025dd6112def1f26992973e4b39";
const expectedTarget = {"llvmDataLayout":"e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128","target":"windows-x86_64-msvc","triple":"x86_64-pc-windows-msvc"};
const expectedSource = "// 😀\nexport function leaf<U>(value: U extends boolean ? boolean : number): U extends boolean ? boolean : number { return value; }\nexport function route<T>(value: T extends boolean ? boolean : number): T extends boolean ? boolean : number { return leaf<T>(value); }";
const schema = '2e9d1e07016b6f8ce5f48bf8a3508491eaf1ce7e6fd43bf497c133f65c8dff94';
const profile = 'tsfg-owned-scalar-generics-host-v7';
const pins = [
  ['generic-conditional-call-package-v7.json', 3097, '6f8f9eb9b09f4c6aebdd647f0a9cec5d2f9cfc13a771b13325f0949189a9f4cf'],
  ['generic-conditional-call-instance-v7.json', 2722, 'e5d733e7ce89d55921d83aeb7532de91e5e1a1e116095aa53d4be28a1ce099b8'],
  ['generic-conditional-call.source.ts', 267, '0f7d41e4184bea4af390fd1e4671be1eee5847fc4fa092e95a39dbce55297fda'],
  ['generic-conditional-call.declaration.d.ts', 362, 'd629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141'],
  ['generic-conditional-call-core-v7.mlir', 4269, 'a52014b1ebe6ac85a7c5acae224b7f6142f312918599cfcdaef6bd2706d5fa06'],
];
/** @type {Record<string,string>} */
const scalarIds = {
  bool: 'sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721',
  f64: 'sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c',
};
const hash = value => createHash('sha256').update(value).digest('hex');
const fixture = name => readFile(new URL('./fixtures/' + name, import.meta.url));

test('actual private7 conditional calls preserve four cold functions and original SSA forwarding', async () => {
  const inputs = await Promise.all(pins.map(async ([name, length, sha]) => {
    const bytes = await fixture(name); assert.equal(bytes.length, length); assert.equal(hash(bytes), sha); return bytes;
  }));
  const [packageBytes, instanceBytes, sourceBytes, declarationBytes, coreOracle] = inputs;
  const pkg = decodeGenericPackage(packageBytes), record = JSON.parse(instanceBytes.toString('utf8'));
  const before = JSON.stringify({ pkg, record });
  assert.equal(pkg.version, 7); assert.equal(pkg.schemaHash, schema); assert.equal(pkg.packageId, expectedPackageId);
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
  assert.deepEqual(cold.format, { family: 'tsfg.generic-concrete-hir-candidate', version: 7,
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
