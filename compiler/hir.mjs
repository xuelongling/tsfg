import { familyOf } from './module-callable-common.mjs';
import { buildModuleCallableHir } from './module-callable-hir.mjs';
import { emitModuleCallableCore } from './module-callable-core.mjs';
export { verifyModuleCalls, printModuleCalls, readModuleCalls } from './module-callable-publication.mjs';
// SPDX-License-Identifier: MIT
import { buildExceptionHir } from "./exception-hir.mjs";
import { buildStringHir } from './string-hir.mjs';
import { readStringHir } from './string-hir-model.mjs';
import { coreExchangeFormat } from './core-ssa-emitter.mjs';
import { emitExceptionCore } from "./exception-core-emitter.mjs";
import { readHirWire } from "./hir-wire.mjs";
import { failure as exceptionHirFailure } from "./exception-hir-common.mjs";
import { buildNullableHir } from "./nullable-hir.mjs";
import { emitNullableCore } from "./nullable-core-emitter.mjs";
import { validateFrontendSnapshot, resolveType, resolveSymbol } from './frontend.mjs';
import { validateModuleFacts, sourceTrivia } from './module-facts.mjs';
import { verifyHir, KernelHostSemanticError, scalarOperations as operations } from './module-hir.mjs';
import { moduleIdentity, globalIdentity, defaultBindingIdentity, compilationClosure, initializerIdentity, hostIdentity } from './modules.mjs';
import { canonical, functionIdentity, signatureHash, i32TypeId, scalarTypeIds, sha256 } from './identity.mjs';
import registry from '../contracts/registry.json' with {type:'json'};
import bytecodeSchema from '../contracts/bytecode.schema.json' with {type:'json'};
import { presenceIdentity, presenceSignature } from "./presence.mjs";
import { floatNames } from './float.mjs';
import { emitScalarCore } from './scalar-core-emitter.mjs';
import { emitReferenceCore } from './reference-core-emitter.mjs';
import { emitStringCore } from './string-core-emitter.mjs';
import { emitFormalStringCore } from './string-formal-emitter.mjs';
import { buildArrayHir, readArrayHir } from './array-hir.mjs';
import { emitArrayCore } from './array-core-emitter.mjs';
export { analyzeArrayCalls, verifyArrayCalls, printArrayCalls, readArrayCalls } from './array-call-publication.mjs';
import { isArrayFactsContext } from './array-hir-model.mjs';

import { buildClosureHir } from "./closure-hir.mjs";
export { verifyHir };
export { analyzeModuleCalls } from './module-hir.mjs';
export { verifyKernelParallelGroup, verifyKernelParallelProof, printKernelParallelProof, readKernelParallelProof } from './kernel-access.mjs';
export { lowerKernelGlobalCore } from './kernel-core-emitter.mjs';
export { verifyArrayCallParallelGroup, verifyArrayParallelProof, printArrayParallelProof, readArrayParallelProof } from './array-parallel.mjs';
export { analyzeClosureCalls, verifyClosureCalls, printClosureCalls, readClosureCalls } from './closure-call-effects.mjs';
const contract = () => registry['tsfg.hir'];
const types = scalarTypeIds;

