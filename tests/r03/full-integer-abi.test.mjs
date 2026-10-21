// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {whole,tables,oracle} from './full-integer-abi-fixtures.mjs';
import {scalarModule} from './aot-compiler-boundaries.mjs';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
import {checkCompilerGraph,instructions} from './aot-compiler-llvm.mjs';
import {readCompilerCoff} from './aot-compiler-coff.mjs';
const commands=['--emit-native-llvm','--emit-native-object'];
const rejected=r=>{assert.equal(r.close.code,3,r.stderr.toString('utf8'));assert.equal(r.stdout.length,0);};
function objectContract(bytes,count){
 const obj=readCompilerCoff(bytes);assert.equal(obj.timestamp,0);
 for(let i=0;i<count;i++)assert.ok(obj.symbols.some(s=>s.name==='native_'+i&&s.section>0));
 assert.deepEqual(new Set(obj.stackmaps.frames.map(f=>f.symbol)),new Set([...Array.from({length:count},(_,i)=>'native_'+i),'tsfg_native_invoke_v3']));
 assert.ok(!obj.symbols.some(s=>s.name==='tsfg_native_invoke'));
 const version=obj.symbols.find(s=>s.name==='tsfg_native_abi_version');assert.ok(version&&version.section>0);
 const section=obj.sections[version.section-1];assert.equal(section.data.readUInt32LE(version.value),oracle.ABI.versionValue);
 assert.equal(section.characteristics&0x80000000,0,'version section is read-only');return obj;
}
test('exact complete causal u64 parameter/result input becomes real LLVM and COFF',async()=>{
 const input=scalarModule(1,['u64']);accepted(await invokeCore(input));
 for(const command of commands){const r=await invokeCore(input,command);accepted(r);if(command===commands[0])checkCompilerGraph(r.stdout.toString('utf8'),{nativeFunctions:1,signatures:[{parameters:[9],result:9}]});else objectContract(r.stdout,1);}
});
test('whole81 preserves every nominal signature, all independent47 boundary constants, recursive returns and wide phi',async()=>{
 accepted(await invokeCore(whole.input));const r=await invokeCore(whole.input,commands[0]);accepted(r);
 const graph=checkCompilerGraph(r.stdout.toString('utf8'),{nativeFunctions:81,signatures:whole.signatures,allowElidedEvents:true});
 for(const [index,row]of whole.functions.entries()){
  const fn=graph.native[index],kind=oracle.kinds.find(k=>k.name===row.result),ops=instructions(fn);
  const llvmType='i'+kind.width;assert.equal(fn.result,llvmType);
  assert.deepEqual(fn.args.slice(2).map(a=>a.type),row.parameters.map(p=>'i'+oracle.kinds.find(k=>k.name===p).width));
  if(row.expected.kind==='constant'){
   const expected=kind.width===1?(row.expected.canonicalBits==='1'?'true':'false'):BigInt.asIntN(kind.width,BigInt(row.expected.canonicalBits)).toString();
   assert.ok(ops.some(op=>op.rhs==='ret '+llvmType+' '+expected),'independent extremum bits '+row.name);
  }
  if(row.expected.kind==='recursive'){
   assert.equal(fn.calls[0].callee,index);assert.ok(ops.some(op=>op.rhs.startsWith('phi '+llvmType+' ')));
  }
  if(row.expected.kind==='relay')assert.equal(graph.native[fn.calls[0].callee].args[2].type,llvmType);
  if(row.expected.kind==='mixed64')assert.equal(fn.args.length,66);
 }
 // These independent literals are proof inputs for the checked guard graphs.
 // They are not fed to an executor or claimed as guest return/trap observations.
 for(const bad of oracle.invalidSlots){const kind=oracle.kinds.find(k=>k.code===bad.typeCode),bytes=Buffer.from(bad.slotHex,'hex'),lo=bytes.readUInt32LE(0),hi=bytes.readUInt32LE(4);assert.ok(kind.code===2?lo!==0||hi>1:hi!==0||BigInt(lo)>((1n<<BigInt(kind.width))-1n));}
 for(const bad of oracle.wrongSignatureExamples)assert.notEqual(bad.suppliedCode,bad.requiredCode);
});
test('whole81 ordinary COFF has all symbols, relocations, readonly version and real stackmap frames',async()=>{
 const r=await invokeCore(whole.input,commands[1]);accepted(r);objectContract(r.stdout,81);
});
for(const count of [128,129,512])test('complete '+count+' wide function table retained in LLVM and ordinary COFF',async()=>{
 const input=tables[count].input;accepted(await invokeCore(input));
 for(const command of commands){const r=await invokeCore(input,command);accepted(r);if(command===commands[0]){
  const text=r.stdout.toString('utf8');assert.equal([...text.matchAll(/^define i64 @native_\d+\(/gm)].length,count);assert.match(text,new RegExp('call i64 @native_'+(count-1)+'\\('));assert.match(text,/@tsfg_native_abi_version = constant i32 3/);
 }else objectContract(r.stdout,count);}
});
test('513 definitions rejected by complete Core gate before either backend',async()=>{
 for(const command of ['--canonicalize',...commands]){const r=await invokeCore(tables[513].input,command);rejected(r);assert.ok(!r.stderr.toString('utf8').includes('r07-native-capability'));}
});
/** @type {[string,(input:string)=>string][]} */
const malformed=[
 ['late wrong same-width nominal call',s=>s.replace('func.call @identity_i64(%a0)','func.call @identity_u64(%a0)')],
 ['forged layout',s=>s.replace('e-m:w-p270','e-m:e-p270')],
 ['unknown nominal',s=>s.replaceAll('integer<"usize">','integer<"u128">')],
 ['wrong signature identity',s=>s.replace(/signature_hash = "sha256:[a-f0-9]{64}"/,'signature_hash = "sha256:'+'0'.repeat(64)+'"')]
];
for(const [name,mutate]of malformed)test('whole81 original Core verifier rejects '+name,async()=>{
 const input=mutate(whole.input);assert.notEqual(input,whole.input);for(const command of commands){const r=await invokeCore(input,command);rejected(r);assert.ok(!r.stderr.toString('utf8').includes('r07-native-capability'));}
});
