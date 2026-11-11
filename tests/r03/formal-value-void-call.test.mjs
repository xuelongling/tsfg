// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createCommonProgramPublication } from '../../compiler/common-program-analysis.mjs';
import { commonProgramCore } from '../../compiler/common-program-core.mjs';
import { readCommonProgramFacts } from '../../compiler/common-program-facts.mjs';
import { projectCommonProgram } from '../../compiler/common-program-hir.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = './testdata/formal-value-llvm-v3/value-void-call/';
const files = await Promise.all(['package.json', 'official-oracle.json', 'source.ts']
  .map(name => fs.readFile(new URL(fixture + name, import.meta.url))));
assert.deepEqual(files.map(sha), [
  '03fa2ec7ea933c0827a1c3a3c1cacc386fce7fce37958962edc3630b0b2163e2',
  '8c63b3f671b4717ee1386ed4bf37d87f449f35b6a50cc3b09c6a116f651ad8b9',
  '93a81c166f21e3b7983c974ac6261f3da5a97d2fc514c397bbbab22867a408a5',
]);
const [packet, oracleBytes, sourceBytes] = files;
const oracle = JSON.parse(oracleBytes.toString('utf8'));
const source = sourceBytes.toString('utf8');
const hir = projectCommonProgram(readCommonProgramFacts(packet));
const publication = createCommonProgramPublication(hir);
const module = commonProgramCore(hir, publication, {
  targets: hir.closure.requiredRoots.filter(row => row.kind === 'kernel').map(row => row.target).sort(),
});
const caller = hir.functions.find(row => row.name === oracle.target);
const callee = hir.functions.find(row => row.name === 'touch');
const callerSource = oracle.functions.find(row => row.id === caller.sourceBinding);
const calleeSource = oracle.functions.find(row => row.id === callee.sourceBinding);
const sourceWithin = (row, fn) => row.range.start >= fn.range.start && row.range.end <= fn.range.end;
const callSource = oracle.occurrences.find(row => row.kind === 'call' && sourceWithin(row, callerSource));
const returnSource = oracle.occurrences.find(row => row.kind === 'return' && sourceWithin(row, callerSource));
const fieldSource = oracle.occurrences.find(row => row.kind === 'field' && sourceWithin(row, calleeSource));
const literalSource = oracle.occurrences.find(row => row.kind === 'literal' && sourceWithin(row, calleeSource));
const symbol = fn => 'value_' + fn.id.slice(7);
const reportDir = process.env.TSFG_VALUE_VOID_CALL_REPORT;

test('complete official Source retains the void call and the caller field read', () => {
  assert.equal(oracle.sourceSha256, sha(sourceBytes));
  assert.deepEqual(oracle.sourceRange, {start: 0, end: source.length});
  assert.deepEqual(oracle.diagnostics, []);
  assert.equal(hir.sources.find(row => row.path === '/src/main.ts').content, source);
  assert.equal(hir.functions.length, oracle.functions.length);
  for (const row of oracle.functions) {
    const fn = hir.functions.find(fn => fn.sourceBinding === row.id);
    assert.ok(fn);
    assert.deepEqual([fn.name, fn.range], [row.name, row.range]);
  }
  assert.deepEqual([calleeSource.returnTypeText, callerSource.returnTypeText], ['void', 'i32']);
  assert.deepEqual(callSource.targetRange, calleeSource.range);
  const call = caller.body[0].value;
  assert.deepEqual([call.kind, call.callee, call.range, call.arguments[0].binding],
    ['call', callee.id, callSource.range, callerSource.parameters[0].id]);
  assert.deepEqual(caller.body[1].value.range, returnSource.expressionRange);
  const write = callee.body[0].value;
  assert.deepEqual([write.kind, write.target.range, write.value.range],
    ['fieldAssignment', fieldSource.range, literalSource.range]);
  assert.equal(write.target.receiver.binding, calleeSource.parameters[0].id);
  assert.equal(source.slice(literalSource.range.start, literalSource.range.end), literalSource.text);
  const start = module.text.indexOf('func.func @"program_' + caller.id.slice(7) + '"');
  const end = module.text.indexOf('\n  }', start);
  assert.ok(start >= 0 && end > start);
  const body = module.text.slice(start, end);
  const invoke = body.match(/"tsfg_program\.invoke"[^\n]*?\[\^(\w+), \^(\w+)\]/);
  assert.ok(invoke);
  assert.ok(body.includes('\n  ^' + invoke[1] + ':'));
  assert.ok(body.includes('\n  ^' + invoke[2] + '('));
});

