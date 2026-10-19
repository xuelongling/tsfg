// SPDX-License-Identifier: MIT
// Independent whole expectations precede Source6/Product6 output. Root retains
// the fresh official full-bundle proof; this suite never manufactures expected facts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir, analyzeArrayCalls,
  verifyArrayCalls, printArrayCalls, readArrayCalls } from '../../compiler/hir.mjs';
import { jcs, sha, fresh, wire, deeplyFrozen } from './array-test-fixtures.mjs';

// The exact independently frozen container is pretty JSON, not a wire frame.
const oracleBytes = await readFile(new URL('./legacy-v6-parameter-budget-oracle.json', import.meta.url));
assert.equal(oracleBytes.length, 6369515);
assert.equal(sha(oracleBytes), '6b7e1fcbe1ec511b24b230b4c0f45835afabf2b37a39eb25b1436d39ff7b1b3b');
const oracle = JSON.parse(oracleBytes.toString());
assert.equal(oracle.staticValidation.allPassed, true);
assert.equal(oracle.cases.length, 2);

/** @param {any} row @returns {any} */
function cold(row) {
  // Upper's report/HIR are complete conceptual cold input, not an expected return.
  const report = fresh(row.conceptualOwnerAnalysis);
  return {
    packet: JSON.parse(row.packageText), hir: fresh(row.hir), context: fresh(row.context), report,
    facts: {...fresh(row.factsContext), factsBytes: Buffer.from(row.packageText)},
    hirBytes: wire(row.hir), reportBytes: wire(report),
  };
}

/** @param {any} state @param {any} row */
function unchanged(state, row) {
  assert.deepEqual(state.packet, JSON.parse(row.packageText));
  assert.deepEqual(state.hir, row.hir);
  assert.deepEqual(state.context, row.context);
  assert.deepEqual(state.report, row.conceptualOwnerAnalysis);
  assert.deepEqual(state.facts, {...fresh(row.factsContext), factsBytes: Buffer.from(row.packageText)});
  assert.deepEqual(state.hirBytes, wire(row.hir));
  assert.deepEqual(state.reportBytes, wire(row.conceptualOwnerAnalysis));
}

/** @type {Record<string, (state:any)=>any>} */
const entries = {
  buildHir: s => buildHir(s.packet, s.facts, s.context),
  verifyHir: s => verifyHir(s.hir, s.facts, s.context),
  printHir: s => printHir(s.hir, s.facts, s.context),
  readHir: s => readHir(s.hirBytes, s.facts, s.context),
  lowerHir: s => lowerHir(s.hir, s.facts, s.context),
  analyzeArrayCalls: s => analyzeArrayCalls(s.hir, s.facts, s.context),
  verifyArrayCalls: s => verifyArrayCalls(s.report, s.hir, s.facts, s.context),
  printArrayCalls: s => printArrayCalls(s.report, s.hir, s.facts, s.context),
  readArrayCalls: s => readArrayCalls(s.reportBytes, s.hir, s.facts, s.context),
};

/** @param {any} state @param {string} entry @returns {any} */
function invoke(state, entry) {
  let value, error, threw = false;
  try { value = entries[entry](state); } catch (cause) { error = cause; threw = true; }
  return {value, error, threw};
}

/** @param {any} error @returns {any} */
const dto = error => ({message: error.message,
  ...Object.fromEntries(Object.keys(error).map(key => [key, error[key]]))});

/** @param {any} outcome @param {any} expected */
function rejected(outcome, expected) {
  assert.equal(outcome.threw, true);
  assert.ok(outcome.error instanceof TypeError);
  assert.deepEqual(dto(outcome.error), expected);
  assert.equal(outcome.value, undefined);
}

/** @param {any} row @param {string} entry @param {any} outcome */
function checked(row, entry, outcome) {
  if (row.expectedDiagnostic) {
    assert.equal(row.expectedOutcome, 'limit');
    if (entry === 'buildHir') {
      assert.equal(outcome.threw, false);
      assert.deepEqual(outcome.value, {status: 'error', diagnostics: [row.expectedDiagnostic]});
      deeplyFrozen(outcome.value);
      assert.equal(Object.hasOwn(outcome.value, 'hir'), false);
    } else {
      rejected(outcome, row.expectedDiagnostic);
      assert.equal(Object.hasOwn(outcome.error, 'primary'), false);
      assert.equal(Object.hasOwn(outcome.error, 'related'), false);
    }
    return;
  }
  if (entry === 'lowerHir') {
    rejected(outcome, row.core.expectedDiagnostic);
    return;
  }
  assert.equal(outcome.threw, false, outcome.error?.stack);
  const expected = entry === 'buildHir' ? {status: 'ok', hir: row.hir} :
    entry === 'printHir' ? jcs(row.hir) + '\n' :
    entry === 'printArrayCalls' ? jcs(row.expectedReport) + '\n' :
    entry.endsWith('ArrayCalls') ? row.expectedReport : row.hir;
  assert.deepEqual(outcome.value, expected);
  deeplyFrozen(outcome.value);
}

