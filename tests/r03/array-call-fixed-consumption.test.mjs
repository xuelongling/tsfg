// SPDX-License-Identifier: MIT
// Explicit fixed tables are independently re-signed; successful expected reports stay oracle-owned.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir, verifyHir, analyzeArrayCalls, verifyArrayCalls, printArrayCalls, readArrayCalls } from '../../compiler/hir.mjs';
import { fixture, packet, fresh, wire, canonical, factsContext, named, summary, caught, analysisError,
  trustedPrimary, deeplyFrozen, resign, bogusHash } from './array-call-test-helpers.mjs';

/** @param {any[]} set @param {any} owner */
const includes = (set, owner) => set.some(item => canonical(item) === canonical(owner));
/** @param {any} report @param {any} hir @param {string} name */
const callsFrom = (report, hir, name) => report.calls.filter(call => call.functionId === named(hir, name).id);

test('23e same-owner aliases merge full original slots while independent fresh allocations stay distinct', async () => {
  const row = await fixture('two-slots-alias-and-independent-fresh');
  const report = analyzeArrayCalls(fresh(row.hir), factsContext(row), fresh(row.context));
  assert.deepEqual(report, row.analysis);
  const copy = summary(row.hir, report, 'copy'), entry = summary(row.hir, report, 'entry');
  const sites = callsFrom(report, row.hir, 'entry'); assert.equal(sites.length, 2);
  for (const call of sites) assert.deepEqual(call.arguments.map(arg => arg.index), [0, 2], 'full signature slots, not Array rank');
  assert.deepEqual(sites[0].arguments[0].owner, sites[0].arguments[1].owner);
  assert.notDeepEqual(sites[1].arguments[0].owner, sites[1].arguments[1].owner);
  assert.deepEqual(copy.derived.owners.map(owner => owner.index), [0, 2]);
  assert.equal(entry.derived.owners.length, 2);
  const a = sites[1].arguments[0].owner, b = sites[1].arguments[1].owner;
  for (const effects of [entry.derived, entry.effective]) {
    assert.ok(includes(effects.reads, a) && includes(effects.reads, b));
    assert.deepEqual(effects.writes, [a]); assert.deepEqual(effects.structural, [a]);
  }
});

test('23e local allocation occurrences retain both call frames; Published local is a call-region wildcard', async () => {
  const row = await fixture('two-level-private-local-and-stable-publication');
  const report = analyzeArrayCalls(fresh(row.hir), factsContext(row), fresh(row.context));
  assert.deepEqual(report, row.analysis);
  const leaf = summary(row.hir, report, 'leaf'), bridge = summary(row.hir, report, 'bridge');
  const entry = summary(row.hir, report, 'entry'), leafId = named(row.hir, 'leaf').id;
  assert.equal(leaf.derived.owners.filter(owner => owner.kind === 'allocation').length, 2);
  const unused = leaf.derived.owners.find(owner => owner.kind === 'allocation'
    && !includes(leaf.derived.reads, owner) && !includes(leaf.derived.writes, owner) && !includes(leaf.derived.structural, owner));
  assert.ok(unused, 'unused empty allocation is retained independently of access effects');
  assert.equal(bridge.derived.owners.filter(owner => owner.kind === 'allocation').length, 2);
  const imported = entry.derived.owners.filter(owner => owner.kind === 'allocation' && owner.functionId === leafId);
  assert.equal(imported.length, 4);
  assert.ok(imported.every(owner => owner.callPath.length === 2), 'entry then bridge frame retained');
  assert.equal(new Set(imported.map(canonical)).size, 4);
  assert.equal(entry.derived.owners.length, 5);
  assert.equal(entry.effective.owners.filter(owner => owner.kind === 'callLocal').length, 2);
  assert.equal(entry.effective.owners.length, 3, 'two wildcard regions do not pretend to be four concrete allocations');
  for (const key of ['reads', 'writes', 'structural']) assert.equal(entry.effective[key].length, 3);
  const sites = callsFrom(report, row.hir, 'entry');
  assert.equal(sites.length, 2);
  for (const call of sites) {
    assert.equal(call.publishedLocal.kind, 'callLocal');
    assert.deepEqual(call.publishedLocal.expressionPath, call.expressionPath);
    assert.ok(!call.arguments.some(arg => arg.owner.kind === 'callLocal'), 'private region never becomes an actual argument');
  }
});

