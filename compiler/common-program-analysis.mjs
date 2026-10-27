// SPDX-License-Identifier: MIT
// A caller supplies fixed Published bounds. Current bodies only discharge
// those bounds; they never replace a broad permission with a narrower one.
import {verifyCommonProgramHir} from './common-program-hir.mjs';
import {commonEffects,commonFacets} from './common-program-effects.mjs';
import {validateCommonCallableBounds} from './common-program-targets.mjs';
import {commonIdentity} from './common-program-identities.mjs';
import {commonProgramPhysical} from './common-program-physical.mjs';
import {commonSortedSubset,commonCollections} from './common-program-budget.mjs';
import {commonBudget,commonMeter,commonRecord as record,commonCheck as check,commonSame as same,commonJson,
  canonical,sha256,own} from './common-program-common.mjs';
const format=Object.freeze({family:'tsfg.program-publication-candidate',version:2});
const sorted=values=>values.every((value,index)=>index===0||values[index-1]<value);
const hash=value=>typeof value==='string'&&/^sha256:[0-9a-f]{64}$/.test(value);
const flags=['read','write','structural'];

export function commonProgramPublicationScope(hir,spend=commonMeter()) {
  const types=new Map(),seen=new Set(),pending=[],captureKeys=new Map();for(const env of hir.environments){spend(env.slots.length);for(const slot of env.slots)captureKeys.set(slot.binding,slot.key);}spend(hir.types.length+hir.globals.length);
  for(const row of hir.types){types.set(row.id,row);if(['value','reference'].includes(row.kind))pending.push(row.id);}
  for(const row of hir.globals)pending.push(row.type);
  for(const fn of hir.functions){spend(fn.parameters.length+2);pending.push(fn.returnType);if(fn.ownerType)pending.push(fn.ownerType);for(const p of fn.parameters)pending.push(p.type);}
  while(pending.length){spend();const id=pending.pop();if(seen.has(id))continue;seen.add(id);const row=types.get(id);check(row,'type');
    spend(2);if(row.base)pending.push(row.base);if(row.elementType)pending.push(row.elementType);
    if(row.kind==='function'){spend(row.parameters.length+1);pending.push(...row.parameters,row.returnType);}
    for(const child of row.members??[]){spend();pending.push(child);}for(const field of row.fields??[]){spend();pending.push(field.type);}}
  const binding=alias=>({kind:alias.kind,name:alias.name,imported:alias.imported,target:alias.target,targetSourcePath:alias.targetSourcePath});
  const root=({kind,sourcePath,name,target})=>({kind,sourcePath,name,target});
  const scopedTypes=[];spend(hir.types.length+hir.functions.length+hir.globals.length+hir.modules.length+hir.closure.roots.length+hir.closure.requiredRoots.length);
  for(const row of hir.types)if(seen.has(row.id))scopedTypes.push({id:row.id,label:row.semanticLabel,shape:row.semanticShape});
  return {profile:'common-program-fixed-v2',rootFile:hir.rootFile,
    types:scopedTypes,
    functions:hir.functions.map(fn=>{spend(fn.parameters.length+1);const parameterTypes=fn.ownerType?[fn.ownerType]:[];for(const p of fn.parameters)parameterTypes.push(p.type);
      spend(fn.captures.length);const captures=fn.captures.map(row=>captureKeys.get(row.binding));captures.sort((a,b)=>{spend();return a<b?-1:a>b?1:0;});
      return {captures,lexicalParent:fn.lexicalParent,lexicalEnvironment:fn.lexicalEnvironment,activationEnvironment:fn.activationEnvironment,functionId:fn.id,declKey:fn.declKey,kind:fn.kind,access:fn.access,signatureHash:fn.signatureHash,parameterTypes,returnType:fn.returnType};}),
    environments:hir.environments.map(env=>{spend(env.slots.length);return {id:env.id,owner:env.owner,parent:env.parent,slots:env.slots.map(({key,type,writable,kind})=>({key,type,writable,kind}))};}),
    globals:hir.globals.map(row=>({globalId:row.id,declKey:row.declKey,type:row.type,writable:row.writable})),
    modules:hir.modules.map(row=>{spend(row.imports.length+row.exports.length);return {id:row.id,sourcePath:row.sourcePath,external:row.external,dependencies:row.dependencies,initializer:row.initializer,
      imports:row.imports.map(edge=>{spend(edge.bindings.length);return {kind:edge.kind,specifier:edge.specifier,sourcePath:edge.sourcePath,bindings:edge.bindings.map(binding)};}),
      exports:row.exports.map(({name,kind,target,targetSourcePath})=>({name,kind,target,targetSourcePath})),globals:row.globals};}),
    roots:{roots:hir.closure.roots.map(root),requiredRoots:hir.closure.requiredRoots.map(root)}};
}
const contractDigest=body=>commonIdentity('published-contract',body);
const publicationDigest=(scopeDigest,contracts)=>commonIdentity('publication',{scopeDigest,contracts});
function scopeDigest(hir,spend){return commonIdentity('publication-scope',commonProgramPublicationScope(hir,spend));}

