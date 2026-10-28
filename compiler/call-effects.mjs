// SPDX-License-Identifier: MIT
// Fixed Published bounds isolate callers from narrower replaceable implementations.
import { canonical, own, sha256 } from './identity.mjs';
import { checkGenericJsonValueBudget } from './generic-json-budget.mjs';

const policy = Object.freeze({ bytes: 8388608, depth: 128, jsonTokens: 200000,
  stringBytes: 1048576, allowNul: true, rejectPrototypeKeys: true });
const messages = {
  'r03-d-call-effects': 'invalid module call publication context',
  'r03-d-call-contract-identity': 'published call contract identity differs',
  'r03-d-call-contract': 'implementation exceeds published call upper bound',
  'r03-d-call-effects-limit': 'module call effects budget exceeded',
  'r03-d-kernel-call-effects': 'kernel call requires a known published effect upper bound',
};
/** @param {string} [code] @param {any} [primary] @returns {never} */
export function callEffectsFailure(code = 'r03-d-call-effects', primary = undefined) {
  throw Object.assign(new TypeError(code + ': ' + messages[code]), {
    code, ruleId: code === 'r03-d-kernel-call-effects' ? 'r01-kernel' : 'r01-call-contract',
    phase: 'hir', ...(primary === undefined ? {} : { primary }),
  });
}
/** @param {any} input */
function checkBudget(input) {
  try { checkGenericJsonValueBudget(input, policy); }
  catch (error) {
    callEffectsFailure(/** @type {any} */ (error).code?.endsWith('-limit')
      ? 'r03-d-call-effects-limit' : 'r03-d-call-effects');
  }
}
/** Inspect both untrusted graphs before any selected dispatch, copying or hashing.
 * @param {any} hir @param {any} context */
export function checkCallEffectsInputs(hir, context) {
  checkBudget(hir); checkBudget(context);
  if (Array.isArray(hir?.functions) && hir.functions.length > 256
      || Array.isArray(hir?.globals) && hir.globals.length > 4096)
    callEffectsFailure('r03-d-call-effects-limit');
}
const exact = (value, keys) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const hash = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const empty = () => ({ reads: new Set(), writes: new Set(), unknownHost: false });
const top = () => ({ reads: [], writes: [], unknownHost: true });
const dto = summary => summary.unknownHost ? top()
  : { reads: [...summary.reads].sort(), writes: [...summary.writes].sort(), unknownHost: false };
const recordDigest = record => sha256('tsfg.published-call-contract.v1\0'
  + canonical({ functionId: record.functionId, signatureHash: record.signatureHash, upper: record.upper }));
const tableDigest = records => sha256('tsfg.module-call-publication.v1\0' + canonical(records));
/** @param {any} upper @param {any} lower */
const covers = (upper, lower) => upper.unknownHost || !lower.unknownHost
  && lower.reads.every(id => upper.reads.includes(id)) && lower.writes.every(id => upper.writes.includes(id));

/** A bounded monotone worklist reaches the least fixed point even inside SCCs.
 * It never substitutes Derived for a fixed Published callee upper.
 * @param {any} hir @param {any} context */
