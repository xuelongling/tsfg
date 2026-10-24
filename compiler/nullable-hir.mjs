// SPDX-License-Identifier: MIT
import { nullableSnapshotFacts } from './nullable-frontend.mjs';
import presenceHirDescriptor from '../contracts/nullable-presence-hir-candidate.schema.json' with { type: 'json' };
import { check, record, budget, same, own, candidate, valueType, typeFor, scalarType, nullableTypes, hirFormat, canonical, sha256,
  presenceBudget, presenceDomainBudget, presenceOwn, presenceOrigin, presenceSourceSchema, groupsSourceSchema, groupsHirFormat, readGroupsHirJson } from './nullable-common.mjs';

const presenceHirFormat = Object.freeze({ family: hirFormat.family, version: 4, schemaHash: sha256(canonical(presenceHirDescriptor)) });
check(presenceHirFormat.schemaHash === 'sha256:9892edc555999b98f964ae409e10d6ba576e8a819b2c4ed68783f626f2665eed', 'schema');
const boolType = Object.freeze({ kind: 'scalar', name: 'bool',
  id: candidate('tsfg.core-nullable-candidate.type.v1', { kind: 'scalar', name: 'bool' }) });
const selectedErrors = new WeakSet();
/** @returns {never} */
function selectedFailure(category, primary = undefined) {
  const code = 'r03-nullable-' + category;
  const error = Object.assign(new TypeError(code + ': invalid private nullable presence HIR'),
    { code, ruleId: 'r01-input-boundary', phase: 'hir' });
  if (primary !== undefined && !['identity','limit','context'].includes(category)) {
    Object.defineProperty(error, 'primary', { value: Object.freeze({ ...primary }), enumerable: true });
  }
  selectedErrors.add(error); throw error;
}
/** @returns {never} */
function selectedRethrow(error) {
  if (selectedErrors.has(error)) throw error;
  // Only errors from our trusted synchronous validators can reach this catch.
  const code = typeof error?.code === 'string' ? error.code : '', suffix = code.split('-').at(-1);
  const category = code.startsWith('generic-package-')
    ? ({ limit: 'limit', canonical: 'canonical', json: 'json', utf8: 'json', input: 'input' })[suffix] ?? 'schema'
    : code.startsWith('r03-nullable-') && presenceHirDescriptor.errors.categories.includes(suffix) ? suffix : 'hir';
  selectedFailure(category, error?.phase === 'frontend' ? error.primary : undefined);
}
const demand = (condition, category = 'schema', primary = undefined) => { if (!condition) selectedFailure(category, primary); };
function shape(actual, expected, primary = undefined) {
  demand(actual && typeof actual === 'object' && !Array.isArray(actual), 'schema', primary);
  const keys = Object.keys(expected);
  demand(Object.keys(actual).length === keys.length && keys.every(key => Object.hasOwn(actual, key)), 'schema', primary);
}
function selectedContext(context) {
  presenceBudget(context);
  // The S5 selector is checked here before reading HIR fields; the complete S5
  // validator repeats selection and capture binding at its own cold Interface.
  record(context, ['sourceVersion','sourceSchemaHash','expectedPackageId','expectedOrigin']);
  demand((context.sourceVersion === 4 && context.sourceSchemaHash === presenceSourceSchema
    || context.sourceVersion === 5 && context.sourceSchemaHash === groupsSourceSchema)
    && typeof context.expectedPackageId === 'string' && /^sha256:[0-9a-f]{64}$/.test(context.expectedPackageId), 'context');
  presenceOrigin(context.expectedOrigin);
}
const field = (value, key) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.hasOwn(value, key) ? value[key] : undefined;
function selectedBudget(input, hir) {
  presenceBudget(input);
  // Reuse S5's fixed-path domain counts after its one shared safe graph walk.
  // Whole depth/tokens also bound expression depth/steps more tightly than128/200000.
  presenceDomainBudget(input);
  if (hir) {
    presenceDomainBudget(field(input, 'snapshot'));
    const types = field(input, 'types');
    if (Array.isArray(types)) demand(types.length <= 5, 'limit');
  }
}
/** @param {typeof hirFormat | typeof presenceHirFormat | typeof groupsHirFormat} [format] */
function project(snapshot, format = hirFormat) {
  const source = snapshot.source, selected = format !== hirFormat; let hasGuards = false;
  // Signatures and owned bindings select only this program's nullable records.
  const usedTypes = new Set(snapshot.symbols.flatMap(symbol => [valueType(symbol.presence), valueType(symbol.returnPresence)]));
  const headers = snapshot.functions.map(fn => {
    const parameterTypes = fn.parameters.map(p => valueType(p.presence)), returnId = valueType(fn.returnPresence);
    const signatureHash = candidate('tsfg.core-nullable-candidate.signature.v1', { parameters: parameterTypes, returnType: returnId });
    return { source: fn, id: candidate('tsfg.core-nullable-candidate.function.v1', { name: fn.name, signatureHash,
      source: { path: source.path, digest: source.hash } }), signatureHash, parameterTypes, returnId };
  });
  const functions = headers.map(header => {
    const fn = header.source, bindings = new Map(snapshot.symbols.map(symbol => [symbol.id, symbol]));
    const guarded = selected && fn.body.some(item => item.kind === 'if'); hasGuards ||= guarded;
    const lift = (value, expected) => {
      if (value.type === expected) return value;
      check(value.type === scalarType.id && typeFor(expected).kind === 'nullable-i32', 'signature');
      return { kind: 'nullableWrap', type: expected, operand: value, range: value.range };
    };
    function expression(raw) {
      if (raw.kind === 'group') { const operand = expression(raw.operand); return { kind: 'group', type: operand.type, operand, range: raw.range }; }
      if (raw.kind === 'reference') return { kind: 'reference', type: valueType(bindings.get(raw.symbol).presence), binding: raw.symbol, range: raw.range };
      if (raw.kind === 'shortCircuit') return { kind: 'nullableCoalesce', type: scalarType.id,
        left: expression(raw.left), right: expression(raw.right), range: raw.range };
      const target = headers.find(item => item.source.symbol === raw.target);
      return { kind: 'call', type: target.returnId, target: target.id, signatureHash: target.signatureHash,
        arguments: raw.arguments.map((arg, index) => lift(expression(arg), target.parameterTypes[index])), range: raw.range };
    }
    function statement(item, final = false) {
      if (selected && item.kind === 'if') return { kind: 'if', condition: {
        kind: 'nullableTagTest', type: boolType.id, operand: expression(item.condition.left),
        tag: item.condition.right.absence === 'undefined' ? 1 : 2, tagRange: item.condition.right.range, range: item.condition.range,
      }, thenBody: item.thenBody.map(block => statement(block)), elseBody: [], range: item.range };
      if (selected && item.kind === 'block') return { kind: 'block', body: item.body.map(value => statement(value)), range: item.range };
      if (item.kind === 'variable') return {
        kind: 'local', binding: { id: item.symbol.id, name: item.symbol.name, type: valueType(item.symbol.presence), mutable: false, range: item.symbol.range },
        initializer: lift(expression(item.initializer), valueType(item.symbol.presence)), range: item.range,
      };
      const operand = expression(item.expression);
      // Only S5's complete, revalidated finite guard/return plan reaches this
      // final fallthrough. All absence exits return; the declaration stays nullable.
      const value = final ? { kind: 'nullableGet', type: scalarType.id, operand, range: operand.range } : operand;
      return { kind: 'return', value: lift(value, header.returnId), range: item.range };
    }
    return { id: header.id, name: fn.name, ownedSymbol: fn.symbol, signatureHash: header.signatureHash,
      role: snapshot.exports[0].target === fn.symbol ? 'entry' : 'internal', range: fn.range,
      returnType: typeFor(header.returnId),
      parameters: fn.parameters.map((p,index) => ({ id: p.id, name: p.name, type: header.parameterTypes[index], range: p.range })),
      body: fn.body.map((item, index) => statement(item, guarded && index === fn.body.length - 1)) };
  });
  return { format, snapshot, inputIdentity: snapshot.inputIdentity, source, target: snapshot.target,
    types: [scalarType, ...(hasGuards ? [boolType] : []), ...nullableTypes.filter(type => usedTypes.has(type.id))], functions };
}
function verifyProjection(actual, expected) {
  const anchor = range => ({ sourceId: expected.source.path, start: range.start, end: range.end });
  const at = (condition, category, range) => demand(condition, category, anchor(range));
  const rangeAt = (value, original) => { shape(value, original, anchor(original)); at(same(value, original), 'range', original); };
  const list = (value, original, category, range, visit) => {
    at(Array.isArray(value), 'schema', range); at(value.length === original.length, category, range);
    original.forEach((item, index) => visit(value[index], item));
  };
  function node(value, original) {
    const span = anchor(original.range); shape(value, original, span);
    at(value.kind === original.kind, 'capability', original.range);
    if (Object.hasOwn(original, 'type')) at(value.type === original.type, 'type', original.range);
    rangeAt(value.range, original.range);
    if (original.kind === 'reference') at(value.binding === original.binding, 'binding', original.range);
    else if (original.kind === 'call') {
      at(value.target === original.target && value.signatureHash === original.signatureHash, 'signature', original.range);
      list(value.arguments, original.arguments, 'signature', original.range, node);
    } else if (original.kind === 'local') {
      const binding = original.binding; shape(value.binding, binding, anchor(binding.range));
      at(value.binding.id === binding.id && value.binding.name === binding.name, 'binding', binding.range);
      at(value.binding.type === binding.type, 'type', binding.range);
      at(value.binding.mutable === binding.mutable, 'permission', binding.range); rangeAt(value.binding.range, binding.range);
      node(value.initializer, original.initializer);
    } else if (original.kind === 'return') node(value.value, original.value);
    else if (original.kind === 'if') {
      node(value.condition, original.condition);
      list(value.thenBody, original.thenBody, 'capability', original.range, node);
      list(value.elseBody, original.elseBody, 'capability', original.range, node);
    } else if (original.kind === 'block') list(value.body, original.body, 'capability', original.range, node);
    else if (original.kind === 'nullableTagTest') {
      at(value.tag === original.tag, 'flow', original.tagRange); rangeAt(value.tagRange, original.tagRange);
      node(value.operand, original.operand);
    } else if (original.kind === 'nullableGet' || original.kind === 'nullableWrap' || original.kind === 'group') node(value.operand, original.operand);
    else if (original.kind === 'nullableCoalesce') { node(value.left, original.left); node(value.right, original.right); }
  }
  demand(same(actual.inputIdentity, expected.inputIdentity) && same(actual.source, expected.source)
    && same(actual.target, expected.target), 'identity');
  demand(same(actual.types, expected.types), 'type');
  demand(Array.isArray(actual.functions) && actual.functions.length === expected.functions.length, 'hir');
  // Complete the global declaration table before granting any local owner anchor.
  expected.functions.forEach((fn, index) => shape(actual.functions[index], fn));
  expected.functions.forEach((fn, index) => {
    const value = actual.functions[index];
    demand(value.id === fn.id && value.signatureHash === fn.signatureHash, 'identity');
  });
  expected.functions.forEach((fn, index) => {
    const value = actual.functions[index];
    at(value.name === fn.name && value.ownedSymbol === fn.ownedSymbol && value.role === fn.role, 'symbol', fn.range);
    rangeAt(value.range, fn.range); at(same(value.returnType, fn.returnType), 'type', fn.range);
    list(value.parameters, fn.parameters, 'signature', fn.range, (parameter, original) => {
      shape(parameter, original, anchor(original.range));
      at(parameter.id === original.id && parameter.name === original.name, 'binding', original.range);
      at(parameter.type === original.type, 'signature', original.range); rangeAt(parameter.range, original.range);
    });
    list(value.body, fn.body, 'capability', fn.range, node);
  });
  demand(same(actual, expected), 'hir');
}
export function buildNullableHir(snapshot, context = undefined) {
  if (context === undefined) { const result = project(nullableSnapshotFacts(snapshot)); budget(result); return own(result); }
  try {
    selectedContext(context); selectedBudget(snapshot, false);
    const result = project(nullableSnapshotFacts(snapshot, context), context.sourceVersion === 5 ? groupsHirFormat : presenceHirFormat);
    selectedBudget(result, true); return presenceOwn(result);
  } catch (error) { selectedRethrow(error); }
}
export function verifyNullableHir(hir, context = undefined) {
  if (context === undefined) {
    budget(hir); record(hir, ['format','snapshot','inputIdentity','source','target','types','functions']);
    check(same(hir.format, hirFormat), 'schema');
    const expected = project(nullableSnapshotFacts(hir.snapshot));
    check(same(hir, expected), 'hir'); return own(expected);
  }
  try {
    selectedContext(context); selectedBudget(hir, true);
    record(hir, ['format','snapshot','inputIdentity','source','target','types','functions']);
    demand(same(hir.format, context.sourceVersion === 5 ? groupsHirFormat : presenceHirFormat), 'schema');
    const expected = project(nullableSnapshotFacts(hir.snapshot, context), context.sourceVersion === 5 ? groupsHirFormat : presenceHirFormat);
    selectedBudget(expected, true); verifyProjection(hir, expected); return presenceOwn(expected);
  } catch (error) { selectedRethrow(error); }
}

// Selected5 reader checks the caller context before copying or inspecting bytes.
export function readNullableGroupsHir(bytes, context) {
  try { selectedContext(context); return verifyNullableHir(readGroupsHirJson(bytes), context); }
  catch (error) { selectedRethrow(error); }
}
