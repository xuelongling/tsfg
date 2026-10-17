// SPDX-License-Identifier: MIT
import { limits, check, failure } from './exception-hir-common.mjs';
import { createExceptionHirTypes, createExceptionHirProjectionBudget } from './exception-hir-identity.mjs';
import { projectExceptionHirFunctions } from './exception-hir-functions.mjs';
import { createExceptionHirAggregates } from './exception-hir-aggregates.mjs';
import { createExceptionHirModules } from './exception-hir-modules.mjs';

// Called only with Root's cold-rebuilt, independently owned snapshot. The seven
// fields stay internal until the boundary budgets and independently clones the
// complete HIR; immutable input references are never an ownership certificate.
/** @param {any} snapshot */
export function projectExceptionHirModel(snapshot) {
  const facts = snapshot.facts, sources = snapshot.sources;
  const functions = facts.functions ?? [], symbols = facts.symbols;
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
  const ownership = createExceptionHirModules(snapshot, budget);
  const aggregates = createExceptionHirAggregates(facts.aggregateFacts, definitions, sources[0], types);
  const claimed = new Set();
  const { headers, functions: projected, projectInitialization } = projectExceptionHirFunctions({
    functions, definitions, types, budget, ownership, claimed, aggregates,
  });
  const { modules, exports } = ownership.project({ headers, functions: projected, projectInitialization, aggregates });
  for (const symbol of symbols) check(symbol.kind === 'function' ? headers.has(symbol.id)
    : ['class', 'field'].includes(symbol.kind) ? aggregates?.ownsSymbol(symbol.id) : claimed.has(symbol.id),
  'scope', 'HIR leaves an owned declaration unprojected');
  return { inputIdentity: snapshot.inputIdentity, sources, target: snapshot.target,
    types: types.records(), functions: projected, modules, exports };
}
