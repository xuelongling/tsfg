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
const arrayEntryFixture={file:'636f10994484e0fad8ae813a403b5f20136e3c28e5e84766658c470e5cf29571-package.json',
  sha256:'7732a541fe22955a8a4a3a4449a6117e793f5807e58cf527fd65f3148d1c5657',
  packageId:'sha256:1c15ccfce665452c422635ba21cac5cfa657a296c32e5d234126c218b4bfacf8',
  requestId:'sha256:e68b201086d40beec104c396ba1a497f0191ef19f000cbcdc3d9bf7222735f72'};

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

test('shrinking through a parameter invalidates the length of another possibly aliased parameter',async()=>{
  const {hir}=await checkedFixture(manifest.find(row=>row.name==='empty-append-rhs-shrink'));
  const [fn]=hir.functions,[array,,store,,shrink,returned]=fn.body;
  const a={...array.binding,id:'a'},b={...array.binding,id:'b'},zero=returned.value.index,one=shrink.expression.value;
  assert.equal(zero.decimal,'0');assert.equal(one.decimal,'1');
  const reference=binding=>({...returned.value.receiver,binding:binding.id});
  const retarget=(statement,binding)=>({...statement.expression,target:{...statement.expression.target,receiver:reference(binding)}});
  const storeTo=binding=>({...store,expression:retarget(store,binding)});
  const shrinkTo=(binding,value)=>({...shrink,expression:{...retarget(shrink,binding),value}});
  const lengthOf=binding=>({kind:'arrayLength',type:zero.type,range:zero.range,receiver:reference(binding)});
  // Component analysis of checked operations with two external Array parameters.
  const fresh={...array,initializer:{...array.initializer,elements:[store.expression.value]}};
  const readAt=index=>{
    const result={...returned,value:{...returned.value,index}};
    const body=[fresh,storeTo(a),storeTo(b),shrinkTo(b,one),shrinkTo(a,zero),result];
    const model={...hir,functions:[{...fn,parameters:[a,b],body}]};
    const {reaching}=buildFiniteArrayReaching(model,{nodes:[],domains:[],calls:[]},()=>{},()=>false);
    const read=reaching.reads.find(row=>row.node===fn.id+'/body/'+(body.length-1)+'/value');
    assert.ok(read);return read;
  };
  const maybeAlias=readAt(lengthOf(b));
  assert.equal(maybeAlias.status,'pending');assert.deepEqual(maybeAlias.versions,[]);
  assert.equal(readAt(lengthOf(a)).status,'proven','the shrunk receiver has exact length zero');
  assert.equal(readAt(zero).status,'proven','the private fresh Array retains its original element');
});

test('a normally returning read-only call preserves the caller’s unpassed Array index',async()=>{
  const [{hir},{hir:readerHir},{hir:constantHir}]=await Promise.all([
    checkedFixture(manifest.find(row=>row.name==='dynamic-owner-aliases')),
    checkedFixture(actualManifest.find(row=>row.sourceIdentity==='ef37f9372bf3611c8d6fb98090975753ba0cd55d13add934d833002fbe0ba59f'),
      'typed-array-actual-v8/'),
    checkedFixture(manifest.find(row=>row.name==='empty-append-rhs-shrink')),
  ]);
  const caller=hir.functions.find(fn=>fn.name==='alpha'),reader=readerHir.functions.find(fn=>fn.name==='read');
  assert.ok(caller&&reader);
  const [local,store,returned]=caller.body,zero=constantHir.functions[0].body.at(-1).value.index;
  assert.equal(store.expression.kind,'arrayStoreDenseChecked');
  assert.equal(reader.body[0].value.kind,'arrayReadChecked');
  assert.equal(zero.decimal,'0');
  const plan={nodes:[],domains:[],calls:[]};
  const range=returned.range,call={kind:'expression',range,expression:{
    kind:'call',target:reader.id,arguments:[returned.value.receiver,zero],type:reader.returnType.id,range,
  }};
  for(const calls of [[],[call]]){
    // Component projection of two authentic, separately checked Array functions.
    const body=[local,store,...calls,returned],model={...hir,functions:[{...caller,body},reader]};
    const {reaching}=buildFiniteArrayReaching(model,plan,()=>{},()=>false);
    const read=reaching.reads.find(row=>row.node===caller.id+'/body/'+(body.length-1)+'/value');
    assert.equal(read?.status,'proven');
    assert.deepEqual(read.sources,[caller.id+'/body/1/expression/value']);
  }
});

