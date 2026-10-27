// SPDX-License-Identifier: MIT
// Explicit retained ordinary Core binary; never build or discover an SDK here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';
const tool=process.env.TSFG_COMMON_CORE_EXE,output=process.env.TSFG_COMMON_CPP_OUTPUT,enabled=Boolean(tool&&output),rows=[];
const read=name=>readFileSync(new URL('./testdata/'+name,import.meta.url));
const hostContext=JSON.parse(read('common-counter-host/host-context.json').toString('utf8'));
function complete(bytes,context=null,kernelNames=[]){
  const facts=readCommonProgramFacts(bytes),hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId},context),
    publication=createCommonProgramPublication(hir),request={targets:kernelNames===null?hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort():hir.functions.filter(fn=>kernelNames.includes(fn.name)).map(fn=>fn.id).sort()};return {...commonProgramCore(hir,publication,request),publication,request};
}
const host=enabled?complete(read('common-counter-host/counter.json'),hostContext):null;
function invoke(label,input,mode='canonicalize',status=0){
  mkdirSync(output,{recursive:true});const result=spawnSync(tool,['--common-program','--'+mode],{input:Buffer.from(input),windowsHide:true,timeout:60000,maxBuffer:8388608});
  const stdout=result.stdout??Buffer.alloc(0),stderr=result.stderr??Buffer.alloc(0);
  writeFileSync(output+'/'+label+'.stdout.bin',stdout);writeFileSync(output+'/'+label+'.stderr.bin',stderr);
  rows.push({label,mode,pid:result.pid,status:result.status,signal:result.signal,error:result.error?.message??null,inputBytes:Buffer.byteLength(input),inputSHA256:sha256(input),stdoutBytes:stdout.length,stdoutSHA256:sha256(stdout),stderrBytes:stderr.length});
  writeFileSync(output+'/children.json',JSON.stringify(rows,null,2)+'\n');assert.ifError(result.error);assert.equal(result.status,status,stderr.toString());return {stdout,stderr};
}
function attribute(text,key,before,after){
  const from=key+' = '+coreQuote(typeof before==='string'?before:canonical(before));assert.ok(text.includes(from));
  return text.replace(from,key+' = '+coreQuote(typeof after==='string'?after:canonical(after)));
}
function changedContext(mutate){
  const hir=structuredClone(host.hir);mutate(hir.hostContext);
  return attribute(attribute(host.text,'hir',host.hir,hir),'hir_hash',sha256(canonical(host.hir)+'\n'),sha256(canonical(hir)+'\n'));
}
test('real Counter ordinary Core passes both production static entry modes',{skip:!enabled},()=>{
  const canonical=invoke('counter-canonical',host.text),optimized=invoke('counter-optimize',host.text,'optimize');assert.deepEqual(canonical.stdout,optimized.stdout);
  assert.equal((canonical.stdout.toString().match(/"tsfg_program.host_call"/g)??[]).length,3);
});
for(const name of ['callable-readonly','callable-reassignment','callable-ancestor-forward','callable-shadow-local'])test('regenerated complete Host-free Core: '+name,{skip:!enabled},()=>{
  const program=complete(read('common-callable-parameters/'+name+'.json'),null,null),
    canonical=invoke(name+'-canonical',program.text),optimized=invoke(name+'-optimize',program.text,'optimize');assert.deepEqual(canonical.stdout,optimized.stdout);
});
test('C++ independently rejects a corrupt Host ABI and arbitrary safety claim',{skip:!enabled},()=>{
  for(const [label,input]of [['host-abi',changedContext(ctx=>{ctx.contract.abi.guest.returns='u32';})],['host-safe',changedContext(ctx=>{ctx.contract.safe=true;})]]){
    const result=invoke(label,input,'canonicalize',3);assert.equal(result.stdout.length,0);assert.match(result.stderr.toString(),/core-ir-common-host/);
  }
});
test('C++ refuses a self-consistent unreviewed implementation and static issuer role',{skip:!enabled},()=>{
  for(const [label,input]of [['host-implementation',changedContext(ctx=>{ctx.identity.buildInputSet.entries.find(row=>row.repositoryRelativePath==='runtime/host_counter.c').sha256='sha256:'+'0'.repeat(64);rebind(ctx);})],
    ['host-role',changedContext(ctx=>{ctx.identity.buildIdentity.options.sourceTarget='static';rebind(ctx);})]]){
    const result=invoke(label,input,'canonicalize',3);assert.equal(result.stdout.length,0);assert.match(result.stderr.toString(),/core-ir-common-host/);
  }
});
function rebind(ctx){
  const inputs=ctx.identity.buildInputSet,bi=ctx.identity.buildIdentity;
  inputs.digest=sha256(canonical({entries:inputs.entries,schemaVersion:inputs.schemaVersion}));bi.buildInputSetDigest=inputs.digest;
  const {digest,...body}=bi;bi.digest=sha256(canonical(body));ctx.contract.buildIdentityDigest=bi.digest;
  const {digest:contractDigest,...contractBody}=ctx.contract;ctx.contract.digest=sha256('tsfg.host-semantic-contract.v1\0'+canonical(contractBody));
}
test('C++ cannot confuse the Source structural signature with capability ABI identity',{skip:!enabled},()=>{
  const row=host.hir.hostImports[0],before={host_id:row.id,signature_hash:row.signatureHash,contract_hash:hostContext.contract.digest},
    after={...before,signature_hash:hostContext.contract.binding.signatureHash},input=attribute(host.text,'properties',before,after),result=invoke('signature-domain',input,'canonicalize',3);
  assert.equal(result.stdout.length,0);assert.match(result.stderr.toString(),/Host operation binding|complete original Source|Source.*instruction/);
});
test('C++ empty proof cannot contain permissions and one requested kernel remains invalid',{skip:!enabled},()=>{
  const proof=structuredClone(host.proof);proof.accesses.push({functionId:host.hir.functions.find(fn=>fn.name==='right').id});
  const empty=invoke('empty-proof',attribute(host.text,'proof',host.proof,proof),'canonicalize',3);assert.equal(empty.stdout.length,0);assert.match(empty.stderr.toString(),/kernel proof differs/);
  const one=invoke('single-kernel',attribute(host.text,'request',host.request,{targets:[host.hir.functions.find(fn=>fn.name==='right').id]}),'canonicalize',3);
  assert.equal(one.stdout.length,0);assert.match(one.stderr.toString(),/explicit kernel group/);
});
test('C++ independently refuses the real requested Counter kernel at its original call',{skip:!enabled},()=>{
  const targets=host.hir.functions.filter(fn=>['direct','right'].includes(fn.name)).map(fn=>fn.id).sort(),input=attribute(host.text,'request',host.request,{targets}),
    result=invoke('counter-kernel',input,'canonicalize',3);assert.equal(result.stdout.length,0);assert.match(result.stderr.toString(),/core-ir-common-kernel-host.*main\.ts:190:203/);
});

