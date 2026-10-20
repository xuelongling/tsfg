// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {verifyHir,analyzeModuleCalls} from '../../compiler/hir.mjs';

const oracle=JSON.parse(await readFile(new URL('./call-effects-oracle.json',import.meta.url),'utf8'));
const first=JSON.parse(await readFile(new URL('./call-effects-first.json',import.meta.url),'utf8'));
const clone=value=>structuredClone(value);
const pure={reads:[],writes:[],unknownHost:false};
const top={reads:[],writes:[],unknownHost:true};
const messages={
 context:['r03-d-call-effects','invalid module call publication context'],
 identity:['r03-d-call-contract-identity','published call contract identity differs'],
 bound:['r03-d-call-contract','implementation exceeds published call upper bound'],
 limit:['r03-d-call-effects-limit','module call effects budget exceeded'],
};
function rejects(action,kind,primary=undefined) {
 const [code,message]=messages[kind];
 assert.throws(action,error=>{
  assert.ok(error instanceof TypeError);assert.equal(Reflect.get(error,'code'),code);
  assert.equal(error.message,code+': '+message);assert.equal(Reflect.get(error,'ruleId'),'r01-call-contract');
  assert.equal(Reflect.get(error,'phase'),'hir');
  if(primary===undefined)assert.equal(Object.hasOwn(error,'primary'),false);
  else assert.deepEqual(Reflect.get(error,'primary'),primary);
  return true;
 });
}
// Only malformed-input mutations are re-signed here. All semantic/report/hash
// expectations are pre-implementation literals in call-effects-oracle.json.
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'
 ? '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const digest=(domain,value)=>'sha256:'+createHash('sha256').update(domain+'\0'+canonical(value)).digest('hex');
function seal(context) {
 for(const record of context.contracts)record.digest=digest('tsfg.published-call-contract.v1',
  {functionId:record.functionId,signatureHash:record.signatureHash,upper:record.upper});
 context.expectedDigest=digest('tsfg.module-call-publication.v1',context.contracts);return context;
}
const selected=(hir,context)=>verifyHir(hir,undefined,context);
const initial=name=>oracle.initial.find(item=>item.name===name);
const fixed=name=>oracle.fixed.find(item=>item.name===name);
const fixedFrom=item=>({mode:'fixed',expectedDigest:item.expected.publishedDigest,contracts:clone(item.expected.contracts)});

for(const item of oracle.initial)test('initial complete module analysis: '+item.name,()=>{
 assert.deepEqual(verifyHir(item.hir),item.hir);
 assert.deepEqual(analyzeModuleCalls(item.hir,item.context),item.expected);
 assert.deepEqual(selected(item.hir,item.context),item.hir);
 assert.deepEqual(analyzeModuleCalls(JSON.parse(JSON.stringify(item.hir)),JSON.parse(JSON.stringify(item.context))),item.expected);
});
for(const item of oracle.fixed)test('fixed complete module analysis: '+item.name,()=>{
 assert.deepEqual(analyzeModuleCalls(item.hir,item.context),item.expected);
 assert.deepEqual(selected(item.hir,item.context),item.hir);
});

test('a narrowed implementation preserves the exact fixed table and all contract hashes',()=>{
 const old=initial('globalPropagation'),narrow=fixed('narrowedBodyRetainsFixedContract');
 assert.deepEqual(narrow.context.contracts,old.expected.contracts);
 assert.equal(narrow.expected.publishedDigest,old.expected.publishedDigest);
 const report=analyzeModuleCalls(narrow.hir,narrow.context);
 assert.deepEqual(report,narrow.expected);assert.deepEqual(report.contracts,old.expected.contracts);
 assert.notDeepEqual(report.functions,old.expected.functions);
});

test('unknown Host remains Top and cannot be reclassified as pure by a fixed table',()=>{
 const item=initial('unknownHost'),context=fixedFrom(item);
 const leaf=item.hir.functions.find(fn=>fn.name==='leaf');
 context.contracts.find(record=>record.functionId===leaf.id).upper=clone(pure);seal(context);
 rejects(()=>analyzeModuleCalls(item.hir,context),'bound',{sourceId:leaf.sourcePath,...leaf.body[0].value.range});
 rejects(()=>selected(item.hir,context),'bound',{sourceId:leaf.sourcePath,...leaf.body[0].value.range});
});

test('kernel reachability consumes the wider Published bound even when current bodies are pure',()=>{
 for(const item of [oracle.kernelWide,oracle.kernelOwnWide])for(const action of [
  ()=>analyzeModuleCalls(item.hir,item.context),()=>selected(item.hir,item.context)])
  assert.throws(action,error=>{
   assert.ok(error instanceof TypeError);assert.equal(Reflect.get(error,'code'),'r03-d-kernel-call-effects');
   assert.equal(error.message,'r03-d-kernel-call-effects: kernel call requires a known published effect upper bound');
   assert.equal(Reflect.get(error,'ruleId'),'r01-kernel');assert.equal(Reflect.get(error,'phase'),'hir');
   assert.deepEqual(Reflect.get(error,'primary'),item.expectedPrimary);return true;
  });
});

