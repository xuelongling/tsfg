// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import test from 'node:test';
import * as hir from '../../compiler/hir.mjs';

const first=JSON.parse(await readFile(new URL('./kernel-parallel-first.json',import.meta.url),'utf8'));
const oracle=JSON.parse(await readFile(new URL('./kernel-parallel-oracle.json',import.meta.url),'utf8'));
const clone=value=>structuredClone(value);
const verify=(input,context,request)=>{
 const consumer=Reflect.get(hir,'verifyKernelParallelGroup');assert.equal(typeof consumer,'function');
 return consumer(input,context,request);
};
const item=name=>oracle.cases.find(c=>c.name===name);
const baseError=(code,message,ruleId='r01-kernel')=>({code,message:code+': '+message,ruleId,phase:'hir'});
const errors={
 shape:baseError('r03-d-kernel-access','invalid explicit kernel parallel group'),
 identity:baseError('r03-d-kernel-access-identity','kernel parallel group identity differs'),
 limit:baseError('r03-d-kernel-access-limit','kernel parallel group budget exceeded'),
 callShape:baseError('r03-d-call-effects','invalid module call publication context','r01-call-contract'),
 callIdentity:baseError('r03-d-call-contract-identity','published call contract identity differs','r01-call-contract'),
 callLimit:baseError('r03-d-call-effects-limit','module call effects budget exceeded','r01-call-contract'),
};
function errorView(error) {
 const view={code:Reflect.get(error,'code'),message:error.message,ruleId:Reflect.get(error,'ruleId'),phase:Reflect.get(error,'phase')};
 for(const field of ['primary','related','conflicts'])if(Object.hasOwn(error,field))view[field]=Reflect.get(error,field);
 return view;
}
function rejects(action,expected) {
 assert.throws(action,error=>{assert.ok(error instanceof TypeError);assert.deepEqual(errorView(error),expected);return true;});
}

// Hash-only mutation sealing follows the already adopted 23a contract. It is
// never used to derive semantic expected sets, proofs or diagnostics.
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'
 ? '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const hash=(domain,value)=>'sha256:'+createHash('sha256').update(domain+'\0'+canonical(value)).digest('hex');
const topRecordDigest=record=>hash('tsfg.published-call-contract.v1',{functionId:record.functionId,signatureHash:record.signatureHash,upper:record.upper});
const tableDigest=contracts=>hash('tsfg.module-call-publication.v1',contracts);

for(const vector of oracle.cases)test('explicit Published kernel access: '+vector.name,()=>{
 // This control verifies the complete HIR and fixed table before the new seam.
 assert.deepEqual(hir.analyzeModuleCalls(vector.hir,vector.context),vector.expectedAnalysis);
 if(vector.expectedError)rejects(()=>verify(vector.hir,vector.context,vector.request),vector.expectedError);
 else assert.deepEqual(verify(vector.hir,vector.context,vector.request),vector.expectedProof);
});

test('narrow pure bodies cannot erase effects from either root Published upper',()=>{
 for(const name of ['write-write','write-read','read-write','both-cross-directions','all-conflict-members-sorted']) {
  const vector=item(name);assert.ok(vector.expectedAnalysis.functions.every(fn=>fn.derived.reads.length===0&&fn.derived.writes.length===0));
  assert.ok(vector.hir.functions.filter(fn=>fn.kind==='source').every(fn=>fn.body[0].value.decimal==='0'));
  assert.deepEqual(hir.analyzeModuleCalls(vector.hir,vector.context),vector.expectedAnalysis);
  rejects(()=>verify(vector.hir,vector.context,vector.request),vector.expectedError);
 }
});

test('request is exact own JSON with two or more sorted unique hash targets',()=>{
 const targets=first.request.targets;
 for(const request of [undefined,null,[],{}, {targets:[]},{targets:[targets[0]]},{targets:[...targets],extra:false},
  {targets:[targets[1],targets[0]]},{targets:[targets[0],targets[0]]},{targets:['not-a-hash',targets[1]]},
  {targets:['SHA256:'+'0'.repeat(64),targets[1]]}, {targets:new Set(targets)}])
  rejects(()=>verify(first.hir,first.context,request),errors.shape);
});

test('only current closure kernel roots can be requested',()=>{
 const zero='sha256:'+'0'.repeat(64),initializer=first.hir.functions.find(fn=>fn.kind==='module-initialization').id;
 for(const foreign of [zero,initializer,first.hir.globals[0].id])
  rejects(()=>verify(first.hir,first.context,{targets:[foreign,first.request.targets[1]].sort()}),errors.identity);
 const direct=item('real-direct-propagation-disjoint'),reader=direct.hir.functions.find(fn=>fn.name==='reader').id;
 rejects(()=>verify(direct.hir,direct.context,{targets:[reader,first.request.targets[1]].sort()}),errors.identity);
 const changed=clone(first.hir);changed.closure.roots[0].kind='application';
 changed.closure.roots.sort((a,b)=>(a.kind+'\0'+a.sourcePath+'\0'+a.name).localeCompare(b.kind+'\0'+b.sourcePath+'\0'+b.name));
 rejects(()=>verify(changed,first.context,first.request),errors.identity);
});

