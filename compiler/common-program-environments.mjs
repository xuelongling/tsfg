// SPDX-License-Identifier: MIT
// Stable lexical layouts are separate from actual activation instances. Raw
// binding/range provenance is retained in HIR but never hashes a stable slot.
import {lexicalEnvironmentLayouts} from './lexical-environment-layouts.mjs';
import {commonIdentity} from './common-program-identities.mjs';
import {commonCheck as check,commonFailure} from './common-program-common.mjs';
import {commonCaptureType,commonLexicalScopes} from './common-program-lexical.mjs';
export function commonEnvironments(functions,types,spend) {
  spend(functions.length);const byId=new Map(functions.map(fn=>[fn.id,fn])),bindings=new Map(),ownedSlots=new Map(),slots=new Map();
  const scopes=new Map(functions.map(fn=>[fn.id,commonLexicalScopes(fn,spend)]));
  for(const fn of functions){spend(fn.parameters.length+fn.bindings.length);for(const group of [fn.parameters,fn.bindings])for(const row of group){spend();check(!bindings.has(row.id),'binding');bindings.set(row.id,{...row,owner:fn.id});}}
  for(const fn of functions)for(const capture of fn.captures){
    spend();const binding=bindings.get(capture.binding);check(binding&&binding.owner!==fn.id,'capture');
    let parent=fn.lexicalParent;const seen=new Set();while(parent&&parent!==binding.owner){spend();check(!seen.has(parent)&&byId.has(parent),'capture');seen.add(parent);parent=byId.get(parent).lexicalParent;}
    check(parent===binding.owner,'capture');const owner=byId.get(binding.owner),supported=commonCaptureType(binding.type,types,spend);
    const declaration=scopes.get(owner.id).get(binding.id),path=declaration?.scope.path??[],
      local=binding.kind==='local'&&supported&&declaration?.row.initializer&&(!path.length
        ||declaration.scope.eligible&&!declaration.scope.repeated&&types.get(binding.type).kind!=='readSpan');
    const parameter=binding.kind==='parameter'&&supported&&owner.parameters.some(row=>{spend();return row.id===binding.id;});
    check(local||parameter,'capability','capture requires an initialized supported local or original parameter; block ReadSpan requires independent borrow lifetime qualification');
    if(slots.has(binding.id))continue;const key=commonIdentity('capture-slot',{owner:binding.owner,name:binding.name,kind:binding.kind,...(path.length?{scope:path}:{})});
    const slot={binding:binding.id,key,type:binding.type,writable:binding.writable,kind:binding.kind};slots.set(binding.id,slot);
    if(!ownedSlots.has(binding.owner))ownedSlots.set(binding.owner,[]);ownedSlots.get(binding.owner).push(slot);
  }
  const graph=lexicalEnvironmentLayouts(byId,ownedSlots,spend,message=>commonFailure('environment',message),
    ({owner,parent,slots})=>{spend(slots.length);return commonIdentity('environment-layout',{owner,parent,slots:slots.map(({key,type,writable,kind})=>({key,type,writable,kind}))});},
    (left,right)=>left.key<right.key?-1:left.key>right.key?1:0);
  spend(graph.layouts.size);const environments=[...graph.layouts.values()];environments.sort((a,b)=>{spend();return a.id<b.id?-1:a.id>b.id?1:0;});
  const metadata=fn=>({lexicalEnvironment:graph.nearestLayout(fn.lexicalParent)?.id??null,activationEnvironment:graph.layouts.get(fn.id)?.id??null});
  return {environments,slots,metadata};
}
