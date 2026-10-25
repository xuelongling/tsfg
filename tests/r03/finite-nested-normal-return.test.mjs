// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {projectTypedArrayFacts} from '../../compiler/typed-array-project.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
const root=new URL('./testdata/typed-array-holder-parameter/',import.meta.url);
const oracle=JSON.parse(await readFile(new URL('nested-normal-return-expected.json',root),'utf8'));
const packets=["c32443189aa4be1b2a1da2b466a6f7ec8c55709fc9f1a4c8f7cde299db5e3693","7b4acc0970d299418f1ca71166ccb6f73c57d1a22caacc70c02954351e540f64","905777af649ce4e3e150ddb793f177c54e7ec27f59aebddaa60d9b5dcf6d1ead"];
for(const [index,row]of oracle.exactCoverage.requestedSourceCases.entries())test('actual nested normal return '+row.id,async()=>{
  const bytes=await readFile(new URL(row.sha256+'-package.json',root));assert.equal(sha256(bytes).slice(7),packets[index]);
  const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(source.content,row.sourceText);assert.equal(sha256(source.content).slice(7),row.sha256);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const none={read:false,write:false,structural:false},read={...none,read:true};
  const publication=staticPublication(facts,{inner:{parameters:{0:read},local:none},wrap:{parameters:{0:read},local:none}});
  const built=buildHir(facts,context,publication),storage=process.env.TSFG_TEST_STORAGE?path.join(process.env.TSFG_TEST_STORAGE,row.id):null;
  if(storage){await mkdir(storage,{recursive:true});await writeFile(path.join(storage,'result.json'),JSON.stringify({status:built.status,diagnostics:built.diagnostics})+'\n',{flag:'wx'});}
  assert.equal(built.status,row.expected.status,JSON.stringify(built.diagnostics));
  if(built.status==='error'){
    const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,row.expected.code);
    assert.equal(diagnostic.primary.start,row.anchors.resize.start);assert.equal(diagnostic.primary.end,row.anchors.resize.end);
    assert.ok(diagnostic.related.some(value=>value.kind==='borrow-last-use'&&value.start===row.anchors.lastUse.start&&value.end===row.anchors.lastUse.end));
    const caller=projectTypedArrayFacts(facts).functions.find(fn=>fn.name==='run'),b=caller.body.find(value=>value.kind==='local'&&value.binding.name==='b');
    assert.equal(diagnostic.conflict.viewOwner.kind,'allocation');assert.deepEqual(diagnostic.conflict.viewOwner,diagnostic.conflict.structuralOwner);
    assert.equal(diagnostic.conflict.viewOwner.functionId,caller.id);assert.equal(diagnostic.conflict.viewOwner.allocationSite,b.initializer.allocationSite);
    return;
  }
  const run=built.hir.functions.find(fn=>fn.name==='run'),state=built.hir.readSpanPlan.functions.find(fn=>fn.functionId===run.id);
  const use=state.events.find(value=>value.kind==='view-read-complete'&&value.range.start===row.anchors.lastUse.start&&value.range.end===row.anchors.lastUse.end);
  assert.ok(use);const owner=state.views.find(view=>view.viewId===use.viewId).owner;
  const allocation=run.body.find(value=>value.kind==='local'&&value.binding.name===(index?'b':'a'));
  assert.equal(owner.kind,'allocation');assert.equal(owner.functionId,run.id);assert.equal(owner.allocationSite,allocation.initializer.allocationSite);
  if(index===1){const resize=state.events.find(value=>value.kind==='array-resize-effect');assert.ok(resize);assert.notEqual(resize.owner.allocationSite,owner.allocationSite);}
  assert.deepEqual(verifyHir(built.hir,context,publication),built.hir);
  assert.deepEqual(readHir(Buffer.from(printHir(built.hir,context,publication)),context,publication),built.hir);
  // The ordinary producer must keep its unresolved-actual-field gate. These
  // calls need complete normal-return field continuation to reach real Core.
  const core=lowerFormalHir(built.hir,context,publication);assert.ok(core.includes('"tsfg_core.domain.field_read"'));
  if(storage)for(const [name,bytes]of [['hir.json',printHir(built.hir,context,publication)],['core.mlir',core],['publication.json',JSON.stringify(publication)+'\n']])await writeFile(path.join(storage,name),bytes,{flag:'wx'});
});
