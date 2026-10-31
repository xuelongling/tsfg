// SPDX-License-Identifier: MIT
// Typed model controls only. The original complete Source packet is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {commonProgramModel} from '../../compiler/common-program-plan.mjs';
import {commonImplicitConstructionPlans} from '../../compiler/common-program-implicit-construction-plans.mjs';
const bytes=readFileSync(new URL('./common-program-m12-witness-forward.json',import.meta.url)),facts=readCommonProgramFacts(bytes),
  hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId}),
  derived=hir.types.find(row=>row.name==='Derived'),base=hir.types.find(row=>row.id===derived.base);
const rejected=error=>error instanceof TypeError&&'code' in error&&error.code==='r03-common-program-construction'&&error.message.includes('direct base');
function planWithTarget(target){
  const {model,owners}=commonProgramModel(hir),type=model.types.get(derived.id);
  // Deliberately violate the already-typed model invariant, not Source facts.
  model.types.set(type.id,{...type,construction:{...type.construction,implicitForward:{...type.construction.implicitForward,target}}});
  return commonImplicitConstructionPlans(model,owners);
}
test('forwarding keeps the original Source constructor namespace',()=>{
  assert.equal(derived.construction.implicitForward.target,base.sourceType+'.ctor');
  assert.notEqual(derived.construction.implicitForward.target,base.construction.id);
  assert.equal(derived.construction.implicitForward.target,facts.payload.types.find(row=>row.name==='Base').construction.id);
});
test('implicit forwarding selects the semantic direct base only after Source identity joins',()=>{
  const before=structuredClone(hir),{model,owners}=commonProgramModel(hir),projection=commonImplicitConstructionPlans(model,owners),
    owner=projection.model.functions.get(projection.privateTargets.get(derived.id)),invoke=owner.body.find(row=>row.value?.kind==='superConstruct').value;
  assert.equal(invoke.callee,base.id);assert.deepEqual(invoke.signature,base.construction.signature);
  assert.deepEqual(invoke.arguments.map(row=>row.binding),owner.parameters.map(row=>row.id));assert.deepEqual(hir,before);
});
test('a semantic construction identity cannot impersonate the Source forwarding target',()=>{
  assert.throws(()=>planWithTarget(base.construction.id),rejected);
});
test('a different raw Source constructor cannot impersonate the direct base',()=>{
  const other=hir.types.find(row=>row.name==='Delta');assert.throws(()=>planWithTarget(other.sourceType+'.ctor'),rejected);
});