// Explicit first publication only. No consumer calls this to refresh supplied
// contracts when implementations change.
export function createCommonProgramPublication(input) {
  const hir=verifyCommonProgramHir(input),spend=commonMeter(),physical=commonProgramPhysical(hir),effects=commonEffects(hir,spend,physical),derived=effects.derived();
  spend(hir.functions.length);
  const contracts=hir.functions.map(fn=>{const body={functionId:fn.id,signatureHash:fn.signatureHash,upper:derived.get(fn.id),callables:physical.model.callables.contracts.get(fn.id)};return {...body,digest:contractDigest(body)};});
  const scope=scopeDigest(hir,spend);return own({format,mode:'fixed',scopeDigest:scope,expectedDigest:publicationDigest(scope,contracts),contracts});
}

function prepare(input,publication) {
  commonBudget(publication);const hir=verifyCommonProgramHir(input),spend=commonMeter();
  record(publication,['format','mode','scopeDigest','expectedDigest','contracts']);
  check(same(publication.format,format)&&publication.mode==='fixed'&&hash(publication.scopeDigest)&&hash(publication.expectedDigest),'publication');
  check(Array.isArray(publication.contracts)&&publication.contracts.length===hir.functions.length,'publication');spend(publication.contracts.length);
  check(sorted(publication.contracts.map(row=>row.functionId)),'publication');
  spend(hir.globals.length+hir.types.length);const records=new Map(),globals=new Map(hir.globals.map(row=>[row.id,row])),types=new Map(hir.types.map(row=>[row.id,row])),slotByKey=new Map();
  spend(hir.environments.length);for(const env of hir.environments){spend(env.slots.length);for(const slot of env.slots)slotByKey.set(slot.key,slot);}
  for(const [i,row]of publication.contracts.entries()) {
    spend();record(row,['functionId','signatureHash','upper','callables','digest']);const fn=hir.functions[i];
    check(row.functionId===fn.id&&row.signatureHash===fn.signatureHash,'publication-identity');record(row.upper,['globals','parameters','facets','captures']);
    record(row.upper.globals,['reads','writes']);record(row.upper.facets,commonFacets);
    check(commonFacets.every(flag=>typeof row.upper.facets[flag]==='boolean'),'publication');
    for(const key of ['reads','writes']){const set=row.upper.globals[key];check(Array.isArray(set)&&set.length<=4096,'publication');spend(set.length);
      check(sorted(set),'publication');
      check(set.every(id=>globals.has(id)&&(key!=='writes'||globals.get(id).writable)),'publication-identity');}
    const parameters=[...(fn.ownerType?[{type:fn.ownerType}]:[]),...fn.parameters];check(Array.isArray(row.upper.parameters)&&row.upper.parameters.length===parameters.length,'publication');
    for(const [index,p]of row.upper.parameters.entries()){spend();record(p,['index',...flags]);check(p.index===index&&flags.every(flag=>typeof p[flag]==='boolean'),'publication');
      const type=types.get(parameters[index].type);if(type.kind==='readSpan')check(!p.write&&!p.structural,'publication');}
    validateCommonCallableBounds(hir,fn,row.callables,spend);
    check(Array.isArray(row.upper.captures),'publication');let previous;
    for(const c of row.upper.captures){spend();record(c,['slot',...flags]);const slot=slotByKey.get(c.slot);
      // Binding assignments are checked at Source/HIR. This upper also covers
      // writes through an Array held by an immutable lexical binding.
      const array=slot&&types.get(slot.type)?.kind==='array';
      check(slot&&(!previous||previous<c.slot)&&flags.every(flag=>typeof c[flag]==='boolean')&&(!c.write||slot.writable||array),'publication');previous=c.slot;}
    const {digest,...body}=row;check(digest===contractDigest(body),'publication-identity');records.set(row.functionId,row);
  }
  const scope=scopeDigest(hir,spend);check(publication.scopeDigest===scope&&publication.expectedDigest===publicationDigest(scope,publication.contracts),'publication-identity');
  const physical=commonProgramPhysical(hir,records),effects=commonEffects(hir,spend,physical);return {hir,spend,effects,records,scope};
}
function covers(upper,body,spend) {
  spend(commonFacets.length+body.parameters.length*flags.length);
  spend(upper.captures.length+body.captures.length*flags.length);const captures=new Map(upper.captures.map(row=>[row.slot,row]));
  return body.captures.every(row=>captures.has(row.slot)&&flags.every(flag=>!row[flag]||captures.get(row.slot)[flag]))&&commonSortedSubset(body.globals.reads,upper.globals.reads,spend)&&commonSortedSubset(body.globals.writes,upper.globals.writes,spend)
    &&commonFacets.every(flag=>!body.facets[flag]||upper.facets[flag])
    &&body.parameters.every((row,index)=>flags.every(flag=>!row[flag]||upper.parameters[index][flag]));
}
export function analyzeCommonProgram(input,publication) {
  const prepared=prepare(input,publication),{hir,effects,spend,records}=prepared,derived=effects.derived();
  const collections=commonCollections(spend),dependencies=calls=>{spend(calls.length);const selected=collections.sorted(collections.set(calls.map(call=>call.target)));
    spend(selected.length);return selected.map(functionId=>({functionId,digest:records.get(functionId).digest}));};
  const uppers=collections.map(records,row=>row.upper),functions=[];
  for(const fn of hir.functions) {
    spend();const current=effects.derive(fn,uppers),record=records.get(fn.id);
    check(covers(record.upper,current.upper,spend),'contract','current implementation exceeds fixed Published upper',
      {functionId:fn.id,primary:{sourceId:fn.sourcePath,...fn.range}});
    functions.push({functionId:fn.id,derived:derived.get(fn.id),effective:current.upper,dependencies:dependencies(current.calls)});
  }
  spend(hir.modules.length);const initializers=hir.modules.map(module=>{
    const fn={id:module.initializer,sourcePath:module.sourcePath,returnType:'void',parameters:[],bindings:[],body:module.initialization};
    const current=effects.derive(fn,uppers);return {functionId:module.initializer,effective:current.upper,dependencies:dependencies(current.calls)};
  });
  const report={inputIdentity:hir.inputIdentity,hirDigest:sha256(canonical(hir)+'\n'),scopeDigest:prepared.scope,publishedDigest:publication.expectedDigest,
    contracts:publication.contracts,functions,initializers,initializationOrder:hir.closure.initialization};commonBudget(report);return own(report);
}

