// SPDX-License-Identifier: MIT
// One owned callable catalogue for analysis and SSA. Implicit construction
// bodies use their real ConstructionId and class/ancestor provenance; they do
// not manufacture Source functions or parameter declarations.
export function finiteCallables(hir) {
  return [...hir.functions,...hir.types.filter(type=>type.construction&&!type.constructor).map(type=>{
    const value=type.construction;
    return {id:value.id,name:'<implicit-construction>',ownerType:type.id,construction:value.id,role:'construction-body',
      signatureHash:value.signatureHash,sourcePath:value.origin.source,range:{start:value.origin.start,end:value.origin.end},
      returnType:{id:type.id},parameters:[{id:value.receiver.id,type:type.id},...value.parameters.map(row=>({id:row.symbol,type:row.type}))],
      body:value.body};
  })];
}