/** @param {any} snapshot @param {any} [factsContext] @param {any} [callPublicationContext] */
// Error casts describe omitted hir fields without adding runtime keys or erasing family diagnostics.
export function buildHir(snapshot, factsContext = undefined, callPublicationContext = undefined) {
  if (isArrayFactsContext(factsContext)) return buildArrayHir(snapshot, factsContext, callPublicationContext);
  if (factsContext !== undefined) return buildStringHir(snapshot, factsContext);
  try {
    if (familyOf(snapshot) === 'tsfg.frontend-module-callable-candidate') return {status:'ok',hir:buildModuleCallableHir(snapshot)};
  } catch (error) { const result = {status:'error',diagnostics:[{code:error.code,ruleId:error.ruleId,phase:error.phase,message:error.message,...(error.primary?{primary:error.primary}:{})}]};
    return /** @type {typeof result & {status:"error",hir?:undefined}} */ (result); }
  try { validateFrontendSnapshot(snapshot); }
  catch (error) { const result = { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message }] };
    return /** @type {typeof result & {status:"error",hir?:undefined}} */ (result); }
  if (snapshot?.format?.family === "tsfg.frontend-nullable-candidate") {
    try { return { status: "ok", hir: buildNullableHir(snapshot) }; }
    catch (error) { const result = { status: "error", diagnostics: [{ code: error.code ?? "r03-nullable-hir", ruleId: error.ruleId ?? "r01-input-boundary", phase: "hir", message: error.message }] };
      return /** @type {typeof result & {status:"error",hir?:undefined}} */ (result); }
  }
  if (snapshot?.format?.family === "tsfg.frontend-closure-candidate") {
    try { return { status: "ok", hir: buildClosureHir(snapshot) }; }
    catch (error) { const result = { status: "error", diagnostics: [{ code: error.code ?? "r03-closure-hir", ruleId: error.ruleId ?? "r01-input-boundary", phase: "hir", message: error.message }] };
      return /** @type {typeof result & {status:"error",hir?:undefined}} */ (result); }
  }
  if (snapshot?.format?.family === "tsfg.frontend-exception-candidate") {
    try { return { status: "ok", hir: buildExceptionHir(snapshot) }; }
    catch (error) { const result = { status: "error", diagnostics: [{ code: error.code ?? "r03-exception-hir-schema",
      ruleId: error.ruleId ?? "r01-input-boundary", phase: "hir", message: error.message,
      ...(error.primary ? { primary: error.primary } : {}) }] };
      return /** @type {typeof result & {status:"error",hir?:undefined}} */ (result); }
  }
  const first = snapshot.functions[0], expression = first?.body?.find(item => item.expression)?.expression;
  const moduleFacts=snapshot.modules?validateModuleFacts(snapshot):undefined;
  if (!moduleFacts && snapshot.functions.length < 1 || snapshot.functions.length > 128 || snapshot.functions.some(fn => fn.parameters.length > 64
      || !Object.hasOwn(types, resolveType(snapshot, fn.returnTypeRef).scalar)
      || !["minimal-floats-v4", "minimal-conversions-v5"].includes(snapshot.capability) && (floatNames.includes(fn.returnType) || fn.parameters.some(p => floatNames.includes(p.type)))
      || fn.parameters.some(parameter => !types[parameter.type]) || fn.body.length < 1 || fn.body.length > 128)) {
    const result = { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir",
      message: "current execution capability requires nominal integer/bool functions with direct calls, locals, structured control and returns",
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? first?.range ?? { start: 0, end: 0 }) } }] };
      return /** @type {typeof result & {status:"error",hir?:undefined}} */ (result);
  }
  const globals=(snapshot.symbols.filter(symbol=>symbol.kind==='global')).map(symbol=>({id:symbol.bindingKind==='default-export-expression'
    ? defaultBindingIdentity(symbol.sourcePath,sha256(snapshot.sources.find(source=>source.path===symbol.sourcePath).content),symbol.type,symbol.range)
    : globalIdentity(symbol.sourcePath,symbol.name,symbol.type),
    sourcePath:symbol.sourcePath,name:symbol.name,bindingKind:symbol.bindingKind,type:types[symbol.type],writable:symbol.writable,range:symbol.range}));
  const globalBySymbol=new Map(snapshot.symbols.filter(symbol=>symbol.kind==='global').map((symbol,index)=>[symbol.id,globals[index]]));
  const hosts=(snapshot.hostImports??[]).map(host=>({id:hostIdentity(host.sourcePath,host.name),sourcePath:host.sourcePath,name:host.name,
    capabilityId:host.capabilityId,signatureHash:signatureHash(host.returnType,host.parameterTypes),parameterTypes:host.parameterTypes.map(type=>types[type]),returnType:types[host.returnType],range:host.range}));
  const hostBySymbol=new Map((snapshot.hostImports??[]).map((host,index)=>[host.symbol,hosts[index]]));
  const functions = new Map(snapshot.functions.map(fn => [fn.symbol.id, {
    id: presenceIdentity(moduleFacts?fn.sourcePath:snapshot.source.path, fn.name, fn.returnType, fn.parameters.map(p=>({...p,type:types[p.type]}))), name: fn.name,
    signatureHash: presenceSignature(fn.returnType, fn.parameters.map(p=>({...p,type:types[p.type]}))),
    returnType: { kind: "scalar", name: fn.returnType, id: types[fn.returnType] },
    parameters: fn.parameters.map((p,index) => ({id:`p${index}`,name:p.name,type:types[p.type],writable:true,range:p.range,...(p.presence ? {presence:structuredClone(p.presence)} : {})})),
    range: fn.range,
    ...(moduleFacts?{sourcePath:fn.sourcePath,kind:'source'}:{}),
  }]));
  const projectedFunctions = [];
  const initializers=(snapshot.modules??[]).map(module=>({sourcePath:module.sourcePath,name:'$moduleInit',kind:'module-initialization',parameters:[],body:module.initialization,
    range:{start:0,end:moduleFacts.sources.get(module.sourcePath).content.length}}));
  for (const fn of [...snapshot.functions,...initializers]) {
  const descriptor = fn.kind==='module-initialization'?{id:initializerIdentity(fn.sourcePath,sha256(moduleFacts.sources.get(fn.sourcePath).content)),name:'$moduleInit',kind:fn.kind,sourcePath:fn.sourcePath,
    signatureHash:signatureHash('i32',[]),returnType:{kind:'scalar',name:'i32',id:i32TypeId},parameters:[],range:fn.range}:functions.get(fn.symbol.id);
  const source=moduleFacts?.sources.get(fn.sourcePath)??snapshot.source;
  const bindings = new Map();
  fn.parameters.forEach((p,index) => bindings.set(p.id, descriptor.parameters[index]));
  const project = (value, parentRange) => {
    const type = types[resolveType(snapshot, value.typeRef).scalar];
    if (!type) throw new TypeError("unsupported expression type");
    let projectedRange = value.range;
    if (["call", "conversion"].includes(value.kind) && parentRange && value.range.start < parentRange.start
        && sourceTrivia(source.content, value.range.start, parentRange.start).trim() === "") {
      projectedRange = { ...value.range, start: parentRange.start };
    }
    const common = { type, range: projectedRange };
    if (value.kind === "reference") {
      const symbol = resolveSymbol(snapshot, value.symbol), binding = bindings.get(symbol.id);
      const global=globalBySymbol.get(symbol.id);
      if(global)return {kind:'global',...common,global:global.id,name:value.name};
      if (!binding) throw new TypeError("local reference has no preceding owned declaration");
      return { kind: "reference", ...common, binding: binding.id, ...(value.presenceFlow ? {presenceFlow:structuredClone(value.presenceFlow)} : {}) };
    }
    if (value.kind === "conversion") return { kind:"conversion", ...common, origin:structuredClone(value.conversion), operand:project(value.operand,common.range) };
    if (value.kind === "call") {
      const symbol=resolveSymbol(snapshot,value.target),target = functions.get(symbol.id)??hostBySymbol.get(symbol.id);
      if (!target) throw new TypeError("call target is outside owned function closure");
      return {kind:hostBySymbol.has(symbol.id)?'host':"call",...common,target:target.id,signatureHash:target.signatureHash,
        ...(moduleFacts?{name:value.name}:{}),arguments:value.arguments.map(argument => project(argument, common.range))};
    }
    if (value.kind === "integer") return { kind: "constant", ...common, decimal: value.literal.decimal, token: value.literal.token };
    if (value.kind === "floating") return { kind: "floating", ...common, bits: value.float.bits, token: value.float.token };
    if (value.kind === "boolean") return { kind: "boolean", ...common, value: value.boolean };
    if (value.kind === "absence") return {kind:"absence", ...common, absence:value.absence};
    if (value.kind === "write" || value.kind === "presenceTest") return {kind:value.kind,...common,operator:value.operator,left:project(value.left,common.range),right:project(value.right,common.range),...(value.presenceFlow ? {presenceFlow:structuredClone(value.presenceFlow)} : {})};
    if (value.kind === "update") return {kind:"update",...common,operator:value.operator,prefix:value.prefix,operand:project(value.operand,common.range)};
    if (value.kind === "group") return { kind: "group", ...common, operand: project(value.operand, common.range) };
    if (value.kind === "unary" && ["+", "-", "~", "!"].includes(value.operator))
      return { kind: "unary", ...common, operator: value.operator, operand: project(value.operand, common.range) };
    if (value.kind === "binary" && Object.hasOwn(operations, value.operator)
        || value.kind === "shortCircuit" && ["&&", "||"].includes(value.operator))
      return { kind: value.kind, ...common, operator: value.operator, left: project(value.left, common.range), right: project(value.right, common.range) };
    throw new TypeError("unsupported checked expression capability");
  };
  let projected;
  const statements = items => (items ?? []).map(item => {
    if(item.kind==='initialize') {
      const global=globalBySymbol.get(item.symbol.id);
      if(!global||fn.kind!=='module-initialization')throw new TypeError('invalid module initialization ownership');
      return {kind:'initialize',global:global.id,range:item.range,value:project(item.initializer,item.range)};
    }
    if(item.kind==='expression')return {kind:moduleFacts?'expression':'evaluate',range:item.range,value:project(item.expression,item.range)};
    if (item.kind === "variable") {
      const symbol = resolveSymbol(snapshot, item.symbol.ref), type = types[symbol.type];
      if (symbol.kind !== "local" || !type) throw new TypeError("unsupported local type");
      const initializer = item.initializer ? project(item.initializer, item.range) : null;
      const binding = { id: `l${bindings.size - fn.parameters.length}`, name: symbol.name, type, writable: symbol.writable, range: symbol.range, ...(symbol.presence ? {presence:structuredClone(symbol.presence)} : {}) };
      bindings.set(symbol.id, binding);
      return { kind: "local", range: item.range, binding, initializer };
    }
    if (item.kind === "assignment") return { kind: "assign", range: item.range, target: project(item.target, item.range), value: project(item.value, item.range) };
    if (item.kind === "block") return { kind: "block", range: item.range, body: statements(item.body) };
    if (item.kind === "while") return { kind: "while", range: item.range, condition: project(item.condition, item.range), body: statements(item.body) };
    if (item.kind === "if") return { kind: "if", range: item.range, condition: project(item.condition, item.range),
      thenBody: statements(item.thenBody), elseBody: statements(item.elseBody) };
    if (item.kind === "return") return { kind: "return", range: item.range, value: project(item.expression, item.range) };
    throw new TypeError("unsupported checked statement capability");
  });
  try { projected = statements(fn.body); } catch (error) {
    const result = { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir", message: error.message,
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? fn.range) } }] };
      return /** @type {typeof result & {status:"error",hir?:undefined}} */ (result);
  }
  projectedFunctions.push({...descriptor,body:projected, ...(!moduleFacts || fn.parameterInitializers !== undefined ? {parameterInitializers:(fn.parameterInitializers ?? fn.parameters.map(()=>null)).map(value=>value ? project(value,fn.range) : null)} : {})});
  }
  let moduleState = {};
  if(moduleFacts) {
    const ownedId=id=>functions.get(id)?.id??globalBySymbol.get(id)?.id??hostBySymbol.get(id)?.id;
    const sources=[...moduleFacts.sources.values()].map(source=>({...source,hash:sha256(source.content)}));
    const modules=snapshot.modules.map(module=>({id:moduleIdentity(module.sourcePath),sourcePath:module.sourcePath,external:module.external,
      imports:module.imports.map(({kind,specifier,sourcePath,range})=>({kind,specifier,sourcePath,range:{...range}})),
      dependencies:[...new Set(module.imports.map(imp=>imp.sourcePath))],initializer:initializerIdentity(module.sourcePath,sha256(moduleFacts.sources.get(module.sourcePath).content)),
      exports:module.exports.map(binding=>({name:binding.name,target:ownedId(binding.target)})),
      bindings:[...moduleFacts.views.get(module.sourcePath)].map(([name,id])=>({name,target:ownedId(id)}))}));
    try{moduleState={sources,globals,hostImports:hosts,modules,closure:compilationClosure({modules,functions:projectedFunctions,globals,configuration:snapshot.compilationClosure})};}
    catch(error){const result = {status:'error',diagnostics:[{code:error.code??'r03-d-closure-dependency',ruleId:error.ruleId??'r01-compilation-closure',phase:'hir',message:error.message,primary:error.primary}]};
      return /** @type {typeof result & {status:"error",hir?:undefined}} */ (result);}
  }
  const hir = {
    contractVersion: contract().semver, schemaHash: contract().schemaHash, inputIdentity: snapshot.inputIdentity,
    source: { ...snapshot.source, hash: sha256(snapshot.source.content) }, target: bytecodeSchema.target,
    functions: projectedFunctions,
    ...(moduleFacts || snapshot.capability === "minimal-conversions-v5" ? { inputScope: structuredClone(snapshot.identityInput) } : {}),
    ...moduleState,
  };
  try { return { status: "ok", hir: verifyHir(hir) }; }
  catch (error) {
    if (error instanceof KernelHostSemanticError) {
      const result = { status: "error", diagnostics: [{
      code: error.code, ruleId: error.ruleId, phase: error.phase, message: error.message, primary: error.primary,
    }] };
        return /** @type {typeof result & {status:"error",hir?:undefined}} */ (result);
    }
    const result = { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message,
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? first?.range ?? {start:0,end:0}) } }] };
      return /** @type {typeof result & {status:"error",hir?:undefined}} */ (result);
  }
}
/** @param {any} hir @param {any} [factsContext] @param {any} [callPublicationContext] */
export const printHir = (hir, factsContext = undefined, callPublicationContext = undefined) => `${canonical(verifyHir(hir, factsContext, callPublicationContext))}\n`;
/** @param {Uint8Array} bytes @param {any} [factsContext] @param {any} [callPublicationContext] */
export function readHir(bytes, factsContext = undefined, callPublicationContext = undefined) {
  if (isArrayFactsContext(factsContext)) return readArrayHir(bytes, factsContext, callPublicationContext);
  if (factsContext !== undefined) return readStringHir(bytes, factsContext);
  const { text, value } = readHirWire(bytes);
  const hir = verifyHir(value, undefined, callPublicationContext);
  if (text !== printHir(hir, undefined, callPublicationContext)) {
    if (hir?.format?.family === "tsfg.exception-hir-candidate")
      exceptionHirFailure("canonical", "HIR must use its canonical serialization");
    throw new TypeError("r03-hir-canonical: HIR must use its canonical serialization");
  }
  return hir;
}

