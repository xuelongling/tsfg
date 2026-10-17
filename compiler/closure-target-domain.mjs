// SPDX-License-Identifier: MIT
import { canonical } from './identity.mjs';
import { checkGenericJsonValueBudget } from './generic-json.mjs';
export const targetLimits = Object.freeze({ bytes: 8388608, depth: 128, jsonTokens: 200000,
  stringBytes: 1048576, allowNul: false, rejectPrototypeKeys: true });
/** @returns {never} */
export function targetFailure(category, message) {
  throw Object.assign(new TypeError('r03-closure-targets-' + category + ': ' + message),
    { code: 'r03-closure-targets-' + category, ruleId: 'r01-input-boundary', phase: 'analysis' });
}
export function targetBudget(value) {
  try { checkGenericJsonValueBudget(value, targetLimits); }
  catch (error) { targetFailure(error.code?.endsWith('-limit') ? 'limit' : 'input', 'invalid target analysis input'); }
}
export const compareBytes = (a, b) => Buffer.from(a).compare(Buffer.from(b));
/** @typedef {{top: boolean, ids: Set<string>}} TargetValue */
/** @param {Set<string>} functionIds */
export function targetDomain(functionIds) {
  // These are hard work/allocation bounds, not widening thresholds. Exhaustion
  // aborts the entire analysis; no truncated proof or partial report is returned.
  let steps = 0, growth = 0;
  const step = (amount = 1) => { steps += amount; if (steps > 1000000) targetFailure('limit', 'target solver work budget exceeded'); };
  const grew = () => { if (++growth > 200000) targetFailure('limit', 'target solver growth budget exceeded'); };
  /** @returns {TargetValue} */
  const bottom = () => ({ top: false, ids: new Set() });
  /** @returns {TargetValue} */
  const top = () => ({ top: true, ids: new Set() });
  /** @param {TargetValue} value @returns {TargetValue} */
  const copy = value => ({ top: value.top, ids: new Set(value.ids) });
  /** @param {string} id @returns {TargetValue} */
  const single = id => {
    if (!functionIds.has(id)) targetFailure('identity', 'target is outside the owned function table');
    return { top: false, ids: new Set([id]) };
  };
  /** @param {TargetValue} a @param {TargetValue} b */
  const equal = (a, b) => a.top === b.top && a.ids.size === b.ids.size && [...a.ids].every(id => b.ids.has(id));
  /** @param {TargetValue} a @param {TargetValue} b @returns {TargetValue} */
  const join = (a, b) => {
    step(); const result = { top: a.top || b.top, ids: new Set(a.ids) };
    for (const id of b.ids) {
      if (!functionIds.has(id)) targetFailure('identity', 'target is outside the owned function table');
      result.ids.add(id);
    }
    if (result.ids.size > functionIds.size) targetFailure('limit', 'target set exceeds the owned function table');
    return result;
  };
  /** @param {TargetValue} value */
  const wire = value => ({ top: value.top, functions: [...value.ids].sort(compareBytes) });
  /** @param {TargetValue} value */
  const closed = value => !value.top && value.ids.size > 0;
  const state = () => ({ locals: new Map() });
  const cloneState = value => ({ locals: new Map([...value.locals].map(([id, targets]) => [id, copy(targets)])) });
  const mergeStates = (a, b) => {
    const result = cloneState(a);
    for (const [id, targets] of b.locals) result.locals.set(id, join(result.locals.get(id) ?? bottom(), targets));
    return result;
  };
  const equalStates = (a, b) => a.locals.size === b.locals.size
    && [...a.locals].every(([id, targets]) => b.locals.has(id) && equal(targets, b.locals.get(id)));
  const pathKey = path => canonical(path);
  return { step, grew, bottom, top, copy, single, equal, join, wire, closed, state, cloneState, mergeStates, equalStates, pathKey };
}
