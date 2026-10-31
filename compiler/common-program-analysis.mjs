// SPDX-License-Identifier: MIT
// A caller supplies fixed Published bounds. Current bodies only discharge
// those bounds; they never replace a broad permission with a narrower one.
import {commonIdentity} from './common-program-identities.mjs';
import {verifyCommonProgramHir} from './common-program-hir.mjs';
import {commonEffects,commonFacets,commonEffectsCover as covers} from './common-program-effects.mjs';
import {validateCommonCallableBounds} from './common-program-targets.mjs';
import {commonHostResources} from './common-program-hosts.mjs';
import {commonKernelCallChain} from './common-program-diagnostics.mjs';
import {commonProgramPhysical} from './common-program-physical.mjs';
import {commonFixedPublicationScope,commonVerifyPublicationScope} from './common-program-publication-scope.mjs';
import {commonReturnOriginSource,commonReturnOriginAvailability,commonJoinReturnOriginEffects,commonReturnOriginScalarProof} from './common-program-return-origin-source.mjs';
import {commonCollections} from './common-program-budget.mjs';
import {commonFixedStorageProjection} from './common-program-fixed-storage.mjs';
import {commonBudget,commonMeter,commonRecord as record,commonCheck as check,commonSame as same,commonJson,
  canonical,sha256,own} from './common-program-common.mjs';
const format=Object.freeze({family:'tsfg.program-publication-candidate',version:4});
const sorted=values=>values.every((value,index)=>index===0||values[index-1]<value);
const hash=value=>typeof value==='string'&&/^sha256:[0-9a-f]{64}$/.test(value);
const flags=['read','write','structural'];

function publicationIdentity(kind,value,spend) {
  const pending=[value];while(pending.length){spend();const row=pending.pop();
    if(typeof row==='string')spend(Math.ceil(row.length/8)+1);
    else if(Array.isArray(row)){spend(row.length);for(const child of row)pending.push(child);}
    else if(row!==null&&typeof row==='object')for(const name in row){spend(Math.ceil(name.length/8)+1);pending.push(row[name]);}
  }
  return commonIdentity(kind,value);
}
const contractDigest=(body,spend)=>publicationIdentity('published-contract',body,spend);
const publicationDigest=(scopeDigest,contracts,spend)=>publicationIdentity('publication',{scopeDigest,contracts},spend);
const scopeDigest=(scope,spend)=>publicationIdentity('publication-scope',scope,spend);

// Explicit first publication only. No consumer calls this to refresh supplied
// contracts when implementations change.
export function createCommonProgramPublication(input) {
  const hir=verifyCommonProgramHir(input),spend=commonMeter(),physical=commonProgramPhysical(hir),storage=commonFixedStorageProjection(hir,physical),
    projection=storage.status==='open'?null:storage,effects=commonEffects(hir,physical.model.spend,physical),derived=effects.derived(),
    availability=commonReturnOriginAvailability(hir,physical.model.callables,physical.model.methods,physical.model.spend,projection,physical),
    source=commonReturnOriginSource(hir,physical.model.spend,physical,projection,null,null,availability.selected),graphs=source.derived(availability.dependencies);
  spend(hir.functions.length);
  const contracts=hir.functions.map(fn=>{
    spend();const projected=graphs.get(fn.id),body={functionId:fn.id,signatureHash:fn.signatureHash,
      upper:projected?commonJoinReturnOriginEffects(derived.get(fn.id),projected,physical.model.spend):derived.get(fn.id),
      callables:physical.model.callables.contracts.get(fn.id),returnOrigins:projected?.returnOrigins??null};
    return {...body,digest:contractDigest(body,spend)};
  });
  const uppers=new Map(contracts.map(row=>[row.functionId,{returnOrigins:row.returnOrigins}])),
    scope=commonFixedPublicationScope(hir,uppers,storage.storage,spend),scopeHash=scopeDigest(scope,spend);
  return own({format,mode:'fixed',scope,scopeDigest:scopeHash,expectedDigest:publicationDigest(scopeHash,contracts,spend),contracts});
}

