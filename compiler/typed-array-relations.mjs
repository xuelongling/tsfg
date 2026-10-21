// SPDX-License-Identifier: MIT
// Adapt the independently owned catalogue to the established M12 witness
// verifier. Source edges are retained; names never synthesize member mappings.
import {verifyReferenceWitness} from './reference-relations.mjs';
import {check} from './typed-array-schema.mjs';

export function typedArrayRelations(types,functions) {
  const state={types:new Map(),classes:new Map(),methods:new Map(),symbols:new Map()};
  for(const type of types.values())if(type.kind==='reference') {
    const fields=type.fields.map(field=>({id:field.id,symbol:field.id,name:field.name}));
    const methods=(type.methods??[]).map(id=>{
      const fn=functions.get(id);check(fn&&fn.ownerType===type.id,'compatibility');
      const method={id,symbol:id,name:fn.name,overrideTarget:fn.overrideTarget??''};
      state.methods.set(id,method);return method;
    });
    state.types.set(type.id,{kind:'class-instance',declaration:type.id});
    state.classes.set(type.id,{id:type.id,base:type.base??'',fields,methods});
    for(const field of fields)state.symbols.set(field.id,{kind:'field',name:field.name});
    for(const method of methods)state.symbols.set(method.id,{kind:'method',name:method.name});
  }
  const weights=new Map(),active=new Set();
  function weight(id) {
    if(weights.has(id))return weights.get(id);
    check(!active.has(id),'inheritance');active.add(id);
    const value=state.classes.get(id);check(value,'compatibility');
    const result=value.fields.length+value.methods.length+1+(value.base?weight(value.base):0);
    active.delete(id);weights.set(id,result);return result;
  }
  for(const id of state.classes.keys())weight(id);
  let remaining=100000;
  return (proof,anchor)=>{
    check(types.get(proof.sourceType)?.kind==='reference'&&types.get(proof.targetType)?.kind==='reference','compatibility');
    remaining-=weight(proof.sourceType)+weight(proof.targetType)+proof.members.length;
    check(remaining>=0,'limit');
    verifyReferenceWitness(state,proof,proof.sourceType,proof.targetType,anchor);
  };
}
