// SPDX-License-Identifier: MIT
import { canonical, sha256, scalarName } from './identity.mjs';
import { coreQuote as quote } from './core-ssa-emitter.mjs';
import schema from '../contracts/core-closure-candidate.schema.json' with { type: 'json' };
import registry from '../contracts/registry.json' with { type: 'json' };
import { closureCoreInitialization } from './closure-core-initialization.mjs';
export { schema };

/** @returns {never} */
export function closureCoreFailure(category, message, primary = undefined, context = undefined) {
  const capability = category === 'capability', code = capability ? 'r03-d-capability' : 'r03-closure-core-' + category;
  throw Object.assign(new TypeError(code + ': ' + message), { code,
    ruleId: capability ? 'r01-ts-baseline' : 'r01-input-boundary', phase: 'lowering',
    ...(primary ? { primary } : {}), ...(context ?? {}) });
}

/** Metadata and actual closure leaves for the shared SSA traversal. The caller
 * already cold-verified the complete program. No Source/type analysis occurs.
 */
export function closureCoreModel(program, programHash) {
  const bindings = new Map(program.bindings.map(binding => [binding.id, binding]));
  const functions = new Map(program.functions.map(fn => [fn.id, fn]));
  const types = new Map(program.types.map(type => [type.id, type]));
  const environmentTypes = new Map();
  const limit = (condition, message) => { if (!condition) closureCoreFailure('limit', message); };
  let bytes = 0, work = 0;
  const step = () => limit(++work <= schema.limits.emissionWork, 'Core emission work budget exceeded');
  const reserve = amount => { bytes += amount; limit(bytes <= schema.limits.bytes, 'Core text byte budget exceeded'); };
  const reserveText = text => reserve(Buffer.byteLength(text, 'utf8'));
  limit(program.functions.length <= schema.limits.functions, 'Core function budget exceeded');
  for (const fn of program.functions) limit(fn.parameters.length <= schema.limits.sourceParameters, 'Source parameter budget exceeded');
  const declarationIndices = closureCoreInitialization(program, step, closureCoreFailure);
  const symbol = fn => 'f' + fn.id.slice(7);
  function environmentType(layout) {
    if (!environmentTypes.has(layout)) environmentTypes.set(layout, { environmentLayout: layout });
    return environmentTypes.get(layout);
  }
  function coreType(type) {
    if (typeof type === 'object' && type?.environmentLayout)
      return '!tsfg_closure.env<' + quote(type.environmentLayout) + '>';
    const descriptor = types.get(type);
    if (descriptor?.kind === 'function') return '!tsfg_closure.value<' + quote(type) + '>';
    const name = descriptor?.name ?? scalarName(type);
    if (name === 'bool') return 'i1';
    if (['i32', 'f32', 'f64'].includes(name)) return name;
    if (!name) closureCoreFailure('type', 'Core type is outside the verified table');
    return '!tsfg_core.integer<' + quote(name) + '>';
  }
  // Bound each fragment before retaining a complete metadata attribute.
  function attribute(value) {
    const pieces = []; let remaining = schema.limits.bytes;
    const append = text => { remaining -= Buffer.byteLength(text, 'utf8'); limit(remaining >= 0, 'Core metadata exceeds byte budget'); pieces.push(text); };
    function visit(item) {
      step();
      if (typeof item === 'string') append(quote(item));
      else if (typeof item === 'number') append(item + ' : i64');
      else if (typeof item === 'boolean') append(String(item));
      else if (Array.isArray(item)) {
        append('['); item.forEach((child, index) => { if (index) append(', '); visit(child); }); append(']');
      } else {
        append('{'); Object.entries(item).forEach(([key, child], index) => {
          if (index) append(', '); append(key + ' = '); visit(child);
        }); append('}');
      }
    }
    visit(value); return pieces.join('');
  }
  const metadata = {
    family: schema.family, version: schema.version, schema: sha256(canonical(schema)), program_hash: programHash,
    hir_hash: program.hirHash, root_policy: 'consumer-recompute-required',
    types: program.types.map(type => type.kind === 'scalar' ? { id: type.id, kind: type.kind, name: type.name }
      : { id: type.id, kind: type.kind, parameters: type.parameters, returnType: type.returnType }),
    environments: program.environments.map(layout => ({ id: layout.id, owner: layout.owner, parent: layout.parent ?? '',
      slots: layout.slots.map(slot => ({ binding: slot.binding, type: slot.type, writable: slot.writable, role: bindings.get(slot.binding).role,
        declaration_index: declarationIndices.get(slot.binding) })) })),
    functions: program.functions.map(fn => ({ id: fn.id, name: fn.name, symbol: symbol(fn), lexical_parent: fn.lexicalParent ?? '',
      lexical_scope: fn.lexicalScope, signature: fn.signature, signature_hash: fn.signatureHash,
      lexical_environment: fn.lexicalEnvironment ?? '', activation_environment: fn.activationEnvironment ?? '',
      parameters: fn.parameters.map(id => ({ binding: id, type: bindings.get(id).type })),
      return_type: fn.returnType, start: fn.range.start, end: fn.range.end })),
  };
  const moduleAttributes = [
    'tsfg_core.version = ' + quote(schema.base.core),
    'tsfg_core.input_identity = ' + quote(program.inputIdentity),
    'tsfg_core.source_hash = ' + quote(program.source.hash),
    'tsfg_core.source_path = ' + quote(program.source.path),
    'tsfg_core.target = ' + quote(program.target.target),
    'tsfg_core.triple = ' + quote(program.target.triple),
    'tsfg_core.data_layout = ' + quote(program.target.llvmDataLayout),
    'tsfg_core.bytecode_schema = ' + quote(registry['tsfg.bytecode'].schemaHash),
    'tsfg_core.source_length = ' + program.source.content.length + ' : i64',
    'tsfg_core.closure = ' + attribute(metadata),
  ].join(', ');
  function functionAttributes(fn) {
    return 'tsfg_core.function_id = ' + quote(fn.id) + ', tsfg_core.signature_hash = ' + quote(fn.signatureHash)
      + ', tsfg_core.type_id = ' + quote(fn.returnType) + ', tsfg_core.function_start = ' + fn.range.start + ' : i64'
      + ', tsfg_core.function_end = ' + fn.range.end + ' : i64, tsfg_closure.signature = ' + quote(fn.signature)
      + ', tsfg_closure.lexical_environment = ' + quote(fn.lexicalEnvironment ?? '')
      + ', tsfg_closure.activation_environment = ' + quote(fn.activationEnvironment ?? '');
  }
  function functionPolicy(fn) {
    let instructions = 0, activation = null;
    const incoming = Symbol('lexical environment');
    function environment(value, api, anchor) {
      step();
      if (value.kind === 'incomingEnvironment') return api.lookup(incoming);
      if (value.kind === 'activationEnvironment') {
        if (activation === null) closureCoreFailure('program', 'activation environment is not allocated');
        return activation;
      }
      const parent = environment(value.environment, api, anchor);
      return api.operation('tsfg_closure.env.parent', [parent], [environmentType(value.environment.layout)],
        environmentType(value.layout), '', anchor);
    }
    const environmentOperand = (value, api, anchor) => value === null ? [] : [environment(value, api, anchor)];
    const environmentOperandType = value => value === null ? [] : [environmentType(value.layout)];
    const emitValueLeaf = (value, api) => {
      if (value.kind === 'environmentLoad') return api.operation('tsfg_closure.env.load',
        [environment(value.environment, api, value.range)], [environmentType(value.environment.layout)], value.type,
        'binding = ' + quote(value.binding), value.range);
      if (value.kind === 'environmentWrite') {
        const right = api.emit(value.value), target = value.target;
        api.operation('tsfg_closure.env.store', [environment(target.environment, api, value.range), right],
          [environmentType(target.environment.layout), value.value.type], null, 'binding = ' + quote(target.binding), value.range);
        return right;
      }
      if (value.kind === 'makeClosure') {
        const target = functions.get(value.function);
        return api.operation('tsfg_closure.make', environmentOperand(value.environment, api, value.range),
          environmentOperandType(value.environment), value.type,
          'function_id = ' + quote(target.id) + ', signature_hash = ' + quote(target.signatureHash), value.range);
      }
      if (value.kind === 'closureCall') {
        // Save the entire callee SSA value before any argument can rebind its source.
        const callee = api.emit(value.callee);
        const arguments_ = value.arguments.map(argument => api.emit(argument));
        return api.operation('tsfg_closure.call', [callee, ...arguments_], [value.callee.type, ...value.arguments.map(argument => argument.type)],
          value.type, 'signature = ' + quote(value.signature) + ', signature_hash = ' + quote(value.signatureHash), value.range);
      }
      if (value.kind === 'call') {
        const target = functions.get(value.target), operands = environmentOperand(value.environment, api, value.range);
        const arguments_ = value.arguments.map(argument => api.emit(argument));
        return api.operation('func.call', [...operands, ...arguments_],
          [...environmentOperandType(value.environment), ...value.arguments.map(argument => argument.type)], value.type,
          'callee = @' + quote(symbol(target)) + ', tsfg_core.function_id = ' + quote(target.id)
          + ', tsfg_core.signature_hash = ' + quote(target.signatureHash), value.range);
      }
      return undefined;
    };
    const emitStatementLeaf = (item, api) => {
      if (item.kind === 'functionDeclaration') return true;
      if (item.kind === 'allocateEnvironment') {
        activation = api.operation('tsfg_closure.env.alloc', environmentOperand(item.parent, api, item.anchor.range),
          environmentOperandType(item.parent), environmentType(item.layout),
          'layout = ' + quote(item.layout) + ', anchor_kind = ' + quote(item.anchor.kind), item.anchor.range);
        return true;
      }
      if (item.kind === 'initializeEnvironment') {
        const value = api.emit(item.value);
        api.operation('tsfg_closure.env.init', [environment(item.environment, api, item.anchor.range), value],
          [environmentType(item.environment.layout), item.value.type], null,
          'binding = ' + quote(item.binding) + ', anchor_kind = ' + quote(item.anchor.kind), item.anchor.range);
        return true;
      }
      if (item.kind === 'environmentStore') {
        const value = api.emit(item.value), target = item.target;
        api.operation('tsfg_closure.env.store', [environment(target.environment, api, item.range), value],
          [environmentType(target.environment.layout), item.value.type], null, 'binding = ' + quote(target.binding), item.range);
        return true;
      }
      return false;
    };
    function adaptBody(body) {
      return body.map(item => {
        step();
        if (item.kind === 'local') return { ...item, binding: bindings.get(item.binding) };
        return { ...item, ...Object.fromEntries(['body', 'thenBody', 'elseBody'].filter(key => item[key]).map(key => [key, adaptBody(item[key])])) };
      });
    }
    const parameters = fn.parameters.map(id => bindings.get(id));
    if (fn.lexicalEnvironment !== null) parameters.unshift({ id: incoming, type: environmentType(fn.lexicalEnvironment) });
    const view = { ...fn, parameters, returnType: { id: fn.returnType }, body: adaptBody(fn.body) };
    const budget = {
      step, register: count => limit(count <= schema.limits.registers, 'Core register budget exceeded'),
      block: count => limit(count <= schema.limits.blocks, 'Core block budget exceeded'),
      parameters: count => limit(count <= schema.limits.coreParameters, 'Core actual parameter budget exceeded'),
      line: text => { step(); limit(++instructions <= schema.limits.instructions, 'Core instruction budget exceeded'); reserveText(text + '\n'); },
    };
    return { view, context: { coreType, emitValueLeaf, emitStatementLeaf, budget } };
  }
  return { moduleAttributes, functionAttributes, functionPolicy, symbol, coreType, reserveText,
    finishFunction: (text, reservedBodyBytes) => reserve(Buffer.byteLength(text, 'utf8') - reservedBodyBytes) };
}
