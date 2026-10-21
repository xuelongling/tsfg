import { familyOf } from './module-callable-common.mjs';
import { verifyModuleCallableHir } from './module-callable-hir.mjs';
import { analyzeModuleCallableCalls } from './module-callable-publication.mjs';
// SPDX-License-Identifier: MIT
import { analyzeVerifiedModuleCalls, checkCallEffectsInputs, callEffectsFailure, verifyKernelHostSemantics } from './call-effects.mjs';
export { KernelHostSemanticError } from './call-effects.mjs';
import { verifyStringHir } from './string-hir-model.mjs';
import { isArrayFactsContext } from './array-hir-model.mjs';
import { verifySelectedArrayHir as verifyArrayHir } from './array-hir.mjs';
import { verifyExceptionHir } from './exception-hir.mjs';
import { verifyNullableHir } from './nullable-hir.mjs';
import { verifyClosureHir } from './closure-hir.mjs';
import { scalarOperations, validScalarUnary, validScalarBinary } from './scalar-operators.mjs';
export { scalarOperations } from './scalar-operators.mjs';
import { verifyModuleHir } from './module-facts.mjs';
import { initializerIdentity } from './modules.mjs';
import { canonical, scalarTypeIds, own, sha256 } from './identity.mjs';
import registry from '../contracts/registry.json' with {type:'json'};
import bytecodeSchema from '../contracts/bytecode.schema.json' with {type:'json'};
import { admittedInputScope } from "./conversions.mjs";
import { verifyScalarFunctionBody } from "./scalar-hir-body.mjs";
import { presenceIdentity, presenceSignature } from "./presence.mjs";
import { validText, range } from './scalar-hir-state.mjs';

// This module owns complete cold HIR validation before any pruning or lowering.
const contract = () => registry["tsfg.hir"];
const exactKeys = (value, keys) => value && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const hash = value => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const types = scalarTypeIds;
/** @param {any} hir @param {any} [factsContext] @param {any} [callPublicationContext] */
export function verifyHir(hir, factsContext = undefined, callPublicationContext = undefined) {
  if (isArrayFactsContext(factsContext)) return verifyArrayHir(hir,factsContext,callPublicationContext);
  if (callPublicationContext === undefined) return verifyWholeHir(hir, factsContext);
  return selectedModuleCalls(hir, factsContext, callPublicationContext).hir;
}

/** Analyze only a complete verified ordinary module HIR and an explicit publication.
 * @param {any} hir @param {any} context */
export function analyzeModuleCalls(hir, context) {
  return selectedModuleCalls(hir, undefined, context).analysis;
}

/** @param {any} hir @param {any} factsContext @param {any} context */
function selectedModuleCalls(hir, factsContext, context) {
  if (familyOf(hir) === 'tsfg.module-callable-hir-candidate') {
    if (factsContext !== undefined) callEffectsFailure();
    const analysis = analyzeModuleCallableCalls(hir, context);
    return { hir: verifyModuleCallableHir(hir), analysis };
  }
  checkCallEffectsInputs(hir, context);
  if (factsContext !== undefined || hir?.modules === undefined || hir?.format !== undefined)
    callEffectsFailure();
  // The existing complete validator remains the only HIR validator. Selected
  // analysis supplies its own final kernel policy after checking the fixed table.
  const checked = verifyWholeHir(hir, undefined, true);
  const analysis = analyzeVerifiedModuleCalls(checked, context);
  return { hir: checked, analysis };
}

