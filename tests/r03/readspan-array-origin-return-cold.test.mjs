// SPDX-License-Identifier: MIT
// 26d cold joins use independent current gold; legacy39/helper migration remains STOP.
// Keep this direct-public harness separate until that blocked migration can be qualified.
import assert from 'node:assert/strict';
import { expectedArrayCore13 } from './array-core13-literal.mjs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { projectArrayFacts } from '../../compiler/array-hir-model.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir,analyzeArrayCalls,
  verifyArrayCalls,printArrayCalls,readArrayCalls } from '../../compiler/hir.mjs';
import { jcs,sha,fresh,wire,deeplyFrozen } from './array-test-fixtures.mjs';

/** @param {any} actual @param {any} expected @param {string} label */
function whole(actual,expected,label) {
  const a=jcs(actual),e=jcs(expected);
  assert.ok(a===e,label+'; actual sha256='+sha(a??'undefined')+' expected sha256='+sha(e??'undefined'));
}
/** @param {Buffer} actual @param {Buffer} expected @param {string} label */
function bytes(actual,expected,label) {
  assert.ok(actual.equals(expected),label+'; actual sha256='+sha(actual)+' expected sha256='+sha(expected));
}
/** @param {any} actual @param {string} expected @param {string} label */
function text(actual,expected,label) {
  assert.equal(typeof actual,'string');
  assert.ok(actual===expected,label+'; actual sha256='+sha(actual)+' expected sha256='+sha(expected));
}
const original=await readFile(new URL('./readspan-array-origin-return-cold-oracle.json',import.meta.url));
assert.equal(original.length,13188);
assert.equal(sha(original),'8b60cf55e87fa0b4a84e0c120d3f8a36ee4f2a53c098c192a1077df1d222a8a1');
const oracle=JSON.parse(original.toString('utf8'));
assert.equal(oracle.family,'tsfg.m26d-independent-array-origin-cold-oracle');
const goldBytes=await readFile(new URL(oracle.gold.file,import.meta.url));
assert.equal(goldBytes.length,oracle.gold.bytes);assert.equal(sha(goldBytes),oracle.gold.sha256);
const gold=JSON.parse(goldBytes.toString('utf8'));
assert.equal(gold.family,'tsfg.m26d-independent-slots-forward-whole-oracle');
/** @type {any[]} */
const rows=oracle.cases;
assert.equal(rows.length,24);assert.equal(new Set(rows.map(row=>row.id)).size,24);
const originalOracle=jcs(oracle),originalGold=jcs(gold);
const diagnostics=oracle.expectedDiagnostics;
const zero='sha256:'+'0'.repeat(64);
const selectId=oracle.anchors.selectFunctionId;

/** @param {any} pin @returns {Promise<Buffer>} */
async function readPin(pin) {
  assert.ok(pin&&typeof pin==='object');assert.equal(typeof pin.path,'string');
  assert.ok(/^(?:[A-Za-z]:[\\/]|\/)/.test(pin.path),'actual pin uses an absolute path');
  assert.ok(Number.isSafeInteger(pin.bytes)&&pin.bytes>0);assert.match(pin.sha256,/^[0-9a-f]{64}$/);
  const raw=await readFile(pin.path);assert.equal(raw.length,pin.bytes);assert.equal(sha(raw),pin.sha256);
  return raw;
}
const actualPin=JSON.parse(process.env.TSFG_READSPAN_ARRAY_RETURN_COLD_SOURCE_MANIFEST??'null');
whole(actualPin,oracle.actualManifest,'Root supplies the exact qualified new-source manifest');
const manifest=JSON.parse((await readPin(actualPin)).toString('utf8'));
assert.ok(Array.isArray(manifest.cases));assert.equal(manifest.cases.length,2);
/** @type {Map<string,Buffer>} */
const actual=new Map();
for(const row of manifest.cases) {
  assert.ok(gold.cases.some((/** @type {any} */ expected)=>expected.name===row.name));
  assert.ok(!actual.has(row.name));actual.set(row.name,await readPin(row.packet));
}
assert.equal(actual.size,2);

/** Descriptor-only traversal never evaluates an accessor or canonicalizes its containing object.
 * Buffers are copied; object/prototype/get/set identities and all descriptor flags are retained.
 * @param {any} root @returns {any[]} */