function admit(input,publication) {
  commonBudget(publication);const hir=verifyCommonProgramHir(input),spend=commonMeter();
  record(publication,['format','mode','scope','scopeDigest','expectedDigest','contracts']);
  check(same(publication.format,format)&&publication.mode==='fixed'&&hash(publication.scopeDigest)&&hash(publication.expectedDigest),'publication');
  check(Array.isArray(publication.contracts)&&publication.contracts.length===hir.functions.length,'publication');spend(publication.contracts.length);
  check(sorted(publication.contracts.map(row=>row.functionId)),'publication');
  spend(hir.globals.length+hir.types.length);const records=new Map(),globals=new Map(hir.globals.map(row=>[row.id,row])),types=new Map(hir.types.map(row=>[row.id,row])),slotByKey=new Map();
  spend(hir.environments.length);for(const env of hir.environments){spend(env.slots.length);for(const slot of env.slots)slotByKey.set(slot.key,slot);}
  for(const [i,row]of publication.contracts.entries()) {
    spend();record(row,['functionId','signatureHash','upper','callables','returnOrigins','digest']);const fn=hir.functions[i];
    check(row.functionId===fn.id&&row.signatureHash===fn.signatureHash,'publication-identity');record(row.upper,['globals','hostResources','parameters','facets','captures']);
    record(row.upper.hostResources,['reads','writes']);
    for(const key of ['reads','writes']){const selected=row.upper.hostResources[key],allowed=commonHostResources(hir.hostContext);check(Array.isArray(selected)&&selected.length<=allowed.length,'publication');spend(selected.length+allowed.length);check(sorted(selected)&&selected.every(id=>allowed.includes(id)),'publication-identity');}
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
      // writes through an Array, reference or inline value field held by an
      // immutable binding. This does not grant childless holding permission.
      const mutableValue=slot&&['array','reference','value'].includes(types.get(slot.type)?.kind);
      check(slot&&(!previous||previous<c.slot)&&flags.every(flag=>typeof c[flag]==='boolean')&&(!c.write||slot.writable||mutableValue),'publication');previous=c.slot;}
    const {digest,...body}=row;check(digest===contractDigest(body,spend),'publication-identity');records.set(row.functionId,row);
  }
  const fixedScope=commonVerifyPublicationScope(hir,publication.scope,spend),scope=scopeDigest(publication.scope,spend);
  check(publication.scopeDigest===scope&&publication.expectedDigest===publicationDigest(scope,publication.contracts,spend),'publication-identity');
  for(const [id,row]of records){spend();if(row.returnOrigins!==null){
    const checked=fixedScope.read(id,row.returnOrigins);
    if(checked.status==='typed')records.set(id,{...row,returnOrigins:checked.graph});
    else check(false,'publication-return-open','a supplied graph must have a complete ordinary return protocol');
  }}
  return {hir,spend,records,scope,fixedScope};
}
// These entry points admit fixed metadata identity only. They do not certify
// containment of current bodies or grant Source/Actual/Borrow permissions.
export function verifyCommonProgramPublication(publication,input) {admit(input,publication);return own(publication);}
export const readCommonProgramPublication=(bytes,input)=>verifyCommonProgramPublication(commonJson(bytes),input);
export const printCommonProgramPublication=(publication,input)=>canonical(verifyCommonProgramPublication(publication,input))+'\n';
function prepare(input,publication) {
  const admitted=admit(input,publication),{hir,spend,records,scope,fixedScope}=admitted;
  const physical=commonProgramPhysical(hir,records),storage=commonFixedStorageProjection(hir,physical,publication.scope.storage),
    projection=storage.status==='open'?null:storage,effects=commonEffects(hir,physical.model.spend,physical),
    availability=commonReturnOriginAvailability(hir,physical.model.callables,physical.model.methods,physical.model.spend,projection,physical);
  for(const [id,row]of records){spend();if(row.returnOrigins===null)availability.reasons.set(id,'fixed-return-open');
    else for(const call of row.returnOrigins.calls){spend();availability.dependencies.get(id).add(call.functionId);}
  }
  let changed=true;while(changed){changed=false;for(const [id,targets]of availability.dependencies){spend();if(availability.reasons.has(id))continue;
    for(const target of targets){spend();if(availability.reasons.has(target)){availability.reasons.set(id,'fixed-callee-return-open');changed=true;break;}}
  }}
  for(const id of availability.reasons.keys()){spend();availability.selected.delete(id);}
  const source=commonReturnOriginSource(hir,physical.model.spend,physical,projection,fixedScope.typeKind,records,availability.selected,fixedScope.catalogue);
  return {hir,spend,effects,records,scope,physical,source,availability};
}
function analyze(input,publication) {
  const prepared=prepare(input,publication),{hir,effects,spend,records}=prepared,derived=effects.derived();
  const collections=commonCollections(spend),dependencies=calls=>{spend(calls.length);const selected=collections.sorted(collections.set(calls.map(call=>call.target)));
    spend(selected.length);return selected.map(functionId=>({functionId,digest:records.get(functionId).digest}));};
  const uppers=collections.map(records,row=>row.upper),batch=effects.fixed(uppers),functions=[];
  for(const fn of hir.functions) {
    spend();const current=batch.derive(fn),record=records.get(fn.id),reason=prepared.availability.reasons.get(fn.id);
    let returnOriginStatus={status:'open',reason:reason??'fixed-return-open'},body=null;
    if(!reason){body=prepared.source.derive(fn,null);current.upper=commonJoinReturnOriginEffects(current.upper,body.upper,prepared.physical.model.spend);}
    check(covers(record.upper,current.upper,prepared.physical.model.spend),'contract','current implementation exceeds fixed Published upper',
      {functionId:fn.id,primary:{sourceId:fn.sourcePath,...fn.range}});
    if(body?.pendingReason)returnOriginStatus={status:'open',reason:body.pendingReason};
    else if(body){check(prepared.source.covers({...record.upper,returnOrigins:record.returnOrigins},body.upper,null),'return-origin-contract','current return/content graph exceeds fixed Published graph',
      {functionId:fn.id,primary:{sourceId:fn.sourcePath,...fn.range}});returnOriginStatus={status:'covered',reason:null};}
    functions.push({functionId:fn.id,derived:derived.get(fn.id),effective:current.upper,returnOriginStatus,dependencies:dependencies(current.calls),hostCalls:current.hostCalls});
  }
  spend(hir.modules.length);const initializers=hir.modules.map(module=>{
    const fn={id:module.initializer,sourcePath:module.sourcePath,returnType:'void',parameters:[],bindings:[],body:module.initialization};
    const current=batch.derive(fn);return {functionId:module.initializer,effective:current.upper,dependencies:dependencies(current.calls),hostCalls:current.hostCalls};
  });
  const report={inputIdentity:hir.inputIdentity,hirDigest:sha256(canonical(hir)+'\n'),scopeDigest:prepared.scope,publishedDigest:publication.expectedDigest,
    contracts:publication.contracts,functions,initializers,initializationOrder:hir.closure.initialization};commonBudget(report);return {report:own(report),prepared};
}
export const analyzeCommonProgram=(input,publication)=>analyze(input,publication).report;