test('selected analysis retains the original real Host kernel diagnostic and call chain',()=>{
 const item=clone(initial('unknownHost'));item.hir.closure.roots[0].kind='kernel';
 const leaf=item.hir.functions.find(fn=>fn.name==='leaf');
 for(const action of [()=>verifyHir(item.hir),()=>selected(item.hir,item.context),()=>analyzeModuleCalls(item.hir,item.context)])
  assert.throws(action,error=>{
   assert.ok(error instanceof TypeError);assert.equal(Reflect.get(error,'code'),'r03-d-kernel-host-semantics');
   assert.equal(Reflect.get(error,'ruleId'),'r01-kernel');assert.equal(Reflect.get(error,'phase'),'hir');
   assert.deepEqual(Reflect.get(error,'primary'),{sourceId:leaf.sourcePath,...leaf.body[0].value.range});
   assert.match(error.message,/app\.ts.*entry.*helper\.ts.*leaf.*host/s);return true;
  });
});

test('publication context shape is exact and no implicit initial or Host trust mode is accepted',()=>{
 for(const context of [undefined,null,[],{}, {mode:'initial',extra:false},{mode:'fixed'},
  {mode:'initial',contracts:[]},{mode:'initial',hostTrust:true},{mode:'initial',version:1}])
  rejects(()=>analyzeModuleCalls(first.hir,context),'context');
});

test('table ordering, duplicate rows and normalized effect sets are enforced before use',()=>{
 const item=initial('globalPropagation');
 for(const mutate of [
  context=>context.contracts.reverse(),
  context=>context.contracts.splice(1,0,clone(context.contracts[0])),
  context=>{context.contracts[0].upper.reads=[item.hir.globals[0].id,item.hir.globals[0].id];},
  context=>{context.contracts[0].upper.reads=item.hir.globals.map(g=>g.id).sort().reverse();},
  context=>{context.contracts[0].upper={reads:[item.hir.globals[0].id],writes:[],unknownHost:true};},
  context=>{context.contracts[0].upper.extra=false;},
 ]) {const context=fixedFrom(item);mutate(context);seal(context);rejects(()=>analyzeModuleCalls(item.hir,context),'context');}
});

test('fixed publication never fills missing rows and checks complete function and resource identities',()=>{
 const item=initial('globalPropagation');
 for(const mutate of [
  context=>{context.contracts.pop();},
  context=>{context.contracts[0].functionId='sha256:'+'0'.repeat(64);context.contracts.sort((a,b)=>a.functionId.localeCompare(b.functionId));},
  context=>{context.contracts[0].signatureHash='sha256:'+'0'.repeat(64);},
  context=>{context.contracts[0].upper.reads=['sha256:'+'0'.repeat(64)];},
  context=>{context.contracts.push({functionId:item.hir.hostImports[0].id,signatureHash:item.hir.hostImports[0].signatureHash,upper:clone(top)});context.contracts.sort((a,b)=>a.functionId.localeCompare(b.functionId));},
 ]) {const context=fixedFrom(item);mutate(context);seal(context);rejects(()=>analyzeModuleCalls(item.hir,context),'identity');}
});

test('the caller supplies exact record and whole-table digests independently',()=>{
 const item=initial('globalPropagation');
 const wrongExpected=fixedFrom(item);wrongExpected.expectedDigest='sha256:'+'0'.repeat(64);
 rejects(()=>analyzeModuleCalls(item.hir,wrongExpected),'identity');
 const wrongRecord=fixedFrom(item);wrongRecord.contracts[0].digest='sha256:'+'0'.repeat(64);
 wrongRecord.expectedDigest=digest('tsfg.module-call-publication.v1',wrongRecord.contracts);
 rejects(()=>analyzeModuleCalls(item.hir,wrongRecord),'identity');
 const stale=clone(fixed('widePublishedFiniteBody').context);stale.expectedDigest=item.expected.publishedDigest;
 rejects(()=>analyzeModuleCalls(item.hir,stale),'identity');
});

test('unsafe context graphs reject without invoking accessors or Proxy traps',()=>{
 let traps=0;const accessor={};Object.defineProperty(accessor,'mode',{enumerable:true,get(){traps++;return 'initial';}});
 const proxy=new Proxy({mode:'initial'},{get(){traps++;throw new Error('get invoked');},ownKeys(){traps++;throw new Error('keys invoked');}});
 const nested=fixedFrom(initial('pure'));nested.contracts[0].upper=new Proxy(clone(pure),{ownKeys(){traps++;throw new Error('nested keys invoked');}});
 const cycle={mode:'initial'};Reflect.set(cycle,'self',cycle);
 const hole={mode:'fixed',expectedDigest:first.context.expectedDigest,contracts:new Array(2)};
 for(const context of [accessor,proxy,nested,cycle,hole])rejects(()=>analyzeModuleCalls(first.hir,context),'context');
 assert.equal(traps,0);
});