for (const row of oracle.cases) {
  test('26b formal and repeated-argument budget complete nine seams: ' + row.id, async t => {
    assert.equal(row.provenance.productionModuleImported, false);
    assert.equal(row.provenance.productionAlgorithmRead, false);
    assert.equal(row.provenance.productionOutputSampled, false);
    for (const entry of Object.keys(entries)) await t.test(entry, () => {
      const state = cold(row), outcome = invoke(state, entry);
      unchanged(state, row);
      checked(row, entry, outcome);
      if (!outcome.threw) {
        // Returned owned/frozen success or error data must survive caller mutation.
        const saved = outcome.value;
        state.packet.payload.functions.length = 0;
        state.hir.functions.length = 0;
        state.context.contracts.length = 0;
        state.report.functions.length = 0;
        state.facts.factsBytes.fill(0);
        state.hirBytes.fill(0);
        state.reportBytes.fill(0);
        checked(row, entry, {...outcome, value: saved});
      }
    });
  });

  test('26b facts ingress is complete, owned and independent of borrow limit: ' + row.id, () => {
    const bytes = Buffer.from(row.packageText), original = Buffer.from(bytes);
    const result = readArrayFactsCandidate(bytes);
    assert.deepEqual(bytes, original);
    assert.deepEqual(result, JSON.parse(row.packageText));
    deeplyFrozen(result);
    bytes.fill(0);
    assert.deepEqual(result, JSON.parse(row.packageText));
  });
}

test('26b budget geometry retains unused formals and every original duplicate argument', () => {
  const [lower, upper] = oracle.cases;
  assert.deepEqual([lower.id, upper.id], ['work1024', 'work1025']);
  assert.deepEqual([lower.work.owner, upper.work.owner], [5227, 5228]);
  assert.deepEqual([lower.work.borrowRegistrations, upper.work.borrowRegistrations], [14, 14]);
  assert.deepEqual([lower.work.borrowUses, upper.work.borrowUses], [1010, 1011]);
  assert.deepEqual([lower.work.borrowTotal, upper.work.borrowTotal], [1024, 1025]);
  assert.deepEqual([lower.work.borrowComparisons, upper.work.borrowComparisons], [0, 0]);
  assert.deepEqual(lower.expectedReturned, {hir: true, report: true, coreText: false});
  assert.deepEqual(upper.expectedReturned, {hir: false, report: false, coreText: false});
  assert.equal(upper.expectedReport, null);
  assert.deepEqual(upper.expectedDiagnostic, {code: 'r03-d-readspan-limit',
    ruleId: 'r01-input-boundary', phase: 'hir', message: 'ReadSpan analysis exceeds work limit'});
  assert.deepEqual(lower.context, upper.context);
  for (const row of oracle.cases) {
    const plan = row.hir.readSpanPlan;
    assert.equal(plan.calls.length, 128);
    assert.equal(plan.calls.reduce((n, call) => n + call.arguments.length, 0), 1010);
    assert.equal(plan.functions.reduce((n, fn) => n + fn.views.length, 0), 14);
    assert.equal(plan.functions.slice(0, 2).flatMap(fn => fn.views).length, 9);
    assert.ok(plan.functions.slice(0, 2).flatMap(fn => fn.views)
      .every(view => view.lastUseEvent === null && view.useEvents.length === 0));
    for (const fn of plan.functions) {
      assert.ok(fn.events.length <= 64);
      for (const event of fn.events.filter(event => event.kind === 'view-call-complete')) {
        assert.deepEqual(event.uses.map(use => use.index),
          Array.from({length: event.uses.length}, (_, index) => index));
        assert.equal(new Set(event.uses.map(use => use.viewId)).size, 1);
        const root = fn.views.find(view => view.viewId === event.uses[0].viewId);
        assert.ok(root);
        assert.equal(root.useEvents.filter(sequence => sequence === event.sequence).length, 1);
      }
    }
    assert.ok(row.context.contracts.every(contract => contract.upper.parameters
      .every(slot => !slot.read && !slot.write && !slot.structural)));
    assert.equal(row.context.version, 3);
    assert.equal(row.hir.format.version, 6);
    assert.equal(plan.version, 3);
  }
});
