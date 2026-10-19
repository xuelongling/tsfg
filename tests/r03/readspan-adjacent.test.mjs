// SPDX-License-Identifier: MIT
// Whole expectations were frozen before Product output was observed. Source-only
// refusals stay Source-only; this suite never synthesizes a successful packet.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir,analyzeArrayCalls,
  verifyArrayCalls,printArrayCalls,readArrayCalls } from '../../compiler/hir.mjs';
import { pinned,jcs,fresh,wire,deeplyFrozen } from './array-test-fixtures.mjs';

const oracle=await pinned('./legacy-v5-adjacent-oracle.json',3673652,
  'ed2ad3825be1f0c780fd6181b8a02caf6c0ee469e42483e78364408db74f67dc');
assert.equal(oracle.family,'tsfg.r03.legacy-v5-adjacent-oracle');
assert.equal(oracle.version,5);assert.equal(new Set(oracle.cases.map(row=>row.requestText)).size,18);
assert.equal(oracle.crosspin.interface.sha256,
  '0b0cbffa7efc0d44589ba45bc71f5380d7cc7a089a6303dc2f224e9cc7505081');
assert.deepEqual(oracle.cases.map(row=>row.name),[
  'fixed-wide-body-narrow','fixed-wide-body-narrow-readonly-context',
  'same-owner-full-slots','parameter-may-alias','independent-fresh-call-local',
  'late-unused-view-alias','descriptor-length-last-use','known-overwrite-equal-resize',
  'invalidated-length-overwrite','invalidated-length-resize','rhs-last-use-append',
  'zero-length-conflict','full-u32-endpoint-checks','borrow-work-1024','borrow-work-1025',
  'core-isolated-view-gate','raw-calls-32','raw-calls-33','global-fees-before-earlier-conflict',
]);
const packets=oracle.cases.filter(row=>Object.hasOwn(row,'packageText'));
assert.equal(packets.length,18);
assert.equal(packets.filter(row=>row.expectedDiagnostic).length,10);
assert.equal(packets.filter(row=>row.analysis).length,8);
/** @param {string} name @returns {any} */
const rowByName=name=>{const row=oracle.cases.find(row=>row.name===name);assert.ok(row);return row;};

/** Every public invocation starts with unrelated caller-owned graphs and bytes.
 * A successful earlier invocation cannot grant a later context any validity.
 * @param {any} row @returns {any} */
function cold(row){
  const report=fresh(row.analysis??row.preConsumerAnalysis);
  return {packet:JSON.parse(row.packageText),hir:fresh(row.hir),context:fresh(row.context),report,
    facts:{...fresh(row.factsContext),factsBytes:Buffer.from(row.packageText)},
    hirBytes:wire(row.hir),reportBytes:wire(report)};
}
/** @param {any} state @param {any} row */
function unchanged(state,row){
  assert.deepEqual(state.packet,JSON.parse(row.packageText));
  assert.deepEqual(state.hir,row.hir);assert.deepEqual(state.context,row.context);
  assert.deepEqual(state.report,row.analysis??row.preConsumerAnalysis);
  assert.deepEqual(state.facts,{...fresh(row.factsContext),factsBytes:Buffer.from(row.packageText)});
  assert.deepEqual(state.hirBytes,wire(row.hir));
  assert.deepEqual(state.reportBytes,wire(row.analysis??row.preConsumerAnalysis));
}
/** @type {Record<string,(state:any)=>any>} */
const entries={
  buildHir:state=>buildHir(state.packet,state.facts,state.context),
  verifyHir:state=>verifyHir(state.hir,state.facts,state.context),
  printHir:state=>printHir(state.hir,state.facts,state.context),
  readHir:state=>readHir(state.hirBytes,state.facts,state.context),
  lowerHir:state=>lowerHir(state.hir,state.facts,state.context),
  analyzeArrayCalls:state=>analyzeArrayCalls(state.hir,state.facts,state.context),
  verifyArrayCalls:state=>verifyArrayCalls(state.report,state.hir,state.facts,state.context),
  printArrayCalls:state=>printArrayCalls(state.report,state.hir,state.facts,state.context),
  readArrayCalls:state=>readArrayCalls(state.reportBytes,state.hir,state.facts,state.context),
};
/** @param {any} row @param {string} entry @returns {any} */
function invoke(row,entry){
  const state=cold(row);let value,error,threw=false;
  try{value=entries[entry](state);}catch(cause){error=cause;threw=true;}
  unchanged(state,row);return {state,value,error,threw};
}
/** Preserve all public diagnostic fields, including ranges, related anchors,
 * owner slots, paths and consumed identities. @param {any} error */
