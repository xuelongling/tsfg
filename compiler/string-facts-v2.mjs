// SPDX-License-Identifier: MIT
// Strict v2 cold IO binds complete data; it does not grant official Source admission.
import descriptor from '../contracts/string-facts-v2-candidate.schema.json' with { type: 'json' };
import { canonical, own, sha256 } from './identity.mjs';
import { copyGenericJsonBytes, readGenericJson, preflightGenericJson, checkGenericJsonValueBudget } from './generic-json.mjs';
import { stringFactsRecord as record } from './string-facts-model.mjs';
import { stringFactsV2Failure as failure, checkStringFactsV2DomainBudget,
  validateStringFactsV2Payload } from './string-facts-v2-model.mjs';

const SCHEMA_HASH = 'sha256:79d8f807552e301b606aacdee7b81fcee83d8996ff2043e58c435e5f2b7b519c';
const limits = own(descriptor['x-budget']);
const jsonPolicy = Object.freeze({ bytes: limits.inputBytes, depth: limits.jsonDepth,
  jsonTokens: limits.jsonTokens, stringBytes: limits.jsonStringBytes,
  safeNonnegativeIntegers: true, allowNul: true, rejectPrototypeKeys: true });
const valuePolicy = Object.freeze({ ...jsonPolicy, bytes: limits.outputBytes - 1 });
const check = (condition, category = 'schema') => { if (!condition) failure(category); };
function boundary(cause) {
  if (cause?.ruleId === 'r01-input-boundary' && cause?.phase === 'input') throw cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  const prefix = code.startsWith('r03-string-facts-') ? 'r03-string-facts-' : 'generic-package-io-';
  failure(code.startsWith(prefix) ? code.slice(prefix.length) : 'schema', cause);
}
function budget(value) {
  try {
    checkGenericJsonValueBudget(value, valuePolicy);
    // The graph is now safe; inspect only an own payload before frame/canonical work.
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'payload'))
      checkStringFactsV2DomainBudget(value.payload, limits);
  } catch (cause) { boundary(cause); }
}
function validateFrame(value) {
  try {
    record(value, ['family', 'version', 'schemaHash', 'requestId', 'packageId', 'payload']);
    check(value.family === 'tsfg.string-facts-package-candidate' && value.version === 2);
    check(value.schemaHash === SCHEMA_HASH, 'identity');
    const request = validateStringFactsV2Payload(value.payload, limits);
    budget(request);
    check(value.requestId === sha256('tsfg.string-facts.request.v2\0' + canonical(request) + '\n'), 'identity');
    check(value.packageId === sha256('tsfg.string-facts.package.v2\0' + SCHEMA_HASH + '\0' + canonical(value.payload)), 'identity');
  } catch (cause) { boundary(cause); }
}
check(sha256(canonical(descriptor) + '\n') === SCHEMA_HASH, 'identity');

/** @param {Uint8Array} bytes */
export function readStringFactsV2Candidate(bytes) {
  let input;
  try { input = readGenericJson(copyGenericJsonBytes(bytes, jsonPolicy), jsonPolicy); }
  catch (cause) { boundary(cause); }
  budget(input.value);
  check(input.text === canonical(input.value) + '\n', 'canonical');
  validateFrame(input.value);
  return own(input.value);
}

/** @param {any} value @returns {Buffer} */
export function writeStringFactsV2Candidate(value) {
  budget(value);
  validateFrame(value);
  const text = canonical(value) + '\n';
  try { preflightGenericJson(text, jsonPolicy); }
  catch (cause) { boundary(cause); }
  return Buffer.from(text, 'utf8');
}