export function verifyCommonKernelGroup(input,publication,request) {
  const spend=commonMeter();commonBudget(request);record(request,['targets']);check(Array.isArray(request.targets)&&request.targets.length!==1&&request.targets.length<=32,'kernel');
  spend(request.targets.length);check(request.targets.every(hash)&&sorted(request.targets),'kernel');
  const {report:analysis,prepared}=analyze(input,publication),{hir}=prepared;
  const roots=new Set();spend(hir.closure.roots.length);for(const root of hir.closure.roots)if(root.kind==='kernel')roots.add(root.target);
  spend(request.targets.length);check(request.targets.every(id=>roots.has(id)),'kernel-identity');
  spend(analysis.contracts.length+hir.functions.length);
  const contracts=new Map(analysis.contracts.map(row=>[row.functionId,row])),functions=new Map(hir.functions.map(fn=>[fn.id,fn]));
  const analyzed=new Map(analysis.functions.map(row=>[row.functionId,row])),covered=new Set();
  spend(analysis.functions.length);for(const row of analysis.functions)if(row.returnOriginStatus.status==='covered')covered.add(row.functionId);
  function hostOrigin(id,seen=new Set()){spend();if(seen.has(id))return null;seen.add(id);const current=analyzed.get(id);
    if(current.hostCalls.length)return current.hostCalls[0];for(const edge of current.dependencies){spend();const origin=hostOrigin(edge.functionId,seen);if(origin)return origin;}return null;}
  const unresolved=[];
  const accesses=request.targets.map(functionId=>{spend();const row=contracts.get(functionId),fn=functions.get(functionId);
    if(row.upper.hostResources.reads.length||row.upper.hostResources.writes.length){
      const host=hostOrigin(functionId),access=row.upper.hostResources.reads.length?'read':'write',resource=row.upper.hostResources[access==='read'?'reads':'writes'][0];
      check(false,'kernel-host','fixed Published Host resource access is not kernel-admissible',{functionId,primary:host?{sourceId:host.sourcePath,...host.range}:{sourceId:fn.sourcePath,...fn.range},hostResources:row.upper.hostResources,
        callChain:commonKernelCallChain(prepared,analysis,functionId,{kind:'host-resource',resource,access})});
    }
    const facets=commonFacets.filter(flag=>row.upper.facets[flag]),capture=row.upper.captures.find(c=>c.read||c.write||c.structural);
    if(facets.length||capture){
      const reason=capture?{kind:/** @type {'capture'} */('capture'),slot:capture.slot,access:/** @type {'read'|'write'|'structural'} */(capture.read?'read':capture.write?'write':'structural')}:{kind:/** @type {'facet'} */('facet'),facet:facets[0]};
      check(false,'kernel-capability','fixed Published kernel capability is not proved',{functionId,primary:{sourceId:fn.sourcePath,...fn.range},facets,callChain:commonKernelCallChain(prepared,analysis,functionId,reason)});
    }
    const origin=analyzed.get(functionId).returnOriginStatus;
    if(origin.status!=='covered'&&!commonReturnOriginScalarProof(functionId,prepared.availability,prepared.records,spend,covered)){spend();unresolved.push({functionId,primary:{sourceId:fn.sourcePath,...fn.range},reason:origin.reason});}
    return {functionId,publishedContractDigest:row.digest,reads:row.upper.globals.reads,writes:row.upper.globals.writes,parameters:row.upper.parameters,captures:row.upper.captures,facets:row.upper.facets,hostResources:row.upper.hostResources};});
  const pairs=[],intersection=(a,b)=>{const out=[];let i=0,j=0;while(i<a.length&&j<b.length){spend();if(a[i]<b[j])i++;else if(a[i]>b[j])j++;else{out.push(a[i]);i++;j++;}}return out;};
  for(let i=0;i<accesses.length;i++)for(let j=i+1;j<accesses.length;j++) {
    spend();const a=accesses[i],b=accesses[j],pair={left:a.functionId,right:b.functionId,readRead:intersection(a.reads,b.reads),
      writeWrite:intersection(a.writes,b.writes),writeRead:intersection(a.writes,b.reads),readWrite:intersection(a.reads,b.writes)};
    check(!pair.writeWrite.length&&!pair.writeRead.length&&!pair.readWrite.length,'kernel-conflict','fixed Published global bounds conflict',
      {primary:{sourceId:functions.get(a.functionId).sourcePath,...functions.get(a.functionId).range},related:[{sourceId:functions.get(b.functionId).sourcePath,...functions.get(b.functionId).range}],conflicts:pair});pairs.push(pair);
  }
  for(const issue of unresolved){spend();check(false,'kernel-return-origin-open','fixed return/content authority is unresolved',issue);}
  const proof={inputIdentity:analysis.inputIdentity,hirDigest:analysis.hirDigest,scopeDigest:analysis.scopeDigest,publishedDigest:analysis.publishedDigest,targets:request.targets,accesses,pairs};
  commonBudget(proof);return own(proof);
}
export function verifyCommonKernelProof(proof,hir,publication,request){commonBudget(proof);const rebuilt=verifyCommonKernelGroup(hir,publication,request);check(same(proof,rebuilt),'kernel-proof');return rebuilt;}
export const printCommonKernelProof=(proof,hir,publication,request)=>canonical(verifyCommonKernelProof(proof,hir,publication,request))+'\n';
export const readCommonKernelProof=(bytes,hir,publication,request)=>verifyCommonKernelProof(commonJson(bytes),hir,publication,request);
