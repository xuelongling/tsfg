// SPDX-License-Identifier: MIT
// Real complete Source and actual Runtime metadata prove static meaning only.
// The small effect models below are normalized controls, not Source Programs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts,verifyCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir,verifyCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication,analyzeCommonProgram,verifyCommonKernelGroup,verifyCommonKernelProof} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonEffects} from '../../compiler/common-program-effects.mjs';
import {commonClosureHolding} from '../../compiler/common-program-borrow-observations.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
const bytes=readFileSync(new URL('./testdata/common-counter-host/counter.json',import.meta.url)),facts=readCommonProgramFacts(bytes),
  context=JSON.parse(readFileSync(new URL('./testdata/common-counter-host/host-context.json',import.meta.url),'utf8')),
  inputContext={family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId},
  hir=buildCommonProgramHir(facts,inputContext,context),publication=createCommonProgramPublication(hir),analysis=analyzeCommonProgram(hir,publication),
  request={targets:[]},core=commonProgramCore(hir,publication,request),resources=['runtime.counter.events','runtime.counter.storage'],
  rw={reads:resources,writes:resources},byName=new Map(hir.functions.map(fn=>[fn.name,fn])),
  targets=names=>names.map(name=>byName.get(name).id).sort(),hasCode=code=>error=>error instanceof Error&&'code' in error&&error.code===code;

test('official Counter retains complete Source, ambient Symbol and distinct signature domains',()=>{
  assert.equal(sha256(bytes),'sha256:0649ceed2816bc265e0af923a28a56049b2fcbcb6290cc60d956f0f2d8f2701c');
  assert.equal(hir.sources.length,4);assert.equal(hir.modules.length,2);assert.equal(hir.functions.length,7);
  const source=facts.payload.hostImports[0],host=hir.hostImports[0];assert.equal(host.sourceBinding,source.id);
  assert.deepEqual(host.sourceSignature,source.signature);assert.deepEqual(host.range,source.declarationRange);assert.deepEqual(host.nameRange,source.nameRange);
  assert.equal(hir.functions.some(fn=>fn.sourceBinding===source.id),false);assert.equal(host.capabilityId,31);
  assert.notEqual(host.signatureHash,source.signature.id);assert.notEqual(host.signatureHash,context.contract.binding.signatureHash);
  assert.equal(hir.hostContext.contract.digest,'sha256:bfefc59d18d2330c08038dcaa375d6bdb4fe2d03ea9c99898e3f3b141766320a');
  assert.deepEqual(verifyCommonProgramHir(hir),hir);
});
test('ordinary full Core requests no kernel permission while preserving actual Host operations',()=>{
  assert.deepEqual(core.proof.targets,[]);assert.deepEqual(core.proof.accesses,[]);assert.deepEqual(core.proof.pairs,[]);
  assert.equal((core.text.match(/"tsfg_program.host_call"/g)??[]).length,3);
  for(const name of ['direct','relay','entry'])assert.deepEqual(analysis.functions.find(fn=>fn.functionId===byName.get(name).id).effective.hostResources,rw);
  assert.deepEqual(analysis.initializers.find(fn=>fn.functionId===hir.modules.find(m=>m.sourcePath==='/src/main.ts').initializer).effective.hostResources,rw);
});
test('real Counter kernel request rejects at the original callee occurrence',()=>{
  assert.throws(()=>verifyCommonKernelGroup(hir,publication,{targets:targets(['direct','right'])}),{code:'r03-common-program-kernel-host',primary:{sourceId:'/src/main.ts',start:190,end:203}});
});
test('one target remains invalid and empty proof cannot smuggle nonempty permission',()=>{
  assert.throws(()=>verifyCommonKernelGroup(hir,publication,{targets:targets(['right'])}),hasCode('r03-common-program-kernel'));
  const proof=structuredClone(core.proof);proof.accesses.push({functionId:byName.get('right').id});
  assert.throws(()=>verifyCommonKernelProof(proof,hir,publication,request),hasCode('r03-common-program-kernel-proof'));
});

