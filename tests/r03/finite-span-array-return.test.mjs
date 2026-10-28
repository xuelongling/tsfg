// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {arrayAnalysisTypes} from '../../compiler/array-analysis-types.mjs';
import {createSpanPlanes} from '../../compiler/array-span-planes.mjs';
const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-span-array-return/source-expected.json',import.meta.url),'utf8'));
const hashes=['e735995e1640f6b6bd34b5e4d9ac55102553aef425229759002b2f11976f28ed',
  '3d4b83649392ec38b99c1d7f3c4fa89a2113af8b0e5f00ab60c22ac4fd58008d'];
async function actual(index){
  const pin=oracle.sourcePins[index],bytes=await readFile(new URL('./testdata/typed-array-span-array-return/'+pin.sha256+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),hashes[index]);const facts=readTypedArrayFacts(bytes);
  const source=facts.payload.files.find(row=>row.path===facts.payload.rootFile).content;
  assert.equal(sha256(source).slice(7),pin.sha256);assert.equal(Buffer.byteLength(source),pin.bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  return {facts,source,context,publication:staticPublication(facts)};
}
test('actual returned Span Array retains the complete current overwritten slot and original B owner',async()=>{
  const {facts,context,publication}=await actual(0),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));const hir=built.hir;
  const wrap=hir.functions.find(row=>row.name==='wrap'),caller=hir.functions.find(row=>row.name==='run');
  const state=hir.readSpanPlan.functions.find(row=>row.functionId===caller.id);
  const read=state.events.findLast(row=>row.kind==='view-read-complete');assert.ok(read);
  const family=state.views.find(row=>row.viewId===read.viewId);
  const b=wrap.body.find(row=>row.kind==='local'&&row.binding.name==='b');assert.ok(b);
  assert.equal(family.owner.kind,'allocation');assert.equal(family.owner.functionId,wrap.id);
  assert.equal(family.owner.allocationSite,b.initializer.allocationSite);
  assert.equal(family.owner.callPath[0].functionId,caller.id);
  assert.equal(oracle.positive.extent,1);assert.equal(oracle.positive.result,2);
  assert.deepEqual(verifyHir(hir,context,publication),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context,publication)),context,publication),hir);
  const core=lowerFormalHir(hir,context,publication);
  assert.ok(core.includes('"tsfg_core.domain.array_store"'));
  assert.ok(core.includes('"tsfg_core.domain.array_resize"'));
  assert.ok(core.includes('"tsfg_core.domain.array_read"'));
});
test('actual returned Span Array keeps its live A slot through the callee resize',async()=>{
  const {facts,source,context,publication}=await actual(1),built=buildHir(facts,context,publication);
  assert.equal(built.status,'error');assert.equal(built.hir,undefined);
  const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
  assert.equal(source.slice(diagnostic.primary.start,diagnostic.primary.end),'a.length=0');
  assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&source.slice(row.start,row.end)==='slots'));
});
test('production Span planes retain skipped receivers of an ambiguous resize',async()=>{
  const {facts,context,publication}=await actual(0),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const type=arrayAnalysisTypes(built.hir),array=built.hir.types.find(row=>row.kind==='array'&&type.isView(row.elementType));
  assert.ok(array);let work=10000;const charge=()=>assert.ok(work-->0,'same finite test meter');
  const planes=createSpanPlanes(type,charge,()=>({views:new Map()}));
  // Exercise the actual graph API, independently of Source and the walker.
  // The input schema/type comes from the genuine packet above; these are
  // component states, not a fabricated Source/HIR execution or SSA proof.
  const a=planes.array(array.id,undefined,1,()=>planes.unknown);
  const b=planes.array(array.id,undefined,1,()=>planes.unknown);
  const invalidate=plane=>{plane.extent=null;plane.fields.clear();plane.invalidated=true;};
  planes.extent(planes.choice([a,b]),0,()=>{},invalidate);
  assert.equal(planes.elements(a),null,'a may be the skipped nonempty receiver');
  assert.equal(planes.elements(b),null,'b may be the skipped nonempty receiver');
  planes.extent(a,0,()=>{},invalidate);
  assert.deepEqual(planes.elements(a),[],'a unique receiver still has an exact empty normal result');
  const c=planes.array(array.id,undefined,1,()=>planes.unknown);
  const d=planes.array(array.id,undefined,1,()=>planes.unknown);
  planes.extent(planes.choice([c,d]),1,()=>{},invalidate);
  assert.equal(planes.elements(c).length,1,'equal skip/resize extents remain exact');
  assert.equal(planes.elements(d).length,1);
});
test('actual choice resize cannot prove every possible returned Span Array empty',async()=>{
  const expected=JSON.parse(await readFile(new URL('./testdata/typed-array-span-array-return/choice-resize-expected.json',import.meta.url),'utf8'));
  const bytes=await readFile(new URL('./testdata/typed-array-span-array-return/'+expected.source.sha256+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),'ba9a81b8ab22d0db14b65090c973164cc1a7004e10bba64768fc92c88b8cc6f5');
  const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(row=>row.path===facts.payload.rootFile).content;
  assert.equal(sha256(source).slice(7),expected.source.sha256);assert.equal(Buffer.byteLength(source),expected.source.bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context,staticPublication(facts));
  assert.equal(built.status,'error','a can retain its x Span; a successful empty-root proof is unsound');
  assert.equal(built.hir,undefined);
  const diagnostic=built.diagnostics[0];
  assert.ok(['r03-d-readspan-origin','r03-d-readspan-return-escape','r03-d-readspan-structural-conflict'].includes(diagnostic.code),JSON.stringify(diagnostic));
  assert.ok(['a','x.length=0','wrap(flag)[0][0]'].includes(source.slice(diagnostic.primary.start,diagnostic.primary.end)),JSON.stringify(diagnostic));
});
