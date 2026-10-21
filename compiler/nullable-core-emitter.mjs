// SPDX-License-Identifier: MIT
import { boolTypeId } from './identity.mjs';
import { verifyNullableHir } from './nullable-hir.mjs';
import { check, coreSchema, scalarType, typeFor, presenceMask, candidate } from './nullable-common.mjs';
import { emitCoreSsaFunction, coreQuote as quote, privateCoreExchangeFormat } from './core-ssa-emitter.mjs';

const presenceBoolTypeId = candidate('tsfg.core-nullable-candidate.type.v1', { kind: 'scalar', name: 'bool' });

// Compile verified private HIR to the existing 20b typed Core contract. This
// emits text only and grants no native, packet, loader or runtime qualification.
export function emitNullableCore(hir, context = undefined) {
  const verified = verifyNullableHir(hir, context), source = verified.source;
  const coreType = type => {
    if (type === scalarType.id) return 'i32';
    if (type === boolTypeId || context !== undefined && type === presenceBoolTypeId) return 'i1';
    const mask = presenceMask(typeFor(type)); check(mask !== 0, 'type'); return '!tsfg_nullable.i32<' + mask + '>';
  };
  const moduleAttributes = [
    'tsfg_core.version = "0.9.0"', 'tsfg_core.input_identity = ' + quote(verified.inputIdentity),
    'tsfg_core.source_hash = ' + quote(source.hash), 'tsfg_core.source_path = ' + quote(source.path),
    'tsfg_core.target = ' + quote(verified.target.target), 'tsfg_core.triple = ' + quote(verified.target.triple),
    'tsfg_core.data_layout = ' + quote(verified.target.llvmDataLayout), 'tsfg_core.bytecode_schema = ' + quote(privateCoreExchangeFormat.bytecodeSchema),
    'tsfg_core.source_length = ' + source.content.length + ' : i64',
    'tsfg_core.nullable = {family = "tsfg.core-nullable-candidate", version = 1 : i32, schema = ' + quote(coreSchema) + ', profile = "i32-null-undefined-internal-v1"}',
  ];
  let bytes = 0, work = 0;
  const reserve = text => { bytes += Buffer.byteLength(text); check(bytes <= 8388608, 'limit'); return text; };
  const header = reserve('module attributes {' + moduleAttributes.join(', ') + '} {\n');
  const functions = verified.functions.map(fn => {
    const core = emitCoreSsaFunction(fn, { verified, coreType, functionSymbol: target => target.name,
      budget: { line: text => reserve(text + '\n'), register: count => check(count <= 1000000, 'limit'),
        block: count => check(count <= 4096, 'limit'), parameters: count => check(count <= 64, 'limit'), step: () => check(++work <= 1000000, 'limit') },
      emitValueLeaf: (expression, api) => {
        if (expression.kind === 'nullableTagTest') return api.operation('tsfg_nullable.tag_test',
          [api.emit(expression.operand)], [expression.operand.type], expression.type, 'tag = ' + expression.tag + ' : i32', expression.range);
        if (expression.kind === 'nullableGet') return api.operation('tsfg_nullable.get',
          [api.emit(expression.operand)], [expression.operand.type], expression.type, '', expression.range);
        if (expression.kind === 'nullableCoalesce') {
          const left = api.emit(expression.left), anchor = expression.left.range;
          const present = api.operation('tsfg_nullable.tag_test', [left], [expression.left.type], boolTypeId, 'tag = 0 : i32', anchor);
          return api.branchValue(present, expression.type, expression.range,
            () => api.operation('tsfg_nullable.get', [left], [expression.left.type], expression.type, '', anchor),
            () => api.emit(expression.right));
        }
        if (expression.kind !== 'nullableWrap') return undefined;
        return api.operation('tsfg_nullable.wrap_i32', [api.emit(expression.operand)], [expression.operand.type], expression.type, '', expression.range);
      },
    });
    const attrs = 'tsfg_core.function_id = ' + quote(fn.id) + ', tsfg_core.signature_hash = ' + quote(fn.signatureHash)
      + ', tsfg_core.type_id = ' + quote(fn.returnType.id) + ', tsfg_core.function_start = ' + fn.range.start
      + ' : i64, tsfg_core.function_end = ' + fn.range.end + ' : i64, tsfg_nullable.role = ' + quote(fn.role);
    const prefix = reserve('  func.func @' + quote(fn.name) + '(' + core.entryParameters.map(p => p.name + ': ' + coreType(p.type)).join(', ')
      + ') -> ' + core.resultType + ' attributes {' + attrs + '} {\n');
    const suffix = '\n  }'; reserve('  }'); reserve('\n');
    return prefix + core.blocksText + suffix;
  });
  reserve('}\n'); const result = header + functions.join('\n') + '\n}\n';
  // Ordinary SSA block labels are assembled outside the incremental line budget.
  if (context !== undefined) check(Buffer.byteLength(result) <= 8388608, 'limit');
  return result;
}
