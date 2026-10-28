// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,readHir,printHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256,canonical} from '../../compiler/identity.mjs';
import {projectTypedArrayFacts} from '../../compiler/typed-array-project.mjs';
import {prepareArrayCalls} from '../../compiler/array-call-context.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
const inputs=[['557183421922732fd587c41773d33f3aaf23fc72dd8529ccf06eb74b2855a7bc','07984692dc9ec054a9bed952df89a2c6e9ff7eda189d4a48595430a569c0f8d1'],
  ['513d0da5c898381200c8c1b68dfa54c3412c6c4ec8eb9b46ce22101343d54749','29e79ab2195dc9f0f3465130540949e4676965097c50f99fa007b10e4a34e528'],
  ['845e8a6f8ab49b635e4d01bfbcf869c7a4469949e46f5e58046f4db0b1b41bde','c883ec80681f116c2d6409b5f216958639dfbdd13bca9c7aa872676fc9945f46'],
  ['3755d77389efe9d6f19b683a70e52b2cc5b8f07beace25bca82b9111a443d328','b191d7c1319abb104fd91caa0573943292694a62a2e9dc5cee6905334c91985f'],
  ['5df3cc6975b0154c347624a364190b8ba8b3c8e10cefa30e7e3d0fbe16d257f8','a6ef61d2749ae5fb1a4d02e9776a66a4d5391b2b94cf257592c5ec7c4137388a'],
  ['1dde441db1967ef0a9c49f9ae6848a66b68e50294f1c8a02da070d65fad64c2d','e662af28b403fd7d323617d680576f4a33c7a966ede881cbf964f06b1821d9ea']];
async function actual(index){
  const [sourceHash,packetHash]=inputs[index],bytes=await readFile(new URL('./testdata/typed-array-holder-parameter/'+sourceHash+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),packetHash);const facts=readTypedArrayFacts(bytes);
  const source=facts.payload.files.find(row=>row.path===facts.payload.rootFile);assert.equal(sha256(source.content).slice(7),sourceHash);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts,index===3?{set:{local:{read:true,write:true,structural:false}}}
    :{first:{local:{read:true,write:index===2||index===4||index===5,structural:false}}});
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

test('actual nested Holder writeback returns B to the caller and releases old A',async()=>{
  const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-holder-parameter/nested-writeback-positive-expected.json',import.meta.url),'utf8'));
  const {built,context,publication,source}=await actual(3);assert.equal(built.status,oracle.expected.status,JSON.stringify(built.diagnostics));
  const caller=built.hir.functions.find(fn=>fn.name===oracle.expected.caller),state=built.hir.readSpanPlan.functions.find(row=>row.functionId===caller.id);
  const use=state.events.find(row=>row.kind==='view-read-complete'&&source.content.slice(row.range.start,row.range.end)===oracle.expected.lastUse);
  assert.ok(use,'caller nested read must use the actual returned field version');
  const owner=state.views.find(row=>row.viewId===use.viewId).owner,b=caller.body.find(row=>row.kind==='local'&&row.binding.name===oracle.expected.ownerBinding);
  assert.equal(owner.kind,'allocation');assert.equal(owner.functionId,caller.id);assert.equal(owner.allocationSite,b.initializer.allocationSite);
  assert.deepEqual(verifyHir(built.hir,context,publication),built.hir);
  assert.deepEqual(readHir(Buffer.from(printHir(built.hir,context,publication)),context,publication),built.hir);
  const setter=built.hir.functions.find(fn=>fn.name==='set'),store=setter.body[0].expression;
  const current=buildFiniteCoreDomains(built.hir,context,{publicationContext:publication}).definition.fieldReaching;
  const read=current.reads.find(row=>row.node===caller.id+'/body/'+caller.body.findIndex(row=>row.kind==='return')+'/value/receiver');
  assert.ok(read,'ordinary producer must consume the actual nested field version');
  assert.deepEqual(read.reaching.map(row=>row.versions),[[setter.id+'/body/0/expression/field-version/'+store.target.receiver.type+'/'+store.target.property]]);
  assert.deepEqual(read.reaching[0].sources,[setter.id+'/body/0/expression/value']);
  assert.ok(lowerFormalHir(built.hir,context,publication).includes('"tsfg_core.domain.field_store"'));
});
test('actual nested Holder parameter detects the callee current owner resize',async()=>{
  const {built,source}=await actual(1);assert.equal(built.status,'error');const diagnostic=built.diagnostics[0];
  assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');assert.equal(source.content.slice(diagnostic.primary.start,diagnostic.primary.end),'a.length = 0');
  assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&source.content.slice(row.start,row.end)==='o.h.span[0]'));
});

