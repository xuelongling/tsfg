// SPDX-License-Identifier: MIT
import { limits, check, failure } from './exception-hir-common.mjs';
import { createExceptionHirTypes, createExceptionHirProjectionBudget, exceptionHirIdentity } from './exception-hir-identity.mjs';
import { createExceptionHirRegions } from './exception-hir-regions.mjs';

// Called only with Root's cold-rebuilt, independently owned snapshot. The seven
// fields stay internal until the boundary budgets and independently clones the
// complete HIR; immutable input references are never an ownership certificate.
/** @param {any} snapshot */
export function projectExceptionHirModel(snapshot) {
  const facts = snapshot.facts, sources = snapshot.sources, groups = snapshot.exports;
  check(Array.isArray(sources) && Array.isArray(groups), 'schema', 'HIR sources and exports must be arrays');
  check(sources.length <= limits.derived.files && groups.length <= limits.derived.files, 'limit', 'HIR source budget exceeded');
  if (sources.length !== 1 || facts.modules !== undefined || facts.aggregateFacts !== undefined
      || snapshot.identityInput.compilationClosure !== undefined)
    failure('capability', 'module, aggregate or multi-source HIR requires its own tracer');
  check(groups.length === 1 && groups[0].sourcePath === sources[0].path, 'source', 'HIR export group has foreign source ownership');
  const functions = facts.functions ?? [], symbols = facts.symbols, source = sources[0], group = groups[0];
  check(Array.isArray(functions) && Array.isArray(symbols), 'schema', 'HIR functions and symbols must be arrays');
  check(functions.length <= limits.derived.functions && symbols.length <= limits.derived.bindings,
    'limit', 'HIR function or symbol table budget exceeded');
  if (!functions.length) failure('capability', 'HIR without owned functions requires its own tracer');
  const definitions = new Map();
  for (const symbol of symbols) {
    check(definitions.size < limits.derived.bindings, 'limit', 'HIR symbol table budget exceeded');
    check(!definitions.has(symbol.id), 'identity', 'HIR symbol registry repeats an identity');
    if (!['function', 'parameter', 'local'].includes(symbol.kind))
      failure('capability', 'HIR symbol kind is not implemented: ' + symbol.kind);
    definitions.set(symbol.id, symbol);
  }
  const types = createExceptionHirTypes(), budget = createExceptionHirProjectionBudget();
  const moduleId = exceptionHirIdentity('module', { source: { path: source.path, digest: source.hash }, external: group.external });
  budget.scope();
  const moduleScope = exceptionHirIdentity('scope', { ownerKind: 'module', owner: moduleId, path: [] });
  const headers = new Map(), claimed = new Set();
  for (const fn of functions) {
    check(headers.size < limits.derived.functions, 'limit', 'HIR function table budget exceeded');
    if (fn.lexicalParent !== undefined || fn.captures !== undefined || fn.returnType === 'unknown')
      failure('capability', 'nested or unknown-result HIR functions require their own tracer');
    check(Array.isArray(fn.parameters), 'schema', 'HIR parameter list is missing');
    check(fn.parameters.length <= limits.derived.parametersPerFunction, 'limit', 'HIR parameter budget exceeded');
    if (fn.parameterInitializers !== undefined) {
      check(Array.isArray(fn.parameterInitializers) && fn.parameterInitializers.length === fn.parameters.length,
        'schema', 'HIR parameter initializers must remain aligned');
      if (fn.parameterInitializers.some(/** @param {any} value */ value => value !== null))
        failure('capability', 'HIR parameter defaults require their own tracer');
    }
    const parameterTypes = [];
    for (const parameter of fn.parameters) {
      if (parameter.type === 'unknown' || parameter.presence && (parameter.presence.optional || parameter.presence.default))
        failure('capability', 'unknown or optional HIR parameters require their own tracer');
      if ((parameter.type === 'function') !== (fn.returnType === 'function'))
        failure('capability', 'mixed callable and scalar HIR declarations require their own tracer');
      parameterTypes.push(types.value(parameter.type, parameter.signature, parameter.presence));
    }
    const returnType = types.value(fn.returnType, fn.returnSignature, fn.returnPresence);
    const signatureHash = exceptionHirIdentity('signature', { parameters: parameterTypes, returnType });
    const type = types.callable(parameterTypes, returnType);
    const definition = definitions.get(fn.symbol);
    check(definition?.kind === 'function' && definition.name === fn.name && definition.type === fn.returnType,
      'scope', 'HIR function does not own its declaration symbol');
    check(!headers.has(fn.symbol), 'identity', 'HIR function identity is repeated');
    const id = exceptionHirIdentity('function', { module: moduleId, parent: null, declaringScopePath: [],
      name: fn.name, signatureHash, range: fn.range });
    headers.set(fn.symbol, { id, module: moduleId, sourcePath: source.path, nameRange: definition.range,
      type, returnType, signatureHash, declaringScope: moduleScope });
  }
  const regions = createExceptionHirRegions(definitions, types, budget, claimed), projected = [];
  for (const fn of functions) {
    check(projected.length < limits.derived.functions, 'limit', 'HIR function array budget exceeded');
    projected.push(regions.project(fn, headers.get(fn.symbol)));
  }
  for (const symbol of symbols) check(symbol.kind === 'function' ? headers.has(symbol.id) : claimed.has(symbol.id),
    'scope', 'HIR leaves an owned declaration unprojected');
  const exports = [], bindings = [];
  check(Array.isArray(group.bindings) && group.bindings.length <= limits.derived.arrayItems, 'limit', 'HIR export array budget exceeded');
  for (const binding of group.bindings) {
    const target = headers.get(binding.target);
    check(target && binding.sourcePath === source.path, 'scope', 'HIR export has no same-source function');
    bindings.push({ name: binding.name, target: target.id, sourcePath: binding.sourcePath,
      range: binding.range, definition: binding.definition });
  }
  exports.push({ module: moduleId, sourcePath: source.path, external: group.external, bindings });
  return { inputIdentity: snapshot.inputIdentity, sources, target: snapshot.target, types: types.records(), functions: projected,
    modules: [{ id: moduleId, sourcePath: source.path, external: group.external,
      functions: projected.map(fn => fn.id), aggregateTypes: [], imports: [], globals: [],
      initialization: null, closure: null, coverage: null }], exports };
}
