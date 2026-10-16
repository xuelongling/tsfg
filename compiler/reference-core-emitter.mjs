// SPDX-License-Identifier: MIT
import { verifyReferenceHir } from './reference-hir.mjs';
import { floatBits } from './float.mjs';
import { referenceCoreModel, referenceCoreFailure as reject } from './reference-core-model.mjs';
import bytecodeSchema from '../contracts/bytecode.schema.json' with { type: 'json' };
import registry from '../contracts/registry.json' with { type: 'json' };
import referenceSchema from '../contracts/core-reference-candidate.schema.json' with { type: 'json' };

const quote = text => '"' + [...text].map(character => {
  const code = character.codePointAt(0);
  return character === '"' || character === '\\' ? '\\' + character
    : code < 32 || code === 127 ? '\\' + code.toString(16).padStart(2, '0') : character;
}).join('') + '"';
// Attribute traversal checks each UTF8 fragment before retaining it. A caller
// reserves the completed attribute once in the shared final-text budget.
function renderAttribute(value, limit) {
  const pieces = [];
  let remaining = limit;
  const append = text => {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > remaining) reject('Core text exceeds candidate byte budget');
    remaining -= bytes; pieces.push(text);
  };
  const string = text => {
    append('"'); let start = 0;
    for (const match of text.matchAll(/["\\\x00-\x1f\x7f]/g)) {
      append(text.slice(start, match.index));
      const code = match[0].charCodeAt(0);
      append(code < 32 || code === 127 ? '\\' + code.toString(16).padStart(2, '0') : '\\' + match[0]);
      start = match.index + 1;
    }
    append(text.slice(start)); append('"');
  };
  const visit = item => {
    if (typeof item === 'string') string(item);
    else if (typeof item === 'boolean') append(String(item));
    else if (typeof item === 'number') append(item + ' : i64');
    else if (Array.isArray(item)) {
      append('['); item.forEach((child, index) => { if (index) append(', '); visit(child); }); append(']');
    } else {
      append('{'); Object.keys(item).sort().forEach((key, index) => {
        if (index) append(', '); append(key + ' = '); visit(item[key]);
      }); append('}');
    }
  };
  visit(value); return pieces.join('');
}
const anchor = origin => 'tsfg_source.start = ' + origin.start + ' : i64, tsfg_source.end = ' + origin.end + ' : i64';

/** Production owned-HIR -> typed Core text. The reference extension declares
 * its own exact candidate family; it grants no R04 or Runtime execution credit.
 * Model and emitted SSA are fresh for each call, with no Source/session access.
 */
export function emitReferenceCore(input) {
  const hir = verifyReferenceHir(input), model = referenceCoreModel(hir);
  let remainingBytes = referenceSchema.limits.bytes;
  const reserve = text => {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > remainingBytes) reject('Core text exceeds candidate byte budget');
    remainingBytes -= bytes; return text;
  };
  const attribute = value => renderAttribute(value, remainingBytes);
  const functions = [];
  for (const callable of model.callables.values()) {
    const { owner, item, descriptor, symbol } = callable, lines = [], bindings = new Map();
    let nextValue = descriptor.parameters.length, terminated = false, initialized = false;
    const line = text => { reserve(text + '\n'); lines.push(text); };
    const parameters = descriptor.parameters.map((type, index) => ({ name: '%v' + index, type }));
    const receiver = parameters[0];
    item.signature.parameters.forEach((parameter, index) => bindings.set(parameter.symbol, parameters[index + 1]));
    const operation = (name, operands, result, attributes, origin) => {
      if (terminated) reject('operation follows a function terminator', origin);
      const output = result === 'none' ? null : { name: '%v' + nextValue++, type: result };
      const fields = Object.entries(attributes).map(([key, value]) => key + ' = ' + attribute(value));
      fields.push(anchor(origin));
      line('    ' + (output ? output.name + ' = ' : '') + quote(name) + '(' + operands.map(value => value.name).join(', ')
        + ') {' + fields.join(', ') + '} : (' + operands.map(value => model.mlirType(value.type)).join(', ')
        + ') -> ' + (output ? model.mlirType(output.type) : '()'));
      return output;
    };
    const directCall = (target, operands, origin) => {
      const { descriptor: destination } = target;
      const output = destination.result === 'none' ? null : { name: '%v' + nextValue++, type: destination.result };
      line('    ' + (output ? output.name + ' = ' : '') + '"func.call"(' + operands.map(value => value.name).join(', ')
        + ') {callee = @' + quote(target.symbol) + ', tsfg_core.function_id = ' + quote(destination.key)
        + ', tsfg_core.signature_hash = ' + quote(destination.signature) + ', ' + anchor(origin) + '} : ('
        + operands.map(value => model.mlirType(value.type)).join(', ') + ') -> ' + (output ? model.mlirType(output.type) : '()'));
      return output;
    };
    const baseReceiver = (base, origin) => operation('tsfg_core.ref.base', [receiver], 'ref:' + model.access.get(base.id),
      { class: base.runtimeKey }, origin);
    const initializeFields = () => {
      if (initialized) reject('duplicate constructor field initialization phase', item.origin);
      initialized = true;
      for (const field of owner.fields) if (field.initializer !== null) {
        let value;
        if (field.initializer.kind === 'scalar.literal.unresolved') {
          const literal = field.initializer, context = hir.types.find(type => type.id === field.type);
          const witness = field.initializerCompatibility, metadata = literal.numericLiteral;
          // Resolution is confined to this owned field occurrence. Never settle
          // its shared narrow type or let a default scalar override the slot.
          if (context?.kind !== 'number' || model.type(field.type) !== 'f64'
              || metadata.state !== 'unresolved' || metadata.officialType !== literal.type || metadata.contextType !== field.type
              || !witness || witness.assignable !== true || witness.sourceType !== literal.type || witness.targetType !== field.type
              || !Array.isArray(witness.members) || witness.members.length !== 0
              || witness.origin.source !== literal.origin.source || witness.origin.start !== literal.origin.start || witness.origin.end !== literal.origin.end)
            reject('number field initializer lacks its exact owned context and compatibility witness', literal.origin);
          let bits;
          try { bits = floatBits(literal.token, 'f64'); }
          catch (error) {
            if (error instanceof RangeError) reject('number field initializer rounds outside the finite f64 range', literal.origin);
            throw error;
          }
          value = operation('tsfg_core.constant', [], 'f64', { value: bits }, literal.origin);
        } else value = expression(field.initializer);
        operation('tsfg_core.ref.field.write', [receiver, value], 'none',
          { field: model.member.get(field.symbol), initialize: true }, field.origin);
      }
    };
    const expression = value => {
      if (!value) reject('missing execution value', item.origin);
      if (value.kind === 'ref.view') {
        const source = expression(value.value), index = model.view(value);
        const converted = operation('tsfg_core.ref.view', [source], model.type(value.targetType), { view: index }, value.origin);
        return { ...converted, original: source };
      }
      if (['ref.parameter','local.read'].includes(value.kind)) {
        const binding = bindings.get(value.symbol);
        if (!binding || binding.type !== model.type(value.type)) reject('binding is not available with the checked value type', value.origin);
        return binding;
      }
      if (value.kind === 'ref.this') return receiver;
      if (value.kind === 'ref.super') return baseReceiver(model.classes.get(owner.base), value.origin);
      if (value.kind === 'ref.field.read') return operation('tsfg_core.ref.field.read', [expression(value.receiver)], model.type(value.type),
        { field: model.member.get(value.symbol) }, value.origin);
      if (value.kind === 'ref.field.write') {
        const location = value.left, object = expression(location.receiver), right = expression(value.right);
        operation('tsfg_core.ref.field.write', [object, right], 'none',
          { field: model.member.get(location.symbol), initialize: false }, value.origin);
        // Assignment returns the evaluated RHS before the store's access view.
        return value.right.kind === 'ref.view' ? right.original : right;
      }
      if (value.kind === 'local.write') {
        const right = expression(value.right);
        bindings.set(value.left.symbol, { name: right.name, type: right.type });
        return value.right.kind === 'ref.view' ? right.original : right;
      }
      if (value.kind === 'ref.construct') {
        const target = model.callables.get(value.staticTarget);
        if (!target || target.descriptor.kind !== 'constructor') reject('constructor target is outside the owned closure', value.origin);
        const arguments_ = value.arguments.map(expression);
        const object = operation('tsfg_core.ref.alloc', [], 'ref:' + model.access.get(target.owner.id),
          { class: target.owner.runtimeKey }, value.origin);
        directCall(target, [object, ...arguments_], value.origin);
        return object;
      }
      if (value.kind === 'ref.super.construct') {
        const target = model.callables.get(value.staticTarget), object = expression(value.receiver), arguments_ = value.arguments.map(expression);
        if (!target || target.descriptor.kind !== 'constructor') reject('super constructor target is outside the owned closure', value.origin);
        directCall(target, [object, ...arguments_], value.origin);
        initializeFields(); return null;
      }
      if (value.kind === 'ref.method.call') {
        const target = model.callables.get(value.staticTarget), object = expression(value.receiver), arguments_ = value.arguments.map(expression);
        if (!target || target.descriptor.kind !== 'method') reject('method target is outside the owned closure', value.origin);
        if (value.dispatch === 'direct-base-method') {
          // Official super has the direct base's static view even when lookup
          // resolves a method declared farther up the same ancestor chain.
          let current = model.classOf(value.receiver.type), adapted = object;
          if (adapted.type !== 'ref:' + model.access.get(current.id))
            reject('direct base method receiver differs from its checked access class', value.origin);
          const visited = new Set();
          while (current.id !== target.owner.id) {
            if (visited.has(current.id) || !current.base || !model.classes.has(current.base))
              reject('direct base method owner is outside the checked receiver ancestry', value.origin);
            visited.add(current.id); current = model.classes.get(current.base);
            adapted = operation('tsfg_core.ref.base', [adapted], 'ref:' + model.access.get(current.id),
              { class: current.runtimeKey }, value.origin);
          }
          if (adapted.type !== target.descriptor.parameters[0])
            reject('direct base method receiver differs from its target signature', value.origin);
          return directCall(target, [adapted, ...arguments_], value.origin);
        }
        return operation('tsfg_core.ref.call', [object, ...arguments_], model.type(value.type),
          { method: target.descriptor.member, signature: target.descriptor.signature, dispatch: value.dispatch }, value.origin);
      }
      if (value.kind === 'ref.identity') return operation('tsfg_core.ref.identity', [expression(value.left), expression(value.right)], 'bool',
        { negate: value.operator === '!==' }, value.origin);
      if (value.kind === 'scalar.add') return operation('tsfg_core.add', [expression(value.left), expression(value.right)], model.type(value.type), {}, value.origin);
      if (value.kind === 'scalar.boolean') {
        const output = { name: '%v' + nextValue++, type: 'bool' };
        line('    ' + output.name + ' = "tsfg_core.constant"() {value = ' + (value.token === 'true' ? 1 : 0)
          + ' : i1, ' + anchor(value.origin) + '} : () -> i1'); return output;
      }
      if (value.kind === 'scalar.literal.unresolved') reject('unresolved numeric literal has no execution scalar', value.origin);
      reject('unsupported execution operation ' + value.kind, value.origin);
    };
    operation('tsfg_core.fuel', [], 'none', { event: 1 }, item.origin);
    // The existing fuel operation's event is i32, while metadata indices are i64.
    lines[0] = lines[0].replace('event = 1 : i64', 'event = 1 : i32');
    if (descriptor.kind === 'constructor' && !owner.base) initializeFields();
    if (descriptor.kind === 'constructor' && item.kind === 'implicit-derived') {
      const base = model.classes.get(owner.base), target = model.callables.get(base.constructor.id);
      const forward = item.implicitForward;
      const operands = forward.parameters.map(parameter => {
        const binding = bindings.get(parameter.source);
        if (!binding) reject('implicit forwarding parameter is outside the owned callable', item.origin);
        const witness = parameter.compatibility;
        if (binding.type !== model.type(witness.sourceType)) reject('implicit forwarding source type differs', item.origin);
        if (!binding.type.startsWith('ref:')) {
          if (binding.type !== model.type(witness.targetType)) reject('implicit scalar forwarding needs an unsupported conversion', item.origin);
          return binding;
        }
        return operation('tsfg_core.ref.view', [binding], model.type(witness.targetType), { view: model.view(witness) }, item.origin);
      });
      directCall(target, [baseReceiver(base, item.origin), ...operands], item.origin); initializeFields();
    }
    for (const statement of item.body) {
      if (terminated) reject('statement follows a function terminator', statement.origin);
      if (statement.kind === 'local') for (const binding of statement.local.bindings) {
        const value = expression(binding.initializer);
        if (value.type !== model.type(binding.type)) reject('local initializer lacks its checked conversion', binding.origin);
        bindings.set(binding.symbol, { name: value.name, type: value.type });
      }
      else if (statement.kind === 'expression') expression(statement.expression);
      else if (statement.kind === 'return') {
        const value = statement.expression === null ? null : expression(statement.expression);
        if ((value?.type ?? 'none') !== descriptor.result) reject('return lacks its checked result conversion', statement.origin);
        operation('func.return', value ? [value] : [], 'none', {}, statement.origin); terminated = true;
      } else reject('unsupported statement ' + statement.kind, statement.origin);
    }
    if (!terminated) {
      if (descriptor.result !== 'none') reject('value-returning callable falls through', item.origin);
      operation('func.return', [], 'none', {}, item.origin);
    }
    const attrs = { 'tsfg_core.function_id': descriptor.key, 'tsfg_core.signature_hash': descriptor.signature,
      'tsfg_core.logical_name': descriptor.name, 'tsfg_core.reference_owner': descriptor.owner,
      'tsfg_core.reference_kind': descriptor.kind, 'tsfg_core.function_start': descriptor.start,
      'tsfg_core.function_end': descriptor.end, 'tsfg_core.source_index': descriptor.source };
    const parameterText = parameters.map(parameter => parameter.name + ': ' + model.mlirType(parameter.type)).join(', ');
    const resultText = descriptor.result === 'none' ? '' : ' -> ' + model.mlirType(descriptor.result);
    if (functions.length) reserve('\n');
    const header = reserve('  func.func @' + quote(symbol) + '(' + parameterText + ')' + resultText + ' attributes '
      + attribute(attrs) + ' {\n');
    functions.push(header + lines.join('\n') + '\n' + reserve('  }'));
  }
  const source = hir.sources.find(value => !value.declaration);
  const attributes = { 'tsfg_core.version': registry['tsfg.hir'].semver, 'tsfg_core.bytecode_schema': registry['tsfg.bytecode'].schemaHash,
    'tsfg_core.input_identity': hir.context.factsDigest, 'tsfg_core.source_path': source.path,
    'tsfg_core.source_hash': source.sha256, 'tsfg_core.source_length': source.utf16Length,
    'tsfg_core.target': bytecodeSchema.target.target, 'tsfg_core.triple': bytecodeSchema.target.triple,
    'tsfg_core.data_layout': bytecodeSchema.target.llvmDataLayout, 'tsfg_core.reference': model.metadata() };
  reserve('module attributes '); reserve(' {\n'); reserve('\n}\n');
  return 'module attributes ' + reserve(attribute(attributes)) + ' {\n' + functions.join('\n') + '\n}\n';
}