export function analyzeVerifiedModuleCalls(hir, context) {
  if (!hir.modules || hir.format !== undefined) callEffectsFailure();
  const initial = context?.mode === 'initial';
  if (!exact(context, initial ? ['mode'] : ['mode', 'expectedDigest', 'contracts'])
      || !initial && context.mode !== 'fixed') callEffectsFailure();
  /** @type {Map<string, any>} */
  const functions = new Map(hir.functions.map(fn => [fn.id, fn]));
  const sourceFunctions = hir.functions.filter(fn => fn.kind !== 'module-initialization');
  const globals = new Set(hir.globals.map(global => global.id));
  let work = 0, members = 0, callSites = 0;
  const spend = () => { if (++work > 1000000) callEffectsFailure('r03-d-call-effects-limit'); };
  const member = () => { if (++members > 65536) callEffectsFailure('r03-d-call-effects-limit'); };
  const merge = (target, value) => {
    spend();
    if (target.unknownHost) return false;
    if (value.unknownHost) {
      target.unknownHost = true; target.reads.clear(); target.writes.clear(); return true;
    }
    let changed = false;
    for (const key of ['reads', 'writes']) for (const id of value[key]) {
      spend();
      if (!target[key].has(id)) { member(); target[key].add(id); changed = true; }
    }
    return changed;
  };
  const from = value => { const result = empty(); merge(result, value); return result; };
  /** @type {Map<string, any>} */
  const facts = new Map();
  for (const fn of hir.functions) {
    const local = empty(), calls = [], operations = [];
    const operation = (kind, id, range) => {
      spend();
      const effect = kind === 'host' ? top()
        : { reads: kind === 'read' ? [id] : [], writes: kind === 'write' ? [id] : [], unknownHost: false };
      merge(local, effect); operations.push({ kind, effect, range });
    };
    const expression = value => {
      spend();
      switch (value.kind) {
        case 'global': operation('read', value.global, value.range); break;
        case 'constant': case 'floating': case 'boolean': case 'reference': break;
        case 'group': case 'unary': expression(value.operand); break;
        case 'binary': case 'shortCircuit': expression(value.left); expression(value.right); break;
        case 'call': case 'host':
          if (++callSites > 65536) callEffectsFailure('r03-d-call-effects-limit');
          calls.push(value);
          if (value.kind === 'host') operation('host', undefined, value.range);
          else operations.push({ kind: 'call', target: value.target, range: value.range });
          value.arguments.forEach(expression); break;
        default: callEffectsFailure();
      }
    };
    const body = statements => {
      for (const statement of statements) {
        spend();
        switch (statement.kind) {
          case 'initialize': operation('write', statement.global, statement.range); expression(statement.value); break;
          case 'assign':
            if (statement.target.kind === 'global') operation('write', statement.target.global, statement.target.range);
            expression(statement.value); break;
          case 'local': if (statement.initializer !== null) expression(statement.initializer); break;
          case 'return': case 'expression': expression(statement.value); break;
          case 'block': body(statement.body); break;
          case 'if': expression(statement.condition); body(statement.thenBody); body(statement.elseBody); break;
          case 'while': expression(statement.condition); body(statement.body); break;
          default: callEffectsFailure();
        }
      }
    };
    body(fn.body);
    operations.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end
      || a.kind.localeCompare(b.kind));
    facts.set(fn.id, { local, calls, operations });
  }
  // Validate the entire declaration domain before using any claimed upper bound.
  let records;
  if (!initial) {
    if (!Array.isArray(context.contracts) || !hash(context.expectedDigest)) callEffectsFailure();
    records = context.contracts;
    let previous = '';
    for (const record of records) {
      if (!exact(record, ['functionId', 'signatureHash', 'upper', 'digest'])
          || !hash(record.functionId) || !hash(record.signatureHash) || !hash(record.digest)
          || record.functionId <= previous || !exact(record.upper, ['reads', 'writes', 'unknownHost'])
          || typeof record.upper.unknownHost !== 'boolean') callEffectsFailure();
      previous = record.functionId;
      for (const key of ['reads', 'writes']) {
        const values = record.upper[key];
        if (!Array.isArray(values)) callEffectsFailure();
        let last = '';
        for (const id of values) {
          member();
          if (!hash(id) || id <= last) callEffectsFailure();
          last = id;
        }
      }
      if (record.upper.unknownHost && (record.upper.reads.length || record.upper.writes.length)) callEffectsFailure();
    }
    const expected = [...sourceFunctions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (records.length !== expected.length) callEffectsFailure('r03-d-call-contract-identity');
    for (const [index, record] of records.entries()) {
      if (record.functionId !== expected[index].id || record.signatureHash !== expected[index].signatureHash
          || [...record.upper.reads, ...record.upper.writes].some(id => !globals.has(id))
          || record.digest !== recordDigest(record)) callEffectsFailure('r03-d-call-contract-identity');
    }
    if (context.expectedDigest !== tableDigest(records)) callEffectsFailure('r03-d-call-contract-identity');
  }
  // An untrusted table cannot hide a real kernel Host operation or confer trust.
  verifyKernelHostSemantics(hir, new Map([...facts].map(([id, fact]) => [id, fact.calls])));
  const derived = new Map();
  /** @type {Map<string, Set<string>>} */
  const callers = new Map(hir.functions.map(fn => [fn.id, new Set()]));
  for (const fn of hir.functions) {
    derived.set(fn.id, from(facts.get(fn.id).local));
    for (const edge of facts.get(fn.id).calls) if (edge.kind === 'call') callers.get(edge.target).add(fn.id);
  }
  const queue = hir.functions.map(fn => fn.id), scheduled = new Set(queue);
  for (let index = 0; index < queue.length; index++) {
    spend();
    const id = queue[index]; scheduled.delete(id);
    const summary = derived.get(id);
    let changed = false;
    for (const edge of facts.get(id).calls) if (edge.kind === 'call')
      changed = merge(summary, derived.get(edge.target)) || changed;
    if (changed) for (const caller of callers.get(id)) if (!scheduled.has(caller)) {
      scheduled.add(caller); queue.push(caller);
    }
  }
  if (initial) records = sourceFunctions.map(fn => {
    const record = { functionId: fn.id, signatureHash: fn.signatureHash, upper: dto(derived.get(fn.id)) };
    return { ...record, digest: recordDigest(record) };
  }).sort((a, b) => a.functionId < b.functionId ? -1 : a.functionId > b.functionId ? 1 : 0);
  /** @type {Map<string, any>} */
  const published = new Map(records.map(record => [record.functionId, record]));
  const rows = new Map();
  for (const fn of hir.functions) {
    const effect = from(facts.get(fn.id).local), dependencies = new Map();
    for (const edge of facts.get(fn.id).calls) if (edge.kind === 'call') {
      const callee = published.get(edge.target);
      merge(effect, callee.upper); dependencies.set(edge.target, { functionId: edge.target, digest: callee.digest });
    }
    rows.set(fn.id, { functionId: fn.id, derived: dto(derived.get(fn.id)), effective: dto(effect),
      dependencies: [...dependencies.values()].sort((a, b) => a.functionId < b.functionId ? -1 : a.functionId > b.functionId ? 1 : 0) });
  }
  for (const fn of sourceFunctions) if (!covers(published.get(fn.id).upper, rows.get(fn.id).effective)) {
    const upper = published.get(fn.id).upper;
    const witness = facts.get(fn.id).operations.find(operation =>
      !covers(upper, operation.kind === 'call' ? published.get(operation.target).upper : operation.effect));
    callEffectsFailure('r03-d-call-contract', { sourceId: fn.sourcePath, ...(witness?.range ?? fn.range) });
  }
  for (const root of hir.closure.roots) if (root.kind === 'kernel' && published.get(root.target).upper.unknownHost) {
    const fn = functions.get(root.target);
    const call = facts.get(fn.id).calls.find(edge => edge.kind === 'call' && published.get(edge.target).upper.unknownHost);
    callEffectsFailure('r03-d-kernel-call-effects', { sourceId: fn.sourcePath, ...(call?.range ?? fn.range) });
  }
  const order = rows => rows.sort((a, b) => a.functionId < b.functionId ? -1 : a.functionId > b.functionId ? 1 : 0);
  const report = { inputIdentity: hir.inputIdentity, hirDigest: sha256(canonical(hir)),
    publishedDigest: tableDigest(records), contracts: records,
    functions: order(sourceFunctions.map(fn => rows.get(fn.id))),
    initializers: order(hir.functions.filter(fn => fn.kind === 'module-initialization').map(fn => rows.get(fn.id))),
    initializationOrder: hir.closure.initialization };
  checkBudget(report);
  // Expand legal repeated references by JSON position, then freeze independently.
  return own(JSON.parse(canonical(report)));
}

