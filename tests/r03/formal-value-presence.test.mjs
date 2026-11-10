// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {i32TypeId, sha256} from '../../compiler/identity.mjs';

const reports = process.env.TSFG_VALUE_PRESENCE_REPORT_ROOT;
const index = reports ? JSON.parse(await fs.readFile(path.join(reports, 'index.json'), 'utf8')) : null;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const i32 = {integer: 32};
const undefinedTypeId = sha256('tsfg.type\0undefined');
const i32Undefined = {structName: 'tsfg.fixed.i32_undefined', fields: [{integer: 16}, i32]};
const undefinedTrap = 'r01-t-undefined-numeric-use';
const numericRule = 'r01-numeric-use';
const trapKind = 256;
const fixtures = [
  {
    folder: 'poison-unknown',
    targets: ['poisonUnknownWrite'],
    pins: [
      'ef69fca7a4fba47ffe5b136b64067743163095eea011543c3a6e1af89319ea16',
      '05a86f852ef4a528f3eec5c803a79d7e148528607cae66e9f687aba45e035f09',
      '2794fe6fe2b41cf1f13066c409d451b3efac81ff3d289919924e1ea8c28447f2',
    ],
  },
  {
    folder: 'value-numeric-presence',
    targets: ['valueNumericMaybe', 'valueNumericOnlyUndefined'],
    pins: [
      '1f23493869a34f25a33fd3badf22026b6044ee4ae6c939b89f054333541d87ac',
      '11331bd6b800eecceff46a9740f46b9e24514c8d44ba770cac9c7d3486e3ca0d',
      'd8061bed116ae031c3e66373de2884cd9e78ae44bb87e23da26392a55c5e3352',
    ],
  },
  {
    folder: 'value-numeric-absence-call',
    targets: ['valueAbsenceReturn', 'valueAbsenceConsume'],
    pins: [
      '9dc24800fa691405be4de1f4f3c4cb7c982f4cc5ea67baa58741b29b383c717b',
      'a273b576fe2bf39e43ebb5f843145f32d2acbee3f90fc1c147e3c654d6c3ce34',
      'd8f06b054d8a1f7eaca2a786912c1afacca1d57b2450d04736d64f66acc9a049',
    ],
  },
];

function controlFlow(graph) {
  const instructions = graph.instructions;
  const values = new Map(instructions.map(row => [row.id, row]));
  const blocks = new Map(graph.blocks.map(row => [row.id, row]));
  const dominates = (first, second) => first.block === second.block
    ? first.id < second.id
    : blocks.get(second.block).dominators.includes(first.block);
  function reaches(from, to) {
    const seen = new Set();
    const pending = [from];
    while (pending.length) {
      const block = pending.pop();
      if (block === to) return true;
      if (seen.has(block)) continue;
      seen.add(block);
      pending.push(...blocks.get(block).successors);
    }
    return false;
  }
  function origin(id, seen = new Set()) {
    assert.ok(!seen.has(id), 'fixture value flow is acyclic');
    const next = new Set(seen).add(id);
    const value = values.get(id);
    if (value?.kind === 'phi') {
      const inputs = new Set(value.incoming.map(input => origin(input, next)));
      assert.equal(inputs.size, 1, 'incoming edges retain the same producer');
      return [...inputs][0];
    }
    if (value?.kind === 'load' && values.get(value.pointer)?.kind === 'alloca') {
      const definitions = instructions.filter(row =>
        row.kind === 'store' && row.pointer === value.pointer && dominates(row, value));
      assert.equal(definitions.length, 1, 'fixture alias cell has one reaching definition');
      return origin(definitions[0].value, next);
    }
    return id;
  }
  const branchFor = condition => {
    const branch = instructions.find(row => row.kind === 'br' && row.condition === condition.id);
    assert.ok(branch);
    const successors = blocks.get(branch.block).successors;
    assert.equal(successors.length, 2);
    return successors;
  };
  return {instructions, values, blocks, dominates, reaches, origin, branchFor};
}

