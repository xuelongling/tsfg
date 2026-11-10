// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {createCommonGpuBindingPlan} from '../../compiler/common-program-gpu-bindings.mjs';
import {canonical} from '../../compiler/common-program-common.mjs';
import {verifyGpuI32Report} from './gpu-binding-i32-oracle.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>'sha256:'+sha(canonical(value)+'\n');
async function fixture(folder,operator,pins){
  const raw=await Promise.all(['package.json','official-oracle.json','source.ts'].map(name=>fs.readFile(new URL('./testdata/'+folder+'/'+name,import.meta.url))));
  raw.forEach((bytes,index)=>assert.equal(sha(bytes),pins[index],'frozen genuine Source input'));
  const facts=readCommonProgramFacts(raw[0]),oracle=JSON.parse(raw[1].toString('utf8')),text=raw[2].toString('utf8');
  assert.equal(oracle.sourceSha256,sha(raw[2]));assert.deepEqual(oracle.sourceRange,{start:0,end:text.length});
  const ast=oracle.functions.find(row=>row.name==='constantKernel');assert.ok(ast);
  const arity=ast.literal===null?1:2;
  assert.equal(ast.operator,operator);assert.equal(text.slice(ast.expression.start,ast.expression.end),arity===1?operator+'x':'x '+operator+' 7');
  const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:facts.version,factsBytes:raw[0],expectedPackageId:facts.packageId});
  assert.equal(facts.version,3);assert.deepEqual(hir.snapshot,facts);assert.equal(hir.sources.find(row=>row.path==='/src/main.ts').content,text);
  assert.equal(hir.functions.length,2);assert.equal(hir.globals.length,0);assert.equal(hir.closure.roots.length,3);
  const functions=hir.functions.filter(row=>row.sourceBinding===ast.id);assert.equal(functions.length,1);const fn=functions[0];
  assert.deepEqual(fn.range,ast.range);assert.equal(fn.parameters[0].sourceBinding,ast.parameterId);assert.deepEqual(fn.parameters[0].range,ast.parameterRange);
  const returned=fn.body.find(row=>row.kind==='return');assert.ok(returned);const expression=returned.value;
  assert.equal(expression.kind,arity===1?'unary':'binary');assert.equal(expression.operator,operator);assert.deepEqual(expression.range,ast.expression);
  const operand=arity===1?expression.expression:expression.left;
  assert.equal(operand.binding,fn.parameters[0].id);assert.deepEqual(operand.range,ast.parameterUse);
  if(arity===1){assert.deepEqual(expression.operatorRange,ast.operatorRange);assert.ok(operator==='-'||operator==='~');}
  else{assert.equal(expression.right.kind,'numericLiteral');assert.equal(expression.right.decimal,'7');assert.deepEqual(expression.right.range,ast.literal);}
  const publication=createCommonProgramPublication(hir),group={targets:hir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  assert.equal(group.targets.length,2);assert.notEqual(publication.contracts.find(row=>row.functionId===fn.id).returnOrigins,null);
  const core=commonProgramCore(hir,publication,group,{borrowProof:true});assert.ok(core.borrowProof);
  const request={family:'tsfg.gpu-logical-binding-request',version:2,target:'vulkan',kernels:[fn.id],bindings:[
    {kind:'parameter',id:fn.parameters[0].id,kernel:fn.id,set:0,binding:0,access:'read'},
    {kind:'return',id:fn.id,kernel:fn.id,set:0,binding:1,access:'write'}]};
  const plan=createCommonGpuBindingPlan(hir,publication,group,request);
  return {operator,arity,oracle,core,request,plan};
}
const plus=await fixture('common-program-gpu-constant-v3','+',['756c91508f560677acf295b8cdcc3e0510e3c4d88fe61ee4c550bca3d9ff5b58','0ece76da2679e6377dc440e460741d7d49d601002405d2882ddafd72691266e6','a82c00937bce576e39deef14ff50001bf75c57d2d63bbde3db7f26ba35e8c04f']);
const minus=await fixture('common-program-gpu-subtraction-v3','-',['8ad6c71edab8044391aa4c7927636f11be7e6c94236c71d0c07bef15b09ef0f0','ee6b05c68e54e03fac5d2a8f47b7acf8bf0001738f00b48287b98ca6caaa2c7e','b6fabcd68a6c435682828caf2cd36a754d48062b73b77052e8f513c3473b9c91']);
const multiply=await fixture('common-program-gpu-multiply-v3','*',['b45e9701ccb2929bab7653a6d7c8f0d74381475e1c29d55e486ede37dfe4dcc4','8dc1069ab49de21deccd93c5a192c92494a3abf166750361a69c4be41882fe2e','2f629475d04d07405d3abfdac966d22cb3ab8d59c04c9d9f9d75b6dadfac2b93']);
const negate=await fixture('common-program-gpu-negate-v3','-',['83dfdac458e3807f835b1fe0d0ebe75a5b08619a5a7dca5f5e914b1835457a81','0771b6ef5d29ef3ef617c0ded3594d85d2776e412c5c6fcbcdf8484746fd3f2e','2c3e70644c91ec21ad669308eda17c43d26521eaafbfce6ae21944c887a44437']);
const bitwiseAnd=await fixture('common-program-gpu-and-v3','&',['4db4f711f7c9dcecbdc184221d27bdc7f98950df881c6879e38046bb2c5284bc','f6b7d872c3d136354bcd91db4ec9ef83d00553ff858d177236e19cd0b352c542','e3a537fcaf1bd4b19a75ec5a55b1e2ee244c13d4f61559333052c3fec3cd3c64']);
const bitwiseOr=await fixture('common-program-gpu-or-v3','|',['d2f379bb6aedd180ed5c055fbe7cacd50b3ae8a4d327436d1da6631a589eb48f','be3481efb4309a36e5d9371496b4f2e0f334bb459936f1425e01cb0fcc1234ca','0a6966df96684623d3c58d7a1fc6dd07d3f8d3f0feabde5db743f2dad5d18be6']);
const bitwiseXor=await fixture('common-program-gpu-xor-v3','^',['840c9fde95a11168d60d50dc773002ccc64035cc2dd828ef28414eec3dff6600','e234c1e3a26bf1d5f1802ce839f3b047ee82ef775cc04ae228474a4c5f5b5134','f4df1a1a7d3bfab75bae7643268063d2e84ac729c935fa4740b6ac1f190a83b8']);
const bitwiseNot=await fixture('common-program-gpu-not-v3','~',['11a95f67a95ed04b808046b46f4d50e2017d0c3b2beace20e1b5eb0aa8222a64','e32463dad5313801c2cd631b9f4bb28f0767cad5cc3560cacba8de576fdf45df','ab0db2e5161383c734a1b5496c8bb53688bcf392be0d302552a905467480a3d3']);
const cases=[{name:'plus',value:plus},{name:'minus',value:minus},{name:'multiply',value:multiply},{name:'negate',value:negate},
  {name:'and',value:bitwiseAnd},{name:'or',value:bitwiseOr},{name:'xor',value:bitwiseXor},{name:'not',value:bitwiseNot}];
