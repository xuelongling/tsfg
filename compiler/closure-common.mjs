// SPDX-License-Identifier: MIT
import { canonical, own, sha256, scalarTypeIds } from './identity.mjs';
import { readGenericJson, checkGenericJsonValueBudget } from './generic-json.mjs';
export { canonical, own, sha256, scalarTypeIds };
// Exact declarations carried by the qualified public Go response profiles.
export const capturedDeclarationProfiles = Object.freeze({
  'minimal-integers-v3': 'sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e',
  'minimal-floats-v4': 'sha256:edb7bfe80718ba47175a87a65f2688f1b91420995e7c118dd2c3e4c85c193693',
});
export const snapshotFormat = Object.freeze({ family: 'tsfg.frontend-closure-candidate', version: 1 });
export const hirFormat = Object.freeze({ family: 'tsfg.closure-hir-candidate', version: 1 });
export const limits = Object.freeze({ bytes: 8388608, depth: 128, jsonTokens: 200000,
  stringBytes: 1048576, allowNul: true, rejectPrototypeKeys: true });
export function failure(category, message = 'owned closure candidate differs', primary = undefined) {
  throw Object.assign(new TypeError((category === 'capability' ? 'r03-d-capability' : 'r03-closure-' + category) + ': ' + message), {
    code: category === 'capability' ? 'r03-d-capability' : 'r03-closure-' + category,
    ruleId: category === 'capability' ? 'r01-ts-baseline' : 'r01-input-boundary', phase: 'hir',
    ...(primary ? { primary } : {}) });
}
export const check = (condition, category = 'schema', message = undefined, primary = undefined) => { if (!condition) failure(category, message, primary); };
export const same = (a, b) => canonical(a) === canonical(b);
export function record(value, required, optional = []) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  const keys = Object.keys(value);
  check(required.every(key => Object.hasOwn(value, key)) && keys.every(key => required.includes(key) || optional.includes(key)));
}
export function array(value, maximum = 4096) { check(Array.isArray(value)); check(value.length <= maximum, 'limit'); return value; }
export const text = value => check(typeof value === 'string' && value.length > 0 && value.length <= 4096 && value.isWellFormed() && !value.includes('\0'));
export const hash = value => check(typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value), 'identity');
export function budget(value) {
  try { checkGenericJsonValueBudget(value, limits); }
  catch (error) { failure(error.code?.endsWith('-limit') ? 'limit' : 'schema'); }
}
export function readJson(bytes) {
  try { const input = readGenericJson(bytes, limits); budget(input.value); return input; }
  catch (error) { if (error.code?.startsWith('r03-')) throw error; failure(error.code?.split('-').at(-1) ?? 'json'); }
}
export function range(value, parent) {
  record(value, ['start','end']);
  check(Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) && !Object.is(value.start, -0)
    && !Object.is(value.end, -0) && value.start >= parent.start && value.end > value.start && value.end <= parent.end, 'range');
}
export function origin(value) {
  budget(value); record(value, ['kind','producerBaseOid','producerDirty','requestSha256','responseSha256','testedInputSetHash']);
  check(value.kind === 'owned-go-response' && /^[0-9a-f]{40}$/.test(value.producerBaseOid)
    && value.producerDirty === true, 'identity');
  for (const key of ['requestSha256','responseSha256','testedInputSetHash']) hash(value[key]);
  return value;
}
// These descriptors are representation facts, never a replacement TS assignability checker.
export function valueType(kind, signature = undefined, depth = 0) {
  check(depth <= 64, 'limit');
  if (kind !== 'function') { check(Object.hasOwn(scalarTypeIds, kind), 'capability', 'unsupported owned value type'); check(signature === undefined, 'signature'); return kind; }
  return callable(signature, depth + 1);
}
export function callable(sig, depth = 0, allowRequiredPresence = false) {
  check(depth <= 64, 'limit'); record(sig, ['parameters','returnType'], ['parameterSignatures','returnSignature', ...(allowRequiredPresence ? ['presence'] : [])]);
  const params = array(sig.parameters, 64), nested = sig.parameterSignatures;
  if (sig.presence !== undefined) {
    check(params.length > 0 && array(sig.presence, 64).length === params.length, 'signature');
    sig.presence.forEach(requiredPresence);
  }
  if (nested !== undefined) check(array(nested, 64).length === params.length && nested.some(Boolean), 'signature');
  const parameters = params.map((kind, index) => valueType(kind, nested?.[index] ?? undefined, depth + 1));
  return { parameters, returns: valueType(sig.returnType, sig.returnSignature, depth + 1) };
}

// Only the existing required scalar parameter metadata is represented here.
// Nullable, optional and default flags remain outside this candidate capability.
export function requiredPresence(value) {
  record(value, ['undefined','null','optional','default','range','annotation']);
  check(['undefined','null','optional','default'].every(key => value[key] === false), 'capability',
    'only required nonnullable parameter presence is represented');
  range(value.range, { start: 0, end: Number.MAX_SAFE_INTEGER });
  range(value.annotation, value.range);
}

export function rawSignature(type) {
  /** @type {any} */
  const result = { parameters: type.parameters.map(item => typeof item === 'string' ? item : 'function'),
    returnType: typeof type.returns === 'string' ? type.returns : 'function' };
  if (type.parameters.some(item => typeof item !== 'string')) result.parameterSignatures = type.parameters.map(item => typeof item === 'string' ? null : rawSignature(item));
  if (typeof type.returns !== 'string') result.returnSignature = rawSignature(type.returns);
  return result;
}
export const functionType = fn => ({ parameters: fn.parameters.map(p => valueType(p.type, p.signature)), returns: valueType(fn.returnType, fn.returnSignature) });
export const typeIdentity = type => typeof type === 'string' ? scalarTypeIds[type] : sha256('tsfg.closure-callable.candidate.v1\0' + canonical(type));
export const signatureIdentity = type => sha256('tsfg.closure-signature.candidate.v1\0' + canonical(type));
export const functionIdentity = (path, parent, scope, name, type) => sha256('tsfg.lexical-function.candidate.v1\0'
  + canonical({ path, parent, scope, name, signature: signatureIdentity(type) }));
export const bindingIdentity = (owner, role, index) => sha256('tsfg.lexical-binding.candidate.v1\0' + owner + '\0' + role + '\0' + index);
