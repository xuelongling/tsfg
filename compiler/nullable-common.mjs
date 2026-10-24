// SPDX-License-Identifier: MIT
import { isProxy } from 'node:util/types';
import groupsDescriptor from '../contracts/nullable-groups-candidate.schema.json' with { type: 'json' };
import typeofDescriptor from '../contracts/nullable-typeof-undefined-candidate.schema.json' with { type: 'json' };
import descriptor from '../contracts/nullable-owned-bridge-candidate.schema.json' with { type: 'json' };
import presenceDescriptor from '../contracts/nullable-presence-capture-candidate.schema.json' with { type: 'json' };
import coreDescriptor from '../contracts/core-nullable-candidate.schema.json' with { type: 'json' };
import { canonical, own, sha256 } from './identity.mjs';
import { readGenericJson, checkGenericJsonValueBudget, copyGenericJsonBytes } from './generic-json.mjs';
export { canonical, own, sha256 };
export const schemaHash = sha256(canonical(descriptor));
export const coreSchema = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
export const coreTextLimits = Object.freeze({ name: coreDescriptor.limits.nameUTF8Bytes, path: coreDescriptor.limits.pathUTF8Bytes });
export const snapshotFormat = Object.freeze({ family: 'tsfg.frontend-nullable-candidate', version: 3, schemaHash });
export const hirFormat = Object.freeze({ family: 'tsfg.nullable-hir-candidate', version: 3, schemaHash });
const limits = Object.freeze({ ...descriptor.limits, allowNul: true, rejectPrototypeKeys: true });
export function failure(category, message = 'owned nullable candidate differs') {
  const code = 'r03-nullable-' + category;
  throw Object.assign(new TypeError(code + ': ' + message), { code, ruleId: 'r01-input-boundary', phase: 'hir' });
}
export const check = (condition, category = 'schema', message = undefined) => { if (!condition) failure(category, message); };
check(schemaHash === 'sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71', 'schema');
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
export const nullableTypes = Object.freeze([1, 2, 3].map(mask => {
  const shape = { kind: 'nullable-i32', undefined: (mask & 1) !== 0, null: (mask & 2) !== 0 };
  return Object.freeze({ ...shape, id: candidate('tsfg.core-nullable-candidate.type.v1', shape) });
}));
const allTypes = Object.freeze([scalarType, ...nullableTypes]);
export function typeFor(id) { const type = allTypes.find(type => type.id === id); check(type, 'type'); return type; }
export function presenceMask(shape) {
  if (shape === undefined) return 0;
  check(shape && typeof shape === 'object' && typeof shape.undefined === 'boolean' && typeof shape.null === 'boolean', 'capability');
  return (shape.undefined ? 1 : 0) | (shape.null ? 2 : 0);
}
export const valueType = shape => { const mask = presenceMask(shape); return mask ? nullableTypes[mask - 1].id : scalarType.id; };

// Source4 capture is a separate finite consumer; default3 diagnostics and IDs stay intact.
export const presenceSchemaHash = sha256(canonical(presenceDescriptor));
export const presenceSourceSchema = presenceDescriptor.sourceSchemaHash;
export const presenceSnapshotFormat = Object.freeze({ family: snapshotFormat.family, version: 4, schemaHash: presenceSchemaHash });
const presenceLimits = Object.freeze({ bytes: presenceDescriptor.limits.wireBytes, depth: presenceDescriptor.limits.depth,
  jsonTokens: presenceDescriptor.limits.jsonTokens, stringBytes: presenceDescriptor.limits.stringUTF8Bytes, allowNul: true, rejectPrototypeKeys: true });
const presenceErrors = new WeakSet();
check(presenceSchemaHash === 'sha256:1c1e5c0e7b43a0a70fce4f73173033ad8a60554d8557533f6343b29c8c4cf5ce'
  && sha256(canonical(presenceDescriptor.sourceDescriptor)) === presenceSourceSchema, 'schema');
