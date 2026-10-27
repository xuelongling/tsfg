// SPDX-License-Identifier: MIT
// Source entry authority is occurrence-specific. Cold validation joins original
// exported parameters; the owned selector then instantiates their actual bounds.
import {byteOrder} from './typed-array-schema.mjs';
import {commonCheck as check,commonSame as same,canonical} from './common-program-common.mjs';

export function validateCommonEntryRoots(payload,functions,relation,spend) {
  spend(payload.modules.length);const root=payload.modules.find(row=>row.sourcePath===payload.rootFile);check(root,'module');
  spend(root.exports.length+payload.exports.length);const declared=[];
  for(const row of root.exports)if(row.kind==='function')declared.push({name:row.name,functionId:row.target});
  check(same(payload.exports,declared),'export');const expected=new Map();
  for(const {functionId}of declared){spend();const fn=functions.get(functionId);check(fn&&!fn.ownerType,'compatibility-entry');
    spend(fn.parameters.length);for(const parameter of fn.parameters)expected.set(functionId+'\0'+parameter.id,{fn,parameter});}
  let previous;
  for(const row of payload.entryCompatibilityRoots){
    spend();const key=row.functionId+'\0'+row.parameterBinding,owned=expected.get(key);
    check(owned&&owned.parameter.declaredType===row.viewType&&same(row.origin,{source:owned.fn.sourcePath,...owned.parameter.declarationRange}),'compatibility-entry');
    check(!previous||byteOrder(previous,key)<0,'compatibility-order');previous=key;expected.delete(key);relation.entry(row);
  }
  check(expected.size===0,'compatibility-entry');
}

export function commonEntryReferences(hir,spend) {
  spend(2*hir.types.length+hir.functions.length);const types=new Map(hir.types.map(row=>[row.id,row])),rawTypes=new Map(hir.types.map(row=>[row.sourceType,row.id]));
  const functions=new Map(hir.functions.map(fn=>[fn.sourceBinding,fn.id])),entries=new Map(),references=[],fields=new Map(),rawFields=new Map(),members=new Map(),origins=new Map();
  for(const type of types.values()){spend();if(type.kind==='reference')references.push(type);
    spend(type.fields?.length??0);for(const field of type.fields??[]){fields.set(field.id,field);rawFields.set(field.sourceBinding,field.id);}}
  for(const record of hir.snapshot.payload.compatibilityWitnesses){
    const proof=record.compatibility;spend(proof.members.length+1);const key=canonical(proof.origin);
    if(!origins.has(key))origins.set(key,new Map());const mapped=new Map();
    for(const pair of proof.members){const from=rawFields.get(pair.source),to=rawFields.get(pair.target);if(from&&to)mapped.set(from,to);}
    origins.get(key).set(rawTypes.get(proof.sourceType)+'\0'+rawTypes.get(proof.targetType),mapped);
  }
  const visibleFields=id=>{
    spend();if(members.has(id))return members.get(id);const result=new Set(),seen=new Set();let current=types.get(id);
    while(current){spend();check(!seen.has(current.id),'type');seen.add(current.id);spend(current.fields?.length??0);
      for(const field of current.fields??[])result.add(field.id);current=types.get(current.base);}
    members.set(id,result);return result;
  };
  for(const row of hir.snapshot.payload.entryCompatibilityRoots){
    spend(row.roots.length+1);const fn=functions.get(row.functionId);check(fn,'compatibility-entry');const roots=new Map();
    for(const pair of row.roots){const from=rawTypes.get(pair.sourceType),to=rawTypes.get(pair.targetType);check(from&&to,'compatibility-entry');
      if(!roots.has(to))roots.set(to,new Set());roots.get(to).add(from);}
    entries.set(fn+'\0'+row.parameterBinding,{roots,cache:new Map(),members:origins.get(canonical(row.origin))});
  }
  return (fn,parameter)=>{
    const entry=entries.get(fn+'\0'+parameter);if(!entry)return undefined;
    const sources=target=>{
      spend();if(entry.cache.has(target))return entry.cache.get(target);const selected=new Set([target]);
      // Nominal descendants use the independently verified base edges. Other
      // structural sources require this exact exported parameter's M12 roots.
      for(const candidate of references){let current=candidate;const seen=new Set();
        while(current){spend();check(!seen.has(current.id),'type');seen.add(current.id);
          if(current.id===target){selected.add(candidate.id);check(selected.size<=256,'limit');break;}current=types.get(current.base);}}
      for(const source of entry.roots.get(target)??[]){spend();selected.add(source);check(selected.size<=256,'limit');}
      check(selected.size<=256,'limit');spend(selected.size);const result=[...selected];entry.cache.set(target,result);return result;
    };
    return {sources,field(actual,view,source){
      spend();if(visibleFields(view).has(source))return fields.get(source).type;
      const target=entry.members?.get(actual+'\0'+view)?.get(source);return target?fields.get(target).type:undefined;
    }};
  };
}