for(const [name,mutate]of Object.entries({
  capability:facts=>{facts.payload.hostImports[0].capabilityId=32;},
  signature:facts=>{facts.payload.hostImports[0].signature.returnType='u32';},
  'declaration anchor':facts=>{facts.payload.hostImports[0].declarationRange.end--;},
  'owned callee':facts=>{facts.payload.functions.find(fn=>fn.name==='direct').body[0].value.callee=facts.payload.functions.find(fn=>fn.name==='right').id;}
}))test('copied Source DTO rejects wrong Host '+name,()=>{
  const changed=structuredClone(facts);mutate(changed);assert.throws(()=>verifyCommonProgramFacts(changed));
});
test('missing Host context and ordinary static issuer role are refused',()=>{
  assert.throws(()=>buildCommonProgramHir(facts,inputContext));
  const changed=structuredClone(context);changed.identity.buildIdentity.options.sourceTarget='static';
  assert.throws(()=>buildCommonProgramHir(facts,inputContext,changed),/host-semantic-contract/);
});
for(const [name,mutate]of Object.entries({
  'BI digest':ctx=>{ctx.identity.buildIdentity.digest='sha256:'+'0'.repeat(64);},
  'implementation source':ctx=>{ctx.identity.buildInputSet.entries.find(row=>row.repositoryRelativePath==='runtime/host_counter.c').sha256='sha256:'+'0'.repeat(64);},
  ABI:ctx=>{ctx.contract.abi.guest.returns='u32';},
  'safe claim':ctx=>{ctx.contract.safe=true;}
}))test('actual HSC boundary rejects wrong '+name,()=>{
  const changed=structuredClone(context);mutate(changed);assert.throws(()=>buildCommonProgramHir(facts,inputContext,changed),/host-semantic-contract/);
});
test('normalized argument0, recursive and full finite-indirect effects retain both Host resources',()=>{
  const model=structuredClone(hir),scalar=hir.hostImports[0].returnType,range={start:0,end:1},
    zero={kind:'numericLiteral',type:scalar,token:'0',decimal:'0',range},
    host={kind:'hostCall',callee:hir.hostImports[0].id,arguments:[zero],type:scalar,range},
    call=callee=>({kind:'call',callee,arguments:[],type:scalar,range}),
    leaf=(id,body)=>({id,name:id,sourcePath:'/normalized.ts',kind:'source',returnType:scalar,parameters:[],captures:[],body}),
    left=leaf('cycle-left',[{kind:'return',value:call('cycle-right')}]),
    right=leaf('cycle-right',[{kind:'expression',value:host},{kind:'return',value:call('cycle-left')}]),
    indirect=leaf('finite-indirect',[{kind:'return',value:{kind:'indirectCall',expression:{kind:'functionReference',functionId:'cycle-left',type:'normalized-callable',range},arguments:[],type:scalar,range}}]);
  model.types.push({id:'normalized-callable',kind:'function',parameters:[],returnType:scalar});model.functions.push(left,right,indirect);
  const physical={references:new Map(),escaping:new Map(),model:{callables:{site:()=>({top:false,functions:['cycle-left','cycle-right']})}}},
    effects=commonEffects(model,commonMeter(),physical),derived=effects.derived();
  for(const fn of [left,right,indirect])assert.deepEqual(derived.get(fn.id).hostResources,rw);
});
test('Host resources in an unobserved fixed reader upper do not grant readonly holding',()=>{
  const upper={hostResources:rw,globals:{reads:[],writes:[]},facets:{unknownHost:false,escape:false,await:false,lock:false},parameters:[],captures:[]},
    model={spend:commonMeter(),types:new Map(),functions:new Map(),environments:new Map()},
    policy=commonClosureHolding({model,objects:new Map(),records:new Map([['reader',{upper}]]),closedTarget:()=>true});
  assert.equal(policy.permitsCode('reader'),false);
});

const extendedBytes=readFileSync(new URL('./testdata/common-counter-host/counter-extended.json',import.meta.url)),extendedFacts=readCommonProgramFacts(extendedBytes),
  extendedHir=buildCommonProgramHir(extendedFacts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:extendedBytes,expectedPackageId:extendedFacts.packageId},context),
  extendedPublication=createCommonProgramPublication(extendedHir),extendedByName=new Map(extendedHir.functions.map(fn=>[fn.name,fn])),
  extendedTargets=names=>names.map(name=>extendedByName.get(name).id).sort();
test('official extended Source preserves all originals and proves the independent pure kernel pair',()=>{
  assert.equal(sha256(extendedBytes),'sha256:8faa27fb5ccbbcf805530b22ae726c87ba27dd9f969294444a3e49ccf9247be1');
  assert.equal(extendedHir.functions.length,9);assert.equal(extendedHir.sources.length,4);assert.equal(extendedHir.closure.roots.length,8);
  for(const fn of facts.payload.functions){const original=structuredClone(fn),current=structuredClone(extendedFacts.payload.functions.find(row=>row.id===fn.id));
    assert.deepEqual(current.declarationScope,{start:0,end:extendedFacts.payload.files.find(file=>file.path===fn.sourcePath).utf16Length});
    delete original.declarationScope;delete current.declarationScope;assert.deepEqual(current,original);}
  assert.equal(verifyCommonKernelGroup(extendedHir,extendedPublication,{targets:extendedTargets(['left','right'])}).accesses.length,2);
});
for(const name of ['cross','finiteIndirect'])test('official '+name+' kernel consumes the complete Counter upper',()=>{
  assert.throws(()=>verifyCommonKernelGroup(extendedHir,extendedPublication,{targets:extendedTargets([name,'right'])}),error=>hasCode('r03-common-program-kernel-host')(error));
});
test('only a broader fixed upper turns the independent pure right kernel into a rejection',()=>{
  const broad=structuredClone(extendedPublication),right=extendedByName.get('right'),row=broad.contracts.find(row=>row.functionId===right.id);row.upper.hostResources=structuredClone(rw);
  const {digest,...body}=row;row.digest=commonIdentity('published-contract',body);broad.expectedDigest=commonIdentity('publication',{scopeDigest:broad.scopeDigest,contracts:broad.contracts});
  const checked=analyzeCommonProgram(extendedHir,broad);assert.deepEqual(checked.contracts.find(row=>row.functionId===right.id).upper.hostResources,rw);
  assert.deepEqual(checked.functions.find(row=>row.functionId===right.id).derived.hostResources,{reads:[],writes:[]});
  assert.throws(()=>verifyCommonKernelGroup(extendedHir,broad,{targets:extendedTargets(['left','right'])}),{code:'r03-common-program-kernel-host',functionId:right.id,primary:{sourceId:right.sourcePath,...right.range}});
});
