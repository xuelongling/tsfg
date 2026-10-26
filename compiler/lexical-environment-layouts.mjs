// SPDX-License-Identifier: MIT
// Layouts describe lexical storage, never dynamic environment instances. The
// legacy closure and complete-Program adapters keep their own slot identities
// and hash domains while sharing parent resolution and finite layout rules.
export function lexicalEnvironmentLayouts(functions,ownedSlots,spend,fail,identify,compare) {
  const layouts=new Map(),layoutIds=new Map(),active=new Set();
  function nearestLayout(id) {
    const seen=new Set();
    while(id!==null&&id!==undefined){
      spend();if(seen.has(id)||!functions.has(id))fail('invalid lexical ancestry');seen.add(id);
      if(ownedSlots.has(id))return layout(id);id=functions.get(id).lexicalParent;
    }
    return null;
  }
  function layout(id) {
    spend();if(layouts.has(id))return layouts.get(id);if(active.has(id))fail('cyclic environment layout');active.add(id);
    const fn=functions.get(id);if(!fn)fail('environment owner is not a function');const parent=nearestLayout(fn.lexicalParent);
    const source=ownedSlots.get(id);if(!source?.length)fail('empty activation layout');spend(source.length);const slots=[...source];
    slots.sort((left,right)=>{spend();return compare(left,right);});
    const payload={owner:id,parent:parent?.id??null,slots},result={id:identify(payload),...payload};
    layouts.set(id,result);layoutIds.set(result.id,result);active.delete(id);return result;
  }
  for(const id of ownedSlots.keys()){spend();layout(id);}
  return {layouts,layoutIds,nearestLayout};
}