/** @returns {never} */
export function presenceFailure(category, primary = undefined, cause = undefined) {
  if (!presenceDescriptor.errors.categories.includes(category)) category = 'source';
  const code = 'r03-nullable-' + category;
  const error = Object.assign(new TypeError(code + ': invalid private nullable presence capture'),
    { code, ruleId: 'r01-input-boundary', phase: 'frontend' });
  if (primary !== undefined) Object.defineProperty(error, 'primary', { value: Object.freeze({ ...primary }), enumerable: true });
  if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause });
  presenceErrors.add(error); throw error;
}
/** @returns {never} */
export function presenceRethrow(error, primary = undefined) {
  if (presenceErrors.has(error)) throw error;
  const code = typeof error?.code === 'string' ? error.code : '';
  const generic = code.startsWith('generic-package-'), suffix = code.split('-').at(-1);
  const category = generic ? ({ utf8: 'json', json: 'json', canonical: 'canonical', input: 'input', limit: 'limit' })[suffix] ?? 'schema'
    : /^(r03-nullable-|r03-closure-)/.test(code) && presenceDescriptor.errors.categories.includes(suffix) ? suffix : 'source';
  presenceFailure(category, ['limit','identity','context'].includes(category) ? undefined : primary, generic ? error : undefined);
}
export function presenceBudget(value) {
  try { checkGenericJsonValueBudget(value, presenceLimits); } catch (error) { presenceRethrow(error); }
}
const field = (value, key) => value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, key) ? value[key] : undefined;
// Only safe own fields after generic preflight; these are domain counts, not another JSON walker.
export function presenceDomainBudget(facts) {
  const functions = field(facts, 'functions'), symbols = field(facts, 'symbols');
  if (Array.isArray(symbols)) check(symbols.length <= 4096, 'limit');
  if (!Array.isArray(functions)) return;
  check(functions.length <= 512, 'limit'); let guards = 0;
  for (const fn of functions) {
    const params = field(fn, 'parameters'); if (Array.isArray(params)) check(params.length <= 64, 'limit');
    const pending = [field(fn, 'body')]; let localGuards = 0, statements = 0;
    while (pending.length) {
      const body = pending.pop(); if (!Array.isArray(body)) continue;
      statements += body.length; check(statements <= 4096, 'limit');
      for (const item of body) {
        const kind = field(item, 'kind');
        if (kind === 'if') { check(++localGuards <= 2 && ++guards <= 1024, 'limit'); pending.push(field(item, 'thenBody'), field(item, 'elseBody')); }
        if (kind === 'block') pending.push(field(item, 'body'));
      }
    }
  }
}
export function readPresenceJson(bytes) {
  try {
    const input = readGenericJson(copyGenericJsonBytes(bytes, presenceLimits), presenceLimits); presenceBudget(input.value);
    presenceDomainBudget(field(field(input.value, 'payload'), 'facts'));
    check(input.text === canonical(input.value), 'canonical'); return input;
  } catch (error) { presenceRethrow(error); }
}
export function presenceOrigin(value) {
  presenceBudget(value); record(value, ['kind','producerBaseOid','producerDirty','requestSha256','responseSha256','testedInputSetHash']);
  check(value.kind === 'owned-go-nullable-response' && typeof value.producerBaseOid === 'string'
    && /^[0-9a-f]{40}$/.test(value.producerBaseOid) && typeof value.producerDirty === 'boolean', 'identity');
  for (const key of ['requestSha256','responseSha256','testedInputSetHash']) check(typeof value[key] === 'string' && /^sha256:[0-9a-f]{64}$/.test(value[key]), 'identity');
  return value;
}
export function presenceOwn(value) {
  presenceBudget(value);
  // JSON expands already-safe aliases at each serialized position; structuredClone alone preserves them.
  return own(JSON.parse(canonical(value)));
}

// Source5 extends ordinary value expressions; Source3/4 remain distinct contracts.
export const groupsSourceSchema = groupsDescriptor.sourceSchemaHash;
export const groupsSchemaHash = sha256(canonical(groupsDescriptor));
check(groupsSchemaHash === 'sha256:16278abcc5c2c3639856a350e32bdb94d0d5e3ff669a91124032f674136924af'
  && sha256(canonical(groupsDescriptor.sourceDescriptor)) === groupsSourceSchema, 'schema');
export const groupsSnapshotFormat = Object.freeze({ family: snapshotFormat.family, version: 5, schemaHash: groupsSchemaHash });
export const groupsHirFormat = Object.freeze({ family: hirFormat.family, version: 5, schemaHash: groupsSchemaHash });
// Public dispatch inspects only a plain own data selector; validators then preflight the entire context.
function isNullableSourceVersion(value, version) {
  if (!value || typeof value !== 'object' || isProxy(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Object.getOwnPropertyDescriptor(value, 'sourceVersion')?.value === version;
}
export function isNullableGroupsContext(value) {
  return isNullableSourceVersion(value, 5);
}

// Independent private6 selector; never routes an old context through the new grammar.
export function isNullableTypeofContext(value) {
  return isNullableSourceVersion(value, 6);
}
export const typeofSourceSchema = typeofDescriptor.sourceSchemaHash;
export const typeofSchemaHash = sha256(canonical(typeofDescriptor));
check(typeofSchemaHash === 'sha256:cad90ff57a58a4094cc7315c6b41d199a13f5c38302acc573d311ae98f652822'
  && sha256(canonical(typeofDescriptor.sourceDescriptor)) === typeofSourceSchema, 'schema');
export const typeofSnapshotFormat = Object.freeze({ family: snapshotFormat.family, version: 6, schemaHash: typeofSchemaHash });
export const typeofHirFormat = Object.freeze({ family: hirFormat.family, version: 6, schemaHash: typeofSchemaHash });

export function readGroupsHirJson(bytes) {
  try {
    const input = readGenericJson(copyGenericJsonBytes(bytes, presenceLimits), presenceLimits);
    presenceBudget(input.value); check(input.text === canonical(input.value) + '\n', 'canonical'); return input.value;
  } catch (error) { presenceRethrow(error); }
}
