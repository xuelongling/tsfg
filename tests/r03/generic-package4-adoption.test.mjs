// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeGenericPackage, encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, printGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';

// Pure Node composition only. Full Core goldens are byte-for-byte historical
// C++ stdin, not current producer output. Only five identity slots and complete
// function-block order are migrated to v5; this grants no v5 C++ qualification.
// Qualification: M14-mapped-signature-
// checks-20261017/product-final-qualification.json, SHA256
// 305a06e51ec8dc4336b61eb6c4cae727a804ddb4eec61a3f6dd47d69f67791e7,
// Cpp.calls selected by each exact qualifiedInput below; natural exit/close0,
// --canonicalize, stderr0. They grant no new native/Source/VM execution credit.
// The public lowerGenericHir adapter uses the current shared emitScalarCore.
/** @type {Record<string, any>} */
const cases = {
  "number-add": {"pins":[["generic-number-add-package-v5.json",1980,"1fbd8ffb22f5aa9c392a8242618c5118cde1664080a49c91f217c542e954f82e"],["generic-number-add-instance-v5.json",2020,"400bf0dd1bd02d4966304f87c106bfe1fe554b7b26ca079fbc6b1cb005c5d646"],["generic-number-add.source.ts",92,"ca4815b1b71ef1e4921b01566d60eeb1b70751bb9a126b7b37d7f45454d16e44"],["generic-number-add.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"sum","definition":"6949104be61e0df1ff4e9b3b5997cdf24e4a5b2d1684f27b6e197a1024e847a5","packageId":"sha256:45cb2f669a07730f16cf49f4318f161a67eb5cbfb8b8b1e685cd3d4a9f7f3765","inputIdentity":"sha256:e873c2f118d74ba3ed82386a71a3af0aa38c1120cc702f2f33fd0183df8198c5","functionRange":{"end":90,"start":6},"parameters":[{"name":"left","range":{"end":41,"start":29}},{"name":"right","range":{"end":56,"start":43}}],"expressionRange":{"end":87,"start":75},"sourceLength":90,"witnesses":[{"argument":"number","key":"b1fbd79265cc14fe45b0c4a1e7d2db606a1e5ea5d2e732faedaa0a879f4f370c","id":"1c4440637fdfd3f2c5d57b0b027cdbfed55ff0833800f28321b4faf2fa54dcdb","scalar":"f64","signature":"3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585"},{"argument":"boolean","key":"ca829f92f91a4171479138b050e716fec32f4df7d397905fedd30e27264a9c9a","id":"a6ce3eaa2276fb6f2e00ddfe5c715f4b2f8405476e06f6da5e5bc462057b6cc3","scalar":"f64","signature":"3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585"}],"golden":{"file":"generic-package4-number-add-core.mlir","bytes":2291,"sha256":"51e62cbee98796735e4b4834a200749d1fc4c9b8f171dfa5ac66bb420acc6087","qualifiedInput":"E:/ws/pro_tsfg/.scratch/tsfg_r03/M14-mapped-signature-checks-20261017/product-regression-07-first-storage/0001/stdin.bin","historicalPid":16724}},
  "conditional-signature": {"pins":[["generic-conditional-signature-package-v5.json",2054,"58f348d4f70c3984203675e3ff094816d7893b4ddc7a71a18f6db7847f688e22"],["generic-conditional-signature-instance-v5.json",1485,"9f130144b540b6cffbcdb38bfad1e355c8e7b195848902c4df7ed76358f2be04"],["generic-conditional-signature.source.ts",134,"b389353082b8f428ef3362e3a410b02e84b616da6947a5274945bb65be0a6a5b"],["generic-conditional-signature.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"select","definition":"70672415263a4e21029a43530815fda78ba93d267fb24f84bbef08985a4fd984","packageId":"sha256:13cce60a5162d89efd5dddb36e3ff004bb76d9e49d57c8101dc1fc87df18ddb6","inputIdentity":"sha256:80c24f2152eab37aca381205b0d42631a3ccf18a823a6f2087814af4993d6899","functionRange":{"end":132,"start":6},"parameters":[{"name":"value","range":{"end":75,"start":32}}],"expressionRange":{"end":129,"start":124},"sourceLength":132,"witnesses":[{"argument":"number","key":"06438b22b6c73a983b1da5ee95c3abf344aebe2cdf6fa0d98d966571f485b400","id":"b54cad4b3b69e37c7952b908ffd65934aada1d443d5dd29addb611514a6f1437","scalar":"f64","signature":"f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059"},{"argument":"boolean","key":"b910cbab6d7dd12e14b149efc8b978802cf73ccdbe1e69754f1ed98058a53872","id":"92812943eb6b13ae4216245b61534de78df9840df4b7c75ee233f2c0cd187576","scalar":"bool","signature":"176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395"}],"golden":{"file":"generic-package4-conditional-signature-core.mlir","bytes":2047,"sha256":"80fd8491f25ef6dd33d8c9b9bc55a67e4f985348c079a2488da8cea745cbcfab","qualifiedInput":"E:/ws/pro_tsfg/.scratch/tsfg_r03/M14-mapped-signature-checks-20261017/product-regression-08-first-storage/0001/stdin.bin","historicalPid":31088}},
  "mapped-signature": {"pins":[["generic-mapped-signature-package-v5.json",2135,"010b20dc9dbdbca958e9dc57be302edb5e7dac8b190921f7a92eecbd472b19d4"],["generic-mapped-signature-instance-v5.json",1485,"92e908e14aa37a55db70e750f34d0c31bfb646ab56f5c6ff3d3e7f7a44c51f1f"],["generic-mapped-signature.source.ts",122,"eae49419fbca1d64bc6c55bb871da4b0d6eb942bdcd8cf14dbb09da903d6c356"],["generic-mapped-signature.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"mapped","definition":"5f7c40d3b5a68019b9262784ee2c492648db154cfd5043a7bc5f9769ce5cb900","packageId":"sha256:1405e7ff5405de1bfcc14ea4046b06be6f3c5cd056f2914edfea00577685b2f0","inputIdentity":"sha256:065bea1e23101052334dc3701284d591ed231c2e9d4dc54147bf2802f4d68ae6","functionRange":{"end":120,"start":6},"parameters":[{"name":"value","range":{"end":69,"start":32}}],"expressionRange":{"end":117,"start":112},"sourceLength":120,"witnesses":[{"argument":"number","key":"34731cf328bf7b60ac3805c433f652492c54ed0da6e5e7336d3fd8915d4e8a0b","id":"12255ea1542ef2fbdcac07460e247ba9182d1810cbd2909d6835f8b09d8c0bef","scalar":"f64","signature":"f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059"},{"argument":"boolean","key":"c1c77cc0350c3014d0f9731c74c0d6a0d159ed976b6906fd6901ca6be88b9c0b","id":"d8946574e5760862f40381c7cec25045e4ba7e34ab8df912da0885646e63b265","scalar":"bool","signature":"176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395"}],"golden":{"file":"generic-package4-mapped-signature-core.mlir","bytes":2047,"sha256":"0373c1cb5c78f8ec1201318f9df13a70309adb7eb40294cd07332be8d54b0752","qualifiedInput":"E:/ws/pro_tsfg/.scratch/tsfg_r03/M14-mapped-signature-checks-20261017/product-mapped-full-positive-first-storage/0001/stdin.bin","historicalPid":10008}},
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const profile = 'tsfg-owned-scalar-generics-host-v5';
const schema = 'da7eb72ae306eb88863a44c945df77d572a96443a005fefbd787267fe90658bf';
/** @type {Record<string, string>} */
const scalarIds = {
  bool: 'sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721',
  f64: 'sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c',
};
const fixture = name => readFile(new URL('./fixtures/' + name, import.meta.url));

// These identities follow the versioned protocol, independently of the
// Product identity helpers and of any current emitter output.
/** @param {any} value @returns {string} */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? assert.fail('non-JSON identity input');
}
const target = { target: 'windows-x86_64-msvc', triple: 'x86_64-pc-windows-msvc',
  llvmDataLayout: 'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128' };
/** @param {string} definition @param {any} typeArguments */
const pair = (definition, typeArguments) => canonical({ definition, typeArguments });
/** @param {any} previous @param {any} pkg @param {any} record */
function independentIdentities(previous, pkg, record) {
  const payload = pkg.payload, packageId = 'sha256:' + sha('tsfg-owned-generic-package/v5\n' + canonical(payload));
  assert.equal(pkg.packageId, packageId);
  const definition = sha('tsfg:generic-definition:v1\n' + canonical({ name: previous.name,
    origin: previous.functionRange, scope: payload.scope, source: payload.source }));
  assert.equal(definition, previous.definition);
  const oldWitnesses = /** @type {Array<any>} */ (previous.witnesses);
  const witnesses = oldWitnesses.map(old => {
    const typeArguments = [{ kind: old.argument, parameter: 0 }];
    const key = sha('tsfg:generic-instance:v1\n' + canonical({ definition, graphDigest: packageId.slice(7),
      scope: payload.scope, semanticProfile: profile, typeArguments }));
    const parameterTypes = Array(previous.parameters.length).fill(old.scalar);
    const signature = sha('tsfg.signature\0(' + parameterTypes.join(',') + ')->' + old.scalar);
    assert.equal(signature, old.signature);
    const linkage = '__tsfg_generic_v1_' + key;
    const id = sha('tsfg.function\0' + payload.source.path + '\0' + linkage + '\0' + signature);
    return { ...old, definition, typeArguments, key, id, signature };
  }).sort((a, b) => a.key < b.key ? -1 : 1);
  const byRequest = new Map(witnesses.map(w => [pair(w.definition, w.typeArguments), w]));
  assert.equal(byRequest.size, 2);
  const requests = /** @type {Array<any>} */ (record.requests);
  const roots = requests.map(request => {
    const witness = byRequest.get(pair(request.definition, request.typeArguments));
    assert.ok(witness); return witness.key;
  });
  assert.deepEqual(record.result.roots, roots);
  const instances = /** @type {Array<any>} */ (record.result.instances);
  assert.deepEqual(instances.map(instance => instance.key), witnesses.map(w => w.key));
  const context = { packageId, scope: payload.scope, semanticProfile: profile };
  const inputIdentity = 'sha256:' + sha('tsfg:generic-concrete-hir-input:v1\n'
    + canonical({ context, roots, target, source: payload.source }));
  return { ...previous, packageId, inputIdentity, witnesses };
}

/** @param {string} text @param {string} from @param {string} to */
function replaceOne(text, from, to) {
  assert.equal(text.split(from).length, 2, 'identity slot occurs exactly once');
  return text.replace(from, to);
}
// A finite two-function text transplant, not an MLIR parser. The qualified v4
// bytes remain the oracle for every nonidentity byte, including SSA/whitespace.
/** @param {Buffer} golden @param {any} previous @param {any} expected */
function migrateGolden(golden, previous, expected) {
  const text = golden.toString('utf8');
  const blocks = [...text.matchAll(/^  func\.func [^\n]+\n[\s\S]*?^  }\n/gm)].map(match => match[0]);
  assert.equal(blocks.length, 2);
  const header = text.slice(0, text.indexOf(blocks[0])), tail = text.slice(header.length + blocks.join('').length);
  assert.equal(header + blocks.join('') + tail, text); assert.equal(tail, '}\n');
  assert.equal((text.match(/tsfg_core\.input_identity = "sha256:[0-9a-f]{64}"/g) ?? []).length, 1);
  assert.equal((text.match(/@"__tsfg_generic_v1_[0-9a-f]{64}"/g) ?? []).length, 2);
  assert.equal((text.match(/tsfg_core\.function_id = "sha256:[0-9a-f]{64}"/g) ?? []).length, 2);
  const witnesses = /** @type {Array<any>} */ (expected.witnesses);
  const current = new Map(witnesses.map(w => [pair(w.definition, w.typeArguments), w]));
  const oldWitnesses = /** @type {Array<any>} */ (previous.witnesses);
  const changed = oldWitnesses.map(old => {
    const witness = current.get(pair(previous.definition, [{ kind: old.argument, parameter: 0 }]));
    assert.ok(witness);
    const symbol = '@"__tsfg_generic_v1_' + old.key + '"';
    const matches = blocks.filter(block => block.startsWith('  func.func ' + symbol + '('));
    assert.equal(matches.length, 1);
    let block = replaceOne(matches[0], symbol, '@"__tsfg_generic_v1_' + witness.key + '"');
    block = replaceOne(block, 'tsfg_core.function_id = "sha256:' + old.id + '"',
      'tsfg_core.function_id = "sha256:' + witness.id + '"');
    return { key: witness.key, block };
  }).sort((a, b) => a.key < b.key ? -1 : 1);
  const changedHeader = replaceOne(header, 'tsfg_core.input_identity = "' + previous.inputIdentity + '"',
    'tsfg_core.input_identity = "' + expected.inputIdentity + '"');
  const result = Buffer.from(changedHeader + changed.map(item => item.block).join('') + tail);
  assert.equal(result.length, golden.length); return result;
}

for (const [family, previous] of Object.entries(cases)) test('package5 composition preserves actual ' + family + ' facts through the current shared scalar emitter', async () => {
  const inputs = await Promise.all(previous.pins.map(async ([name, bytes, hash]) => {
    const value = await fixture(name); assert.equal(value.length, bytes); assert.equal(sha(value), hash); return value;
  }));
  const [packageBytes, instanceBytes, sourceBytes, declarationBytes] = inputs;
  const pkg = decodeGenericPackage(packageBytes), record = JSON.parse(instanceBytes.toString('utf8'));
  const expected = independentIdentities(previous, pkg, record);
  const before = JSON.stringify({ pkg, record }), source = sourceBytes.toString('utf8'), declaration = declarationBytes.toString('utf8');
  assert.equal(pkg.family, 'tsfg-owned-generic-package'); assert.equal(pkg.version, 5); assert.equal(pkg.schemaHash, schema);
  assert.equal(pkg.packageId, expected.packageId); assert.equal(pkg.payload.semanticProfile, profile);
  assert.equal(pkg.payload.scope, 'package:' + family);
  assert.deepEqual(pkg.payload.capabilities, ['conditional-generic-call', 'conditional-signature', 'explicit-type-arguments', 'mapped-indexed-signature', 'number-add', 'scalar-generics', 'single-module']);
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
  assert.deepEqual(cold.format, { family: 'tsfg.generic-concrete-hir-candidate', version: 5, linkageAlgorithm: 'tsfg.generic-linkage.v1', semanticProfile: profile });
  assert.deepEqual(cold.context, { packageId: expected.packageId, scope: 'package:' + family, semanticProfile: profile });
  assert.deepEqual(cold.target, target);
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
  assert.deepEqual(Buffer.from(core), migrateGolden(golden, previous, expected),
    'qualified v4 stdin permits exactly five identity slots and whole-block instance-key ordering changes');
  assert.equal(lowerGenericHir(readGenericHir(Buffer.from(text))), core);
  assert.equal(printGenericHir(cold), text); assert.equal(JSON.stringify({ pkg, record }), before);
  inputs.forEach((bytes, index) => assert.equal(sha(bytes), expected.pins[index][2]));
});
