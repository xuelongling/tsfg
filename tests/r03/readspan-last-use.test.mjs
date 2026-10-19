// SPDX-License-Identifier: MIT
// Inputs and whole expectations are independent static data, never captured Product output.
// Root separately proves actual official Source4 publications equal these exact packets.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir,analyzeArrayCalls,
  verifyArrayCalls,printArrayCalls,readArrayCalls } from '../../compiler/hir.mjs';
import { pinned,jcs,sha,fresh,wire,deeplyFrozen } from './array-test-fixtures.mjs';

const oracle=await pinned('./readspan-first-oracle.json',96542,
  '77525f6e2d76b4de4bb2e1300fab50096e910b90357aea536ea862cb06b84c55');
assert.equal(oracle.family,'tsfg.readspan-first-independent-oracle');assert.equal(oracle.version,1);
assert.deepEqual(oracle.contractPin,{bytes:257929,
  sha256:'f7dd26e2d3929d718dcf6fd930436b0b0d2c602a67c1e165badd9173ceabcc73'});
assert.deepEqual(oracle.cases.map(row=>row.name),['before','after']);
const before=oracle.cases[0],after=oracle.cases[1],bogus='sha256:'+'0'.repeat(64);
for(const row of oracle.cases){
  assert.equal(row.provenance.productionModuleImported,false);
  assert.equal(row.provenance.productionOutputSampled,false);
  assert.deepEqual(row.official.diagnostics,{syntax:0,semantic:0,program:0,global:0});
  assert.equal(jcs(JSON.parse(row.packageText))+'\n',row.packageText);
  assert.equal(row.work.owner,30);
}
assert.deepEqual([before.work.borrowTotal,after.work.borrowTotal],[5,4]);

/** @param {any} row */
const factsContext=row=>({...fresh(row.factsContext),factsBytes:Buffer.from(row.packageText)});
/** Capture every enumerable public field, plus the standard Error message. @param {any} error */
const dto=error=>({message:error.message,...Object.fromEntries(Object.keys(error).map(k=>[k,error[k]]))});
/** @param {()=>unknown} action @param {any} expected */
function rejects(action,expected){
  let error;try{action();}catch(cause){error=cause;}
  assert.ok(error instanceof TypeError,'public boundary must reject');
  assert.deepEqual(dto(error),expected);return error;
}
/** @param {string} kind @param {any} [primary] */
const hirError=(kind,primary=undefined)=>({code:'r03-array-hir-'+kind,ruleId:'r01-input-boundary',
  phase:'hir',message:'r03-array-hir-'+kind+': invalid selected Array HIR',...(primary?{primary}:{})});
/** @param {string} [kind] */
const callError=(kind='')=>({code:'r03-d-array-call-effects'+(kind?'-'+kind:''),ruleId:'r01-call-contract',
  phase:'analysis',message:'r03-d-array-call-effects'+(kind?'-'+kind:'')+': invalid fixed Array owner publication'});
/** These are all eight throwing entry points; build is checked separately.
 * @param {any} row @param {any} hir @param {any} context @param {any} [report] */
function seams(row,hir,context,report=row.analysis??row.preConsumerAnalysis){
  return {
    verifyHir:()=>verifyHir(hir,factsContext(row),context),
    printHir:()=>printHir(hir,factsContext(row),context),
    readHir:()=>readHir(wire(hir),factsContext(row),context),
    lowerHir:()=>lowerHir(hir,factsContext(row),context),
    analyzeArrayCalls:()=>analyzeArrayCalls(hir,factsContext(row),context),
    verifyArrayCalls:()=>verifyArrayCalls(report,hir,factsContext(row),context),
    printArrayCalls:()=>printArrayCalls(report,hir,factsContext(row),context),
    readArrayCalls:()=>readArrayCalls(wire(report),hir,factsContext(row),context),
  };
}
/** Standard digest repair for hostile contexts only, never a new successful oracle.
 * @param {any} context */
function resign(context){
  for(const row of context.contracts){
    const {digest,...body}=row;row.digest='sha256:'+sha('tsfg.array-published-contract.v1\0'+jcs(body));
  }
  context.expectedDigest='sha256:'+sha('tsfg.array-publication.v1\0'+jcs({
    scopeDigest:context.scopeDigest,contracts:context.contracts}));
  return context;
}

test('26a all nine public entry points reject the whole independent before-last-use conflict',async t=>{
  const input=JSON.parse(before.packageText),context=fresh(before.context),hir=fresh(before.hir);
  const beforeInput=fresh(input),beforeHir=fresh(hir),beforeContext=fresh(context);
  const built=buildHir(input,factsContext(before),context);
  assert.deepEqual(built,{status:'error',diagnostics:[before.expectedDiagnostic]});deeplyFrozen(built);
  for(const [name,action]of Object.entries(seams(before,hir,context)))await t.test(name,()=>{
    const error=rejects(action,before.expectedDiagnostic);deeplyFrozen(error);
    assert.deepEqual(hir,beforeHir);assert.deepEqual(context,beforeContext);
  });
  assert.deepEqual(input,beforeInput);
});