const diagnostic=error=>({message:error.message,
  ...Object.fromEntries(Object.keys(error).map(key=>[key,error[key]]))});
/** @param {any} outcome @param {any} expected */
function rejected(outcome,expected){
  assert.equal(outcome.threw,true);assert.ok(outcome.error instanceof TypeError);
  assert.deepEqual(diagnostic(outcome.error),expected);
}
/** @param {any} row @param {string} entry @param {any} outcome */
function check(row,entry,outcome){
  if(row.expectedDiagnostic){
    if(entry==='buildHir'){
      assert.equal(outcome.threw,false);
      assert.deepEqual(outcome.value,{status:'error',diagnostics:[row.expectedDiagnostic]});
      deeplyFrozen(outcome.value);
    }else{rejected(outcome,row.expectedDiagnostic);deeplyFrozen(outcome.error);}
    return;
  }
  if(entry==='lowerHir'){rejected(outcome,row.expectedCoreDiagnostic);return;}
  assert.equal(outcome.threw,false,outcome.error?.stack);
  const expected=entry==='buildHir'?{status:'ok',hir:row.hir}:
    entry==='printHir'?jcs(row.hir)+'\n':
    entry==='printArrayCalls'?jcs(row.analysis)+'\n':
    entry.endsWith('ArrayCalls')?row.analysis:row.hir;
  assert.deepEqual(outcome.value,expected);deeplyFrozen(outcome.value);
  // An owned result must survive destruction of every supplied caller graph.
  const state=outcome.state;
  state.packet.payload.functions.length=0;state.hir.functions.length=0;
  state.context.contracts.length=0;state.report.functions.length=0;
  state.facts.factsBytes.fill(0);state.hirBytes.fill(0);state.reportBytes.fill(0);
  assert.deepEqual(outcome.value,expected);
}

for(const row of packets)test('26a adjacent whole public boundaries: '+row.name,async t=>{
  assert.deepEqual(readArrayFactsCandidate(Buffer.from(row.packageText)),JSON.parse(row.packageText));
  // The complete negative pre-consumer report is supplied to every report seam;
  // none may return it without first applying the mandatory borrow consumer.
  for(const entry of Object.keys(entries))await t.test(entry,()=>check(row,entry,invoke(row,entry)));
});

test('26a adjacent corpus retains independent official closures and complete strict-budget artifacts',()=>{
  for(const row of oracle.cases){
    assert.equal(row.inheritedProvenance.productionObserved,false);
    assert.deepEqual(row.official.diagnostics,{global:0,program:0,semantic:0,syntax:0});
    assert.equal(row.official.readonlyIndexer,true);assert.equal(row.official.readonlyLength,true);
    assert.equal(jcs(JSON.parse(row.requestText))+'\n',row.requestText);
    assert.equal(JSON.parse(row.requestText).version,5);
    for(const metric of Object.values(row.metrics)){
      assert.ok(metric.bytes<=2*1024*1024);assert.ok(metric.tokens<=200000);
      assert.ok(metric.depth<=64);assert.ok(metric.stringBytes<=1024*1024);
    }
    if(!row.packageText)continue;
    assert.equal(row.inheritedProvenance.productionImported,false);
    assert.equal(row.inheritedProvenance.facetsCrosscheckedWithExplicitHandRecipe,true);
    assert.equal(row.inheritedProvenance.noRuntimeGCOrPhysicalSingletonClaim,true);
    assert.equal(jcs(JSON.parse(row.packageText))+'\n',row.packageText);
    assert.equal(row.hir.format.version,5);assert.equal(row.hir.types.length,4);
    assert.ok(row.hir.readSpanPlan);
    if(row.analysis)assert.deepEqual(row.analysis,row.preConsumerAnalysis);
  }
});