test('unsafe selected HIR graphs reject before reading caller behavior',()=>{
 let traps=0;const proxy=new Proxy(clone(first.hir),{get(){traps++;throw new Error('get invoked');},ownKeys(){traps++;throw new Error('keys invoked');}});
 const accessor=clone(first.hir);Object.defineProperty(accessor,'functions',{enumerable:true,get(){traps++;throw new Error('getter invoked');}});
 // The accepted module-callable selector rejects an outer Proxy before the
 // legacy call-effects walker. A functions getter still reaches that walker.
 // Exact BASE reproduces this distinction; both boundaries invoke zero traps.
 for(const action of [()=>analyzeModuleCalls(proxy,{mode:'initial'}),()=>selected(proxy,{mode:'initial'})])
  assert.throws(action,error=>{
   assert.ok(error instanceof TypeError);
   assert.equal(Reflect.get(error,'code'),'r03-module-callable-input');
   assert.equal(error.message,'r03-module-callable-input: invalid module callable candidate');
   assert.equal(Reflect.get(error,'ruleId'),'r01-input-boundary');
   assert.equal(Reflect.get(error,'phase'),'hir');return true;
  });
 for(const action of [()=>analyzeModuleCalls(accessor,{mode:'initial'}),()=>selected(accessor,{mode:'initial'})])rejects(action,'context');
 assert.equal(traps,0);
});

test('bounded JSON limits reject strings, nesting and escaped bytes before hashing invalid context',()=>{
 const string={mode:'initial',extra:'x'.repeat(1048577)};
 const depth={mode:'initial'};let current=depth;for(let i=0;i<130;i++){Reflect.set(current,'child',{});current=Reflect.get(current,'child');}
 const bytes={mode:'initial',extra:Array.from({length:8},()=>String.fromCharCode(34).repeat(600000))};
 for(const context of [string,depth,bytes])rejects(()=>analyzeModuleCalls(first.hir,context),'limit');
});

test('complete HIR identity checks still precede reachability and effect publication',()=>{
 const unreachable=clone(fixed('unreachableWidePublicationOutsideKernel'));
 unreachable.hir.functions.find(fn=>fn.name==='leaf').signatureHash='sha256:'+'0'.repeat(64);
 const call=clone(first.hir);call.functions[0].body[0].value.signatureHash='sha256:'+'0'.repeat(64);
 for(const hir of [unreachable.hir,call])assert.throws(()=>analyzeModuleCalls(hir,{mode:'initial'}),/r03-hir-invalid/);
});

test('reports are owned immutable values and cold recomputation requires its supplied table again',()=>{
 const item=clone(initial('globalPropagation')),context=fixedFrom(item),report=analyzeModuleCalls(item.hir,context);
 assert.deepEqual(report,item.expected);assert.notStrictEqual(report.contracts,context.contracts);
 assert.ok(Object.isFrozen(report));assert.ok(Object.isFrozen(report.contracts));
 assert.ok(Object.isFrozen(report.functions[0].derived.reads));assert.ok(Object.isFrozen(report.initializationOrder));
 context.contracts[0].upper.reads=[];item.hir.source.content='changed';
 assert.deepEqual(report,initial('globalPropagation').expected);
 rejects(()=>analyzeModuleCalls(initial('globalPropagation').hir,context),'identity');
});

const extra=JSON.parse(await readFile(new URL('./call-effects-extra.json',import.meta.url),'utf8'));
for(const item of extra.initial)test('complete direct-call analysis: '+item.name,()=>{
 assert.deepEqual(verifyHir(item.hir),item.hir);
 assert.deepEqual(analyzeModuleCalls(item.hir,item.context),item.expected);
});
for(const item of extra.fixed)test('complete initializer analysis: '+item.name,()=>{
 assert.deepEqual(verifyHir(item.hir),item.hir);
 assert.deepEqual(analyzeModuleCalls(item.hir,item.context),item.expected);
 assert.deepEqual(selected(item.hir,item.context),item.hir);
});

test('widened direct GlobalId effects reject at the original offending access',()=>{
 const item=initial(extra.widened.sourceFixture),leaf=item.hir.functions.find(fn=>fn.name==='leaf');
 const context=fixedFrom(item);for(const record of context.contracts)record.upper=clone(record.functionId===leaf.id?pure:top);
 seal(context);rejects(()=>analyzeModuleCalls(item.hir,context),'bound',extra.widened.expectedPrimary);
 const readOnly=clone(context);readOnly.contracts.find(record=>record.functionId===leaf.id).upper.writes=[item.hir.globals.find(g=>g.name==='beta').id];
 seal(readOnly);rejects(()=>analyzeModuleCalls(item.hir,readOnly),'bound',extra.widened.readOnlyPrimary);
});