test('26a after-last-use whole HIR and report roundtrip own the graph while retaining exact Core refusal',()=>{
  const input=JSON.parse(after.packageText),hir=fresh(after.hir),context=fresh(after.context),ctx=factsContext(after);
  const beforeInput=fresh(input),beforeHir=fresh(hir),beforeContext=fresh(context),beforeBytes=Buffer.from(ctx.factsBytes);
  assert.deepEqual(readArrayFactsCandidate(ctx.factsBytes),input);
  const built=buildHir(input,ctx,context);assert.equal(built.status,'ok');
  assert.deepEqual(built.hir,after.hir);deeplyFrozen(built);
  const verified=verifyHir(hir,ctx,context);assert.deepEqual(verified,after.hir);deeplyFrozen(verified);
  const text=printHir(verified,ctx,context);assert.equal(text,jcs(after.hir)+'\n');
  const carrier=Buffer.concat([Buffer.from('prefix!'),Buffer.from(text),Buffer.from('suffix!')]);
  const read=readHir(carrier.subarray(7,7+Buffer.byteLength(text)),ctx,context);
  assert.deepEqual(read,after.hir);deeplyFrozen(read);carrier.fill(0);
  const report=analyzeArrayCalls(verified,ctx,context);assert.deepEqual(report,after.analysis);deeplyFrozen(report);
  assert.deepEqual(verifyArrayCalls(fresh(after.analysis),hir,ctx,context),after.analysis);
  const reportText=printArrayCalls(report,hir,ctx,context);assert.equal(reportText,jcs(after.analysis)+'\n');
  assert.deepEqual(readArrayCalls(Buffer.from(reportText),hir,ctx,context),after.analysis);
  rejects(()=>lowerHir(hir,ctx,context),after.expectedCoreDiagnostic);
  assert.deepEqual(input,beforeInput);assert.deepEqual(hir,beforeHir);
  assert.deepEqual(context,beforeContext);assert.deepEqual(ctx.factsBytes,beforeBytes);
  hir.functions.length=0;context.contracts.length=0;input.payload.functions.length=0;ctx.factsBytes.fill(0);
  assert.deepEqual(built.hir,after.hir);assert.deepEqual(verified,after.hir);assert.deepEqual(read,after.hir);
  assert.deepEqual(report,after.analysis);
});

test('26a cold whole-plan checks reject every forged last-use, owner, alias, proof and call field',async t=>{
  /** @type {Array<[string,(h:any)=>void,(h:any)=>any]>} */
  const changes=[
    ['last-use event',h=>{h.readSpanPlan.functions[1].views[0].lastUseEvent=0;},()=>undefined],
    ['view owner',h=>{h.readSpanPlan.functions[1].views[0].owner.allocationSite=bogus;},()=>undefined],
    ['direct nonStructural proof',h=>{h.readSpanPlan.functions[0].events[0].nonStructural=true;},
      h=>h.readSpanPlan.functions[0].events[0].range],
    ['actual full parameter slot',h=>{h.readSpanPlan.calls[0].arguments[0].index=1;},h=>h.readSpanPlan.calls[0].range],
    ['consumed Published digest',h=>{h.readSpanPlan.calls[0].consumedDigest=bogus;},h=>h.readSpanPlan.calls[0].range],
    ['alias provenance chain',h=>{h.readSpanPlan.functions[1].views[0].aliases[0].initializerBinding=bogus;},()=>undefined],
    ['last-use registry',h=>{h.readSpanPlan.functions[1].views[0].useEvents.pop();},()=>undefined],
    ['dropped future event',h=>{h.readSpanPlan.functions[1].events.pop();},h=>h.readSpanPlan.calls[0].range],
  ];
  for(const [name,mutate,primary]of changes)await t.test(name,()=>{
    const h=fresh(after.hir),context=fresh(after.context),range=primary(h);mutate(h);const unchanged=fresh(h);
    const expected=hirError('invalid',range?{sourceId:after.hir.rootFile,...range}:undefined);
    for(const action of Object.values(seams(after,h,context)))rejects(action,expected);
    assert.deepEqual(h,unchanged);assert.deepEqual(context,after.context);
  });
  // A hostile plan must fail before the valid reconstruction's overlap diagnostic.
  const hostile=fresh(before.hir);hostile.readSpanPlan.functions[1].views[0].lastUseEvent=0;
  for(const action of Object.values(seams(before,hostile,fresh(before.context))))rejects(action,hirError('invalid'));
});

