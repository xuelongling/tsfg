// SPDX-License-Identifier: MIT
// Adapt the independently owned catalogue to the established M12 witness
// verifier. Source edges are retained; names never synthesize member mappings.
import {verifyReferenceWitness} from './reference-relations.mjs';
import {byteOrder,check} from './typed-array-schema.mjs';
import {typedArrayRepresentation} from './typed-array-representation.mjs';
import {typedArrayWitnesses} from './typed-array-witnesses.mjs';
import {typedReferenceWeights} from './typed-array-type-graphs.mjs';

export function typedArrayRelations(types,functions,records,profile=undefined) {
  const state={types:new Map(),classes:new Map(),methods:new Map(),symbols:new Map()},fields=new Map();
  for(const type of types.values())for(const field of type.fields??[])fields.set(field.id,field);
  for(const type of types.values())if(type.kind==='reference') {
    const fields=type.fields.map(field=>({id:field.id,symbol:field.id,name:field.name,optional:field.propertyPresence?.optional===true}));
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
  let remaining=100000;
  const spend=(amount=1)=>{remaining-=amount;check(remaining>=0,'limit');};
  const weights=typedReferenceWeights(state.classes,spend);
  const representation=typedArrayRepresentation(types,spend);
  const witnesses=typedArrayWitnesses(records,spend);
  function validate(proof,reference,missingOptionalProperties) {
    const from=proof.sourceType,to=proof.targetType;
    check(types.get(from)?.kind==='reference'&&types.get(to)?.kind==='reference','compatibility');
    spend(weights.get(from)+weights.get(to)+proof.members.length);
    const missing=profile?profile.validateMissing(state,proof,missingOptionalProperties,spend):undefined;
    verifyReferenceWitness(state,proof,from,to,proof.origin,missing);
    const selected=new Map();
    function slot(from,to) {
      const choice=representation.logical(from,to,reference);check(choice!==null,'representation');
      representation.merge(selected,choice);
    }
    for(const member of proof.members) {
      const source=fields.get(member.source),target=fields.get(member.target);
      if(source&&target)slot(source.type,target.type);
      else {
        const source=functions.get(member.source),target=functions.get(member.target);
        check(source&&target,'compatibility');
        if(target.returnType!=='void')slot(source.returnType,target.returnType);
        for(let i=0;i<Math.min(source.parameters.length,target.parameters.length);i++)
          slot(target.parameters[i].declaredType,source.parameters[i].declaredType);
      }
    }
    return selected;
  }
  function expression(value,expected,anchor) {
    const selected=value.compatibilityRoots??[],roots=new Map(),used=new Map();let previous;
    check(!value.compatibilityRoots||selected.length>0,'compatibility-root');
    for(const pair of selected) {
      spend();check(!previous||byteOrder(previous.sourceType,pair.sourceType)<0
        ||previous.sourceType===pair.sourceType&&byteOrder(previous.targetType,pair.targetType)<0,'compatibility-order');
      previous=pair;roots.set(pair.sourceType+'\0'+pair.targetType,witnesses.select(pair,anchor));
    }
    function reference(from,to) {
      spend();return roots.has(from+'\0'+to);
    }
    if(value.kind==='as')representation.merge(used,representation.assertion(value.expression.flowType,value.flowType,reference));
    else if(roots.size)check(expected,'compatibility-context');
    if(expected) {
      const choice=representation.logical(value.flowType,expected,reference);check(choice!==null,'slot');
      representation.merge(used,choice);
    }
    check(used.size===roots.size,'compatibility-root');
    for(const key of used.keys())witnesses.verify(roots.get(key),validate);
  }
  function entry(row) {
    // Follow payload members, not the nominal base as an additional payload.
    // Inherited fields and method headers still contribute their real types.
    const targets=new Set(),seen=new Set(),pending=[row.viewType];
    while(pending.length) {
      spend();const id=pending.pop();if(seen.has(id))continue;seen.add(id);
      const type=types.get(id);check(type,'type');
      if(type.kind==='reference')targets.add(id);
      if(type.kind==='union')pending.push(...type.members);
      if(['array','readSpan'].includes(type.kind))pending.push(type.elementType);
      if(['reference','value'].includes(type.kind)) {
        let owner=type;const bases=new Set();
        while(owner) {
          spend();check(!bases.has(owner.id),'type');bases.add(owner.id);
          for(const field of owner.fields??[]){spend();pending.push(field.type);}
          for(const method of owner.methods??[]) {
            spend();const fn=functions.get(method);check(fn,'function');
            pending.push(fn.returnType,...fn.parameters.map(parameter=>parameter.declaredType));
          }
          owner=types.get(owner.base);
        }
      }
    }
    let previous;
    for(const pair of row.roots) {
      spend();check(!previous||byteOrder(previous.sourceType,pair.sourceType)<0
        ||previous.sourceType===pair.sourceType&&byteOrder(previous.targetType,pair.targetType)<0,'compatibility-order');
      previous=pair;
      check(pair.sourceType!==pair.targetType&&types.get(pair.sourceType)?.kind==='reference'
        &&targets.has(pair.targetType),'compatibility-entry');
      witnesses.verify(witnesses.select(pair,row.origin),validate);
    }
  }
  return {expression,entry,finish:witnesses.finish};
}
