// SPDX-License-Identifier: MIT
// Whole owned Array HIR uses the shared SSA definition and emission machinery.
import descriptor from '../contracts/core-array-candidate.schema.json' with { type: 'json' };
import { canonical, sha256, scalarTypeIds } from './identity.mjs';
import { emitCoreSsaFunction, coreQuote as quote, coreExchangeFormat } from './core-ssa-emitter.mjs';
import { arrayHirType, verifyArrayHir, arrayHirFailure } from './array-hir-model.mjs';

const schemaHash = sha256(canonical(descriptor));
const span = range => 'array<i64' + (range ? ': ' + range.start + ', ' + range.end : '') + '>';
const field = (key, value) => key + ' = ' + quote(value);
const dictionary = fields => '{' + fields.join(', ') + '}';
const table = rows => '[' + rows.join(', ') + ']';
function outputLimit() {
  throw Object.assign(new TypeError('r03-d-core-array-limit: Array Core output exceeds byte limit'), {
    code: 'r03-d-core-array-limit', ruleId: 'r01-input-boundary', phase: 'lowering',
  });
}
function localMetadata(statement) {
  const binding = statement.binding;
  return dictionary([field('id', binding.id), field('name', binding.name),
    'statement_range = ' + span(statement.range), 'declaration_range = ' + span(binding.range),
    'name_range = ' + span(binding.nameRange), 'annotation_range = ' + span(binding.annotationRange),
    'element_annotation_range = ' + span(binding.elementAnnotationRange)]);
}
export function emitArrayCore(hir, context) {
  // Context and the complete graph are validated before accessing any HIR field.
  const verified = verifyArrayHir(hir, context);
  const source = verified.sources.find(item => item.path === verified.rootFile);
  const attributes = [field('tsfg_core.version', coreExchangeFormat.version),
    field('tsfg_core.input_identity', verified.inputIdentity), field('tsfg_core.source_hash', source.hash),
    field('tsfg_core.source_path', source.path), field('tsfg_core.target', verified.target.target),
    field('tsfg_core.triple', verified.target.triple), field('tsfg_core.data_layout', verified.target.llvmDataLayout),
    field('tsfg_core.bytecode_schema', coreExchangeFormat.bytecodeSchema),
    'tsfg_core.source_length = ' + source.content.length + ' : i64',
    'tsfg_core.array = ' + dictionary([field('family', descriptor.family), 'version = 1 : i32',
      field('schema', schemaHash), field('profile', descriptor.profile), 'facts_version = 1 : i32']),
    'tsfg_array.function_ids = ' + table(verified.functions.map(fn => quote(fn.id))),
    'tsfg_array.exports = ' + table(verified.exports.map(item => dictionary([
      field('name', item.name), field('function_id', item.functionId)]))),
    'tsfg_array.sources = ' + table(verified.sources.map(item => dictionary([field('path', item.path),
      field('hash', item.hash), 'utf16_length = ' + item.content.length + ' : i64']))),
    'tsfg_array.types = ' + table(verified.types.map(item => dictionary([
      field('id', item.id), field('kind', item.kind), field('name', item.name), field('source_path', item.sourcePath),
      'declaration_range = ' + span(item.declarationRange), 'name_range = ' + span(item.nameRange),
      ...(item.id === arrayHirType.id ? [field('element_type', item.elementType),
        'index_signature_range = ' + span(item.indexSignatureRange)] : [])]))),
    field('tsfg_array.request_id', verified.facts.requestId)];
  let bytes = 0;
  const reserve = text => {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > descriptor.limits.outputBytes) outputLimit();
    return text;
  };
  const header = reserve('module attributes {' + attributes.join(', ') + '} {\n');
  const coreType = type => {
    if (type === arrayHirType.id) return '!tsfg_array.array_f64';
    if (type === scalarTypeIds.f64) return 'f64';
    if (type === scalarTypeIds.u32) return '!tsfg_core.integer<"u32">';
    arrayHirFailure('invalid');
  };
  const functions = verified.functions.map((fn, index) => {
    if (index) reserve('\n');
    const locals = fn.body.filter(statement => statement.kind === 'local');
    const owners = new Map(locals.map(statement => [statement.initializer, statement]));
    const elements = locals.reduce((sum, statement) => sum + (statement.initializer.elements?.length ?? 0), 0);
    const count = locals.length, expected = { registers: elements + count + 2,
      lines: elements + count + 4, steps: elements + 2 * count + 4 };
    let blocks = 0, parameters = 0, registers = 0, lines = 0, steps = 0;
    const shape = condition => { if (!condition) arrayHirFailure('invalid'); };
    const core = emitCoreSsaFunction(fn, { verified, coreType, functionSymbol: target => target.name,
      budget: {
        block: value => shape(value === ++blocks && value === 1),
        parameters: value => shape(++parameters === 1 && value === 0),
        register: value => shape(value === ++registers && value <= expected.registers
          && value <= descriptor.limits.registersPerFunction),
        step: () => shape(++steps <= expected.steps && steps <= descriptor.limits.sharedStepsPerFunction),
        line: text => {
          shape(lines < expected.lines && lines < descriptor.limits.operationsPerFunction);
          reserve((lines++ ? '\n' : '') + text);
        },
      },
      emitValueLeaf: (expression, api) => {
        const statement = owners.get(expression);
        if (statement) {
          if (expression.kind === 'arrayCreate') {
            const operands = expression.elements.map(api.emit);
            return api.operation('tsfg_array.create', operands, expression.elements.map(item => item.type),
              expression.type, field('allocation_site', expression.allocationSite)
                + ', local = ' + localMetadata(statement), expression.range);
          }
          return api.operation('tsfg_array.alias', [api.lookup(expression.binding)], [expression.type],
            expression.type, field('target_binding', expression.binding)
              + ', local = ' + localMetadata(statement), expression.range);
        }
        if (expression.kind === 'arrayReadChecked') {
          const receiver = api.emit(expression.receiver), index = api.emit(expression.index);
          return api.operation('tsfg_array.read_checked', [receiver, index],
            [expression.receiver.type, expression.index.type], expression.type,
            field('receiver_binding', expression.receiver.binding) + ', receiver_range = '
              + span(expression.receiver.range), expression.range);
        }
      },
    });
    shape(blocks === 1 && parameters === 1 && registers === expected.registers
      && lines === expected.lines && steps === expected.steps);
    const metadata = [field('tsfg_core.function_id', fn.id), field('tsfg_core.signature_hash', fn.signatureHash),
      field('tsfg_core.type_id', fn.returnType.id), 'tsfg_core.function_start = ' + fn.range.start + ' : i64',
      'tsfg_core.function_end = ' + fn.range.end + ' : i64', field('tsfg_array.source_binding', fn.sourceBinding),
      'tsfg_array.name_range = ' + span(fn.nameRange),
      'tsfg_array.return_annotation_range = ' + span(fn.returnAnnotationRange)];
    return reserve('  func.func @' + quote(fn.name) + '() -> ' + core.resultType
      + ' attributes {' + metadata.join(', ') + '} {\n') + core.blocksText + reserve('\n  }');
  });
  const result = header + functions.join('\n') + reserve('\n}\n');
  if (Buffer.byteLength(result, 'utf8') > descriptor.limits.outputBytes) outputLimit();
  return result;
}
