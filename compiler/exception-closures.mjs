// SPDX-License-Identifier: MIT
import { check, record, array, text, same, wireLimits } from './exception-common.mjs';
import { exceptionScope } from './exception-scope.mjs';
import { exceptionIdentifierName } from './exception-identifiers.mjs';
import { exceptionCallableSignature } from './exception-callable.mjs';

// This finite seam owns scalar nested declarations and direct read-only captures
// of an initialized enclosing catch binding. It proves no environment instance,
// Runtime cell, call target identity beyond this source, or GC/ABI property.
export function prepareExceptionClosures(functions) {
  if (!Array.isArray(functions) || !functions.some(fn => fn && Object.hasOwn(fn, 'lexicalParent'))) return null;
  array(functions, wireLimits.functions, 1);
  const byId = new Map(), ordinal = new Map();
  for (const [index, fn] of functions.entries()) {
    check(fn && typeof fn === 'object' && !Array.isArray(fn), 'schema'); text(fn.symbol);
    check(fn.symbol === 's' + (index + 1) && !byId.has(fn.symbol), 'symbol');
    check(fn.returnType === 'bool' && !Object.hasOwn(fn, 'returnPresence') && !Object.hasOwn(fn, 'returnSignature'), 'capability', 'closure functions currently require nonnullable bool results');
    if (Object.hasOwn(fn, 'lexicalParent')) {
      text(fn.lexicalParent); check(byId.has(fn.lexicalParent), 'scope', 'lexical parent must precede its child');
      check(array(fn.parameters).length === 0, 'capability', 'nested function parameters require a separate cold tracer');
    }
    byId.set(fn.symbol, fn); ordinal.set(fn.symbol, index);
  }
  check(functions.filter(fn => !Object.hasOwn(fn, 'lexicalParent')).length === 1, 'capability', 'multiple closure roots require a separate cold tracer');
  const bindingsByOwner = new Map(), claimedByOwner = new Map(), captured = new Map(), catches = new Set(), seen = [];
  for (const fn of functions) {
    bindingsByOwner.set(fn.symbol, []); claimedByOwner.set(fn.symbol, 0); captured.set(fn.symbol, new Map());
    let ancestor = fn, depth = 0;
    while (ancestor.lexicalParent) { check(++depth <= wireLimits.depth, 'limit'); ancestor = byId.get(ancestor.lexicalParent); }
  }
  const state = { byId, calls: 0,
    bindDefinitions(definitions) {
      // Source registers all headers first, then bindings per function. Inline
      // body verification uses per-owner cursors without changing those IDs.
      let previousOwner = -1;
      for (const binding of definitions.values()) {
        if (binding.kind === 'function') {
          const fn = byId.get(binding.id); check(fn, 'symbol');
          check(Object.hasOwn(binding, 'lexicalOwner') === Object.hasOwn(fn, 'lexicalParent')
            && binding.lexicalOwner === fn.lexicalParent, 'scope', 'function lexical ownership differs from its declaration');
        } else {
          check(['parameter','local'].includes(binding.kind) && Object.hasOwn(binding, 'lexicalOwner') && byId.has(binding.lexicalOwner), 'scope', 'closure binding requires its original function owner');
          const owner = ordinal.get(binding.lexicalOwner);
          check(owner >= previousOwner, 'symbol', 'binding registry must retain Source function projection order'); previousOwner = owner;
          bindingsByOwner.get(binding.lexicalOwner).push(binding.id);
        }
      }
    },
    claim(binding, fn) {
      if (binding.kind === 'function') return;
      check(fn && binding.lexicalOwner === fn.symbol, 'scope', 'declaration belongs to another function');
      const next = claimedByOwner.get(fn.symbol), owned = bindingsByOwner.get(fn.symbol);
      check(owned[next] === binding.id, 'symbol', 'function-local declaration order differs'); claimedByOwner.set(fn.symbol, next + 1);
    },
    enter(fn, parentScope) {
      check(byId.get(fn.symbol) === fn && seen.length < functions.length && functions[seen.length] === fn, 'scope', 'function declarations must follow source preorder'); seen.push(fn);
      const scope = exceptionScope(parentScope);
      // A child body is not executed while its declaration is inspected. Caller
      // occurrence proofs never become inherited closure declaration types.
      scope.proofs = new Set(); scope.never = new Set(); scope.effects = new Map();
      return scope;
    },
    reserve(body, scope, context) {
      for (const item of body) if (item?.kind === 'functionDeclaration') {
        record(item, ['kind','symbol','range']);
        const binding = item.symbol, child = binding && byId.get(binding.id);
        check(child && same(binding, context.definitions.get(binding.id)) && child.lexicalParent === context.activeFunction.symbol, 'scope');
        check(!scope.declared.has(binding.name), 'scope', 'duplicate block lexical function declaration');
        scope.declared.add(binding.name); scope.bindings.set(binding.name, binding.id);
      }
    },
    catchBinding(binding) { catches.add(binding.id); },
    declaration(item, scope, context, index) {
      record(item, ['kind','symbol','range']);
      const binding = item.symbol, child = binding && byId.get(binding.id);
      check(child && child.lexicalParent === context.activeFunction.symbol && same(item.range, child.range)
        && same(binding, context.definitions.get(binding.id)) && scope.bindings.get(binding.name) === binding.id, 'scope', 'nested declaration does not own its table body');
      return context.verifyNestedFunction(child, index, scope);
    },
    access(binding, write, context) {
      const fn = context.activeFunction;
      if (binding.lexicalOwner === fn.symbol) return;
      let parent = fn.lexicalParent;
      while (parent && parent !== binding.lexicalOwner) parent = byId.get(parent).lexicalParent;
      check(parent === binding.lexicalOwner && catches.has(binding.id) && binding.kind === 'local'
        && binding.type === 'unknown' && binding.writable === true, 'capability', 'only original enclosing catch-local captures are implemented');
      check(!write, 'capability', 'captured writes require a separate cold tracer');
      const reads = captured.get(fn.symbol);
      if (!reads.has(binding.id)) reads.set(binding.id, { symbol: binding.id, read: true, write: false });
    },
    directCall(value, parent, scope, context, index, write) {
      record(value, ['kind','type','range','target','arguments','signature']);
      check(!write, 'permission');
      const fn = byId.get(value.target);
      check(fn && fn.lexicalParent && fn.returnType === 'bool' && array(fn.parameters).length === 0
        && scope.bindings.get(fn.name) === fn.symbol, 'scope', 'direct call must resolve its closest owned nested declaration');
      check(value.type === fn.returnType && array(value.arguments).length === 0, 'signature');
      exceptionCallableSignature(value.signature);
      check(same(value.signature, { parameters: [], returnType: fn.returnType }), 'signature');
      const g = context.grammar;
      check(exceptionIdentifierName(g.at(index).text) === fn.name, 'source');
      let next = g.expect(index + 1, '('); next = g.expect(next, ')');
      g.raw(value.range, parent, index, next - 1); state.calls++;
      return { type: value.type, next, mask: 0 };
    },
    exit(fn) {
      const expected = [...captured.get(fn.symbol).values()];
      check(expected.length ? Object.hasOwn(fn, 'captures') && same(fn.captures, expected) : !Object.hasOwn(fn, 'captures'), 'scope', 'complete direct capture set differs from this function body');
    },
    finish() {
      check(seen.length === functions.length, 'source', 'function table contains an uncovered declaration');
      for (const [owner, bindings] of bindingsByOwner) check(claimedByOwner.get(owner) === bindings.length, 'symbol');
    },
  };
  return state;
}
