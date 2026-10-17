// SPDX-License-Identifier: MIT
import { limits, check, failure } from './exception-hir-common.mjs';
import { createExceptionHirTypes, createExceptionHirProjectionBudget, exceptionHirIdentity } from './exception-hir-identity.mjs';
import { projectExceptionHirFunctions } from './exception-hir-functions.mjs';
import { createExceptionHirAggregates } from './exception-hir-aggregates.mjs';

// Called only with Root's cold-rebuilt, independently owned snapshot. The seven
// fields stay internal until the boundary budgets and independently clones the
// complete HIR; immutable input references are never an ownership certificate.
/** @param {any} snapshot */
export function projectExceptionHirModel(snapshot) {
  const facts = snapshot.facts, sources = snapshot.sources, groups = snapshot.exports;
  check(Array.isArray(sources) && Array.isArray(groups), 'schema', 'HIR sources and exports must be arrays');
  check(sources.length <= limits.derived.files && groups.length <= limits.derived.files, 'limit', 'HIR source budget exceeded');
  if (sources.length !== 1 || facts.modules !== undefined || snapshot.identityInput.compilationClosure !== undefined)
    failure('capability', 'module or multi-source HIR requires its own tracer');
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
    if (!['function', 'parameter', 'local', 'class', 'field'].includes(symbol.kind))
      failure('capability', 'HIR symbol kind is not implemented: ' + symbol.kind);
    definitions.set(symbol.id, symbol);
  }
  const types = createExceptionHirTypes(), budget = createExceptionHirProjectionBudget();
  const moduleId = exceptionHirIdentity('module', { source: { path: source.path, digest: source.hash }, external: group.external });
  budget.scope();
  const moduleScope = exceptionHirIdentity('scope', { ownerKind: 'module', owner: moduleId, path: [] });
  const aggregates = createExceptionHirAggregates(facts.aggregateFacts, definitions, source, types);
  const claimed = new Set();
  const { headers, functions: projected } = projectExceptionHirFunctions({
    functions, definitions, types, budget, moduleId, moduleScope, sourcePath: source.path, claimed, aggregates,
  });
  for (const symbol of symbols) check(symbol.kind === 'function' ? headers.has(symbol.id)
    : ['class', 'field'].includes(symbol.kind) ? aggregates?.ownsSymbol(symbol.id) : claimed.has(symbol.id),
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
      functions: projected.map(fn => fn.id), aggregateTypes: aggregates?.typeIds() ?? [], imports: [], globals: [],
      initialization: null, closure: null, coverage: aggregates?.coverage(headers) ?? null }], exports };
}
