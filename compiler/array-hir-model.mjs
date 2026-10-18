// SPDX-License-Identifier: MIT
// An explicit facts context owns complete Array HIR trust and diagnostic anchors.
import { isProxy } from 'node:util/types';
import descriptor from '../contracts/array-hir-candidate.schema.json' with { type: 'json' };
import bytecode from '../contracts/bytecode.schema.json' with { type: 'json' };
import { canonical, own, sha256, scalarTypeIds, functionIdentity, signatureHash } from './identity.mjs';
import { copyGenericJsonBytes, readGenericJson, checkGenericJsonValueBudget } from './generic-json.mjs';
import { readArrayFactsCandidate } from './array-facts.mjs';
import { arrayFactsLimits } from './array-facts-model.mjs';

const schemaHash = 'sha256:dc3cb6662f04ddd783d3a7a92cdc9fda19b19f12594ed8793037f7de194e7d5e';
export const arrayHirFormat = own({ family: 'tsfg.array-hir-candidate', version: 1, schemaHash });
export const arrayHirType = own({ kind: 'managedReference', name: 'Array',
  elementType: scalarTypeIds.f64, id: sha256('tsfg.type\0Array<f64>') });
const target = own(bytecode.target), policy = arrayFactsLimits;
const valuePolicy = Object.freeze({ ...policy, bytes: policy.bytes - 1 });

/** @param {string} kind @param {any} [cause] @param {any} [primary] @returns {never} */
export function arrayHirFailure(kind, cause = undefined, primary = undefined) {
  throw Object.assign(new TypeError('r03-array-hir-' + kind + ': invalid selected Array HIR', { cause }),
    { code: 'r03-array-hir-' + kind, ruleId: 'r01-input-boundary', phase: 'hir',
      ...(primary ? { primary } : {}) });
}
const check = (condition, kind = 'invalid') => { if (!condition) arrayHirFailure(kind); };
check(sha256(canonical(descriptor) + '\n') === schemaHash);