/** @param {any} hir @param {any} [factsContext] @param {boolean} [selectedCalls] */
function verifyWholeHir(hir, factsContext = undefined, selectedCalls = false) {
  // An explicit facts context owns selection and must reject before any HIR inspection.
  if (isArrayFactsContext(factsContext)) return verifyArrayHir(hir, factsContext);
  if (factsContext !== undefined) return verifyStringHir(hir, factsContext);
  if (familyOf(hir) === 'tsfg.module-callable-hir-candidate') return verifyModuleCallableHir(hir);
  if (hir?.format?.family === "tsfg.exception-hir-candidate") return verifyExceptionHir(hir);
  if (hir?.format?.family === 'tsfg.nullable-hir-candidate') return verifyNullableHir(hir);
  if (hir?.format?.family === 'tsfg.closure-hir-candidate') return verifyClosureHir(hir);
  const fail = () => { throw new TypeError("r03-hir-invalid: owned HIR identity, type, source or structure differs"); };
  const moduleMode=hir?.modules!==undefined;
  if (!exactKeys(hir, ["contractVersion", "schemaHash", "inputIdentity", "source", "target", "functions",...(hir?.inputScope !== undefined ? ["inputScope"] : []),...(moduleMode?['sources','modules','globals','hostImports','closure']:[])])
      || hir.contractVersion !== contract()?.semver || hir.schemaHash !== contract()?.schemaHash
      || hir.inputScope !== undefined && (!admittedInputScope(hir.inputScope,hir.inputIdentity)
        || hir.inputScope.rootFile !== hir.source?.path || hir.inputScope.files.find(file=>file.path===hir.source.path)?.content !== hir.source.content)
      || !hash(hir.inputIdentity) || canonical(hir.target) !== canonical(bytecodeSchema.target)
      || !exactKeys(hir.source, ["path", "content", "hash"])
      || !validText(hir.source.path) || !hir.source.path.startsWith("/")
      || !hir.source.path.endsWith(".ts") || hir.source.path.endsWith(".d.ts")
      || /[\\:]/.test(hir.source.path)
      || hir.source.path.slice(1).split("/").some(part => !part || part === "." || part === "..")
      || typeof hir.source.content !== "string" || hir.source.content.length > 0xffffffff
      || !hir.source.content.isWellFormed()
      || hir.source.hash !== sha256(hir.source.content)
      || !Array.isArray(hir.functions) || hir.functions.length < 1 || hir.functions.length > 256) fail();
  const moduleFacts=moduleMode?verifyModuleHir(hir,fail):undefined;
  const functions = new Map(), functionNames = new Set();
  const previousFunctionEnd = new Map();
  for (const fn of hir.functions) {
    const sourcePath=moduleMode?fn.sourcePath:hir.source.path,source=moduleFacts?.sources.get(sourcePath)??hir.source;
    const name=`${sourcePath}\0${fn?.kind??'source'}\0${fn?.name}`;
    if (!validText(fn?.name) || functions.has(fn?.id) || functionNames.has(name)
        || fn.kind!=='module-initialization' && !range(fn.range, { start: previousFunctionEnd.get(sourcePath)??0, end: source.content.length })) fail();
    if(fn.kind!=='module-initialization')previousFunctionEnd.set(sourcePath,fn.range.end);
    functions.set(fn.id, fn); functionNames.add(name);
  }
  const parameterTypesByFunction = new Map();
  for (const fn of hir.functions) {
  if (!Array.isArray(fn.parameters)) fail();
  if (fn.parameterInitializers !== undefined && (!Array.isArray(fn.parameterInitializers)
      || fn.parameterInitializers.length !== fn.parameters.length)) fail();
  const parameterNames = fn.parameters.map(parameter => Object.entries(types).find(([,id]) => id === parameter?.type)?.[0]);
  const sourcePath=moduleMode?fn.sourcePath:hir.source.path,source=moduleFacts?.sources.get(sourcePath)??hir.source;
  if (!exactKeys(fn, ["id", "name", "signatureHash", "returnType", "parameters", "range", "body",...(fn.parameterInitializers !== undefined ? ["parameterInitializers"] : []),...(moduleMode?['sourcePath','kind']:[])])
      || !validText(fn.name) || !Object.hasOwn(types, fn.returnType?.name)
      || fn.id !== (fn.kind==='module-initialization'?initializerIdentity(sourcePath,source.hash):presenceIdentity(sourcePath, fn.name, fn.returnType.name, fn.parameters))
      || fn.signatureHash !== presenceSignature(fn.returnType.name, fn.parameters)
      || canonical(fn.returnType) !== canonical({ kind: "scalar", name: fn.returnType.name, id: types[fn.returnType.name] })
      || !Array.isArray(fn.parameters) || fn.parameters.length > 64 || parameterNames.some(name => !name)
      || fn.kind!=='module-initialization' && !range(fn.range, { start: 0, end: source.content.length })
      || !Array.isArray(fn.body) || fn.kind!=='module-initialization' && fn.body.length < 1 || fn.body.length > 128) fail();
  parameterTypesByFunction.set(fn.id, parameterNames);
  }
  // The complete function table is bound before any body/default is checked.
  for(const fn of hir.functions)
    verifyScalarFunctionBody(hir,fn,functions,parameterTypesByFunction.get(fn.id),fail,moduleFacts);
  if (moduleMode && !selectedCalls) verifyKernelHostSemantics(hir);
  return own(selectedCalls ? JSON.parse(canonical(hir)) : hir);
}