export function verifyCommonKernelGroup(input,publication,request) {
  const spend=commonMeter();commonBudget(request);record(request,['targets']);check(Array.isArray(request.targets)&&request.targets.length>=2&&request.targets.length<=32,'kernel');
  spend(request.targets.length);check(request.targets.every(hash)&&sorted(request.targets),'kernel');
  const analysis=analyzeCommonProgram(input,publication),hir=verifyCommonProgramHir(input);
  const roots=new Set();spend(hir.closure.roots.length);for(const root of hir.closure.roots)if(root.kind==='kernel')roots.add(root.target);
  spend(request.targets.length);check(request.targets.every(id=>roots.has(id)),'kernel-identity');
  spend(analysis.contracts.length+hir.functions.length);
  const contracts=new Map(analysis.contracts.map(row=>[row.functionId,row])),functions=new Map(hir.functions.map(fn=>[fn.id,fn]));
  const accesses=request.targets.map(functionId=>{spend();const row=contracts.get(functionId),fn=functions.get(functionId);
    check(!commonFacets.some(flag=>row.upper.facets[flag])&&!row.upper.captures.some(c=>c.read||c.write||c.structural),'kernel-capability','fixed Published kernel capability is not proved',
      {functionId,primary:{sourceId:fn.sourcePath,...fn.range},facets:commonFacets.filter(flag=>row.upper.facets[flag])});
    return {functionId,publishedContractDigest:row.digest,reads:row.upper.globals.reads,writes:row.upper.globals.writes,parameters:row.upper.parameters,captures:row.upper.captures,facets:row.upper.facets};});
  const pairs=[],intersection=(a,b)=>{const out=[];let i=0,j=0;while(i<a.length&&j<b.length){spend();if(a[i]<b[j])i++;else if(a[i]>b[j])j++;else{out.push(a[i]);i++;j++;}}return out;};
  for(let i=0;i<accesses.length;i++)for(let j=i+1;j<accesses.length;j++) {
    spend();const a=accesses[i],b=accesses[j],pair={left:a.functionId,right:b.functionId,readRead:intersection(a.reads,b.reads),
      writeWrite:intersection(a.writes,b.writes),writeRead:intersection(a.writes,b.reads),readWrite:intersection(a.reads,b.writes)};
    check(!pair.writeWrite.length&&!pair.writeRead.length&&!pair.readWrite.length,'kernel-conflict','fixed Published global bounds conflict',
      {primary:{sourceId:functions.get(a.functionId).sourcePath,...functions.get(a.functionId).range},related:[{sourceId:functions.get(b.functionId).sourcePath,...functions.get(b.functionId).range}],conflicts:pair});pairs.push(pair);
  }
  const proof={inputIdentity:analysis.inputIdentity,hirDigest:analysis.hirDigest,scopeDigest:analysis.scopeDigest,publishedDigest:analysis.publishedDigest,targets:request.targets,accesses,pairs};
  commonBudget(proof);return own(proof);
}
export function verifyCommonKernelProof(proof,hir,publication,request){commonBudget(proof);const rebuilt=verifyCommonKernelGroup(hir,publication,request);check(same(proof,rebuilt),'kernel-proof');return rebuilt;}
export const printCommonKernelProof=(proof,hir,publication,request)=>canonical(verifyCommonKernelProof(proof,hir,publication,request))+'\n';
export const readCommonKernelProof=(bytes,hir,publication,request)=>verifyCommonKernelProof(commonJson(bytes),hir,publication,request);