test('26a the same packet alternates wide and readonly fixed contexts without cached acceptance',()=>{
  const wide=rowByName('fixed-wide-body-narrow');
  const readonly=rowByName('fixed-wide-body-narrow-readonly-context');
  assert.equal(wide.packageText,readonly.packageText);assert.equal(wide.requestText,readonly.requestText);
  const target=wide.hir.readSpanPlan.calls[0].target;
  const wideUpper=wide.context.contracts.find(row=>row.functionId===target).upper.parameters[0];
  const readonlyUpper=readonly.context.contracts.find(row=>row.functionId===target).upper.parameters[0];
  assert.deepEqual(wideUpper,{index:0,read:false,structural:true,write:false});
  assert.deepEqual(readonlyUpper,{index:0,read:false,structural:false,write:false});
  const caller=wide.preConsumerAnalysis.functions.at(-1);
  assert.deepEqual(caller.derived.structural,[]);assert.equal(caller.effective.structural.length,1);
  assert.deepEqual(readonly.analysis.functions.at(-1).effective.structural,[]);
  for(const row of [readonly,wide,readonly,wide])
    for(const entry of ['buildHir','analyzeArrayCalls'])check(row,entry,invoke(row,entry));
});

test('26a complete slots, parameter may-alias and independent fresh/call-local owners are distinct witnesses',()=>{
  const slots=rowByName('same-owner-full-slots'),args=slots.hir.readSpanPlan.calls[0].arguments;
  assert.deepEqual(args.map(arg=>arg.index),[0,1]);assert.deepEqual(args[0].owner,args[1].owner);
  assert.equal(slots.expectedDiagnostic.conflict.parameterIndex,0);
  const mayAlias=rowByName('parameter-may-alias').expectedDiagnostic.conflict;
  assert.equal(mayAlias.viewOwner.kind,'parameter');assert.equal(mayAlias.structuralOwner.kind,'parameter');
  assert.equal(mayAlias.viewOwner.functionId,mayAlias.structuralOwner.functionId);
  assert.deepEqual([mayAlias.viewOwner.index,mayAlias.structuralOwner.index],[0,1]);
  const separate=rowByName('independent-fresh-call-local'),plan=separate.hir.readSpanPlan;
  const view=plan.functions.at(-1).views[0],call=plan.calls[0];
  assert.equal(view.owner.kind,'allocation');assert.equal(call.arguments[0].owner.kind,'allocation');
  assert.notEqual(view.owner.allocationSite,call.arguments[0].owner.allocationSite);
  assert.deepEqual(call.publishedLocal,{kind:'callLocal',functionId:call.functionId,
    expressionPath:call.expressionPath});
  const structural=separate.analysis.functions.at(-1).effective.structural;
  assert.ok(structural.some(owner=>owner.kind==='callLocal'));
  assert.ok(!structural.some(owner=>jcs(owner)===jcs(view.owner)));
});

test('26a alias and descriptor length are real final uses while known-length proofs retain checks',()=>{
  const alias=rowByName('late-unused-view-alias'),length=rowByName('descriptor-length-last-use');
  assert.equal(alias.hir.readSpanPlan.functions.at(-1).events.at(-1).kind,'view-alias-copy-complete');
  assert.deepEqual(alias.expectedDiagnostic.conflict.lastUsePath,['body',3,'initializer']);
  assert.equal(length.hir.readSpanPlan.functions.at(-1).events.at(-1).kind,'view-length-complete');
  assert.deepEqual(length.expectedDiagnostic.conflict.lastUsePath,['body',3,'expression']);
  const known=rowByName('known-overwrite-equal-resize');
  const effects=known.hir.readSpanPlan.functions[0].events.filter(event=>event.kind.startsWith('array-'));
  assert.deepEqual(effects.map(event=>[event.kind,event.nonStructural]),
    [['array-store-effect',true],['array-resize-effect',true]]);
  assert.deepEqual(known.hir.functions[0].body.slice(2,4).map(stmt=>stmt.kind),
    ['arrayStoreDenseChecked','arrayResizeChecked']);
  assert.equal(rowByName('invalidated-length-overwrite').expectedDiagnostic.conflict.sourceKind,'directStore');
  assert.equal(rowByName('invalidated-length-resize').expectedDiagnostic.conflict.sourceKind,'directResize');
  assert.equal(rowByName('zero-length-conflict').expectedDiagnostic.conflict.sourceKind,'directResize');
});

