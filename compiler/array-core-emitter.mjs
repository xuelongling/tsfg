// SPDX-License-Identifier: MIT
// Whole owned Array HIR uses the shared SSA definition and emission machinery.
import descriptor from '../contracts/core-array-candidate.schema.json' with { type: 'json' };
import { canonical, sha256, scalarTypeIds, readSpanTypeId } from './identity.mjs';
import { emitCoreSsaFunction, coreQuote as quote, coreExchangeFormat } from './core-ssa-emitter.mjs';
import { arrayHirType, arrayHirFailure } from './array-hir-model.mjs';
import { verifySelectedArrayHir as verifyArrayHir } from './array-hir.mjs';

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
function scalarUse(value) {
  return dictionary([field('kind',value.kind),field('binding',value.kind === 'reference' ? value.binding : ''),
    field('type_id',value.type),'range = '+span(value.range)]);
}
function publication(context) {
  if (context === undefined) return 'unit';
  const flags = value => dictionary(['read = '+value.read,'write = '+value.write,'structural = '+value.structural]);
  return dictionary([field('family',context.family),'version = 4 : i32',field('mode',context.mode),
    field('scope_digest',context.scopeDigest),field('expected_digest',context.expectedDigest),
    'contracts = '+table(context.contracts.map(row => dictionary([
      field('function_id',row.functionId),field('signature_hash',row.signatureHash),
      'upper = '+dictionary(['parameters = '+table(row.upper.parameters.map(parameter => dictionary([
        'index = '+parameter.index+' : i64','read = '+parameter.read,
        'write = '+parameter.write,'structural = '+parameter.structural]))),
        'local = '+flags(row.upper.local),'return_origin = unit']),field('digest',row.digest)])))]);
}
function elementTarget(target) {
  return dictionary([field('receiver_binding',target.receiver.binding),'receiver_range = '+span(target.receiver.range),
    'index = '+scalarUse(target.index),'range = '+span(target.range)]);
}
export function emitArrayCore(hir, context, fixedContext = undefined) {
  // Context and the complete graph are validated before accessing any HIR field.
  const verified = verifyArrayHir(hir, context, fixedContext);
  const unsupported = (fn, range) => {
    const code = 'r03-d-core-array-capability';
    throw Object.assign(new TypeError('Array Core lowering requires complete nominal Array/ReadSpan calls and an f64 result'),
      {code,ruleId:'r01-ts-baseline',phase:'lowering',primary:{sourceId:fn.sourcePath,...range}});
  };
  // Inspect complete verified Source order before reserving even the module header.
  for (const fn of verified.functions) {
    if (fn.returnType.id !== scalarTypeIds.f64) unsupported(fn,fn.returnAnnotationRange);
    for (const statement of fn.body) {
      if (statement.kind === 'local' && statement.binding.type === readSpanTypeId
          && !['readSpanCreateChecked','reference'].includes(statement.initializer.kind)) unsupported(fn,statement.initializer.range);
      const value = statement.kind === 'expression' ? statement.expression : statement.kind === 'return' ? statement.value : undefined;
      if (statement.kind === 'expression' && !['arrayDirectCall','readSpanLength','readSpanReadChecked'].includes(value?.kind)) unsupported(fn,value.range);
      if (value?.kind === 'arrayDirectCall' && (value.arguments.some(argument => !['reference','constant','floating'].includes(argument.kind)
            || ![arrayHirType.id,readSpanTypeId,scalarTypeIds.f64,scalarTypeIds.u32].includes(argument.type)))) unsupported(fn,value.range);
      if (statement.kind === 'return' && !['arrayReadChecked','readSpanReadChecked','arrayDirectCall','floating','reference'].includes(value.kind)) unsupported(fn,statement.range);
    }
  }
  const source = verified.sources.find(item => item.path === verified.rootFile);
  const fixed = fixedContext === undefined ? undefined : JSON.parse(canonical(fixedContext));
  const contracts = new Map((fixed?.contracts ?? []).map(row => [row.functionId,row]));
  const attributes = [field('tsfg_core.version', coreExchangeFormat.version),
    field('tsfg_core.input_identity', verified.inputIdentity), field('tsfg_core.source_hash', source.hash),
    field('tsfg_core.source_path', source.path), field('tsfg_core.target', verified.target.target),
    field('tsfg_core.triple', verified.target.triple), field('tsfg_core.data_layout', verified.target.llvmDataLayout),
    field('tsfg_core.bytecode_schema', coreExchangeFormat.bytecodeSchema),
    'tsfg_core.source_length = ' + source.content.length + ' : i64',
    'tsfg_core.array = ' + dictionary([field('family', descriptor.family), 'version = 12 : i32',
      field('schema', schemaHash), field('profile', descriptor.profile), 'facts_version = 7 : i32']),
    'tsfg_array.function_ids = ' + table(verified.functions.map(fn => quote(fn.id))),
    'tsfg_array.exports = ' + table(verified.exports.map(item => dictionary([
      field('name', item.name), field('function_id', item.functionId)]))),
    'tsfg_array.sources = ' + table(verified.sources.map(item => dictionary([field('path', item.path),
      field('hash', item.hash), 'utf16_length = ' + item.content.length + ' : i64']))),
    'tsfg_array.types = ' + table(verified.types.map(item => dictionary([
      field('id', item.id), field('kind', item.kind), field('name', item.name), field('source_path', item.sourcePath),
      'declaration_range = ' + span(item.declarationRange), 'name_range = ' + span(item.nameRange),
      ...([arrayHirType.id,readSpanTypeId].includes(item.id) ? [field('element_type', item.elementType),
        'index_signature_range = ' + span(item.indexSignatureRange)] : []),
      ...(item.id === readSpanTypeId ? ['readonly = true'] : [])]))),
    field('tsfg_array.request_id', verified.facts.requestId),
    'tsfg_array.length_property = ' + dictionary([
      field('id',verified.arrayLength.id),field('kind',verified.arrayLength.kind),field('name',verified.arrayLength.name),
      field('owner_type',verified.arrayLength.ownerType),field('official_type',verified.arrayLength.officialType),
      field('write_type',verified.arrayLength.writeType),field('source_path',verified.arrayLength.sourcePath),
      'declaration_range = '+span(verified.arrayLength.declarationRange),'name_range = '+span(verified.arrayLength.nameRange),
      'type_range = '+span(verified.arrayLength.typeRange)]),
    'tsfg_array.readspan_length_property = ' + dictionary([
      field('id',verified.readSpanLength.id),field('kind',verified.readSpanLength.kind),field('name',verified.readSpanLength.name),
      field('owner_type',verified.readSpanLength.ownerType),field('official_type',verified.readSpanLength.officialType),
      field('read_type',verified.readSpanLength.readType),'readonly = true',field('source_path',verified.readSpanLength.sourcePath),
      'declaration_range = '+span(verified.readSpanLength.declarationRange),'name_range = '+span(verified.readSpanLength.nameRange),
      'type_range = '+span(verified.readSpanLength.typeRange)]),
    'tsfg_array.readspan_intrinsic = ' + dictionary([
      field('id',verified.readSpanIntrinsic.id),field('kind',verified.readSpanIntrinsic.kind),field('name',verified.readSpanIntrinsic.name),
      field('source_path',verified.readSpanIntrinsic.sourcePath),'declaration_range = '+span(verified.readSpanIntrinsic.declarationRange),
      'name_range = '+span(verified.readSpanIntrinsic.nameRange),'type_parameter_range = '+span(verified.readSpanIntrinsic.typeParameterRange),
      'parameters = '+table(verified.readSpanIntrinsic.parameters.map(p => dictionary([field('name',p.name),
        'declaration_range = '+span(p.declarationRange),'name_range = '+span(p.nameRange),'type_range = '+span(p.typeRange)]))),
      'return_type_range = '+span(verified.readSpanIntrinsic.returnTypeRange)]),
    'tsfg_array.publication = '+publication(fixed)];
  let bytes = 0;
  const reserve = text => {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > descriptor.limits.outputBytes) outputLimit();
    return text;
  };
  const header = reserve('module attributes {' + attributes.join(', ') + '} {\n');
  const coreType = type => {
    if (type === arrayHirType.id) return '!tsfg_array.array_f64';
    if (type === readSpanTypeId) return '!tsfg_array.readspan_f64';
    if (type === scalarTypeIds.f64) return 'f64';
    if (type === scalarTypeIds.u32) return '!tsfg_core.integer<"u32">';
    arrayHirFailure('invalid');
  };
  const functions = verified.functions.map((fn, index) => {
    if (index) reserve('\n');
    const locals = fn.body.filter(statement => statement.kind === 'local');
    const owners = new Map(locals.map(statement => [statement.initializer, statement]));
    const elements = locals.reduce((sum, statement) => sum + (statement.initializer.elements?.length ?? 0), 0);
    const stores = fn.body.filter(statement => statement.kind === 'arrayStoreDenseChecked');
    const resizes = fn.body.filter(statement => statement.kind === 'arrayResizeChecked');
    const standalone = fn.body.filter(statement => statement.expression?.kind === 'readSpanReadChecked');
    const readStatements = new Map(standalone.map(statement => [statement.expression,statement]));
    const reads = [fn.body.at(-1).value,...stores.map(statement => statement.value),...standalone.map(statement => statement.expression)]
      .filter(value => ['arrayReadChecked','readSpanReadChecked'].includes(value.kind));
    const views = locals.filter(statement => statement.initializer.kind === 'readSpanCreateChecked');
    const lengths = fn.body.filter(statement => statement.expression?.kind === 'readSpanLength');
    const callStatements = new Map(fn.body.filter(statement => (statement.expression ?? statement.value)?.kind === 'arrayDirectCall')
      .map(statement => [statement.expression ?? statement.value,statement]));
    const calls = [...callStatements.keys()], returnCall = fn.body.at(-1).value.kind === 'arrayDirectCall' ? 1 : 0;
    const argumentsCount = calls.reduce((sum, call) => sum + call.arguments.length, 0);
    const scalars = [...reads.map(read => read.index),...stores.flatMap(statement => [statement.target.index,statement.value]),...resizes.map(statement => statement.value),...calls.flatMap(call => call.arguments),
      ...views.flatMap(statement => [statement.initializer.start,statement.initializer.length]),fn.body.at(-1).value];
    const constants = elements + scalars.filter(value => value.kind === 'constant' || value.kind === 'floating').length;
    const count = locals.length, expected = {registers:fn.parameters.length + constants + count + reads.length + calls.length + lengths.length,
      lines:constants + count + reads.length + stores.length + resizes.length + calls.length + lengths.length + 2,
      steps:elements + 2*count + 4*stores.length + 3*resizes.length + 2*reads.length + calls.length + argumentsCount + 2 - returnCall + 3*views.length + 3*lengths.length + 2*standalone.length};
    let blocks = 0, parameters = 0, registers = 0, lines = 0, steps = 0;
    const shape = condition => { if (!condition) arrayHirFailure('invalid'); };
    const emitCall = (call, statement, api) => {
      const target = verified.functions.find(fn => fn.id === call.target), operands = call.arguments.map(api.emit);
      return api.operation('func.call', operands, call.arguments.map(argument => argument.type), call.type,
        'callee = @' + quote(target.name) + ', ' + field('tsfg_core.function_id',target.id)
          + ', ' + field('tsfg_core.signature_hash',target.signatureHash) + ', ' + field('source_callee',call.sourceCallee)
          + ', consumed_digest = '+(fixed ? quote(contracts.get(call.target).digest) : 'unit')
          + ', callee_range = ' + span(call.calleeRange) + ', arguments = ' + table(call.arguments.map(scalarUse))
          + ', statement_range = ' + span(statement.range), call.range);
    };
    const core = emitCoreSsaFunction(fn, { verified, coreType, functionSymbol: target => target.name,
      returnAttributes: value => 'tsfg_array.value = '+scalarUse(value),
      budget: {
        block: value => shape(value === ++blocks && value === 1),
        parameters: value => shape(++parameters === 1 && value === fn.parameters.length),
        register: value => shape(value === ++registers && value <= expected.registers
          && value <= descriptor.limits.registersPerFunction),
        step: () => shape(++steps <= expected.steps && steps <= descriptor.limits.sharedStepsPerFunction),
        line: text => {
          shape(lines < expected.lines && lines < descriptor.limits.operationsPerFunction);
          reserve((lines++ ? '\n' : '') + text);
        },
      },
      emitValueLeaf: (expression, api) => {
        if (expression.kind === 'arrayDirectCall') return emitCall(expression,callStatements.get(expression),api);
        if (expression.kind === 'readSpanLength') {
          const statement=lengths.find(item => item.expression === expression), receiver=api.emit(expression.receiver);
          return api.operation('tsfg_array.view_length',[receiver],[expression.receiver.type],expression.type,
            field('receiver_binding',expression.receiver.binding)+', receiver_range = '+span(expression.receiver.range)
              +', '+field('property',expression.property)+', property_name_range = '+span(expression.nameRange)
              +', statement_range = '+span(statement.range),expression.range);
        }
        const statement = owners.get(expression);
        if (statement) {
          if (expression.kind === 'arrayCreate') {
            const operands = expression.elements.map(api.emit);
            return api.operation('tsfg_array.create', operands, expression.elements.map(item => item.type),
              expression.type, field('allocation_site', expression.allocationSite)
                + ', local = ' + localMetadata(statement), expression.range);
          }
          if (expression.kind === 'readSpanCreateChecked') {
            const operands = [api.emit(expression.receiver),api.emit(expression.start),api.emit(expression.length)];
            return api.operation('tsfg_array.view_create_checked',operands,
              [expression.receiver.type,expression.start.type,expression.length.type],expression.type,
              field('intrinsic',expression.intrinsic)+', '+field('receiver_binding',expression.receiver.binding)
                +', receiver_range = '+span(expression.receiver.range)+', callee_range = '+span(expression.calleeRange)
                +', start = '+scalarUse(expression.start)+', length = '+scalarUse(expression.length)
                +', local = '+localMetadata(statement),expression.range);
          }
          return api.operation(statement.binding.type === readSpanTypeId ? 'tsfg_array.view_alias' : 'tsfg_array.alias', [api.lookup(expression.binding)], [expression.type],
            expression.type, field('target_binding', expression.binding)
              + ', local = ' + localMetadata(statement), expression.range);
        }
        if (['arrayReadChecked','readSpanReadChecked'].includes(expression.kind)) {
          const receiver = api.emit(expression.receiver), index = api.emit(expression.index);
          return api.operation(expression.kind === 'arrayReadChecked' ? 'tsfg_array.read_checked' : 'tsfg_array.view_read_checked', [receiver, index],
            [expression.receiver.type, expression.index.type], expression.type,
            field('receiver_binding', expression.receiver.binding) + ', receiver_range = '
              + span(expression.receiver.range) + ', index = ' + scalarUse(expression.index)
              + (readStatements.has(expression) ? ', statement_range = '+span(readStatements.get(expression).range) : ''), expression.range);
        }
      },
      emitStatementLeaf: (statement,api) => {
        if (statement.kind === 'expression') {
          const value=statement.expression;
          if (['readSpanLength','readSpanReadChecked'].includes(value.kind)) {
            // Match shared emit accounting: expression and receiver are real uses.
            api.emit(value);
          } else emitCall(value,statement,api);
          return true;
        }
        if (statement.kind === 'arrayStoreDenseChecked') {
          const target=statement.target,receiver=api.emit(target.receiver),index=api.emit(target.index),value=api.emit(statement.value);
          api.operation('tsfg_array.store_dense_checked',[receiver,index,value],
            [target.receiver.type,target.index.type,statement.value.type],null,
            'target = '+elementTarget(target)+', value = '+scalarUse(statement.value)
              +', expression_range = '+span(statement.expressionRange)+', operator_range = '+span(statement.operatorRange),statement.range);
          return true;
        }
        if (statement.kind === 'arrayResizeChecked') {
          const target=statement.target,receiver=api.emit(target.receiver),value=api.emit(statement.value);
          api.operation('tsfg_array.resize_checked',[receiver,value],[target.receiver.type,statement.value.type],null,
            field('receiver_binding',target.receiver.binding)+', receiver_range = '+span(target.receiver.range)
              +', '+field('property',target.property)+', property_name_range = '+span(target.nameRange)
              +', target_range = '+span(target.range)+', new_length = '+scalarUse(statement.value)
              +', expression_range = '+span(statement.expressionRange)+', operator_range = '+span(statement.operatorRange),statement.range);
          return true;
        }
        return false;
      },
    });
    shape(blocks === 1 && parameters === 1 && registers === expected.registers
      && lines === expected.lines && steps === expected.steps);
    const metadata = [field('tsfg_core.function_id', fn.id), field('tsfg_core.signature_hash', fn.signatureHash),
      field('tsfg_core.type_id', fn.returnType.id), 'tsfg_core.function_start = ' + fn.range.start + ' : i64',
      'tsfg_core.function_end = ' + fn.range.end + ' : i64', field('tsfg_array.source_binding', fn.sourceBinding),
      'tsfg_array.name_range = ' + span(fn.nameRange),
      'tsfg_array.return_annotation_range = ' + span(fn.returnAnnotationRange),
      'tsfg_array.parameters = '+table(fn.parameters.map(parameter => dictionary([
        field('id',parameter.id),field('name',parameter.name),field('type',parameter.type),'writable = '+parameter.writable,
        'declaration_range = '+span(parameter.range),'name_range = '+span(parameter.nameRange),
        'annotation_range = '+span(parameter.annotationRange),
        ...([arrayHirType.id,readSpanTypeId].includes(parameter.type) ? ['element_annotation_range = '+span(parameter.elementAnnotationRange)] : [])])))];
    return reserve('  func.func @' + quote(fn.name) + '(' + core.entryParameters.map(parameter => parameter.name+': '+coreType(parameter.type)).join(', ') + ') -> ' + core.resultType
      + ' attributes {' + metadata.join(', ') + '} {\n') + core.blocksText + reserve('\n  }');
  });
  const result = header + functions.join('\n') + reserve('\n}\n');
  if (Buffer.byteLength(result, 'utf8') > descriptor.limits.outputBytes) outputLimit();
  return result;
}
