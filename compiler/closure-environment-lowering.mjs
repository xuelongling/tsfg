// SPDX-License-Identifier: MIT
import { canonical, sha256 } from './identity.mjs';
import { limits } from './closure-common.mjs';
import { checkGenericJsonValueBudget } from './generic-json.mjs';
export { limits };

/** @returns {never} */
export function environmentFailure(category, message, primary = undefined) {
  const capability = category === 'capability';
  const code = capability ? 'r03-d-capability' : 'r03-closure-environments-' + category;
  throw Object.assign(new TypeError(code + ': ' + message), { code,
    ruleId: capability ? 'r01-ts-baseline' : 'r01-input-boundary', phase: 'lowering',
    ...(primary ? { primary } : {}) });
}
export function environmentBudget(value) {
  try { checkGenericJsonValueBudget(value, limits); }
  catch (error) { environmentFailure(error.code?.endsWith('-limit') ? 'limit' : 'input', 'invalid closure-explicit program input'); }
}
const compare = (a, b) => Buffer.from(a).compare(Buffer.from(b));

/** Convert only the verified owned graph. Layout identities describe storage,
 * while allocateEnvironment remains an operation inside each dynamic invocation.
 * No target inference, Source parsing or concrete environment execution occurs.
 */
export function lowerEnvironmentGraph(hir, hirHash) {
  let work = 0;
  const step = () => { if (++work > 1000000) environmentFailure('limit', 'environment lowering work budget exceeded'); };
  const functions = new Map(hir.functions.map(fn => [fn.id, fn]));
  const bindings = new Map(), functionBodyLocals = new Set(), captured = new Set(), ownedSlots = new Map();
  function collect(body, direct) {
    for (const item of body) {
      step();
      if (item.kind === 'local') {
        bindings.set(item.binding.id, { ...item.binding, role: 'local' });
        if (direct) functionBodyLocals.add(item.binding.id);
      }
      for (const key of ['body', 'thenBody', 'elseBody']) if (item[key]) collect(item[key], false);
    }
  }
  for (const fn of hir.functions) {
    for (const parameter of fn.parameters) {
      step(); bindings.set(parameter.id, { ...parameter, role: 'parameter' });
    }
    collect(fn.body, true);
  }
  for (const fn of hir.functions) for (const capture of fn.captures) {
    step();
    if (functions.has(capture.binding)) continue;
    const binding = bindings.get(capture.binding);
    if (!binding) environmentFailure('program', 'capture binding is outside verified definitions');
    if (binding.role === 'local' && !functionBodyLocals.has(binding.id))
      environmentFailure('capability', 'captured block/loop local environment activation is not implemented: ' + binding.id,
        { source: hir.source.path, start: binding.range.start, end: binding.range.end, owner: binding.owner, binding: binding.id });
    captured.add(binding.id);
  }
  for (const id of captured) {
    const binding = bindings.get(id);
    if (!ownedSlots.has(binding.owner)) ownedSlots.set(binding.owner, []);
    ownedSlots.get(binding.owner).push({ binding: id, type: binding.type, writable: binding.writable });
  }
  const layouts = new Map(), layoutIds = new Map();
  function nearestLayout(id) {
    while (id !== null) {
      step();
      if (ownedSlots.has(id)) return layout(id);
      id = functions.get(id).lexicalParent;
    }
    return null;
  }
  function layout(id) {
    if (layouts.has(id)) return layouts.get(id);
    step();
    const parent = nearestLayout(functions.get(id).lexicalParent);
    const slots = [...ownedSlots.get(id)].sort((a, b) => compare(a.binding, b.binding));
    const payload = { owner: id, parent: parent?.id ?? null, slots };
    const result = { id: sha256('tsfg.closure-environment-layout.v1\0' + canonical(payload)), ...payload };
    layouts.set(id, result); layoutIds.set(result.id, result); return result;
  }
  for (const id of ownedSlots.keys()) layout(id);
  function environment(fn, expected) {
    if (expected === null) return null;
    step();
    const own = layouts.get(fn.id);
    if (own?.id === expected) return { kind: 'activationEnvironment', layout: own.id };
    let current = nearestLayout(fn.lexicalParent);
    if (!current) environmentFailure('program', 'required lexical environment is not accessible');
    /** @type {any} */ let result = { kind: 'incomingEnvironment', layout: current.id };
    while (current.id !== expected) {
      step();
      current = layoutIds.get(current.parent);
      if (!current) environmentFailure('program', 'required environment is outside the lexical parent chain');
      result = { kind: 'parentEnvironment', layout: current.id, environment: result };
    }
    return result;
  }
  const targetEnvironment = (fn, target) => environment(fn, nearestLayout(functions.get(target).lexicalParent)?.id ?? null);
  const bindingEnvironment = (fn, binding) => environment(fn, layouts.get(bindings.get(binding).owner).id);
  function location(value) {
    step();
    if (value.kind === 'reference') return value.binding;
    if (value.kind === 'group') return location(value.operand);
    environmentFailure('program', 'verified assignment has no owned binding location');
  }
  function capturedLocation(fn, value, binding) {
    return { binding, type: value.type, range: value.range, environment: bindingEnvironment(fn, binding) };
  }
  function expression(fn, value) {
    step();
    if (value.kind === 'reference') return captured.has(value.binding)
      ? { kind: 'environmentLoad', type: value.type, range: value.range, binding: value.binding,
        environment: bindingEnvironment(fn, value.binding) } : { ...value };
    if (value.kind === 'functionReference') return { kind: 'makeClosure', type: value.type, range: value.range,
      function: value.target, environment: targetEnvironment(fn, value.target) };
    if (value.kind === 'call') return { ...value, environment: targetEnvironment(fn, value.target),
      arguments: value.arguments.map(argument => expression(fn, argument)) };
    if (value.kind === 'indirectCall') return { ...value, kind: 'closureCall', callee: expression(fn, value.callee),
      arguments: value.arguments.map(argument => expression(fn, argument)) };
    if (value.kind === 'write') {
      const binding = location(value.left);
      if (captured.has(binding)) return { kind: 'environmentWrite', type: value.type, range: value.range,
        target: capturedLocation(fn, value.left, binding), value: expression(fn, value.right) };
    }
    if (!['constant', 'floating', 'boolean', 'group', 'unary', 'binary', 'shortCircuit', 'write'].includes(value.kind))
      environmentFailure('capability', 'unsupported verified closure expression: ' + value.kind);
    return { ...value, ...Object.fromEntries(['left', 'right', 'operand'].filter(key => value[key])
      .map(key => [key, expression(fn, value[key])])) };
  }
  function statement(fn, item) {
    step();
    if (item.kind === 'functionDeclaration') return { ...item };
    if (item.kind === 'local') {
      const initializer = expression(fn, item.initializer);
      if (captured.has(item.binding.id)) return { kind: 'initializeEnvironment', binding: item.binding.id,
        environment: bindingEnvironment(fn, item.binding.id), value: initializer, anchor: { kind: 'source', range: item.range } };
      return { ...item, binding: item.binding.id, initializer };
    }
    if (item.kind === 'return' || item.kind === 'expression') return { ...item, value: expression(fn, item.value) };
    if (item.kind === 'assign') {
      const binding = location(item.target);
      if (captured.has(binding)) return { kind: 'environmentStore', range: item.range,
        target: capturedLocation(fn, item.target, binding), value: expression(fn, item.value) };
      return { ...item, target: expression(fn, item.target), value: expression(fn, item.value) };
    }
    if (!['block', 'if', 'while'].includes(item.kind))
      environmentFailure('capability', 'unsupported verified closure statement: ' + item.kind);
    return { ...item, ...(item.condition ? { condition: expression(fn, item.condition) } : {}),
      ...Object.fromEntries(['body', 'thenBody', 'elseBody'].filter(key => item[key])
        .map(key => [key, item[key].map(child => statement(fn, child))])) };
  }
  const explicitFunctions = hir.functions.map(fn => {
    const { captures, body, parameters, ...identity } = fn;
    const lexical = nearestLayout(fn.lexicalParent), activation = layouts.get(fn.id), entry = [];
    if (activation) {
      entry.push({ kind: 'allocateEnvironment', layout: activation.id,
        parent: lexical ? { kind: 'incomingEnvironment', layout: lexical.id } : null,
        anchor: { kind: 'function-entry', range: fn.definitionRange } });
      for (const parameter of parameters) if (captured.has(parameter.id)) {
        step(); entry.push({ kind: 'initializeEnvironment', binding: parameter.id,
          environment: { kind: 'activationEnvironment', layout: activation.id },
          value: { kind: 'reference', type: parameter.type, range: parameter.range, binding: parameter.id },
          anchor: { kind: 'parameter', range: parameter.range } });
      }
    }
    return { ...identity, parameters: parameters.map(parameter => parameter.id),
      lexicalEnvironment: lexical?.id ?? null, activationEnvironment: activation?.id ?? null,
      body: [...entry, ...body.map(item => statement(fn, item))] };
  });
  const program = { format: { family: 'tsfg.closure-environments-candidate', version: 1 }, hirHash,
    inputIdentity: hir.inputIdentity, source: hir.source, sourceOrigin: hir.sourceOrigin, target: hir.target, types: hir.types,
    bindings: [...bindings.values()].sort((a, b) => compare(a.id, b.id)),
    environments: [...layouts.values()].sort((a, b) => compare(a.id, b.id)), functions: explicitFunctions };
  environmentBudget(program); return program;
}
