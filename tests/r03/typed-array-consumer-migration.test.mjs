// SPDX-License-Identifier: MIT
// Fresh official v8 packets retain original TypeScript sources and public provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readTypedArrayFacts,writeTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,printHir,readHir,analyzeArrayCalls,verifyArrayCalls,
  verifyArrayCallParallelGroup,printArrayParallelProof,readArrayParallelProof} from '../../compiler/hir.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import manifest from './testdata/typed-array-consumer-v8/manifest.json' with {type:'json'};
const none={read:false,write:false,structural:false};
const borrow={parameters:{0:{read:true,write:false,structural:false}},local:none,returnOrigin:{kind:'parameter',index:0}};
const counts={
  'full-fresh-aliases':[3,2,0,0],
  'empty-checked-read':[1,1,0,0],
  'length-equal-checked-read':[1,1,0,0],
  'far-oob-checked-read':[1,1,0,0],
  'dense-overwrite':[1,1,1,0],
  'dynamic-owner-aliases':[2,2,2,1],
  'empty-append-rhs-shrink':[1,2,2,1],
  'uncertain-dense-length':[1,2,2,2],
};
function kinds(value,result={}) {
  if(!value||typeof value!=='object')return result;
  if(value.kind)result[value.kind]=(result[value.kind]??0)+1;
  for(const child of Object.values(value))kinds(child,result);return result;
}
for(const row of manifest)test('fresh Source v8 ordinary consumer: '+row.name,async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-consumer-v8/'+row.file,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
  const facts=readTypedArrayFacts(bytes);assert.equal(facts.version,8);assert.equal(facts.packageId,row.packageId);
  assert.equal(facts.requestId,row.requestId);assert.deepEqual(writeTypedArrayFacts(facts),bytes);
  const selected={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const rules={borrow,identity:{local:none}};
  if(row.name.startsWith('global102')) {
    const parameters={0:{...none,read:true},...Object.fromEntries(Array.from({length:7},(_,i)=>[i+1,{...none}]))};
    rules.borrow={parameters,local:none,returnOrigin:{kind:'parameter',index:0}};
    for(const name of ['caller0','caller1','caller2','caller3','caller4','caller5','entry'])rules[name]={parameters,local:none};
  }
  if(row.name==='generic-union-parameter-scc')for(const name of ['even','odd','read'])rules[name]={parameters:{0:{...none,read:true}},local:none};
  if(row.name.includes('constructor'))for(const name of ['constructor','<implicit-construction>'])
    rules[name]={parameters:{1:{...none,structural:true}},local:none};
  const publication=staticPublication(facts,rules);
  const built=buildHir(facts,selected,publication);
  if(row.name.includes('constructor')) {
    assert.equal(built.status,'error');assert.equal(built.diagnostics[0].code,'r03-d-readspan-structural-conflict');
    const diagnostic=built.diagnostics[0],source=facts.payload.files.find(file=>file.path===diagnostic.primary.sourceId).content;
    assert.equal(source.slice(diagnostic.primary.start,diagnostic.primary.end),row.name.startsWith('explicit')?'new C(a)':'new D(a)');
    assert.equal(diagnostic.conflict.sourceKind,'fixedCall');assert.equal(diagnostic.conflict.parameterIndex,1);
    assert.ok(diagnostic.related.some(item=>item.kind==='borrow-last-use'&&source.slice(item.start,item.end)==='s[i]'));return;
  }
  if(row.name==='global1025') {
    assert.equal(built.status,'error');assert.equal(built.diagnostics[0].code,'r03-d-readspan-limit');
    assert.equal(built.hir,undefined);return;
  }
  if(row.name==='fixed-call-upper') {
    assert.equal(built.status,'error');assert.equal(built.diagnostics[0].code,'r03-d-readspan-structural-conflict');
    assert.equal(built.diagnostics[0].conflict.sourceKind,'fixedCall');
    const narrower=staticPublication(facts,{touch:{parameters:{0:{read:true,write:false,structural:false}},local:none}});
    const allowed=buildHir(facts,selected,narrower);assert.equal(allowed.status,'ok',JSON.stringify(allowed.diagnostics));
    assert.deepEqual(readHir(Buffer.from(printHir(allowed.hir,selected,narrower)),selected,narrower),allowed.hir);
    return;
  }
  if(row.name==='tail-array-call-return-local-escape') {
    assert.equal(built.status,'error');assert.equal(built.diagnostics[0].code,'r03-d-readspan-return-escape');
    const primary=built.diagnostics[0].primary,source=facts.payload.files.find(file=>file.path===primary.sourceId).content;
    assert.equal(source.slice(primary.start,primary.end),'borrow(a)');return;
  }
  if(['union-active-structural-write','view-parameter-alias'].includes(row.name)) {
    assert.equal(built.status,'error');assert.equal(built.diagnostics[0].code,'r03-d-readspan-structural-conflict');
    const diagnostic=built.diagnostics[0],source=facts.payload.files.find(file=>file.path===diagnostic.primary.sourceId).content;
    assert.equal(source.slice(diagnostic.primary.start,diagnostic.primary.end),'a[1]=undefined');
    assert.equal(diagnostic.conflict.sourceKind,'directStore');
    assert.ok(diagnostic.related.some(item=>item.kind==='borrow-last-use'&&source.slice(item.start,item.end)===(row.name==='view-parameter-alias'?'alias[i]':'s[i]')));
    if(row.name==='view-parameter-alias')assert.ok(diagnostic.related.some(item=>item.kind==='borrow-alias'));return;
  }
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));const hir=built.hir;
  assert.equal(hir.facts.version,8);assert.deepEqual(verifyHir(hir,selected,publication),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,selected,publication)),selected,publication),hir);
  const analysis=analyzeArrayCalls(hir,selected,publication);assert.deepEqual(verifyArrayCalls(analysis,hir,selected,publication),analysis);
  if(counts[row.name]) {
    const actual=kinds(hir.functions),expected=counts[row.name];
    assert.deepEqual(['arrayCreate','arrayReadChecked','arrayStoreDenseChecked','arrayResizeChecked'].map(key=>actual[key]??0),expected);
    assert.equal(hir.readSpanPlan,undefined);
  }else if(row.name==='reachable-forty-root-call-results') {
    const entry=hir.functions.find(fn=>fn.name==='entry'),state=hir.readSpanPlan.functions.find(fn=>fn.functionId===entry.id);
    assert.equal(state.views.length,40);assert.equal(state.events.length,64);assert.equal(analysis.calls.length,32);
    assert.equal(state.views.filter(view=>view.origin.kind==='parameter').length,8);
    assert.equal(state.views.filter(view=>view.origin.kind==='callResult').length,32);
    assert.equal(new Set(state.views.map(view=>view.viewId)).size,40);
    assert.equal(state.views.filter(view=>view.binding!==null).length,24);
    assert.deepEqual(state.views.slice(8).map(view=>view.origin.createEvent),Array.from({length:32},(_,i)=>2*i+1));
    assert.ok(state.views.slice(8).every(view=>view.owner.kind==='allocation'&&view.owner.functionId===entry.id));
    const sites=analysis.calls.filter(call=>call.functionId===entry.id).slice(0,2)
      .map(call=>({expressionPath:call.expressionPath,consumedDigest:call.consumedDigest}));
    const request={functionId:entry.id,sites};
    const proof=verifyArrayCallParallelGroup(hir,selected,publication,request);
    assert.equal(proof.pairs.length,1);assert.equal(proof.pairs[0].readRead.length,1);
    assert.deepEqual(readArrayParallelProof(Buffer.from(printArrayParallelProof(proof,hir,selected,publication,request)),
      hir,selected,publication,request),proof);
    const broader=staticPublication(facts,{borrow:{...borrow,parameters:{0:{read:true,write:false,structural:true}}}});
    const broad=buildHir(facts,selected,broader);assert.equal(broad.status,'ok');
    const broadAnalysis=analyzeArrayCalls(broad.hir,selected,broader);
    const broadSites=broadAnalysis.calls.filter(call=>call.functionId===entry.id).slice(0,2)
      .map(call=>({expressionPath:call.expressionPath,consumedDigest:call.consumedDigest}));
    assert.throws(()=>verifyArrayCallParallelGroup(broad.hir,selected,broader,{functionId:entry.id,sites:broadSites}),
      {code:'r03-d-array-parallel-conflict'});
  }else if(row.name==='ordered-carrier-refinement') {
    const fn=hir.functions.find(fn=>fn.name==='run'),types=new Map(hir.types.map(type=>[type.id,type]));
    const array=types.get(fn.returnType.id),union=types.get(array.elementType);
    assert.equal(array.kind,'array');assert.equal(union.kind,'union');
    assert.deepEqual(union.members.map(id=>types.get(id).kind).sort(),['scalar','undefined']);
    const b=fn.body.find(row=>row.kind==='local'&&row.binding.name==='b');
    assert.equal(b.binding.type,fn.returnType.id);assert.equal(b.initializer.type,fn.returnType.id);
    assert.equal(b.initializer.elements[0].declaredType,union.id);
    assert.equal(fn.body.at(-1).value.declaredType,fn.returnType.id);
  }else if(row.name==='global1024') {
    assert.equal(hir.readSpanPlan.version,5);assert.equal(hir.readSpanPlan.functions.length,8);
    // Original frozen whole budget oracle records121 calls, independently of v8 output.
    assert.equal(analysis.calls.length,121);
  }else if(row.name==='generic-union-parameter-scc') {
    assert.equal(hir.readSpanPlan,undefined);assert.equal(analysis.calls.length,3);
    for(const fn of hir.functions) {
      const result=analysis.functions.find(result=>result.functionId===fn.id);
      assert.deepEqual(result.derived.reads,[{kind:'parameter',functionId:fn.id,index:0}]);
      assert.deepEqual(result.effective.reads,[{kind:'parameter',functionId:fn.id,index:0}]);
      assert.equal(result.derived.structural.length,0);assert.equal(result.effective.structural.length,0);
    }
  }else if(['union-view-return','box-view-return','value-view-return'].includes(row.name)) {
    const read=hir.functions.find(fn=>fn.name==='read'),state=hir.readSpanPlan.functions.find(fn=>fn.functionId===read.id);
    assert.equal(state.views.length,1);assert.equal(state.views[0].origin.kind,'callResult');
    assert.equal(state.views[0].owner.kind,'parameter');assert.equal(state.views[0].owner.index,0);
    assert.deepEqual(state.events.map(event=>event.kind),['array-call-effect','view-call-result-create-complete','view-read-complete']);
    assert.equal(analysis.calls.length,1);
    assert.ok(hir.types.some(type=>row.name==='box-view-return'?type.kind==='reference'
      :row.name==='value-view-return'?type.kind==='value':type.kind==='union'));
  }else {
    const state=hir.readSpanPlan.functions.find(fn=>fn.views.length);
    const store=state.events.find(event=>event.kind==='array-store-effect');assert.ok(store);
    if(row.name==='after-last-use')assert.ok(state.views[0].lastUseEvent<store.sequence);
    else {assert.equal(row.name,'serial-overwrite');assert.equal(store.nonStructural,true);
      assert.ok(state.views[0].lastUseEvent>store.sequence);}
  }
  const obsolete={...selected,version:1};assert.equal(buildHir(facts,obsolete,publication).status,'error');
  const oldFixed={...publication,version:4};assert.equal(buildHir(facts,selected,oldFixed).status,'error');
});