test('26a supplied plan publication identity cannot be detached from its complete fixed context',()=>{
  const hostile=fresh(after.hir);hostile.readSpanPlan.publication.publishedDigest=bogus;
  for(const action of Object.values(seams(after,hostile,fresh(after.context))))rejects(action,hirError('context'));
});

test('26a views require the complete third context and preserve fixed identity rejection at each seam',async t=>{
  /** @type {Array<[string,()=>any,string]>} */
  const changes=[
    ['missing third context',()=>undefined,''],
    ['wrong mode',()=>({...fresh(after.context),mode:'derived'}),''],
    ['incomplete function table',()=>{const c=fresh(after.context);c.contracts.pop();return resign(c);},'identity'],
    ['wrong expected table digest',()=>({...fresh(after.context),expectedDigest:bogus}),'identity'],
    ['wrong scope with repaired outer digest',()=>resign({...fresh(after.context),scopeDigest:bogus}),'identity'],
  ];
  for(const [name,make,kind]of changes)await t.test(name,()=>{
    const context=make(),h=fresh(after.hir),snapshot=fresh(h);
    const result=buildHir(JSON.parse(after.packageText),factsContext(after),context);
    assert.deepEqual(result,{status:'error',diagnostics:[hirError('context')]});
    for(const [seam,action]of Object.entries(seams(after,h,context)))
      rejects(action,seam.includes('ArrayCalls')?callError(kind):hirError('context'));
    assert.deepEqual(h,snapshot);
  });
});

test('26a a re-signed narrow Published structural upper fails coverage before any borrow or Core result',()=>{
  const context=fresh(after.context),fn=after.hir.functions[0];
  context.contracts.find(c=>c.functionId===fn.id).upper.parameters[0].structural=false;resign(context);
  const expected={...callError('contract'),functionId:fn.id,facet:'parameter:0:structural',
    primary:{sourceId:fn.sourcePath,...fn.range}};
  const input=JSON.parse(after.packageText),h=fresh(after.hir),snapshot=fresh(context);
  assert.deepEqual(buildHir(input,factsContext(after),context),{status:'error',diagnostics:[expected]});
  for(const action of Object.values(seams(after,h,context)))rejects(action,expected);
  assert.deepEqual(h,after.hir);assert.deepEqual(context,snapshot);
});

test('26a selected contexts and whole owned view graphs never invoke getter or Proxy behavior',()=>{
  let traps=0;
  const trap=()=>{traps++;throw Error('private view sentinel');};
  const proxy=value=>new Proxy(value,{get:trap,ownKeys:trap,getPrototypeOf:trap,getOwnPropertyDescriptor:trap});
  const getter=fresh(after.hir);
  Object.defineProperty(getter.readSpanPlan.functions[1].views[0],'owner',{enumerable:true,get:trap});
  for(const h of [getter,proxy(fresh(after.hir))]){
    for(const action of [()=>verifyHir(h,factsContext(after),fresh(after.context)),
      ()=>analyzeArrayCalls(h,factsContext(after),fresh(after.context))])rejects(action,hirError('invalid'));
    assert.equal(traps,0);
  }
  const publication=fresh(after.context);
  Object.defineProperty(publication,'contracts',{enumerable:true,get:trap});
  for(const context of [publication,proxy(fresh(after.context))]){
    rejects(()=>verifyHir(fresh(after.hir),factsContext(after),context),hirError('context'));
    rejects(()=>analyzeArrayCalls(fresh(after.hir),factsContext(after),context),callError());
    assert.equal(traps,0);
  }
  const badFacts=factsContext(after);badFacts.expectedPackageId=bogus;
  rejects(()=>verifyHir(proxy({}),badFacts,fresh(after.context)),hirError('context'));assert.equal(traps,0);
  const report=fresh(after.analysis);Object.defineProperty(report,'functions',{enumerable:true,get:trap});
  for(const unsafe of [report,proxy(fresh(after.analysis))])
    rejects(()=>verifyArrayCalls(unsafe,fresh(after.hir),factsContext(after),fresh(after.context)),callError());
  assert.equal(traps,0);
});

test('26a canonical HIR and report framing remain mandatory after complete view validation',()=>{
  const h=jcs(after.hir)+'\n',a=jcs(after.analysis)+'\n';
  for(const text of [h.slice(0,-1),h+'\n',' '+h])
    rejects(()=>readHir(Buffer.from(text),factsContext(after),fresh(after.context)),hirError('canonical'));
  for(const text of [a.slice(0,-1),a+'\n',' '+a])
    rejects(()=>readArrayCalls(Buffer.from(text),fresh(after.hir),factsContext(after),fresh(after.context)),callError('canonical'));
});