/** A negative missing-proof witness, never a kernel certificate or Published summary. */
export class KernelHostSemanticError extends TypeError {
  constructor(primary, chain, host) {
    const code = 'r03-d-kernel-host-semantics';
    const message = code + ': kernel call requires a trusted HostSemanticContract; '
      + chain.join(' -> ') + ' (declaration ' + host.sourcePath + ':' + host.name + ')';
    super(message);
    this.code = code;
    this.ruleId = 'r01-kernel';
    this.phase = 'hir';
    this.primary = primary;
  }
}

/**
 * Q8: after complete owned-HIR verification, reject a kernel-reachable host
 * lacking semantic trust. The current host representation has no such proof.
 * This uses body facts only to find a forbidden operation, never to authorize a
 * replaceable function using its narrower current body (R03 Q9/ADR0018).
 */
export function verifyKernelHostSemantics(hir, verifiedEdges = undefined) {
  if (!hir.modules) return;
  const functions = new Map(hir.functions.map(fn => [fn.id, fn]));
  const hosts = new Map(hir.hostImports.map(host => [host.id, host]));
  const edges = verifiedEdges ?? new Map();
  const collect = (value, found) => {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'call' || value.kind === 'host') found.push(value);
    for (const nested of Object.values(value)) {
      if (Array.isArray(nested)) for (const item of nested) collect(item, found);
      else if (nested && typeof nested === 'object') collect(nested, found);
    }
  };
  for (const fn of verifiedEdges ? [] : hir.functions) {
    const found = [];
    collect(fn.body, found);
    edges.set(fn.id, found);
  }
  for (const root of hir.closure.roots) {
    if (root.kind !== 'kernel') continue;
    const entry = functions.get(root.target);
    const pending = [{target: root.target, chain: [entry.sourcePath + ':' + entry.name]}];
    const scheduled = new Set([root.target]);
    for (let index = 0; index < pending.length; index++) {
      const {target, chain} = pending[index];
      const fn = functions.get(target);
      for (const edge of edges.get(target)) {
        const site = fn.sourcePath + ':' + edge.range.start + '-' + edge.range.end;
        if (edge.kind === 'host') {
          const host = hosts.get(edge.target);
          throw new KernelHostSemanticError({sourceId: fn.sourcePath, ...edge.range},
            [...chain, site + ' host ' + host.name], host);
        }
        const callee = functions.get(edge.target);
        if (!scheduled.has(callee.id)) {
          scheduled.add(callee.id);
          pending.push({target: callee.id,
            chain: [...chain, site + ' call ' + callee.sourcePath + ':' + callee.name]});
        }
      }
    }
  }
  // Retained owner initializers are intentionally absent from this worklist.
  // Ordinary top-level Host/application behavior is outside the kernel body.
}
