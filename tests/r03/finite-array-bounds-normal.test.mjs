// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,buildInitialArrayPublication,lowerFormalHir} from '../../compiler/hir.mjs';
import {addFiniteTerminalReturnCarriers,buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildFiniteArrayReaching} from '../../compiler/finite-array-reaching.mjs';
import {buildTypedLayouts} from '../../compiler/typed-layouts.mjs';
import {canonical,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {accepted,invokeCore} from './generic-core-package-capture.mjs';
import manifest from './testdata/typed-array-consumer-v8/manifest.json' with {type:'json'};
import actualManifest from './testdata/typed-array-actual-v8/manifest.json' with {type:'json'};

const spanEndpoint={
  name:'span-relative-endpoint',file:'typed-array-checked-bounds/span-relative-endpoint-package.json',
  sha256:'435d3a093f662ea3dec90b2369461b244fd4de600bf0b86b8db01d4779dff852',
  packageId:'sha256:b424e43f1d1b2b620274cf4bb3cc76b09566418d1fb15ee0524689702f8c2344',
  requestId:'sha256:5d12866e8ccc5ebd35c58ab51dd12d53621fc0bfd43db44b12d79527ed402f53',
};

async function checkedFixture(fixture,folder='typed-array-consumer-v8/') {
  assert.ok(fixture);
  const bytes=await readFile(new URL('./testdata/'+folder+fixture.file,import.meta.url));
  assert.equal(sha256(bytes),'sha256:'+fixture.sha256);
  const facts=readTypedArrayFacts(bytes);
  assert.equal(facts.packageId,fixture.packageId);
  assert.equal(facts.requestId,fixture.requestId);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=fixture===spanEndpoint?buildInitialArrayPublication(context):staticPublication(facts);
  const built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  return {hir:built.hir,context,publication};
}

test('a symbolic dense write leaves the former Array endpoint possibly initialized',async()=>{
  const [{hir},{hir:endpoint},{hir:overwrite}]=await Promise.all(
    ['dynamic-owner-aliases','length-equal-checked-read','dense-overwrite'].map(name=>checkedFixture(manifest.find(row=>row.name===name))));
  const dynamic=hir.functions.find(fn=>fn.name==='zeta'),sameIndex=hir.functions.find(fn=>fn.name==='alpha');
  assert.ok(dynamic&&sameIndex);
  const [local,alias,chained,store,resize,returned]=dynamic.body;
  const two=endpoint.functions[0].body[1].value.index,one=overwrite.functions[0].body[1].expression.target.index;
  assert.equal(store.expression.kind,'arrayStoreDenseChecked');
  assert.equal(resize.expression.kind,'arrayResizeChecked');
  assert.equal(two.decimal,'2');assert.equal(one.decimal,'1');
  // Model the analysis inputs with checked operations to inspect state on each successful path.
  const readAt=index=>({...returned,value:{...returned.value,index}});
  const analyze=(statements,index)=>{
    const body=[local,alias,chained,...statements,readAt(index)];
    const model={...hir,functions:[{...dynamic,body},sameIndex]};
    const {reaching}=buildFiniteArrayReaching(model,{nodes:[],domains:[],calls:[]},()=>{},()=>false);
    return {reaching,read:reaching.reads.find(row=>row.node===dynamic.id+'/body/'+(body.length-1)+'/value')};
  };
  const {reaching,read}=analyze([store],two);
  assert.match(reaching.writes.find(row=>row.kind==='store'&&row.id.startsWith(dynamic.id+'/'))?.index??'',/^s:/);
  assert.equal(read?.status,'pending');
  assert.deepEqual(read.versions,[]);
  assert.equal(reaching.reads.find(row=>row.node.startsWith(sameIndex.id+'/'))?.status,'proven');

  const postfix=actualManifest.find(row=>row.sourceIdentity==='1a80de3941d5c05dc0e4889e97267da169263bbfe70344e312cd0e74e964180d');
  const update=(await checkedFixture(postfix,'typed-array-actual-v8/')).hir.functions[0].body[0].value;
  assert.equal(update.kind,'arrayUpdate');
  const checkedUpdate={...store,expression:{...update,type:store.expression.type,target:store.expression.target}};
  assert.equal(analyze([checkedUpdate],two).read?.status,'missing');

  const prefixWrite={...store,expression:{...store.expression,target:{...store.expression.target,index:one}}};
  const shrink={...resize,expression:{...resize.expression,value:two}};
  const prefixRead=analyze([store,prefixWrite,shrink],one).read;
  assert.equal(prefixRead?.status,'proven');
  assert.equal(prefixRead.versions.length,1);
  assert.equal(analyze([store,prefixWrite,shrink],two).read?.status,'missing');
});

for(const [name,status] of [
  ['empty-checked-read','missing'],['length-equal-checked-read','missing'],
  ['far-oob-checked-read','missing'],['dense-overwrite','proven'],['after-last-use','pending'],
  [spanEndpoint.name,'missing'],
])test('actual '+name+' preserves '+status+' normal Array flow',async t=>{
  const relativeSpan=name===spanEndpoint.name;
  const {hir,context,publication}=relativeSpan?await checkedFixture(spanEndpoint,''):
    await checkedFixture(manifest.find(entry=>entry.name===name));
  const plans=buildFiniteCoreDomains(hir,context,{publicationContext:publication});
  const [fn]=hir.functions;
  for(const plan of [plans.reached,plans.definition]) {
    assert.equal(plan.arrayReaching.reads.length,1);
    const [read]=plan.arrayReaching.reads;
    assert.equal(read.status,status);
    if(status==='proven')assert.equal(read.versions.length,1);
    else assert.deepEqual([read.versions,read.sources],[[],[]]);
    const domains=new Map(plan.domains.map(domain=>[domain.id,domain.actualTypes]));
    for(const id of [read.node,fn.id+'/return']) {
      const node=plan.nodes.find(node=>node.id===id);assert.ok(node);
      assert.deepEqual(domains.get(node.domainId),status==='proven'?[scalarTypeIds.f64]:[]);
      assert.deepEqual(node.pending,status==='pending'?['unproved-ordered-array-read:'+read.node]:[]);
    }
    if(name==='empty-checked-read') {
      const allocation=plan.carrierNodes.find(node=>node.id.endsWith('/elements'));assert.ok(allocation);
      assert.deepEqual(domains.get(allocation.domainId),[]);
    }
  }
  const core=lowerFormalHir(hir,context,publication),[read]=plans.definition.arrayReaching.reads;
  /** @param {string} text */
  const checkedRead=text=>text.split('\n').find(line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes('array_node = "'+read.node+'"'));
  assert.ok(checkedRead(core));
  if(name==='empty-checked-read') {
    const definition=plans.definition,layouts=buildTypedLayouts(hir,context,{publicationContext:publication});
    const plan=addFiniteTerminalReturnCarriers(hir,definition,layouts,()=>{});
    const bottom=sha256('tsfg.actual-domain.v1\0[]'),carrier=sha256('tsfg.actual-domain.v1\0'+JSON.stringify([fn.returnType.id]));
    const abi=plan.abi.find(row=>row.functionId===fn.id);
    assert.equal(abi.result,carrier);
    assert.equal(abi.id,sha256('tsfg.finite-abi.v1\0'+canonical({parameters:abi.parameters,result:carrier})));
    assert.equal(plan.carrierNodes.find(row=>row.id===read.node).domainId,carrier);
    assert.equal(plan.carrierNodes.find(row=>row.id===fn.id+'/return').domainId,carrier);
    const {id,...published}=plan.published.find(row=>row.functionId===fn.id);
    assert.equal(published.resultBound,carrier);
    assert.equal(published.abi,abi.id);
    assert.equal(id,sha256('tsfg.published-call.v1\0'+canonical(published)));
    assert.strictEqual(plan.nodes,definition.nodes);
    assert.strictEqual(plan.arrayReaching,definition.arrayReaching);
    assert.ok(core.includes('tsfg_core.finite_abi = "'+abi.id+'"'));
    // Exercise the gate at the representation seam with a lexical caller.
    const called={...definition,fieldReaching:{...definition.fieldReaching,
      callContexts:[{site:'test-call-site',target:fn.id,fields:[]}]}};
    assert.strictEqual(addFiniteTerminalReturnCarriers(hir,called,layouts,()=>{}),called);
    const lines=core.split('\n'),created=lines.find(line=>line.includes('"tsfg_core.domain.array_create"'));
    assert.ok(created?.includes('"tsfg_core.domain.array_create"()'));
    assert.ok(created.includes('array_versions = "[]"'));
    assert.ok(created.includes('element_domain = "'+bottom+'"'));
    assert.match(checkedRead(core),/ -> f64$/);
    assert.ok(!lines.some(line=>line.includes('"tsfg_core.domain.literal"')||line.includes('"tsfg_core.domain.array_store"')));
  }
  if(process.env.TSFG_CORE_IR_EXE&&name==='after-last-use')await t.test('Static Core retains the checked Span read before the owner write',async()=>{
    for(const mode of ['--canonicalize','--optimize']) {
      const result=await invokeCore(core,mode);
      accepted(result);
      const text=result.stdout.toString('utf8'),readLine=checkedRead(text);
      assert.ok(readLine);
      const created=text.indexOf('"tsfg_core.domain.read_span"');
      const loaded=text.indexOf(readLine);
      const stored=text.indexOf('"tsfg_core.domain.array_store"');
      assert.ok(created>=0&&created<loaded&&loaded<stored);
    }
  });
  if(process.env.TSFG_CORE_IR_EXE&&status==='missing')await t.test('Static Core admits the original checked read in both modes',async()=>{
    const canonicalized=await invokeCore(core);
    accepted(canonicalized);
    const text=canonicalized.stdout.toString('utf8'),readLine=checkedRead(text);
    assert.ok(readLine);
    if(relativeSpan) {
      const span=text.match(/^ +(%\S+) = "tsfg_core\.domain\.read_span"\(/m);
      assert.ok(span&&text.indexOf(span[0])<text.indexOf(readLine));
      assert.ok(readLine.includes('"tsfg_core.domain.array_read"('+span[1]+', '));
    }
    const optimized=await invokeCore(core,'--optimize');
    accepted(optimized);
    assert.deepEqual(optimized.stdout,canonicalized.stdout);
  });
});
