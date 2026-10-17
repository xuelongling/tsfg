// SPDX-License-Identifier: MIT
import { own } from './identity.mjs';
import { targetDomain, targetFailure as failure, compareBytes, targetBudget } from './closure-target-domain.mjs';

/** Context-insensitive may analysis of the already verified owned expression
 * graph. It never reparses source, invents targets from signatures, specializes
 * environment instances or evaluates scalar values in the host language.
 */
export function solveClosureTargets(hir, roots, hirHash) {
  if (hir?.format?.family !== 'tsfg.closure-hir-candidate')
    throw Object.assign(new TypeError('r03-d-capability: target propagation requires owned closure HIR'),
      { code: 'r03-d-capability', ruleId: 'r01-ts-baseline', phase: 'analysis' });
  const functions = new Map(hir.functions.map(fn => [fn.id, fn])), types = new Map(hir.types.map(type => [type.id, type]));
  const domain = targetDomain(new Set(functions.keys())), bindings = new Map(), captured = new Set();
  const summaries = new Map(), ancestors = new Map(), shared = new Map(), usedShared = new Set(), sites = new Map(), forcedUnknown = new Set();
  const queue = [], queued = new Set();
  const callable = type => types.get(type)?.kind === 'function';
  function collectBindings(body) {
    for (const item of body) {
      if (item.kind === 'local') bindings.set(item.binding.id, { ...item.binding, kind: 'local' });
      for (const key of ['body','thenBody','elseBody']) if (item[key]) collectBindings(item[key]);
    }
  }
  for (const fn of functions.values()) {
    bindings.set(fn.id, { id: fn.id, owner: fn.lexicalParent, type: fn.signature, writable: false, kind: 'function' });
    for (const p of fn.parameters) bindings.set(p.id, { ...p, kind: 'parameter' });
    collectBindings(fn.body);
    summaries.set(fn.id, { fn, reached: false, externalOwners: new Set(),
      parameters: new Map(fn.parameters.filter(p => callable(p.type)).map(p => [p.id, domain.bottom()])),
      returns: callable(fn.returnType) ? domain.bottom() : null, writes: new Map(), unknownEffects: false });
  }
  for (const fn of functions.values()) {
    const owners = new Set(); let parent = fn.lexicalParent;
    while (parent !== null) {
      domain.step();
      if (!functions.has(parent) || owners.has(parent)) failure('identity', 'invalid lexical environment ancestry');
      owners.add(parent); parent = functions.get(parent).lexicalParent;
    }
    ancestors.set(fn.id, owners);
  }
  for (const fn of functions.values()) for (const capture of fn.captures) {
    if (callable(bindings.get(capture.binding)?.type)) captured.add(capture.binding);
  }
  for (const id of captured) shared.set(id, bindings.get(id).kind === 'function' ? domain.single(id) : domain.bottom());
  function schedule(id) { if (!queued.has(id)) { queued.add(id); queue.push(id); } }
  function scheduleReached() {
    for (const id of [...summaries.keys()].sort(compareBytes)) if (summaries.get(id).reached) schedule(id);
  }
  function changed() { domain.grew(); scheduleReached(); }
  function mergeMap(map, key, value) {
    const previous = map.get(key) ?? domain.bottom(), merged = domain.join(previous, value);
    if (map.has(key) && domain.equal(previous, merged)) return false;
    map.set(key, merged); changed(); return true;
  }
  function markReached(id) {
    const summary = summaries.get(id);
    if (!summary) failure('identity', 'reachable target is not owned');
    if (!summary.reached) { summary.reached = true; domain.grew(); schedule(id); }
    return summary;
  }
  function mergeEnvironment(id, externalOwners) {
    const summary = summaries.get(id);
    if (!summary) failure('identity', 'closure environment target is not owned');
    let changedEnvironment = false;
    for (const owner of externalOwners) {
      domain.step();
      if (ancestors.get(id).has(owner) && !summary.externalOwners.has(owner)) {
        summary.externalOwners.add(owner); domain.grew(); changedEnvironment = true;
      }
    }
    if (changedEnvironment && summary.reached) schedule(id);
  }
  function sharedValue(id) {
    usedShared.add(id);
    if (!shared.has(id)) failure('identity', 'captured target binding is not owned');
    return domain.copy(shared.get(id));
  }
  function markUnknown(summary) {
    if (!summary.unknownEffects) { summary.unknownEffects = true; changed(); }
  }
  function store(summary, state, id, targets, effect) {
    if (!callable(bindings.get(id)?.type)) return;
    if (!targets) failure('signature', 'callable binding received a scalar abstract value');
    if (captured.has(id)) {
      usedShared.add(id); mergeMap(shared, id, targets);
      if (effect) mergeMap(summary.writes, id, targets);
    } else state.locals.set(id, domain.copy(targets));
  }
  function load(state, id) {
    if (captured.has(id)) return sharedValue(id);
    return domain.copy(state.locals.get(id) ?? domain.bottom());
  }
  function location(value) {
    if (value.kind === 'reference') return value.binding;
    if (value.kind === 'group') return location(value.operand);
    failure('permission', 'target assignment requires an owned binding location');
  }
  function recordSite(summary, expression, path, targets) {
    const key = summary.fn.id + '\0' + domain.pathKey(path);
    if (!sites.has(key)) sites.set(key, { function: summary.fn.id, expressionPath: [...path], range: expression.range,
      kind: expression.kind, targets: domain.bottom() });
    const site = sites.get(key); site.targets = domain.join(site.targets, targets);
    return key;
  }
  function unknownCall(summary, state, arguments_) {
    markUnknown(summary);
    // Unknown code may invoke the actual callable arguments, with unknown
    // callable parameters. Only discovered owned code values create edges.
    for (const argument of arguments_) if (argument) for (const id of argument.ids) {
      mergeEnvironment(id, summary.externalOwners);
      const callback = markReached(id);
      for (const p of callback.fn.parameters) if (callable(p.type)) mergeMap(callback.parameters, p.id, domain.top());
    }
    // No HostSemanticContract is available on this private HIR route. Preserve
    // possible callback/shared writes rather than declaring unknown calls pure.
    // This is a conservative abstract slot effect across activations, not a
    // statement that distinct concrete closure environments are the same cell.
    for (const id of captured) if (bindings.get(id).writable) store(summary, state, id, domain.top(), true);
  }
  function call(summary, state, value, path) {
    const beforeArguments = value.kind === 'call' ? domain.single(value.target)
      : expression(summary, state, value.callee, [...path, 'callee']);
    if (!beforeArguments) failure('signature', 'indirect callee has no callable abstract value');
    // Values are copied before arguments, whose left-to-right effects can
    // rebind the source slot or call code that writes a captured binding.
    let saved = domain.copy(beforeArguments);
    const arguments_ = value.arguments.map((argument, index) => expression(summary, state, argument, [...path, 'arguments', index]));
    const key = summary.fn.id + '\0' + domain.pathKey(path);
    if (forcedUnknown.has(key)) saved = domain.join(saved, domain.top());
    recordSite(summary, value, path, saved);
    let result = callable(value.type) ? domain.bottom() : null;
    for (const id of [...saved.ids].sort(compareBytes)) {
      mergeEnvironment(id, summary.externalOwners);
      const callee = markReached(id);
      if (callee.fn.signature !== value.signature) failure('signature', 'discovered call edge has a different owned signature');
      for (const [index, parameter] of callee.fn.parameters.entries()) if (callable(parameter.type)) {
        if (!arguments_[index]) failure('signature', 'callable parameter has no callable argument value');
        mergeMap(callee.parameters, parameter.id, arguments_[index]);
      }
      if (result !== null) {
        if (callee.returns === null) failure('signature', 'discovered callable result is scalar');
        result = domain.join(result, callee.returns);
      }
      for (const [binding, targets] of callee.writes) store(summary, state, binding, targets, true);
      if (callee.unknownEffects) markUnknown(summary);
    }
    if (saved.top) {
      unknownCall(summary, state, arguments_);
      if (result !== null) result = domain.join(result, domain.top());
    }
    return result;
  }
  function expression(summary, state, value, path) {
    domain.step();
    if (value.kind === 'functionReference') {
      // A returned/passed code value carries its lexical environment even when
      // another caller invokes it later. This summary does not identify instances.
      mergeEnvironment(value.target, summary.externalOwners); return domain.single(value.target);
    }
    if (value.kind === 'reference') return callable(value.type) ? load(state, value.binding) : null;
    if (value.kind === 'call' || value.kind === 'indirectCall') return call(summary, state, value, path);
    if (value.kind === 'group') return expression(summary, state, value.operand, [...path, 'operand']);
    if (value.kind === 'write') {
      const right = expression(summary, state, value.right, [...path, 'right']);
      store(summary, state, location(value.left), right, true); return right;
    }
    if (value.kind === 'unary') { expression(summary, state, value.operand, [...path, 'operand']); return null; }
    if (value.kind === 'binary') {
      expression(summary, state, value.left, [...path, 'left']); expression(summary, state, value.right, [...path, 'right']); return null;
    }
    if (value.kind === 'shortCircuit') {
      expression(summary, state, value.left, [...path, 'left']);
      const executed = domain.cloneState(state);
      expression(summary, executed, value.right, [...path, 'right']);
      state.locals = domain.mergeStates(state, executed).locals; return null;
    }
    if (['constant','floating','boolean'].includes(value.kind)) return null;
    failure('capability', 'unsupported target-flow expression in owned HIR');
  }
  function body(summary, state, items, path) {
    let live = true;
    for (const [index, item] of items.entries()) {
      if (!live) break;
      domain.step(); const here = [...path, index];
      if (item.kind === 'functionDeclaration') continue;
      if (item.kind === 'local') {
        const value = expression(summary, state, item.initializer, [...here, 'initializer']);
        store(summary, state, item.binding.id, value, false);
      } else if (item.kind === 'assign') {
        const value = expression(summary, state, item.value, [...here, 'value']);
        store(summary, state, location(item.target), value, true);
      } else if (item.kind === 'return' || item.kind === 'expression') {
        const value = expression(summary, state, item.value, [...here, 'value']);
        if (item.kind === 'return') {
          if (summary.returns !== null) {
            if (!value) failure('signature', 'callable return has a scalar abstract value');
            const merged = domain.join(summary.returns, value);
            if (!domain.equal(merged, summary.returns)) { summary.returns = merged; changed(); }
          }
          live = false;
        }
      } else if (item.kind === 'block') {
        const outcome = body(summary, state, item.body, [...here, 'body']); state = outcome.state; live = outcome.live;
      } else if (item.kind === 'if') {
        expression(summary, state, item.condition, [...here, 'condition']);
        const left = body(summary, domain.cloneState(state), item.thenBody, [...here, 'thenBody']);
        const right = body(summary, domain.cloneState(state), item.elseBody, [...here, 'elseBody']);
        live = left.live || right.live;
        if (left.live && right.live) state = domain.mergeStates(left.state, right.state);
        else if (left.live) state = left.state;
        else if (right.live) state = right.state;
      } else if (item.kind === 'while') {
        // Keep the zero-iteration path and join every live backedge. Scalar
        // constants do not prune either path in this declared may precision.
        const incoming = domain.cloneState(state); let head = domain.cloneState(state);
        while (true) {
          domain.step(); const conditionState = domain.cloneState(head);
          expression(summary, conditionState, item.condition, [...here, 'condition']);
          const iteration = body(summary, domain.cloneState(conditionState), item.body, [...here, 'body']);
          const next = iteration.live ? domain.mergeStates(incoming, iteration.state) : domain.cloneState(incoming);
          state = conditionState;
          if (domain.equalStates(head, next)) break;
          head = next;
        }
      } else failure('capability', 'unsupported target-flow statement in owned HIR');
    }
    return { state, live };
  }
  function analyzeFunction(summary) {
    domain.step(); const state = domain.state();
    for (const capture of summary.fn.captures) if (captured.has(capture.binding)) {
      const binding = bindings.get(capture.binding);
      if (binding.kind !== 'function' && summary.externalOwners.has(binding.owner))
        mergeMap(shared, capture.binding, domain.top());
      sharedValue(capture.binding);
    }
    for (const parameter of summary.fn.parameters) if (callable(parameter.type))
      store(summary, state, parameter.id, summary.parameters.get(parameter.id), false);
    body(summary, state, summary.fn.body, ['body']);
  }
  for (const id of roots) {
    // Only ancestors come from the caller's environment. The root's own fresh
    // activation stays local; closed roots do not taint every captured slot.
    mergeEnvironment(id, ancestors.get(id));
    const summary = markReached(id);
    for (const parameter of summary.fn.parameters) if (callable(parameter.type)) mergeMap(summary.parameters, parameter.id, domain.top());
  }
  while (true) {
    while (queue.length) { const id = queue.shift(); queued.delete(id); analyzeFunction(summaries.get(id)); }
    // Bottom during solving is not an unknown external value. Only after the
    // known fixed point is exhausted do unresolved reachable calls become TOP,
    // which propagates unknown results, callbacks and captured write effects.
    let unresolved = false;
    for (const [key, site] of sites) if (!site.targets.top && site.targets.ids.size === 0 && !forcedUnknown.has(key)) {
      forcedUnknown.add(key); schedule(site.function); unresolved = true;
    }
    if (!unresolved) break;
  }
  const functionsReport = [...summaries.values()].filter(summary => summary.reached).sort((a,b) => compareBytes(a.fn.id, b.fn.id)).map(summary => ({
    id: summary.fn.id,
    parameters: summary.fn.parameters.filter(p => callable(p.type)).map(p => ({ binding: p.id, targets: domain.wire(summary.parameters.get(p.id)) })),
    returns: summary.returns === null ? null : domain.wire(summary.returns),
    writes: [...summary.writes].sort(([a],[b]) => compareBytes(a,b)).map(([binding, targets]) => ({ binding, targets: domain.wire(targets) })),
    unknownEffects: summary.unknownEffects }));
  const capturedBindings = [...usedShared].sort(compareBytes).map(binding => ({ binding, targets: domain.wire(shared.get(binding)) }));
  const calls = [...sites.values()].sort((a,b) => compareBytes(a.function,b.function)
    || compareBytes(domain.pathKey(a.expressionPath),domain.pathKey(b.expressionPath))).map(site => ({ ...site, targets: domain.wire(site.targets) }));
  const closed = targets => !targets.top && targets.functions.length > 0;
  const complete = functionsReport.every(fn => !fn.unknownEffects && fn.parameters.every(p => closed(p.targets))
    && (fn.returns === null || closed(fn.returns)) && fn.writes.every(write => closed(write.targets)))
    && capturedBindings.every(binding => closed(binding.targets)) && calls.every(site => closed(site.targets));
  /** @type {import('./closure-targets.mjs').ClosureTargetsReport} */
  const report = { format: { family: 'tsfg.closure-targets-candidate', version: 1 }, hirHash, roots,
    precision: 'context-insensitive-may', complete, functions: functionsReport, capturedBindings, calls };
  targetBudget(report); return own(report);
}
