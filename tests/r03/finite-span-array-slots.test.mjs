// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,readHir,printHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
const root=new URL('./testdata/typed-array-span-array-slots/',import.meta.url);
const expected=JSON.parse(await readFile(new URL('source-expected.json',root),'utf8'));
const packets=['512d8c5d1d5c481f27d7d9af0a13ef5e205f6289b37abf305acc1c225faf399e',
  '3df9edcb311c19ea96986e5efb699cd8b86f87802a52e7d38dcb7baa64e19c14'];
for(const [index,oracle]of expected.cases.entries())test('SLOT25v '+oracle.name+' consumes the real current slot version',async()=>{
  const bytes=await readFile(new URL(oracle.sha256+'-package.json',root));assert.equal(sha256(bytes).slice(7),packets[index]);
  const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(sha256(source.content).slice(7),oracle.sha256);assert.equal(Buffer.byteLength(source.content),oracle.bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts),built=buildHir(facts,context,publication);
  assert.equal(built.status,oracle.expected,JSON.stringify(built.diagnostics));
  if(oracle.expected==='error'){
    const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
    assert.equal(source.content.slice(diagnostic.primary.start,diagnostic.primary.end),'a.length=0');
    assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&source.content.slice(row.start,row.end)==='slots[0][0]'));
    return;
  }
  const fn=built.hir.functions.find(fn=>fn.name==='run'),state=built.hir.readSpanPlan.functions.find(row=>row.functionId===fn.id);
  const read=state.events.findLast(event=>event.kind==='view-read-complete');assert.ok(read);
  const view=state.views.find(view=>view.viewId===read.viewId),owner=fn.body.find(row=>row.kind==='local'&&row.binding.name===oracle.owner);
  assert.equal(view.owner.kind,'allocation');assert.equal(view.owner.functionId,fn.id);
  assert.equal(view.owner.allocationSite,owner.initializer.allocationSite,'shared alias overwrite selects the B Span family');
  const resize=state.events.find(event=>event.kind==='array-resize-effect');assert.ok(resize);
  assert.notEqual(resize.owner.allocationSite,view.owner.allocationSite,'A resize remains present without reviving killed A slot');
  assert.deepEqual(verifyHir(built.hir,context,publication),built.hir);
  assert.deepEqual(readHir(Buffer.from(printHir(built.hir,context,publication)),context,publication),built.hir);
  const {definition,reached}=buildFiniteCoreDomains(built.hir,context,{publicationContext:publication});
  for(const plan of [definition,reached]){
    const {reads,writes}=plan.arrayReaching;
    const text=row=>source.content.slice(row.origin.start,row.origin.end);
    const slot=reads.find(row=>text(row)==='slots[0]'),element=reads.find(row=>text(row)==='slots[0][0]');
    assert.equal(slot.status,'proven');
    assert.deepEqual(slot.versions,writes.filter(row=>row.kind==='store'&&text(row)==='alias[0]=readSpan(b,0,1)').map(row=>row.id));
    assert.equal(element.status,'proven');
    const backing=writes.find(row=>row.kind==='initial'&&row.origin.start===owner.initializer.elements[0].range.start);
    assert.equal(element.owner,backing.owner);
    assert.deepEqual(element.versions,[backing.id]);
    const result=plan.nodes.find(row=>row.id===fn.id+'/return');
    assert.deepEqual(result.pending,[]);
    assert.deepEqual(plan.domains.find(row=>row.id===result.domainId).actualTypes,[fn.returnType.id]);
  }
});

test('a stored local Array keeps its owner through a checked slot read and dense writes',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-source514/9068b0b5e16dd0715dc9bc165c9d067a6594b1ce67d21d2477cbe5df560146de-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:29e6c213c43c012abe71cba8869fc7339f73ce74327ebed4f2c5ad9297520f6f');
  const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const {definition,reached}=buildFiniteCoreDomains(built.hir,context,{publicationContext:publication});
  for(const plan of [definition,reached]){
    const {reads,writes}=plan.arrayReaching;
    const text=row=>source.content.slice(row.origin.start,row.origin.end);
    const slot=reads.find(row=>text(row)==='outer[0]'),stored=writes.find(row=>text(row)==='a');
    assert.equal(slot.status,'proven');
    assert.equal(slot.owner,stored.owner);
    assert.deepEqual(slot.versions,[stored.id]);
    const backing=writes.find(row=>text(row)==='1');
    assert.ok(backing.owner);
    assert.notEqual(backing.owner,slot.owner);
    assert.deepEqual(writes.filter(row=>row.kind==='store').map(row=>[text(row),row.owner,row.index]),[
      ['b[1]=2',backing.owner,'c:1'],
      ['a[2]=3',backing.owner,'c:2'],
    ]);
  }
});
