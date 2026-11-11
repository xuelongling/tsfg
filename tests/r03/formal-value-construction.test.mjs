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
const reportRoot = process.env.TSFG_VALUE_CONSTRUCTION_REPORT_ROOT;
const reports = reportRoot ? JSON.parse(await fs.readFile(path.join(reportRoot, 'index.json'), 'utf8')) : {};
const fixtures = [{
  folder: 'value-implicit-construction',
  pins: [
    '379a2006f5e785f7ffc3526bbec4c3954011b22c98c2b011caace410dc0b92b7',
    '0a291ed8cff63c8c44bd61c6a4d1ad5a3d479bfc48b08498bb9ee444760887ca',
    '02e0d88da615f35f777db25206ee9bcac56c004c92b7a9e43d1b1ae0b8c9a6e0',
  ],
}, {
  folder: 'value-loop-construction',
  pins: [
    'e10dc99bfa04a9a04838c6611ccce538c1902d16fd558c78075811216077c728',
    '2df2efc27f13f33f88e63aa9cb0462304125da03a451c37eb50061345fde6dc6',
    '1b7ebf08f924e3c1eca2b57c6078596eabd96d4c25f616b75ee1076541578667',
  ],
}];

function checkConstruction(report, symbol, target, expected) {
  const graph = report.controlFlows.find(row => row.function === symbol);
  assert.ok(graph);
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
  function producer(id, seen = new Set()) {
    assert.ok(!seen.has(id), 'the fixture has a single reaching producer');
    const next = new Set(seen).add(id);
    const value = values.get(id);
    assert.ok(value);
    if (value.kind === 'phi') {
      const incoming = new Set(value.incoming.map(row => producer(row, next)));
      assert.equal(incoming.size, 1);
      return [...incoming][0];
    }
    return id;
  }
  function plane(id, seen = new Set()) {
    id = producer(id);
    assert.ok(!seen.has(id), 'constructor plane flows without an alias cycle');
    const next = new Set(seen).add(id);
    const value = values.get(id);
    if (value.kind === 'load' && value.pointerResult) {
      const stores = instructions.filter(row => row.kind === 'store' && row.pointer === value.pointer && dominates(row, value));
      assert.equal(stores.length, 1);
      return plane(stores[0].value, next);
    }
    assert.deepEqual([value.kind, value.element], ['alloca', 'aggregate']);
    return id;
  }
  function guard(instruction, range) {
    const event = instructions.filter(row => row.eventKind === 2 &&
      row.eventSource.start === range.start && row.eventSource.end === range.end && dominates(row, instruction)).at(-1);
    assert.ok(event);
    assert.equal(event.eventFunction, graph.sourceIndex);
    const predicate = instructions.find(row => row.kind === 'icmp' && row.predicate === 'ne' &&
      row.scalarOperands[0].id === event.id && row.scalarOperands[1].bits === '0');
    assert.ok(predicate);
    const branch = instructions.find(row => row.kind === 'br' && row.condition === predicate.id);
    assert.ok(branch);
    const [allowed, failed] = blocks.get(branch.block).successors;
    assert.equal(reaches(allowed, instruction.block), true);
    assert.equal(reaches(failed, instruction.block), false);
    return event;
  }
  const fieldWrites = instructions.filter(row => row.kind === 'store' && values.get(row.pointer)?.kind === 'getelementptr');
  const sites = expected.sites.filter(site => site.function === target);
  assert.ok(sites.length > 0);
  const initializerCount = expected.initializers.length;
  const initWrites = fieldWrites.slice(0, sites.length * initializerCount);
  assert.equal(initWrites.length, sites.length * initializerCount);
  const planes = new Set();
  const copies = [];
  for (const [index, site] of sites.entries()) {
    const writes = initWrites.slice(index * initializerCount, (index + 1) * initializerCount);
    const fresh = plane(values.get(writes[0].pointer).pointer);
    const allocated = values.get(fresh);
    assert.ok(!planes.has(fresh));
    planes.add(fresh);
    assert.equal(allocated.block === graph.blocks[0].id, false, 'allocate at the source construction, after entry');
    assert.equal(allocated.repeating, target === 'valueConstructLoop');
    if (target === 'valueConstructLoop') {
      const fuel = instructions.find(row => row.eventKind === 1 &&
        row.eventSource.start >= site.loopRange.start && row.eventSource.end <= site.loopRange.end);
      assert.ok(fuel && dominates(fuel, allocated) && reaches(allocated.block, fuel.block));
    }
    guard(allocated, site.range);
    for (const [member, initializer] of expected.initializers.entries()) {
      const write = writes[member];
      const address = values.get(write.pointer);
      assert.equal(plane(address.pointer), fresh);
      assert.deepEqual(address.scalarOperands.slice(1).map(operand => operand.bits), ['0', String(member)]);
      assert.deepEqual([write.scalarOperands[0].width, write.scalarOperands[0].bits], [32, initializer.text]);
      assert.ok(dominates(member === 0 ? allocated : writes[member - 1], write));
      const storeEvent = guard(write, initializer.field);
      const literalEvent = guard(write, initializer.initializer);
      assert.ok(dominates(literalEvent, storeEvent));
    }
    const copy = report.copies.filter(row => row.function === symbol && row.sourceSlot === allocated.slot);
    assert.equal(copy.length, 1);
    assert.equal(copy[0].separateStorage, true);
    const copied = instructions.find(row => row.kind === 'alloca' && row.slot === copy[0].targetSlot);
    assert.ok(copied);
    const store = instructions.find(row => row.kind === 'store' && row.pointer === copied.id);
    assert.ok(store);
    const read = values.get(store.value);
    assert.equal(read.kind, 'load');
    assert.equal(plane(read.pointer), fresh);
    assert.ok(dominates(writes.at(-1), read));
    assert.ok(dominates(writes.at(-1), guard(read, site.range)));
    copies.push(copied.id);
  }
  const returned = instructions.find(row => row.kind === 'ret' && row.value >= 0);
  assert.ok(returned);
  const read = values.get(returned.value);
  assert.equal(read.kind, 'load');
  if (target === 'valueConstruct') {
    assert.equal(fieldWrites.length, initWrites.length);
    assert.equal(plane(read.pointer), copies[0]);
  } else if (target === 'valueConstructLoop') {
    assert.equal(fieldWrites.length, initWrites.length + 1);
    const allocation = values.get([...planes][0]);
    const condition = instructions.find(row => row.kind === 'icmp' && row.predicate === 'ne' &&
      row.scalarOperands[1].width === 8 && row.scalarOperands[1].bits === '0');
    assert.ok(condition && values.get(condition.scalarOperands[0].id)?.kind === 'load');
    const branch = instructions.find(row => row.kind === 'br' && row.condition === condition.id);
    assert.ok(branch && dominates(branch, allocation));
    const [entered, finished] = blocks.get(branch.block).successors;
    assert.equal(reaches(entered, allocation.block), true);
    assert.equal(reaches(finished, allocation.block), false);
    assert.equal(reaches(finished, returned.block), true);
    const mutation = fieldWrites.at(-1);
    assert.equal(mutation.scalarOperands[0].bits, '41');
    const fields = instructions.filter(row => row.kind === 'load' && values.get(row.pointer)?.kind === 'getelementptr');
    assert.deepEqual(fields.map(row => {
      const address = values.get(row.pointer);
      assert.equal(plane(address.pointer), copies[0]);
      return address.scalarOperands.slice(1).map(index => index.bits);
    }), [['0', '0'], ['0', '1']]);
    assert.equal(plane(values.get(mutation.pointer).pointer), copies[0]);
    const sum = instructions.find(row => row.kind === 'add' && row.width === 32 &&
      producer(row.scalarOperands[0].id) === fields[0].id && producer(row.scalarOperands[1].id) === fields[1].id);
    assert.ok(sum && dominates(sum, mutation));
    assert.deepEqual([sum.nsw, sum.nuw], [false, false]);
    assert.ok(instructions.some(row => row.kind === 'store' && row.pointer === read.pointer &&
      row.scalarOperands[0].bits === '0' && dominates(row, read)));
    assert.ok(instructions.some(row => row.kind === 'store' && row.pointer === read.pointer &&
      row.value === sum.id && dominates(sum, row)));
  } else {
    assert.equal(fieldWrites.length, initWrites.length + 1);
    const mutation = fieldWrites.at(-1);
    assert.equal(mutation.scalarOperands[0].bits, '41');
    const firstField = values.get(mutation.pointer);
    const secondField = values.get(read.pointer);
    for (const field of [firstField, secondField]) {
      assert.equal(field.kind, 'getelementptr');
      assert.deepEqual(field.scalarOperands.slice(1).map(row => row.bits), ['0', '0']);
    }
    assert.equal(plane(firstField.pointer), copies[0]);
    assert.equal(plane(secondField.pointer), copies[1]);
    assert.notEqual(copies[0], copies[1]);
    assert.ok(dominates(mutation, read));
  }
}

