// SPDX-License-Identifier: MIT
// Real captured packets and pre-implementation whole expectations; no Source/guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildHir, analyzeArrayCalls, verifyArrayCallParallelGroup,
  verifyArrayParallelProof, printArrayParallelProof, readArrayParallelProof } from '../../compiler/hir.mjs';
import { jcs, sha, fresh, wire, deeplyFrozen } from './array-test-fixtures.mjs';
import { fixture, factsContext, resign } from './array-call-test-helpers.mjs';

const bytes = await readFile(new URL('./array-parallel-oracle.json', import.meta.url));
assert.equal(bytes.length, 206539);
assert.equal(sha(bytes), '036c7b905e5a17aa03bca4e4cac8aedcc4dbefcf0093f5ab8f140222b234bd40');
const oracle = JSON.parse(bytes.toString());
assert.equal(oracle.frozenBeforeImplementation, true);
assert.equal(oracle.productionImports, false);
/** @param {string} name @returns {any} */
const rowFor = name => oracle.cases.find(row => row.name === name);
/** @param {any} row @returns {any} */
function state(row) {
  const raw = Buffer.from(row.source.packetText), packet = JSON.parse(raw.toString());
  assert.equal(raw.length, row.source.bytes); assert.equal('sha256:' + sha(raw), row.source.sha256);
  assert.equal(row.source.originalSourceProducer, true); assert.equal(row.source.newSourceExecution, false);
  const facts = { family: 'tsfg.array-facts-context-candidate', version: 1,
    expectedPackageId: packet.packageId, factsBytes: raw };
  const context = fresh(row.context);
  // The retained FIRST oracle over-narrowed entry.local while clearing pure
  // callee locals. Keep entry's actual allocation/read/write/resize upper; the
  // independently frozen conflict DTO and every Source/HIR byte stay unchanged.
  if (row.name === 'wide-published-narrow-body') {
    const entry = row.hir.functions.find(fn => fn.name === 'entry');
    context.contracts.find(record => record.functionId === entry.id).upper.local = { read: true, write: true, structural: true };
    resign(context);
  }
  const built = buildHir(packet, facts, context);
  assert.equal(built.status, 'ok'); assert.deepEqual(built.hir, row.hir);
  if (row.baselineAnalysis) assert.deepEqual(analyzeArrayCalls(built.hir, facts, context), row.baselineAnalysis);
  return { hir: fresh(built.hir), facts, context, request: fresh(row.request) };
}
/** @param {any} s @returns {any} */
const invoke = s => verifyArrayCallParallelGroup(s.hir, s.facts, s.context, s.request);
/** @param {() => any} action @returns {any} */
function caught(action) {
  let result; try { action(); } catch (error) { result = error; }
  assert.ok(result instanceof TypeError); return result;
}
/** @param {() => any} action @param {string} [kind] @returns {any} */
function rejects(action, kind = '') {
  const e = caught(action), code = 'r03-d-array-parallel' + (kind ? '-' + kind : '');
  assert.equal(e.code, code); assert.equal(e.ruleId, 'r01-kernel'); assert.equal(e.phase, 'analysis');
  return e;
}
/** @param {any} error @returns {any} */
const dto = error => ({ name: error.name, message: error.message,
  ...Object.fromEntries(Object.keys(error).map(key => [key, error[key]])) });

for (const row of oracle.cases) test('37b actual whole path: ' + row.name, () => {
  const s = state(row), before = { hir: jcs(s.hir), context: jcs(s.context), request: jcs(s.request), raw: Buffer.from(s.facts.factsBytes) };
  if (row.expectedError) assert.deepEqual(dto(caught(() => invoke(s))), row.expectedError);
  else {
    const actual = invoke(s); assert.deepEqual(actual, row.expectedProof); deeplyFrozen(actual);
    assert.deepEqual(verifyArrayParallelProof(fresh(actual), s.hir, s.facts, s.context, s.request), row.expectedProof);
    const text = jcs(row.expectedProof) + '\n';
    assert.equal(printArrayParallelProof(actual, s.hir, s.facts, s.context, s.request), text);
    assert.deepEqual(readArrayParallelProof(Buffer.from(text), s.hir, s.facts, s.context, s.request), row.expectedProof);
  }
  assert.equal(jcs(s.hir), before.hir); assert.equal(jcs(s.context), before.context);
  assert.equal(jcs(s.request), before.request); assert.deepEqual(s.facts.factsBytes, before.raw);
});

