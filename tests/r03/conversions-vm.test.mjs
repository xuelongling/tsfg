// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {compileProgram,compileHir,sourceInput,runBytecode,runRequestSequence,createCompilerSession} from '../../compiler/pipeline.mjs';
import {printHir,readHir,lowerHir,verifyHir} from '../../compiler/hir.mjs';
import {validateFrontendSnapshot,analyzeFrontend} from '../../compiler/frontend.mjs';
const tools=()=>({frontend:process.env.TSFG_FRONTEND_EXE,core:process.env.TSFG_CORE_IR_EXE,vm:process.env.TSFG_VM_EXE});
const value=(type,value)=>({type,value});
async function frozen(name,hash){const b=await readFile(new URL('./fixtures/'+name,import.meta.url));assert.equal(createHash('sha256').update(b).digest('hex'),hash);return JSON.parse(b.toString('utf8'));}
async function compiled(source,optimize=false){const p=await compileProgram(await sourceInput(source),{...tools(),optimize});assert.equal(p.status,'ok',JSON.stringify(p));return p;}
async function rawPair(id,program,requests){
 const executable=tools().vm,args=['--requests',JSON.stringify(requests)];const child=spawnSync(executable,args,{input:program.bytecode,windowsHide:true,maxBuffer:16*1024*1024,timeout:300000});
 const directory=process.env.TSFG_CONVERSION_EVIDENCE_DIR;
 if(directory){await mkdir(directory,{recursive:true});await Promise.all([writeFile(path.join(directory,id+'.tbc'),program.bytecode),writeFile(path.join(directory,id+'.hir'),printHir(program.hir)),writeFile(path.join(directory,id+'.mlir'),program.core),writeFile(path.join(directory,id+'.requests.json'),JSON.stringify(requests)+'\n'),writeFile(path.join(directory,id+'.stdout'),child.stdout??''),writeFile(path.join(directory,id+'.stderr'),child.stderr??''),writeFile(path.join(directory,id+'.terminal.json'),JSON.stringify({executable,args,status:child.status,signal:child.signal,error:child.error?.message??null})+'\n')]);}
 assert.equal(child.status,0,child.stderr?.toString());return JSON.parse(child.stdout.toString('utf8'));
}
test('2508 independently frozen conversion expectations execute through all 286 entries in both optimizer modes',async()=>{
 const oracle=await frozen('exact-conversion-oracle.PREPARED.json','9a4642bf36e2f7985170fd1f87873fa2e0c2d6693e8bd5f4426702fa457c049f');assert.equal(oracle.cases.length,2508);
 const modes={'range-check':'checked','integer-wrap':'wrap','equal-width-reinterpret':'reinterpret'},groups=new Map();
 for(const row of oracle.cases){const key=[modes[row.mode],row.from,row.to].join('-');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}assert.equal(groups.size,286);
 for(const optimize of [false,true])for(const [key,rows]of groups){const first=rows[0],mode=modes[first.mode],call=`${mode}_${first.to}_from_${first.from}(input)`,source=`export function entry(input: ${first.from}): ${first.to} { return ${call}; }`,p=await compiled(source,optimize);
  const requests=rows.map(row=>({arguments:[value(row.from,row.input.rawBits??row.input.decimal)]})),outcomes=await rawPair(`oracle-${key}-${optimize}`,p,requests);assert.equal(outcomes.length,rows.length);
  for(const [index,row]of rows.entries()){const got=outcomes[index],label=JSON.stringify({id:row.id,mode:row.mode,from:row.from,to:row.to,input:row.input,got});assert.equal(got.activeRequests,'0',label);
   if(row.expected.kind==='trap'){assert.equal(got.status,'failed',label);assert.equal(got.code,row.expected.reason==='non-finite'?'r01-t-conversion-nonfinite':'r01-t-conversion-range',label);assert.deepEqual(got.ruleIds,['r01-conversions']);assert.equal(source.slice(Number(got.source.start),Number(got.source.end)),call,label);}
   else{assert.equal(got.status,'returned',label);assert.deepEqual(got.result,value(row.to,row.expected.rawBits??row.expected.decimal),label);}
  }
 }
});
test('36 independently frozen nonfinite policies preserve infinity/canonical checked NaN and all raw roundtrip bits',async()=>{
 const oracle=await frozen('nonfinite-conversion-oracle.PREPARED.json','73d58b7f26710291596369a7f65f914d34d5e54e37a8097b30e40e2ac6aad64b');assert.equal(oracle.rows.length,36);
 for(const optimize of [false,true])for(const row of oracle.rows){const call=row.mode==='checked'?`checked_${row.to}_from_${row.from}(input)`:`reinterpret_${row.to}_from_${row.via}(reinterpret_${row.via}_from_${row.from}(input))`,p=await compiled(`export function entry(input: ${row.from}): ${row.to} { return ${call}; }`,optimize);const [got]=await rawPair(row.id+'-'+optimize,p,[{arguments:[value(row.from,row.inputBits)]}]);assert.equal(got.status,'returned',row.id);assert.deepEqual(got.result,value(row.to,row.expected.rawBits),row.id);assert.equal(got.activeRequests,'0');}
});
test('conversion unused traps, first failure, argument order, recovery and scalar Fuel/depth are observable',async()=>{
 for(const optimize of [false,true]){
  const source='/*😀*/ export function entry(x:f64):i8 { const unused:i8=checked_i8_from_f64(x); return checked_i8_from_f64(x / 0.0); }',p=await compiled(source,optimize),good=await compiled('export function entry(x:f64):i8 { return checked_i8_from_f64(x); }',optimize);
  const outcomes=await runRequestSequence([p.bytecode,good.bytecode],{...tools(),requests:[{arguments:[value('f64','4072c00000000000')]},{arguments:[value('f64','3ff0000000000000')],semanticFuel:1,depth:1}]});assert.equal(outcomes[0].code,'r01-t-conversion-range');assert.equal(source.slice(Number(outcomes[0].source.start),Number(outcomes[0].source.end)),'checked_i8_from_f64(x)');assert.deepEqual(outcomes[1].result,value('i8','1'));assert.equal(outcomes[1].fuelConsumed,'1');assert.equal(outcomes[1].fuelRemaining,'0');for(const out of outcomes)assert.equal(out.activeRequests,'0');
  const ordered=await compiled('export function entry(x:f64):i8 { return join(checked_i8_from_f64(x),checked_i8_from_f64(x / 0.0)); } function join(a:i8,b:i8):i8 { return a; }',optimize);const [failure]=await runBytecode(ordered.bytecode,{...tools(),requests:[{arguments:[value('f64','4072c00000000000')]}]});assert.equal(failure.code,'r01-t-conversion-range');
  const [nonfinite]=await runBytecode(good.bytecode,{...tools(),requests:[{arguments:[value('f64','7ff0000000000001')]}]});assert.equal(nonfinite.code,'r01-t-conversion-nonfinite');
 }
});
test('official conversion provenance cannot be forged, while ordinary same-name functions execute their bodies',async()=>{
 const source='export function entry(x:f64):i8 { return checked_i8_from_f64(x); }',input=await sourceInput(source),result=await analyzeFrontend(input,{executable:tools().frontend});assert.equal(result.status,'ok',JSON.stringify(result));
 for(const mutate of [s=>s.functions[0].body[0].expression.conversion.entryId='sha256:'+'0'.repeat(64),s=>s.functions[0].body[0].expression.conversion.brandRefs[0].range.start++,s=>s.functions[0].body[0].expression.conversion.declarationPath='/foreign/minimal-conversions-v5.d.ts']){const s=structuredClone(result.snapshot);mutate(s);assert.throws(()=>validateFrontendSnapshot(s));}
 const p=await compiled(source),hir=readHir(Buffer.from(printHir(p.hir)));assert.equal(lowerHir(hir),lowerHir(p.hir));const forged=structuredClone(hir);forged.inputScope.files[0].content+=' ';assert.throws(()=>verifyHir(forged));
 for(const invalid of ['export function entry(x:f64):i8 { return checked_i8_from_f64(); }','export function entry(x:f64):i8 { return checked_i8_from_f64<f64>(x); }','export function entry(x:f64):i8 { return reinterpret_i8_from_f64(x); }','export function entry(x:f32):u8 { return wrap_u8_from_f32(x); }','export function entry(x:bool):i8 { return checked_i8_from_bool(x); }','export function entry(x:f64):i8 { return x as i8; }']){const got=await compileProgram(await sourceInput(invalid),tools());assert.equal(got.status,'error',invalid);assert.equal(got.bytecode,undefined);}
 for(const source of ['function checked_i8_from_f64(x:f64):i8 { return 42; } export function entry(x:f64):i8 { return checked_i8_from_f64(x); }','function checked_i8_from_f64(x:f64):i8 { return 42; } function entry(x:f64):i8 { return checked_i8_from_f64(x); }']){
  const ordinary=await compiled(source);assert.ok(!ordinary.core.includes('tsfg_core.convert_checked'));const [got]=await runBytecode(ordinary.bytecode,{...tools(),requests:[{functionId:ordinary.hir.functions[1].id,arguments:[value('f64','7ff0000000000001')],depth:2,semanticFuel:2}]});assert.deepEqual(got.result,value('i8','42'));assert.equal(got.fuelConsumed,'2');assert.equal(got.fuelRemaining,'0');
 }
});
test('conversion canonical exchange and cold/incremental source metamorphisms retain results',async()=>{
 for(const optimize of [false,true])for(const text of ['checked_i8_from_f64(x)','checked_i8_from_f64 /*comment*/ ( (x), )','checked_i8_from_f64((+(x)))']){
  const input=await sourceInput(`/*😀*/ export function entry(x:f64):i8 { return ${text}; }`),session=createCompilerSession({...tools(),optimize}),first=await session.compile(input),second=await session.compile(input),cold=await compileProgram(input,{...tools(),optimize});for(const p of [first,second,cold]){assert.equal(p.status,'ok',JSON.stringify(p));const span=p.hir.functions[0].body[0].value.range;assert.equal(input.files[0].content.slice(span.start,span.end),text);}assert.deepEqual(first.bytecode,second.bytecode);assert.deepEqual(first.bytecode,cold.bytecode);
  assert.deepEqual(await runBytecode(first.bytecode,{...tools(),command:'--roundtrip'}),first.bytecode);const [got]=await runBytecode(first.bytecode,{...tools(),requests:[{arguments:[value('f64','3ffc000000000000')]}]});assert.deepEqual(got.result,value('i8','1'));
  const old=Buffer.from(first.bytecode);old.writeUInt32LE(8,8);await assert.rejects(()=>runBytecode(old,tools()));
 }
});