/** @param {any} hir @param {any} [factsContext] @param {any} [callPublicationContext] */
export function lowerHir(hir, factsContext = undefined, callPublicationContext = undefined) {
  if (isArrayFactsContext(factsContext)) return emitArrayCore(hir, factsContext, callPublicationContext);
  if (factsContext !== undefined) return emitStringCore(hir, factsContext);
  if (familyOf(hir) === 'tsfg.module-callable-hir-candidate') {
    return emitModuleCallableCore(hir);
  }
  if (hir?.format?.family === "tsfg.exception-hir-candidate") return emitExceptionCore(hir);
  if (hir?.format?.family === "tsfg.nullable-hir-candidate") return emitNullableCore(hir);
  if (hir?.format?.family === "tsfg.closure-hir-candidate") {
    verifyHir(hir);
    throw Object.assign(new TypeError("r03-d-capability: closure Core lowering is not implemented"),
      { code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "lowering" });
  }
  if (hir?.format?.family === 'tsfg.reference-hir-candidate') return emitReferenceCore(hir);
  const verified = verifyHir(hir), moduleMode = !!verified.modules;
  const sourceView = source => ({ path: source.path, hash: source.hash, length: source.content.length });
  return emitScalarCore({ exchange: coreExchangeFormat,
    inputIdentity: verified.inputIdentity, source: sourceView(verified.source), target: verified.target,
    functions: verified.functions.map(fn => ({ ...fn, symbol: moduleMode ? 'f' + fn.id.slice(7) : fn.name })),
    ...(moduleMode ? { moduleState: { sources: verified.sources.map(sourceView), modules: verified.modules,
      globals: verified.globals, hostImports: verified.hostImports, closure: verified.closure } } : {}) });
}

/** The ordinary formal Core/R04 route. Private representations keep lowerHir's
 * explicit candidate route; String HIR is revalidated and compiled directly.
 * @param {any} hir @param {any} [factsContext] */
export function lowerFormalHir(hir, factsContext = undefined) {
  if (factsContext !== undefined && !isArrayFactsContext(factsContext))
    return emitFormalStringCore(hir, factsContext);
  return lowerHir(hir, factsContext);
}
