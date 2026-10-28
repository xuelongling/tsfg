// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

// Actual Go23344 records, not recast Source6b84 or hand-made successful facts.
// The three complete Core oracles were worked from original source, declared
// type/signature/function preimages and Core8f9 before invoking this consumer.
// An initial v2 refusal is API/version RED; only mask1/3 grammar refusals after
// this same mask2 baseline passes count as this slice's semantic RED.
// This file only compiles data to text: no Core CLI, native, VM or execution oracle.
const schema = 'sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71';
const coreSchema = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
const producerBase = 'b6e156608803b08c4f62f258487484b1656e8213';
const testedInputs = 'sha256:6535cdfbee610b7e32fce13ef139b813fe45cec161b17ed7563386828b224b4d';
const sourcePath = '/src/main.ts';
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
const scalarRecord = { kind: 'scalar', name: 'i32', id: scalar };
const nullableRecord = mask => {
  const record = { kind: 'nullable-i32', undefined: (mask & 1) !== 0, null: (mask & 2) !== 0 };
  return { ...record, id: candidate('tsfg.core-nullable-candidate.type.v1', record) };
};
function identity(name, parameters, source) {
  const signatureHash = candidate('tsfg.core-nullable-candidate.signature.v1', { parameters, returnType: scalar });
  return { signatureHash, id: candidate('tsfg.core-nullable-candidate.function.v1',
    { name, signatureHash, source: { path: sourcePath, digest: hash(source) } }) };
}
// Fixed original-source offsets: delta is solely the annotation spelling length.
const cases = [
  {
    "mask": 2,
    "delta": 0,
    "union": "null",
    "sourceHash": "sha256:0c517833dcec4fe92acd123b9969459008dedc3be959ebc0a6bb9feba8e472e3",
    "pins": [
      {
        "bytes": 2059,
        "sha256": "sha256:d2768cf7a130348cdf5d81f861678dd508e312a440bedf12896efd9d809b382a"
      },
      {
        "bytes": 4071,
        "sha256": "sha256:1d3e71fff207c61f30b476e987c096face7e62b8201d1120295b6509a5441303"
      },
      {
        "bytes": 395,
        "sha256": "sha256:1d8c21b50e5a68a4bf07ed2883272edc91d28bda011c1e0c94f1893d24fa3246"
      }
    ],
    "golden": {
      "bytes": 3249,
      "sha256": "sha256:fb73941dd3855a7443ba085511cc77cb78a6773ea89566a58ead2f27f595c979"
    }
  },
  {
    "mask": 1,
    "delta": 5,
    "union": "undefined",
    "sourceHash": "sha256:d0c9f55832571e9916b8acdcca4023caedaa9126014115d1bbc2ab9582335363",
    "pins": [
      {
        "bytes": 2064,
        "sha256": "sha256:ad48d088b197675fe98522a78dff1f9bee7ff5f2fbada3611aa9909deebe0c9a"
      },
      {
        "bytes": 4071,
        "sha256": "sha256:23a987b09441ddb75602b3d9e6414ecb9d6eabb950e8cc7e1f81916bfa969dd2"
      },
      {
        "bytes": 395,
        "sha256": "sha256:f0dfe94d8ed2bc2bfc7b8308c72b49d56e148de7c68c553e1b382727bc9ebbf1"
      }
    ],
    "golden": {
      "bytes": 3249,
      "sha256": "sha256:e73c93bda9de342d4c38884b77e911b77deb420f34405d476f12c9be27457592"
    }
  },
  {
    "mask": 3,
    "delta": 12,
    "union": "null | undefined",
    "sourceHash": "sha256:9fb373bcd1ce3afddd204ae5c7012610956c9f03827e6bf7b9ae8e550f75ee57",
    "pins": [
      {
        "bytes": 2071,
        "sha256": "sha256:0f4093debb5c2ad3d9c02d31f45cb590b9446ccb5d9491113981aa51f624c94a"
      },
      {
        "bytes": 4073,
        "sha256": "sha256:cb45ace9f148dfaca05e85a26e9a2ae67ed5a31a23aca7cfb51fdd6b282f14e9"
      },
      {
        "bytes": 395,
        "sha256": "sha256:0c22da72401cee9fdf78e1ca66de7c04652a3cb1e8553019443a315859e9aa78"
      }
    ],
    "golden": {
      "bytes": 3257,
      "sha256": "sha256:4177985d9e411fd37590777b468354506c24e5509bec21eee8124cd1443eac9f"
    }
  }
];