test('a call writing one Array preserves disjoint writes and forgets possible parameter aliases',async()=>{
  const fixture={file:'binary-right-old-value-present-package.json',
    sha256:'5ad521e5a988cbccb3cad4ff12f22425121dee8c67e3019e9836587f005c2c23',
    packageId:'sha256:c79f052802216268c121f70d72d5990fc4342649c3442e535f6d1dd22f36b734',
    requestId:'sha256:88d71f4b62ad6973ab216ec2f4a1851543b05ff14cf0169bbcc1f920d9a068f0'};
  const [{hir},{hir:writerHir}]=await Promise.all([
    checkedFixture(manifest.find(row=>row.name==='dynamic-owner-aliases')),
    checkedFixture(fixture,'typed-array-terminal-compound/'),
  ]);
  const caller=hir.functions.find(fn=>fn.name==='alpha'),writer=writerHir.functions.find(fn=>fn.name==='earlier');
  assert.ok(caller&&writer);
  const [local,store,returned]=caller.body,parameter=writer.parameters[0];
  const [written,kept]=['destination','unwritten'].map(id=>({...parameter,id}));
  const helper={...writer,parameters:[parameter,{...parameter,id:'independent-input'}]};
  const range=returned.range,reference=binding=>({...returned.value.receiver,binding:binding.id});
  const call={kind:'expression',range,expression:{kind:'call',type:writer.returnType.id,target:writer.id,
    arguments:[reference(written),reference(kept)],range}};
  const write={...store,expression:{...store.expression,target:{...store.expression.target,receiver:reference(kept)}}};
  const observe={kind:'expression',range,expression:{...returned.value,receiver:reference(kept)}};
  const returnWritten={...returned,value:{...returned.value,receiver:reference(written),index:writer.body[0].expression.target.index}};
  const plan={nodes:[],domains:[],calls:[]};

  // These are component projections of separately checked Array operations.
  for(const disjoint of [true,false]){
    const initializers=disjoint?[written,kept].map(binding=>({...local,binding:{...local.binding,id:binding.id}})):[];
    const parameters=disjoint?caller.parameters:[...caller.parameters,written,kept];
    const body=[...initializers,write,call,observe,returnWritten];
    const {reaching}=buildFiniteArrayReaching({...hir,functions:[{...caller,parameters,body},helper]},plan,()=>{},()=>false);
    const site=caller.id+'/body/',read=reaching.reads.find(row=>row.node===site+(body.length-2)+'/expression');
    assert.equal(read?.status,disjoint?'proven':'pending');
    assert.deepEqual(read.sources,disjoint?[site+'2/expression/value']:[]);
    const changed=reaching.reads.find(row=>row.node===site+(body.length-1)+'/value');
    assert.deepEqual(changed?.sources,[writer.id+'/body/0/expression/value']);
  }
});

test('a returning branch does not carry its local Array binding into the normal merge',async()=>{
  const {hir}=await checkedFixture(arrayEntryFixture,'typed-array-entry/');
  const fn=hir.functions.find(row=>row.name==='runUnknown'),read=hir.functions.find(row=>row.name==='read').body[0].value;
  const [early,branch,live,returned]=fn.body;
  assert.equal(branch.kind,'if');assert.equal(read.kind,'arrayReadChecked');
  const returnRead=call=>({...returned,value:{...read,receiver:call.arguments[0],index:call.arguments[1]}});
  // Component analysis of a branch-local declaration and return, with the checked Array operations.
  const terminal=[early,returnRead(branch.then[0].expression)];
  for(const [then,otherwise] of [[terminal,[]],[[],terminal]]){
    const body=[{...branch,then,else:otherwise},live,returnRead(returned.value)];
    const model={...hir,functions:[{...fn,body}]};
    const {reaching}=buildFiniteArrayReaching(model,{nodes:[],domains:[],calls:[]},()=>{},()=>false);
    const result=reaching.reads.find(row=>row.node===fn.id+'/body/2/value');
    assert.equal(result?.status,'proven');
    assert.deepEqual(result.sources,[fn.id+'/body/1/initializer/elements/0']);
  }
});

test('a while body that returns preserves the Array versions on the skipped path',async()=>{
  const [{hir},{hir:entryHir}]=await Promise.all([
    checkedFixture(manifest.find(row=>row.name==='dense-overwrite')),
    checkedFixture(arrayEntryFixture,'typed-array-entry/'),
  ]);
  const [fn]=hir.functions,[local,store,returned]=fn.body;
  const entry=entryHir.functions.find(row=>row.name==='runUnknown');
  assert.ok(entry);
  const [flag]=entry.parameters,condition=entry.body[1].condition,range=store.range;
  const bool=entryHir.types.find(row=>row.id===flag.type);
  assert.ok(bool);
  const types=hir.types.some(row=>row.id===bool.id)?hir.types:[...hir.types,bool];
  const prefix=fn.id+'/body/';
  const write={...store,expression:{...store.expression,target:{...store.expression.target,index:returned.value.index}}};
  function readAfter(body) {
    const loop={kind:'while',range,condition,body};
    const model={...hir,types,functions:[{...fn,parameters:[flag],body:[local,loop,returned]}]};
    const {reaching}=buildFiniteArrayReaching(model,{nodes:[],domains:[],calls:[]},()=>{},()=>false);
    const read=reaching.reads.find(row=>row.node===prefix+'2/value');
    assert.ok(read);
    return read;
  }
  const original=[prefix+'0/initializer/elements/0'];
  for(const exit of [returned,{kind:'block',range,body:[returned]},
    {kind:'if',range,condition,then:[returned],else:[returned]}]) {
    const read=readAfter([write,exit]);
    assert.equal(read.status,'proven');
    assert.deepEqual(read.sources,original);
  }
  const repeated=readAfter([write]);
  assert.equal(repeated.status,'pending');
  assert.deepEqual(repeated.sources,[]);
});

