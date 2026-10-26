// SPDX-License-Identifier: MIT
// Code-target flow and fixed transfers are independent runs. Environment
// instances are deliberately absent here: code membership is no GC authority.
import {callableTargetDomain,fixedCallableTransfer} from './callable-target-domain.mjs';
import {commonMethods} from './common-program-methods.mjs';
import {signatureId} from './module-callable-common.mjs';
import {commonCheck as check,commonFailure,commonSame as same,commonRecord as record} from './common-program-common.mjs';
import {commonCollections} from './common-program-budget.mjs';
export function commonTargets(hir,spend,records=null) {
  const collections=commonCollections(spend);spend(hir.functions.length+hir.types.length);
  const functions=new Map(hir.functions.map(fn=>[fn.id,fn])),types=new Map(hir.types.map(t=>[t.id,t]));
  const methods=commonMethods(hir,spend);
  const domain=callableTargetDomain(functions,spend,message=>commonFailure('callable',message),(a,b)=>a<b?-1:a>b?1:0);
  const callable=id=>types.get(id)?.kind==='function',summaries=new Map(),sites=new Map(),observations=new Map();let changed=false;
  const merge=(map,key,value)=>{const before=map.get(key)??domain.bottom(),next=domain.join(before,value);if(!map.has(key)||!domain.equal(before,next)){map.set(key,next);changed=true;}};
  const reach=id=>{const row=summaries.get(id);check(row,'callable');if(!row.reached){row.reached=true;changed=true;}return row;};
  const observe=(id,index,value)=>merge(observations,id+'/'+index,value);
  for(const fn of hir.functions){spend();const parameters=new Map();for(const [index,p]of fn.parameters.entries()){spend();if(callable(p.type))parameters.set(index,records?domain.from(records.get(fn.id).callables.parameters.find(row=>row.index===index).allowed):domain.bottom());}
    summaries.set(fn.id,{fn,reached:true,parameters,returns:callable(fn.returnType)?domain.bottom():null});}
  const siteKey=(fn,range)=>fn+'/'+range.start+':'+range.end;
  function expression(summary,state,value) {
    spend();if(value.kind==='functionReference')return domain.single(value.functionId);
    if(value.kind==='bindingReference')return callable(value.type)?domain.copy(state.get(value.binding)??domain.bottom()):null;
    if(['parentheses','as','nonNull'].includes(value.kind)){const actual=expression(summary,state,value.expression);return actual??(callable(value.type)?domain.top():null);}
    if(value.kind==='bindingAssignment') {const result=expression(summary,state,value.value);if(result)state.set(value.target.binding,domain.copy(result));return result;}
    if(value.kind==='call'||value.kind==='indirectCall'){
      let saved=value.kind==='indirectCall'?domain.copy(expression(summary,state,value.expression)??domain.top()):value.callee==='intrinsic:readSpan'?null:domain.single(value.callee);
      if(value.receiver){expression(summary,state,value.receiver);if(functions.get(value.callee)?.kind==='method'){saved=domain.bottom();for(const row of methods.dispatch(value.callee,value.receiver.type)){spend();saved=domain.join(saved,domain.single(row.target));}}}
      spend(value.arguments.length);const args=value.arguments.map(arg=>expression(summary,state,arg));if(!saved)return null;
      if(value.kind==='indirectCall')merge(sites,siteKey(summary.fn.id,value.range),saved);
      let result=callable(value.type)?domain.bottom():null;
      for(const id of saved.ids){spend();const callee=reach(id);check(value.kind!=='indirectCall'||callee.fn.signatureHash===signatureId({parameters:value.signature.parameters,returns:value.signature.returnType}),'callable-signature');
        if(records){const returned=fixedCallableTransfer(records.get(id).callables,args,domain,(index,targets)=>observe(id,index,targets),spend,message=>commonFailure('callable',message));if(result)result=domain.join(result,returned);}
        else {for(const [index,p]of callee.fn.parameters.entries()){spend();if(callable(p.type)){check(args[index],'callable');merge(callee.parameters,index,args[index]);}}if(result)result=domain.join(result,callee.returns);}
      }
      if(saved.top&&result)result=domain.top();return result;
    }
    for(const key of ['expression','left','right','receiver','index','value','target'])if(value[key])expression(summary,state,value[key]);
    for(const child of value.elements??[])expression(summary,state,child);
    if(value.kind==='new'||value.kind==='superConstruct'){spend(value.arguments.length);const args=value.arguments.map(arg=>expression(summary,state,arg));let owner=types.get(value.kind==='new'?value.type:value.callee);
      while(owner&&!owner.construction?.functionId){spend();owner=types.get(owner.base);}if(owner?.construction?.functionId){const callee=reach(owner.construction.functionId);if(records)fixedCallableTransfer(records.get(callee.fn.id).callables,args,domain,(index,targets)=>observe(callee.fn.id,index,targets),spend,message=>commonFailure('callable',message));else for(const [index,p]of callee.fn.parameters.entries()){spend();if(callable(p.type)){check(args[index],'callable');merge(callee.parameters,index,args[index]);}}}}
    else for(const arg of value.arguments??[])expression(summary,state,arg);return callable(value.type)?domain.top():null;
  }
  const clone=state=>collections.map(state,domain.copy);
  const stateKey=state=>{spend(state.size);return [...state].map(([id,value])=>[id,domain.wire(value)]);};
  const join=(into,from)=>{for(const [id,value]of from){spend();into.set(id,domain.join(into.get(id)??domain.bottom(),value));}return into;};
  function body(summary,state,rows){let live=true;for(const row of rows){spend();if(!live)break;
    if(['constDeclaration','letDeclaration','initialize'].includes(row.kind)){const value=expression(summary,state,row.initializer);if(value)state.set(row.binding,domain.copy(value));}
    else if(['expression','throw','return'].includes(row.kind)){const value=row.value?expression(summary,state,row.value):null;if(row.kind==='return'&&summary.returns){check(value,'callable');const next=domain.join(summary.returns,value);if(!domain.equal(next,summary.returns)){summary.returns=next;changed=true;}}if(row.kind!=='expression')live=false;}
    else if(row.kind==='block')live=body(summary,state,row.body);
    else if(row.kind==='if'){expression(summary,state,row.condition);const yes=clone(state),no=clone(state),a=body(summary,yes,row.then),b=body(summary,no,row.else);state.clear();if(a)join(state,yes);if(b)join(state,no);live=a||b;}
    else if(row.kind==='while'){let previous;do{spend();previous=stateKey(state);expression(summary,state,row.condition);const next=clone(state);body(summary,next,row.body);join(state,next);}while(!same(previous,stateKey(state)));}
    else if(row.kind==='try'){const attempted=clone(state);body(summary,attempted,row.tryBlock.body);join(state,attempted);if(row.catchClause){const caught=clone(state);body(summary,caught,row.catchClause.block.body);join(state,caught);}if(row.finallyBlock)live=body(summary,state,row.finallyBlock.body);}
    else check(row.kind==='functionDeclaration','callable');
  }return live;}
  for(const root of hir.closure.roots)if(root.kind!=='module-initialization'){const row=reach(root.target);for(const [index,p]of row.fn.parameters.entries()){spend();if(callable(p.type)){if(records)observe(row.fn.id,index,domain.top());else merge(row.parameters,index,domain.top());}}}
  do{changed=false;for(const summary of summaries.values())if(summary.reached){spend();const state=new Map();for(const [i,value]of summary.parameters)state.set(summary.fn.parameters[i].id,domain.copy(value));body(summary,state,summary.fn.body);}}while(changed);
  const contracts=new Map();for(const summary of summaries.values()){spend();const parameters=[];for(const [index,value]of summary.parameters)parameters.push({index,allowed:domain.wire(value)});
    contracts.set(summary.fn.id,{parameters,returns:summary.returns?domain.wire(summary.returns):null,slotWrites:[]});}
  if(records){for(const [key,value]of observations){spend();const at=key.lastIndexOf('/'),record=records.get(key.slice(0,at)).callables.parameters.find(row=>row.index===Number(key.slice(at+1))),upper=domain.from(record.allowed);
      check(upper.top||!value.top&&[...value.ids].every(id=>{spend();return upper.ids.has(id);}),'callable-contract','argument exceeds fixed callable upper');}
    for(const summary of summaries.values())if(summary.returns){const upper=domain.from(records.get(summary.fn.id).callables.returns);check(upper.top||!summary.returns.top&&[...summary.returns.ids].every(id=>{spend();return upper.ids.has(id);}),'callable-contract','return exceeds fixed callable upper');}}
  return {contracts,sites,domain,callable,summaries,siteKey,signature:signature=>signatureId({parameters:signature.parameters,returns:signature.returnType}),site(fn,range){return domain.wire(sites.get(siteKey(fn,range))??domain.top());}};
}

