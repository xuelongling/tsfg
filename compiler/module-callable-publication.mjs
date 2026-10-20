// SPDX-License-Identifier: MIT
import {budget,check,validateShape,canonical,same,own,sha256,format,compare,meter,readJson} from './module-callable-common.mjs';
import {verifyModuleCallableHir} from './module-callable-hir.mjs';
import {solveModuleTargets} from './module-callable-targets.mjs';
const messages={'':'invalid fixed module call publication',identity:'fixed module call publication identity differs',contract:'module implementation exceeds fixed published upper bound',limit:'module call analysis budget exceeded',report:'module call report differs from complete recomputation',canonical:'module call report must use canonical JSON plus LF'};
export function moduleCallFailure(kind='',details=undefined){
  if(kind==='input')kind='';const code='r03-d-module-call-effects'+(kind?'-'+kind:'');
  throw Object.assign(new TypeError(code+': '+messages[kind]),{code,ruleId:'r01-call-contract',phase:'analysis',...(details??{})});
}
const assert=(v,kind='')=>{if(!v)moduleCallFailure(kind);};
const sorted=values=>values.every((id,i)=>i===0||compare(values[i-1],id)<0);
const top=()=>({reads:[],writes:[],unknown:true});
const coversTargets=(a,b)=>a.top||!b.top&&b.functions.every(id=>a.functions.includes(id));
const coversEffects=(a,b)=>a.unknown||!b.unknown&&b.reads.every(id=>a.reads.includes(id))&&b.writes.every(id=>a.writes.includes(id));
// Both fixed publication and Core consume the same already-verified scope.
export function verifiedModulePublicationScope(checked){
  return {roots:{roots:checked.closure.roots.map(({kind,sourcePath,name})=>({kind,sourcePath,name})),requiredRoots:checked.closure.requiredRoots},modules:checked.modules.map(({id,sourcePath,dependencies,exports,bindings})=>({moduleId:id,sourcePath,dependencies,exports,bindings})),functions:checked.functions.filter(f=>f.kind==='source').map(f=>({functionId:f.id,sourcePath:f.sourcePath,name:f.name,signatureHash:f.signatureHash,parameters:f.parameters.map(p=>p.type),returnType:f.returnType})),globals:checked.globals.map(({id,sourcePath,name,type,writable})=>({globalId:id,sourcePath,name,type,writable}))};
}
function prepare(hir,context){
  budget(context,moduleCallFailure);const checked=verifyModuleCallableHir(hir);validateShape(context,'context',moduleCallFailure);
  const count=meter(moduleCallFailure),functions=new Map(checked.functions.map(f=>[f.id,f]));
  const sourceFunctions=checked.functions.filter(f=>f.kind==='source'),globals=new Map(checked.globals.map(g=>[g.id,g])),types=new Map(checked.types.map(t=>[t.id,t]));
  const callable=t=>types.get(t)?.kind==='function';
  // Complete shape/order checks precede every identity or implementation decision.
  assert(sorted(context.contracts.map(r=>r.functionId)));
  for(const row of context.contracts){
    count.member();assert(sorted(row.upper.reads)&&sorted(row.upper.writes));assert(!row.upper.unknown||row.upper.reads.length===0&&row.upper.writes.length===0);
    const sets=[...row.parameters.map(p=>p.allowed),...(row.returns?[row.returns]:[])];
    for(const set of sets){assert(sorted(set.functions));set.functions.forEach(()=>count.member());}
    assert(row.parameters.every((p,i)=>i===0||row.parameters[i-1].index<p.index));
  }
  assert(context.contracts.length===sourceFunctions.length,'identity');
  const records=new Map();
  const target=(set,type)=>{for(const id of set.functions){const f=functions.get(id);assert(f?.kind==='source'&&f.signature===type,'identity');}};
  for(const [i,row]of context.contracts.entries()){
    const fn=sourceFunctions[i];assert(row.functionId===fn.id&&row.signatureHash===fn.signatureHash,'identity');
    const params=fn.parameters.flatMap((p,index)=>callable(p.type)?[{p,index}]:[]);assert(params.length===row.parameters.length,'identity');
    params.forEach(({p,index},j)=>{assert(row.parameters[j].index===index,'identity');target(row.parameters[j].allowed,p.type);});
    if(callable(fn.returnType)){assert(row.returns!==null);target(row.returns,fn.returnType);}else assert(row.returns===null);
    for(const id of row.upper.reads){count.member();assert(globals.has(id),'identity');}
    for(const id of row.upper.writes){count.member();assert(globals.has(id),'identity');assert(globals.get(id).writable);}
    const {digest,...body}=row;assert(digest===sha256('tsfg.module-published-call-contract.v1\0'+canonical(body)),'identity');records.set(fn.id,row);
  }
  const scope=verifiedModulePublicationScope(checked);
  budget(scope,moduleCallFailure);
  const scopeDigest=sha256('tsfg.module-call-scope.v1\0'+canonical(scope));
  assert(context.scopeDigest===scopeDigest&&context.expectedDigest===sha256('tsfg.module-call-publication.v1\0'+canonical({scopeDigest,contracts:context.contracts})),'identity');
  return {hir:checked,functions,records,count,scopeDigest};
}
function effectsFor(flow,records,count){
  const rows=new Map();
  for(const [id,s]of flow.summaries)if(s.reached)rows.set(id,{reads:new Set(s.reads),writes:new Set(s.writes),unknown:s.unknownEffects});
  const merge=(into,from)=>{
    count.step();if(into.unknown)return false;if(from.unknown){into.unknown=true;into.reads.clear();into.writes.clear();return true;}
    let changed=false;for(const key of ['reads','writes'])for(const id of from[key]){count.step();if(!into[key].has(id)){count.member();into[key].add(id);changed=true;}}return changed;
  };
  if(records){for(const site of flow.report.calls)for(const id of site.targets.functions)merge(rows.get(site.functionId),records.get(id).upper);}
  else {
    let changed;do{changed=false;for(const site of flow.report.calls)for(const id of site.targets.functions)changed=merge(rows.get(site.functionId),rows.get(id))||changed;}while(changed);
  }
  return new Map([...rows].map(([id,row])=>[id,row.unknown?top():{reads:[...row.reads].sort(compare),writes:[...row.writes].sort(compare),unknown:false}]));
}
function unknownChains(hir,flow,effects,records,count){
  const sites=new Map();for(const site of flow.report.calls){if(!sites.has(site.functionId))sites.set(site.functionId,[]);sites.get(site.functionId).push(site);}
  const functions=new Map(hir.functions.map(f=>[f.id,f])),out=[];
  const key=chain=>canonical(chain);
  const order=(a,b)=>a.chain.length-b.chain.length||compare(key(a.chain),key(b.chain));
  for(const row of flow.report.functions){
    const id=row.functionId;if(!effects.get(id).unknown&&!records.get(id)?.upper.unknown)continue;
    const pending=[{id,chain:[]}],seen=new Set(),actual=[],publications=[];
    while(pending.length){
      count.step();pending.sort(order);const current=pending.shift();if(seen.has(current.id))continue;seen.add(current.id);
      const fn=functions.get(current.id);
      if(records.get(current.id)?.upper.unknown)publications.push({chain:[...current.chain,{functionId:fn.id,expressionPath:null,kind:'publication',range:fn.range,target:null}],reason:'published-upper'});
      for(const site of sites.get(current.id)??[]){
        const edge={functionId:site.functionId,expressionPath:site.expressionPath,kind:site.kind,range:site.range};
        if(site.targets.top)actual.push({chain:[...current.chain,{...edge,target:null}],reason:'unknown-call'});
        for(const target of site.targets.functions)pending.push({id:target,chain:[...current.chain,{...edge,target}]});
      }
    }
    const candidates=actual.length?actual:publications;candidates.sort(order);assert(candidates.length>0);
    out.push({functionId:id,...candidates[0]});
  }return out;
}
export function analyzeModuleCallableCalls(hir,context){
  const input=prepare(hir,context),{records,count}=input;
  const derived=solveModuleTargets(input.hir,null,moduleCallFailure),effective=solveModuleTargets(input.hir,records,moduleCallFailure);
  const de=effectsFor(derived,null,count),ee=effectsFor(effective,records,count);
  const violation=(fn,facet,primary)=>moduleCallFailure('contract',{functionId:fn.id,facet,primary});
  const observations=effective.observations.sort((a,b)=>compare(a.callee,b.callee)||Number(b.root)-Number(a.root)||compare(canonical(a.path),canonical(b.path))||a.index-b.index);
  for(const row of effective.report.functions){
    const fn=input.functions.get(row.functionId);if(fn.kind!=='source')continue;const upper=records.get(fn.id);
    for(const o of observations.filter(x=>x.callee===fn.id)){
      const allowed=upper.parameters.find(p=>p.index===o.index).allowed;
      if(!coversTargets(allowed,o.targets))violation(fn,'parameters',{sourceId:input.functions.get(o.caller).sourcePath,...o.range});
    }
    if(row.returns&&!coversTargets(upper.returns,row.returns))violation(fn,'returns',{sourceId:fn.sourcePath,...fn.range});
    if(!coversEffects(upper.upper,ee.get(fn.id)))violation(fn,'effects',{sourceId:fn.sourcePath,...fn.range});
  }
  const rows=effective.report.functions.map(row=>{
    const deps=new Set(effective.report.calls.filter(c=>c.functionId===row.functionId).flatMap(c=>c.targets.functions));
    return {functionId:row.functionId,derived:de.get(row.functionId)??top(),effective:ee.get(row.functionId),dependencies:[...deps].sort(compare).map(functionId=>({functionId,digest:records.get(functionId).digest}))};
  });
  const report={format:format('tsfg.module-calls-candidate'),inputIdentity:input.hir.inputIdentity,hirDigest:sha256(canonical(input.hir)+'\n'),scopeDigest:input.scopeDigest,publishedDigest:context.expectedDigest,contracts:context.contracts,derivedTargets:derived.report,effectiveTargets:effective.report,functions:rows.filter(r=>input.functions.get(r.functionId).kind==='source'),initializers:rows.filter(r=>input.functions.get(r.functionId).kind==='module-initialization'),initializationOrder:input.hir.closure.initialization,unknownChains:unknownChains(input.hir,effective,ee,records,count)};
  budget(report,moduleCallFailure);return own(JSON.parse(canonical(report)));
}
export function verifyModuleCalls(report,hir,context){
  budget(report,moduleCallFailure);const rebuilt=analyzeModuleCallableCalls(hir,context);assert(same(report,rebuilt),'report');return rebuilt;
}
export function printModuleCalls(report,hir,context){return canonical(verifyModuleCalls(report,hir,context))+'\n';}
export function readModuleCalls(bytes,hir,context){return verifyModuleCalls(readJson(bytes,moduleCallFailure).value,hir,context);}
export function rejectUnknownModuleKernel(hir,analysis,targets){
  const contracts=new Map(analysis.contracts.map(r=>[r.functionId,r])),functions=new Map(hir.functions.map(f=>[f.id,f]));
  const id=targets.find(id=>contracts.get(id).upper.unknown);if(!id)return;
  const witness=analysis.unknownChains.find(x=>x.functionId===id),last=witness.chain.at(-1),owner=functions.get(last.functionId);
  const members=new Set([id,...witness.chain.flatMap(e=>[e.functionId,...(e.target?[e.target]:[])])]);
  const publishedDependencies=[...members].filter(x=>contracts.has(x)).sort(compare).map(functionId=>({functionId,digest:contracts.get(functionId).digest}));
  const code='r03-d-kernel-call-effects';
  throw Object.assign(new TypeError(code+': kernel call requires a known published effect upper bound'),{code,ruleId:'r01-kernel',phase:'hir',primary:{sourceId:owner.sourcePath,...last.range},dependency:own(JSON.parse(canonical(witness.chain))),publishedDependencies:own(publishedDependencies)});
}