function verifyPresence(report, target, hir, module, oracle) {
  const fn = hir.functions.find(row => row.name === target);
  const delta = hir.types.find(row => row.name === 'Delta');
  const field = delta.fields.find(row => row.name === 'n');
  const actualField = module.representation.bindings.find(row => row.id === field.sourceBinding);
  const domain = module.representation.domains.find(row => row.id === actualField.carrier);
  const symbol = 'value_' + fn.id.slice(7);
  const keep = hir.functions.find(row => row.name === 'keep');
  const members = target === 'valueNumericMaybe' ? [symbol, 'value_' + keep.id.slice(7)] : [symbol];
  assert.deepEqual(report.controlFlows.map(row => row.function).sort(), members.slice().sort());
  assert.deepEqual(report.irStages.functions.slice().sort(), members.slice().sort());
  assert.equal(report.irStages.selection, 'exact-closure');
  assert.doesNotMatch(report.llvm, /\b(?:undef|poison|unreachable)\b/);

  const graph = report.controlFlows.find(row => row.function === symbol);
  const {instructions, values, blocks, dominates, reaches, origin, branchFor} = controlFlow(graph);
  const storage = report.actualLayouts.find(row => row.id === delta.id);
  const tagged = report.actualLayouts.find(row => row.id === domain.id);
  assert.equal(report.layouts.types.find(row => row.name === 'Delta').byteSize, 4);
  assert.equal(storage.byteSize, 8);
  assert.equal(storage.alignment, 4);
  assert.deepEqual(storage.fields.map(row => [row.id, row.sourceBinding, row.carrier, row.offset]),
    [[field.id, field.sourceBinding, domain.id, 0]]);
  assert.deepEqual([tagged.byteSize, tagged.alignment, tagged.tagBytes, tagged.payloadOffset], [8, 4, 2, 4]);
  assert.equal(field.type, i32TypeId);
  assert.deepEqual(domain.actualTypes.slice().sort(), [i32TypeId, undefinedTypeId].sort());
  assert.equal(tagged.i32Tag, domain.actualTypes.indexOf(i32TypeId));
  assert.equal(tagged.undefinedTag, domain.actualTypes.indexOf(undefinedTypeId));
  const plane = graph.entryPlanes.find(row => row.argument === 2);
  assert.ok(plane);
  assert.equal(plane.freshEachActivation, true);
  assert.deepEqual(plane.type.fields, [i32Undefined]);
  const native = report.nativeLayouts.find(row => row.function === symbol && row.argument === 2);
  assert.deepEqual([native.byteSize, native.alignment, native.offsets], [8, 4, [0]]);
  function checkFieldAddress(pointer) {
    const address = values.get(pointer);
    assert.equal(address.kind, 'getelementptr');
    assert.deepEqual(address.scalarOperands.slice(1).map(operand => operand.bits), ['0', '0']);
    assert.equal(origin(address.pointer), plane.allocation);
  }

  const callbacks = instructions.filter(row => row.eventKind === trapKind);
  const returns = instructions.filter(row => row.kind === 'ret');
  const fieldStore = instructions.find(row => row.kind === 'store' && values.get(row.pointer)?.kind === 'getelementptr');
  if (target !== 'valueNumericOnlyUndefined') {
    const reads = report.fieldReads.filter(row => row.function === symbol);
    const writes = report.fieldWrites.filter(row => row.function === symbol);
    assert.deepEqual(reads.map(row => [row.indices, row.rootSlot]), [[[0, 0], plane.slot]]);
    assert.deepEqual(writes.map(row => [row.indices, row.rootSlot]), [[[0, 0], plane.slot]]);
    assert.ok(fieldStore);
    checkFieldAddress(fieldStore.pointer);
    const written = fieldStore.constantFields;
    assert.deepEqual(written, [{width: 16, bits: String(tagged.undefinedTag)}, {width: 32, bits: '0'}]);
    if (target === 'poisonUnknownWrite') {
      assert.deepEqual(graph.resultType, i32Undefined);
      assert.deepEqual(report.numericTraps, []);
      assert.equal(callbacks.length, 0);
      const normal = returns.find(row => row.value >= 0);
      assert.ok(normal);
      const load = values.get(origin(normal.value));
      assert.equal(load.kind, 'load');
      checkFieldAddress(load.pointer);
      assert.ok(dominates(fieldStore, load));
      return;
    }
  }

  const declaration = oracle.functions.find(row => row.name === target);
  const expression = oracle.occurrences.find(row =>
    row.kind === 'return' && row.range.start >= declaration.range.start && row.range.end <= declaration.range.end);
  const sourceRange = expression.expressionRange;
  assert.equal(report.numericTraps.length, 1);
  const trap = report.numericTraps[0];
  const operator = target === 'valueNumericMaybe' ? '+' : '-';
  assert.deepEqual(
    [trap.kind, trap.functionId, trap.source, trap.start, trap.end, trap.operator, trap.operandIndex, trap.trap, trap.rule],
    [trapKind, fn.id, '/src/main.ts', sourceRange.start, sourceRange.end, operator, 0, undefinedTrap, numericRule],
  );
  assert.equal(callbacks.length, 1);
  const callback = callbacks[0];
  assert.equal(callback.eventFunction, graph.sourceIndex);
  assert.deepEqual(callback.eventSource, sourceRange);
  assert.equal(callback.scalarOperands[5].bits, String(trap.interval));
  const checkpoint = instructions.find(row =>
    row.eventKind === 2 && row.eventSource.start === sourceRange.start &&
    row.eventSource.end === sourceRange.end && dominates(row, callback));
  assert.ok(checkpoint);
  const allowed = instructions.find(row => row.predicate === 'ne' &&
    row.scalarOperands[0].id === checkpoint.id && row.scalarOperands[1].width === 32 &&
    row.scalarOperands[1].bits === '0');
  assert.ok(allowed);
  const [checked, stopped] = branchFor(allowed);
  assert.equal(reaches(checked, callback.block), true);
  const failed = returns.find(row => row.scalarOperands[0]?.width === 32 && row.scalarOperands[0]?.bits === '0');
  assert.ok(failed);
  assert.equal(stopped, failed.block, 'an earlier checkpoint failure skips consumption and normal work');
  assert.deepEqual(blocks.get(callback.block).successors, [failed.block]);
  assert.deepEqual(blocks.get(failed.block).successors, []);
  const failedLeave = instructions.find(row => row.eventKind === 3 && row.block === failed.block);
  assert.ok(failedLeave && dominates(failedLeave, failed));
  assert.equal(failedLeave.eventFunction, graph.sourceIndex);
  assert.deepEqual(failedLeave.eventSource, fn.range);
  assert.deepEqual(graph.resultType, i32);

  if (target === 'valueNumericOnlyUndefined') {
    const absence = module.representation.domains.find(row => row.representation === 'absence' &&
      row.actualTypes.length === 1 && row.actualTypes[0] === undefinedTypeId);
    const layout = report.actualLayouts.find(row => row.id === absence.id);
    assert.deepEqual([layout.byteSize, layout.alignment, layout.tagBytes], [0, 1, 0]);
    assert.deepEqual(report.physicalCFG, [{
      functionId: fn.id, blocks: [0], resultCarrier: i32TypeId, emptyNormalResult: false,
    }]);
    assert.equal(returns.length, 1);
    assert.equal(instructions.some(row => row.kind === 'sub' || row.eventKind === 4), false);
    return;
  }

  const helper = report.controlFlows.find(row => row.function === 'value_' + keep.id.slice(7));
  const call = instructions.find(row => row.callee === helper.function);
  assert.ok(call);
  assert.deepEqual(call.argumentTypes, helper.parameterTypes);
  assert.deepEqual(call.argumentTypes.slice(2), [i32Undefined]);
  assert.deepEqual(call.returnType, i32Undefined);
  assert.deepEqual(helper.resultType, i32Undefined);
  const argument = values.get(origin(call.scalarOperands[2].id));
  assert.equal(argument.kind, 'load');
  checkFieldAddress(argument.pointer);
  const flagStore = instructions.find(row => row.kind === 'store' && row.value === 3);
  assert.ok(flagStore);
  const flagLoad = instructions.find(row => row.kind === 'load' && row.width === 8 &&
    row.pointer === flagStore.pointer);
  assert.ok(flagLoad);
  const flag = instructions.find(row => row.predicate === 'ne' &&
    row.scalarOperands[0].id === flagLoad.id && row.scalarOperands[1].width === 8 &&
    row.scalarOperands[1].bits === '0');
  assert.ok(flag);
  const [write, keepOriginal] = branchFor(flag);
  assert.ok(fieldStore);
  assert.equal(reaches(write, fieldStore.block), true);
  assert.equal(reaches(keepOriginal, fieldStore.block), false);
  assert.equal(reaches(write, call.block), true);
  assert.equal(reaches(keepOriginal, call.block), true);
  const helperNormal = helper.instructions.find(row => row.kind === 'ret' && row.value >= 0);
  assert.ok(helperNormal);
  assert.equal(controlFlow(helper).origin(helperNormal.value), 2, 'keep returns the actual argument aggregate');
  const callSite = oracle.occurrences.find(row => row.kind === 'call' && row.name === 'keep');
  const afterCall = instructions.find(row =>
    row.eventKind === 2 && row.eventSource.start === callSite.range.start &&
    row.eventSource.end === callSite.range.end && dominates(call, row));
  assert.ok(afterCall && dominates(afterCall, checkpoint));
  const literal = oracle.occurrences.find(row => row.kind === 'literal' && row.text === '7');
  assert.ok(literal);
  const evaluatedRight = instructions.find(row => row.eventKind === 2 &&
    row.eventSource.start === literal.range.start && row.eventSource.end === literal.range.end);
  assert.ok(evaluatedRight && dominates(afterCall, evaluatedRight) && dominates(evaluatedRight, checkpoint));
  const tag = instructions.find(row => row.kind === 'extractvalue' && row.index === 0 && origin(row.aggregate) === call.id);
  assert.ok(tag);
  const present = instructions.find(row => row.predicate === 'eq' &&
    row.scalarOperands.some(operand => operand.id === tag.id) &&
    row.scalarOperands.some(operand => operand.width === 16 && operand.bits === String(tagged.i32Tag)));
  assert.ok(present && dominates(checkpoint, present));
  const [presentBlock, absentBlock] = branchFor(present);
  assert.equal(reaches(presentBlock, callback.block), false);
  assert.equal(reaches(absentBlock, callback.block), true);
  const addition = instructions.find(row => row.kind === 'add' && row.width === 32);
  assert.ok(addition);
  assert.deepEqual([addition.nsw, addition.nuw], [false, false]);
  const right = addition.scalarOperands[1];
  const rightValue = values.get(right.id);
  const rightInputs = rightValue?.kind === 'phi' ? rightValue.scalarOperands : [right];
  assert.ok(rightInputs.length > 0);
  assert.ok(rightInputs.every(operand => operand.width === 32 && operand.bits === literal.text));
  const payload = instructions.find(row => row.kind === 'extractvalue' && row.index === 1 &&
    origin(row.aggregate) === call.id && origin(addition.scalarOperands[0].id) === row.id);
  assert.ok(payload && dominates(present, payload));
  assert.equal(reaches(absentBlock, payload.block), false);
  assert.equal(reaches(absentBlock, addition.block), false);
  assert.equal(reaches(presentBlock, addition.block), true);
  const normal = returns.find(row => row.value >= 0);
  assert.ok(normal);
  assert.equal(origin(normal.value), addition.id);
  assert.equal(reaches(callback.block, normal.block), false);
}

