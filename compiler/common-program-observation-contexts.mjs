// SPDX-License-Identifier: MIT
// Project solved contexts onto printed public activations. This changes no
// value, heap, frame, completion, capacity, record or solver reachability.
export function commonPublicObservationContexts(contexts,spend){
  spend(contexts.size*2);const selected=new Set(),pending=[],callees=new Map();
  for(const context of contexts.values()){
    spend();if(context.plan.owner.analysisOnly)continue;
    if(context.root){spend();selected.add(context.id);pending.push(context.id);}
    spend(context.callers.size*2);
    for(const caller of context.callers){
      let rows=callees.get(caller);if(!rows){rows=[];callees.set(caller,rows);}rows.push(context.id);
    }
  }
  for(let index=0;index<pending.length;index++){
    spend();const rows=callees.get(pending[index]);spend(rows?.length??0);
    for(const id of rows??[])if(!selected.has(id)){selected.add(id);pending.push(id);}
  }
  return selected;
}