function snapshot(root) {
  /** @type {any[]} */
  const tokens=[];
  const seen=new Set();
  /** @param {any} value */
  const visit=value=>{
    if(Buffer.isBuffer(value)){tokens.push('buffer',Buffer.from(value));return;}
    if(value===null||typeof value!=='object'){tokens.push('scalar',value);return;}
    tokens.push('object',value,Object.getPrototypeOf(value),Object.isExtensible(value));
    if(seen.has(value)){tokens.push('seen');return;}
    seen.add(value);
    /** @type {any} */
    const descriptors=Object.getOwnPropertyDescriptors(value);
    const keys=Reflect.ownKeys(descriptors);
    tokens.push('keys',keys.length,...keys);
    for(const key of keys) {
      const d=descriptors[key];
      tokens.push('descriptor',key,d.enumerable,d.configurable,Object.hasOwn(d,'value'));
      if(Object.hasOwn(d,'value')){tokens.push(d.writable);visit(d.value);}
      else tokens.push(d.get,d.set);
    }
  };
  visit(root);return tokens;
}
/** @param {any} state @param {any[]} before */
function unchanged(state,before) {
  const after=snapshot(state);assert.equal(after.length,before.length,'descriptor token count unchanged');
  for(let i=0;i<before.length;i++) {
    if(Buffer.isBuffer(before[i])&&Buffer.isBuffer(after[i]))bytes(after[i],before[i],'input buffer unchanged');
    else assert.ok(Object.is(after[i],before[i]),'input descriptor token unchanged at '+i);
  }
}
/** @param {any} base @param {Buffer} raw @returns {any} */
function stateFor(base,raw) {
  return {packet:JSON.parse(raw.toString('utf8')),hir:fresh(base.completeHir),
    report:fresh(base.completeAnalysis),context:fresh(base.publicationContext),
    facts:{...fresh(base.factsContext),factsBytes:Buffer.from(raw)},
    hirBytes:Buffer.alloc(0),reportBytes:Buffer.alloc(0),getGetterCalls:()=>0};
}
/** @param {any} context @param {boolean} wrongDigest */
function rehashContext(context,wrongDigest) {
  for(const row of context.contracts)row.digest='sha256:'+sha('tsfg.array-published-contract.v4\0'
    +jcs({functionId:row.functionId,signatureHash:row.signatureHash,upper:row.upper}));
  if(wrongDigest)context.contracts.find((/** @type {any} */ row)=>row.functionId===selectId).digest=zero;
  context.expectedDigest='sha256:'+sha('tsfg.array-publication.v4\0'
    +jcs({scopeDigest:context.scopeDigest,contracts:context.contracts}));
}
/** Keep every digest binding self-consistent; semantic full-slot coverage still precedes plan comparison.
 * @param {any} s @param {boolean} wrongDigest */