function verifyAbsenceCall(report, target, hir, module, oracle) {
  const entry = hir.functions.find(row => row.name === target);
  const callee = hir.functions.find(row => row.name === 'keepUndefined');
  const graph = report.controlFlows.find(row => row.function === 'value_' + entry.id.slice(7));
  const helper = report.controlFlows.find(row => row.function === 'value_' + callee.id.slice(7));
  assert.deepEqual(report.controlFlows.map(row => row.function).sort(), [graph.function, helper.function].sort());
  const absence = module.representation.domains.find(row => row.representation === 'absence' &&
    row.actualTypes.length === 1 && row.actualTypes[0] === undefinedTypeId);
  const type = {structName: 'tsfg.fixed.undefined', fields: []};
  const layout = report.actualLayouts.find(row => row.id === absence.id);
  assert.deepEqual([layout.byteSize, layout.alignment, layout.tagBytes], [0, 1, 0]);
  const helperPlan = report.physicalCFG.find(row => row.functionId === callee.id);
  assert.equal(helperPlan.resultCarrier, absence.id);
  assert.equal(helperPlan.emptyNormalResult, false);
  assert.deepEqual(helper.resultType, type);
  const helperResult = helper.instructions.find(row => row.eventKind === 4);
  const helperLeave = helper.instructions.find(row => row.eventKind === 3 && row.block === helperResult?.block);
  const helperReturn = helper.instructions.find(row => row.kind === 'ret' && row.block === helperResult?.block);
  assert.ok(helperResult && helperLeave && helperReturn);
  assert.ok(helperResult.id < helperLeave.id && helperLeave.id < helperReturn.id);
  assert.equal(helperReturn.scalarOperands.length, 1);

  const {instructions, blocks, dominates, reaches, origin, branchFor} = controlFlow(graph);
  const call = instructions.find(row => row.callee === helper.function);
  assert.ok(call);
  assert.deepEqual(call.returnType, type);
  assert.deepEqual(call.argumentTypes, helper.parameterTypes);
  const enter = instructions.find(row => row.eventKind === 0 && row.eventFunction === helper.sourceIndex);
  assert.ok(enter && dominates(enter, call));
  assert.deepEqual(enter.eventSource, callee.range);
  const withinEntry = row => row.range.start >= entry.range.start && row.range.end <= entry.range.end;
  const originalCall = oracle.occurrences.find(row => row.kind === 'call' && row.name === callee.name && withinEntry(row));
  const originalReturn = oracle.occurrences.find(row => row.kind === 'return' && withinEntry(row));
  const afterCall = instructions.find(row => row.eventKind === 2 && dominates(call, row) &&
    row.eventSource.start === originalCall.range.start && row.eventSource.end === originalCall.range.end);
  assert.ok(afterCall);
  const allowed = instructions.find(row => row.predicate === 'ne' && row.scalarOperands[0].id === afterCall.id &&
    row.scalarOperands[1].width === 32 && row.scalarOperands[1].bits === '0');
  assert.ok(allowed);
  const [resumed, stopped] = branchFor(allowed);
  if (target === 'valueAbsenceReturn') {
    assert.deepEqual(graph.resultType, type);
    assert.deepEqual(report.numericTraps, []);
    const result = instructions.find(row => row.eventKind === 4);
    assert.ok(result && reaches(resumed, result.block) && !reaches(stopped, result.block));
    assert.deepEqual(result.eventSource, originalReturn.range);
    const returned = instructions.find(row => row.kind === 'ret' && row.block === result.block);
    assert.ok(returned);
    assert.equal(origin(returned.value), call.id);
  } else {
    assert.deepEqual(graph.resultType, i32);
    assert.equal(report.numericTraps.length, 1);
    const trap = report.numericTraps[0];
    const span = originalReturn.expressionRange;
    assert.deepEqual([trap.kind, trap.functionId, trap.source, trap.start, trap.end, trap.operator,
      trap.operandIndex, trap.trap, trap.rule],
    [trapKind, entry.id, '/src/main.ts', span.start, span.end, '-', 0, undefinedTrap, numericRule]);
    const consumed = instructions.find(row => row.eventKind === trapKind);
    assert.ok(consumed && dominates(afterCall, consumed));
    assert.deepEqual(consumed.eventSource, span);
    assert.equal(consumed.scalarOperands[5].bits, String(trap.interval));
    assert.ok(reaches(resumed, consumed.block) && !reaches(stopped, consumed.block));
    assert.deepEqual(blocks.get(consumed.block).successors, [stopped]);
    assert.equal(instructions.some(row => row.eventKind === 4 || row.kind === 'sub'), false);
  }
}