test('23e a narrower body keeps declaration publication and caller consumption wide without freezing source-site IDs', async () => {
  const base = await fixture('two-level-private-local-and-stable-publication');
  const narrow = await fixture('two-level-private-local-narrow');
  assert.deepEqual(narrow.context, base.context, 'fixed table and all digests survive body/source/range changes');
  assert.notEqual(JSON.parse(narrow.packageText).packageId, JSON.parse(base.packageText).packageId);
  const report = analyzeArrayCalls(fresh(narrow.hir), factsContext(narrow), fresh(narrow.context));
  assert.deepEqual(report, narrow.analysis);
  assert.equal(report.scopeDigest, base.analysis.scopeDigest);
  assert.equal(report.publishedDigest, base.analysis.publishedDigest);
  for (const name of ['leaf', 'bridge']) {
    const row = summary(narrow.hir, report, name);
    for (const key of ['reads', 'writes', 'structural']) assert.deepEqual(row.derived[key], []);
    assert.equal(row.derived.owners.length, 1);
  }
  assert.deepEqual(summary(narrow.hir, report, 'bridge').effective, summary(base.hir, base.analysis, 'bridge').effective);
  const entry = summary(narrow.hir, report, 'entry'), before = summary(base.hir, base.analysis, 'entry');
  assert.equal(entry.derived.owners.length, 1);
  for (const key of ['owners', 'reads', 'writes', 'structural']) {
    assert.equal(entry.effective[key].length, before.effective[key].length);
    assert.deepEqual(entry.effective[key].filter(owner => owner.kind === 'callLocal'),
      before.effective[key].filter(owner => owner.kind === 'callLocal'));
  }
  // A genuine body shortening moves the later caller literal's source site.
  assert.notEqual(entry.effective.owners.find(owner => owner.kind === 'allocation').allocationSite,
    before.effective.owners.find(owner => owner.kind === 'allocation').allocationSite);
});

test('23e pure current callee bodies still force each caller facet from their fixed Published upper', async t => {
  const row = await fixture('two-level-private-local-narrow'), bridge = named(row.hir, 'bridge');
  for (const facet of ['read', 'write', 'structural']) for (const target of ['parameter', 'local'])
    await t.test(target + '/' + facet, () => {
      const context = fresh(row.context), contract = context.contracts.find(item => item.functionId === bridge.id);
      if (target === 'parameter') {
        contract.upper.parameters.find(item => item.index === 0)[facet] = false;
        // The frozen base leaf publishes W+S only; explicitly supply a wider read upper for this consumer pair.
        if (facet === 'read') context.contracts.find(item => item.functionId === named(row.hir, 'leaf').id)
          .upper.parameters.find(item => item.index === 0).read = true;
      } else contract.upper.local[facet] = false;
      resign(context); const before = fresh(context);
      const error = caught(() => analyzeArrayCalls(fresh(row.hir), factsContext(row), context));
      analysisError(error, 'contract');
      assert.equal(error.functionId, bridge.id);
      assert.equal(error.facet, target === 'parameter' ? 'parameter:0:' + facet : 'local:' + facet);
      assert.deepEqual(error.primary, { sourceId: bridge.sourcePath, ...bridge.range });
      trustedPrimary(row, error.primary); assert.deepEqual(context, before);
    });
});

test('23e actual Source read/write/structural operations each reject an insufficient fixed facet', async t => {
  const row = await fixture('first-touch-alias'), touch = named(row.hir, 'touch');
  for (const facet of ['read', 'write', 'structural']) await t.test(facet, () => {
    const context = fresh(row.context);
    context.contracts.find(item => item.functionId === touch.id).upper.parameters[0][facet] = false; resign(context);
    const error = caught(() => analyzeArrayCalls(fresh(row.hir), factsContext(row), context));
    analysisError(error, 'contract'); assert.equal(error.functionId, touch.id);
    assert.equal(error.facet, 'parameter:0:' + facet);
    assert.deepEqual(error.primary, { sourceId: touch.sourcePath, ...touch.range });
  });
});

test('23e fixed contexts require complete exact function signatures, original slots and independently checked hashes', async t => {
  const row = await fixture('two-slots-alias-and-independent-fresh'), copy = named(row.hir, 'copy');
  /** @type {Array<[string,(c:any)=>void,boolean]>} */
  const changes = [
    ['missing function', c => c.contracts.pop(), true],
    ['duplicate function', c => c.contracts.push(fresh(c.contracts[0])), true],
    ['noncanonical function order', c => c.contracts.reverse(), true],
    ['unknown function identity', c => { c.contracts[0].functionId = bogusHash; }, true],
    ['wrong signature', c => { c.contracts[0].signatureHash = bogusHash; }, true],
    ['missing Array slot', c => { c.contracts.find(r => r.functionId === copy.id).upper.parameters.pop(); }, true],
    ['Array rank replaces full slot', c => { c.contracts.find(r => r.functionId === copy.id).upper.parameters[1].index = 1; }, true],
    ['wrong slot order', c => { c.contracts.find(r => r.functionId === copy.id).upper.parameters.reverse(); }, true],
    ['wrong scope with valid outer digest', c => { c.scopeDigest = bogusHash; }, true],
    ['row digest not checked', c => { c.contracts[0].digest = bogusHash; }, false],
    ['table digest not checked', c => { c.expectedDigest = bogusHash; }, false],
  ];
  for (const [name, mutate, repair] of changes) await t.test(name, () => {
    const context = fresh(row.context); mutate(context); if (repair) resign(context); const before = fresh(context);
    analysisError(caught(() => analyzeArrayCalls(fresh(row.hir), factsContext(row), context)), 'identity');
    assert.deepEqual(context, before);
  });
  const derived = fresh(row.context); derived.mode = 'derived';
  analysisError(caught(() => analyzeArrayCalls(fresh(row.hir), factsContext(row), derived)));
});

