// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteActualDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildFiniteFieldPhases} from '../../compiler/finite-field-phases.mjs';
import {sha256} from '../../compiler/identity.mjs';
import capture from './testdata/typed-array-entry/early-virtual.json' with {type:'json'};

test('actual early virtual dispatch reads not-defined derived storage without publishing a native definition',async()=>{
  // This separate Source case exercises pre-definition receiver state. The
  // existing whole-callable oracle and its input manifests remain unchanged.
  const bytes=await readFile(new URL('./testdata/typed-array-entry/'+capture.sourceSHA256+'-package.json',import.meta.url));
  assert.equal(bytes.length,capture.packageBytes);assert.equal(sha256(bytes).slice(7),capture.packageSHA256);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok');const hir=built.hir,plan=buildFiniteActualDomains(hir,context),
    derived=hir.types.find(type=>type.base),base=hir.types.find(type=>type.id===derived.base),
    method=hir.functions.find(fn=>fn.ownerType===derived.id&&fn.name==='observe'),
    header=hir.functions.find(fn=>fn.ownerType===base.id&&fn.name==='observe');
  assert.equal(method.overrideTarget,header.id,'actual official override authority survives cold ownership');
  assert.deepEqual(plan.calls.find(row=>row.member===header.id).targets.map(row=>[row.actualType,row.functionId]),[[derived.id,method.id]]);
  const read=plan.expressions.find(row=>row.functionId===method.id&&row.kind==='fieldAccess'),
    node=plan.nodes.find(row=>row.id===read.id),absence=sha256('tsfg.type\0undefined');
  assert.deepEqual(plan.domains.find(row=>row.id===node.domainId).actualTypes,[absence],
    'the early receiver has not reached the Derived own field definition');
  const proof=plan.fieldReaching.reads.find(row=>row.node===read.id).reaching;
  assert.equal(proof.length,1);assert.deepEqual(proof[0].intrinsics,['undefined']);
  for(const id of proof[0].versions) {
    const entry=plan.fieldReaching.allocationEntries.find(row=>row.id===id);
    assert.equal(entry.state,'not-defined');assert.equal(entry.actualType,derived.id);
    assert.ok(!plan.fieldReaching.phaseWrites.some(row=>row.id===id));
  }
  assert.deepEqual(plan.allocations.map(row=>[row.actualType,row.state]),[[derived.id,'not-defined']]);
  const phase=buildFiniteFieldPhases(hir,context).find(row=>row.ownerType===derived.id);
  assert.deepEqual(phase.events.map(row=>row.kind),['initializerWrite'],'no fabricated nativeDefine before successful super');
  const core=lowerFormalHir(hir,context);
  assert.match(core,/field_reaching = /);assert.match(core,/not-defined/);assert.match(core,/"tsfg_core.domain.method_call"/);
});