for (const fixture of fixtures) {
  const absenceCall = fixture.folder === 'value-numeric-absence-call';
  const data = await Promise.all(['package.json', 'official-oracle.json', 'source.ts'].map(file =>
    fs.readFile(new URL('./testdata/formal-value-llvm-v3/' + fixture.folder + '/' + file, import.meta.url))));
  assert.deepEqual(data.map(sha), fixture.pins);
  const [packet, oracleBytes, sourceBytes] = data;
  const source = sourceBytes.toString('utf8');
  const oracle = JSON.parse(oracleBytes.toString('utf8'));
  const hir = projectCommonProgram(readCommonProgramFacts(packet));
  const publication = createCommonProgramPublication(hir);
  const module = commonProgramCore(hir, publication, {
    targets: hir.closure.requiredRoots.filter(row => row.kind === 'kernel').map(row => row.target).sort(),
  });

  test('complete fixed-value presence Source retains actual carriers ' + fixture.folder, () => {
    assert.equal(oracle.sourceSha256, sha(sourceBytes));
    assert.deepEqual(oracle.sourceRange, {start: 0, end: source.length});
    assert.equal(hir.sources.find(row => row.path === '/src/main.ts').content, source);
    assert.equal(hir.functions.length, oracle.functions.length);
    for (const original of oracle.functions) {
      const fn = hir.functions.find(row => row.sourceBinding === original.id);
      assert.ok(fn);
      assert.equal(fn.name, original.name);
      assert.deepEqual(fn.range, original.range);
    }
    const delta = hir.types.find(row => row.name === 'Delta');
    const field = delta.fields.find(row => row.name === 'n');
    const binding = module.representation.bindings.find(row => row.id === field.sourceBinding);
    const absence = module.representation.domains.find(row => row.representation === 'absence' &&
      row.actualTypes.length === 1 && row.actualTypes[0] === undefinedTypeId);
    assert.equal(field.type, i32TypeId);
    assert.deepEqual([absence.tagBytes, absence.byteSize, absence.alignment], [0, 0, 1]);
    if (absenceCall) {
      assert.equal(binding.carrier, i32TypeId);
      return;
    }
    const mixed = module.representation.domains.find(row => row.id === binding.carrier);
    assert.deepEqual(mixed.actualTypes.slice().sort(), [undefinedTypeId, i32TypeId].sort());
    assert.deepEqual([mixed.representation, mixed.tagBytes, mixed.byteSize, mixed.alignment], ['finite-union', 2, 8, 4]);
  });

  for (const target of fixture.targets) {
    test('verified fixed-value presence and numeric consumption ' + target, {
      skip: reports ? false : 'TSFG_VALUE_PRESENCE_REPORT_ROOT is not supplied',
    }, async () => {
      assert.ok(path.isAbsolute(reports));
      const directory = index[target];
      assert.ok(path.isAbsolute(directory));
      const observed = JSON.parse(await fs.readFile(path.join(directory, 'observed.json'), 'utf8'));
      assert.equal(observed.qualified, true);
      assert.equal(observed.exit.code, 0);
      assert.equal(observed.close.code, 0);
      assert.deepEqual(observed.first, []);
      assert.equal(await fs.readFile(path.join(directory, 'raw/stderr.bin'), 'utf8'), '');
      const report = JSON.parse(await fs.readFile(path.join(directory, 'raw/stdout.bin'), 'utf8'));
      for (const flag of ['passed', 'completeCoreRetained', 'mlirRoundTrip', 'sameFinalizedLLVMFromMLIR']) {
        assert.equal(report[flag], true);
      }
      const fn = hir.functions.find(row => row.name === target);
      assert.equal(report.functionId, fn.id);
      assert.equal(report.coreDigest, 'sha256:' + sha(module.text));
      assert.equal(report.inputIdentity, hir.inputIdentity);
      assert.equal(report.executionAuthority, false);
      assert.equal(report.resourceProof, null);
      if (absenceCall) {
        verifyAbsenceCall(report, target, hir, module, oracle);
        return;
      }
      verifyPresence(report, target, hir, module, oracle);

      const changed = structuredClone(report);
      if (target === 'poisonUnknownWrite') {
        const tagged = changed.actualLayouts.find(row => row.tagBytes === 2);
        [tagged.i32Tag, tagged.undefinedTag] = [tagged.undefinedTag, tagged.i32Tag];
        changed.controlFlows[0].instructions.find(row => row.constantFields).constantFields[0].bits =
          String(tagged.undefinedTag);
      } else {
        changed.numericTraps[0].end -= 1;
      }
      assert.throws(() => verifyPresence(changed, target, hir, module, oracle));
      if (target === 'poisonUnknownWrite') {
        const misaddressed = structuredClone(report);
        const graph = misaddressed.controlFlows[0];
        const entry = graph.entryPlanes[0];
        const other = graph.instructions.find(row => row.kind === 'alloca' && row.slot !== entry.slot);
        const address = graph.instructions.find(row => row.kind === 'getelementptr');
        address.pointer = other.id;
        address.scalarOperands[0].id = other.id;
        assert.throws(() => verifyPresence(misaddressed, target, hir, module, oracle));
      }
    });
  }
}
