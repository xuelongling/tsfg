// SPDX-License-Identifier: MIT
import { bindingIdentity } from './closure-common.mjs';

/** Internal consumer precondition for function-body captured locals. The input
 * is the complete cold-verified 19f program. This analyzes owned typed ops, not
 * Source or TS types, and returns only the metadata's declaration ordinals.
 */
export function closureCoreInitialization(program, step, fail) {
  const bindings = new Map(program.bindings.map(binding => [binding.id, binding]));
  const functions = new Map(program.functions.map(fn => [fn.id, fn]));
  const captured = new Set(program.environments.flatMap(layout => layout.slots.map(slot => slot.binding)));
  const ordinals = new Map(), ancestors = new Map(), requirements = new Map(), edges = new Map();
  for (const fn of functions.values()) {
    const parents = new Set(); let parent = fn.lexicalParent;
    while (parent !== null) {
      step();
      if (!functions.has(parent) || parents.has(parent)) fail('program', 'invalid initialization ancestry');
      parents.add(parent); parent = functions.get(parent).lexicalParent;
    }
    ancestors.set(fn.id, parents); requirements.set(fn.id, new Map()); edges.set(fn.id, new Set());
    fn.parameters.forEach((id, index) => {
      step();
      if (bindings.get(id)?.role !== 'parameter' || id !== bindingIdentity(fn.id, 'parameter', '0:' + index))
        fail('program', 'parameter declaration identity differs');
      ordinals.set(id, index);
    });
    let localIndex = 0;
    // Only scope 0 declarations participate. Nested locals never consume its
    // ordinal; 19f already rejects any captured block/loop-local storage.
    for (const item of fn.body) {
      step();
      const id = item.kind === 'local' ? item.binding
        : item.kind === 'initializeEnvironment' && item.anchor.kind === 'source' ? item.binding : null;
      if (id === null) continue;
      const binding = bindings.get(id);
      if (binding?.role !== 'local' || binding.owner !== fn.id
          || id !== bindingIdentity(fn.id, 'local', '0:' + localIndex))
        fail('program', 'function-body local declaration identity differs');
      ordinals.set(id, localIndex++);
    }
  }
  for (const id of captured) {
    step();
    if (!ordinals.has(id)) fail('capability', 'closure Core emission requires function-body captured storage', {
      source: program.source.path, ...bindings.get(id)?.range, owner: bindings.get(id)?.owner, binding: id });
  }
  function scan(fn, value) {
    if (!value || typeof value !== 'object') return;
    step();
    const bindingId = value.kind === 'environmentLoad' ? value.binding
      : ['environmentStore', 'environmentWrite'].includes(value.kind) ? value.target.binding : null;
    if (bindingId !== null) {
      const binding = bindings.get(bindingId);
      if (binding.role === 'local' && ancestors.get(fn.id).has(binding.owner))
        requirements.get(fn.id).set(bindingId, [fn.id]);
    }
    const target = value.kind === 'call' ? value.target : value.kind === 'makeClosure' ? value.function : null;
    if (target !== null) {
      if (!functions.has(target)) fail('program', 'initialization dependency target is not owned');
      edges.get(fn.id).add(target);
    }
    for (const child of Object.values(value)) scan(fn, child);
  }
  for (const fn of functions.values()) scan(fn, fn.body);
  let grew = true;
  while (grew) {
    grew = false;
    for (const fn of functions.values()) for (const target of edges.get(fn.id)) {
      step();
      for (const [id, path] of requirements.get(target)) {
        step();
        if (ancestors.get(fn.id).has(bindings.get(id).owner) && !requirements.get(fn.id).has(id)) {
          requirements.get(fn.id).set(id, [fn.id, ...path]); step(); grew = true;
        }
      }
    }
  }
  function requireInitialized(fn, state, id, operation, path) {
    step(); const binding = bindings.get(id);
    if (binding.role !== 'local') return;
    if (binding.owner === fn.id ? state.has(id) : requirements.get(fn.id).has(id)) return;
    const range = operation.range ?? operation.anchor.range;
    fail('capability', 'captured local initialization before closure observation is not proven', {
      source: program.source.path, start: range.start, end: range.end, owner: fn.id, binding: id,
    }, {
      bindingDeclaration: { source: program.source.path, start: binding.range.start, end: binding.range.end,
        owner: binding.owner, binding: id },
      initializationDependency: path,
    });
  }
  function requireTarget(fn, state, target, operation) {
    for (const [id, path] of requirements.get(target))
      requireInitialized(fn, state, id, operation, [fn.id, ...path]);
  }
  function expression(fn, state, value) {
    step();
    if (value.kind === 'environmentLoad') requireInitialized(fn, state, value.binding, value, [fn.id]);
    else if (value.kind === 'environmentWrite') {
      expression(fn, state, value.value);
      requireInitialized(fn, state, value.target.binding, value, [fn.id]);
    } else if (value.kind === 'makeClosure') requireTarget(fn, state, value.function, value);
    else if (value.kind === 'call') {
      for (const argument of value.arguments) expression(fn, state, argument);
      requireTarget(fn, state, value.target, value);
    } else if (value.kind === 'closureCall') {
      // Saving the actual callee precedes ordered arguments, including writes.
      expression(fn, state, value.callee);
      for (const argument of value.arguments) expression(fn, state, argument);
    } else if (value.kind === 'group' || value.kind === 'unary') expression(fn, state, value.operand);
    else if (value.kind === 'binary' || value.kind === 'shortCircuit' || value.kind === 'write') {
      if (value.kind !== 'write') expression(fn, state, value.left);
      expression(fn, state, value.right);
      // Expressions can store but never initialize an owned cell. Checking the
      // possible short-circuit RHS cannot establish initialization on the skip edge.
    } else if (!['reference', 'constant', 'floating', 'boolean'].includes(value.kind))
      fail('program', 'unsupported initialization expression');
  }
  const intersect = (left, right) => new Set([...left].filter(id => right.has(id)));
  function body(fn, state, statements) {
    let live = true;
    for (const item of statements) {
      if (!live) break;
      step();
      if (item.kind === 'allocateEnvironment' || item.kind === 'functionDeclaration') continue;
      if (item.kind === 'initializeEnvironment') {
        expression(fn, state, item.value);
        if (bindings.get(item.binding).owner !== fn.id || state.has(item.binding))
          fail('program', 'environment initialization is not unique to its owner activation');
        state.add(item.binding);
      } else if (item.kind === 'environmentStore') {
        expression(fn, state, item.value);
        requireInitialized(fn, state, item.target.binding, item, [fn.id]);
      } else if (item.kind === 'local') expression(fn, state, item.initializer);
      else if (item.kind === 'assign' || item.kind === 'expression' || item.kind === 'return') {
        expression(fn, state, item.value);
        if (item.kind === 'return') live = false;
      } else if (item.kind === 'block') {
        const result = body(fn, new Set(state), item.body); state = result.state; live = result.live;
      } else if (item.kind === 'if') {
        expression(fn, state, item.condition);
        const yes = body(fn, new Set(state), item.thenBody), no = body(fn, new Set(state), item.elseBody);
        live = yes.live || no.live;
        if (yes.live && no.live) state = intersect(yes.state, no.state);
        else if (yes.live) state = yes.state;
        else if (no.live) state = no.state;
      } else if (item.kind === 'while') {
        expression(fn, state, item.condition);
        body(fn, new Set(state), item.body);
        // Keep the zero-iteration state. In this function-body-only subset no
        // declaration init can occur on a backedge; stores never initialize.
      } else fail('program', 'unsupported initialization statement');
    }
    return { state, live };
  }
  // Each analysis starts with fresh own cells, including recursive invocations;
  // ancestor requirements are preconditions checked at real direct/make edges.
  for (const fn of functions.values()) body(fn, new Set(), fn.body);
  return ordinals;
}
