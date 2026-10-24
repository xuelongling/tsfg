// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,readHir,printHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
const root=new URL('./testdata/typed-array-holder-parameter/',import.meta.url);
const expected=JSON.parse(await readFile(new URL('productive-flow-source-expected.json',root),'utf8'));
const packets=['edb5fbe11d8af2cebd3279a5d1aac678f316210dbd552a998fab360ce8a96871',
  '2dc94da79af9b3944e91aef76480c19879357818a55739b54dfdae29ed6de89f'];
for(const [index,oracle]of expected.cases.entries())test('FLOW25u '+oracle.name+' has a productive actual field continuation',async()=>{
  const bytes=await readFile(new URL(oracle.source.sha256+'-package.json',root));
  assert.equal(sha256(bytes).slice(7),packets[index]);const facts=readTypedArrayFacts(bytes);
  const source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(sha256(source.content).slice(7),oracle.source.sha256);
  assert.equal(Buffer.byteLength(source.content),oracle.source.bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts,{first:{local:{read:true,write:false,structural:false}}});
  const built=buildHir(facts,context,publication);assert.equal(built.status,oracle.expectedStatus,JSON.stringify(built.diagnostics));
  const caller=built.hir.functions.find(fn=>fn.name==='run'),state=built.hir.readSpanPlan.functions.find(row=>row.functionId===caller.id);
  const allocation=caller.body.find(row=>row.kind==='local'&&row.binding.name==='a').initializer.allocationSite;
  const uses=state.events.filter(event=>event.kind==='view-stored-call-use');assert.ok(uses.length>0);
  for(const use of uses){
    const family=state.views.find(view=>view.viewId===use.viewId);assert.equal(family.owner.kind,'allocation');
    assert.equal(family.owner.functionId,caller.id);assert.equal(family.owner.allocationSite,allocation);
    assert.ok(source.content.slice(use.range.start,use.range.end).startsWith('h.span'));
  }
  assert.deepEqual(verifyHir(built.hir,context,publication),built.hir);
  assert.deepEqual(readHir(Buffer.from(printHir(built.hir,context,publication)),context,publication),built.hir);
});
