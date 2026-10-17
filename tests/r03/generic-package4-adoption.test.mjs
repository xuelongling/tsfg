// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeGenericPackage, encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, printGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';

// Pure Node composition only. Full Core goldens are byte-for-byte historical
// C++ stdin, not current producer output. Qualification: M14-mapped-signature-
// checks-20261017/product-final-qualification.json, SHA256
// 305a06e51ec8dc4336b61eb6c4cae727a804ddb4eec61a3f6dd47d69f67791e7,
// Cpp.calls selected by each exact qualifiedInput below; natural exit/close0,
// --canonicalize, stderr0. They grant no new native/Source/VM execution credit.
// The public lowerGenericHir adapter uses the current shared emitScalarCore.
/** @type {Record<string, any>} */
const cases = {
  "number-add": {"pins":[["generic-number-add-package-v4.json",1953,"f1b61efdad584c7c96992f3cc197ea06b43e43f9ad3419588dc9366e5d1d1d3f"],["generic-number-add-instance-v4.json",2020,"93dd1dc88fd6e996f38c87ee06584ed4d7808f5b7dc664ab1cf7b00342e11b49"],["generic-number-add.source.ts",92,"ca4815b1b71ef1e4921b01566d60eeb1b70751bb9a126b7b37d7f45454d16e44"],["generic-number-add.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"sum","definition":"6949104be61e0df1ff4e9b3b5997cdf24e4a5b2d1684f27b6e197a1024e847a5","packageId":"sha256:45cb2f669a07730f16cf49f4318f161a67eb5cbfb8b8b1e685cd3d4a9f7f3765","inputIdentity":"sha256:e873c2f118d74ba3ed82386a71a3af0aa38c1120cc702f2f33fd0183df8198c5","functionRange":{"end":90,"start":6},"parameters":[{"name":"left","range":{"end":41,"start":29}},{"name":"right","range":{"end":56,"start":43}}],"expressionRange":{"end":87,"start":75},"sourceLength":90,"witnesses":[{"argument":"number","key":"b1fbd79265cc14fe45b0c4a1e7d2db606a1e5ea5d2e732faedaa0a879f4f370c","id":"1c4440637fdfd3f2c5d57b0b027cdbfed55ff0833800f28321b4faf2fa54dcdb","scalar":"f64","signature":"3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585"},{"argument":"boolean","key":"ca829f92f91a4171479138b050e716fec32f4df7d397905fedd30e27264a9c9a","id":"a6ce3eaa2276fb6f2e00ddfe5c715f4b2f8405476e06f6da5e5bc462057b6cc3","scalar":"f64","signature":"3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585"}],"golden":{"file":"generic-package4-number-add-core.mlir","bytes":2291,"sha256":"51e62cbee98796735e4b4834a200749d1fc4c9b8f171dfa5ac66bb420acc6087","qualifiedInput":"E:/ws/pro_tsfg/.scratch/tsfg_r03/M14-mapped-signature-checks-20261017/product-regression-07-first-storage/0001/stdin.bin","historicalPid":16724}},
  "conditional-signature": {"pins":[["generic-conditional-signature-package-v4.json",2027,"d8ef3cd511bb22ce2a77305eeb94ab197fb2f626e4206e306339236f77439db5"],["generic-conditional-signature-instance-v4.json",1485,"828d23f2c18ce1d2f279e94e352b235e3dbf56f9ada026204e3825654046d8d6"],["generic-conditional-signature.source.ts",134,"b389353082b8f428ef3362e3a410b02e84b616da6947a5274945bb65be0a6a5b"],["generic-conditional-signature.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"select","definition":"70672415263a4e21029a43530815fda78ba93d267fb24f84bbef08985a4fd984","packageId":"sha256:13cce60a5162d89efd5dddb36e3ff004bb76d9e49d57c8101dc1fc87df18ddb6","inputIdentity":"sha256:80c24f2152eab37aca381205b0d42631a3ccf18a823a6f2087814af4993d6899","functionRange":{"end":132,"start":6},"parameters":[{"name":"value","range":{"end":75,"start":32}}],"expressionRange":{"end":129,"start":124},"sourceLength":132,"witnesses":[{"argument":"number","key":"06438b22b6c73a983b1da5ee95c3abf344aebe2cdf6fa0d98d966571f485b400","id":"b54cad4b3b69e37c7952b908ffd65934aada1d443d5dd29addb611514a6f1437","scalar":"f64","signature":"f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059"},{"argument":"boolean","key":"b910cbab6d7dd12e14b149efc8b978802cf73ccdbe1e69754f1ed98058a53872","id":"92812943eb6b13ae4216245b61534de78df9840df4b7c75ee233f2c0cd187576","scalar":"bool","signature":"176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395"}],"golden":{"file":"generic-package4-conditional-signature-core.mlir","bytes":2047,"sha256":"80fd8491f25ef6dd33d8c9b9bc55a67e4f985348c079a2488da8cea745cbcfab","qualifiedInput":"E:/ws/pro_tsfg/.scratch/tsfg_r03/M14-mapped-signature-checks-20261017/product-regression-08-first-storage/0001/stdin.bin","historicalPid":31088}},
  "mapped-signature": {"pins":[["generic-mapped-signature-package-v4.json",2108,"916ab2c407e848980f10f003da1b8f50a3be6e0f3b4c104c887f03f7db074e62"],["generic-mapped-signature-instance-v4.json",1485,"bb75431497371e1631fc8c36d742b507448747097e445e568699d4e941f71ec8"],["generic-mapped-signature.source.ts",122,"eae49419fbca1d64bc6c55bb871da4b0d6eb942bdcd8cf14dbb09da903d6c356"],["generic-mapped-signature.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"mapped","definition":"5f7c40d3b5a68019b9262784ee2c492648db154cfd5043a7bc5f9769ce5cb900","packageId":"sha256:1405e7ff5405de1bfcc14ea4046b06be6f3c5cd056f2914edfea00577685b2f0","inputIdentity":"sha256:065bea1e23101052334dc3701284d591ed231c2e9d4dc54147bf2802f4d68ae6","functionRange":{"end":120,"start":6},"parameters":[{"name":"value","range":{"end":69,"start":32}}],"expressionRange":{"end":117,"start":112},"sourceLength":120,"witnesses":[{"argument":"number","key":"34731cf328bf7b60ac3805c433f652492c54ed0da6e5e7336d3fd8915d4e8a0b","id":"12255ea1542ef2fbdcac07460e247ba9182d1810cbd2909d6835f8b09d8c0bef","scalar":"f64","signature":"f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059"},{"argument":"boolean","key":"c1c77cc0350c3014d0f9731c74c0d6a0d159ed976b6906fd6901ca6be88b9c0b","id":"d8946574e5760862f40381c7cec25045e4ba7e34ab8df912da0885646e63b265","scalar":"bool","signature":"176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395"}],"golden":{"file":"generic-package4-mapped-signature-core.mlir","bytes":2047,"sha256":"0373c1cb5c78f8ec1201318f9df13a70309adb7eb40294cd07332be8d54b0752","qualifiedInput":"E:/ws/pro_tsfg/.scratch/tsfg_r03/M14-mapped-signature-checks-20261017/product-mapped-full-positive-first-storage/0001/stdin.bin","historicalPid":10008}},
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const profile = 'tsfg-owned-scalar-generics-host-v4';
const schema = 'ec05631c15f280f54279ba9353fd8fc3ff779349a1f56f7cdb00eba22c767e20';
/** @type {Record<string, string>} */
const scalarIds = {
  bool: 'sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721',
  f64: 'sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c',
};
const fixture = name => readFile(new URL('./fixtures/' + name, import.meta.url));

for (const [family, expected] of Object.entries(cases)) test('package4 adoption preserves actual ' + family + ' facts through the current shared scalar emitter', async () => {
  const inputs = await Promise.all(expected.pins.map(async ([name, bytes, hash]) => {
    const value = await fixture(name); assert.equal(value.length, bytes); assert.equal(sha(value), hash); return value;
  }));
  const [packageBytes, instanceBytes, sourceBytes, declarationBytes] = inputs;
  const pkg = decodeGenericPackage(packageBytes), record = JSON.parse(instanceBytes.toString('utf8'));
  const before = JSON.stringify({ pkg, record }), source = sourceBytes.toString('utf8'), declaration = declarationBytes.toString('utf8');
  assert.equal(pkg.family, 'tsfg-owned-generic-package'); assert.equal(pkg.version, 4); assert.equal(pkg.schemaHash, schema);
  assert.equal(pkg.packageId, expected.packageId); assert.equal(pkg.payload.semanticProfile, profile);
  assert.equal(pkg.payload.scope, 'package:' + family);
  assert.deepEqual(pkg.payload.capabilities, ['conditional-signature', 'explicit-type-arguments', 'mapped-indexed-signature', 'number-add', 'scalar-generics', 'single-module']);
  assert.deepEqual(Buffer.from(encodeGenericPackage(pkg)), packageBytes);
  assert.equal(source.length, expected.sourceLength); assert.equal(source.slice(3, 5), '😀');
  assert.deepEqual(pkg.payload.source, { path: '/original/main.ts', digest: sha(sourceBytes), length: expected.sourceLength,
    positionUnit: 'utf16', surrogateStarts: [3] });
  assert.deepEqual(pkg.payload.environment, { profile: 'minimal-scalars-v2', files: [
    { path: '/original/minimal-scalars-v2.d.ts', digest: sha(declarationBytes), content: declaration }] });
  assert.equal(pkg.payload.definitions.length, 1); const definition = pkg.payload.definitions[0];
  assert.equal(definition.key, expected.definition); assert.equal(definition.name, expected.name);
  assert.deepEqual(definition.typeParameters, ['T']); assert.deepEqual(definition.origin, expected.functionRange);
  assert.deepEqual(record.requests, ['boolean', 'number'].map(kind => ({ definition: expected.definition, typeArguments: [{ kind, parameter: 0 }] })));
  assert.equal(record.result.instances.length, 2);
  assert.deepEqual(validateGenericInstanceResult(packageBytes, record.result, record.requests), record.result);
  const ordered = ['boolean', 'number'].map(kind => expected.witnesses.find(w => w.argument === kind));
  assert.deepEqual(record.result.roots, ordered.map(w => w.key));

  if (family === 'number-add') {
    assert.deepEqual(definition.parameters.map(p => p.type), [{ kind: 'number', parameter: 0 }, { kind: 'number', parameter: 0 }]);
    assert.deepEqual(definition.returnType, { kind: 'number', parameter: 0 }); assert.equal(definition.body.kind, 'number-add');
    assert.deepEqual(definition.body.arguments.map(a => [a.kind, a.parameter, a.origin]),
      [['parameter', 0, { start: 75, end: 79 }], ['parameter', 1, { start: 82, end: 87 }]]);
  } else {
    const signature = family === 'conditional-signature'
      ? { kind: 'conditional', parameter: 0, checkType: { kind: 'parameter', parameter: 0 }, extendsType: { kind: 'boolean', parameter: 0 },
        trueType: { kind: 'boolean', parameter: 0 }, falseType: { kind: 'number', parameter: 0 } }
      : { kind: 'indexed', parameter: 0, indexed: { object: { kind: 'mapped', parameter: 0, mapped: { binder: 'K',
        keys: { kind: 'string-literal', literals: ['value'] }, value: { kind: 'parameter', parameter: 0 } } },
        index: { kind: 'string-literal', literals: ['value'] } } };
    assert.deepEqual(definition.parameters[0].type, signature); assert.deepEqual(definition.returnType, signature);
    assert.equal(definition.body.kind, 'parameter'); assert.equal(definition.body.parameter, 0);
  }

  const hir = buildGenericHir(packageBytes, record.result, record.requests), text = printGenericHir(hir);
  const cold = readGenericHir(Buffer.from(text)); assert.deepEqual(verifyGenericHir(cold), hir); assert.equal(printGenericHir(cold), text);
  assert.deepEqual(cold.format, { family: 'tsfg.generic-concrete-hir-candidate', version: 4, linkageAlgorithm: 'tsfg.generic-linkage.v1', semanticProfile: profile });
  assert.deepEqual(cold.context, { packageId: expected.packageId, scope: 'package:' + family, semanticProfile: profile });
  assert.deepEqual(cold.source, pkg.payload.source); assert.equal(Object.hasOwn(cold.source, 'content'), false);
  assert.equal(cold.inputIdentity, expected.inputIdentity); assert.match(cold.inputIdentity, /^sha256:[0-9a-f]{64}$/);
  assert.equal(cold.functions.length, 2);
  for (const [index, witness] of expected.witnesses.entries()) {
    const fn = cold.functions[index], type = scalarIds[witness.scalar];
    assert.match(witness.id, /^[0-9a-f]{64}$/); assert.match(witness.key, /^[0-9a-f]{64}$/);
    const value = family === 'number-add'
      ? { kind: 'binary', operator: '+', type, range: expected.expressionRange,
        left: { kind: 'reference', binding: 'p0', type, range: { start: 75, end: 79 } },
        right: { kind: 'reference', binding: 'p1', type, range: { start: 82, end: 87 } } }
      : { kind: 'reference', binding: 'p0', type, range: expected.expressionRange };
    assert.deepEqual(fn, { id: 'sha256:' + witness.id, signatureHash: 'sha256:' + witness.signature,
      instanceKey: witness.key, definition: expected.definition, typeArguments: [{ kind: witness.argument, parameter: 0 }], name: expected.name,
      linkageName: '__tsfg_generic_v1_' + witness.key, range: expected.functionRange,
      returnType: { kind: 'scalar', name: witness.scalar, id: type },
      parameters: expected.parameters.map((parameter, position) => ({ id: 'p' + position, name: parameter.name, type, writable: true, range: parameter.range })),
      body: [{ kind: 'return', range: expected.expressionRange, value }] });
    assert.deepEqual(record.result.instances[index].parameters.map(p => p.type), Array(expected.parameters.length).fill(witness.scalar));
    assert.equal(record.result.instances[index].returnType, witness.scalar);
  }
  assert.deepEqual(cold.closure, { roots: ordered.map(w => 'sha256:' + w.id), functions: expected.witnesses.map(w => 'sha256:' + w.id).sort() });
  assert.equal(new Set(cold.functions.map(fn => fn.id)).size, 2);
  assert.equal(new Set(cold.functions.map(fn => fn.signatureHash)).size, family === 'number-add' ? 1 : 2);

  const golden = await fixture(expected.golden.file); assert.equal(golden.length, expected.golden.bytes); assert.equal(sha(golden), expected.golden.sha256);
  const core = lowerGenericHir(cold);
  assert.deepEqual(Buffer.from(core), golden, 'complete historical qualified stdin is the independent scalar Core golden');
  assert.equal(lowerGenericHir(readGenericHir(Buffer.from(text))), core);
  assert.equal(printGenericHir(cold), text); assert.equal(JSON.stringify({ pkg, record }), before);
  inputs.forEach((bytes, index) => assert.equal(sha(bytes), expected.pins[index][2]));
});