test('independent Core and wire verifiers reject illegal nominal pairs, reserved bits and forged register uses',async()=>{
 const source='export function entry(x:f64):i8 { return checked_i8_from_f64(x); }',p=await compiled(source);
 for(const operation of ['convert_wrap','reinterpret']){const core=p.core.replace('tsfg_core.convert_checked','tsfg_core.'+operation),child=spawnSync(tools().core,['--canonicalize'],{input:core,windowsHide:true});assert.equal(child.status,3);assert.match(child.stderr.toString(),/core-ir-conversion-type/);}
 const offset=p.bytecode.length-32;assert.equal(p.bytecode[offset],34);
 for(const [field,newValue,code]of [[7,1,'r04-reserved'],[6,2,'r04-conversion-type'],[1,2,'r04-conversion-type'],[4,255,'r04-register']]){
  const bytes=Buffer.from(p.bytecode);bytes[offset+field]=newValue;createHash('sha256').update(bytes.subarray(80)).digest().copy(bytes,48);await assert.rejects(()=>runBytecode(bytes,tools()),new RegExp(code));
 }
 const wrong=Buffer.from(p.bytecode);wrong[12]^=1;await assert.rejects(()=>runBytecode(wrong,tools()),/r04-schema/);
 const foreign=structuredClone(p.hir);foreign.functions[0].body[0].value.origin.brandRefs[0].range.end++;assert.throws(()=>verifyHir(foreign));
});

