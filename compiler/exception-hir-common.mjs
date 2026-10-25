// SPDX-License-Identifier: MIT
import descriptorValue from '../contracts/exception-hir-v2.schema.json' with { type: 'json' };
import { canonical, own, sha256 } from './identity.mjs';
import { checkGenericJsonValueBudget, readGenericJson } from './generic-json.mjs';
export { canonical, own, sha256 };
export const descriptor = own(descriptorValue);
export const hirSchemaHash = sha256(canonical(descriptor));
export const hirFormat = own({ family: 'tsfg.exception-hir-candidate', version: 2, schemaHash: hirSchemaHash });
export const limits = descriptor.limits;
/** @returns {never} */
export function failure(category, message = 'owned exception HIR differs') {
  const capability = category === 'capability', code = capability ? 'r03-d-capability' : 'r03-exception-hir-' + category;
  throw Object.assign(new TypeError(code + ': ' + message),
    { code, ruleId: capability ? 'r01-ts-baseline' : 'r01-input-boundary', phase: 'hir' });
}
export const check = (condition, category = 'schema', message = undefined) => { if (!condition) failure(category, message); };
check(hirSchemaHash === 'sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5', 'schema');
export const wholePolicy = own({ bytes: limits.whole.bytesIncludingFinalLF, depth: limits.whole.depth,
  jsonTokens: limits.whole.jsonTokens, stringBytes: limits.whole.stringBytes,
  allowNul: true, rejectPrototypeKeys: true, safeNonnegativeIntegers: true });
const wholeValuePolicy = own({ ...wholePolicy, bytes: wholePolicy.bytes - 1 });
const derivedPolicy = own({ ...wholeValuePolicy, ...limits.derived, allowNul: true,
  rejectPrototypeKeys: true, safeNonnegativeIntegers: true });
function normalize(error) {
  if (error.code?.startsWith('r03-exception-hir-') || error.code === 'r03-d-capability') throw error;
  const suffix = error.code?.split('-').at(-1);
  failure(['limit','json','utf8','canonical'].includes(suffix) ? suffix : 'schema');
}
export function budget(value, derived = false) {
  try { checkGenericJsonValueBudget(value, derived ? derivedPolicy : wholeValuePolicy); }
  catch (error) { normalize(error); }
}
export function readExceptionHirJson(bytes) {
  try { const input = readGenericJson(bytes, wholePolicy); budget(input.value); return input; }
  catch (error) { normalize(error); }
}