// Fixed rows are an external boundary; a well-shaped function type is not a
// grant to every function with that signature. Only explicitly listed IDs pass.
export function validateCommonCallableBounds(hir,fn,value,spend){
  record(value,['parameters','returns','slotWrites']);spend(hir.functions.length+hir.types.length);const functions=new Map(hir.functions.map(f=>[f.id,f])),types=new Map(hir.types.map(t=>[t.id,t]));
  const bound=(targets,type)=>{record(targets,['top','functions']);check(typeof targets.top==='boolean'&&Array.isArray(targets.functions)&&targets.functions.length<=256,'callable-contract');spend(targets.functions.length);let previous;
    for(const id of targets.functions){const target=functions.get(id);check(target&&!target.ownerType&&(!previous||previous<id)&&same(target.parameters.map(p=>p.type),type.parameters)&&target.returnType===type.returnType,'callable-contract');previous=id;}};
  const expected=[];for(const [index,p]of fn.parameters.entries()){spend();if(types.get(p.type)?.kind==='function')expected.push(index);}
  check(Array.isArray(value.parameters)&&value.parameters.length===expected.length,'callable-contract');for(const [i,row]of value.parameters.entries()){spend();record(row,['index','allowed']);check(row.index===expected[i],'callable-contract');bound(row.allowed,types.get(fn.parameters[row.index].type));}
  if(types.get(fn.returnType)?.kind==='function')bound(value.returns,types.get(fn.returnType));else check(value.returns===null,'callable-contract');
  // Scalar/ReadSpan captures have no callable payload. No callable capture
  // slot can be written, so a nonempty transfer would invent target authority.
  check(Array.isArray(value.slotWrites)&&value.slotWrites.length===0,'callable-contract');
}
