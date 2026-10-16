// SPDX-License-Identifier: MIT
import { canonical, own, sha256 } from './identity.mjs';
import { readGenericJson, checkGenericJsonValueBudget } from './generic-json.mjs';
export { canonical, own, sha256 };
export const referenceProfile = 'tsfg-owned-class-facts-candidate-v2';
export const referenceLimits = own({ bytes: 8388608, depth: 128, jsonTokens: 200000,
  stringBytes: 1048576, allowNul: false, rejectPrototypeKeys: false });
export const factsFormat = own({ family: 'tsfg.reference-facts-candidate', version: 2, semanticProfile: referenceProfile });
export function failure(category, detail = 'invalid owned reference candidate', origin) {
  throw Object.assign(new TypeError('reference-facts-' + category + ': ' + detail),
    { code: 'reference-facts-' + category, ...(origin ? { origin } : {}) });
}
export const check = (condition, category = 'schema', detail, origin) => {
  if (!condition) failure(category, detail, origin);
};
export const same = (a, b) => canonical(a) === canonical(b);
export function record(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(','));
}
export const integer = (value, maximum = 1048576) => check(Number.isSafeInteger(value)
  && !Object.is(value, -0) && value >= 0 && value <= maximum);
export const text = (value, maximum = 4096) => check(typeof value === 'string'
  && value.length > 0 && value.length <= maximum && value.isWellFormed() && !value.includes('\0'));
export const hash = value => check(typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value), 'identity');
export function array(value, maximum = 100000) {
  check(Array.isArray(value)); check(value.length <= maximum, 'limit'); return value;
}
export function budget(value, limits = referenceLimits) {
  try { checkGenericJsonValueBudget(value, limits); }
  catch (error) { failure(error.code?.endsWith('-limit') ? 'limit' : 'schema'); }
}
export function readJson(bytes, requested = referenceLimits) {
  budget(requested);
  record(requested, Object.keys(requested));
  const keys = ['bytes','depth','jsonTokens','stringBytes'];
  check(Object.keys(requested).every(key => keys.includes(key)
    || ['allowNul','rejectPrototypeKeys'].includes(key) && requested[key] === false), 'limit');
  const limits = { ...referenceLimits };
  for (const key of keys) if (Object.hasOwn(requested, key)) {
    check(Number.isSafeInteger(requested[key]) && requested[key] > 0 && requested[key] <= referenceLimits[key], 'limit');
    limits[key] = requested[key];
  }
  let input;
  try { input = readGenericJson(bytes, limits); }
  catch (error) { failure(error.code?.split('-').at(-1) ?? 'json'); }
  check(input.text === canonical(input.value), 'canonical');
  return input.value;
}
export const bindingFor = graph => ({ scope: graph.scope, semanticProfile: graph.semanticProfile,
  sources: graph.sources, options: graph.options });
export const factsIdentity = graph => sha256('tsfg:reference-facts-candidate:v2\n' + canonical(graph));