/** A safe positive discriminator only; the no-family legacy String route is unchanged. */
export function isArrayFactsContext(context) {
  if (!context || typeof context !== 'object' || isProxy(context)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(context))) return false;
  const field = Object.getOwnPropertyDescriptor(context, 'family');
  return Boolean(field && field.enumerable && Object.hasOwn(field, 'value')
    && field.value === 'tsfg.array-facts-context-candidate');
}
export function readArrayFactsContext(context) {
  check(context && typeof context === 'object' && !isProxy(context), 'context');
  check([Object.prototype, null].includes(Object.getPrototypeOf(context)), 'context');
  const keys = Reflect.ownKeys(context);
  check(keys.length === 4 && ['family','version','factsBytes','expectedPackageId'].every(key => keys.includes(key)), 'context');
  const fields = Object.fromEntries(keys.map(key => {
    const field = Object.getOwnPropertyDescriptor(context, key);
    check(field && field.enumerable && Object.hasOwn(field, 'value'), 'context');
    return [key, field.value];
  }));
  check(fields.family === 'tsfg.array-facts-context-candidate' && fields.version === 1, 'context');
  check(typeof fields.expectedPackageId === 'string' && /^sha256:[0-9a-f]{64}$/.test(fields.expectedPackageId), 'context');
  let bytes, facts;
  try {
    bytes = copyGenericJsonBytes(fields.factsBytes, policy);
    facts = readArrayFactsCandidate(bytes);
  } catch (cause) {
    arrayHirFailure(cause?.code?.endsWith('-limit') ? 'limit' : 'context', cause);
  }
  check(facts.packageId === fields.expectedPackageId, 'context');
  return { bytes, facts };
}
function reference(value) {
  return { kind: 'reference', type: arrayHirType.id, binding: value.binding, range: { ...value.range } };
}
function initializer(value) {
  if (value.kind === 'reference') return reference(value);
  return { kind: 'arrayCreate', type: arrayHirType.id, range: { ...value.range },
    allocationSite: value.allocationSite, elements: value.elements.map(item => ({
      kind: 'floating', type: scalarTypeIds.f64, range: { ...item.range }, token: item.token, bits: item.bits,
    })) };
}
/** The sole facts-to-HIR transform; only an already verified selected facts package enters. */
export function projectArrayFacts(facts) {
  const payload = facts.payload, functions = payload.functions.map(fn => {
    /** @type {Map<string, any>} */
    const bindings = new Map(fn.bindings.map(binding => [binding.id, binding]));
    return { id: functionIdentity(fn.sourcePath, fn.name, 'f64', []), sourceBinding: fn.id,
      name: fn.name, sourcePath: fn.sourcePath, signatureHash: signatureHash('f64', []),
      returnType: { kind: 'scalar', name: 'f64', id: scalarTypeIds.f64 }, parameters: [],
      range: { ...fn.declarationRange }, nameRange: { ...fn.nameRange },
      returnAnnotationRange: { ...fn.returnAnnotationRange }, body: fn.body.map(statement => {
        if (statement.kind === 'variable') {
          const binding = bindings.get(statement.binding);
          return { kind: 'local', range: { ...statement.range }, binding: {
            id: binding.id, name: binding.name, type: arrayHirType.id, writable: false,
            range: { ...binding.declarationRange }, nameRange: { ...binding.nameRange },
            annotationRange: binding.annotationRange === null ? null : { ...binding.annotationRange },
            elementAnnotationRange: binding.elementAnnotationRange === null ? null : { ...binding.elementAnnotationRange },
          }, initializer: initializer(statement.initializer) };
        }
        const value = statement.value;
        return { kind: 'return', range: { ...statement.range }, value: {
          kind: 'arrayReadChecked', type: scalarTypeIds.f64, range: { ...value.range },
          receiver: reference(value.array), index: { kind: 'constant', type: scalarTypeIds.u32,
            range: { ...value.index.range }, token: value.index.token, decimal: value.index.decimal },
        } };
      }) };
  });
  const functionIds = new Map(functions.map(fn => [fn.sourceBinding, fn.id]));
  const types = payload.types.map(type => {
    const origin = { sourcePath: type.sourcePath, declarationRange: { ...type.declarationRange },
      nameRange: { ...type.nameRange } };
    return type.id === 'f64' ? { id: scalarTypeIds.f64, kind: 'scalar', name: 'f64', ...origin }
      : { ...arrayHirType, ...origin, indexSignatureRange: { ...type.indexSignatureRange } };
  });
  return { format: { ...arrayHirFormat }, inputIdentity: facts.packageId,
    facts: { version: 1, schemaHash: facts.schemaHash, requestId: facts.requestId },
    rootFile: payload.rootFile,
    sources: payload.files.map(file => ({ path: file.path, content: file.content, hash: 'sha256:' + file.sha256 })),
    target: { ...target }, types, functions,
    exports: payload.exports.map(item => ({ name: item.name, functionId: functionIds.get(item.functionId) })) };
}
function projectionBudget(hir) {
  const functions = hir && typeof hir === 'object' ? hir.functions : undefined;
  if (Array.isArray(hir?.sources)) for (const source of hir.sources)
    if (typeof source?.content === 'string') check(Buffer.byteLength(source.content, 'utf8') <= 65536, 'limit');
  if (!Array.isArray(functions)) return;
  check(functions.length <= 16, 'limit');
  let units = 0;
  for (const fn of functions) {
    if (!Array.isArray(fn?.body)) continue;
    check(fn.body.length <= 18, 'limit');
    let locals = 0;
    for (const statement of fn.body) {
      if (statement?.kind === 'local') check(++locals <= 17, 'limit');
      const elements = statement?.initializer?.elements;
      if (Array.isArray(elements)) {
        check(elements.length <= 256, 'limit'); units += elements.length;
        check(units <= 4096, 'limit');
      }
    }
  }
}
/** Compare every field, with locations taken exclusively from the trusted expected projection. */
function matchProjection(value, expected, sourcePath, primary = undefined) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    sourcePath = expected.sourcePath ?? sourcePath;
    const span = expected.range ?? expected.declarationRange;
    if (span) primary = { sourceId: sourcePath, ...span };
  }
  const fail = () => arrayHirFailure('invalid', undefined, primary);
  if (expected === null || typeof expected !== 'object') { if (value !== expected) fail(); return; }
  if (!value || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(expected)) fail();
  const keys = Object.keys(expected);
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
  for (const key of keys) matchProjection(value[key], expected[key], sourcePath, primary);
}
export function verifyArrayHir(hir, context) {
  const { facts } = readArrayFactsContext(context);
  try { checkGenericJsonValueBudget(hir, valuePolicy); }
  catch (cause) { arrayHirFailure(cause?.code?.endsWith('-limit') ? 'limit' : 'invalid', cause); }
  projectionBudget(hir);
  const expected = projectArrayFacts(facts);
  matchProjection(hir, expected, facts.payload.rootFile);
  return own(hir);
}
export function readArrayHir(bytes, context) {
  readArrayFactsContext(context);
  let input;
  try { input = readGenericJson(copyGenericJsonBytes(bytes, policy), policy); }
  catch (cause) {
    arrayHirFailure(cause?.code?.endsWith('-limit') ? 'limit'
      : cause?.code?.endsWith('-canonical') ? 'canonical' : 'invalid', cause);
  }
  const hir = verifyArrayHir(input.value, context);
  check(input.text === canonical(hir) + '\n', 'canonical'); return hir;
}
