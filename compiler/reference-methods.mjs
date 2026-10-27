// SPDX-License-Identifier: MIT
// Owned nominal/override selection is shared by finite and whole-Program flow.
// Structural authority is supplied only as a verified original member mapping.
export function selectReferenceMethod(types,functions,actual,member,mapped,spend,fail) {
  const lineage=[],seen=new Set();let type=types.get(actual);
  while(type){spend();if(seen.has(type.id))fail('inheritance cycle');seen.add(type.id);lineage.push(type);type=types.get(type.base);}
  const implementation=target=>{
    for(const owner of lineage){
      let selected;
      for(const id of owner.methods??[]){
        spend();let current=functions.get(id),matches=false;if(!current)fail('method missing from owned directory');const visited=new Set();
        while(current){spend();if(visited.has(current.id))fail('override cycle');visited.add(current.id);
          matches ||= current.id===target;
          if(current.overrideTarget&&!functions.has(current.overrideTarget))fail('override target missing');current=functions.get(current.overrideTarget);}
        if(matches){if(selected)fail('ambiguous actual method');selected=functions.get(id);}
      }
      if(selected)return selected;
    }
    return undefined;
  };
  return implementation(member)??(mapped?implementation(mapped):undefined);
}
