// SPDX-License-Identifier: MIT
// Two runs of this real module value-flow solver keep current bodies and fixed transfer separate.
import {canonical,compare,same} from './module-callable-common.mjs';
export function solveModuleTargets(hir,records,fail){
  const functions=new Map(hir.functions.map(f=>[f.id,f])),types=new Map(hir.types.map(t=>[t.id,t]));
  const callable=t=>types.get(t)?.kind==='function';
  const summaries=new Map(),sites=new Map(),observations=new Map(),forced=new Set();let work=0,growth=0,dirty=false;
  const step=()=>{if(++work>1000000)fail('limit');};
  const grew=()=>{if(++growth>200000)fail('limit');dirty=true;};
  // Keep this small algebra local: the module solver uses module FunctionIds,
  // parameter-index state and private call-effects failures/budgets. The closure
  // domain owns lexical-binding state and a different diagnostic family. Share
  // only when both can retain those identity and failure contracts unchanged.
  const bottom=()=>({top:false,ids:new Set()}),top=()=>({top:true,ids:new Set()}),copy=t=>({top:t.top,ids:new Set(t.ids)});
  const wire=t=>({top:t.top,functions:[...t.ids].sort(compare)});
  const from=t=>({top:t.top,ids:new Set(t.functions)});
  function join(a,b){step();return {top:a.top||b.top,ids:new Set([...a.ids,...b.ids])};}
  const equal=(a,b)=>a.top===b.top&&a.ids.size===b.ids.size&&[...a.ids].every(x=>b.ids.has(x));
  function merge(map,key,t){const old=map.get(key)??bottom(),n=join(old,t);if(!map.has(key)||!equal(n,old)){map.set(key,n);grew();}}
  for(const fn of functions.values())summaries.set(fn.id,{fn,reached:false,parameters:new Map(fn.parameters.flatMap((p,i)=>callable(p.type)?[[i,records?from(records.get(fn.id).parameters.find(x=>x.index===i).allowed):bottom()]]:[])),returns:callable(fn.returnType)?bottom():null,unknownEffects:false,reads:new Set(),writes:new Set()});
  function reach(id){const s=summaries.get(id);if(!s)fail('identity');if(!s.reached){s.reached=true;grew();}return s;}
  function unknown(s){if(!s.unknownEffects){s.unknownEffects=true;grew();}}
  function observe(callee,index,targets,caller,path,range,root=false){
    const key=callee+'\0'+(root?'root':caller+'\0'+canonical(path))+'\0'+index;
    if(!observations.has(key))observations.set(key,{callee,index,caller,path,range,root,targets:bottom()});
    const row=observations.get(key),n=join(row.targets,targets);if(!equal(row.targets,n)){row.targets=n;grew();}
  }
  function unknownCall(summary,args,value,path){
    unknown(summary);
    args.forEach((arg,argumentIndex)=>{if(!arg)return;for(const id of arg.ids){const cb=reach(id);cb.fn.parameters.forEach((p,i)=>{if(callable(p.type)){if(records)observe(id,i,top(),summary.fn.id,path,value.arguments[argumentIndex].range);else merge(cb.parameters,i,top());}});}});
  }
  function note(summary,value,path,t){
    const key=summary.fn.id+'\0'+canonical(path);
    if(!sites.has(key)){if(sites.size>=16384)fail('limit');sites.set(key,{functionId:summary.fn.id,expressionPath:path,kind:value.kind,range:value.range,targets:bottom()});grew();}
    const row=sites.get(key),n=join(row.targets,t);if(!equal(row.targets,n)){row.targets=n;grew();}return key;
  }
  function expression(s,state,v,path){
    step();
    if(v.kind==='functionReference')return {top:false,ids:new Set([v.target])};
    if(v.kind==='reference')return callable(v.type)?copy(state.get(v.binding)??bottom()):null;
    if(v.kind==='global'){if(!s.reads.has(v.global)){s.reads.add(v.global);grew();}return null;}
    if(v.kind==='call'||v.kind==='indirectCall'){
      let saved=v.kind==='call'?{top:false,ids:new Set([v.target])}:expression(s,state,v.callee,[...path,'callee']);
      if(!saved)fail('identity');saved=copy(saved);
      const args=v.arguments.map((a,i)=>expression(s,state,a,[...path,'arguments',i]));
      const key=s.fn.id+'\0'+canonical(path);if(forced.has(key))saved=join(saved,top());note(s,v,path,saved);
      let result=callable(v.type)?bottom():null;
      for(const id of [...saved.ids].sort(compare)){
        const callee=reach(id);if(callee.fn.signature!==v.signature)fail('identity');
        callee.fn.parameters.forEach((p,i)=>{if(callable(p.type)){if(!args[i])fail('identity');if(records)observe(id,i,args[i],s.fn.id,path,v.arguments[i].range);else merge(callee.parameters,i,args[i]);}});
        if(result)result=join(result,records?from(records.get(id).returns):callee.returns);
        if(records&&records.get(id).upper.unknown)unknownCall(s,args,v,path);
      }
      if(saved.top){unknownCall(s,args,v,path);if(result)result=join(result,top());}
      return result;
    }
    if(v.kind==='group'||v.kind==='unary')return expression(s,state,v.operand,[...path,'operand']);
    if(v.kind==='binary'||v.kind==='shortCircuit'){expression(s,state,v.left,[...path,'left']);expression(s,state,v.right,[...path,'right']);return null;}
    return null;
  }
  const clone=s=>new Map([...s].map(([k,v])=>[k,copy(v)]));
  function mergeStates(a,b){const out=clone(a);for(const [k,v]of b)out.set(k,join(out.get(k)??bottom(),v));return out;}
  const equalStates=(a,b)=>a.size===b.size&&[...a].every(([k,v])=>b.has(k)&&equal(v,b.get(k)));
  function location(v){return v.kind==='group'?location(v.operand):v;}
  function body(s,state,items,path){
    let live=true;
    for(const [i,item]of items.entries()){
      if(!live)break;step();const here=[...path,i];
      if(item.kind==='local'){const v=expression(s,state,item.initializer,[...here,'initializer']);if(v)state.set(item.binding.id,copy(v));}
      else if(item.kind==='initialize'){expression(s,state,item.value,[...here,'value']);if(!s.writes.has(item.global)){s.writes.add(item.global);grew();}}
      else if(item.kind==='assign'){
        const v=expression(s,state,item.value,[...here,'value']),target=location(item.target);
        if(target.kind==='global'){if(!s.writes.has(target.global)){s.writes.add(target.global);grew();}}else if(v)state.set(target.binding,copy(v));
      }else if(item.kind==='return'||item.kind==='expression'){
        const v=expression(s,state,item.value,[...here,'value']);
        if(item.kind==='return'){if(s.returns){const n=join(s.returns,v);if(!equal(s.returns,n)){s.returns=n;grew();}}live=false;}
      }else if(item.kind==='block'){const out=body(s,state,item.body,[...here,'body']);state=out.state;live=out.live;}
      else if(item.kind==='if'){
        expression(s,state,item.condition,[...here,'condition']);
        const a=body(s,clone(state),item.thenBody,[...here,'thenBody']),b=body(s,clone(state),item.elseBody,[...here,'elseBody']);
        live=a.live||b.live;state=a.live&&b.live?mergeStates(a.state,b.state):a.live?a.state:b.state;
      }else if(item.kind==='while'){
        const incoming=clone(state);let head=clone(state);
        while(true){step();const condition=clone(head);expression(s,condition,item.condition,[...here,'condition']);const out=body(s,clone(condition),item.body,[...here,'body']);const next=out.live?mergeStates(incoming,out.state):clone(incoming);state=condition;if(equalStates(head,next))break;head=next;}
      }
    }return {state,live};
  }
  const roots=new Set([...hir.closure.roots.map(r=>r.target),...hir.closure.initialization]);
  for(const id of roots){const s=reach(id);s.fn.parameters.forEach((p,i)=>{if(callable(p.type)){merge(s.parameters,i,top());if(records)observe(id,i,top(),id,null,p.range,true);}});}
  while(true){
    do{
      dirty=false;
      for(const s of summaries.values())if(s.reached){step();const state=new Map();for(const [i,t]of s.parameters)state.set(s.fn.parameters[i].id,copy(t));body(s,state,s.fn.body,['body']);}
    }while(dirty);
    let added=false;
    for(const [key,site]of sites)if(!site.targets.top&&site.targets.ids.size===0&&!forced.has(key)){forced.add(key);added=true;}
    if(!added)break;
  }
  const fnRows=[...summaries.values()].filter(s=>s.reached).sort((a,b)=>compare(a.fn.id,b.fn.id)).map(s=>({functionId:s.fn.id,parameters:[...s.parameters].map(([index,t])=>({index,targets:wire(t)})),returns:s.returns===null?null:wire(s.returns),unknownEffects:s.unknownEffects}));
  const calls=[...sites.values()].sort((a,b)=>compare(a.functionId,b.functionId)||compare(canonical(a.expressionPath),canonical(b.expressionPath))).map(s=>({...s,targets:wire(s.targets)}));
  const closed=t=>!t.top&&t.functions.length>0;
  const report={complete:fnRows.every(f=>!f.unknownEffects&&f.parameters.every(p=>closed(p.targets))&&(f.returns===null||closed(f.returns)))&&calls.every(c=>closed(c.targets)),functions:fnRows,calls};
  return {report,summaries,observations:[...observations.values()].map(o=>({...o,targets:wire(o.targets)}))};
}
