// SPDX-License-Identifier: MIT
// Draft Core-only definitions. Public HIR, Published and the ordinary function
// directory stay unchanged; the actual solver already owns these same plans.
import {commonCheck as check} from './common-program-common.mjs';

export function commonInternalConstructionPlans(program) {
  const {model,plans,corePlans,construction}=program,{spend}=model,byId=new Map(),pending=[],selected=new Set();
  spend(plans.length+construction.privateCoreCalls.length);
  for(const plan of plans){spend();check(!byId.has(plan.owner.id),'identity');byId.set(plan.owner.id,plan);}
  for(const row of construction.privateCoreCalls)pending.push(row.target);
  for(let index=0;index<pending.length;index++){
    spend();const id=pending[index];if(selected.has(id))continue;
    const plan=byId.get(id),owner=plan?.owner,type=model.types.get(owner?.ownerType);
    check(construction.privateIds.has(id)&&!construction.publicFunctions.has(id)&&owner?.analysisOnly===true&&owner.kind==='construction-body'
      &&model.functions.get(id)===owner&&type?.construction?.functionId===id,'construction','internal constructor is not an owned generated plan');
    selected.add(id);
    for(const block of plan.graph.blocks)for(const op of block.instructions){spend();
      if(op.name==='tsfg_program.invoke'&&construction.privateIds.has(op.properties.function_id)){spend();pending.push(op.properties.function_id);}}
  }
  spend(selected.size);const ids=[...selected];
  ids.sort((a,b)=>{spend(a.length+b.length+1);return a<b?-1:a>b?1:0;});
  spend(corePlans.length+ids.length);const helpers=ids.map(id=>byId.get(id)),emitted=new Set(construction.publicFunctions);
  for(const id of ids)emitted.add(id);
  for(const plan of [...corePlans,...helpers])for(const block of plan.graph.blocks)for(const op of block.instructions){spend();
    if(op.name==='tsfg_program.invoke')check(emitted.has(op.properties.function_id),'identity','Core invoke lacks an emitted public/internal definition');}
  return helpers;
}

export function commonInternalConstructionDirectory(program,carriers) {
  const helpers=commonInternalConstructionPlans(program),{spend}=program.model;spend(helpers.length);
  return helpers.map(plan=>{
    const {owner}=plan,type=program.model.types.get(owner.ownerType),abi=carriers.functions.get(owner.id);
    check(abi,'identity','internal constructor ABI was not solved with its caller');spend(owner.parameters.length+abi.parameters.length+8);
    const bindings=owner.parameters.map(parameter=>{
      const carrier=carriers.bindings.get(parameter.id);check(carrier,'identity','internal parameter storage is absent');
      return {id:parameter.id,carrier};
    });
    bindings.sort((a,b)=>{spend(a.id.length+b.id.length+1);return a.id<b.id?-1:a.id>b.id?1:0;});
    return {id:owner.id,owner:owner.ownerType,construction:type.construction.id,signatureHash:owner.signatureHash,
      parameters:[...abi.parameters],result:abi.result,bindings};
  });
}
