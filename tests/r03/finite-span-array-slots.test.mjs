// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,readHir,printHir} from '../../compiler/hir.mjs';
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
});
