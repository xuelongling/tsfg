// SPDX-License-Identifier: MIT
// An explicit facts context owns complete Array HIR trust and diagnostic anchors.
import { isProxy } from 'node:util/types';
import descriptor from '../contracts/array-hir-candidate.schema.json' with { type: 'json' };
import bytecode from '../contracts/bytecode.schema.json' with { type: 'json' };
import { canonical, own, sha256, scalarTypeIds, functionIdentity, signatureHash, arrayTypeId, readSpanTypeId } from './identity.mjs';
import { copyGenericJsonBytes, checkGenericJsonValueBudget } from './generic-json.mjs';
import { readArrayFactsCandidate } from './array-facts.mjs';
import { arrayFactsLimits } from './array-facts-model.mjs';

const schemaHash = 'sha256:e9d687ce59c5920d33a7cf03e09902d6d0f065d4efe5033ca183f2a175d9d458';
export const arrayHirFormat = own({ family: 'tsfg.array-hir-candidate', version: 5, schemaHash });
export const arrayHirType = own({ kind: 'managedReference', name: 'Array',
  elementType: scalarTypeIds.f64, id: arrayTypeId });
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
  return { kind: 'reference', type: value.flowType === 'array.f64' ? arrayHirType.id : value.flowType === 'readspan.f64' ? readSpanTypeId : scalarTypeIds[value.flowType],
    binding: value.binding, range: { ...value.range } };
}
function expression(value, headers) {
  if (value.kind === 'reference') return reference(value);
  const span = { ...value.range };
  if (value.kind === 'readSpanCreate') return {kind:'readSpanCreateChecked',type:readSpanTypeId,range:span,
    intrinsic:value.intrinsic,calleeRange:{...value.calleeRange},receiver:reference(value.array),
    start:expression(value.start,headers),length:expression(value.length,headers)};
  if (value.kind === 'checkedReadSpanAccess') return {kind:'readSpanReadChecked',type:scalarTypeIds.f64,
    range:span,receiver:reference(value.view),index:expression(value.index,headers)};
  if (value.kind === 'readSpanLength') return {kind:'readSpanLength',type:scalarTypeIds.u32,range:span,
    receiver:reference(value.view),property:value.property,nameRange:{...value.nameRange}};
  if (value.kind === 'directCall') {
    const fn = headers.get(value.callee);
    return {kind:'arrayDirectCall',type:scalarTypeIds.f64,range:span,calleeRange:{...value.calleeRange},
      target:fn.id,sourceCallee:value.callee,signatureHash:fn.signatureHash,
      arguments:value.arguments.map(arg => expression(arg, headers))};
  }
  if (value.kind === 'numericLiteral') return {kind:'floating',type:scalarTypeIds.f64,range:span,token:value.token,bits:value.bits};
  if (value.kind === 'indexLiteral' || value.kind === 'lengthLiteral' || value.kind === 'u32Literal')
    return {kind:'constant',type:scalarTypeIds.u32,range:span,token:value.token,decimal:value.decimal};
  if (value.kind === 'arrayLiteral') return {kind:'arrayCreate',type:arrayHirType.id,range:span,
    allocationSite:value.allocationSite,elements:value.elements.map(item => expression(item, headers))};
  if (value.kind === 'lengthTarget') return {kind:'arrayLengthTarget',type:scalarTypeIds.u32,range:span,
    receiver:reference(value.array),property:value.property,nameRange:{...value.nameRange}};
  return {kind:value.kind === 'elementTarget' ? 'arrayElementTarget' : 'arrayReadChecked',
    type:scalarTypeIds.f64,range:span,receiver:reference(value.array),index:expression(value.index, headers)};
}
/** The sole facts-to-HIR transform; only an already verified selected facts package enters. */
export function projectArrayFacts(facts) {
  const payload = facts.payload;
  const headers = new Map(payload.functions.map(fn => [fn.id, {
    id:functionIdentity(fn.sourcePath,fn.name,'f64',fn.parameters.map(p => p.declaredType)),
    signatureHash:signatureHash('f64',fn.parameters.map(p => p.declaredType)),
  }]));
  const functions = payload.functions.map(fn => {
    /** @type {Map<string, any>} */
    const bindings = new Map(fn.bindings.map(binding => [binding.id, binding]));
    const parameterTypes = fn.parameters.map(parameter => parameter.declaredType);
    return {id:functionIdentity(fn.sourcePath,fn.name,'f64',parameterTypes),sourceBinding:fn.id,
      name:fn.name,sourcePath:fn.sourcePath,signatureHash:signatureHash('f64',parameterTypes),
      returnType:{kind:'scalar',name:'f64',id:scalarTypeIds.f64},
      parameters:fn.parameters.map(parameter => ({id:parameter.id,name:parameter.name,
        type:parameter.declaredType === 'array.f64' ? arrayHirType.id
          : parameter.declaredType === 'readspan.f64' ? readSpanTypeId : scalarTypeIds[parameter.declaredType],
        writable:parameter.writable,range:{...parameter.declarationRange},nameRange:{...parameter.nameRange},annotationRange:{...parameter.annotationRange},
        ...(['array.f64','readspan.f64'].includes(parameter.declaredType) ? {elementAnnotationRange:{...parameter.elementAnnotationRange}} : {})})),
      range:{...fn.declarationRange},nameRange:{...fn.nameRange},returnAnnotationRange:{...fn.returnAnnotationRange},
      body:fn.body.map(statement => {
        if (statement.kind === 'variable') {
          const binding = bindings.get(statement.binding);
          return {kind:'local',range:{...statement.range},binding:{id:binding.id,name:binding.name,
            type:binding.declaredType === 'readspan.f64' ? readSpanTypeId : arrayHirType.id,writable:false,range:{...binding.declarationRange},nameRange:{...binding.nameRange},
            annotationRange:binding.annotationRange === null ? null : {...binding.annotationRange},
            elementAnnotationRange:binding.elementAnnotationRange === null ? null : {...binding.elementAnnotationRange}},
            initializer:expression(statement.initializer, headers)};
        }
        if (statement.kind === 'call' || statement.kind === 'readSpanUse') return {kind:'expression',range:{...statement.range},expression:expression(statement.value, headers)};
        if (statement.kind === 'return') return {kind:'return',range:{...statement.range},value:expression(statement.value, headers)};
        return {kind:statement.kind === 'elementAssignment' ? 'arrayStoreDenseChecked' : 'arrayResizeChecked',
          range:{...statement.range},expressionRange:{...statement.expressionRange},operatorRange:{...statement.operatorRange},
          target:expression(statement.target, headers),value:expression(statement.value, headers)};
      })};
  });
  const functionIds = new Map(functions.map(fn => [fn.sourceBinding,fn.id]));
  const types = payload.types.map(type => {
    const origin = {sourcePath:type.sourcePath,declarationRange:{...type.declarationRange},nameRange:{...type.nameRange}};
    return type.id === 'array.f64' ? {...arrayHirType,...origin,indexSignatureRange:{...type.indexSignatureRange}}
      : type.id === 'readspan.f64' ? {id:readSpanTypeId,kind:'view',name:'ReadSpan',elementType:scalarTypeIds.f64,
        readonly:true,...origin,indexSignatureRange:{...type.indexSignatureRange}}
      : {id:scalarTypeIds[type.id],kind:'scalar',name:type.id,...origin};
  });
  return {format:{...arrayHirFormat},inputIdentity:facts.packageId,
    facts:{version:5,schemaHash:facts.schemaHash,requestId:facts.requestId},rootFile:payload.rootFile,
    sources:payload.files.map(file => ({path:file.path,content:file.content,hash:'sha256:'+file.sha256})),
    target:{...target},types,arrayLength:{...payload.arrayLength,ownerType:arrayHirType.id,writeType:scalarTypeIds.u32,
      declarationRange:{...payload.arrayLength.declarationRange},nameRange:{...payload.arrayLength.nameRange},typeRange:{...payload.arrayLength.typeRange}},
    readSpanLength:{...payload.readSpanLength,ownerType:readSpanTypeId,readType:scalarTypeIds.u32},
    readSpanIntrinsic:{...payload.readSpanIntrinsic},
    functions,exports:payload.exports.map(item => ({name:item.name,functionId:functionIds.get(item.functionId)}))};
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
    check(fn.body.length <= 50, 'limit');
    if (Array.isArray(fn.parameters)) check(fn.parameters.length <= 8, 'limit');
    let locals = 0, mutations = 0, calls = 0, expressions = 0;
    const scanCalls = value => {
      if (!value || typeof value !== 'object') return;
      if (value.kind === 'arrayDirectCall' || value.kind === 'readSpanCreateChecked') check(++calls <= 32, 'limit');
      Object.values(value).forEach(scanCalls);
    };
    scanCalls(fn.body);
    for (const statement of fn.body) {
      if (['arrayStoreDenseChecked','arrayResizeChecked','expression'].includes(statement?.kind))
        check(++expressions <= 32, 'limit');
      if (['arrayStoreDenseChecked','arrayResizeChecked'].includes(statement?.kind)) check(++mutations <= 32, 'limit');
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
  if (Array.isArray(expected) && value.length !== expected.length && expected.length) {
    const item = expected[Math.min(value.length,expected.length - 1)], span = item?.range ?? item?.declarationRange;
    if (span) primary = {sourceId:item.sourcePath ?? sourcePath,...span};
  }
  const keys = Object.keys(expected);
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
  for (const key of keys) matchProjection(value[key], expected[key], sourcePath, primary);
}
export function checkArrayHirInput(hir) {
  try { checkGenericJsonValueBudget(hir, valuePolicy); }
  catch (cause) { arrayHirFailure(cause?.code?.endsWith('-limit') ? 'limit' : 'invalid', cause); }
  projectionBudget(hir);
}
export function matchArrayHir(hir, expected) {
  matchProjection(hir,expected,expected.rootFile);
}