test('23e complete report verification rejects missing private owners, fake mappings and shortened allocation paths', async t => {
  const row = await fixture('two-level-private-local-and-stable-publication');
  /** @type {Array<[string,(a:any)=>void]>} */
  const changes = [
    ['missing unused local allocation', a => {
      const leaf = summary(row.hir, a, 'leaf');
      leaf.derived.owners = leaf.derived.owners.filter(owner => owner.kind !== 'allocation' || includes(leaf.derived.reads, owner));
    }],
    ['imported path frame omitted', a => {
      summary(row.hir, a, 'entry').derived.owners.find(owner => owner.kind === 'allocation' && owner.callPath.length === 2).callPath.pop();
    }],
    ['private region replaced with caller allocation', a => {
      const entry = summary(row.hir, a, 'entry');
      entry.effective.reads = entry.effective.reads.map(owner => owner.kind === 'callLocal' ? fresh(entry.effective.owners.find(o => o.kind === 'allocation')) : owner);
    }],
    ['wrong original actual binding', a => { a.calls[0].arguments[0].binding = bogusHash; }],
    ['wrong consumed publication digest', a => { a.calls[0].consumedDigest = bogusHash; }],
    ['call registry omitted', a => { a.calls.pop(); }],
    ['caller effective facet erased', a => { summary(row.hir, a, 'entry').effective.structural = []; }],
    ['report identity forged', a => { a.hirDigest = bogusHash; }],
  ];
  for (const [name, mutate] of changes) await t.test(name, () => {
    const hostile = fresh(row.analysis); mutate(hostile); const before = fresh(hostile);
    for (const action of [() => verifyArrayCalls(hostile, fresh(row.hir), factsContext(row), fresh(row.context)),
      () => readArrayCalls(wire(hostile), fresh(row.hir), factsContext(row), fresh(row.context))])
      analysisError(caught(action), 'report');
    assert.deepEqual(hostile, before);
  });
});

test('23e parameter aliases stay unknown and an actual local passed to a call loses prior exact length', async () => {
  const row = await fixture('parameter-alias-permanent-unknown'), p = packet(row);
  assert.deepEqual(readArrayFactsCandidate(Buffer.from(row.packageText)), p);
  const built = buildHir(p, factsContext(row)); assert.equal(built.status, 'ok'); assert.deepEqual(built.hir, row.hir);
  assert.deepEqual(verifyHir(fresh(row.hir), factsContext(row)), row.hir);
  const fill = named(row.hir, 'fill'), entry = named(row.hir, 'entry');
  assert.deepEqual(fill.body.map(stmt => stmt.kind),
    ['local', 'arrayResizeChecked', 'arrayStoreDenseChecked', 'arrayStoreDenseChecked', 'return']);
  assert.equal(fill.body[1].value.decimal, '0');
  assert.equal(fill.body[3].target.index.decimal, '1', 'do not fake a gap after a possibly aliased parameter mutation');
  assert.deepEqual(entry.body.map(stmt => stmt.kind), ['local', 'local', 'expression', 'arrayStoreDenseChecked', 'return']);
  assert.equal(entry.body[3].target.index.decimal, '2', 'call invalidates original literal length1 without deleting this check');
  const report = analyzeArrayCalls(fresh(row.hir), factsContext(row), fresh(row.context));
  assert.deepEqual(report, row.analysis);
  const call = callsFrom(report, row.hir, 'entry')[0];
  assert.deepEqual(call.arguments.map(arg => arg.index), [0, 1]);
  assert.deepEqual(call.arguments[0].owner, call.arguments[1].owner);
  const effective = summary(row.hir, report, 'entry').effective;
  for (const key of ['owners', 'reads', 'writes', 'structural']) assert.equal(effective[key].length, 1);
});

test('23e published reports own immutable complete values and cold read/print reconstructs the whole result', async () => {
  const row = await fixture('first-touch-alias'), hir = fresh(row.hir), context = fresh(row.context);
  const report = analyzeArrayCalls(hir, factsContext(row), context); deeplyFrozen(report);
  assert.deepEqual(report, row.analysis);
  const text = printArrayCalls(report, fresh(row.hir), factsContext(row), fresh(row.context));
  assert.equal(text, canonical(row.analysis) + '\n');
  assert.deepEqual(readArrayCalls(Buffer.from(text), fresh(row.hir), factsContext(row), fresh(row.context)), row.analysis);
  hir.functions.length = 0; context.contracts[0].upper.local.read = !context.contracts[0].upper.local.read;
  assert.deepEqual(report, row.analysis, 'caller mutations do not rewrite the frozen publication report');
});
