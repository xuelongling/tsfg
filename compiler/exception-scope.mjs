// SPDX-License-Identifier: MIT
import { check, same } from './exception-common.mjs';

// Declaration types never narrow. These internal states describe occurrences;
// never is an unsupported occurrence, not permission to downgrade to unknown.
const identity = Object.freeze([0, 1, 2]); // declared payload, boolean, never
const state = (scope, id) => scope.never.has(id) ? 2 : scope.proofs.has(id) ? 1 : 0;
const join = states => { const normal = states.filter(value => value !== 2); return normal.length ? normal.every(value => value === 1) ? 1 : 0 : states.length ? 2 : 0; };
function setState(scope, id, value) {
  scope.proofs.delete(id); scope.never.delete(id);
  if (value === 1) scope.proofs.add(id);
  if (value === 2) scope.never.add(id);
}
function transfer(scope, id, operation) {
  const before = scope.effects.get(id) ?? identity;
  scope.effects.set(id, before.map(value => operation[value]));
  setState(scope, id, operation[state(scope, id)]);
}

export const exceptionScope = parent => ({ bindings: new Map(parent?.bindings ?? []), declared: new Set(),
  pending: new Set(parent?.pending ?? []), proofs: new Set(parent?.proofs ?? []),
  never: new Set(parent?.never ?? []), effects: new Map(parent?.effects ?? []), writes: new Set() });
export function declareExceptionBinding(binding, scope, context) {
  check(binding && same(binding, context.definitions.get(binding.id)), 'symbol', 'embedded binding differs from its definition');
  check(!scope.declared.has(binding.name), 'scope', 'duplicate lexical declaration');
  scope.declared.add(binding.name); scope.bindings.set(binding.name, binding.id); scope.pending.delete(binding.id); context.claim(binding.id);
}
export function reserveExceptionBindings(body, scope, context) {
  const declared = new Set(scope.declared);
  for (const item of body) if (item?.kind === 'variable') {
    const binding = item.symbol;
    check(binding && same(binding, context.definitions.get(binding.id)), 'symbol');
    check(!declared.has(binding.name), 'scope', 'duplicate block lexical declaration');
    declared.add(binding.name); scope.bindings.set(binding.name, binding.id); scope.pending.add(binding.id);
  }
}
export function exceptionBinding(id, scope, context, write = false) {
  const binding = context.definitions.get(id);
  check(binding && ['parameter','local'].includes(binding.kind) && scope.bindings.get(binding.name) === binding.id, 'scope');
  check(!scope.pending.has(binding.id), 'scope', 'block lexical binding is used before initialization');
  if (write) check(binding.writable === true, 'permission', 'assignment requires a writable binding');
  else check(!scope.never.has(binding.id), 'capability', 'never occurrence has no private consumer tracer');
  return binding;
}
export function exceptionOccurrenceType(binding, scope, write = false) {
  return !write && binding.type === 'unknown' && scope.proofs.has(binding.id) ? 'bool' : binding.type;
}
export function exceptionWrite(scope, id) { transfer(scope, id, [0, 0, 0]); scope.writes.add(id); }
export function exceptionBranchScope(scope, test, truth, definitions) {
  const child = exceptionScope(scope);
  if (test) {
    const binding = definitions.get(test.symbol);
    check(binding, 'scope');
    if (test.booleanWhenTrue === truth) transfer(child, test.symbol, [1, 1, 2]);
    else transfer(child, test.symbol, binding.type === 'bool' ? [2, 2, 2] : [0, 2, 2]);
  }
  return child;
}
export function exceptionDropWrittenProofs(scope, paths) {
  for (const path of paths) for (const id of path.writes) transfer(scope, id, [0, 0, 0]);
}
/** @param {any} [finallyScope] */
export function mergeExceptionScopes(scope, normalPaths, allPaths = normalPaths, finallyScope = undefined) {
  const visible = new Set(scope.bindings.values());
  // Finally's DTO is checked once from a conservative all-path entry. Its local
  // transfer then resumes original normal paths; unioning exit proof sets would
  // wrongly restore a boolean excluded by a guard inside finally. Operations are
  // immutable three-state tables for the already supported typeof/write forms.
  const exits = normalPaths.map(path => {
    if (!finallyScope) return path;
    const exit = exceptionScope(path);
    exceptionDropWrittenProofs(exit, [finallyScope]);
    for (const [id, operation] of finallyScope.effects) transfer(exit, id, operation);
    return exit;
  });
  const effects = new Map();
  scope.proofs = new Set(); scope.never = new Set();
  for (const id of visible) {
    setState(scope, id, join(exits.map(path => state(path, id))));
    const operations = exits.map(path => path.effects.get(id) ?? identity);
    effects.set(id, identity.map((_, index) => join(operations.map(operation => operation[index]))));
  }
  scope.effects = effects;
  for (const path of allPaths) for (const id of path.writes) scope.writes.add(id);
}
