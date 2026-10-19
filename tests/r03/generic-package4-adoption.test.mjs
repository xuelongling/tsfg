// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeGenericPackage, encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, printGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';

// Pure Node composition over actual private6 Source35864 records. Current Core
// literals were independently worked from complete instance identities and the
// prior scalar SSA examples, before reading any current emitter output. Historical
// Core4 stdin remains unchanged; no runtime text transplant or new C++ credit.
/** @type {Record<string, any>} */
const cases = {
  "number-add": {"pins":[["generic-number-add-package-v6.json",2010,"078452ab0898f81f5e0cd73a2790f150f745c0fd7ac4ed2b965b5eb47325af30"],["generic-number-add-instance-v6.json",2020,"915419cbcb51e0061431ee336b8ee2c98239f9c1e427df22497c9c2573a0b386"],["generic-number-add.source.ts",92,"ca4815b1b71ef1e4921b01566d60eeb1b70751bb9a126b7b37d7f45454d16e44"],["generic-number-add.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"sum","definition":"6949104be61e0df1ff4e9b3b5997cdf24e4a5b2d1684f27b6e197a1024e847a5","packageId":"sha256:6a028b0b3ce9c5f2fb65e6e95229bb8f31901dcb32f613479cc58b989cfd90d5","inputIdentity":"sha256:0e617f6b45655f5f0afaf1763a537ba7e73c4d6dbfda2c1696329144ea77ece5","functionRange":{"end":90,"start":6},"parameters":[{"name":"left","range":{"end":41,"start":29}},{"name":"right","range":{"end":56,"start":43}}],"expressionRange":{"end":87,"start":75},"sourceLength":90,"witnesses":[{"argument":"number","key":"8ec71ddf67e4742cbf261ce272dcfdd86126082abb531d388125f16d1e911517","id":"b5c99f053e495c15c2f0e53cc8e140482fef711326c0364a25c8d829a152bd76","scalar":"f64","signature":"3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585"},{"argument":"boolean","key":"ec1cf4cff127cc87fdcf945b51998b6f81e603d6a358098ff1345a5d2ca155bf","id":"73e2a1d9ee11e646ff704d05df7161fceb3e07465d1953194b7751fcc7246b32","scalar":"f64","signature":"3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585"}],"golden":{"file":"generic-package6-number-add-core.mlir","bytes":2291,"sha256":"a7be405fd68c654651c5e7e9113baef75446bce9b674c7c21e9075f798e8879b"}},
  "conditional-signature": {"pins":[["generic-conditional-signature-package-v6.json",2084,"ff35b73722e3ab6f7fc9beaaa55e7c0682df7b46c2fe9adf094d3d108db1fb08"],["generic-conditional-signature-instance-v6.json",1485,"4c261615ac1e6799a0a08176a093cc0f6f46b051092498f5d9ace0d167f8c726"],["generic-conditional-signature.source.ts",134,"b389353082b8f428ef3362e3a410b02e84b616da6947a5274945bb65be0a6a5b"],["generic-conditional-signature.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"select","definition":"70672415263a4e21029a43530815fda78ba93d267fb24f84bbef08985a4fd984","packageId":"sha256:b09b0374333d7c946076de2f57c2910133f62a752234b105ebeae509836bd8b9","inputIdentity":"sha256:bfb6f8c2da19de9bf2ca08e1cb04e479c9f0a71f0a8821cfeae7d284deebfa11","functionRange":{"end":132,"start":6},"parameters":[{"name":"value","range":{"end":75,"start":32}}],"expressionRange":{"end":129,"start":124},"sourceLength":132,"witnesses":[{"argument":"number","key":"6499ab7e9bfd645b253bf3cd1d7b54d131528204ec4a04af3fce4936cc8846e7","id":"bed173dbac8da1dc221801f26f5ea54635dfd9deff99c8e3dc33e43b6bfdc52c","scalar":"f64","signature":"f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059"},{"argument":"boolean","key":"dccf399aec2af323eef5c431f3754deb229c2ea841b0c620d298d95ab38fba56","id":"7ab7c52a5a42c85b677ca2b25ed1d3f693f6d53297399d9e9cd88b7a7b9a02e0","scalar":"bool","signature":"176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395"}],"golden":{"file":"generic-package6-conditional-signature-core.mlir","bytes":2047,"sha256":"c44913e59644fdef0c086de25500758f8fc4d4b0045503aeb8864364745f9a85"}},
  "mapped-signature": {"pins":[["generic-mapped-signature-package-v6.json",2165,"ef3d3858feb524909a5fcebd3024c7b4c4ace19701386cec0bc3cf94351364fd"],["generic-mapped-signature-instance-v6.json",1485,"7a04de74add85eddac1ce3dce00307b98d10b66b61afa765ad068af7b9ad91bd"],["generic-mapped-signature.source.ts",122,"eae49419fbca1d64bc6c55bb871da4b0d6eb942bdcd8cf14dbb09da903d6c356"],["generic-mapped-signature.declaration.d.ts",362,"d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"]],"name":"mapped","definition":"5f7c40d3b5a68019b9262784ee2c492648db154cfd5043a7bc5f9769ce5cb900","packageId":"sha256:4ed917e38b9707b98b478a97b4c6039d0571cb526895c49a9599970c4426dfac","inputIdentity":"sha256:d2a315173cce99e11b46ad997e97de9d76fff2962ea9df63b258f5a5083c13dc","functionRange":{"end":120,"start":6},"parameters":[{"name":"value","range":{"end":69,"start":32}}],"expressionRange":{"end":117,"start":112},"sourceLength":120,"witnesses":[{"argument":"boolean","key":"117afbe3affacc9c2342511760c8e4d6bb1c9074b0b407adc35bc66874ca8326","id":"86018e8717e9abc09ad3b0c3596083bc58f6a028a2f64175937224ddb39e9587","scalar":"bool","signature":"176f0c2d74ef9b180f6aa17b92935546bf3661b0a8944833e96892a14d968395"},{"argument":"number","key":"a3890bb872a7f6c919215b318c5babf1bab3b62711f890013b4db877e7a73aaa","id":"8b77a4755a330c57a76d180e4ba14c9c3ca52174a63e6d335afbe0e041d259f5","scalar":"f64","signature":"f195c19035b7f0da83780c5c50afe3060a0d4ea3a577e4b70726f5905aab8059"}],"golden":{"file":"generic-package6-mapped-signature-core.mlir","bytes":2047,"sha256":"b293c0d22e60fd5599692b2caacf83919108f73fa6bd2185ddfd267bb3624790"}},
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const profile = 'tsfg-owned-scalar-generics-host-v6';
const schema = 'c6b6baa76be25f6ac4f619867273208c9adb595030f12e7c54a200ed8c677789';
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
  const payload = pkg.payload, packageId = 'sha256:' + sha('tsfg-owned-generic-package/v6\n' + canonical(payload));
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
  assert.equal(pkg.family, 'tsfg-owned-generic-package'); assert.equal(pkg.version, 6); assert.equal(pkg.schemaHash, schema);
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
  assert.deepEqual(cold.format, { family: 'tsfg.generic-concrete-hir-candidate', version: 6, linkageAlgorithm: 'tsfg.generic-linkage.v1', semanticProfile: profile });
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
    'complete independently hand-worked private6 identity, function order and scalar SSA text');
  assert.equal(lowerGenericHir(readGenericHir(Buffer.from(text))), core);
  assert.equal(printGenericHir(cold), text); assert.equal(JSON.stringify({ pkg, record }), before);
  inputs.forEach((bytes, index) => assert.equal(sha(bytes), expected.pins[index][2]));
});
