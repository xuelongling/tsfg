// SPDX-License-Identifier: MIT
// One owned callable catalogue for analysis and SSA. Implicit construction
// bodies use their real ConstructionId and class/ancestor provenance; they do
// not manufacture Source functions or parameter declarations.
export function finiteCallables(hir) {
  return [...hir.functions,...hir.types.filter(type=>type.construction&&!type.constructor).map(type=>{
    const value=type.construction;
    return {id:value.id,name:'<implicit-construction>',ownerType:type.id,construction:value.id,role:'construction-body',
      signatureHash:value.signatureHash,sourcePath:value.origin.source,range:{start:value.origin.start,end:value.origin.end},
      returnType:{id:type.id},parameters:[{id:value.receiver.id,type:type.id},...value.parameters.map(row=>({id:row.symbol,type:row.type,origin:row.origin}))],
      body:value.body};
  })];
}

// Boundary DTO for the independent C++ module verifier. Parameters keep their
// ordered owned bindings; construction bodies retain Source signature identity
// while their executable ABI has no result. No function body is dropped.
export function finiteCallableContracts(hir) {
  return finiteCallables(hir).map(fn=>({id:fn.id,name:fn.name,sourcePath:fn.sourcePath,range:{...fn.range},
    signatureHash:fn.signatureHash,returnType:fn.returnType.id,parameters:fn.parameters.map((row,index)=>({id:row.id,type:row.type,
      origin:fn.ownerType&&index===0?null:row.origin??(row.range?{source:fn.sourcePath,...row.range}:null)})),
    ownerType:fn.ownerType??null,construction:fn.construction??null,overrideTarget:fn.overrideTarget??null,
    role:fn.role??'function'})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