test('initial publication mode is not a fixed parallel-group input and invalid fixed tables retain old errors',()=>{
 rejects(()=>verify(first.hir,{mode:'initial'},first.request),errors.shape);
 const badDigest=clone(first.context);badDigest.expectedDigest='sha256:'+'0'.repeat(64);
 rejects(()=>verify(first.hir,badDigest,first.request),errors.callIdentity);
 rejects(()=>verify(first.hir,{mode:'fixed'},first.request),errors.callShape);
});

test('all three complete JSON graphs are checked before mode, request selection or pair dispatch',()=>{
 let traps=0;
 const badHir=new Proxy(clone(first.hir),{get(){traps++;throw Error('HIR get invoked');},ownKeys(){traps++;throw Error('HIR keys invoked');}});
 const badContext={};Object.defineProperty(badContext,'mode',{enumerable:true,get(){traps++;throw Error('context getter invoked');}});
 const badRequest=new Proxy(clone(first.request),{get(){traps++;throw Error('request get invoked');},ownKeys(){traps++;throw Error('request keys invoked');}});
 rejects(()=>verify(badHir,{mode:'initial'},undefined),errors.callShape);
 rejects(()=>verify(first.hir,badContext,undefined),errors.callShape);
 rejects(()=>verify(first.hir,{mode:'initial'},badRequest),errors.shape);
 assert.equal(traps,0);
 const overContext={mode:'initial',extra:'x'.repeat(1048577)};
 rejects(()=>verify(first.hir,overContext,undefined),errors.callLimit);
});

test('unsafe request accessors, nested Proxy, holes and cycles reject without behavior',()=>{
 let traps=0;const accessor={};Object.defineProperty(accessor,'targets',{enumerable:true,get(){traps++;throw Error('targets getter invoked');}});
 const nested={targets:new Proxy([...first.request.targets],{get(){traps++;throw Error('array getter invoked');},ownKeys(){traps++;throw Error('array keys invoked');}})};
 const cycle={targets:[...first.request.targets]};Reflect.set(cycle,'self',cycle);
 for(const request of [accessor,nested,cycle,{targets:new Array(2)}])rejects(()=>verify(first.hir,first.context,request),errors.shape);
 assert.equal(traps,0);
});

test('target-count and JSON budgets reject before malformed request dispatch',()=>{
 const maximum=item('exact-32-kernel-roots-496-shared-read-pairs');
 const tooMany={targets:['sha256:'+'0'.repeat(64),...maximum.request.targets].sort()};
 const string={targets:[...first.request.targets],extra:'x'.repeat(1048577)};
 const depth={targets:[...first.request.targets]};let cursor=depth;
 for(let i=0;i<130;i++){Reflect.set(cursor,'child',{});cursor=Reflect.get(cursor,'child');}
 const bytes={targets:[...first.request.targets],extra:Array.from({length:8},()=>String.fromCharCode(34).repeat(600000))};
 for(const request of [tooMany,string,depth,bytes])rejects(()=>verify(first.hir,first.context,request),errors.limit);
});

test('complete owned HIR verification still precedes target subset selection',()=>{
 const maximum=clone(item('exact-32-kernel-roots-496-shared-read-pairs'));
 const requested=maximum.request.targets.slice(0,2);
 maximum.hir.functions.find(fn=>fn.kind==='source'&&!requested.includes(fn.id)).signatureHash='sha256:'+'0'.repeat(64);
 assert.throws(()=>verify(maximum.hir,maximum.context,{targets:requested}),/r03-hir-invalid/);
});

test('unknown Published Top keeps the existing kernel rejection without access-proof reclassification',()=>{
 const context=clone(first.context),record=context.contracts[0];
 record.upper={reads:[],writes:[],unknownHost:true};
 // A valid Top table is an independent literal contract from the accepted 23a
 // domain; no record is re-published from the narrower current body.
 record.digest=topRecordDigest(record);context.expectedDigest=tableDigest(context.contracts);
 const root=first.hir.functions.find(fn=>fn.id===record.functionId);
 rejects(()=>verify(first.hir,context,first.request),{
  ...baseError('r03-d-kernel-call-effects','kernel call requires a known published effect upper bound'),
  primary:{sourceId:root.sourcePath,...root.range},
 });
});

test('proofs are separately owned deeply frozen values and cannot cache away later input changes',()=>{
 const value=clone(first),proof=verify(value.hir,value.context,value.request);
 assert.deepEqual(proof,first.expectedProof);assert.notStrictEqual(proof.targets,value.request.targets);
 assert.notStrictEqual(proof.accesses[0].reads,value.context.contracts[0].upper.reads);
 assert.ok(Object.isFrozen(proof)&&Object.isFrozen(proof.targets)&&Object.isFrozen(proof.accesses));
 assert.ok(Object.isFrozen(proof.accesses[0].reads)&&Object.isFrozen(proof.pairs[0].readRead));
 value.context.contracts[0].upper.reads=[];value.request.targets.reverse();
 assert.deepEqual(proof,first.expectedProof);
 rejects(()=>verify(first.hir,value.context,first.request),errors.callIdentity);
});

test('cold JSON round-trip rechecks the supplied request and fixed table with no hidden state',()=>{
 const value=JSON.parse(JSON.stringify(first));
 assert.deepEqual(verify(value.hir,value.context,value.request),first.expectedProof);
 assert.deepEqual(verify(value.hir,value.context,value.request),first.expectedProof);
 value.request.targets.reverse();rejects(()=>verify(value.hir,value.context,value.request),errors.shape);
});
