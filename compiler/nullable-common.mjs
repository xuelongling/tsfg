// SPDX-License-Identifier: MIT
import descriptor from '../contracts/nullable-owned-bridge-candidate.schema.json' with { type: 'json' };
import coreDescriptor from '../contracts/core-nullable-candidate.schema.json' with { type: 'json' };
import { canonical, own, sha256 } from './identity.mjs';
import { readGenericJson, checkGenericJsonValueBudget } from './generic-json.mjs';
export { canonical, own, sha256 };
export const schemaHash = sha256(canonical(descriptor));
export const coreSchema = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
export const coreTextLimits = Object.freeze({ name: coreDescriptor.limits.nameUTF8Bytes, path: coreDescriptor.limits.pathUTF8Bytes });
export const snapshotFormat = Object.freeze({ family: 'tsfg.frontend-nullable-candidate', version: 1, schemaHash });
export const hirFormat = Object.freeze({ family: 'tsfg.nullable-hir-candidate', version: 1, schemaHash });
const limits = Object.freeze({ ...descriptor.limits, allowNul: true, rejectPrototypeKeys: true });
export function failure(category, message = 'owned nullable candidate differs') {
  const code = 'r03-nullable-' + category;
  throw Object.assign(new TypeError(code + ': ' + message), { code, ruleId: 'r01-input-boundary', phase: 'hir' });
}
export const check = (condition, category = 'schema', message = undefined) => { if (!condition) failure(category, message); };
check(schemaHash === 'sha256:3da58c2cabf44bd6c337120300ac688bafa3d8e487c36f1ab0a48a4498699218', 'schema');
check(sha256(canonical(coreDescriptor)) === coreSchema, 'schema');
export const same = (a, b) => canonical(a) === canonical(b);
export function budget(value) {
  try { checkGenericJsonValueBudget(value, limits); }
  catch (error) { failure(error.code?.endsWith('-limit') ? 'limit' : 'schema'); }
}
export function readJson(bytes, exact = true) {
  try {
    const input = readGenericJson(bytes, limits); budget(input.value);
    if (exact) check(input.text === canonical(input.value), 'canonical');
    return input;
  } catch (error) {
    if (error.code?.startsWith('r03-nullable-')) throw error;
    failure(error.code?.split('-').at(-1) ?? 'json');
  }
}
export function record(value, required, optional = []) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}
export function array(value, maximum = 4096) { check(Array.isArray(value)); check(value.length <= maximum, 'limit'); return value; }
export function text(value, maximum = undefined) {
  check(typeof value === 'string' && value.length > 0 && value.isWellFormed() && !value.includes('\0'), 'source');
  if (maximum !== undefined) check(Buffer.byteLength(value, 'utf8') <= maximum, 'limit', 'Core text exceeds its descriptor UTF8 byte limit');
}
export function range(value, parent, content) {
  record(value, ['start','end']);
  const boundary = index => !(content.charCodeAt(index) >= 0xdc00 && content.charCodeAt(index) <= 0xdfff
    && content.charCodeAt(index - 1) >= 0xd800 && content.charCodeAt(index - 1) <= 0xdbff);
  check(Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) && !Object.is(value.start, -0) && !Object.is(value.end, -0)
    && value.start >= parent.start && value.end > value.start && value.end <= parent.end && boundary(value.start) && boundary(value.end), 'range');
}
export function origin(value) {
  budget(value); record(value, ['kind','producerBaseOid','producerDirty','requestSha256','responseSha256','testedInputSetHash']);
  check(value.kind === 'owned-go-nullable-response' && typeof value.producerBaseOid === 'string'
    && /^[0-9a-f]{40}$/.test(value.producerBaseOid) && value.producerDirty === true, 'identity');
  for (const key of ['requestSha256','responseSha256','testedInputSetHash']) check(/^sha256:[0-9a-f]{64}$/.test(value[key]), 'identity');
  return value;
}
export const candidate = (domain, value) => sha256(domain + '\0' + coreSchema + '\0' + canonical(value));
export const scalarType = Object.freeze({ kind: 'scalar', name: 'i32', id: candidate('tsfg.core-nullable-candidate.type.v1', { kind: 'scalar', name: 'i32' }) });
export const nullableType = Object.freeze({ kind: 'nullable-i32', undefined: false, null: true,
  id: candidate('tsfg.core-nullable-candidate.type.v1', { kind: 'nullable-i32', undefined: false, null: true }) });
export const valueType = shape => shape?.null === true ? nullableType.id : scalarType.id;
