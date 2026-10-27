// SPDX-License-Identifier: MIT
// Construction facts are checked against actual declarations before projection.
import {canonical} from './identity.mjs';
import {check,sourceRange,signatureId,byteOrder} from './typed-array-schema.mjs';
export function validateTypedArrayConstruction(payload,types,sources) {
  const functions=new Map(payload.functions.map(fn=>[fn.id,fn]));
  let remaining=100000;const spend=()=>check(--remaining>=0,'limit');
  const equal=(a,b)=>canonical(a)===canonical(b);
  function anchor(origin) {const source=sources.get(origin.source);check(source,'construction');sourceRange(origin,source.content);}
  function members(id) {
    const type=types.get(id);check(type,'construction');
    if(type.kind==='array')return [payload.arrayLength.id];
    if(type.kind==='readSpan')return [payload.readSpanLength.id];
    if(!['reference','value'].includes(type.kind))return [];
    const ids=new Set(),seen=new Set(),lineage=[];let current=type;
    while(current) {
      spend();check(!seen.has(current.id),'construction');seen.add(current.id);
      lineage.unshift(current);
      current=types.get(current.base);
    }
    for(const owner of lineage) {
      for(const field of owner.fields){spend();ids.add(field.id);}
      for(const id of owner.methods??[]){spend();ids.delete(functions.get(id)?.overrideTarget);ids.add(id);}
    }
    return [...ids].sort(byteOrder);
  }
  for(const type of types.values())if(['reference','value'].includes(type.kind)) {
    spend();const value=type.construction,ctor=type.constructor;
    check(value&&value.id===type.id+'.ctor'&&['public','protected','private'].includes(value.access),'construction');
    check(value.kind===(ctor?'explicit':type.base?'implicit-derived':'implicit-base')
      &&value.initializationPhase===(type.base?'after-successful-super':'before-body'),'construction');
    if(ctor)check(ctor.ownerType===type.id&&ctor.returnType===type.id&&ctor.name==='constructor','construction-owner');
    const origin={source:ctor?.sourcePath??type.sourcePath,...(ctor?.declarationRange??type.declarationRange)};
    check(equal(value.origin,origin),'construction');anchor(value.origin);
    const signature=value.signature;const source=sources.get(signature.sourcePath);
    check(source&&signature.id===signatureId(signature.sourcePath,signature.declarationRange)
      &&signature.returnType===type.id&&equal(signature.parameters,value.parameters.map(parameter=>parameter.type)),'construction');
    sourceRange(signature.declarationRange,source.content);
    const expected=[...type.fields.filter(field=>!field.parameterBinding).sort((a,b)=>a.origin.start-b.origin.start).map(field=>field.id),
      ...(ctor?.parameters??[]).flatMap(parameter=>type.fields.filter(field=>field.parameterBinding===parameter.id).map(field=>field.id))];
    check(equal(value.initializationFields,expected)&&new Set(expected).size===type.fields.length,'field-initialization');
    const base=types.get(type.base),forward=value.implicitForward;
    if(value.kind==='implicit-derived') {
      check(base?.construction&&forward&&forward.target===base.construction.id&&equal(forward.origin,value.origin)
        &&equal(forward.baseSignature,{parameters:base.construction.parameters,return:base.id})
        &&forward.parameters.length===value.parameters.length&&value.parameters.length===base.construction.parameters.length,'construction-forward');
    }else {
      check(forward===null,'construction-forward');
      check(signature.sourcePath===origin.source&&equal(signature.declarationRange,{start:origin.start,end:origin.end}),'construction-signature');
      check(value.parameters.length===(ctor?.parameters.length??0),'construction');
    }
    // A real ancestor constructor owns the selected declaration. If the whole
    // chain is declaration-less, the official default uses this class origin.
    let declaration=type,ancestor=base;
    while(!ctor&&ancestor) {
      spend();if(ancestor.constructor){declaration=ancestor;break;}ancestor=types.get(ancestor.base);
    }
    const signatureOwner=declaration.constructor??declaration;
    check(signature.sourcePath===signatureOwner.sourcePath
      &&equal(signature.declarationRange,signatureOwner.declarationRange),'construction-signature');
    for(const [index,parameter] of value.parameters.entries()) {
      spend();anchor(parameter.origin);check(types.has(parameter.type),'construction');
      if(ctor) {
        const declared=ctor.parameters[index];
        check(parameter.symbol===declared.id&&parameter.type===declared.declaredType&&parameter.inheritedFrom===''
          &&equal(parameter.origin,{source:ctor.sourcePath,...declared.declarationRange}),'construction-parameter');
      }else {
        const inherited=base.construction.parameters[index],mapping=forward.parameters[index],proof=mapping.compatibility;
        check(parameter.symbol===value.id+'.p'+index&&parameter.inheritedFrom===inherited.symbol
          &&parameter.type===inherited.type&&equal(parameter.origin,inherited.origin)
          &&mapping.source===parameter.symbol&&mapping.target===inherited.symbol,'construction-forward');
        check(proof.assignable===true&&proof.sourceType===parameter.type&&proof.targetType===inherited.type
          &&equal(proof.origin,value.origin),'construction-forward');
        const expected=members(parameter.type).map(id=>({source:id,target:id}));
        check(equal(proof.members,expected),'construction-forward');
      }
    }
  }
}
