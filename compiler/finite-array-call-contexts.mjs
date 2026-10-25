// SPDX-License-Identifier: MIT
// Normal-return transfers replay the existing memory-version walker. Requests
// contain formal-relative owners and SSA symbols, never caller allocations.
import {canonical} from './identity.mjs';

export function createArrayCallContexts(charge,clone,replay) {
  const nodes=new Map(),queue=[];let current=null,running=false;
  const enqueue=node=>{charge();if(!node.queued&&!node.summary){node.queued=true;queue.push(node);}};
  const sorted=values=>values.sort((a,b)=>{charge();return a[0]<b[0]?-1:a[0]>b[0]?1:0;});
  function normalize(fn,actual,state) {
    const owners=new Map(),symbols=new Map(),argumentsRelative=[];
    for(const [index]of fn.parameters.entries()) {
      charge();const value=actual[index]??{},relative={};
      if(value.owner) {
        if(!owners.has(value.owner)){charge();owners.set(value.owner,fn.id+'/incoming/'+
          (value.owner.includes('/parameter/')?'parameter/':'array/')+owners.size);}
        relative.owner=owners.get(value.owner);
      }
      if(value.symbol) {
        if(!symbols.has(value.symbol)){charge();symbols.set(value.symbol,fn.id+'/incoming-index/'+symbols.size);}
        relative.symbol=symbols.get(value.symbol);
      }
      for(const key of ['constant','truth','offset','limit']) {
        charge();if(value[key]!==undefined)relative[key]=value[key];
      }
      argumentsRelative.push(relative);
    }
    const memory=new Map(),identity=[];
    for(const [owner,relative]of owners) {
      charge();const row=state.get(owner);if(!row)continue;
      const slots=new Map(),entries=[];
      for(const [slot,versions]of row.slots) {
        charge();const mapped=slot.startsWith('s:')?symbols.get(slot.slice(2)):slot;
        if(!mapped)continue;const key=slot.startsWith('s:')?'s:'+mapped:mapped,copy=new Set(),ids=[];
        for(const version of versions){charge();copy.add(version);ids.push(version);}
        ids.sort((a,b)=>{charge();return a<b?-1:a>b?1:0;});slots.set(key,copy);entries.push([key,ids]);
      }
      memory.set(relative,{length:row.length,slots});identity.push([relative,row.length,sorted(entries)]);
    }
    sorted(identity);
    return {key:canonical([fn.id,argumentsRelative,identity]),argumentsRelative,memory,owners,symbols};
  }
  function instantiate(summary,request,state) {
    const result=clone(state),symbols=new Map(),mutated=new Set();
    for(const [actual,relative]of request.symbols){charge();symbols.set(relative,actual);}
    if(summary.invalidateAll)for(const row of result.values()){charge();row.length=null;row.slots.clear();}
    for(const [actual,relative]of request.owners) {
      charge();if(!summary.mutated.has(relative))continue;mutated.add(actual);
      // Unpassed host parameters may still alias an affected actual parameter.
      // A formal template must not hide that invalidation from its caller.
      if(actual.includes('/parameter/'))for(const [owner,row]of result) {
        charge();if(owner!==actual&&owner.includes('/parameter/')){row.length=null;row.slots.clear();}
      }
    }
    for(const [actual,relative]of request.owners) {
      charge();const row=summary.state.get(relative);
      if(!row){result.delete(actual);continue;}
      const slots=new Map();for(const [slot,versions]of row.slots) {
        charge();const mapped=slot.startsWith('s:')?symbols.get(slot.slice(2)):slot;
        if(!mapped)continue;const copied=new Set();
        for(const version of versions){charge();copied.add(version);}
        slots.set(slot.startsWith('s:')?'s:'+mapped:mapped,copied);
      }
      result.set(actual,{length:row.length,slots});
    }return {state:result,invalidateAll:summary.invalidateAll,mutated};
  }
  return {
    resolve(fn,actual,state) {
      charge();
      const request=normalize(fn,actual,state);let node=nodes.get(request.key);
      if(!node) {
        charge();node={fn,argumentsRelative:request.argumentsRelative,memory:request.memory,
          parents:new Set(),summary:null,queued:false};nodes.set(request.key,node);enqueue(node);
      }
      if(current&&!node.summary){charge();node.parents.add(current);}
      if(!running) {
        running=true;
        try{for(let index=0;index<queue.length;++index) {
          charge();const next=queue[index];next.queued=false;current=next;
          const bindings=new Map();for(const [index,parameter]of next.fn.parameters.entries()) {
            charge();bindings.set(parameter.id,next.argumentsRelative[index]);
          }
          const summary=replay(next.fn,clone(next.memory),bindings);
          // A false-context base write cannot close a true-context cycle. No
          // provisional output is published while any reached call is pending.
          if(summary.complete&&summary.productive) {
            charge();next.summary=summary;
            for(const parent of next.parents){charge();enqueue(parent);}
          }
        }}finally{queue.length=0;current=null;running=false;}
      }
      return node.summary?instantiate(node.summary,request,state):null;
    },
  };
}
