// SPDX-License-Identifier: MIT
// This graph contains uses, not heap reachability. The actual-flow adapter is
// responsible for selecting storage versions and proving owner identities.
import {commonCheck as check} from './common-program-common.mjs';
export function commonBorrowGraph(spend) {
  const points=new Map(),borrows=new Map(),fresh=new Set(),escapes=[];
  const point=id=>{spend();if(!points.has(id)){check(points.size<65536,'limit');points.set(id,{id,uses:new Set(),defines:new Set(),edges:new Set(),effects:[],origin:null});}return points.get(id);};
  const add=(set,id)=>{spend();set.add(id);check(set.size<=4096,'limit');};
  const edge=(from,to)=>add(point(from).edges,to);
  const define=(at,id,owners,weak=false)=>{
    spend(owners.ids.size+1);let row=borrows.get(id);
    if(!row){check(borrows.size<4096,'limit');row={id,owners:new Set(),pending:false};borrows.set(id,row);}
    for(const owner of owners.ids)add(row.owners,owner);row.pending ||= owners.pending;
    // Repeated definitions summarize distinct live descriptors. Killing the
    // family at a later iteration would forget an earlier retained descriptor.
    if(!weak)add(point(at).defines,id);
  };
  const use=(at,ids)=>{for(const id of ids)add(point(at).uses,id);};
  const effect=(at,owners,origin,eligible=null)=>{spend(owners.ids.size+1+(eligible?.size??0));check(eligible===null||eligible.size<=4096,'limit');
    point(at).effects.push({owners:new Set(owners.ids),pending:owners.pending,origin,eligible:eligible===null?null:new Set(eligible)});};
  const escape=(at,ids,allowed,origin)=>{spend(ids.size+1);if(ids.size)escapes.push({at,ids:new Set(ids),allowed,origin});};
  function verify() {
    for(const row of escapes){spend();check(typeof row.allowed==='function'?row.allowed():row.allowed,'borrow-pending','borrow escapes unproved storage lifetime',row.origin);}
    for(const p of points.values()){spend();for(const id of p.uses){spend();const row=borrows.get(id);
      check(row&&row.owners.size>0&&!row.pending,'borrow-pending','ReadSpan use has no proved actual owner',p.origin??{});}}
    const live=new Map(),predecessors=new Map(),ordinals=new Map(),ordered=[];let dirty=new Set();
    spend(points.size);for(const p of points.values()){
      spend();ordinals.set(p.id,ordered.length);ordered.push(p);live.set(p.id,new Set());predecessors.set(p.id,new Set());
      if(p.uses.size){spend();dirty.add(ordinals.get(p.id));}
    }
    // Validate even components without uses. Predecessors are points, not
    // borrows: a legal fan-in can exceed the 4096 descriptor/edge bound.
    for(const p of points.values()){spend();for(const to of p.edges){spend();check(live.has(to),'ssa');predecessors.get(to).add(ordinals.get(p.id));}}
    while(dirty.size){
      spend(dirty.size);const ready=[...dirty].sort((a,b)=>{spend();return a-b;}),queued=dirty,later=new Set();
      // Match the old sweep's ordinal order, including each live Set's order.
      // A changed earlier successor reaches a later predecessor this round;
      // earlier/self predecessors are deferred to the next ordered round.
      for(let head=0;head<ready.length;head++){
        spend();const index=ready[head],p=ordered[index];queued.delete(index);const next=new Set();
        for(const to of p.edges){spend();for(const id of live.get(to)){spend();if(!p.defines.has(id))add(next,id);}}
        for(const id of p.uses)add(next,id);
        const previous=live.get(p.id);let changed=next.size!==previous.size;
        if(!changed)for(const id of next){spend();if(!previous.has(id)){changed=true;break;}}
        if(!changed)continue;live.set(p.id,next);
        for(const parent of predecessors.get(p.id)){
          spend();if(parent<=index){later.add(parent);continue;}if(queued.has(parent))continue;
          let low=head+1,high=ready.length;while(low<high){spend();const middle=(low+high)>>>1;if(ready[middle]<parent)low=middle+1;else high=middle;}
          check(ready.length<points.size,'limit');spend(ready.length-low+1);ready.splice(low,0,parent);queued.add(parent);
        }
      }
      dirty=later;
    }
    for(const p of points.values()){spend();for(const effect of p.effects){spend();
      const active=new Set();for(const id of p.uses)add(active,id);
      for(const to of p.edges){spend();for(const id of live.get(to))add(active,id);}
      for(const id of active){spend();if(effect.eligible!==null&&!effect.eligible.has(id))continue;const borrow=borrows.get(id);check(borrow,'borrow-pending','borrow has no proved definition',effect.origin);
        let overlap=false,pending=borrow.pending||effect.pending;
        for(const owner of borrow.owners)for(const modified of effect.owners){spend();if(owner===modified)overlap=true;
          else if(!fresh.has(owner)||!fresh.has(modified))pending=true;}
        check(!overlap,'borrow-conflict','structural modification overlaps a live ReadSpan',effect.origin);
        check(!pending,'borrow-pending','live ReadSpan owner separation is unproved',effect.origin);
      }
    }}
    return {points:points.size,borrows:borrows.size};
  }
  return {point,edge,define,use,effect,escape,fresh,verify};
}
