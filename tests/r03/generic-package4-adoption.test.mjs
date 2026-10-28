// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeGenericPackage, encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, printGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';

// Pure Node composition over fresh private7 Source records; see this ticket's
// current-fixture-qualification.json for the exact raw output correspondence. Core
// literals were independently worked from complete instance identities and the
// prior scalar SSA examples, before reading any current emitter output. Historical
// Core4 stdin remains unchanged; no runtime text transplant or new C++ credit.
/** @type {Record<string, any>} */
const cases = {
  "number-add": {"pins":[["generic-number-add-package-v7.json",2010,"f6fb1bd862a3b99fe6383ded21aa7e5f3761a3903406c5ffdccc95ce779bcfdd"],["generic-number-add-instance-v7.json",2020,"3e6bc892ae8425d6d7af44193f4086bdf917ee11d1067a6012f9bc9ace0adebb"],["generic-number-add.source.ts",92,"ca4815b1b71ef1e4921b01566d60eeb1b70751bb9a126b7b37d7f45454d16e44"],["generic-number-add.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"sum","definition":"6949104be61e0df1ff4e9b3b5997cdf24e4a5b2d1684f27b6e197a1024e847a5","packageId":"sha256:f0a998edcb56184b200baebd39355ed565a02d08fcebf80e7c39d0c16783063e","inputIdentity":"sha256:291d3c3e5272b485b24e0ae4da72f9255f7716e3e7429c6ec3ce65947ee09254","functionRange":{"end":90,"start":6},"parameters":[{"name":"left","range":{"end":41,"start":29}},{"name":"right","range":{"end":56,"start":43}}],"expressionRange":{"end":87,"start":75},"sourceLength":90,"witnesses":[{"argument":"number","key":"081b126cebb1ebf91215381e1370589c31e192f74e7272b296f9445430155378","id":"161d075a4344fdb1c5039dbfffe1f718b9fd6ab45115f75d4e4fb1e2a2cbf420","scalar":"f64","signature":"3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585"},{"argument":"boolean","key":"d828cd3d083e8da147aa016baea6db645f9f786250b4c84054659db5f2e80f8c","id":"cd7514b19f22cd7d0903efdc26f1c5e2bb78b6ff3a074ff87b0c440f4379dd7e","scalar":"f64","signature":"3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585"}],"golden":{"file":"generic-package7-number-add-core.mlir","bytes":2292,"sha256":"4fc359c5c8ffbdd7bfae486d63ea34f313a7d6edbfb16c00afa0b1c053944c06"}},
  "conditional-signature": {"pins":[["generic-conditional-signature-package-v7.json",2084,"ccb72ba4b7b2fc550ac7fc7e9f88d2e6625f3048ed30d81bcddbfad9b6e07057"],["generic-conditional-signature-instance-v7.json",1485,"8273d0c1b4cf132ee96843b4bc42ac5240f981c2f502160a06965ba0e31ffecd"],["generic-conditional-signature.source.ts",134,"b389353082b8f428ef3362e3a410b02e84b616da6947a5274945bb65be0a6a5b"],["generic-conditional-signature.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"select","definition":"70672415263a4e21029a43530815fda78ba93d267fb24f84bbef08985a4fd984","packageId":"sha256:8af52e05a3946e7e18ac0cffc2249bd665db86fc51e5e6c529e5b0557c2ff850","inputIdentity":"sha256:7d081666315f249bfc0a122c3cfa838b525219214ad21dce1e8f6bdddd51d9e4","functionRange":{"end":132,"start":6},"parameters":[{"name":"value","range":{"end":75,"start":32}}],"expressionRange":{"end":129,"start":124},"sourceLength":132,"witnesses":[{"argument":"number","key":"ff4aa2eca59548e35cc9f49757f8db03d54b8889a5091701a63bd503cbd5d80c","id":"830cef2745892aff6691e993a9cb60dd2380eabb20740260568a5970e41ffe8a","scalar":"f64","signature":"f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059"},{"argument":"boolean","key":"4bfb27a1f910e9c3b16656d897c6c65d2b897958c6cd20be129240865ed20cd8","id":"0ed6d50767026d3426348b0848e9894e8d48b7928cfb0afadecdeefe2237b7a0","scalar":"bool","signature":"176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395"}],"golden":{"file":"generic-package7-conditional-signature-core.mlir","bytes":2048,"sha256":"9bf51373f1066602e563d45d9817a5afd72ea354340565f70ace376db072731a"}},
  "mapped-signature": {"pins":[["generic-mapped-signature-package-v7.json",2165,"2efb70895fcfae713b20d8b91310b7be218e90db14bee411679fff673f21564e"],["generic-mapped-signature-instance-v7.json",1485,"67001dd982b5ddc61758b8aa14f4e43b88479273de5f67692a641a3ba2c216e8"],["generic-mapped-signature.source.ts",122,"eae49419fbca1d64bc6c55bb871da4b0d6eb942bdcd8cf14dbb09da903d6c356"],["generic-mapped-signature.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"mapped","definition":"5f7c40d3b5a68019b9262784ee2c492648db154cfd5043a7bc5f9769ce5cb900","packageId":"sha256:de802096b83002428ffc7b29263fdcb5e5e888159201855b4d43bdaaa505e690","inputIdentity":"sha256:9eb279dd1323960e14a37eecb770b99e7de5551b37c1b5e62d9ab002e4da6879","functionRange":{"end":120,"start":6},"parameters":[{"name":"value","range":{"end":69,"start":32}}],"expressionRange":{"end":117,"start":112},"sourceLength":120,"witnesses":[{"argument":"boolean","key":"b40ed00ab9be2f2bd189900306a6b4d6f3f89c81db7b727cce822af46df647eb","id":"cfcbbecd2c83edfd6056e1fbcabc39f9355384e5b5df67f851b981a8c44064d5","scalar":"bool","signature":"176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395"},{"argument":"number","key":"a5b6ba34ff35349065d9a83342ea48e1d337c5daf66090d20c886be78f9a8998","id":"fd1b1e1614ebb7d64dc65cf324546ef4fd39b15311e39e5a9493206df34cdcc5","scalar":"f64","signature":"f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059"}],"golden":{"file":"generic-package7-mapped-signature-core.mlir","bytes":2048,"sha256":"df57d44a3c1d069bc1926458dc2b9bbce3fe9f2c10eefe992c52237646cb9977"}},
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const profile = 'tsfg-owned-scalar-generics-host-v7';
const schema = '2e9d1e07016b6f8ce5f48bf8a3508491eaf1ce7e6fd43bf497c133f65c8dff94';
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
/** @param {any} oracle @param {any} pkg @param {any} record */
function independentIdentities(oracle, pkg, record) {
  const payload = pkg.payload, packageId = 'sha256:' + sha('tsfg-owned-generic-package/v7\n' + canonical(payload));
  assert.equal(pkg.packageId, packageId); assert.equal(packageId, oracle.packageId);
  const definition = sha('tsfg:generic-definition:v1\n' + canonical({ name: oracle.name,
    origin: oracle.functionRange, scope: payload.scope, source: payload.source }));
  assert.equal(definition, oracle.definition);
  const expectedWitnesses = /** @type {Array<any>} */ (oracle.witnesses);
  const witnesses = expectedWitnesses.map(witness => {
    const typeArguments = [{ kind: witness.argument, parameter: 0 }];
    const key = sha('tsfg:generic-instance:v1\n' + canonical({ definition, graphDigest: packageId.slice(7),
      scope: payload.scope, semanticProfile: profile, typeArguments }));
    const parameterTypes = Array(oracle.parameters.length).fill(witness.scalar);
    const signature = sha('tsfg.signature\0(' + parameterTypes.join(',') + ')->' + witness.scalar);
    assert.equal(signature, witness.signature);
    const linkage = '__tsfg_generic_v1_' + key;
    const id = sha('tsfg.function\0' + payload.source.path + '\0' + linkage + '\0' + signature);
    assert.equal(key, witness.key); assert.equal(id, witness.id);
    return { ...witness, definition, typeArguments, key, id, signature };
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
  assert.equal(inputIdentity, oracle.inputIdentity);
  return { ...oracle, packageId, inputIdentity, witnesses };
}

for (const [family, oracle] of Object.entries(cases)) test('package6 composition preserves actual ' + family + ' facts through the current shared scalar emitter', async () => {
  const inputs = await Promise.all(oracle.pins.map(async ([name, bytes, hash]) => {
    const value = await fixture(name); assert.equal(value.length, bytes); assert.equal(sha(value), hash); return value;
  }));
  const [packageBytes, instanceBytes, sourceBytes, declarationBytes] = inputs;
  const pkg = decodeGenericPackage(packageBytes), record = JSON.parse(instanceBytes.toString('utf8'));
  const expected = independentIdentities(oracle, pkg, record);
  const before = JSON.stringify({ pkg, record }), source = sourceBytes.toString('utf8'), declaration = declarationBytes.toString('utf8');
  assert.equal(pkg.family, 'tsfg-owned-generic-package'); assert.equal(pkg.version, 7); assert.equal(pkg.schemaHash, schema);
  assert.equal(pkg.packageId, expected.packageId); assert.equal(pkg.payload.semanticProfile, profile);
  assert.equal(pkg.payload.scope, 'package:' + family);
  assert.deepEqual(pkg.payload.capabilities, ['conditional-generic-call', 'conditional-signature', 'explicit-type-arguments', 'mapped-indexed-generic-call', 'mapped-indexed-signature', 'number-add', 'scalar-generics', 'single-module']);
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
  assert.deepEqual(cold.format, { family: 'tsfg.generic-concrete-hir-candidate', version: 7, linkageAlgorithm: 'tsfg.generic-linkage.v1', semanticProfile: profile });
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
  assert.deepEqual(Buffer.from(core), golden,
    'complete independently hand-worked private7 identity, function order and scalar SSA text');
  assert.equal(lowerGenericHir(readGenericHir(Buffer.from(text))), core);
  assert.equal(printGenericHir(cold), text); assert.equal(JSON.stringify({ pkg, record }), before);
  inputs.forEach((bytes, index) => assert.equal(sha(bytes), expected.pins[index][2]));
});