test('37b shared readonly views succeed; a fresh structural owner stays disjoint', () => {
  const rr = invoke(state(rowFor('shared-readspan-RR')));
  assert.equal(rr.pairs[0].readRead.length, 1);
  assert.deepEqual(rr.pairs[0].readRead[0].left, rr.pairs[0].readRead[0].right);
  assert.equal(rr.accesses[0].owners[0].kind, 'parameter');
  const disjoint = invoke(state(rowFor('fresh-disjoint')));
  assert.equal(disjoint.accesses[0].owners[0].kind, 'allocation');
  assert.notDeepEqual(disjoint.accesses[0].owners, disjoint.accesses[1].owners);
  assert.equal(disjoint.accesses[1].structural.length, 1);
  for (const key of ['writeWrite', 'writeRead', 'readWrite', 'structuralLeft', 'structuralRight'])
    assert.deepEqual(disjoint.pairs[0][key], []);
});

test('37b distinct formal slots remain possible aliases rather than false disjoint resources', async () => {
  const original = await readFile(new URL('./readspan-return-events-oracle-v7.json', import.meta.url));
  assert.equal(sha(original), '26ca21f34df2e15d62b2f9cc24264e881b613a4ac03d074718fe2ae7efe20f81');
  const row = JSON.parse(original.toString()).cases.find(r => r.name === 'events100');
  // Root's retained actual Source packet, not newly constructed Source facts.
  assert.equal(Buffer.byteLength(row.packageText), 37648);
  assert.equal(sha(row.packageText), '7a444469bf42ae75718a176b6ffba20f0ac5863965cc10fcbe3bd6fd0982edef');
  const context = fresh(row.publicationContext);
  // A legal wider fixed read upper changes no body or owner identity. Rebuild
  // the existing mandatory borrow plan against that newly signed table.
  for (const record of context.contracts) for (const parameter of record.upper.parameters) parameter.read = true;
  resign(context);
  const facts = { ...fresh(row.factsContext), factsBytes: Buffer.from(row.packageText) };
  const built = buildHir(JSON.parse(row.packageText), facts, context); assert.equal(built.status, 'ok');
  const fn = row.completeHir.functions.find(f => f.name === 'heavy');
  const calls = row.completeAnalysis.calls.filter(c => c.functionId === fn.id && [1, 17].includes(c.expressionPath[1]));
  calls.sort((a, b) => a.expressionPath[1] - b.expressionPath[1]); assert.equal(calls.length, 2);
  const request = { functionId: fn.id, sites: calls.map(c => ({ expressionPath: c.expressionPath,
    consumedDigest: context.contracts.find(record => record.functionId === c.target).digest })) };
  const proof = verifyArrayCallParallelGroup(built.hir, facts, context, request);
  assert.deepEqual(proof.pairs[0].readRead, [{ left: { kind: 'parameter', functionId: fn.id, index: 0 },
    right: { kind: 'parameter', functionId: fn.id, index: 1 } }]);
});

test('37b fixed wider parameter effects remain authoritative over actual pure callee bodies', () => {
  const s = state(rowFor('wide-published-narrow-body'));
  const analysis = analyzeArrayCalls(s.hir, s.facts, s.context);
  for (const name of ['leaf', 'bridge']) {
    const id = s.hir.functions.find(fn => fn.name === name).id;
    const lower = analysis.functions.find(fn => fn.functionId === id).derived;
    assert.deepEqual(lower.reads, []); assert.deepEqual(lower.writes, []); assert.deepEqual(lower.structural, []);
  }
  const e = rejects(() => invoke(s), 'conflict');
  assert.equal(e.conflicts.writeWrite.length, 1); assert.equal(e.conflicts.structuralLeft.length, 1);
});

test('37b a local Published wildcard is a specific missing domain, never false independence', async () => {
  const base = await fixture('two-level-private-local-narrow'), s = state(rowFor('wide-published-narrow-body'));
  s.context = fresh(base.context);
  s.request.sites.forEach(site => { site.consumedDigest = s.context.contracts.find(c => c.functionId === s.hir.functions.find(f => f.name === 'bridge').id).digest; });
  const e = rejects(() => invoke(s), 'capability');
  assert.equal(e.facet, 'local');
  assert.deepEqual(e.primary, { sourceId: s.hir.rootFile, ...base.analysis.calls.find(c => c.functionId === s.request.functionId).range });
});

test('37b exact caller, real site and consumed digest identities are checked', async t => {
  for (const [name, mutate] of /** @type {Array<[string,(s:any)=>void]>} */ ([
    ['caller', s => { s.request.functionId = 'sha256:' + '0'.repeat(64); }],
    ['site', s => { s.request.sites[1].expressionPath[1] = 49; }],
    ['site facet', s => { s.request.sites[0].expressionPath[2] = 'value'; }],
    ['consumed digest', s => { s.request.sites[0].consumedDigest = 'sha256:' + '0'.repeat(64); }],
  ])) await t.test(name, () => { const s = state(rowFor('fresh-disjoint')); mutate(s); rejects(() => invoke(s), 'identity'); });
});