test('genuine Source3 i32 operations preserve the complete group, binding, operator and fixed return',()=>{
  assert.equal(new Set(cases.map(({value})=>value.plan.inputIdentity)).size,cases.length);
  assert.equal(new Set(cases.map(({value})=>value.core.text)).size,cases.length);
  for(const {value}of cases){
    assert.equal(value.plan.version,2);assert.equal(value.plan.groupTargets.length,2);assert.equal(value.plan.kernels.length,1);
    assert.deepEqual(value.plan.bindings.map(row=>[row.kind,row.access,row.type]),[['parameter','read','i32'],['return','write','i32']]);
  }
});

// The build owner supplies qualified outputs from the permanent C++ consumer.
// This oracle reads captured compiler data; it never executes Source or a device.
const reports=process.env.TSFG_GPU_I32_REPORT_ROOT;
for(const {name,value}of cases)test('independent '+name+' SPIR-V words, Source obligations and owned pending reader',
  {skip:reports?false:'TSFG_GPU_I32_REPORT_ROOT is not supplied'},async()=>{
    assert.ok(path.isAbsolute(reports));
    const report=JSON.parse(await fs.readFile(path.join(reports,'green-'+name+'01/raw/stdout.bin'),'utf8'));
    assert.equal(report.coreSHA,'sha256:'+sha(value.core.text));assert.equal(report.requestSHA,digest(value.request));assert.equal(report.planSHA,digest(value.plan));
    const verify=row=>verifyGpuI32Report(row,value.oracle,value.plan,value.operator),accepted=verify(report);
    assert.equal(accepted.sourceEvents,value.arity===1?8:10);assert.equal(accepted.words,value.arity===1?182:187);
    const bitwise=['&','|','^','~'].includes(value.operator);
    const rebind=row=>{const out=row.emittedModule;out.wordsDigest=digest(out.words);const {artifactDigest,...artifact}=out;out.artifactDigest=digest(artifact);row.typedPending.words=[...out.words];row.typedPending.identity.wordsDigest=out.wordsDigest;row.typedPending.identity.artifactDigest=out.artifactDigest;};
    const controls=[
      row=>{const at=accepted.binary.arithmetic.start,opcode=value.arity===1?(value.operator==='~'?126:200):value.operator==='&'?197:value.operator==='|'?198:value.operator==='^'?199:value.operator==='-'?128:130;
        row.emittedModule.words[at]=(row.emittedModule.words[at]&0xffff0000)|opcode;rebind(row);},
      row=>{const words=row.emittedModule.words,at=accepted.binary.arithmetic.start;if(value.arity===1)words[at+3]=accepted.binary.parameterLoad.args[1];else [words[at+3],words[at+4]]=[words[at+4],words[at+3]];rebind(row);},
      row=>{row.emittedModule.obligations.at(-1).source.start++;rebind(row);},
      row=>{row.emittedModule.obligations.at(-1).dependsOn=[];row.emittedModule.discharges[0].requires=[];row.typedPending.discharges[0].prerequisites=[];rebind(row);},
      row=>{if(value.arity===1)row.typedPending.hostSteps[1].origin.descriptorIndex=1;else row.typedPending.hostSteps[2].origin.bits=8;},
      row=>{row.emittedModule.launchAuthorized=true;row.typedPending.launchAuthorized=true;rebind(row);},
      row=>{row.arity=value.arity===1?2:1;},
      row=>{row.emittedModule.obligations.at(-1).semantics=bitwise?'source-i32-modulo-2^32':'source-i32-bitwise-32';rebind(row);},
      row=>{row.emittedModule.discharges[0].relation=bitwise?'low-32-bits-exact':'32-bit-pattern-exact';rebind(row);},
    ];
    controls.forEach(change=>{const changed=structuredClone(report);change(changed);assert.throws(()=>verify(changed));});
    if(!bitwise){
      const original=JSON.parse(await fs.readFile(path.join(reports,'red-'+name+'01/raw/stdout.bin'),'utf8'));
      assert.deepEqual(report.emittedModule,original.emittedModule);assert.deepEqual(report.typedPending,original.typedPending);
    }
  });