test('true extended Source pure kernel pair passes both C++ modes',{skip:!enabled},()=>{
  const program=complete(read('common-counter-host/counter-extended.json'),hostContext,['left','right']),
    canonical=invoke('extended-pure-canonical',program.text),optimized=invoke('extended-pure-optimize',program.text,'optimize');assert.deepEqual(canonical.stdout,optimized.stdout);
});
for(const name of ['cross','finiteIndirect'])test('true extended Source '+name+' kernel is independently rejected by C++',{skip:!enabled},()=>{
  const program=complete(read('common-counter-host/counter-extended.json'),hostContext),targets=program.hir.functions.filter(fn=>[name,'right'].includes(fn.name)).map(fn=>fn.id).sort(),
    result=invoke('extended-'+name,attribute(program.text,'request',program.request,{targets}),'canonicalize',3);
  assert.equal(result.stdout.length,0);assert.match(result.stderr.toString(),/core-ir-common-kernel-host/);
});
test('C++ broad fixed right upper alone blocks the otherwise valid pure pair',{skip:!enabled},()=>{
  const program=complete(read('common-counter-host/counter-extended.json'),hostContext),broad=structuredClone(program.publication),right=program.hir.functions.find(fn=>fn.name==='right'),
    row=broad.contracts.find(row=>row.functionId===right.id);row.upper.hostResources={reads:['runtime.counter.events','runtime.counter.storage'],writes:['runtime.counter.events','runtime.counter.storage']};
  const {digest,...body}=row;row.digest=commonIdentity('published-contract',body);broad.expectedDigest=commonIdentity('publication',{scopeDigest:broad.scopeDigest,contracts:broad.contracts});
  const ordinary=commonProgramCore(program.hir,broad,{targets:[]}),targets=program.hir.functions.filter(fn=>['left','right'].includes(fn.name)).map(fn=>fn.id).sort(),
    result=invoke('extended-broad-right',attribute(ordinary.text,'request',{targets:[]},{targets}),'canonicalize',3);
  assert.equal(result.stdout.length,0);assert.match(result.stderr.toString(),/core-ir-common-kernel-host/);
});
