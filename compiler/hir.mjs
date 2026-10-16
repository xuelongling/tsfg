// SPDX-License-Identifier: MIT
import { validateFrontendSnapshot, resolveType, resolveSymbol } from './frontend.mjs';
import { validateModuleFacts, sourceTrivia } from './module-facts.mjs';
import { verifyHir, KernelHostSemanticError, scalarOperations as operations } from './module-hir.mjs';
import { moduleIdentity, globalIdentity, defaultBindingIdentity, compilationClosure, initializerIdentity, hostIdentity } from './modules.mjs';
import { canonical, functionIdentity, signatureHash, i32TypeId, scalarTypeIds, sha256 } from './identity.mjs';
import registry from '../contracts/registry.json' with {type:'json'};
import bytecodeSchema from '../contracts/bytecode.schema.json' with {type:'json'};
import { floatNames } from './float.mjs';
import { emitScalarCore } from './scalar-core-emitter.mjs';

export { verifyHir };
const contract = () => registry['tsfg.hir'];
const types = scalarTypeIds;

export function buildHir(snapshot) {
  try { validateFrontendSnapshot(snapshot); }
  catch (error) { return { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message }] }; }
  const first = snapshot.functions[0], expression = first?.body?.find(item => item.expression)?.expression;
  const moduleFacts=snapshot.modules?validateModuleFacts(snapshot):undefined;
  if (!moduleFacts && snapshot.functions.length < 1 || snapshot.functions.length > 128 || snapshot.functions.some(fn => fn.parameters.length > 64
      || !Object.hasOwn(types, resolveType(snapshot, fn.returnTypeRef).scalar)
      || snapshot.capability !== "minimal-floats-v4" && (floatNames.includes(fn.returnType) || fn.parameters.some(p => floatNames.includes(p.type)))
      || fn.parameters.some(parameter => !types[parameter.type]) || fn.body.length < 1 || fn.body.length > 128)) {
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir",
      message: "current execution capability requires nominal integer/bool functions with direct calls, locals, structured control and returns",
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? first?.range ?? { start: 0, end: 0 }) } }] };
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
    id: functionIdentity(moduleFacts?fn.sourcePath:snapshot.source.path, fn.name, fn.returnType, fn.parameters.map(p => p.type)), name: fn.name,
    signatureHash: signatureHash(fn.returnType, fn.parameters.map(p => p.type)),
    returnType: { kind: "scalar", name: fn.returnType, id: types[fn.returnType] },
    parameters: fn.parameters.map((p,index) => ({id:`p${index}`,name:p.name,type:types[p.type],writable:true,range:p.range})),
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
    if (value.kind === "call" && parentRange && value.range.start < parentRange.start
        && sourceTrivia(source.content, value.range.start, parentRange.start).trim() === "") {
      projectedRange = { ...value.range, start: parentRange.start };
    }
    const common = { type, range: projectedRange };
    if (value.kind === "reference") {
      const symbol = resolveSymbol(snapshot, value.symbol), binding = bindings.get(symbol.id);
      const global=globalBySymbol.get(symbol.id);
      if(global)return {kind:'global',...common,global:global.id,name:value.name};
      if (!binding) throw new TypeError("local reference has no preceding owned declaration");
      return { kind: "reference", ...common, binding: binding.id };
    }
    if (value.kind === "call") {
      const symbol=resolveSymbol(snapshot,value.target),target = functions.get(symbol.id)??hostBySymbol.get(symbol.id);
      if (!target) throw new TypeError("call target is outside owned function closure");
      return {kind:hostBySymbol.has(symbol.id)?'host':"call",...common,target:target.id,signatureHash:target.signatureHash,
        ...(moduleFacts?{name:value.name}:{}),arguments:value.arguments.map(argument => project(argument, common.range))};
    }
    if (value.kind === "integer") return { kind: "constant", ...common, decimal: value.literal.decimal, token: value.literal.token };
    if (value.kind === "floating") return { kind: "floating", ...common, bits: value.float.bits, token: value.float.token };
    if (value.kind === "boolean") return { kind: "boolean", ...common, value: value.boolean };
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
    if(item.kind==='expression')return {kind:'expression',range:item.range,value:project(item.expression,item.range)};
    if (item.kind === "variable") {
      const symbol = resolveSymbol(snapshot, item.symbol.ref), type = types[symbol.type];
      if (symbol.kind !== "local" || !type) throw new TypeError("unsupported local type");
      const initializer = item.initializer ? project(item.initializer, item.range) : null;
      const binding = { id: `l${bindings.size - fn.parameters.length}`, name: symbol.name, type, writable: symbol.writable, range: symbol.range };
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
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir", message: error.message,
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? fn.range) } }] };
  }
  projectedFunctions.push({...descriptor,body:projected});
  }
  const hir = {
    contractVersion: contract().semver, schemaHash: contract().schemaHash, inputIdentity: snapshot.inputIdentity,
    source: { ...snapshot.source, hash: sha256(snapshot.source.content) }, target: bytecodeSchema.target,
    functions: projectedFunctions,
  };
  if(moduleFacts) {
    const ownedId=id=>functions.get(id)?.id??globalBySymbol.get(id)?.id??hostBySymbol.get(id)?.id;
    hir.sources=[...moduleFacts.sources.values()].map(source=>({...source,hash:sha256(source.content)}));
    hir.globals=globals;hir.hostImports=hosts;
    hir.modules=snapshot.modules.map(module=>({id:moduleIdentity(module.sourcePath),sourcePath:module.sourcePath,
      dependencies:[...new Set(module.imports.map(imp=>imp.sourcePath))],initializer:initializerIdentity(module.sourcePath,sha256(moduleFacts.sources.get(module.sourcePath).content)),
      exports:module.exports.map(binding=>({name:binding.name,target:ownedId(binding.target)})),
      bindings:[...moduleFacts.views.get(module.sourcePath)].map(([name,id])=>({name,target:ownedId(id)}))}));
    try{hir.closure=compilationClosure({modules:hir.modules,functions:projectedFunctions,globals,configuration:snapshot.compilationClosure});}
    catch(error){return {status:'error',diagnostics:[{code:error.code??'r03-d-closure-dependency',ruleId:error.ruleId??'r01-compilation-closure',phase:'hir',message:error.message,primary:error.primary}]};}
  }
  try { return { status: "ok", hir: verifyHir(hir) }; }
  catch (error) {
    if (error instanceof KernelHostSemanticError) return { status: "error", diagnostics: [{
      code: error.code, ruleId: error.ruleId, phase: error.phase, message: error.message, primary: error.primary,
    }] };
    return { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message,
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? first?.range ?? {start:0,end:0}) } }] };
  }
}
export const printHir = hir => `${canonical(verifyHir(hir))}\n`;
export function readHir(bytes) {
  let text, value;
  try {
    // Preserve a leading BOM so JSON rejects its noncanonical wire bytes.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError("r03-hir-invalid: HIR must contain valid UTF-8 JSON", { cause: error });
  }
  const hir = verifyHir(value);
  if (text !== printHir(hir)) throw new TypeError("r03-hir-canonical: HIR must use its canonical serialization");
  return hir;
}

export function lowerHir(hir) {
  const verified = verifyHir(hir), moduleMode = !!verified.modules;
  const sourceView = source => ({ path: source.path, hash: source.hash, length: source.content.length });
  return emitScalarCore({ exchange: { version: contract().semver, bytecodeSchema: registry['tsfg.bytecode'].schemaHash },
    inputIdentity: verified.inputIdentity, source: sourceView(verified.source), target: verified.target,
    functions: verified.functions.map(fn => ({ ...fn, symbol: moduleMode ? 'f' + fn.id.slice(7) : fn.name })),
    ...(moduleMode ? { moduleState: { sources: verified.sources.map(sourceView), modules: verified.modules,
      globals: verified.globals, hostImports: verified.hostImports, closure: verified.closure } } : {}) });
}
