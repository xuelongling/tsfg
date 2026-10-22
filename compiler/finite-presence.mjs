// SPDX-License-Identifier: MIT
// Presence is an actual-payload fact, never Boolean truthiness or a declared
// type filter. Unknown evidence keeps both continuations possible.
export const isFiniteAbsence=kind=>kind==='null'||kind==='undefined';
export function finitePresence(plan,types,charge) {
  const nodes=new Map(),domains=new Map();
  for(const row of plan.nodes){charge();nodes.set(row.id,row);}
  for(const row of plan.domains){charge();domains.set(row.id,row);}
  return path=>{
    charge();const node=nodes.get(path),actual=domains.get(node?.domainId)?.actualTypes;
    if(!node||node.pending.length||!actual?.length)return {present:true,absent:true};
    let present=false,absent=false;
    for(const id of actual){charge();const kind=types.get(id)?.kind;
      if(!kind)return {present:true,absent:true};
      if(isFiniteAbsence(kind))absent=true;else present=true;}
    return {present,absent};
  };
}
