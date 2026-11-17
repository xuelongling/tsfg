// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import {buildFiniteActualDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256,i32TypeId} from '../../compiler/identity.mjs';

async function load(dir,sourceHash,packetHash) {
  const packet=await readFile(new URL('./testdata/'+dir+'/'+sourceHash+'-package.json',import.meta.url));
  assert.equal(sha256(packet),'sha256:'+packetHash);
  const facts=readTypedArrayFacts(packet);
  const source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(sha256(source.content),'sha256:'+sourceHash);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:packet,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  return {hir:built.hir,plan:buildFiniteActualDomains(built.hir,context),source:source.content};
}

function operandTexts(plan,source,callId) {
  const children=plan.expressions.filter(row=>row.id.startsWith(callId+'/'));
  return children.filter(row=>/^\/(receiver|arguments\/\d+)$/.test(row.id.slice(callId.length)))
    .map(row=>source.slice(row.range.start,row.range.end));
}
function actual(plan,id) {
  const node=plan.nodes.find(row=>row.id===id);
  assert.ok(node,id);
  return plan.domains.find(row=>row.id===node.domainId).actualTypes;
}

test('the real method receiver completes before the structural view argument',async()=>{
  const {hir,plan,source}=await load('typed-array-source514',
    'de9ee4e09b213b8ba50105d0532d1227ec431774a05441828cdfc9c13219160c',
    'a4427bf251876b54100a8be34ec0ff0be8e36f42c325148625c7c4524da0d597');
  const fn=hir.functions.find(row=>row.name==='f');
  const call=plan.calls.find(row=>row.id.startsWith(fn.id+'/body/'));
  assert.ok(call);
  const [target]=call.targets;
  assert.equal(hir.functions.find(row=>row.id===target.functionId).name,'m');
  assert.deepEqual(actual(plan,call.id+'/receiver'),[target.actualType]);
  assert.deepEqual(actual(plan,call.id+'/arguments/0'),[i32TypeId]);
  assert.deepEqual(operandTexts(plan,source,call.id),['view(a)','0 as i32']);
});

test('a method receiver is evaluated before the real extra argument with an array effect',async()=>{
  const {hir,plan,source}=await load('typed-array-entry',
    '344fc1ffa2625413e4ffc71436a1b9be780e18ec4cc7cdfdcf6ecfa1b4a0db73',
    '3b0a738909b325daea652792835d05264ca36f80648de1d1ec9d6a9a4bdab037');
  const fn=hir.functions.find(row=>row.name==='run');
  const call=plan.calls.find(row=>row.id.startsWith(fn.id+'/body/'));
  assert.ok(call);
  const [target]=call.targets;
  assert.equal(hir.functions.find(row=>row.id===target.functionId).parameters.length,1);
  assert.deepEqual(operandTexts(plan,source,call.id),['v','effect(a)']);
});
