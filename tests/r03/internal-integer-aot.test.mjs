// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fixtures from './internal-integer-aot-fixtures.mjs';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
import {readCompilerCoff} from './aot-compiler-coff.mjs';
import {checkCompilerGraph,instructions,dominates,reaches,successGate} from './aot-compiler-llvm.mjs';
const commands=['--emit-native-llvm','--emit-native-object'];
const hash=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
function refused(result,capability=false){assert.equal(result.close.code,3,result.stderr.toString('utf8'));assert.equal(result.stdout.length,0);if(capability)assert.match(result.stderr.toString('utf8'),/r07-native-capability/);}
function find(fn,pattern){const found=instructions(fn).find(op=>pattern.test(op.rhs));assert.ok(found,fn.name+': '+pattern);return found;}
function guarded(fn,comparison,operation,kind,span) {
 const block=fn.blocks.get(comparison.block);assert.equal(block.condition,comparison.result);
 assert.ok(fn.dominators.get(operation.block).has(block.successors[0]),'valid edge dominates instruction');
 const trap=fn.events.find(event=>event.kind===kind&&event.start===span[0]&&event.end===span[1]);assert.ok(trap);
 assert.ok(reaches(fn,block.successors[1],trap.block));assert.ok(!reaches(fn,block.successors[1],operation.block));
 assert.ok(!fn.events.some(event=>event.kind===4&&reaches(fn,trap.block,event.block)));return block;
}
for(const command of commands)test('same complete causal u64 Core becomes '+command+' GREEN',async()=>{
 assert.equal(hash(fixtures.causal.input),fixtures.causal.inputSHA256);const result=await invokeCore(fixtures.causal.input,command);accepted(result);
 if(command===commands[0]){const text=result.stdout.toString('utf8');assert.match(text,/ret i1 true/);checkCompilerGraph(text,{nativeFunctions:1,allowElidedEvents:true});}
 else readCompilerCoff(result.stdout);
});
const whole=fixtures.positive[0];
test('one whole73-function LLVM module retains all nine internal integer semantics',async()=>{
 assert.equal(hash(whole.input),whole.inputSHA256);const result=await invokeCore(whole.input,commands[0]);accepted(result);
 const text=result.stdout.toString('utf8'),graph=checkCompilerGraph(text,{nativeFunctions:73,allowElidedEvents:true});
 for(const row of whole.functions) {
  const fn=graph.native[row.index],expected=row.expected;
  assert.equal(fn.result,row.result==='bool'?'i1':'i32');assert.deepEqual(fn.args.slice(2).map(arg=>arg.type),row.parameters.map(p=>p==='bool'?'i1':'i32'));
  assert.ok(instructions(fn).every(op=>!(/\b(nsw|nuw|exact)\b/.test(op.rhs))));
  if(row.name==='failureCaller')continue;
  const width='i'+expected.bits,kind=row.name.slice(0,row.name.indexOf('_'));
  const phis=instructions(fn).filter(op=>op.rhs.startsWith('phi '+width+' '));assert.ok(phis.length>0,'wide SSA phi survives nominal erasure');
  if(kind==='wrap') {
   find(fn,new RegExp('^mul '+width+' '));find(fn,new RegExp('^sub '+width+' '));
   const wants=expected.expectedByChoose.map(n=>BigInt.asIntN(expected.bits,BigInt(n)).toString());
   assert.ok(phis.some(phi=>wants.every(value=>phi.rhs.includes('[ '+value+', %'))),'matching independent expected result phi constants');
  }
  if(kind==='div'||kind==='rem') {
   const operation=find(fn,new RegExp('^'+expected.llvmOpcode+' '+width+' '));
   const operands=new RegExp('^'+expected.llvmOpcode+' '+width+' ([^,]+), (.+)$').exec(operation.rhs);assert.ok(operands);
   let divisor=operands[2];
   if(expected.signed) {
    const safe=fn.defs.get(divisor);assert.ok(safe);
    const selection=new RegExp('^select i1 ([^,]+), '+width+' 1, '+width+' (.+)$').exec(safe.rhs);assert.ok(selection);
    divisor=selection[2];const both=fn.defs.get(selection[1]);assert.ok(both&&both.rhs.startsWith('and i1 '));
    const pair=/^and i1 ([^,]+), (.+)$/.exec(both.rhs);assert.ok(pair);
    const checks=pair.slice(1).map(value=>fn.defs.get(value)?.rhs);
    const minimum=(-(1n<<BigInt(expected.bits-1))).toString();
    assert.ok(checks.includes('icmp eq '+width+' '+operands[1]+', '+minimum));
    assert.ok(checks.includes('icmp eq '+width+' '+divisor+', -1'));
    assert.ok(dominates(fn,safe,operation));
    find(fn,new RegExp('^select i1 '+selection[1]+', '+width+' '+(kind==='div'?minimum:'0')+', '+width+' '+operation.result+'$'));
   } else assert.ok(!instructions(fn).some(op=>/^s(div|rem) /.test(op.rhs)));
   guarded(fn,find(fn,new RegExp('^icmp ne '+width+' '+divisor+', 0$')),operation,expected.trapKind,expected.trapSpan);
   const checkpoint=fn.events.find(event=>event.kind===2&&event.start===100&&event.end===101);assert.ok(checkpoint);successGate(fn,checkpoint.result,operation);
  }
  if(['shl','shr','ushr'].includes(kind)) {
   const operation=find(fn,new RegExp('^'+expected.llvmOpcode+' '+width+' ')),count=fn.args[3].value;
   const comparison=find(fn,new RegExp('^icmp ult i32 '+count+', '+expected.bits+'$'));
   const gate=guarded(fn,comparison,operation,7,[100,101]);
   if(expected.bits!==32) {
    const adapted=find(fn,new RegExp('^'+(expected.bits<32?'trunc':'zext')+' i32 '+count+' to '+width+'$'));
    assert.ok(fn.dominators.get(adapted.block).has(gate.successors[0]));assert.ok(dominates(fn,adapted,operation));
    assert.ok(operation.rhs.endsWith(', '+adapted.result));
   } else assert.ok(operation.rhs.endsWith(', '+count));
  }
  if(kind==='compare')find(fn,new RegExp('^icmp '+expected.llvmPredicate+' '+width+' [^,]+, '+expected.threshold+'$'));
  if(kind==='loop') {
   const increment=find(fn,new RegExp('^add '+width+' ([^,]+), 1$'));
   const x=/^add [^ ]+ ([^,]+), 1$/.exec(increment.rhs)[1],phiX=fn.defs.get(x);assert.ok(phiX&&phiX.rhs.startsWith('phi '+width+' '));
   const phiY=phis.find(phi=>phi.rhs.includes(increment.result));assert.ok(phiY&&phiX.rhs.includes(phiY.result));
   const tick=fn.events.find(event=>event.kind===1&&event.start===100&&event.end===120);assert.ok(tick,'Core event2 loop anchor uses existing native fuel+step kind1');
   const condition=find(fn,/^icmp slt i32 /);successGate(fn,tick.result,condition);
   find(fn,new RegExp('^icmp '+(expected.signed?'slt':'ult')+' '+width+' '));
  }
 }
 const caller=graph.native[72],post=caller.events.find(event=>event.kind===2&&event.start===300&&event.end===301);assert.ok(post);
 assert.equal(caller.calls[0].callee,1);const compare=find(caller,new RegExp('^icmp ne i32 '+post.result+', 0$'));
 const gate=caller.blocks.get(compare.block),later=caller.events.find(event=>event.kind===6&&event.start===400&&event.end===401);assert.ok(later);
 assert.ok(reaches(caller,gate.successors[0],later.block));assert.ok(!reaches(caller,gate.successors[1],later.block));
 assert.ok(!caller.events.some(event=>event.kind===4&&reaches(caller,gate.successors[1],event.block)));
 const calleeTrap=graph.native[1].events.find(event=>event.kind===5&&event.start===100&&event.end===101);assert.ok(calleeTrap);
});
test('one whole73-function COFF has real complete symbols relocations and stackmaps',async()=>{
 const result=await invokeCore(whole.input,commands[1]);accepted(result);const object=readCompilerCoff(result.stdout);assert.equal(object.timestamp,0);
 assert.ok(object.sections.some(section=>section.name==='.text'&&section.size>0));
 assert.deepEqual(new Set(object.stackmaps.frames.map(frame=>frame.symbol)),new Set([...whole.functions.map(row=>'native_'+row.index),'tsfg_native_invoke_v3']));
 for(const row of whole.functions)assert.ok(object.symbols.some(symbol=>symbol.name==='native_'+row.index&&symbol.section>0));
});
for(const row of fixtures.negative)test('formerly unsupported whole boundary now admitted '+row.id,async()=>{
 assert.equal(hash(row.input),row.inputSHA256);accepted(await invokeCore(row.input));for(const command of commands)accepted(await invokeCore(row.input,command));
});
test('floating internal SSA with a bool result is admitted by complete scalar AOT',async()=>{
 // Fresh structural Core derived from the public typed literal grammar, not Source evidence.
 const input=fixtures.causal.input.replaceAll('!tsfg_core.integer<"u64">','f64').replaceAll('value = "18446744073709551615"','value = "0000000000000000"').replaceAll('value = "1"','value = "3ff0000000000000"').replaceAll('value = "0"','value = "0000000000000000"');
 assert.notEqual(input,fixtures.causal.input);accepted(await invokeCore(input));for(const command of commands)accepted(await invokeCore(input,command));
});
for(const [name,input]of [['unknown nominal',fixtures.causal.input.replaceAll('integer<"u64">','integer<"u128">')],
 ['overflow literal',fixtures.causal.input.replace('18446744073709551615','18446744073709551616')]])test('original Core gate rejects '+name,async()=>{
 for(const command of commands){const result=await invokeCore(input,command);refused(result);assert.ok(!result.stderr.toString('utf8').includes('r07-native-capability'));}
});
