// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';

const fixtures=[
  {name:'value-i32-arithmetic',targets:['valueI32Arithmetic'],pins:['96d5c1f292f074bd03906d651550f6788d563dab1d05eba02ec6cc1eb2d2eb24','46107ae21418ab07cbf162db8cc19c26ca3298e908bf363cc907680ab782cf93','76382c857ceb6c59bccc8afd8cd87c6c8862edced652ebd5657f39b5a6406208']},
  {name:'value-u32-arithmetic',targets:['valueU32Arithmetic'],pins:['680a81502cec782f54490a970e298ab87a3254a0bf0158024930b53d25f18228','cd9b6b16ecf965979aa2590ccd5cfdbe7114ecb0989374b6315e73fc645e1443','84bc542e0bb0a1605325e5e7d748a2d297da0c94cb7788c6cd95650632502a4e']},
  {name:'value-floating-arithmetic',targets:['valueF32Arithmetic','valueF64Arithmetic'],pins:['63be08a5789b128ff4664cfb85a4ed790e7a86b33185a09eb9163f4ef32c9926','13b35a2ed54d203e91dd4073c75c407c7c259cdc4e0e74e817fa48ff6ecbebeb','a02d3c08234734c92e49dc3dbddf65d10bbc8a2e6741bf20ea8209143195ff83']},
  {name:'value-floating-copy-equal',targets:['valueFloatingEqual','valueFloatingCopy'],pins:['d3e6c7b69ba5011cf8c0e519cc5185b79073b8424ec4b9e8c63303303cb3c52e','129d89d0212c50d358cd5fb6ac96036dad4eea1274dc82bcc0bcdf3b393c8a43','b86d6ce6a2df88e1c7af690613985fd05bdaa3e8e83852e23efde5ea9ebcdc35']}
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const reports=process.env.TSFG_VALUE_ARITHMETIC_REPORT_ROOT;
const index=reports?JSON.parse(await fs.readFile(path.join(reports,'index.json'),'utf8')):null;

function selectedGraph(report){
  const graph=report.controlFlows.find(row=>row.function==='value_'+report.functionId.slice(7));assert.ok(graph);return graph;
}
function integerOracle(report,signed){
  const graph=selectedGraph(report),rows=graph.instructions,nodes=new Map(rows.map(row=>[row.id,row])),blocks=new Map(graph.blocks.map(row=>[row.id,row]));
  const kinds=new Set(rows.map(row=>row.kind));for(const kind of ['add','sub','mul','and','or','xor'])assert.ok(kinds.has(kind),kind);
  for(const row of rows.filter(row=>['add','sub','mul','shl'].includes(row.kind))){assert.equal(row.nsw,false);assert.equal(row.nuw,false);}
  for(const predicate of signed?['slt','sle','sgt','sge']:['ult','ule','ugt','uge'])assert.ok(rows.some(row=>row.predicate===predicate),predicate);
  assert.ok(rows.filter(row=>row.kind==='zext').length>=5,'comparison and logical-not results preserve Common bool storage');
  assert.ok(rows.some(row=>row.kind==='sub'&&row.scalarOperands[0].bits==='0'),'unary minus starts from exact zero');
  assert.ok(rows.some(row=>row.kind==='xor'&&row.scalarOperands.some(operand=>operand.width===32&&operand.bits==='4294967295')),'unary complement uses the complete nominal bit pattern');
  const dominates=(block,row)=>blocks.get(row.block).dominators.includes(block);
  const guard=(operand,kind,predicate,bound,consumer)=>{
    const compare=rows.find(row=>row.predicate===predicate&&row.scalarOperands[0].id===operand&&row.scalarOperands[1].width===32&&row.scalarOperands[1].bits===bound&&
      rows.some(branch=>branch.kind==='br'&&branch.condition===row.id&&blocks.get(branch.block).successors.length===2&&
        dominates(blocks.get(branch.block).successors[0],consumer)&&rows.some(event=>event.eventKind===kind&&event.block===blocks.get(branch.block).successors[1])));
    assert.ok(compare,'typed guard dominates its arithmetic instruction and false edge reports its exact trap');return compare.id;
  };
  const controls={};
  for(const [suffix,trap]of [['div',5],['rem',6]]){
    const operation=rows.find(row=>row.kind===(signed?'s':'u')+suffix);assert.ok(operation);
    assert.equal(rows.some(row=>row.kind===(signed?'u':'s')+suffix),false,'signedness comes from the owned nominal type');
    let divisor=operation.scalarOperands[1].id;
    if(signed){
      const selected=nodes.get(divisor);assert.equal(selected.kind,'select');assert.equal(selected.scalarOperands[1].bits,'1');divisor=selected.scalarOperands[2].id;
      const overflow=nodes.get(selected.scalarOperands[0].id);assert.equal(overflow.kind,'and');
      const comparisons=overflow.scalarOperands.map(operand=>nodes.get(operand.id));
      assert.ok(comparisons.every(row=>row.predicate==='eq'));
      assert.deepEqual(comparisons.map(row=>row.scalarOperands.find(operand=>operand.bits)?.bits).sort(),['2147483648','4294967295']);
      assert.ok(rows.some(row=>row.kind==='select'&&row.scalarOperands[0].id===overflow.id&&row.scalarOperands[1].bits===(trap===5?'2147483648':'0')&&row.scalarOperands[2].id===operation.id),'MIN/-1 uses a safe divisor and the prescribed wrapped result');
      controls.safeDivisor=selected.id;
    }
    controls.zeroGuard=guard(divisor,trap,'ne','0',operation);
  }
  if(signed){
    for(const kind of ['shl','ashr','lshr']){
      const operation=rows.find(row=>row.kind===kind);assert.ok(operation);controls.shiftGuard=guard(operation.scalarOperands[1].id,7,'ult','32',operation);
    }
    assert.deepEqual([-1,0,31,32].map(value=>BigInt.asUintN(32,BigInt(value))<32n),[false,true,true,false]);
  }
  return controls;
}
function floatingOracle(report,target){
  const graph=selectedGraph(report),environment=graph.floatingEnvironment;
  assert.equal(environment.active,true);assert.equal(environment.callerEnvironmentReadOnce,true);
  assert.equal(environment.callbackRestoreAndStrictReestablish,true);assert.equal(environment.allReturnsRestoreCaller,true);
  assert.equal(environment.callbacks,report.callbacks);assert.ok(environment.returns>=2);
  const helpers=report.floatingHelpers;let expected;
  if(target==='valueFloatingCopy')expected=[];
  else if(target==='valueFloatingEqual')expected=['tsfg_aot_f32_eq','tsfg_aot_f64_eq'];
  else expected=['pos','neg','add','sub','mul','div','rem','lt','le','gt','ge'].map(op=>'tsfg_aot_'+(target==='valueF32Arithmetic'?'f32':'f64')+'_'+op);
  assert.deepEqual(helpers.map(row=>row.name).sort(),expected.sort());
  for(const helper of helpers){
    assert.equal(helper.strict,true);assert.equal(helper.internal,true);
    const operation=helper.name.split('_').at(-1),single=helper.name.includes('_f32_'),width=single?32:64;
    if(['add','sub','mul','div'].includes(operation)){
      assert.equal(helper.calls.length,1);assert.match(helper.calls[0].name,new RegExp('^llvm\\.experimental\\.constrained\\.f'+operation+'\\.f'+width+'$'));
      assert.deepEqual(helper.calls[0].modes,['round.tonearest','fpexcept.ignore']);
    }else if(['eq','lt','le','gt','ge'].includes(operation)){
      assert.equal(helper.calls.length,1);assert.match(helper.calls[0].name,/^llvm\.experimental\.constrained\.fcmp\./);
      assert.deepEqual(helper.calls[0].modes,[{eq:'oeq',lt:'olt',le:'ole',gt:'ogt',ge:'oge'}[operation],'fpexcept.ignore']);
    }else{assert.equal(helper.calls.length,0);if(operation==='rem')assert.ok(helper.blocks>=10);}
    if(!['eq','lt','le','gt','ge'].includes(operation))assert.ok(helper.constants.some(row=>row.width===width&&row.bits===(single?'2143289344':'9221120237041090560')),'canonical NaN bits');
    if(operation==='neg')assert.ok(helper.constants.some(row=>row.width===width&&row.bits===(single?'2147483648':'9223372036854775808')),'sign-bit negation preserves signed zero');
  }
}
for(const fixture of fixtures){
  const raw=await Promise.all(['package.json','official-oracle.json','source.ts'].map(name=>fs.readFile(new URL('./testdata/formal-value-llvm-v3/'+fixture.name+'/'+name,import.meta.url))));
  raw.forEach((bytes,index)=>assert.equal(sha(bytes),fixture.pins[index]));
  const oracle=JSON.parse(raw[1].toString('utf8')),source=raw[2].toString('utf8'),hir=projectCommonProgram(readCommonProgramFacts(raw[0])),publication=createCommonProgramPublication(hir);
  const core=emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()});
  test('complete official arithmetic '+fixture.name+' retains Source and nominal identities',()=>{
    assert.equal(oracle.sourceSha256,sha(raw[2]));assert.deepEqual(oracle.sourceRange,{start:0,end:source.length});
    assert.equal(hir.sources.find(row=>row.path==='/src/main.ts').content,source);assert.equal(hir.functions.length,oracle.functions.length);
    for(const original of oracle.functions){const fn=hir.functions.find(row=>row.sourceBinding===original.id);assert.ok(fn);assert.equal(fn.name,original.name);assert.deepEqual(fn.range,original.range);}
  });
  for(const target of fixture.targets){
    const original=oracle.functions.find(row=>row.name===target),fn=hir.functions.find(row=>row.sourceBinding===original.id);
    const options={skip:reports?false:'TSFG_VALUE_ARITHMETIC_REPORT_ROOT is not supplied'};
    test('actual shared arithmetic and independent LLVM oracle '+target,options,async()=>{
      assert.ok(path.isAbsolute(reports));const folder=index[target];assert.ok(path.isAbsolute(folder));
      const observed=JSON.parse(await fs.readFile(path.join(folder,'observed.json'),'utf8'));assert.equal(observed.qualified,true);assert.equal(observed.exit.code,0);assert.equal(observed.close.code,0);assert.deepEqual(observed.first,[]);
      const stdout=await fs.readFile(path.join(folder,'raw/stdout.bin')),stderr=await fs.readFile(path.join(folder,'raw/stderr.bin'),'utf8');assert.equal(stderr,'');
      const report=JSON.parse(stdout.toString('utf8'));assert.equal(report.passed,true);assert.equal(report.completeCoreRetained,true);assert.equal(report.mlirRoundTrip,true);assert.equal(report.sameFinalizedLLVMFromMLIR,true);
      assert.equal(report.functionId,fn.id);assert.equal(report.coreDigest,'sha256:'+sha(core));assert.equal(report.inputIdentity,hir.inputIdentity);assert.equal(report.executionAuthority,false);assert.equal(report.resourceProof,null);
      if(['valueI32Arithmetic','valueF32Arithmetic','valueFloatingCopy'].includes(target))assert.deepEqual(report.irStages,{mlir:'converted-intermediate',llvm:'finalized',requiresPostExportFinalization:true,finalizer:'tsfg::materializeNativeFloating',selection:'exact-closure',functions:['value_'+fn.id.slice(7)]});
      assert.equal(report.callbacks,report.events.length);assert.equal(report.stackmaps,report.callbacks+report.functions);assert.equal(report.events.filter(row=>row.kind===1).length,report.sourceFuelSites);
      const floating=target.includes('F32')||target.includes('F64')||target.includes('Floating');
      if(floating)floatingOracle(report,target);else integerOracle(report,target==='valueI32Arithmetic');
      const clone=()=>structuredClone(report),row=(copy,id)=>selectedGraph(copy).instructions.find(row=>row.id===id);
      if(!floating){
        const signed=target==='valueI32Arithmetic',controls=integerOracle(report,signed);
        const wrap=selectedGraph(report).instructions.find(row=>row.kind==='add');const badWrap=clone();row(badWrap,wrap.id).nsw=true;assert.throws(()=>integerOracle(badWrap,signed));
        const badZero=clone();row(badZero,controls.zeroGuard).predicate='eq';assert.throws(()=>integerOracle(badZero,signed));
        if(signed){const badMin=clone();row(badMin,controls.safeDivisor).scalarOperands[1].bits='0';assert.throws(()=>integerOracle(badMin,true));const badShift=clone();row(badShift,controls.shiftGuard).scalarOperands[1].bits='33';assert.throws(()=>integerOracle(badShift,true));}
        else{const badSigned=clone();selectedGraph(badSigned).instructions.find(row=>row.kind==='udiv').kind='sdiv';assert.throws(()=>integerOracle(badSigned,false));}
      }else{
        const badEnvironment=clone();selectedGraph(badEnvironment).floatingEnvironment.allReturnsRestoreCaller=false;assert.throws(()=>floatingOracle(badEnvironment,target));
        if(report.floatingHelpers.some(row=>row.name.endsWith('_add'))){const badRounding=clone();badRounding.floatingHelpers.find(row=>row.name.endsWith('_add')).calls[0].modes[0]='round.downward';assert.throws(()=>floatingOracle(badRounding,target));}
        else if(target==='valueFloatingCopy'){const badStruct=clone();selectedGraph(badStruct).floatingEnvironment.active=false;assert.throws(()=>floatingOracle(badStruct,target));}
      }
    });
  }
}