function inspect(graph) {
  const {instructions} = graph;
  const values = new Map(instructions.map(row => [row.id, row]));
  const blocks = new Map(graph.blocks.map(row => [row.id, row]));
  const dominates = (a, b) => a.block === b.block ? a.id < b.id : blocks.get(b.block).dominators.includes(a.block);
  function reaches(from, target) {
    const pending = [from];
    const seen = new Set();
    while (pending.length) {
      const block = pending.pop();
      if (block === target) return true;
      if (seen.has(block)) continue;
      seen.add(block);
      pending.push(...blocks.get(block).successors);
    }
    return false;
  }
  function parameterPlane(pointer) {
    const value = values.get(pointer);
    assert.equal(value.kind, 'load');
    assert.equal(value.pointerResult, true);
    const stores = instructions.filter(row => row.kind === 'store' && row.pointer === value.pointer && dominates(row, value));
    assert.equal(stores.length, 1);
    const plane = graph.entryPlanes.find(row => row.argument === 2);
    assert.equal(stores[0].value, plane.allocation);
    const allocation = values.get(plane.allocation);
    assert.deepEqual([allocation.kind, allocation.element], ['alloca', 'aggregate']);
    const entry = values.get(plane.store);
    assert.deepEqual([entry.kind, entry.value, entry.pointer], ['store', 2, allocation.id]);
    assert.ok(dominates(entry, value));
    return allocation;
  }
  function guard(event, allowedInstruction, failedReturn) {
    assert.ok(event && dominates(event, allowedInstruction));
    const condition = instructions.find(row => row.kind === 'icmp' && row.predicate === 'ne' &&
      row.scalarOperands[0].id === event.id && row.scalarOperands[1].bits === '0');
    assert.ok(condition);
    const branch = instructions.find(row => row.kind === 'br' && row.condition === condition.id);
    assert.ok(branch);
    const [allow, deny] = blocks.get(branch.block).successors;
    assert.equal(reaches(allow, allowedInstruction.block), true);
    assert.equal(reaches(deny, allowedInstruction.block), false);
    assert.equal(reaches(deny, failedReturn.block), true);
    return deny;
  }
  return {instructions, values, dominates, reaches, parameterPlane, guard};
}

