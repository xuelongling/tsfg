// SPDX-License-Identifier: MIT
import { emitCoreSsaFunction, coreQuote as quote, coreExchangeFormat } from './core-ssa-emitter.mjs';
import { verifyStringHir, stringHirType, stringHirFailure } from './string-hir-model.mjs';

// Compile the complete owned HIR directly into ordinary Core. Private packet
// bytes, candidate marker metadata and cold handles never enter this boundary.
export function emitFormalStringCore(hir, context) {
  const verified = verifyStringHir(hir, context), source = verified.source;
  const type = id => {
    if (id !== stringHirType.id) stringHirFailure('invalid');
    return '!tsfg_string.string';
  };
  const attrs = {
    version: coreExchangeFormat.version, input_identity: verified.inputIdentity,
    source_hash: source.hash, source_path: source.path, target: verified.target.target,
    triple: verified.target.triple, data_layout: verified.target.llvmDataLayout,
    bytecode_schema: coreExchangeFormat.bytecodeSchema,
  };
  const functions = verified.functions.map(fn => {
    const core = emitCoreSsaFunction(fn, { verified, coreType: type,
      functionSymbol: target => target.name,
      emitValueLeaf(expression, api) {
        if (expression.kind === 'stringConstant')
          return api.operation('tsfg_string.constant', [], [], expression.type,
            'code_units = array<i32' + (expression.codeUnits.length ? ': ' + expression.codeUnits.join(', ') : '') + '>', expression.range);
        if (expression.kind !== 'stringConcat') stringHirFailure('invalid');
        const left = api.emit(expression.left), right = api.emit(expression.right);
        return api.operation('tsfg_string.concat', [left, right], [expression.left.type, expression.right.type], expression.type,
          'tsfg_source.operator_start = ' + expression.operatorRange.start + ' : i64, tsfg_source.operator_end = '
          + expression.operatorRange.end + ' : i64', expression.range);
      },
    });
    const metadata = 'tsfg_core.function_id = ' + quote(fn.id)
      + ', tsfg_core.signature_hash = ' + quote(fn.signatureHash)
      + ', tsfg_core.type_id = ' + quote(fn.returnType.id)
      + ', tsfg_core.function_start = ' + fn.range.start + ' : i64'
      + ', tsfg_core.function_end = ' + fn.range.end + ' : i64';
    return '  func.func @' + quote(fn.name) + '() -> ' + core.resultType
      + ' attributes {' + metadata + '} {\n' + core.blocksText + '\n  }';
  });
  const result = 'module attributes {' + Object.entries(attrs).map(([key, value]) => 'tsfg_core.' + key + ' = ' + quote(value)).join(', ')
    + ', tsfg_core.source_length = ' + source.content.length + ' : i64} {\n' + functions.join('\n') + '\n}\n';
  if (Buffer.byteLength(result) > 8388608)
    throw Object.assign(new TypeError('r03-d-core-string-limit: formal Core exceeds byte limit'), { code: 'r03-d-core-string-limit', ruleId: 'r01-input-boundary', phase: 'lowering' });
  return result;
}