for (const fixture of fixtures) {
  const files = await Promise.all(['package.json', 'official-oracle.json', 'source.ts'].map(name =>
    fs.readFile(new URL('./testdata/formal-value-llvm-v3/' + fixture.folder + '/' + name, import.meta.url))));
  assert.deepEqual(files.map(sha), fixture.pins);
  const [packet, oracleBytes, sourceBytes] = files;
  const oracle = JSON.parse(oracleBytes.toString('utf8'));
  const source = sourceBytes.toString('utf8');
  const hir = projectCommonProgram(readCommonProgramFacts(packet));
  const publication = createCommonProgramPublication(hir);
  const module = commonProgramCore(hir, publication, {
    targets: hir.closure.requiredRoots.filter(row => row.kind === 'kernel').map(row => row.target).sort(),
  });
  const expected = oracle.construction;
  const type = hir.types.find(row => row.name === expected.class && row.kind === 'value');
  test('complete official fixed-value construction Source ' + fixture.folder, () => {
    assert.equal(oracle.sourceSha256, sha(sourceBytes));
    assert.deepEqual(oracle.sourceRange, {start: 0, end: source.length});
    assert.deepEqual(oracle.diagnostics, []);
    assert.equal(hir.sources.find(row => row.path === '/src/main.ts').content, source);
    assert.equal(hir.functions.length, oracle.functions.length);
    for (const original of oracle.functions) {
      const fn = hir.functions.find(row => row.sourceBinding === original.id);
      assert.ok(fn);
      assert.equal(fn.name, original.name);
      assert.deepEqual(fn.range, original.range);
    }
    assert.ok(type);
    assert.deepEqual(type.origin.range, expected.classRange);
    assert.equal(type.base ?? null, null);
    assert.equal(type.construction.kind, 'implicit-base');
    assert.deepEqual(type.construction.initializationFields, type.fields.map(field => field.id));
    assert.deepEqual(type.fields.map(field => [field.name, field.origin.start, field.origin.end]),
      expected.initializers.map(row => [row.name, row.field.start, row.field.end]));
    for (const row of expected.initializers) {
      assert.equal(source.slice(row.initializer.start, row.initializer.end), row.text);
    }
    for (const site of expected.sites) {
      assert.equal(source.slice(site.calleeRange.start, site.calleeRange.end), expected.class);
      assert.equal(source.slice(site.range.start, site.range.end), 'new ' + expected.class + '()');
      if (site.loopRange) {
        assert.ok(site.loopRange.start < site.range.start && site.range.end < site.loopRange.end);
        assert.match(source.slice(site.loopRange.start, site.loopRange.end), /^while\s*\(/);
      }
    }
  });
  for (const target of new Set(expected.sites.map(row => row.function))) {
    test('cold fixed-value LLVM constructs an owned initialized plane ' + target, {
      skip: reportRoot ? false : 'TSFG_VALUE_CONSTRUCTION_REPORT_ROOT is not supplied',
    }, async () => {
      assert.ok(path.isAbsolute(reportRoot));
      const directory = reports[target];
      assert.ok(path.isAbsolute(directory));
      const observed = JSON.parse(await fs.readFile(path.join(directory, 'observed.json'), 'utf8'));
      assert.equal(observed.qualified, true);
      assert.deepEqual([observed.exit.code, observed.close.code, observed.first], [0, 0, []]);
      assert.equal(await fs.readFile(path.join(directory, 'raw/stderr.bin'), 'utf8'), '');
      const report = JSON.parse(await fs.readFile(path.join(directory, 'raw/stdout.bin'), 'utf8'));
      for (const flag of ['passed', 'completeCoreRetained', 'mlirRoundTrip', 'sameFinalizedLLVMFromMLIR']) {
        assert.equal(report[flag], true);
      }
      const fn = hir.functions.find(row => row.name === target);
      const symbol = 'value_' + fn.id.slice(7);
      assert.equal(report.functionId, fn.id);
      assert.equal(report.coreDigest, 'sha256:' + sha(module.text));
      assert.equal(report.inputIdentity, hir.inputIdentity);
      assert.equal(report.executionAuthority, false);
      assert.equal(report.resourceProof, null);
      assert.deepEqual(report.irStages.functions, [symbol]);
      const start = module.text.indexOf('func.func @"program_' + fn.id.slice(7) + '"');
      const end = module.text.indexOf('\n  }', start);
      assert.ok(start >= 0 && end > start);
      const body = module.text.slice(start, end);
      const blockOrdinals = new Map([...body.matchAll(/^ +\^(\w+)[(:]/gm)]
        .map((match, index) => [match[1], index + 1]));
      const receiverEdges = [...body.matchAll(
        /"tsfg_program\.receiver_(?:bind|result)"[^\n]*?\[\^(\w+), \^(\w+)\]/g)];
      const sourceSites = expected.sites.filter(row => row.function === target);
      assert.equal(receiverEdges.length, sourceSites.length * 2);
      const physical = report.physicalCFG.find(row => row.functionId === fn.id);
      for (const [, normal, language] of receiverEdges) {
        assert.ok(blockOrdinals.has(normal) && blockOrdinals.has(language));
        assert.ok(physical.blocks.includes(blockOrdinals.get(normal)));
        assert.ok(!physical.blocks.includes(blockOrdinals.get(language)));
      }
      const layout = report.actualLayouts.find(row => row.id === type.id);
      assert.deepEqual([layout.byteSize, layout.alignment], [8, 4]);
      assert.deepEqual(layout.fields.map(row => [row.id, row.offset]), type.fields.map((row, index) => [row.id, 4 * index]));
      assert.doesNotMatch(report.llvm, /\b(?:undef|poison|unreachable)\b/);
      checkConstruction(report, symbol, target, expected);
      if (target === 'valueConstructIndependent') {
        const changed = structuredClone(report);
        const graph = changed.controlFlows.find(row => row.function === symbol);
        const fields = graph.instructions.filter(row => row.kind === 'getelementptr');
        fields.at(-1).pointer = fields.at(-2).pointer;
        assert.throws(() => checkConstruction(changed, symbol, target, expected), 'redirecting the second field read to the first plane fails');
      }
    });
  }
}
