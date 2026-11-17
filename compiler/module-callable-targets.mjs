// SPDX-License-Identifier: MIT
// Two runs of this real module value-flow solver keep current bodies and fixed transfer separate.
import {canonical,compare} from './module-callable-common.mjs';
import {callableTargetDomain,fixedCallableTransfer} from './callable-target-domain.mjs';
export function solveModuleTargets(hir,records,fail){
  const functions=new Map(hir.functions.map(f=>[f.id,f])),types=new Map(hir.types.map(t=>[t.id,t]));
  const callable=t=>types.get(t)?.kind==='function';
  const summaries=new Map(),sites=new Map(),observations=new Map(),forced=new Set();let work=0,growth=0,siteCount=0,dirty=false;
  const step=(amount=1)=>{work+=amount;if(work>1000000)fail('limit');};
  const grew=()=>{if(++growth>200000)fail('limit');dirty=true;};
  const domain=callableTargetDomain(functions,step,fail,compare),{bottom,top,wire,from,join,equal}=domain;
  // Target values are immutable inside this solver. A transfer may replace a
  // binding, but it never edits the targets saved by another binding or branch.
  const singletons=new Map();
  function singleton(id){
    if(!singletons.has(id))singletons.set(id,domain.single(id));
    return singletons.get(id);
  }
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
    if(!sites.has(key)){
      if(siteCount>=16384)fail('limit');
      siteCount++;
      sites.set(key,{functionId:summary.fn.id,expressionPath:path,kind:value.kind,range:value.range,targets:bottom()});grew();
    }
    const row=sites.get(key),n=join(row.targets,t);if(!equal(row.targets,n)){row.targets=n;grew();}return key;
  }
  function expression(s,state,v,path){
    step();
    if(v.kind==='functionReference')return singleton(v.target);
    if(v.kind==='reference')return callable(v.type)?(state.get(v.binding)??bottom()):null;
    if(v.kind==='global'){if(!s.reads.has(v.global)){s.reads.add(v.global);grew();}return null;}
    if(v.kind==='call'||v.kind==='indirectCall'){
      let saved=v.kind==='call'?singleton(v.target):expression(s,state,v.callee,[...path,'callee']);
      if(!saved)fail('identity');
      const args=v.arguments.map((a,i)=>expression(s,state,a,[...path,'arguments',i]));
      const key=s.fn.id+'\0'+canonical(path);if(forced.has(key))saved=join(saved,top());note(s,v,path,saved);
      let result=callable(v.type)?bottom():null;
      for(const id of [...saved.ids].sort(compare)){
        const callee=reach(id);if(callee.fn.signature!==v.signature)fail('identity');
        let returned=callee.returns;
        if(records)returned=fixedCallableTransfer(records.get(id),args,domain,(i,value)=>observe(id,i,value,s.fn.id,path,v.arguments[i].range),step,fail);
        else callee.fn.parameters.forEach((p,i)=>{if(callable(p.type)){if(!args[i])fail('identity');merge(callee.parameters,i,args[i]);}});
        if(result)result=join(result,returned);
        if(records&&records.get(id).upper.unknown)unknownCall(s,args,v,path);
      }
      if(saved.top){unknownCall(s,args,v,path);if(result)result=join(result,top());}
      return result;
    }
    if(v.kind==='group'||v.kind==='unary')return expression(s,state,v.operand,[...path,'operand']);
    if(v.kind==='binary'||v.kind==='shortCircuit'){expression(s,state,v.left,[...path,'left']);expression(s,state,v.right,[...path,'right']);return null;}
    return null;
  }
  function cloneState(state){
    step(state.size);
    return new Map(state);
  }
  function mergeStates(a,b){
    const out=cloneState(a);
    for(const [key,right]of b){
      step();
      const left=out.get(key);
      out.set(key,left===undefined||left===right?right:join(left,right));
    }
    return out;
  }
  function joinLoopTargets(unions,left,right){
    if(left===undefined||left===right)return right;
    let byRight=unions.get(left);
    const cached=byRight?.get(right);
    if(cached!==undefined)return cached;
    step();
    if(!byRight){byRight=new WeakMap();unions.set(left,byRight);}
    const joined=join(left,right);
    let result=joined;
    if(joined.top===left.top&&joined.ids.size===left.ids.size)result=left;
    else if(joined.top===right.top&&joined.ids.size===right.ids.size){
      // Reuse an operand only if it keeps the union's left-to-right iteration order.
      const rightIds=right.ids.values();
      let sameOrder=true;
      for(const id of joined.ids){step();if(id!==rightIds.next().value){sameOrder=false;break;}}
      if(sameOrder)result=right;
    }
    byRight.set(right,result);
    return result;
  }
  function location(v){return v.kind==='group'?location(v.operand):v;}
  function body(s,state,items,path){
    let live=true;
    for(const [i,item]of items.entries()){
      if(!live)break;step();const here=[...path,i];
      if(item.kind==='local'){const v=expression(s,state,item.initializer,[...here,'initializer']);if(v)state.set(item.binding.id,v);}
      else if(item.kind==='initialize'){expression(s,state,item.value,[...here,'value']);if(!s.writes.has(item.global)){s.writes.add(item.global);grew();}}
      else if(item.kind==='assign'){
        const v=expression(s,state,item.value,[...here,'value']),target=location(item.target);
        if(target.kind==='global'){if(!s.writes.has(target.global)){s.writes.add(target.global);grew();}}else if(v)state.set(target.binding,v);
      }else if(item.kind==='return'||item.kind==='expression'){
        const v=expression(s,state,item.value,[...here,'value']);
        if(item.kind==='return'){if(s.returns){const n=join(s.returns,v);if(!equal(s.returns,n)){s.returns=n;grew();}}live=false;}
      }else if(item.kind==='block'){const out=body(s,state,item.body,[...here,'body']);state=out.state;live=out.live;}
      else if(item.kind==='if'){
        expression(s,state,item.condition,[...here,'condition']);
        const a=body(s,cloneState(state),item.thenBody,[...here,'thenBody']),b=body(s,cloneState(state),item.elseBody,[...here,'elseBody']);
        live=a.live||b.live;state=a.live&&b.live?mergeStates(a.state,b.state):a.live?a.state:b.state;
      }else if(item.kind==='while'){
        const incoming=state,headChanges=new Map(),unions=new WeakMap();
        let working=cloneState(incoming);
        while(true){
          step();expression(s,working,item.condition,[...here,'condition']);
          const out=body(s,working,item.body,[...here,'body']);
          // Statement liveness is structural. A body with no normal successor
          // contributes no backedge, so the head stays at its first input.
          if(!out.live){state=incoming;break;}
          working=out.state;
          let changed=false,orderedRestores;
          // The body only replaces or adds keys. Read the previous head from
          // its overlay and merge back into the writable map in one paid pass.
          for(const [key,value]of working){
            step();
            const entry=incoming.get(key),previous=headChanges.get(key)??entry;
            const joined=joinLoopTargets(unions,entry,value);
            working.set(key,joined);
            if(joined===previous)continue;
            if(!changed){
              if(previous===undefined||previous.top!==joined.top||previous.ids.size!==joined.ids.size||!equal(previous,joined))
                changed=true;
              else {
                step();
                (orderedRestores??=[]).push([key,previous]);
              }
            }
            if(joined===entry)headChanges.delete(key);
            else headChanges.set(key,joined);
          }
          if(!changed){
            // With semantic equality, keep the old head's target iteration order.
            for(const [key,value]of orderedRestores??[]){step();working.set(key,value);}
            state=working;break;
          }
        }
      }
    }return {state,live};
  }
  const roots=new Set([...hir.closure.roots.map(r=>r.target),...hir.closure.initialization]);
  for(const id of roots){const s=reach(id);s.fn.parameters.forEach((p,i)=>{if(callable(p.type)){merge(s.parameters,i,top());if(records)observe(id,i,top(),id,null,p.range,true);}});}
  function solve(active=summaries){
    while(true){
      do{
        dirty=false;
        for(const s of active.values())if(s.reached){step();const state=new Map();for(const [i,t]of s.parameters){step();state.set(s.fn.parameters[i].id,t);}body(s,state,s.fn.body,['body']);}
      }while(dirty);
      let added=false;
      for(const [key,site]of sites){
        if(active!==summaries)step();
        if(!site.targets.top&&site.targets.ids.size===0&&!forced.has(key)){forced.add(key);added=true;}
      }
      if(!added)break;
    }
  }
  function result(selected=summaries){
    const fnRows=[...selected.values()].filter(s=>s.reached).sort((a,b)=>compare(a.fn.id,b.fn.id)).map(s=>({functionId:s.fn.id,parameters:[...s.parameters].map(([index,t])=>({index,targets:wire(t)})),returns:s.returns===null?null:wire(s.returns),unknownEffects:s.unknownEffects}));
    const calls=[...sites.values()].sort((a,b)=>{
      if(selected!==summaries)step();
      return compare(a.functionId,b.functionId)||compare(canonical(a.expressionPath),canonical(b.expressionPath));
    }).map(s=>({...s,targets:wire(s.targets)}));
    const closed=t=>!t.top&&t.functions.length>0;
    const report={complete:fnRows.every(f=>!f.unknownEffects&&f.parameters.every(p=>closed(p.targets))&&(f.returns===null||closed(f.returns)))&&calls.every(c=>closed(c.targets)),functions:fnRows,calls};
    const selectedObservations=[...observations.values()].map(o=>({...o,targets:wire(o.targets)}));
    return {report,summaries:selected,observations:selectedObservations};
  }
  function inspectRemaining(){
    const remaining=new Map();
    for(const summary of summaries.values())if(!summary.reached&&summary.fn.kind==='source'){
      step();remaining.set(summary.fn.id,reach(summary.fn.id));
    }
    if(!remaining.size)return null;
    // Fixed parameters seed these bodies without adding input roots. Selected
    // result rows are already materialized, so only new sites belong here.
    sites.clear();observations.clear();forced.clear();
    solve(remaining);
    return result(remaining);
  }
  solve();
  return {...result(),inspectRemaining};
}
