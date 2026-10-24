// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,readHir,printHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
const inputs=[['557183421922732fd587c41773d33f3aaf23fc72dd8529ccf06eb74b2855a7bc','07984692dc9ec054a9bed952df89a2c6e9ff7eda189d4a48595430a569c0f8d1'],
  ['513d0da5c898381200c8c1b68dfa54c3412c6c4ec8eb9b46ce22101343d54749','29e79ab2195dc9f0f3465130540949e4676965097c50f99fa007b10e4a34e528'],
  ['845e8a6f8ab49b635e4d01bfbcf869c7a4469949e46f5e58046f4db0b1b41bde','c883ec80681f116c2d6409b5f216958639dfbdd13bca9c7aa872676fc9945f46']];
async function actual(index){
  const [sourceHash,packetHash]=inputs[index],bytes=await readFile(new URL('./testdata/typed-array-holder-parameter/'+sourceHash+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),packetHash);const facts=readTypedArrayFacts(bytes);
  const source=facts.payload.files.find(row=>row.path===facts.payload.rootFile);assert.equal(sha256(source.content).slice(7),sourceHash);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts,{first:{local:{read:true,write:index===2,structural:false}}});
  return {facts,source,context,publication,built:buildHir(facts,context,publication)};
}
test('actual nested Holder parameter preserves the caller current Span owner',async()=>{
  const {built,context,publication,source}=await actual(0);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const caller=built.hir.functions.find(fn=>fn.name==='run'),state=built.hir.readSpanPlan.functions.find(row=>row.functionId===caller.id);
  const use=state.events.find(row=>row.kind==='view-stored-call-use'&&source.content.slice(row.range.start,row.range.end)==='o.h.span[0]');
  assert.ok(use,'nested normal read must be an actual call-entry family use');
  const owner=state.views.find(row=>row.viewId===use.viewId).owner,a=caller.body.find(row=>row.kind==='local'&&row.binding.name==='a');
  assert.equal(owner.kind,'allocation');assert.equal(owner.functionId,caller.id);assert.equal(owner.allocationSite,a.initializer.allocationSite);
  assert.deepEqual(verifyHir(built.hir,context,publication),built.hir);assert.deepEqual(readHir(Buffer.from(printHir(built.hir,context,publication)),context,publication),built.hir);
  assert.ok(lowerFormalHir(built.hir,context,publication).includes('"tsfg_core.domain.field_read"'));
});
test('actual nested Holder parameter detects the callee current owner resize',async()=>{
  const {built,source}=await actual(1);assert.equal(built.status,'error');const diagnostic=built.diagnostics[0];
  assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');assert.equal(source.content.slice(diagnostic.primary.start,diagnostic.primary.end),'a.length = 0');
  assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&source.content.slice(row.start,row.end)==='o.h.span[0]'));
});

test('actual unknown nested writeback cannot discard its completion dependency',async()=>{
  const {built}=await actual(2);assert.equal(built.status,'error');assert.equal(built.hir,undefined);
  assert.equal(built.diagnostics[0].code,'r03-d-readspan-context-pending');
  assert.match(built.diagnostics[0].message,/unproved nested field writeback/);
  // Pending is a safety result here. Complete nested writeback must eventually
  // diagnose the real B conflict; this case does not call pending full support.
});