// SPDX-License-Identifier: MIT
import { bindingIdentity } from './closure-common.mjs';
import { canonical, own, sha256 } from './identity.mjs';
import { checkGenericJsonValueBudget } from './generic-json.mjs';
import publicationSchema from '../contracts/core-closure-publication-candidate.schema.json' with {type:'json'};

/** Internal consumer precondition for function-body captured locals. The input
 * is the complete cold-verified 19f program. This analyzes owned typed ops, not
 * Source or TS types; selected publication adds a complete initialization record.
 * @param {any} [selection]
 */
export function closureCoreInitialization(program, step, fail, selection = undefined) {
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
  return {declarationIndices:ordinals,publication:selection === undefined ? null
    : fixedInitializationProof(program,selection,{bindings,functions,ordinals,ancestors},fail)};
}

/** Fixed publication is an additional real initialization precondition. The
 * default pass above remains independent and keeps every existing diagnostic.
 * @param {any} selection @param {any} tables */
function fixedInitializationProof(program, selection, tables, fail) {
  const { hir, analysis, programHash } = selection;
  const { bindings, functions, ordinals, ancestors } = tables;
  const compare = (a,b) => Buffer.from(a).compare(Buffer.from(b));
  let work = 0, members = 0;
  const limit = () => fail('limit','Core fixed publication proof budget exceeded');
  const spend = (count = 1) => { work += count; if (work > publicationSchema.limits.proofWork) limit(); };
  const member = (count = 1) => { members += count; if (members > publicationSchema.limits.proofMembers) limit(); };
  const policy = { bytes:publicationSchema.limits.bytes,depth:publicationSchema.limits.depth,
    jsonTokens:publicationSchema.limits.jsonTokens,stringBytes:publicationSchema.limits.stringBytes,
    allowNul:true,rejectPrototypeKeys:true };
  const unavailable = (reason,fn,range = fn.definitionRange,binding = undefined) => {
    const primary = {source:program.source.path,start:range.start,end:range.end,owner:fn.id};
    const details = {reason,...(binding === undefined ? {} : {bindingDeclaration:{source:program.source.path,
      start:binding.range.start,end:binding.range.end,owner:binding.owner,binding:binding.id}})};
    fail('capability','closure Core fixed initialization proof is unavailable',own(primary),own(details));
  };
  member(analysis.contracts.length + functions.size);
  const records = new Map(analysis.contracts.map(row => [row.functionId,row]));
  const orderedFunctions = [...functions.values()].sort((a,b) => compare(a.id,b.id));
  const reached = new Set(analysis.effectiveTargets.functions.map(fn => fn.id));
  for (const fn of orderedFunctions) if (!reached.has(fn.id)) unavailable('unreached-function',fn);
  if (reached.size !== functions.size) unavailable('unreached-function',orderedFunctions[0]);
  const requirements = new Map(orderedFunctions.map(fn => [fn.id,new Map()]));
  const edges = new Map(orderedFunctions.map(fn => [fn.id,new Set()]));
  const better = (candidate,previous) => !previous || candidate.length < previous.length
    || candidate.length === previous.length && compare(canonical(candidate),canonical(previous)) < 0;
  for (const fn of orderedFunctions) {
    const row = records.get(fn.id);
    if (row.effects.unknown) unavailable('unknown-publication',fn);
    for (const id of [...new Set([...row.effects.reads,...row.effects.writes])].sort(compare)) {
      spend(); const binding = bindings.get(id);
      if (!binding || !ordinals.has(id) || binding.owner !== fn.id && !ancestors.get(fn.id).has(binding.owner))
        unavailable('unmapped-binding',fn,fn.definitionRange,binding);
      // A callee's own activation is fresh. Its internal sites, not its caller,
      // must prove own locals initialized. Ancestor parameters already exist.
      if (binding.role === 'local' && binding.owner !== fn.id) {
        member(2); requirements.get(fn.id).set(id,[fn.id]);
      }
    }
  }
  const originals = new Map(), lowered = new Map(), byPath = new Map(), byNode = new WeakMap();
  const siteKey = (fn,kind,range) => fn.id + '\0' + kind + '\0' + range.start + ':' + range.end;
  const kinds = {functionReference:'functionReference',call:'call',indirectCall:'indirectCall'};
  const programKinds = {makeClosure:'functionReference',call:'call',closureCall:'indirectCall'};
  function enumerate(fn,value,path,original) {
    if (!value || typeof value !== 'object') return;
    spend(); const kind = (original ? kinds : programKinds)[value.kind];
    if (kind) {
      const key = siteKey(fn,kind,value.range), map = original ? originals : lowered;
      if (map.has(key)) unavailable('ambiguous-site',fn,value.range);
      member(); const site = {fn,kind,range:value.range,path:[...path],value}; map.set(key,site);
      if (original) byPath.set(fn.id + '\0' + canonical(path),site);
    }
    for (const [key,child] of Object.entries(value)) if (child && typeof child === 'object')
      enumerate(fn,child,[...path,Array.isArray(value) ? Number(key) : key],original);
  }
  for (const fn of [...hir.functions].sort((a,b) => compare(a.id,b.id))) enumerate(functions.get(fn.id),fn.body,['body'],true);
  for (const fn of orderedFunctions) enumerate(fn,fn.body,['body'],false);
  for (const [key,site] of originals) {
    spend(); const pair = lowered.get(key);
    if (!pair) unavailable('missing-site',site.fn,site.range);
    member(); byNode.set(pair.value,site);
  }
  for (const [key,site] of lowered) if (!originals.has(key)) unavailable('missing-site',site.fn);
  const reports = new Map();
  for (const call of analysis.effectiveTargets.calls) {
    spend(); const key = call.function + '\0' + canonical(call.expressionPath), site = byPath.get(key);
    if (!site || site.kind !== call.kind || canonical(site.range) !== canonical(call.range) || reports.has(site))
      unavailable('missing-site',functions.get(call.function),site?.range ?? call.range);
    if (call.targets.top || call.targets.functions.length === 0) unavailable('unresolved-call',site.fn,site.range);
    member(); reports.set(site,call);
  }
  const targets = new Map(), liveSites = new Set();
  const targetsFor = site => {
    if (targets.has(site)) return targets.get(site);
    const row = reports.get(site);
    const values = site.kind === 'functionReference' ? [site.value.target] : row?.targets.functions;
    if (site.kind !== 'functionReference' && !row) unavailable('missing-site',site.fn,site.range);
    if (!values?.length || row?.targets.top) unavailable('unresolved-call',site.fn,site.range);
    if (site.kind === 'call' && (values.length !== 1 || values[0] !== site.value.target))
      unavailable('missing-site',site.fn,site.range);
    member(values.length + 1); targets.set(site,values); return values;
  };
  // One shared ordered walk serves may-live edge collection and the subsequent
  // state proof. Callee checks precede arguments; its saved site targets do not
  // change after an argument rebinds a callable slot.
  function expression(fn,state,value,check) {
    spend(); const site = byNode.get(value), saved = site ? targetsFor(site) : null;
    if (value.kind === 'closureCall') expression(fn,state,value.callee,check);
    if (value.kind === 'call' || value.kind === 'closureCall')
      for (const argument of value.arguments) expression(fn,state,argument,check);
    else if (value.kind === 'environmentWrite') expression(fn,state,value.value,check);
    else if (value.kind === 'group' || value.kind === 'unary') expression(fn,state,value.operand,check);
    else if (['binary','shortCircuit','write'].includes(value.kind)) {
      if (value.kind !== 'write') expression(fn,state,value.left,check);
      expression(fn,state,value.right,check);
    }
    if (site) {
      if (!check) {
        if (!liveSites.has(site)) { member(); liveSites.add(site); }
        for (const id of saved) if (!edges.get(fn.id).has(id)) { member(); edges.get(fn.id).add(id); }
      } else checkSite(fn,state,site,saved);
    }
  }
  const clone = state => { member(state.size); return new Set(state); };
  const intersection = (left,right) => {
    const result = new Set(); for (const id of left) { spend(); if (right.has(id)) { member(); result.add(id); } } return result;
  };
  function body(fn,state,items,check) {
    let live = true;
    for (const item of items) {
      if (!live) break;
      spend();
      if (item.kind === 'allocateEnvironment' || item.kind === 'functionDeclaration') continue;
      if (item.kind === 'initializeEnvironment' || item.kind === 'local') {
        expression(fn,state,item.kind === 'local' ? item.initializer : item.value,check);
        const id = item.binding;
        if (check && ordinals.has(id) && bindings.get(id).role === 'local' && !state.has(id)) { member(); state.add(id); }
      } else if (['environmentStore','assign','expression','return'].includes(item.kind)) {
        expression(fn,state,item.value,check); if (item.kind === 'return') live = false;
      } else if (item.kind === 'block') {
        const next = body(fn,clone(state),item.body,check); state = next.state; live = next.live;
      } else if (item.kind === 'if') {
        expression(fn,state,item.condition,check);
        const yes = body(fn,clone(state),item.thenBody,check), no = body(fn,clone(state),item.elseBody,check);
        live = yes.live || no.live;
        if (yes.live && no.live) state = intersection(yes.state,no.state);
        else if (yes.live) state = yes.state; else if (no.live) state = no.state;
      } else if (item.kind === 'while') {
        expression(fn,state,item.condition,check); body(fn,clone(state),item.body,check);
      }
    }
    return {state,live};
  }
  for (const fn of orderedFunctions) body(fn,new Set(),fn.body,false);
  for (const site of reports.keys()) if (!liveSites.has(site)) unavailable('missing-site',site.fn,site.range);
  let grew = true;
  while (grew) {
    grew = false;
    for (const fn of orderedFunctions) for (const target of [...edges.get(fn.id)].sort(compare)) {
      spend();
      for (const [id,path] of requirements.get(target)) {
        spend(); if (!ancestors.get(fn.id).has(bindings.get(id).owner)) continue;
        const current = requirements.get(fn.id).get(id);
        const candidate = [fn.id,...path]; spend(candidate.length);
        if (better(candidate,current)) {
          member(candidate.length + (current ? 0 : 1)); requirements.get(fn.id).set(id,candidate); grew = true;
        }
      }
    }
  }
  for (const id of analysis.roots) if (requirements.get(id).size) {
    const binding = [...requirements.get(id).keys()].sort(compare)[0];
    unavailable('external-root-precondition',functions.get(id),undefined,bindings.get(binding));
  }
  const siteRequirements = new Map();
  function requiredAt(site,values) {
    if (siteRequirements.has(site)) return siteRequirements.get(site);
    const result = new Map();
    for (const target of values) for (const [id,path] of requirements.get(target)) {
      spend(); const current = result.get(id);
      if (better(path,current)) { if (!current) member(); result.set(id,path); }
    }
    member(); siteRequirements.set(site,result); return result;
  }
  function checkSite(fn,state,site,values) {
    const required = requiredAt(site,values);
    for (const id of [...required.keys()].sort(compare)) {
      spend(); const binding = bindings.get(id);
      if (binding.owner === fn.id ? state.has(id) : ancestors.get(fn.id).has(binding.owner) && requirements.get(fn.id).has(id)) continue;
      if (binding.owner !== fn.id) unavailable('unmapped-binding',fn,fn.definitionRange,binding);
      const chain = [fn.id,...required.get(id)]; member(chain.length);
      fail('capability','fixed Published local initialization before closure observation is not proven',own({
        source:program.source.path,start:site.range.start,end:site.range.end,owner:fn.id,binding:id}),own({
        bindingDeclaration:{source:program.source.path,start:binding.range.start,end:binding.range.end,owner:binding.owner,binding:id},
        initializationDependency:chain,publishedDependencies:chain.slice(1).map(functionId => ({functionId,digest:records.get(functionId).digest}))}));
    }
  }
  for (const fn of orderedFunctions) body(fn,new Set(),fn.body,true);
  const sites = [...liveSites].sort((a,b) => compare(a.fn.id,b.fn.id) || compare(canonical(a.path),canonical(b.path))).map(site => {
    const values = targetsFor(site), required = requiredAt(site,values); member(values.length + required.size + 1);
    return {functionId:site.fn.id,expressionPath:site.path,kind:site.kind,range:site.range,
      targets:values.map(functionId => ({functionId,publishedContractDigest:records.get(functionId).digest})),requires:[...required.keys()].sort(compare)};
  });
  const record = {format:{family:publicationSchema.family,version:publicationSchema.version},schemaHash:sha256(canonical(publicationSchema)),
    inputIdentity:analysis.inputIdentity,hirHash:analysis.hirHash,programHash,analysisHash:sha256(canonical(analysis) + '\n'),
    scopeDigest:analysis.scopeDigest,publishedDigest:analysis.publishedDigest,roots:analysis.roots,
    functions:orderedFunctions.map(fn => { member(requirements.get(fn.id).size + 1); return {functionId:fn.id,
      publishedContractDigest:records.get(fn.id).digest,requires:[...requirements.get(fn.id).keys()].sort(compare)}; }),
    dependencies:analysis.dependencies,sites};
  try { checkGenericJsonValueBudget(record,policy); } catch { limit(); }
  return own(JSON.parse(canonical(record)));
}
