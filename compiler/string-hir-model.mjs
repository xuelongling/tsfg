// SPDX-License-Identifier: MIT
// String HIR verifies a whole projection of selected facts; it grants no Source admission.
import { isProxy } from 'node:util/types';
import { canonical, own, functionIdentity, signatureHash, stringTypeId } from './identity.mjs';
import { copyGenericJsonBytes, readGenericJson, checkGenericJsonValueBudget } from './generic-json.mjs';
import { readStringFactsCandidate } from './string-facts.mjs';
import { readStringFactsV2Candidate } from './string-facts-v2.mjs';
import registry from '../contracts/registry.json' with { type: 'json' };
import descriptor from '../contracts/hir.schema.json' with { type: 'json' };
import bytecode from '../contracts/bytecode.schema.json' with { type: 'json' };

export const stringHirFormat = own({ contractVersion: registry['tsfg.hir'].semver,
  schemaHash: registry['tsfg.hir'].schemaHash });
export const stringHirType = own({ kind: 'managedReference', name: 'string', id: stringTypeId });
export const stringHirTarget = own(bytecode.target);
const limits = own(descriptor['x-stringFactsContext']);
const policy = Object.freeze({ bytes: limits.jsonBytes, depth: limits.jsonDepth,
  jsonTokens: limits.jsonTokens, stringBytes: limits.jsonStringBytes,
  safeNonnegativeIntegers: true, allowNul: true, rejectPrototypeKeys: true });
const valuePolicy = Object.freeze({ ...policy, bytes: limits.jsonBytes - 1 });
/** @param {string} category @param {any} [cause]
 * @param {{sourceId: string, start: number, end: number}} [primary] @returns {never} */
export function stringHirFailure(category, cause = undefined, primary = undefined) {
  const code = 'r03-hir-' + category;
  throw Object.assign(new TypeError(code + ': invalid selected string HIR', { cause }),
    { code, ruleId: 'r01-input-boundary', phase: 'hir', ...(primary ? { primary } : {}) });
}
const check = (condition, category = 'invalid', primary = undefined) => {
  if (!condition) stringHirFailure(category, undefined, primary);
};
const equal = (left, right) => canonical(left) === canonical(right);
function record(value, fields, primary = undefined) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'invalid', primary);
  check(Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)), 'invalid', primary);
}
function budget(value) {
  try { checkGenericJsonValueBudget(value, valuePolicy); }
  catch (cause) { stringHirFailure(cause?.code?.endsWith('-limit') ? 'limit' : 'invalid', cause); }
}
// Family error mapping remains here; the native snapshot algorithm has one shared owner.
function bytesCopy(bytes, category) {
  try { return copyGenericJsonBytes(bytes, policy); }
  catch (cause) { stringHirFailure(cause?.code?.endsWith('-limit') ? 'limit' : category, cause); }
}

/** Context is explicit job configuration, not an identity inferred from cold data. */
export function readStringFactsContext(context) {
  check(context && typeof context === 'object' && !isProxy(context), 'context');
  check([Object.prototype, null].includes(Object.getPrototypeOf(context)), 'context');
  const keys = Reflect.ownKeys(context);
  const versioned = keys.includes('factsVersion');
  check(keys.length === (versioned ? 3 : 2) && keys.includes('factsBytes') && keys.includes('expectedPackageId'), 'context');
  const fields = Object.fromEntries(keys.map(key => {
    const field = Object.getOwnPropertyDescriptor(context, key);
    check(field && field.enumerable && Object.hasOwn(field, 'value'), 'context');
    return [key, field.value];
  }));
  const factsVersion = versioned ? fields.factsVersion : 1;
  check(!versioned || factsVersion === 2, 'context');
  check(typeof fields.expectedPackageId === 'string' && /^sha256:[0-9a-f]{64}$/.test(fields.expectedPackageId), 'context');
  const bytes = bytesCopy(fields.factsBytes, 'context');
  let facts;
  try { facts = factsVersion === 2 ? readStringFactsV2Candidate(bytes) : readStringFactsCandidate(bytes); }
  catch (cause) { stringHirFailure(cause?.code === 'r03-string-facts-limit' ? 'limit' : 'context', cause); }
  check(facts.packageId === fields.expectedPackageId, 'context');
  return { bytes, facts, factsVersion };
}

