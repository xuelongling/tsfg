// SPDX-License-Identifier: MIT
// A complete selected String HIR is lowered through the existing SSA producer.
import descriptor from '../contracts/core-string-candidate.schema.json' with { type: 'json' };
import { canonical, sha256 } from './identity.mjs';
import { emitCoreSsaFunction, coreQuote as quote, privateCoreExchangeFormat } from './core-ssa-emitter.mjs';
import { readStringFactsContext, stringHirFailure, stringHirType, verifyStringHir } from './string-hir-model.mjs';

const schemaHash = sha256(canonical(descriptor));
function outputLimit() {
  throw Object.assign(new TypeError('r03-d-core-string-limit: String Core output exceeds byte limit'), {
    code: 'r03-d-core-string-limit', ruleId: 'r01-input-boundary', phase: 'lowering',
  });
}

export function emitStringCore(hir, context) {
  // Preserve the existing context-before-HIR validation and exact error ownership.
  const verified = verifyStringHir(hir, context);
  // This existing boundary reads data descriptors and snapshots bytes safely. The
  // verifier returns HIR only; this bounded second parse retains its public API.
  const { factsVersion } = readStringFactsContext(context);
  const source = verified.source;
  const coreType = type => {
    if (type !== stringHirType.id) stringHirFailure('invalid');
    return '!tsfg_string.string';
  };
  const attributes = [
    'tsfg_core.version = ' + quote(privateCoreExchangeFormat.version),
    'tsfg_core.input_identity = ' + quote(verified.inputIdentity),
    'tsfg_core.source_hash = ' + quote(source.hash), 'tsfg_core.source_path = ' + quote(source.path),
    'tsfg_core.target = ' + quote(verified.target.target), 'tsfg_core.triple = ' + quote(verified.target.triple),
    'tsfg_core.data_layout = ' + quote(verified.target.llvmDataLayout),
    'tsfg_core.bytecode_schema = ' + quote(privateCoreExchangeFormat.bytecodeSchema),
    'tsfg_core.source_length = ' + source.content.length + ' : i64',
    'tsfg_core.string = {family = ' + quote(descriptor.family) + ', version = ' + descriptor.version
      + ' : i32, schema = ' + quote(schemaHash) + ', profile = ' + quote(descriptor.profile)
      + ', facts_version = ' + factsVersion + ' : i32}',
    'tsfg_string.function_ids = [' + verified.functions.map(fn => quote(fn.id)).join(', ') + ']',
  ];
  let bytes = 0;
  const reserve = text => {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > descriptor.limits.outputBytes) outputLimit();
    return text;
  };
  const header = reserve('module attributes {' + attributes.join(', ') + '} {\n');
  const functions = verified.functions.map((fn, index) => {
    if (index) reserve('\n');
    // The verified profile has one return and one literal or three concat values.
    const values = fn.body[0].value.kind === 'stringConcat' ? 3 : 1;
    let lines = 0, blocks = 0, parameters = 0, registers = 0, steps = 0;
    const requireShape = condition => { if (!condition) stringHirFailure('invalid'); };
    const core = emitCoreSsaFunction(fn, { verified, coreType, functionSymbol: target => target.name,
      budget: {
        block: count => requireShape(count === ++blocks && count === descriptor.limits.blocksPerFunction),
        parameters: count => requireShape(++parameters === 1 && count === 0),
        register: count => requireShape(count === ++registers && count <= values),
        step: () => requireShape(++steps <= values + 1),
        line: text => {
          requireShape(lines < values + 2 && lines < descriptor.limits.operationsPerFunction);
          reserve((lines++ ? '\n' : '') + text);
        },
      },
      emitValueLeaf: (expression, api) => {
        if (expression.kind === 'stringConstant') return api.operation('tsfg_string.constant', [], [],
          expression.type, 'code_units = array<i32'
            + (expression.codeUnits.length ? ': ' + expression.codeUnits.join(', ') : '') + '>', expression.range);
        if (expression.kind !== 'stringConcat') stringHirFailure('invalid');
        const left = api.emit(expression.left), right = api.emit(expression.right);
        return api.operation('tsfg_string.concat', [left, right], [expression.left.type, expression.right.type],
          expression.type, 'tsfg_source.operator_start = ' + expression.operatorRange.start
            + ' : i64, tsfg_source.operator_end = ' + expression.operatorRange.end + ' : i64', expression.range);
      },
    });
    requireShape(blocks === 1 && parameters === 1 && registers === values
      && steps === values + 1 && lines === values + 2);
    const functionAttributes = 'tsfg_core.function_id = ' + quote(fn.id)
      + ', tsfg_core.signature_hash = ' + quote(fn.signatureHash) + ', tsfg_core.type_id = ' + quote(fn.returnType.id)
      + ', tsfg_core.function_start = ' + fn.range.start + ' : i64, tsfg_core.function_end = ' + fn.range.end + ' : i64';
    const prefix = reserve('  func.func @' + quote(fn.name) + '() -> ' + core.resultType
      + ' attributes {' + functionAttributes + '} {\n');
    return prefix + core.blocksText + reserve('\n  }');
  });
  const footer = reserve('\n}\n'), result = header + functions.join('\n') + footer;
  // Include every wrapper, separator and shared SSA line in the complete UTF8 bound.
  if (Buffer.byteLength(result, 'utf8') > descriptor.limits.outputBytes) outputLimit();
  return result;
}
