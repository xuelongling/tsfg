// SPDX-License-Identifier: MIT
// Private cold package validation; this grants no official Source admission.
import descriptor from '../contracts/string-facts-candidate.schema.json' with { type: 'json' };
import { canonical, own, sha256 } from './identity.mjs';
import { readGenericJson, preflightGenericJson, checkGenericJsonValueBudget } from './generic-json.mjs';
import { stringFactsFailure as failure, stringFactsRecord as record, validateStringFactsPayload } from './string-facts-model.mjs';

const SCHEMA_HASH = 'sha256:6dfed46326c15a81aeb6a1ea9b5ed2fc10db7bb1bf27733ac3df530d78d5cc62';
const limits = own(descriptor['x-budget']);
const jsonPolicy = Object.freeze({ bytes: limits.inputBytes, depth: limits.jsonDepth,
  jsonTokens: limits.jsonTokens, stringBytes: limits.jsonStringBytes,
  safeNonnegativeIntegers: true, allowNul: true, rejectPrototypeKeys: true });
// The complete frame includes one LF after its canonical JSON value.
const valuePolicy = Object.freeze({ ...jsonPolicy, bytes: limits.outputBytes - 1 });

const check = (condition, category = 'schema') => { if (!condition) failure(category); };
function jsonFailure(error) {
  const prefix = 'generic-package-io-';
  const category = typeof error?.code === 'string' && error.code.startsWith(prefix)
    ? error.code.slice(prefix.length) : 'schema';
  failure(['input', 'utf8', 'json', 'limit', 'canonical', 'schema'].includes(category) ? category : 'schema');
}
function budget(value) {
  try { checkGenericJsonValueBudget(value, valuePolicy); }
  catch (error) { jsonFailure(error); }
}
function validateFrame(value) {
  record(value, ['family', 'version', 'schemaHash', 'requestId', 'packageId', 'payload']);
  check(value.family === 'tsfg.string-facts-package-candidate' && value.version === 1);
  check(value.schemaHash === SCHEMA_HASH, 'identity');
  const request = validateStringFactsPayload(value.payload, limits);
  budget(request);
  const requestText = canonical(request) + '\n';
  check(value.requestId === sha256('tsfg.string-facts.request.v1\0' + requestText), 'identity');
  const packageId = sha256('tsfg.string-facts.package.v1\0' + SCHEMA_HASH + '\0' + canonical(value.payload));
  check(value.packageId === packageId, 'identity');
}
check(sha256(canonical(descriptor) + '\n') === SCHEMA_HASH, 'identity');

/**
 * Read and validate a complete private cold package, without official Source admission.
 * The returned graph owns every array and record independently of caller storage.
 * @param {Uint8Array} bytes
 */
export function readStringFactsCandidate(bytes) {
  let input;
  try { input = readGenericJson(bytes, jsonPolicy); }
  catch (error) { jsonFailure(error); }
  budget(input.value);
  check(input.text === canonical(input.value) + '\n', 'canonical');
  validateFrame(input.value);
  return own(input.value);
}

/**
 * Bound untrusted data before cloning, canonical traversal or hash preimages.
 * Cycles/accessors and oversized graphs fail before any returned output exists.
 * @param {any} value
 * @returns {Buffer}
 */
export function writeStringFactsCandidate(value) {
  budget(value);
  validateFrame(value);
  const text = canonical(value) + '\n';
  try { preflightGenericJson(text, jsonPolicy); }
  catch (error) { jsonFailure(error); }
  return Buffer.from(text, 'utf8');
}