async function capture(example) {
  const fixture = new URL('./fixtures/nullable-owned-absence-masks/mask' + example.mask + '/simple/v3/', import.meta.url);
  const names = ['request.json', 'response.json', 'origin.json', 'expected.core.mlir'];
  const bytes = await Promise.all(names.map(name => readFile(new URL(name, fixture))));
  const pins = bytes.map(raw => ({ bytes: raw.length, sha256: hash(raw) }));
  assert.deepEqual(pins, [...example.pins, example.golden], 'frozen actual capture and independent full Core oracle');
  const [requestBytes, responseBytes, originBytes, golden] = bytes;
  const request = JSON.parse(requestBytes.toString('utf8')), packet = JSON.parse(responseBytes.toString('utf8'));
  const origin = JSON.parse(originBytes.toString('utf8'));
  for (const [value, raw] of [[request, requestBytes], [packet, responseBytes], [origin, originBytes]])
    assert.deepEqual(Buffer.from(jcs(value)), raw, 'exact original JCS');
  keys(request, ['family', 'version', 'schemaHash', 'input']);
  keys(packet, ['family', 'version', 'schemaHash', 'requestId', 'packageId', 'payload']);
  keys(packet.payload, ['inputIdentity', 'files', 'facts', 'exports']);
  assert.deepEqual([request.family, request.version, request.schemaHash], ['tsfg.nullable-facts-request-candidate', 3, schema]);
  assert.deepEqual([packet.family, packet.version, packet.schemaHash], ['tsfg.nullable-facts-package-candidate', 3, schema]);
  assert.equal(packet.requestId, hash('tsfg.nullable-facts.request.v3\0' + requestBytes.toString('utf8')));
  assert.equal(packet.packageId, hash('tsfg.nullable-facts.package.v3\0' + schema + '\0' + jcs(packet.payload)));
  keys(origin, ['kind', 'producerBaseOid', 'producerDirty', 'requestSha256', 'responseSha256', 'testedInputSetHash']);
  assert.deepEqual(origin, { kind: 'owned-go-nullable-response', producerBaseOid: producerBase, producerDirty: true,
    requestSha256: hash(requestBytes), responseSha256: hash(responseBytes), testedInputSetHash: testedInputs });
  const source = 'function coalesce(value: i32 | ' + example.union + ', replacement: i32): i32 { return value ?? replacement; }\n'
    + 'export function entry(value: i32): i32 { return coalesce(value, value); }';
  assert.equal(hash(source), example.sourceHash); assert.equal(source.length, 166 + example.delta);
  const input = request.input;
  assert.equal(input.sourceRoot, '/src'); assert.equal(input.rootFile, sourcePath);
  assert.equal(input.files.find(file => file.path === sourcePath)?.content, source);
  assert.deepEqual(input.declarations, { version: 'minimal-integers-v3', paths: ['/src/minimal-integers-v3.d.ts'] });
  assert.deepEqual(input.config, { strict: true, noEmit: true, allowJs: false });
  const files = input.files.map(file => ({ path: file.path, content: file.content }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  assert.equal(files.length, 2);
  assert.equal(hash(files[1].content), 'sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e');
  assert.equal(packet.payload.inputIdentity, hash(jcs({ ...input, files })));
  assert.deepEqual(packet.payload.files, files.map(file => ({ path: file.path, digest: hash(file.content),
    byteLength: Buffer.byteLength(file.content), length: file.content.length, positionUnit: 'utf16' })));
  assert.deepEqual(packet.payload.facts.inputs, files.map(file => file.path));
  assert.equal(golden.toString('utf8').split('\n').length - 1, 20);
  return { example, fixture, names, bytes, pins, requestBytes, responseBytes, packet, origin, golden, source };
}

function sourceFacts(actual) {
  const { packet, example } = actual, d = example.delta;
  const flow = { undefined: (example.mask & 1) !== 0, null: (example.mask & 2) !== 0 };
  const facts = packet.payload.facts; keys(facts, ['status', 'inputs', 'functions', 'symbols']);
  assert.equal(facts.status, 'ok');
  assert.deepEqual(facts.functions.map(fn => [fn.name, fn.symbol]), [['coalesce', 's1'], ['entry', 's2']]);
  assert.deepEqual(facts.symbols.map(s => [s.id, s.name, s.kind, s.type, s.writable]), [
    ['s1', 'coalesce', 'function', 'i32', false], ['s2', 'entry', 'function', 'i32', false],
    ['s3', 'value', 'parameter', 'i32', true], ['s4', 'replacement', 'parameter', 'i32', true],
    ['s5', 'value', 'parameter', 'i32', true],
  ]);
  assert.deepEqual(facts.symbols.map(s => s.range), [span(8, 17), span(108 + d, 114 + d),
    span(18, 23), span(36 + d, 48 + d), span(115 + d, 120 + d)]);
  const [coalesce, entry] = facts.functions;
  assert.deepEqual([coalesce.range, entry.range], [span(0, 92 + d), span(92 + d, 166 + d)]);
  assert.deepEqual([coalesce.returnType, entry.returnType], ['i32', 'i32']);
  assert.equal(coalesce.returnPresence, undefined); assert.equal(entry.returnPresence, undefined);
  assert.deepEqual(coalesce.parameters, facts.symbols.slice(2, 4)); assert.deepEqual(entry.parameters, facts.symbols.slice(4));
  assert.deepEqual(coalesce.parameterInitializers, [null, null]); assert.deepEqual(entry.parameterInitializers, [null]);
  const shape = (members, range, annotation) => ({ ...members, optional: false, default: false, range, annotation });
  const present = { undefined: false, null: false };
  assert.deepEqual(coalesce.parameters[0].presence, shape(flow, span(18, 35 + d), span(25, 35 + d)));
  assert.deepEqual(coalesce.parameters[1].presence, shape(present, span(36 + d, 53 + d), span(50 + d, 53 + d)));
  assert.deepEqual(entry.parameters[0].presence, shape(present, span(115 + d, 125 + d), span(122 + d, 125 + d)));
  assert.deepEqual(packet.payload.exports, [{ name: 'entry', target: 's2', sourcePath,
    range: span(92 + d, 166 + d), definition: span(108 + d, 114 + d) }]);
  assert.equal(coalesce.body.length, 1); assert.equal(coalesce.body[0].kind, 'return');
  assert.deepEqual(coalesce.body[0].range, span(61 + d, 90 + d));
  const raw = coalesce.body[0].expression; keys(raw, ['kind', 'operator', 'type', 'left', 'right', 'presenceFlow', 'range']);
  assert.equal(raw.kind, 'shortCircuit'); assert.equal(raw.operator, '??'); assert.equal(raw.type, 'i32');
  assert.deepEqual(raw.range, span(69 + d, 89 + d)); assert.deepEqual(raw.presenceFlow, present);
  assert.deepEqual(raw.left, { kind: 'reference', type: 'i32', symbol: 's3', presenceFlow: flow, range: span(69 + d, 74 + d) });
  assert.deepEqual(raw.right, { kind: 'reference', type: 'i32', symbol: 's4', range: span(78 + d, 89 + d) });
  assert.equal(entry.body.length, 1); assert.equal(entry.body[0].kind, 'return');
  assert.deepEqual(entry.body[0].range, span(133 + d, 164 + d));
  const call = entry.body[0].expression;
  assert.deepEqual(call, { kind: 'call', type: 'i32', target: 's1', range: span(140 + d, 163 + d),
    arguments: [
      { kind: 'reference', type: 'i32', symbol: 's5', range: span(150 + d, 155 + d) },
      { kind: 'reference', type: 'i32', symbol: 's5', range: span(156 + d, 162 + d) },
    ], signature: { parameters: ['i32', 'i32'], returnType: 'i32', presence: coalesce.parameters.map(p => p.presence) } });
}

function typedHir(actual, hir) {
  const { example, source } = actual, d = example.delta, nullable = nullableRecord(example.mask);
  const expectedCoalesce = identity('coalesce', [nullable.id, scalar], source), expectedEntry = identity('entry', [scalar], source);
  assert.equal(new Set(hir.types.map(type => type.id)).size, hir.types.length);
  const allowed = [scalarRecord, nullableRecord(1), nullableRecord(2), nullableRecord(3)];
  for (const type of hir.types) assert.deepEqual(type, allowed.find(candidate => candidate.id === type.id));
  assert.ok(hir.types.some(type => type.id === scalar)); assert.ok(hir.types.some(type => type.id === nullable.id));
  assert.deepEqual(hir.functions.map(fn => [fn.name, fn.ownedSymbol, fn.role]), [['coalesce', 's1', 'internal'], ['entry', 's2', 'entry']]);
  const [coalesce, entry] = hir.functions;
  for (const [fn, expected, parameters] of [[coalesce, expectedCoalesce, [nullable.id, scalar]], [entry, expectedEntry, [scalar]]]) {
    assert.equal(fn.id, expected.id); assert.equal(fn.signatureHash, expected.signatureHash);
    assert.deepEqual(fn.returnType, scalarRecord); assert.deepEqual(fn.parameters.map(p => p.type), parameters);
  }
  assert.deepEqual(coalesce.parameters.map(p => [p.id, p.name, p.range]), [['s3', 'value', span(18, 23)], ['s4', 'replacement', span(36 + d, 48 + d)]]);
  assert.deepEqual(entry.parameters.map(p => [p.id, p.name, p.range]), [['s5', 'value', span(115 + d, 120 + d)]]);
  assert.deepEqual(coalesce.body, [{ kind: 'return', range: span(61 + d, 90 + d), value: {
    kind: 'nullableCoalesce', type: scalar, range: span(69 + d, 89 + d),
    left: { kind: 'reference', type: nullable.id, binding: 's3', range: span(69 + d, 74 + d) },
    right: { kind: 'reference', type: scalar, binding: 's4', range: span(78 + d, 89 + d) },
  } }]);
  assert.deepEqual(entry.body, [{ kind: 'return', range: span(133 + d, 164 + d), value: {
    kind: 'call', type: scalar, target: expectedCoalesce.id, signatureHash: expectedCoalesce.signatureHash, range: span(140 + d, 163 + d),
    arguments: [
      { kind: 'nullableWrap', type: nullable.id, range: span(150 + d, 155 + d),
        operand: { kind: 'reference', type: scalar, binding: 's5', range: span(150 + d, 155 + d) } },
      { kind: 'reference', type: scalar, binding: 's5', range: span(156 + d, 162 + d) },
    ],
  } }]);
}

function coreDataflow(core, mask) {
  // These are structural claims about text/SSA, never execution of absence paths.
  const first = core.indexOf('  func.func @"coalesce"'), second = core.indexOf('  func.func @"entry"');
  assert.ok(first >= 0 && second > first);
  const body = core.slice(first, second), entry = core.slice(second), mlir = '!tsfg_nullable.i32<' + mask + '>';
  assert.equal((body.match(/"tsfg_nullable\.tag_test"/g) ?? []).length, 1);
  assert.equal((body.match(/"tsfg_nullable\.get"/g) ?? []).length, 1);
  assert.ok(body.includes('%v2 = "tsfg_nullable.tag_test"(%v0) {tag = 0 : i32'));
  assert.ok(body.includes('cf.cond_br %v2, ^bb1, ^bb2'));
  assert.ok(body.includes('^bb1:\n    %v4 = "tsfg_nullable.get"(%v0)'));
  assert.ok(body.includes('cf.br ^bb3(%v4 : i32)'));
  assert.ok(body.includes('^bb2:\n    cf.br ^bb3(%v1 : i32)'));
  assert.ok(body.includes('^bb3(%v3: i32):\n    "func.return"(%v3)'));
  assert.equal(body.includes('"func.call"'), false);
  assert.deepEqual([...body.matchAll(/^\s*(?:%[A-Za-z0-9_]+\s*=\s*)?"([^"]+)"\(/gm)].map(m => m[1]),
    ['tsfg_core.fuel', 'tsfg_nullable.tag_test', 'tsfg_nullable.get', 'func.return']);
  assert.ok(entry.includes('%v1 = "tsfg_nullable.wrap_i32"(%v0)'));
  assert.ok(entry.includes(': (i32) -> ' + mlir));
  assert.ok(entry.includes('%v2 = "func.call"(%v1, %v0) {callee = @"coalesce"'));
  assert.ok(entry.includes(': (' + mlir + ', i32) -> i32'));
  assert.ok(entry.includes('"func.return"(%v2)'));
}

async function coldChain(actual) {
  const packetBefore = jcs(actual.packet), originBefore = jcs(actual.origin);
  const imported = await importCapturedFrontendResponse(actual.requestBytes, actual.responseBytes, actual.origin);
  assert.equal(imported.status, 'ok', JSON.stringify(imported));
  const snapshot = JSON.parse(jcs(imported.snapshot)), snapshotBefore = jcs(snapshot);
  validateFrontendSnapshot(snapshot);
  assert.deepEqual(snapshot.format, { family: 'tsfg.frontend-nullable-candidate', version: 3, schemaHash: schema });
  assert.deepEqual(snapshot.sourceOrigin, actual.origin);
  assert.equal(snapshot.snapshotId, hash('tsfg.frontend-nullable-candidate.snapshot.v3\0' + schema + '\0'
    + jcs({ inputIdentity: actual.packet.payload.inputIdentity, sourceOrigin: actual.origin })));
  assert.equal(snapshot.inputIdentity, actual.packet.payload.inputIdentity);
  assert.deepEqual(snapshot.functions, actual.packet.payload.facts.functions); assert.deepEqual(snapshot.symbols, actual.packet.payload.facts.symbols);
  assert.deepEqual(snapshot.exports, actual.packet.payload.exports); assert.deepEqual(snapshot.inputs, actual.packet.payload.files);
  assert.deepEqual(snapshot.source, { path: sourcePath, content: actual.source, hash: actual.example.sourceHash });
  assert.deepEqual(snapshot.capture, { request: actual.requestBytes.toString('utf8'), response: actual.responseBytes.toString('utf8') });
  const built = buildHir(snapshot); assert.equal(built.status, 'ok', JSON.stringify(built));
  const hir = verifyHir(built.hir), hirBefore = jcs(hir);
  assert.deepEqual(hir.format, { family: 'tsfg.nullable-hir-candidate', version: 3, schemaHash: schema });
  typedHir(actual, hir);
  const printed = printHir(hir), cold = readHir(Buffer.from(printed));
  assert.deepEqual(verifyHir(cold), hir); assert.equal(printHir(cold), printed);
  const core = lowerHir(cold); coreDataflow(core, actual.example.mask);
  assert.deepEqual(Buffer.from(core), actual.golden, 'entire independently fixed Core text, including all identities/UTF16 anchors/SSA');
  assert.equal(lowerHir(readHir(Buffer.from(printed))), core);
  assert.equal(jcs(hir), hirBefore); assert.equal(jcs(snapshot), snapshotBefore);
  assert.equal(jcs(actual.packet), packetBefore); assert.equal(jcs(actual.origin), originBefore);
  const after = await Promise.all(actual.names.map(name => readFile(new URL(name, actual.fixture))));
  assert.deepEqual(after.map(raw => ({ bytes: raw.length, sha256: hash(raw) })), actual.pins);
  assert.deepEqual(actual.bytes.map(raw => ({ bytes: raw.length, sha256: hash(raw) })), actual.pins);
}

test('actual v3 mask2 baseline then mask1 and mask3 preserve exact cold HIR and lazy Core SSA', async t => {
  for (const example of cases) await t.test('mask' + example.mask, async () => {
    const actual = await capture(example); sourceFacts(actual); await coldChain(actual);
    t.diagnostic('actual v3 mask' + example.mask + ' cold/Core complete independent bytes passed');
  });
});