test('actual nested Holder writeback preserves B through the callee resize/read',async()=>{
  const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-holder-parameter/nested-writeback-expected.json',import.meta.url),'utf8'));
  const {built,source}=await actual(2);assert.equal(built.status,oracle.expected.status);assert.equal(built.hir,undefined);
  const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,oracle.expected.code);
  assert.equal(diagnostic.primary.start,oracle.expected.primary.start);assert.equal(diagnostic.primary.end,oracle.expected.primary.end);
  assert.equal(source.content.slice(diagnostic.primary.start,diagnostic.primary.end),oracle.expected.primary.text);
  assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&row.start===oracle.expected.lastUse.start&&row.end===oracle.expected.lastUse.end));
});

test('actual known nested/direct Holder alias selects C in its actual caller',async()=>{
  const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-holder-parameter/nested-alias-writeback-expected.json',import.meta.url),'utf8'));
  const {facts,built,source,publication}=await actual(4);
  // Consume the actual production provenance before Borrow's conservative
  // parameter may-alias check can reject for a different source family.
  const hir=projectTypedArrayFacts(facts),prepared=prepareArrayCalls(hir,publication),fn=hir.functions.find(row=>row.name==='first');
  const at=['body',fn.body.findIndex(row=>row.kind==='return'),'value','receiver'];
  const evidence=prepared.ownerModel.functions.get(fn.id).storage.reads.get(canonical(at));
  assert.ok(evidence,'actual nested read has stored-field evidence');
  if(!evidence.pending){
    assert.ok(evidence.sources.length>0);
    for(const row of evidence.sources){assert.equal(row.owner.kind,'parameter');assert.equal(row.owner.functionId,fn.id);assert.equal(row.owner.index,3);}
  }
  assert.equal(built.status,'error');
  const diagnostic=built.diagnostics[0],expected=oracle.semantics.requiredConflictIfClosed;
  const caller=hir.functions.find(row=>row.name==='run'),c=caller.body.find(row=>row.kind==='local'&&row.binding.name==='c');
  const events=[...prepared.ownerModel.functions.get(caller.id).storage.callEvents.values()].flat();
  const use=events.find(row=>row.kind==='use'&&row.range.start===expected.lastUse.start&&row.range.end===expected.lastUse.end);
  assert.ok(use,'actual caller receives the callee current C use');assert.equal(use.evidence.pending,false);assert.ok(use.evidence.sources.length>0);
  for(const row of use.evidence.sources){assert.equal(row.owner.kind,'allocation');assert.equal(row.owner.functionId,caller.id);assert.equal(row.owner.allocationSite,c.initializer.allocationSite);}
  assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict','the known actual caller alias must close to C, not remain pending: '+JSON.stringify(diagnostic));
  assert.equal(diagnostic.primary.start,expected.primary.start);assert.equal(diagnostic.primary.end,expected.primary.end);
  assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&row.start===expected.lastUse.start&&row.end===expected.lastUse.end));
  assert.deepEqual(diagnostic.conflict.viewOwner,use.evidence.sources[0].owner);
  assert.deepEqual(diagnostic.conflict.structuralOwner,use.evidence.sources[0].owner);
  assert.equal(source.content.slice(expected.primary.start,expected.primary.end),expected.primary.text);
  assert.equal(source.content.slice(expected.lastUse.start,expected.lastUse.end),expected.lastUse.text);
});

test('actual known method caller cannot close its independent unknown host field entry',async()=>{
  const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-holder-parameter/nested-method-unknown-entry-expected.json',import.meta.url),'utf8'));
  const {facts,built,source,publication}=await actual(5),hir=projectTypedArrayFacts(facts);
  const fn=hir.functions.find(row=>row.name==='first'),caller=hir.functions.find(row=>row.name==='run');
  assert.ok(fn.ownerType);assert.notEqual(fn.role,'construction-body');
  assert.ok(!hir.exports.some(row=>row.functionId===fn.id),'method entry is independent of Source exports');
  const prepared=prepareArrayCalls(hir,publication),storage=prepared.ownerModel.functions.get(fn.id).storage;
  assert.ok(storage.demands.some(row=>row.formal&&row.contexts>0&&!row.failed),'a known caller genuinely completes one contextual use');
  const events=[...prepared.ownerModel.functions.get(caller.id).storage.callEvents.values()].flat();
  const use=events.find(row=>row.kind==='use'&&row.range.start===oracle.required.primary.start&&row.range.end===oracle.required.primary.end);
  const c=caller.body.find(row=>row.kind==='local'&&row.binding.name==='c');
  assert.ok(use&&!use.evidence.pending&&use.evidence.sources.length);
  for(const row of use.evidence.sources){assert.equal(row.owner.kind,'allocation');assert.equal(row.owner.functionId,caller.id);assert.equal(row.owner.allocationSite,c.initializer.allocationSite);}
  assert.equal(built.status,oracle.required.status,'one safe actual invocation cannot prove all unknown method inputs');
  const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,oracle.required.code);assert.equal(diagnostic.message,oracle.required.message);
  assert.equal(diagnostic.primary.start,oracle.required.primary.start);assert.equal(diagnostic.primary.end,oracle.required.primary.end);
  assert.equal(source.content.slice(diagnostic.primary.start,diagnostic.primary.end),oracle.required.primary.text);
});
