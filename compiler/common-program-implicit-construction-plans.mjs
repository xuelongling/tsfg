// SPDX-License-Identifier: MIT
// Typed inner analysis projection only. No public HIR/function/scope mutation.
import {planCommonFunction} from './common-program-control.mjs';
import {commonCallableType} from './common-program-targets.mjs';
import {commonCheck as check,canonical,sha256} from './common-program-common.mjs';

// Call after the existing admission/model construction, BEFORE planning any
// owner. All implicit targets are installed before the existing Source lowerer
// sees new/super, so recursive defaults use invoke edges and the solver's SCCs.
// owners includes the caller's ordinary/explicit/module owners as before.
/** @param {ReturnType<typeof import('./common-program-plan.mjs').commonProgramModel>['model']} input
 * @param {ReadonlyArray<ReturnType<typeof import('./common-program-plan.mjs').commonProgramModel>['owners'][number]>} owners */
export function commonImplicitConstructionPlans(input,owners){
  const {spend}=input,text=value=>spend(Math.ceil(value.length*6/8)+1);
  spend(input.types.size*3+input.functions.size+input.bindings.size+input.callables.summaries.size);
  const types=new Map(input.types),functions=new Map(input.functions),bindings=new Map(input.bindings),summaries=new Map(input.callables.summaries),
    privateTargets=new Map(),privateOwners=[],issues=new Set(),callableSources=new Map();
  const issue=value=>{text(value);spend();issues.add(value);};
  const voidId=sha256('tsfg.type\0void');
  if(!types.has(voidId)){spend();types.set(voidId,{id:voidId,kind:'void',name:'void'});}
  for(const type of input.types.values()){
    spend();const construction=type.construction;
    if(!construction||!['reference','value'].includes(type.kind)||construction.kind==='explicit')continue;
    check(['implicit-base','implicit-derived'].includes(construction.kind),'construction','unknown admitted construction kind');
    text(construction.id);spend();const id='analysis-construction:'+construction.id;
    check(!functions.has(id),'identity','private analysis target collides with a declared function');
    spend(construction.parameters.length*3+8);
    const parameters=construction.parameters.map((parameter,index)=>{
      text(id);text(parameter.type);text(parameter.symbol);
      return {id:id+'/parameter/'+index,name:'$'+index,kind:'parameter',type:parameter.type,writable:true,
        range:{start:parameter.origin.start,end:parameter.origin.end},nameRange:{start:parameter.origin.start,end:parameter.origin.end}};
    });
    const range={start:construction.origin.start,end:construction.origin.end};
    for(const value of [id,type.id,...construction.signature.parameters])text(value);
    spend(128+construction.parameters.length*8);
    const signatureHash=sha256('tsfg.common-program.analysis-construction-signature.v1\0'+canonical({construction:construction.id,parameters:construction.signature.parameters,returnType:type.id}));
    const owner={id,name:'$implicitConstruction',kind:'construction-body',analysisOnly:true,ownerType:type.id,receiverBinding:'analysis-receiver:'+id,
      sourcePath:construction.origin.source,range,nameRange:range,returnType:type.id,signatureHash,parameters,bindings:[],body:[],
      lexicalParent:null,lexicalEnvironment:null,activationEnvironment:null,captures:[]};
    privateTargets.set(type.id,id);privateOwners.push(owner);functions.set(id,owner);
    for(const parameter of parameters){spend();bindings.set(parameter.id,{...parameter,role:'parameter',owner:id});}
    types.set(type.id,{...type,construction:{...construction,functionId:id}});
  }
  // The original typed HIR and its public function directory remain borrowed,
  // unchanged. Only this private model view contains analysis call targets.
  const callables={...input.callables,summaries,site(id,range){
    const owner=functions.get(id);
    if(owner?.analysisOnly){
      // Existing Source callable-site summaries are keyed by real functions.
      // A missing private initializer site is conservative opaque, never a
      // fabricated finite target set or a complete storage-authoring proof.
      text(id);spend(32);const key=input.callables.siteKey(id,range),known=input.callables.sites.get(key);
      if(!known)issue('implicit initializer callable site has no closed target evidence: '+id+'/'+range.start+':'+range.end);
    }
    return input.callables.site(id,range);
  }};
  const model={...input,types,functions,bindings,callables};
  for(const owner of privateOwners){
    spend();const type=types.get(owner.ownerType),construction=type.construction,parameterUppers=new Map();
    let ancestor=input.types.get(type.base);
    while(ancestor&&!ancestor.construction?.functionId){spend();ancestor=input.types.get(ancestor.base);}
    const ancestorId=ancestor?.construction?.functionId,source=ancestorId?input.callables.summaries.get(ancestorId):null;
    for(const [index,parameter]of owner.parameters.entries()){
      spend();if(!commonCallableType(parameter.type,types,spend))continue;
      const inherited=source?.parameters.get(index);
      if(inherited){
        spend(inherited.ids.size+1);for(const id of inherited.ids)text(id);
        parameterUppers.set(index,{top:inherited.top,ids:new Set(inherited.ids)});
        spend();callableSources.set(parameter.id,{functionId:ancestorId,parameter:index});
      }else {
        // This is explicitly unresolved entry data. TOP is the existing
        // conservative code-domain representation, not a complete upper.
        text(construction.id);spend(16);issue('implicit constructor callable parameter upper is unresolved: '+construction.id+'/'+index);
        parameterUppers.set(index,input.callables.domain.top());
      }
    }
    summaries.set(owner.id,{fn:owner,parameters:parameterUppers,returns:null,reached:true});
    if(construction.kind==='implicit-derived'){
      const base=types.get(type.base),forward=construction.implicitForward;
      check(base?.construction&&forward?.target===base.construction.id,'construction','implicit forward does not join its direct base');
      spend(owner.parameters.length*2+8);
      const args=owner.parameters.map(parameter=>({kind:'bindingReference',binding:parameter.id,type:parameter.type,range:parameter.range}));
      owner.body.push({kind:'expression',range:owner.range,value:{kind:'superConstruct',type:voidId,callee:base.id,range:owner.range,
        signature:base.construction.signature,arguments:args}});
    }
  }
  // No Source constructor is recursively inlined here. The ordinary lowerer
  // emits complete field expressions, parameter-property copies and language
  // continuations; every implicit new now selects a preinstalled function.
  spend(owners.length+privateOwners.length);const plans=[];
  for(const owner of owners){spend();plans.push(planCommonFunction(model,owner));}
  for(const owner of privateOwners){spend();plans.push(planCommonFunction(model,owner));}
  const roots=[];
  for(const target of types.values()){
    spend();if(!target.construction||!['reference','value'].includes(target.kind))continue;
    let owner=target;
    while(owner){
      spend();if(owner.construction){spend();roots.push({construction:owner.construction.id,owner:owner.id,newTarget:target.id,target:owner.construction.functionId});}
      owner=types.get(owner.base);
    }
  }
  spend(roots.length);roots.sort((left,right)=>{text(left.construction);text(right.construction);text(left.newTarget);text(right.newTarget);
    return left.construction<right.construction?-1:left.construction>right.construction?1:left.newTarget<right.newTarget?-1:left.newTarget>right.newTarget?1:0;});
  spend(issues.size);return {model,plans,roots,privateTargets,callableSources,coverage:{complete:issues.size===0,issues:[...issues]}};
}
