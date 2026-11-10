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
  const unary=ast.literal===null&&(operator==='-'||operator==='~'),arity=unary?1:2,variable=!unary&&ast.literal===null;
  const shift=['<<','>>','>>>'].includes(operator),count=ast.literal===null?null:Number(ast.literalToken);
  assert.equal(ast.operator,operator);assert.equal(text.slice(ast.expression.start,ast.expression.end),unary?operator+'x':'x '+operator+' '+(variable?'x':ast.literalToken));
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
  else if(variable){assert.equal(expression.right.kind,'bindingReference');assert.equal(expression.right.binding,fn.parameters[0].id);assert.deepEqual(expression.right.range,ast.rightParameterUse);}
  else{assert.equal(expression.right.kind,'numericLiteral');assert.equal(expression.right.decimal,ast.literalToken);assert.deepEqual(expression.right.range,ast.literal);assert.ok(Number.isInteger(count));}
  const publication=createCommonProgramPublication(hir),group={targets:hir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  assert.equal(group.targets.length,2);assert.notEqual(publication.contracts.find(row=>row.functionId===fn.id).returnOrigins,null);
  const core=commonProgramCore(hir,publication,group,{borrowProof:true});assert.ok(core.borrowProof);
  const request={family:'tsfg.gpu-logical-binding-request',version:2,target:'vulkan',kernels:[fn.id],bindings:[
    {kind:'parameter',id:fn.parameters[0].id,kernel:fn.id,set:0,binding:0,access:'read'},
    {kind:'return',id:fn.id,kernel:fn.id,set:0,binding:1,access:'write'}]};
  const plan=createCommonGpuBindingPlan(hir,publication,group,request);
  return {operator,arity,shift,count,expectedReject:shift&&(count===null||count<0||count>31),oracle,oracleSHA:'sha256:'+sha(raw[1]),core,request,plan};
}
const plus=await fixture('common-program-gpu-constant-v3','+',['756c91508f560677acf295b8cdcc3e0510e3c4d88fe61ee4c550bca3d9ff5b58','0ece76da2679e6377dc440e460741d7d49d601002405d2882ddafd72691266e6','a82c00937bce576e39deef14ff50001bf75c57d2d63bbde3db7f26ba35e8c04f']);
const minus=await fixture('common-program-gpu-subtraction-v3','-',['8ad6c71edab8044391aa4c7927636f11be7e6c94236c71d0c07bef15b09ef0f0','ee6b05c68e54e03fac5d2a8f47b7acf8bf0001738f00b48287b98ca6caaa2c7e','b6fabcd68a6c435682828caf2cd36a754d48062b73b77052e8f513c3473b9c91']);
const multiply=await fixture('common-program-gpu-multiply-v3','*',['b45e9701ccb2929bab7653a6d7c8f0d74381475e1c29d55e486ede37dfe4dcc4','8dc1069ab49de21deccd93c5a192c92494a3abf166750361a69c4be41882fe2e','2f629475d04d07405d3abfdac966d22cb3ab8d59c04c9d9f9d75b6dadfac2b93']);
const negate=await fixture('common-program-gpu-negate-v3','-',['83dfdac458e3807f835b1fe0d0ebe75a5b08619a5a7dca5f5e914b1835457a81','0771b6ef5d29ef3ef617c0ded3594d85d2776e412c5c6fcbcdf8484746fd3f2e','2c3e70644c91ec21ad669308eda17c43d26521eaafbfce6ae21944c887a44437']);
const bitwiseAnd=await fixture('common-program-gpu-and-v3','&',['4db4f711f7c9dcecbdc184221d27bdc7f98950df881c6879e38046bb2c5284bc','f6b7d872c3d136354bcd91db4ec9ef83d00553ff858d177236e19cd0b352c542','e3a537fcaf1bd4b19a75ec5a55b1e2ee244c13d4f61559333052c3fec3cd3c64']);
const bitwiseOr=await fixture('common-program-gpu-or-v3','|',['d2f379bb6aedd180ed5c055fbe7cacd50b3ae8a4d327436d1da6631a589eb48f','be3481efb4309a36e5d9371496b4f2e0f334bb459936f1425e01cb0fcc1234ca','0a6966df96684623d3c58d7a1fc6dd07d3f8d3f0feabde5db743f2dad5d18be6']);
const bitwiseXor=await fixture('common-program-gpu-xor-v3','^',['840c9fde95a11168d60d50dc773002ccc64035cc2dd828ef28414eec3dff6600','e234c1e3a26bf1d5f1802ce839f3b047ee82ef775cc04ae228474a4c5f5b5134','f4df1a1a7d3bfab75bae7643268063d2e84ac729c935fa4740b6ac1f190a83b8']);
const bitwiseNot=await fixture('common-program-gpu-not-v3','~',['11a95f67a95ed04b808046b46f4d50e2017d0c3b2beace20e1b5eb0aa8222a64','e32463dad5313801c2cd631b9f4bb28f0767cad5cc3560cacba8de576fdf45df','ab0db2e5161383c734a1b5496c8bb53688bcf392be0d302552a905467480a3d3']);
const shl=await fixture('common-program-gpu-shl-v3','<<',['2c0ec5fa20f0f31762e18f13b4cbfce9cf3b71093b77ca22c6f0578012a4258f','a895f6bc03caf8237972f2df13c3cd14faf931989e90b9300a80fd8df5f2d755','359ec286992d59ffeb50887b618ddfa6af3a97bd0f74f925ba93971d9da9e4de']);
const shr=await fixture('common-program-gpu-shr-v3','>>',['cc909e695bfee2162033ca0da58dccf18946a7300bbde64fdd1a9e9e12571709','1b4747e83345444e3d63080306428fdc74af83640f1371a3b1ea306cb8708c9d','559cd8e0f9973e0cb1e649d674c1b66c28f8ea1d568385ec8ef5cf38216ce979']);
const ushr=await fixture('common-program-gpu-ushr-v3','>>>',['b65ecc9a51ba1ccef5c246fd6a521461a4b1c4f40c6546a30d9407873bd2265c','fdbfa69b3dbcbaa5b226d6af20af70305c2adb15c5fdf5b2a0e354c6e950dd07','2b36fbfd76f45351fe9a62c35b9345ef81abc1595d863d7011c931232ed3e3f4']);
const shlZero=await fixture('common-program-gpu-shl-zero-v3','<<',['742a4aa652f2fb205e3a01bf7458bc2ad6ffc41b575c277cea2158ed14607a37','fb3a0bc1618a37f45a09c6e538e8623d25c059c7e38612c44aabfa3a045b1ff1','3d0f6d358efcf4317bb967f2919775ebb027c5b4d428047e7075d0e5229cf831']);
const shrMax=await fixture('common-program-gpu-shr-max-v3','>>',['efd9eda8941ed341ee46b10a2c21f5a7ab0786b78a13a50e38c7c4b8db3ae7c5','2e39847c1b8f7c0c7f575f034cf052d1199d204418c2725b09fb455e72593e68','5318930117e90b7da0193967c07696fbbd73176d40e582e0cd9e4a7fbfd77f09']);
const ushrMax=await fixture('common-program-gpu-ushr-max-v3','>>>',['84ab3fa86d3e5c4524f3a6aa67dd59d4b72535ee98acb822ef4506a21f24ecc0','b42f862890bd9fdb9b422bf411ebb4cd98fdd595e3495cb775dafe32e6eabe84','c3cc0150a6f67e00ba7226f893f5670ee0e94d6040ad5226885815843461e625']);
const shlOverflow=await fixture('common-program-gpu-shl-overflow-v3','<<',['f7cccbc03454a9686a98f2d9cfb4d21532d7f067f5989e59a15c176892889a25','e06eea32363e77371c2e16d5469a34a020cb39084a4aac65bebbdff53ede5288','ef44aa8c8dc9256c2f42deb0cec824259fc989a3afe9f73a251a114a3c5497ac']);
const shrNegative=await fixture('common-program-gpu-shr-negative-v3','>>',['c4f3acf9113e71b4a9a620caa54b4876f8f7560ea6b60482f55c6e340f6ad8b6','bd1b98aa1a6c408d519bae81f044a5b8732c8c675c3e7aefd3a3d020cf9701a1','b0161db88971f1762db4a924db6e5cab98cbe8815bb1522840271924f62314b6']);
const shlVariable=await fixture('common-program-gpu-shl-variable-v3','<<',['4b7e95f070bf65ece0f8366eec2030a7c8dc84c01ed00b693c1021505db1a4c9','423dc9df65f34c8a59cd98dc43ef32f38ec7e3cb06dad838debd2706b62d43af','5b2e22fb5313c60f72df113a10050c12a311514236806d9e9146e61ce90f8e26']);
const cases=[{name:'plus',value:plus},{name:'minus',value:minus},{name:'multiply',value:multiply},{name:'negate',value:negate},
  {name:'and',value:bitwiseAnd},{name:'or',value:bitwiseOr},{name:'xor',value:bitwiseXor},{name:'not',value:bitwiseNot},
  {name:'shl',value:shl},{name:'shr',value:shr},{name:'ushr',value:ushr},{name:'shl-zero',value:shlZero},{name:'shr-max',value:shrMax},{name:'ushr-max',value:ushrMax},
  {name:'shl-overflow',value:shlOverflow},{name:'shr-negative',value:shrNegative},{name:'shl-variable',value:shlVariable}];
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
for(const {name,value}of cases.filter(({value})=>!value.expectedReject))test('independent '+name+' SPIR-V words, Source obligations and owned pending reader',
  {skip:reports?false:'TSFG_GPU_I32_REPORT_ROOT is not supplied'},async()=>{
    assert.ok(path.isAbsolute(reports));
    const report=JSON.parse(await fs.readFile(path.join(reports,'green-'+name+'01/raw/stdout.bin'),'utf8'));
    assert.equal(report.coreSHA,'sha256:'+sha(value.core.text));assert.equal(report.requestSHA,digest(value.request));assert.equal(report.planSHA,digest(value.plan));
    assert.equal(report.officialOracleSHA,value.oracleSHA);
    const verify=row=>verifyGpuI32Report(row,value.oracle,value.plan,value.operator),accepted=verify(report);
    assert.equal(accepted.sourceEvents,value.arity===1?8:10);if(!value.shift)assert.equal(accepted.words,value.arity===1?182:187);
    const bitwise=['&','|','^','~'].includes(value.operator);
    const rebind=row=>{const out=row.emittedModule;out.wordsDigest=digest(out.words);const {artifactDigest,...artifact}=out;out.artifactDigest=digest(artifact);row.typedPending.words=[...out.words];row.typedPending.identity.wordsDigest=out.wordsDigest;row.typedPending.identity.artifactDigest=out.artifactDigest;};
    const controls=[
      row=>{const at=accepted.binary.arithmetic.start,opcode=value.shift?(value.operator==='>>'?194:195):value.arity===1?(value.operator==='~'?126:200):value.operator==='&'?197:value.operator==='|'?198:value.operator==='^'?199:value.operator==='-'?128:130;
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
    if(value.shift){const constant=accepted.binary.constant;assert.ok(constant);controls.push(
      row=>{row.emittedModule.words[constant.start+3]=32;rebind(row);},
      row=>{row.emittedModule.obligations.at(-1).countProof.count=32;row.emittedModule.discharges[0].countProof.count=32;rebind(row);},
      row=>{row.emittedModule.obligations.at(-1).countProof.maximum=32;row.emittedModule.discharges[0].countProof.maximum=32;rebind(row);},
      row=>{delete row.emittedModule.obligations.at(-1).countProof;delete row.emittedModule.discharges[0].countProof;rebind(row);});}
    controls.forEach(change=>{const changed=structuredClone(report);change(changed);assert.throws(()=>verify(changed));});
    if(!value.shift){
      const original=JSON.parse(await fs.readFile(path.join(reports,'red-'+name+'01/raw/stdout.bin'),'utf8'));
      assert.deepEqual(report.emittedModule,original.emittedModule);assert.deepEqual(report.typedPending,original.typedPending);
    }
  });
for(const {name,value}of cases.filter(({value})=>value.expectedReject))test('genuine '+name+' rejects unproved shift counts at all three actual compiler entries',
  {skip:reports?false:'TSFG_GPU_I32_REPORT_ROOT is not supplied'},async()=>{
    assert.ok(path.isAbsolute(reports));const report=JSON.parse(await fs.readFile(path.join(reports,'green-'+name+'01/raw/stdout.bin'),'utf8'));
    assert.equal(report.family,'tsfg.gpu-i32-shift-capability-test-report');assert.equal(report.version,1);assert.equal(report.operator,value.operator);assert.equal(report.arity,2);
    assert.equal(report.coreSHA,'sha256:'+sha(value.core.text));assert.equal(report.requestSHA,digest(value.request));assert.equal(report.planSHA,digest(value.plan));assert.equal(report.officialOracleSHA,value.oracleSHA);
    const ast=value.oracle.functions.find(row=>row.name==='constantKernel'),source={sourceId:'/src/main.ts',...ast.expression};assert.deepEqual(report.source,source);
    assert.deepEqual(report.rejections.map(row=>row.api),['lowerGpuBindingFunctions','emitGpuBindingModule','readGpuBindingModule']);
    const message=value.count===null?'GPU shift requires a proven constant-i32 count in 0..31':'GPU shift constant count is outside the implemented 0..31 domain';
    report.rejections.forEach(row=>{assert.equal(row.code,'core-ir-common-gpu-lowering-capability');assert.equal(row.message,message);assert.deepEqual(row.source,source);assert.equal(row.outUnchanged,true);assert.ok(row.compilerBudgetRemaining>0);});
    assert.equal(report.typedInitial,'empty');assert.equal(report.typedFinal,'empty');assert.equal(report.artifactProduced,false);assert.equal(report.envelopeAdmittedAsArtifact,false);
    assert.deepEqual(report.readerIdentityEnvelope,{family:'tsfg.gpu-binding-module',version:1,inputIdentity:value.plan.inputIdentity,planDigest:digest(value.plan),profile:{name:'single-source-call-v1'}});
    assert.deepEqual(report.execution,{source:false,vm:false,numerical:false,hostPreflight:false,device:false});
  });