function checkVoidCall(report) {
  const callerGraph = report.controlFlows.find(row => row.function === symbol(caller));
  const calleeGraph = report.controlFlows.find(row => row.function === symbol(callee));
  assert.deepEqual(report.irStages.functions.slice().sort(), [symbol(callee), symbol(caller)].sort());
  assert.deepEqual(calleeGraph.resultType, 'void');
  assert.deepEqual(report.physicalCFG.find(row => row.functionId === callee.id), {
    blocks: [0], emptyNormalResult: false, functionId: callee.id, resultCarrier: 'void',
  });
  const origin = inspect(callerGraph), target = inspect(calleeGraph);
  const calls = origin.instructions.filter(row => row.callee === calleeGraph.function);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.returnType, 'void');
  assert.deepEqual(call.argumentTypes, [{pointer: 0}, {pointer: 0}, {fields: [{integer: 32}]}]);
  assert.deepEqual(call.argumentTypes, calleeGraph.parameterTypes);
  assert.deepEqual(call.scalarOperands.slice(0, 2).map(row => row.id), [0, 1]);
  assert.ok(!origin.instructions.some(row => row.scalarOperands.some(operand => operand.id === call.id)));
  const passed = origin.values.get(call.scalarOperands[2].id);
  assert.deepEqual([passed.kind, passed.pointerResult], ['load', false]);
  const copied = origin.values.get(passed.pointer);
  assert.deepEqual([copied.kind, copied.element], ['alloca', 'aggregate']);
  const store = origin.instructions.find(row => row.kind === 'store' && row.pointer === copied.id);
  assert.ok(store && origin.dominates(store, passed));
  const old = origin.values.get(store.value);
  assert.deepEqual([old.kind, old.pointerResult], ['load', false]);
  const originalPlane = origin.parameterPlane(old.pointer);
  assert.notEqual(copied.id, originalPlane.id);

  const returned = origin.instructions.find(row => row.kind === 'ret' && row.value >= 0);
  const failed = origin.instructions.find(row => row.kind === 'ret' && row.value === -1);
  assert.ok(returned && failed);
  const read = origin.values.get(returned.value);
  const address = origin.values.get(read.pointer);
  assert.deepEqual([read.kind, address.kind], ['load', 'getelementptr']);
  assert.deepEqual(address.scalarOperands.slice(1).map(row => row.bits), ['0', '0']);
  assert.equal(origin.parameterPlane(address.pointer).id, originalPlane.id);
  assert.ok(!origin.instructions.some(row => row.kind === 'store' && origin.values.get(row.pointer)?.kind === 'getelementptr'));
  const admission = origin.instructions.find(row => row.eventKind === 0 && row.eventFunction === calleeGraph.sourceIndex);
  assert.deepEqual(admission?.eventSource, calleeSource.range);
  origin.guard(admission, call, failed);
  const checked = origin.instructions.find(row => row.eventKind === 2 && origin.dominates(call, row) &&
    row.eventSource.start === callSource.range.start && row.eventSource.end === callSource.range.end);
  assert.equal(checked?.eventFunction, callerGraph.sourceIndex);
  const denied = origin.guard(checked, read, failed);
  assert.equal(origin.reaches(denied, returned.block), false);
  const access = origin.instructions.find(row => row.eventKind === 2 && row.eventFunction === callerGraph.sourceIndex &&
    row.eventSource.start === returnSource.expressionRange.start && row.eventSource.end === returnSource.expressionRange.end);
  assert.ok(access && origin.dominates(checked, access) && origin.dominates(access, read));

  const writes = target.instructions.filter(row => row.kind === 'store' && target.values.get(row.pointer)?.kind === 'getelementptr');
  assert.equal(writes.length, 1);
  const [write] = writes;
  const member = target.values.get(write.pointer);
  assert.deepEqual(member.scalarOperands.slice(1).map(row => row.bits), ['0', '0']);
  assert.deepEqual([write.scalarOperands[0].width, write.scalarOperands[0].bits], [32, literalSource.text]);
  target.parameterPlane(member.pointer);
  const returns = target.instructions.filter(row => row.kind === 'ret');
  assert.equal(returns.length, 2);
  assert.ok(returns.every(row => row.scalarOperands.length === 0 && !Object.hasOwn(row, 'value')));
  const normal = target.instructions.find(row => row.eventKind === 4);
  assert.ok(normal && target.dominates(write, normal));
  assert.equal(normal.eventFunction, calleeGraph.sourceIndex);
  assert.deepEqual(normal.eventSource, calleeSource.range);
  const complete = returns.find(row => target.dominates(normal, row));
  const fail = returns.find(row => row !== complete);
  assert.ok(complete && fail);
  for (const returned of returns) {
    const leave = target.instructions.find(row => row.eventKind === 3 && row.block === returned.block);
    assert.ok(leave && target.dominates(leave, returned));
    assert.deepEqual([leave.eventFunction, leave.eventSource], [calleeGraph.sourceIndex, calleeSource.range]);
    if (returned === complete) assert.ok(target.dominates(normal, leave));
    else assert.equal(target.reaches(returned.block, normal.block), false);
  }
  return {callerGraph, checked};
}

test('cold LLVM continues after the normal void call without a result value', {
  skip: reportDir ? false : 'TSFG_VALUE_VOID_CALL_REPORT is not supplied',
}, async () => {
  assert.ok(path.isAbsolute(reportDir));
  const observed = JSON.parse(await fs.readFile(path.join(reportDir, 'observed.json'), 'utf8'));
  assert.equal(observed.qualified, true);
  assert.deepEqual([observed.exit.code, observed.close.code, observed.first], [0, 0, []]);
  assert.equal(await fs.readFile(path.join(reportDir, 'raw/stderr.bin'), 'utf8'), '');
  const report = JSON.parse(await fs.readFile(path.join(reportDir, 'raw/stdout.bin'), 'utf8'));
  for (const flag of ['passed', 'completeCoreRetained', 'mlirRoundTrip', 'sameFinalizedLLVMFromMLIR']) {
    assert.equal(report[flag], true);
  }
  assert.deepEqual([report.functionId, report.coreDigest, report.inputIdentity], [caller.id, 'sha256:' + sha(module.text), hir.inputIdentity]);
  assert.equal(report.executionAuthority, false);
  assert.equal(report.resourceProof, null);
  assert.doesNotMatch(report.llvm, /\b(?:undef|poison|unreachable)\b/);
  checkVoidCall(report);
  const changed = structuredClone(report);
  const {callerGraph, checked} = checkVoidCall(changed);
  callerGraph.blocks.find(row => row.id === checked.block).successors.reverse();
  assert.throws(() => checkVoidCall(changed), 'the failed post-call edge may not read the caller field');
});
