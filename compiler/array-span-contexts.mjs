// SPDX-License-Identifier: MIT
// Parameter-relative summaries replay the existing Source walker. A recursive
// edge is complete only after a productive, dependency-free normal exit; an
// active key never supplies its own evidence. No payloads or owners are seeded.
export function createSpanContexts(tools,charge){
  const nodes=new Map(),queue=[];let current=null,running=false;
  const enqueue=node=>{charge();if(!node.queued&&!node.summary){node.queued=true;queue.push(node);}};
  return {
    resolve(fn,facts,aliases,replay){
      const values=[];let known=false;
      for(const fact of facts){charge();const value=typeof fact==='boolean'?fact:null;values.push(value);known||=value!==null;}
      if(!known)return null;
      const groups=[];for(const group of aliases){charge();groups.push(group);}
      const key=tools.key({functionId:fn.id,booleans:values,aliases:groups});
      let node=nodes.get(key);
      if(!node){node={fn,context:{facts:values,aliases:groups},parents:new Set(),summary:null,queued:false};nodes.set(key,node);enqueue(node);}
      if(current&&!node.summary){charge();node.parents.add(current);}
      if(running)return node.summary;
      // An unresolved child queues its parent again only after completing.
      // Cyclic keys cannot publish themselves; all work uses the caller meter.
      running=true;
      try{for(let index=0;index<queue.length;++index){
        charge();const next=queue[index];next.queued=false;current=next;
        const summary=replay(next.fn,next.context);
        charge();if(summary?.productive&&!summary.requirements.some(row=>{charge();return row.kind==='dependency';})){
          next.summary=summary;for(const parent of next.parents){charge();enqueue(parent);}
        }
      }}finally{queue.length=0;current=null;running=false;}
      return node.summary;
    },
  };
}