// The shared preflight has already rejected behavioral objects throughout the graph.
// These fixed-profile bounds precede identity/projection comparisons and any owned copy.
function projectionBudget(hir, factsVersion) {
  const field = (value, key) => value && typeof value === 'object' && Object.hasOwn(value, key)
    ? value[key] : undefined;
  const content = field(field(hir, 'source'), 'content');
  if (typeof content === 'string') check(Buffer.byteLength(content, 'utf8') <= limits.sourceUTF8Bytes, 'limit');
  const functions = field(hir, 'functions');
  if (!Array.isArray(functions)) return;
  check(functions.length <= limits.functions, 'limit');
  let totalUnits = 0;
  for (const fn of functions) {
    const body = field(fn, 'body');
    if (!Array.isArray(body) || body.length !== 1) continue;
    const value = field(body[0], 'value');
    const leaves = factsVersion === 1 ? [value] : [field(value, 'left'), field(value, 'right')];
    let concat = 0;
    for (const leaf of leaves) {
      const units = field(leaf, 'codeUnits');
      if (!Array.isArray(units)) continue;
      check(units.length <= limits.valueCodeUnits, 'limit');
      totalUnits += units.length; concat += units.length;
      check(totalUnits <= limits.packageCodeUnits, 'limit');
    }
    if (factsVersion === 2) check(concat <= limits.concatCodeUnits, 'limit');
  }
}

function verifyStringLeaf(value, expected, primary) {
  record(value, ['kind', 'type', 'codeUnits', 'range'], primary);
  check(value.kind === 'stringConstant' && value.type === stringTypeId && equal(value.range, expected.range),
    'invalid', primary);
  check(Array.isArray(value.codeUnits) && value.codeUnits.length === expected.codeUnits.length
    && value.codeUnits.every((unit, ordinal) => Number.isInteger(unit) && unit >= 0 && unit <= 65535
      && unit === expected.codeUnits[ordinal]), 'invalid', primary);
}

function verifyProjection(hir, facts) {
  budget(hir);
  projectionBudget(hir, facts.version);
  record(hir, ['contractVersion', 'schemaHash', 'inputIdentity', 'source', 'target', 'functions']);
  check(hir.inputIdentity === facts.packageId, 'context');
  check(hir.contractVersion === stringHirFormat.contractVersion && hir.schemaHash === stringHirFormat.schemaHash);
  check(equal(hir.target, stringHirTarget));
  const source = facts.payload.files.find(file => file.path === facts.payload.rootFile);
  check(equal(hir.source, { path: source.path, content: source.content, hash: 'sha256:' + source.sha256 }));
  check(Array.isArray(hir.functions) && hir.functions.length === facts.payload.functions.length);
  for (const [index, fn] of hir.functions.entries()) {
    const origin = facts.payload.functions[index], statement = origin.body[0];
    // All three locations come from the verified selected package, never the rejected HIR.
    const anchor = range => Object.freeze({ sourceId: origin.sourcePath, start: range.start, end: range.end });
    const functionPrimary = anchor(origin.declarationRange), returnPrimary = anchor(statement.range);
    record(fn, ['id', 'name', 'signatureHash', 'returnType', 'parameters', 'range', 'body'], functionPrimary);
    check(fn.id === functionIdentity(source.path, origin.name, 'string', [])
      && fn.name === origin.name && fn.signatureHash === signatureHash('string', []), 'invalid', functionPrimary);
    check(equal(fn.returnType, stringHirType) && equal(fn.range, origin.declarationRange), 'invalid', functionPrimary);
    check(Array.isArray(fn.parameters) && fn.parameters.length === 0 && Array.isArray(fn.body) && fn.body.length === 1,
      'invalid', functionPrimary);
    const returned = fn.body[0];
    record(returned, ['kind', 'range', 'value'], returnPrimary);
    check(returned.kind === 'return' && equal(returned.range, statement.range), 'invalid', returnPrimary);
    const value = returned.value, expected = statement.value;
    if (facts.version === 1) {
      verifyStringLeaf(value, expected, anchor(expected.range));
    } else {
      const concatPrimary = anchor(expected.range);
      record(value, ['kind', 'type', 'range', 'operatorRange', 'left', 'right'], concatPrimary);
      check(value.kind === 'stringConcat' && value.type === stringTypeId && equal(value.range, expected.range),
        'invalid', concatPrimary);
      check(equal(value.operatorRange, expected.operatorRange), 'invalid', anchor(expected.operatorRange));
      verifyStringLeaf(value.left, expected.left, anchor(expected.left.range));
      verifyStringLeaf(value.right, expected.right, anchor(expected.right.range));
    }
  }
  // JSON positions own separate values even when the accepted caller graph aliases leaves.
  return own(JSON.parse(canonical(hir)));
}

/** @param {any} hir @param {any} context */
export function verifyStringHir(hir, context) {
  const { facts } = readStringFactsContext(context);
  return verifyProjection(hir, facts);
}

/** Existing HIR wire family, with the selected String profile and no new envelope. */
export function readStringHir(bytes, context) {
  const { facts } = readStringFactsContext(context);
  const snapshot = bytesCopy(bytes, 'invalid');
  let input;
  try { input = readGenericJson(snapshot, policy); }
  catch (cause) {
    const category = cause?.code?.endsWith('-limit') ? 'limit'
      : cause?.code?.endsWith('-canonical') ? 'canonical' : 'invalid';
    stringHirFailure(category, cause);
  }
  const hir = verifyProjection(input.value, facts);
  check(input.text === canonical(hir) + '\n', 'canonical');
  return hir;
}