test('a skipped boolean operand preserves the binding used by a later Array write guard',async()=>{
  const [{hir},{hir:entryHir}]=await Promise.all([
    checkedFixture(manifest.find(row=>row.name==='dense-overwrite')),
    checkedFixture(arrayEntryFixture,'typed-array-entry/'),
  ]);
  const [fn]=hir.functions,[local,store,returned]=fn.body;
  const entry=entryHir.functions.find(row=>row.name==='runUnknown');
  assert.ok(entry);
  const [flag]=entry.parameters,unknown=entry.body[1].condition;
  const bool=entryHir.types.find(row=>row.id===flag.type);
  assert.ok(bool);
  const types=hir.types.some(row=>row.id===bool.id)?hir.types:[...hir.types,bool];
  const prefix=fn.id+'/body/',range=unknown.range;
  const gate={...local.binding,id:fn.id+'/gate',name:'gate',type:bool.id,writable:true};
  const ref={...unknown,binding:gate.id};
  const write={...store,expression:{...store.expression,target:{...store.expression.target,index:returned.value.index}}};
  const original=prefix+'0/initializer/elements/0',replacement=prefix+'3/then/0/expression/value';
  for(const [name,includeRight] of [['runAnd',false],['runOr',false],['runAnd',true]]) {
    const sample=entryHir.functions.find(row=>row.name===name)?.body[1].expression;
    assert.ok(sample);
    const initial={...sample.left,value:false},assigned={...sample.left,value:true};
    const declare={...local,binding:gate,initializer:initial};
    const assignment={kind:'assignment',type:bool.id,range,target:ref,value:assigned};
    const expression={...sample,left:includeRight?unknown:sample.left,right:assignment};
    const guarded={kind:'if',range,condition:ref,then:[write],else:[]};
    const body=[local,declare,{kind:'expression',range,expression},guarded,returned];
    const model={...hir,types,functions:[{...fn,parameters:[flag],body}]};
    const {reaching}=buildFiniteArrayReaching(model,{nodes:[],domains:[],calls:[]},()=>{},()=>false);
    const read=reaching.reads.find(row=>row.node===prefix+'4/value');
    assert.equal(read?.status,'proven');
    assert.deepEqual(read.sources,includeRight?[original,replacement]:[original]);
  }
});

test('String concatenation requires each checked Array operand before the next read',async t=>{
  const actual=sourceIdentity=>checkedFixture(actualManifest.find(row=>row.sourceIdentity===sourceIdentity),'typed-array-actual-v8/');
  const [{hir},{hir:concatHir},{hir:endpoint},{hir:overwrite}]=await Promise.all([
    actual('c5f4d1da4d8ee6a8ed92f7e69ca7463fca4a496500ff136fe1407cd39ed6edc7'),
    actual('619021d061e1003c598032e3bdaf00ece6600b52927d3718334a723a4c1e821e'),
    checkedFixture(manifest.find(row=>row.name==='length-equal-checked-read')),
    checkedFixture(manifest.find(row=>row.name==='dense-overwrite')),
  ]);
  const [fn]=hir.functions,[local,returned]=fn.body,original=concatHir.functions[0].body[1].expression.value;
  const boundary=endpoint.functions[0].body.at(-1).value.index,first=overwrite.functions[0].body.at(-1).value.index;
  assert.equal(original.kind,'stringConcat');
  assert.equal(returned.value.kind,'arrayReadChecked');
  assert.equal(returned.value.type,original.type);
  assert.equal(local.initializer.elements.length,2);
  assert.equal(boundary.decimal,'2');assert.equal(first.decimal,'0');
  // Project verified typed operands into an analysis model. The captures
  // retain the actual String concat and Array read separately.
  const inside={...returned.value,index:first},outside={...returned.value,index:boundary};
  const root=fn.id+'/body/',initial=root+'0/initializer/initial/0/array-version';
  for(const [name,left,right,statuses] of [
    ['left fails',outside,inside,['missing','pending','pending']],
    ['right fails',inside,outside,['proven','missing','pending']],
    ['both complete',inside,inside,['proven','proven','proven']],
  ])await t.test(name,()=>{
    const expression={...original,left,right};
    const model={...hir,functions:[{...fn,body:[local,{kind:'expression',expression,range:expression.range},{...returned,value:inside}]}]};
    const {reaching}=buildFiniteArrayReaching(model,{nodes:[],domains:[],calls:[]},()=>{},()=>true);
    const reads=['1/expression/left','1/expression/right','2/value'].map(path=>reaching.reads.find(row=>row.node===root+path));
    assert.deepEqual(reads.map(row=>row?.status),statuses);
    assert.deepEqual(reads.map(row=>row?.versions),statuses.map(status=>status==='proven'?[initial]:[]));
  });
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