test('actual source, Core and VM endpoint pairs bind both modes to exact current consumer bytes',async()=>{
 const cases=[['checked','export function entry(x:f64):i8 { return checked_i8_from_f64(x); }',value('f64','3ffc000000000000'),value('i8','1')],['wrap','export function entry(x:i128):u8 { return wrap_u8_from_i128(x); }',value('i128','-257'),value('u8','255')],['reinterpret','export function entry(x:f32):u32 { return reinterpret_u32_from_f32(x); }',value('f32','ffc12345'),value('u32','4290847557')]];
 for(const optimize of [false,true])for(const [id,source,inputValue,expected]of cases){
  const sourceClaim=await sourceInput(source),inputBytes=Buffer.from(JSON.stringify(sourceClaim)),prefix=`endpoints-${id}-${optimize}`;
  async function endpoint(role,args,input,suffix){const executable=tools()[role],before=createHash('sha256').update(await readFile(executable)).digest('hex'),child=spawnSync(executable,args,{input,windowsHide:true,maxBuffer:16*1024*1024,timeout:300000}),after=createHash('sha256').update(await readFile(executable)).digest('hex');assert.equal(after,before);assert.equal(child.status,0,child.stderr?.toString());const directory=process.env.TSFG_CONVERSION_EVIDENCE_DIR;if(directory){await mkdir(directory,{recursive:true});await Promise.all([writeFile(path.join(directory,prefix+'-'+suffix+'.input'),input),writeFile(path.join(directory,prefix+'-'+suffix+'.stdout'),child.stdout),writeFile(path.join(directory,prefix+'-'+suffix+'.stderr'),child.stderr),writeFile(path.join(directory,prefix+'-'+suffix+'.terminal.json'),JSON.stringify({role,executable,args,status:child.status,signal:child.signal,error:child.error?.message??null,rawExecutableBefore:before,rawExecutableAfter:after})+'\n')]);}return child.stdout;}
  const actual=JSON.parse((await endpoint('frontend',[],inputBytes,'frontend')).toString('utf8'));assert.equal(actual.status,'ok');
  const analyzed=await analyzeFrontend(sourceClaim,{executable:tools().frontend});assert.equal(analyzed.status,'ok');validateFrontendSnapshot(analyzed.snapshot);
  const hirResult=await compileHir(sourceClaim,tools());assert.equal(hirResult.status,'ok');verifyHir(hirResult.hir);const coreInput=Buffer.from(lowerHir(hirResult.hir)),core=await endpoint('core',[optimize?'--optimize':'--canonicalize'],coreInput,'core-validate'),packet=await endpoint('core',['--emit-bytecode'],core,'core-bytecode');
  const formal=await compiled(source,optimize);assert.deepEqual(packet,formal.bytecode);assert.equal(core.toString('utf8'),formal.core);
  const requests=[{arguments:[inputValue]}],outcomes=JSON.parse((await endpoint('vm',['--requests',JSON.stringify(requests)],packet,'vm')).toString('utf8'));assert.deepEqual(outcomes[0].result,expected);assert.equal(outcomes[0].activeRequests,'0');
  if(process.env.TSFG_CONVERSION_EVIDENCE_DIR)await writeFile(path.join(process.env.TSFG_CONVERSION_EVIDENCE_DIR,prefix+'-owned-snapshot-hir.json'),JSON.stringify({snapshot:analyzed.snapshot,hir:hirResult.hir})+'\n');
 }
});
