// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {projectTypedArrayFacts} from '../../compiler/typed-array-project.mjs';
import {initialArrayPublication,prepareArrayCalls} from '../../compiler/array-call-context.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {arrayAnalysisTypes} from '../../compiler/array-analysis-types.mjs';
import {createSpanPlanes} from '../../compiler/array-span-planes.mjs';
import {accepted,invokeCore,rejected} from './generic-core-package-capture.mjs';
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
test('actual returned Span Array retains the complete current overwritten slot and original B owner',async t=>{
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
  if(process.env.TSFG_CORE_IR_EXE)await t.test('the independent consumer admits the actual returned Array and its current Span',async()=>{
    const canonicalized=await invokeCore(core);accepted(canonicalized);
    const optimized=await invokeCore(core,'--optimize');accepted(optimized);
    assert.deepEqual(optimized.stdout,canonicalized.stdout);
    const withoutAuthority=core.replace(/tsfg_core\.array_call_authority = "(?:\\.|[^"\\])*", /,'');
    assert.notEqual(withoutAuthority,core);
    const missing=await invokeCore(withoutAuthority);rejected(missing);
    assert.match(missing.stderr.toString('utf8'),/whole admission requires complete Array call definition authority/);
  });
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
async function readChoiceFixture(){
  const expected=JSON.parse(await readFile(new URL('./testdata/typed-array-span-array-return/choice-resize-expected.json',import.meta.url),'utf8'));
  const bytes=await readFile(new URL('./testdata/typed-array-span-array-return/'+expected.source.sha256+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),'ba9a81b8ab22d0db14b65090c973164cc1a7004e10bba64768fc92c88b8cc6f5');
  return {expected,bytes,facts:readTypedArrayFacts(bytes)};
}
test('actual choice resize cannot prove every possible returned Span Array empty',async()=>{
  const {expected,bytes,facts}=await readChoiceFixture();
  const source=facts.payload.files.find(row=>row.path===facts.payload.rootFile).content;
  assert.equal(sha256(source).slice(7),expected.source.sha256);assert.equal(Buffer.byteLength(source),expected.source.bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context,staticPublication(facts));
  assert.equal(built.status,'error','a can retain its x Span; a successful empty-root proof is unsound');
  assert.equal(built.hir,undefined);
  const diagnostic=built.diagnostics[0];
  assert.ok(['r03-d-readspan-origin','r03-d-readspan-return-escape','r03-d-readspan-structural-conflict'].includes(diagnostic.code),JSON.stringify(diagnostic));
  assert.ok(['a','x.length=0','wrap(flag)[0][0]'].includes(source.slice(diagnostic.primary.start,diagnostic.primary.end)),JSON.stringify(diagnostic));
});
test('unreachable lexical returns do not add a second Array owner to a caller',async()=>{
  const {facts}=await readChoiceFixture();
  const hir=projectTypedArrayFacts(facts);
  const wrap=hir.functions.find(row=>row.name==='wrap');
  const branch=wrap.body.find(row=>row.kind==='if'),returnA=wrap.body.at(-1);
  const returnB={...returnA,value:branch.then[0].expression.value};
  const allocation=name=>({kind:'allocation',functionId:wrap.id,
    allocationSite:wrap.body.find(row=>row.binding?.name===name).initializer.allocationSite,callPath:[]});
  const a=allocation('a'),b=allocation('b');
  assert.notDeepEqual(a,b);
  const publication=staticPublication(facts);
  const trace=body=>{
    const variant={...hir,functions:hir.functions.map(row=>row===wrap?{...row,body}:row)};
    const {flow,ownerModel}=prepareArrayCalls(variant,publication);
    const returns=ownerModel.functions.get(wrap.id).operations.filter(row=>row.kind==='return');
    const origin=flow.functions.find(row=>row.functionId===wrap.id).derivedReturnOrigin;
    return {origin,returns:returns.map(row=>row.owner)};
  };
  assert.deepEqual(trace(wrap.body),{origin:a,returns:[a]});
  // Keep both lexical return operations. Only the first can supply the caller.
  assert.deepEqual(trace([...wrap.body,returnB]),{origin:a,returns:[a,b]});
  const both=trace(wrap.body.flatMap(row=>row===branch?[{...branch,then:[returnA],else:[returnB]}]:row===returnA?[]:[row]));
  assert.equal(both.origin.kind,'aliases');
  assert.equal(both.origin.owners.length,2);
  assert.deepEqual(new Set(both.origin.owners),new Set([a,b]));
  assert.deepEqual(both.returns,[a,b]);
});
test('nested Array element owners follow the continuing control paths',async t=>{
  const [nested,{facts:control}]=await Promise.all([
    readFile(new URL('./testdata/typed-array-source514/9068b0b5e16dd0715dc9bc165c9d067a6594b1ce67d21d2477cbe5df560146de-package.json',import.meta.url)),
    readChoiceFixture(),
  ]);
  assert.equal(sha256(nested).slice(7),'29e6c213c43c012abe71cba8869fc7339f73ce74327ebed4f2c5ad9297520f6f');
  const hir=projectTypedArrayFacts(readTypedArrayFacts(nested)),[fn]=hir.functions;
  const [seed,outer,load,write,,done]=fn.body;
  const [controlFn]=projectTypedArrayFacts(control).functions;
  const alternate=controlFn.body.find(row=>row.binding?.name==='y');
  const {condition,range}=controlFn.body.find(row=>row.kind==='if');
  assert.equal(seed.binding.type,alternate.binding.type);
  const {receiver,index,type}=load.initializer;
  const right={...outer.initializer.elements[0],binding:alternate.binding.id};
  const store={...write,expression:{...write.expression,type,declaredType:type,value:right,
    target:{...write.expression.target,type,declaredType:type,receiver,index}}};
  // These variants run only the owner analysis on projected control shapes.
  // Both retained Source packets and their source identities stay intact.
  const trace=(statement,{formal=false,inside=false}={})=>{
    const parameters=[...controlFn.parameters,...(formal?[outer.binding]:[])];
    const body=[seed,alternate,...(formal?[]:[outer]),statement,...(inside?[]:[load,write]),done];
    const variant={...hir,functions:[{...fn,parameters,body}]};
    const {ownerModel,ownerTools}=prepareArrayCalls(variant,initialArrayPublication(variant));
    const stores=ownerModel.functions.get(fn.id).operations.filter(row=>row.kind==='store');
    assert.equal(stores.length,2,'the lexical nested store is still visited');
    return new Set(ownerTools.leaves(stores.at(-1).proof.owner));
  };
  const owner=allocation=>({kind:'allocation',functionId:fn.id,allocationSite:allocation.initializer.allocationSite,callPath:[]});
  const a=owner(seed),b=owner(alternate);
  const branch=(then,otherwise=[])=>({kind:'if',range,condition,then,else:otherwise});
  const loop=body=>({kind:'while',range,condition,body});
  await t.test('terminating arms do not supply later nested reads',()=>{
    assert.deepEqual(trace(branch([store,done])),new Set([a]));
  });
  await t.test('an already dead arm retains its lexical store but contributes no nested owner',()=>{
    assert.deepEqual(trace(branch([done,store])),new Set([a]));
  });
  await t.test('continuing arms keep both possible contents',()=>{
    assert.deepEqual(trace(branch([store])),new Set([a,b]));
  });
  await t.test('a missing live-arm content retains its formal receiver and unknown alongside the known write',()=>{
    const incoming={kind:'parameter',functionId:fn.id,index:1};
    assert.deepEqual(trace(branch([store]),{formal:true}),new Set([b,incoming,{kind:'unknown'}]));
  });
  await t.test('a terminating loop body leaves the initial condition exit unchanged',()=>{
    assert.deepEqual(trace(loop([store,done])),new Set([a]));
  });
  await t.test('a possible backedge retains both the initial and loop-written owners',()=>{
    assert.deepEqual(trace(loop([store])),new Set([a,b]));
  });
  await t.test('a nested read can see a write from a different arm on an earlier iteration',()=>{
    const shape=loop([branch([store],[load,write])]);
    assert.deepEqual(trace(shape,{inside:true}),new Set([a,owner(outer),{kind:'unknown'}]));
  });
  await t.test('a writer that returns cannot change any later iteration',()=>{
    const shape=loop([branch([store,done],[load,write])]);
    assert.deepEqual(trace(shape,{inside:true}),new Set([a]));
  });
});
