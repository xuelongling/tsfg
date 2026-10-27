// SPDX-License-Identifier: MIT
// The sole complete Source-to-owned transform. Verification reconstructs every
// node, including ordinary functions outside selected kernel reachability.
import {commonOwnedHostImports,commonHostContext} from './common-program-hosts.mjs';
import {commonEnvironments} from './common-program-environments.mjs';
import {isProxy} from 'node:util/types';
import {copyGenericJsonBytes} from './generic-json.mjs';
import {readCommonProgramFacts,verifyCommonProgramFacts,writeCommonProgramFacts} from './common-program-facts.mjs';
import {commonSemanticIdentities,commonFieldId,commonIdentity,commonDeclKey} from './common-program-identities.mjs';
import {commonHirFormat,commonJsonPolicy,commonBudget,commonMeter,commonCheck as check,commonSame as same,
  commonJson,canonical,sha256,own} from './common-program-common.mjs';

export function isCommonProgramContext(value) {
  if(!value||typeof value!=='object'||isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  return Object.getOwnPropertyDescriptor(value,'family')?.value==='tsfg.common-program-context-candidate';
}
export function commonProgramContext(value) {
  check(isCommonProgramContext(value),'context');const fields=Object.getOwnPropertyDescriptors(value),keys=['family','version','factsBytes','expectedPackageId'];
  check(Reflect.ownKeys(value).length===keys.length&&keys.every(key=>fields[key]?.enumerable&&Object.hasOwn(fields[key],'value')),'context');
  check(fields.version.value===2,'context');const bytes=copyGenericJsonBytes(fields.factsBytes.value,commonJsonPolicy),facts=readCommonProgramFacts(bytes);
  check(facts.packageId===fields.expectedPackageId.value,'context');return {bytes,facts};
}

export function projectCommonProgram(facts,hostContext=null) {
  const snapshot=verifyCommonProgramFacts(facts),p=snapshot.payload,spend=commonMeter();
  const ids=commonSemanticIdentities(p,spend),fields=new Map(),constructionIds=new Map();
  for(const row of p.types){spend();if(row.fields)for(const [index,field]of row.fields.entries())fields.set(field.id,commonFieldId(ids.typeIds.get(row.id),field.name,index));
    if(row.construction)constructionIds.set(row.construction.id,commonIdentity('construction',{type:ids.typeIds.get(row.id)}));}
  const type=id=>{check(ids.typeIds.has(id),'type');return ids.typeIds.get(id);};
  const hostImports=commonOwnedHostImports(p,type,spend),hosts=new Map(hostImports.map(row=>[row.sourceBinding,row]));
  const ownedHostContext=commonHostContext(hostContext,hostImports,spend);
  const modulePaths=new Set(p.modules.map(row=>row.sourcePath));
  const target=id=>hosts.get(id)?.id??ids.functionIds.get(id)??ids.globals.get(id)??ids.typeIds.get(id)??(modulePaths.has(id)?ids.moduleId(id):undefined);
  const binding=row=>({id:row.id,sourceBinding:row.id,name:row.name,kind:row.kind,type:type(row.declaredType),writable:row.writable,lexicalOwner:row.lexicalOwner===null?null:ids.functionIds.get(row.lexicalOwner),
    range:{...row.declarationRange},nameRange:{...row.nameRange},annotationRange:structuredClone(row.annotationRange),elementAnnotationRange:structuredClone(row.elementAnnotationRange)});
  function expression(value) {
    spend();const result={kind:value.kind,type:type(value.flowType??value.type),declaredType:type(value.type),range:{...value.range}};
    for(const key of ['token','decimal','bits','codeUnits','binding','allocationSite','operator','prefix'])if(Object.hasOwn(value,key))result[key]=structuredClone(value[key]);
    if(value.functionId)result.functionId=ids.functionIds.get(value.functionId);
    if(value.binding&&ids.globals.has(value.binding)){result.global=ids.globals.get(value.binding);result.kind=value.kind==='bindingReference'?'globalReference':'globalTarget';}
    if(value.property)result.property=fields.get(value.property)??value.property;
    for(const key of ['operatorRange','annotationRange','calleeRange','nameRange'])if(value[key])result[key]={...value[key]};
    for(const key of ['receiver','index','expression','value','left','right','target'])if(value[key])result[key]=expression(value[key]);
    for(const key of ['elements','arguments'])if(value[key])result[key]=value[key].map(expression);
    if(value.signature){result.signature={parameters:value.signature.parameters.map(type),returnType:type(value.signature.returnType)};result.sourceSignature=structuredClone(value.signature);}
    if(value.callee) {
      result.callee=value.callee===p.readSpanIntrinsic.id?'intrinsic:readSpan':target(value.callee);check(result.callee,'identity');
      result.signature={parameters:value.signature.parameters.map(type),returnType:type(value.signature.returnType)};
      result.sourceSignature=structuredClone(value.signature);
      if(ids.signatures.has(value.callee))result.signatureHash=ids.signatures.get(value.callee);
      if(hosts.has(value.callee))result.signatureHash=hosts.get(value.callee).signatureHash;
      if(['new','superConstruct'].includes(value.kind))result.construction=constructionIds.get(ids.types.get(value.callee)?.construction.id);
    }
    if(value.compatibilityRoots)result.compatibilityRoots=value.compatibilityRoots.map(row=>({sourceType:type(row.sourceType),targetType:type(row.targetType)}));
    return result;
  }
  function statements(rows) {return rows.map(row=>{
    spend();const result={kind:row.kind,range:{...row.range}};
    if(row.functionId)result.functionId=ids.functionIds.get(row.functionId);
    if(row.binding){result.binding=row.binding;if(ids.globals.has(row.binding))result.global=ids.globals.get(row.binding);}
    for(const key of ['value','initializer','condition'])if(row[key])result[key]=expression(row[key]);
    for(const key of ['then','else','body'])if(row[key])result[key]=statements(row[key]);
    if(row.tryBlock)result.tryBlock={range:{...row.tryBlock.range},body:statements(row.tryBlock.body)};
    if(row.catchClause)result.catchClause={range:{...row.catchClause.range},declarationRange:structuredClone(row.catchClause.declarationRange),
      binding:row.catchClause.binding?binding(row.catchClause.binding):null,
      block:{range:{...row.catchClause.block.range},body:statements(row.catchClause.block.body)}};
    if(row.finallyBlock)result.finallyBlock={range:{...row.finallyBlock.range},body:statements(row.finallyBlock.body)};
    return result;
  });}
  const functions=[...ids.functions.values()].map(fn=>({id:ids.functionIds.get(fn.id),declKey:ids.declKeys.get(fn.id),sourceBinding:fn.id,
    sourcePath:fn.sourcePath,name:fn.name,kind:fn.ownerType?'construction-body'===fn.name?'construction-body':ids.types.get(fn.ownerType).constructor?.id===fn.id?'construction-body':'method':'source',
    lexicalParent:fn.lexicalParent===null?null:ids.functionIds.get(fn.lexicalParent),declarationScope:{...fn.declarationScope},captures:structuredClone(fn.captures),
    access:fn.access,signatureHash:ids.signatures.get(fn.id),returnType:type(fn.returnType),
    parameters:fn.parameters.map(binding),bindings:fn.bindings.map(binding),body:statements(fn.body),range:{...fn.declarationRange},nameRange:{...fn.nameRange},
    returnAnnotationRange:structuredClone(fn.returnAnnotationRange),...(fn.ownerType?{ownerType:type(fn.ownerType),receiverBinding:'this@'+fn.id}:{}),
    ...(fn.overrideTarget?{overrideTarget:ids.functionIds.get(fn.overrideTarget)}:{})})).sort((a,b)=>a.id<b.id?-1:1);
  const types=p.types.map(row=>{
    spend();const result={id:type(row.id),sourceType:row.id,kind:row.kind,name:row.name??(['value','reference'].includes(row.kind)?row.nominalKey.declarationPath.at(-1):row.kind),
      semanticLabel:ids.labels.get(row.id),semanticShape:ids.shapes.get(row.id)};
    for(const key of ['nominalKey','runtimeKey','markerOrigin'])if(row[key])result[key]=structuredClone(row[key]);
    if(row.sourcePath)result.origin={sourcePath:row.sourcePath,range:{...row.declarationRange},nameRange:{...row.nameRange}};
    if(row.kind==='function'){result.parameters=row.parameters.map(type);result.returnType=type(row.returnType);}
    if(row.base)result.base=type(row.base);if(row.elementType)result.elementType=type(row.elementType);
    if(row.members)result.members=row.members.map(type).sort();
    if(row.fields)result.fields=row.fields.map((field,index)=>({id:fields.get(field.id),sourceBinding:field.id,name:field.name,index,type:type(field.type),
      access:field.access,readonly:field.readonly,origin:{...field.origin},...(field.parameterBinding?{parameterBinding:field.parameterBinding}:{}),
      ...(field.initializer?{initializer:expression(field.initializer)}:{})}));
    if(row.methods)result.methods=row.methods.map(id=>ids.functionIds.get(id));
    if(row.construction)result.construction={id:constructionIds.get(row.construction.id),kind:row.construction.kind,access:row.construction.access,
      initializationPhase:row.construction.initializationPhase,initializationFields:row.construction.initializationFields.map(id=>fields.get(id)),
      parameters:row.construction.parameters.map(p=>({...structuredClone(p),type:type(p.type)})),
      signature:{parameters:row.construction.signature.parameters.map(type),returnType:type(row.id)},
      sourceSignature:structuredClone(row.construction.signature),origin:{...row.construction.origin},
      functionId:row.constructor?ids.functionIds.get(row.constructor.id):null,
      implicitForward:row.construction.implicitForward?structuredClone(row.construction.implicitForward):null};
    return result;
  }).sort((a,b)=>a.id<b.id?-1:1);
  const environment=commonEnvironments(functions,new Map(types.map(row=>[row.id,row])),spend);
  for(const fn of functions)Object.assign(fn,environment.metadata(fn));
  const globals=p.globals.map(row=>({id:ids.globals.get(row.binding.id),sourceBinding:row.binding.id,sourcePath:row.sourcePath,name:row.binding.name,
    declKey:commonDeclKey(row.sourcePath,[],'global',row.bindingKind==='default-export'?'$default':row.binding.name),type:type(row.binding.declaredType),
    bindingKind:row.bindingKind,writable:row.binding.writable,range:{...row.binding.declarationRange},nameRange:{...row.binding.nameRange}})).sort((a,b)=>a.id<b.id?-1:1);
  const modules=p.modules.map(row=>({id:ids.moduleId(row.sourcePath),sourcePath:row.sourcePath,external:row.external,
    dependencies:[...new Set(row.imports.map(edge=>edge.sourcePath))],initializer:ids.initializerId(row.sourcePath),
    imports:row.imports.map(edge=>({...structuredClone(edge),bindings:edge.bindings.map(alias=>({...structuredClone(alias),target:target(alias.target)}))})),
    exports:row.exports.map(e=>({...structuredClone(e),target:target(e.target)})),globals:row.globals.map(id=>ids.globals.get(id)),initialization:statements(row.initialization)}));
  const root=row=>({...structuredClone(row),target:row.kind==='module-initialization'?ids.initializerId(row.sourcePath):ids.functionIds.get(row.target)});
  const initialization=[],seen=new Set(),byPath=new Map(modules.map(row=>[row.sourcePath,row]));
  const enter=path=>{spend();if(seen.has(path))return;seen.add(path);const module=byPath.get(path);module.dependencies.forEach(enter);initialization.push(module.initializer);};
  modules.forEach(module=>enter(module.sourcePath));
  const closure={roots:p.closure.roots.map(root),requiredRoots:p.closure.requiredRoots.map(root),modules:modules.map(row=>row.id),
    functions:functions.map(row=>row.id),initialization};
  const hir={format:commonHirFormat,snapshot,inputIdentity:snapshot.packageId,rootFile:p.rootFile,
    hostImports,hostContext:ownedHostContext,sources:p.files.map(row=>({path:row.path,content:row.content,hash:'sha256:'+row.sha256})),target:structuredClone(p.target),types,functions,modules,globals,closure,environments:environment.environments};
  commonBudget(hir);return own(hir);
}

export function buildCommonProgramHir(input,context,hostContext=null) {
  const selected=commonProgramContext(context);check(writeCommonProgramFacts(input).equals(selected.bytes),'context');return projectCommonProgram(selected.facts,hostContext);
}
export function verifyCommonProgramHir(hir) {
  commonBudget(hir);check(same(hir?.format,commonHirFormat),'identity');const rebuilt=projectCommonProgram(hir.snapshot,hir.hostContext);
  check(same(hir,rebuilt),'reconstruct');return rebuilt;
}
export const printCommonProgramHir=hir=>canonical(verifyCommonProgramHir(hir))+'\n';
export const readCommonProgramHir=bytes=>verifyCommonProgramHir(commonJson(bytes));