test('26a checked RHS final use precedes append effect and full u32 endpoints remain checked',()=>{
  const rhs=rowByName('rhs-last-use-append').hir.readSpanPlan.functions[0];
  assert.deepEqual(rhs.events.map(event=>[event.kind,event.expressionPath]),[
    ['view-create-complete',['body',1,'initializer']],
    ['view-read-complete',['body',2,'value']],['array-store-effect',['body',2]],
  ]);
  assert.equal(rhs.views[0].lastUseEvent,1);assert.equal(rhs.events[2].nonStructural,false);
  const body=rowByName('full-u32-endpoint-checks').hir.functions[0].body;
  assert.equal(body[1].initializer.kind,'readSpanCreateChecked');
  assert.deepEqual([body[1].initializer.start.decimal,body[1].initializer.length.decimal],
    ['4294967295','4294967295']);
  assert.equal(body[2].value.kind,'readSpanReadChecked');
  assert.equal(body[2].value.index.decimal,'4294967294');
});

test('26a inclusive work 1024 succeeds and global registration/use fees precede an earlier conflict',()=>{
  const pass=rowByName('borrow-work-1024'),over=rowByName('borrow-work-1025');
  assert.deepEqual(pass.work,{borrowTotal:1024,comparisons:1005,owner:1548,registrations:10,uses:9});
  assert.deepEqual(over.work,{borrowTotal:1025,comparisons:1005,limitStep:1025,owner:1549,
    phase:'overlap',registrations:10,uses:10});
  const global=rowByName('global-fees-before-earlier-conflict');
  assert.deepEqual(global.work,{borrowTotal:1039,comparisons:0,limitStep:1025,owner:899,
    phase:'global-fees',registrations:272,uses:767});
  assert.deepEqual(global.expectedDiagnostic,over.expectedDiagnostic);
  assert.deepEqual(over.expectedDiagnostic,{code:'r03-d-readspan-limit',phase:'hir',
    ruleId:'r01-input-boundary',message:'ReadSpan analysis exceeds work limit'});
  const first=global.hir.readSpanPlan.functions[0],view=first.views[0];
  const mutation=first.events.find(event=>event.kind==='array-resize-effect');
  assert.equal(mutation.nonStructural,false);assert.deepEqual(mutation.owner,view.owner);
  assert.ok(view.origin.createEvent<mutation.sequence);assert.ok(mutation.sequence<view.lastUseEvent);
});

test('26a isolated view Core refusal is anchored at view creation rather than parameters or ordinary calls',()=>{
  const row=rowByName('core-isolated-view-gate'),fn=row.hir.functions[0];
  assert.equal(row.hir.functions.length,1);assert.deepEqual(fn.parameters,[]);
  assert.deepEqual(row.hir.readSpanPlan.calls,[]);
  const range=fn.body[1].initializer.range;
  assert.deepEqual(row.expectedCoreDiagnostic,{code:'r03-d-core-array-capability',phase:'lowering',
    ruleId:'r01-ts-baseline',
    message:'Array Core lowering supports only the complete local-owner no-call subset',
    primary:{sourceId:fn.sourcePath,...range}});
});

test('26a raw calls 32 has a complete package while 33 remains an official-valid Source refusal only',()=>{
  const pass=rowByName('raw-calls-32'),over=rowByName('raw-calls-33');
  assert.deepEqual(pass.official.functions.find(fn=>fn.function==='entry'),
    {function:'entry',intrinsicCalls:17,locals:17,ordinaryCalls:15,rawCalls:32,statements:33});
  assert.deepEqual(over.official.functions.find(fn=>fn.function==='entry'),
    {function:'entry',intrinsicCalls:17,locals:17,ordinaryCalls:16,rawCalls:33,statements:34});
  assert.equal(over.inheritedProvenance.officialValidPrivateSourceInvalid,true);
  assert.deepEqual(over.expectedSourceError,{code:'r03-array-facts-limit',phase:'input',ruleId:'r01-input-boundary'});
  for(const key of ['packageText','hir','context','analysis','preConsumerAnalysis'])assert.ok(!Object.hasOwn(over,key));
  // Root runs the real Source raw33 check; no Product packet is invented here.
});
