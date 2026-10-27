// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {createCommonBorrowProof,readCommonBorrowProof,writeCommonBorrowProof} from '../../compiler/common-program-borrow-proof.mjs';
import {canonical} from '../../compiler/identity.mjs';
const cases=['safe-lastuse','later-use-conflict','borrow-completions'].map(name=>{
  const facts=readCommonProgramFacts(readFileSync(new URL('./testdata/common-borrow-proof/'+name+'-facts.json',import.meta.url))),hir=projectCommonProgram(facts),publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  return {name,hir,publication,request};
});
const safe=cases[0],completed=cases[2],tool=process.env.TSFG_COMMON_BORROW_CORE,output=process.env.TSFG_COMMON_BORROW_OUTPUT,children=[];
const proofOf=row=>createCommonBorrowProof(row.hir,row.publication,row.request);
const reachable=(proof,from,to)=>{
  const pending=[canonical(from)],seen=new Set(),target=canonical(to);
  for(let i=0;i<pending.length;i++){const next=pending[i];if(next===target)return true;if(seen.has(next))continue;seen.add(next);
    for(const edge of proof.events.flows)if(canonical(edge.from)===next)pending.push(canonical(edge.to));}
  return false;
};
test('real last captured Span use propagates through its call before resize',()=>{
  const proof=proofOf(safe),reader=safe.hir.functions.find(fn=>fn.name==='readCurrent'),capture=safe.hir.functions.find(fn=>fn.name==='captureSpanOrdinary');assert.ok(reader&&capture);
  const use=proof.events.uses.find(row=>row.at.functionId===reader.id),resize=proof.events.effects.find(row=>row.at.functionId===capture.id&&row.at.name==='array_resize');assert.ok(use&&resize);
  const definition=proof.events.definitions.find(row=>row.at.functionId===capture.id);assert.ok(definition);
  assert.deepEqual(use.descriptors,[definition.descriptor]);assert.deepEqual(resize.owners,definition.owners);
  assert.ok(proof.events.calls.some(row=>row.target===reader.id&&row.completion==='normal'));
  assert.ok(reachable(proof,use.at,resize.at));assert.ok(!reachable(proof,resize.at,use.at));
  assert.ok(Object.isFrozen(proof.events.flows));assert.ok(Object.isFrozen(definition.descriptor.origins));
});
test('whole Source preserves actual Span normal and language return propagation',()=>{
  const proof=proofOf(completed),relay=completed.hir.functions.find(fn=>fn.name==='relayBorrowCompletion'),caller=completed.hir.functions.find(fn=>fn.name==='borrowCompletions');assert.ok(relay&&caller);
  const routes=proof.events.calls.filter(row=>row.at.functionId===caller.id&&row.target===relay.id);assert.deepEqual([...new Set(routes.map(row=>row.completion))].sort(),['language','normal']);
  const descriptor=proof.events.definitions.find(row=>row.at.functionId===caller.id);assert.ok(descriptor);
  for(const route of routes){assert.ok(proof.events.uses.some(row=>row.at.functionId===caller.id&&row.descriptors.some(value=>canonical(value)===canonical(descriptor.descriptor))&&reachable(proof,route.successor,row.at)));}
  assert.ok(completed.hir.functions.some(fn=>fn.name==='arrayOrdinary'));assert.ok(completed.hir.types.some(type=>type.name==='Box'));
});
test('later callee use retains the existing structural conflict and cannot publish proof',()=>{
  const row=cases[1];assert.throws(()=>proofOf(row),{code:'r03-common-program-borrow-conflict'});
});
test('owning proof read/write binds the full fixed input and rejects changed relationships',()=>{
  const proof=proofOf(safe),bytes=writeCommonBorrowProof(proof,safe.hir,safe.publication,safe.request);
  assert.equal(bytes.toString('utf8'),canonical(proof)+'\n');assert.deepEqual(readCommonBorrowProof(bytes,safe.hir,safe.publication,safe.request),proof);
  const mutations=[value=>{value.inputIdentity='sha256:'+'0'.repeat(64);},value=>{value.version=2;},value=>{value.events.uses.pop();},value=>{value.events.flows.pop();},
    value=>{value.events.definitions[0].owners=[];},value=>{value.events.calls[0].completion='language';},value=>{value.events.effects[0].pending=!value.events.effects[0].pending;},value=>{value.extra=true;}];
  for(const mutate of mutations){const value=structuredClone(proof);mutate(value);assert.throws(()=>readCommonBorrowProof(Buffer.from(canonical(value)+'\n'),safe.hir,safe.publication,safe.request));}
  assert.throws(()=>readCommonBorrowProof(Buffer.from(canonical(proof)),safe.hir,safe.publication,safe.request));
  assert.throws(()=>readCommonBorrowProof(Buffer.alloc(8388609,32),safe.hir,safe.publication,safe.request));
  if(false){
    // @ts-expect-error Public proof collections are readonly typed output.
    proof.events.uses.push(proof.events.uses[0]);
    // @ts-expect-error Source/operation identities are readonly.
    proof.events.definitions[0].at.source.start=0;
  }
});
const run=(name,command,input,status=0)=>{
  mkdirSync(output,{recursive:true});const prefix=output+'/'+String(children.length).padStart(3,'0')+'-'+name;
  const child=spawnSync(tool,['--common-program',command],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
  writeFileSync(prefix+'-input.mlir',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name,command,pid:child.pid,status:child.status,error:child.error?.message??null,stdoutBytes:child.stdout?.length,stderr:child.stderr?.toString('utf8')});writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.ifError(child.error);assert.equal(child.status,status,child.stderr.toString('utf8'));return child.stdout;
};
for(const row of [safe,completed])test('independent actual Common Core borrow proof: '+row.name,{skip:!tool||!output},()=>{
  const emitted=commonProgramCore(row.hir,row.publication,row.request,{borrowProof:true});assert.equal(emitted.text,commonProgramCore(row.hir,row.publication,row.request).text);
  const bound=run(row.name+'-canonical','--canonicalize',emitted.text),raw=run(row.name,'--borrow-proof',bound);
  assert.deepEqual(readCommonBorrowProof(raw,row.hir,row.publication,row.request),emitted.borrowProof);assert.equal(raw.toString('utf8'),canonical(emitted.borrowProof)+'\n');
  assert.deepEqual(run(row.name+'-roundtrip','--canonicalize',bound),bound);assert.deepEqual(run(row.name+'-stable','--borrow-proof',bound),raw);
  const forged=emitted.text.replace('hir_hash = "sha256:','hir_hash = "sha256:0');assert.notEqual(forged,emitted.text);assert.equal(run(row.name+'-wrong-input','--borrow-proof',forged,3).length,0);
});