function bindContext(s,wrongDigest) {
  rehashContext(s.context,wrongDigest);
  s.hir.readSpanPlan.publication={scopeDigest:s.context.scopeDigest,publishedDigest:s.context.expectedDigest};
  /** @type {Map<string,string>} */
  const digests=new Map(s.context.contracts.map((/** @type {any} */ row)=>[row.functionId,row.digest]));
  for(const call of s.hir.readSpanPlan.calls)call.consumedDigest=digests.get(call.target);
  s.report.contracts=fresh(s.context.contracts);s.report.scopeDigest=s.context.scopeDigest;
  s.report.publishedDigest=s.context.expectedDigest;s.report.calls=fresh(s.hir.readSpanPlan.calls);
  for(const fn of s.report.functions)for(const dep of fn.dependencies)dep.digest=digests.get(dep.functionId);
}
/** @param {any} row @param {any} s */
function mutate(row,s) {
  const plan=s.hir.readSpanPlan;
  const entry=plan.functions.find((/** @type {any} */ fn)=>fn.functionId===oracle.anchors.caller);
  const root=entry?.views.find((/** @type {any} */ view)=>view.origin.kind==='callResult');
  const call=plan.calls.find((/** @type {any} */ value)=>value.target===selectId);
  const wrongOwner={kind:'parameter',functionId:selectId,index:3};
  const fixed=s.context.contracts.find((/** @type {any} */ value)=>value.functionId===selectId);
  switch(row.id) {
    case 'plan-returned-slot':call.returnedView.index=1;break;
    case 'plan-returned-owner':call.returnedView.owner=wrongOwner;break;
    case 'call-result-root-owner':root.owner=wrongOwner;break;
    case 'call-result-family-id': {
      const originalId=root.viewId;root.viewId=zero;
      for(const event of entry.events) {
        if(event.viewId===originalId)event.viewId=zero;
        for(const use of event.uses??[])if(use.viewId===originalId)use.viewId=zero;
      }
      break;
    }
    case 'merge-owner-equal-families': {
      const old=entry.views[0],originalId=root.viewId,create=entry.events[root.origin.createEvent];
      old.aliases.push({binding:root.binding,initializerBinding:old.binding,event:root.origin.createEvent},
        ...fresh(root.aliases));
      old.useEvents=[...new Set([...old.useEvents,...root.useEvents])].sort((/** @type {any} */ a,/** @type {any} */ b)=>a-b);
      old.lastUseEvent=root.lastUseEvent;entry.views.splice(entry.views.indexOf(root),1);
      create.kind='view-call-result-alias-complete';create.initializerBinding=old.binding;
      for(const event of entry.events) {
        if(event.viewId===originalId)event.viewId=old.viewId;
        for(const use of event.uses??[])if(use.viewId===originalId)use.viewId=old.viewId;
      }
      break;
    }
    case 'last-use-and-use-events':root.useEvents=[5,6];root.lastUseEvent=6;break;
    case 'call-result-create-origin':root.origin.createEvent=1;break;
    case 'call-result-event-order': {
      const group=entry.events[2];entry.events[2]=entry.events[3];entry.events[3]=group;
      entry.events[2].sequence=2;entry.events[3].sequence=3;root.origin.createEvent=2;break;
    }
    case 'call-result-event-call-index':entry.events[3].callIndex=1;break;
    case 'call-result-event-parameter-index':entry.events[3].parameterIndex=1;break;
    case 'bound-result-null':root.binding=null;entry.events[3].binding=null;break;
    case 'tail-result-nonnull': {
      const fn=s.hir.functions.find((/** @type {any} */ fn)=>fn.name==='forward2');
      const tail=plan.functions.find((/** @type {any} */ state)=>state.functionId===fn.id);
      const binding=fn.parameters[0].id;tail.views[0].binding=binding;
      tail.events[1].binding=binding;tail.events[2].binding=binding;break;
    }
    case 'plan-publication-hash':plan.publication.publishedDigest=zero;break;
    case 'hir-descriptor-identity-hash':s.hir.format.schemaHash=zero;break;
    case 'return-slot-array1':fixed.upper.returnOrigin={kind:'parameter',index:1};break;
    case 'return-slot-view4':fixed.upper.returnOrigin={kind:'parameter',index:4};break;
    case 'return-slot-scalar0':fixed.upper.returnOrigin={kind:'parameter',index:0};break;
    case 'return-slot-scalar2':fixed.upper.returnOrigin={kind:'parameter',index:2};break;
    case 'return-null-empty-authorization':fixed.upper.returnOrigin=null;break;
    case 'required-read-undercoverage':
      fixed.upper.parameters.find((/** @type {any} */ parameter)=>parameter.index===3).read=false;break;
    case 'context-row-digest':break;
    case 'report-only-returned-owner':
      s.report.calls.find((/** @type {any} */ value)=>value.target===selectId).returnedView.owner=wrongOwner;break;
    case 'hir-call-result-owner-getter':case 'fixed-return-origin-getter':break;
    default:assert.fail('unapproved cold mutant');
  }
  if(row.matrix==='forged-hir')s.report.calls=fresh(plan.calls);
  if(['contract-all-nine','identity-five-four'].includes(row.matrix))
    bindContext(s,row.id==='context-row-digest');
  // Accessors cannot have canonical JSON identity. They are installed only after clean wire snapshots.
  s.report.hirDigest='sha256:'+sha(jcs(s.hir));s.hirBytes=wire(s.hir);s.reportBytes=wire(s.report);
  assert.equal(s.report.hirDigest,'sha256:'+sha(jcs(s.hir)));
  if(row.matrix==='hir-getter'||row.matrix==='context-getter') {
    let calls=0;
    const get=()=>{calls++;throw new Error('untrusted getter must never execute');};
    const target=row.matrix==='hir-getter'?root:fixed.upper;
    Object.defineProperty(target,row.matrix==='hir-getter'?'owner':'returnOrigin',
      {enumerable:true,configurable:true,get});
    s.getGetterCalls=()=>calls;
  }
}
/** @type {Record<string,(state:any)=>any>} */
const entries={
  buildHir:s=>buildHir(s.packet,s.facts,s.context),
  verifyHir:s=>verifyHir(s.hir,s.facts,s.context),
  printHir:s=>printHir(s.hir,s.facts,s.context),
  readHir:s=>readHir(s.hirBytes,s.facts,s.context),
  lowerHir:s=>lowerHir(s.hir,s.facts,s.context),
  analyzeArrayCalls:s=>analyzeArrayCalls(s.hir,s.facts,s.context),
  verifyArrayCalls:s=>verifyArrayCalls(s.report,s.hir,s.facts,s.context),
  printArrayCalls:s=>printArrayCalls(s.report,s.hir,s.facts,s.context),
  readArrayCalls:s=>readArrayCalls(s.reportBytes,s.hir,s.facts,s.context),
};
/** @param {any} row @param {string} name @returns {any} */
function expectedError(row,name) {
  if(row.matrix==='forged-hir')return name==='buildHir'?null:diagnostics[row.diagnosticRef];
  if(row.matrix==='contract-all-nine')return diagnostics[row.diagnosticRef];
  const hir=oracle.matrices.hirFive.includes(name);
  if(row.matrix==='identity-five-four')
    return diagnostics[hir?'hirContextNoPrimary':'arrayCallsIdentity'];
  if(row.matrix==='report-only')
    return ['verifyArrayCalls','printArrayCalls','readArrayCalls'].includes(name)?diagnostics.arrayCallsReport:null;
  if(row.matrix==='hir-getter')
    return oracle.matrices.hirGetterObjectReject.includes(name)?diagnostics.hirInvalidNoPrimary:null;
  if(row.matrix==='context-getter')
    return diagnostics[hir?'hirContextNoPrimary':'arrayCallsBase'];
  assert.fail('unknown cold matrix');
}
/** @param {()=>any} action @param {any} expected */
function rejects(action,expected) {
  /** @type {any} */
  let error;try{action();}catch(cause){error=cause;}
  assert.ok(error instanceof TypeError,'public boundary must refuse with TypeError');
  /** @type {any} */
  const publicError=error;
  const dto={message:publicError.message,...Object.fromEntries(Object.keys(publicError).map(key=>[key,publicError[key]]))};
  whole(dto,expected,'complete public diagnostic');
}
/** @param {any} base @param {string} name @param {()=>any} action @param {any} state */
function normal(base,name,action,state) {
  if(name==='lowerHir'){assert.equal(action(),expectedArrayCore13(state.hir,state.facts,state.context));return;}
  const result=action();
  if(name==='printHir')text(result,jcs(base.completeHir)+'\n','original complete HIR text');
  else if(name==='printArrayCalls')text(result,jcs(base.completeAnalysis)+'\n','original complete report text');
  else {
    const expected=name==='buildHir'?{status:'ok',hir:base.completeHir}:
      name.endsWith('ArrayCalls')?base.completeAnalysis:base.completeHir;
    whole(result,expected,'original complete '+name);deeplyFrozen(result);
  }
}
for(const base of gold.cases)test('26d cold controls preserve complete actual Source and independent gold: '+base.name,()=>{
  const raw=actual.get(base.name);assert.ok(raw);const before=Buffer.from(raw);
  bytes(raw,Buffer.from(base.packageText),'actual packet equals complete independent literal');
  const packet=readArrayFactsCandidate(raw);whole(packet,base.package,'complete owned facts');deeplyFrozen(packet);
  bytes(writeArrayFactsCandidate(packet),raw,'complete canonical facts roundtrip');
  whole(projectArrayFacts(packet),base.projectedHIR,'complete owned HIR8 projection');
  bytes(raw,before,'actual bytes unchanged');text(jcs(gold),originalGold,'gold unchanged');
});
for(const row of rows)test('26d Array-origin cold full-source join: '+row.id,async t=>{
  const base=gold.cases[row.source==='forward'?1:0],raw=actual.get(base.name);assert.ok(raw);
  const originalRaw=Buffer.from(raw);
  for(const [name,entry]of Object.entries(entries))await t.test(name,()=>{
    const state=stateFor(base,raw);mutate(row,state);const before=snapshot(state);
    assert.equal(state.getGetterCalls(),0,'snapshot never evaluates a getter');
    const error=expectedError(row,name);
    if(error&&name==='buildHir') {
      const result=entry(state);whole(result,{status:'error',diagnostics:[error]},'complete build refusal');
      deeplyFrozen(result);
    }else if(error)rejects(()=>entry(state),error);
    else normal(base,name,()=>entry(state),state);
    assert.equal(state.getGetterCalls(),0,'public preflight never evaluates a getter');
    unchanged(state,before);bytes(raw,originalRaw,'Root actual Source bytes unchanged');
  });
  text(jcs(oracle),originalOracle,'independent cold oracle unchanged');
  text(jcs(gold),originalGold,'independent whole gold unchanged');
});
