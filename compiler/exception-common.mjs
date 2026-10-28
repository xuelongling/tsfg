// SPDX-License-Identifier: MIT
import descriptor from '../contracts/exception-owned-bridge-candidate.schema.json' with { type: 'json' };
import { canonical, own, sha256 } from './identity.mjs';
import { readGenericJson, checkGenericJsonValueBudget } from './generic-json.mjs';
export { canonical, own, sha256 };
export const schemaHash = sha256(canonical(descriptor));
export const wireLimits = own(descriptor.limits.wire);
export const snapshotLimits = own(descriptor.limits.snapshot);
export const declarationDigests = own(descriptor.profiles.declarationDigests);
export const targetShape = own(descriptor.profiles.target);
export const snapshotFormat = Object.freeze({ family: 'tsfg.frontend-exception-candidate', version: 1, schemaHash });
/** @returns {never} */
export function failure(category, message = 'owned exception facts differ') {
  const code = 'r03-exception-' + category;
  throw Object.assign(new TypeError(code + ': ' + message), { code, ruleId: 'r01-input-boundary', phase: 'frontend' });
}
export const check = (condition, category = 'schema', message = undefined) => { if (!condition) failure(category, message); };
check(schemaHash === 'sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d', 'schema', 'descriptor identity differs');
export const same = (a, b) => canonical(a) === canonical(b);
export function record(value, required, optional = []) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}
export function array(value, maximum = wireLimits.arrayItems, minimum = 0) {
  check(Array.isArray(value)); check(value.length >= minimum && value.length <= maximum, 'limit'); return value;
}
export function text(value) {
  check(typeof value === 'string' && value.length > 0 && value.isWellFormed() && !value.includes('\0'), 'source');
}
export const hash = value => check(typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value), 'identity');
export function budget(value, limits = wireLimits) {
  try { checkGenericJsonValueBudget(value, limits); }
  catch (error) { failure(error.code?.endsWith('-limit') ? 'limit' : 'schema'); }
}
export function readJson(bytes) {
  try {
    const input = readGenericJson(bytes, wireLimits); budget(input.value);
    check(input.text === canonical(input.value), 'canonical', 'private frame must be exact JCS'); return input;
  } catch (error) {
    if (error.code?.startsWith('r03-exception-')) throw error;
    failure(error.code?.endsWith('-limit') ? 'limit' : 'json');
  }
}
export function sourceOrigin(value) {
  budget(value); record(value, ['kind','producerBaseOid','producerDirty','requestSha256','responseSha256','testedInputSetHash']);
  check(value.kind === 'owned-go-exception-response' && typeof value.producerBaseOid === 'string'
    && /^[0-9a-f]{40}$/.test(value.producerBaseOid) && typeof value.producerDirty === 'boolean', 'identity');
  for (const key of ['requestSha256','responseSha256','testedInputSetHash']) hash(value[key]);
  return own(value);
}
export function range(value, parent, content) {
  record(value, ['start','end']);
  const boundary = index => !(content.charCodeAt(index) >= 0xdc00 && content.charCodeAt(index) <= 0xdfff
    && content.charCodeAt(index - 1) >= 0xd800 && content.charCodeAt(index - 1) <= 0xdbff);
  check(Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end)
    && !Object.is(value.start, -0) && !Object.is(value.end, -0)
    && value.start >= parent.start && value.end > value.start && value.end <= parent.end
    && boundary(value.start) && boundary(value.end), 'range');
}