test('37b request grammar, source ordering and limits are explicit', async t => {
  /** @type {Array<[string,(s:any)=>void]>} */
  const changes = [
    ['one site', s => { s.request.sites.pop(); }],
    ['empty', s => { s.request.sites = []; }],
    ['duplicate', s => { s.request.sites[1] = fresh(s.request.sites[0]); }],
    ['descending', s => { s.request.sites.reverse(); }],
    ['extra authority', s => { s.request.safe = true; }],
    ['extra site key', s => { s.request.sites[0].target = 'sha256:' + '0'.repeat(64); }],
    ['signed zero', s => { s.request.sites[0].expressionPath[1] = -0; }],
    ['wrong path', s => { s.request.sites[0].expressionPath[0] = 'functions'; }],
    ['bad digest', s => { s.request.sites[0].consumedDigest = 'SHA256:' + '0'.repeat(64); }],
  ];
  for (const [name, mutate] of changes) await t.test(name, () => {
    const s = state(rowFor('fresh-disjoint')); mutate(s); rejects(() => invoke(s));
  });
  const s = state(rowFor('fresh-disjoint'));
  s.request.sites = Array.from({ length: 33 }, () => fresh(s.request.sites[0]));
  rejects(() => invoke(s), 'limit');
});

test('37b unsafe request graphs are rejected without invoking getters or traps', () => {
  const s = state(rowFor('fresh-disjoint')); let reads = 0;
  Object.defineProperty(s.request, 'sites', { get() { reads++; throw Error('must not execute'); } });
  rejects(() => invoke(s)); assert.equal(reads, 0);
  s.request = {}; s.request.self = s.request; rejects(() => invoke(s));
  s.request = JSON.parse('{"__proto__":{}}'); rejects(() => invoke(s));
  const proxy = Proxy.revocable({}, {}); proxy.revoke(); s.request = proxy.proxy; rejects(() => invoke(s));
});

test('37b all supplied proof fields are checked, including identity and RR witnesses', async t => {
  const s = state(rowFor('shared-readspan-RR')), expected = invoke(s);
  for (const [name, mutate] of /** @type {Array<[string,(p:any)=>void]>} */ ([
    ['identity', p => { p.inputIdentity = 'sha256:' + '0'.repeat(64); }],
    ['HIR digest', p => { p.hirDigest = 'sha256:' + '0'.repeat(64); }],
    ['scope', p => { p.scopeDigest = 'sha256:' + '0'.repeat(64); }],
    ['publication', p => { p.publishedDigest = 'sha256:' + '0'.repeat(64); }],
    ['reads', p => { p.accesses[0].reads = []; }],
    ['RR', p => { p.pairs[0].readRead = []; }],
    ['kind', p => { p.kind = 'array-call-owner-parallel-proof-v0'; }],
    ['extra permit', p => { p.kernelPermitted = true; }],
  ])) await t.test(name, () => {
    const proof = fresh(expected); mutate(proof);
    rejects(() => verifyArrayParallelProof(proof, s.hir, s.facts, s.context, s.request), 'proof');
  });
  for (const text of [jcs(expected), ' ' + jcs(expected) + '\n'])
    rejects(() => readArrayParallelProof(Buffer.from(text), s.hir, s.facts, s.context, s.request), 'canonical');
  rejects(() => readArrayParallelProof(Buffer.from([255]), s.hir, s.facts, s.context, s.request));
  const over = Buffer.alloc(2097153);
  rejects(() => readArrayParallelProof(over, s.hir, s.facts, s.context, s.request), 'limit');
});

test('37b fixed-context and owned-HIR failures retain the real existing analysis boundary', () => {
  const s = state(rowFor('fresh-disjoint'));
  s.context.expectedDigest = 'sha256:' + '0'.repeat(64);
  assert.equal(caught(() => invoke(s)).code, 'r03-d-array-call-effects-identity');
  const second = state(rowFor('fresh-disjoint'));
  second.hir.inputIdentity = 'sha256:' + '0'.repeat(64);
  assert.ok(caught(() => invoke(second)).code.startsWith('r03-array-hir-'));
});

test('37b the inclusive 32 actual call-site request reaches the real conflict consumer', async () => {
  const row = await fixture('work-lower'), fn = row.hir.functions.find(f => f.name === 'f04');
  const calls = row.analysis.calls.filter(c => c.functionId === fn.id)
    .sort((a, b) => a.expressionPath[1] - b.expressionPath[1]);
  assert.equal(calls.length, 32);
  const request = { functionId: fn.id, sites: calls.map(c => ({ expressionPath: c.expressionPath, consumedDigest: c.consumedDigest })) };
  const e = rejects(() => verifyArrayCallParallelGroup(fresh(row.hir), factsContext(row), fresh(row.context), request), 'conflict');
  const owner = { kind: 'parameter', functionId: fn.id, index: 0 }, pair = [{ left: owner, right: owner }];
  assert.deepEqual(e.conflicts, { writeWrite: pair, writeRead: pair, readWrite: pair, structuralLeft: pair, structuralRight: pair });
});
