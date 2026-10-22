// SPDX-License-Identifier: MIT
// Source definedness is separate from the qualification to load native bytes.
// This ordered plan is consumed by Core initialize_fields, not a second AST.
import {verifyHir} from './module-hir.mjs';
import {own} from './identity.mjs';

export function buildFiniteFieldPhases(input,context,options={}) {
  const hir=verifyHir(input,context,options.publicationContext);let remaining=100000;
  const charge=()=>{if(--remaining<0)throw new TypeError('r03-finite-field-phase: work limit');};
  return finiteFieldPhases(hir,charge);
}

// Shared by the already verified whole-module analysis. Its caller owns the
// same cancellation/work transaction as the field memory proof.
export function finiteFieldPhases(hir,charge) {
  const plans=[];
  for(const type of hir.types)if(type.construction) {
    charge();const construction=type.construction,versions=new Map(),events=[];
    const prefix=construction.parameters.flatMap(parameter=>type.fields.filter(field=>{charge();return field.parameterBinding===parameter.symbol;})
      .map(field=>({kind:'fieldDefine',field:field.id,origin:field.origin,definitionBinding:parameter.symbol})));
    for(const [ordinal,init] of [...prefix,...construction.initialization].entries()) {
      charge();const kind=init.kind==='fieldDefine'?'nativeDefine':init.kind==='fieldInitialize'?'initializerWrite':'parameterWrite';
      const input=versions.get(init.field)??null;
      const output={id:construction.id+'/field/'+init.field+'/version/'+ordinal,field:init.field,previous:input,
        state:kind==='nativeDefine'?'defined-native-undefined':'initialized',
        valueNode:init.value?'construction/'+construction.id+'/initialization/'+init.field:null,
        parameterBinding:init.binding??init.definitionBinding??null,origin:{...init.origin}};
      events.push({ordinal,kind,input,output});versions.set(init.field,output.id);
    }
    plans.push({constructionId:construction.id,ownerType:type.id,receiverBinding:construction.receiver.id,
      activation:construction.initializationPhase,entry:type.base?'unbound':'allocated',events,
      completion:[...versions.entries()].sort(([a],[b])=>a<b?-1:1).map(([,version])=>version)});
  }
  return own(plans.sort((a,b)=>a.constructionId<b.constructionId?-1:1));
}
