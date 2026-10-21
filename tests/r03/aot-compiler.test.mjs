// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import fixtures from './aot-compiler-fixtures.mjs';
import {scalarModule} from './aot-compiler-boundaries.mjs';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
import {checkCompilerGraph,instructions,dominates,reaches,successGate} from './aot-compiler-llvm.mjs';
import {readCompilerCoff} from './aot-compiler-coff.mjs';
const commands=['--emit-native-llvm','--emit-native-object'];
function rejected(result){assert.equal(result.close.code,3,result.stderr.toString('utf8'));assert.equal(result.stdout.length,0);assert.match(result.stderr.toString('utf8'),/core-ir-|r04-core-|r07-native-/);}
const read=name=>readFile(new URL(name,import.meta.url),'utf8');
const json=async name=>JSON.parse(await read(name));
const hash=input=>'sha256:'+createHash('sha256').update(input).digest('hex');
const rhs=(fn,pattern)=>instructions(fn).find(op=>pattern.test(op.rhs));
const comparison=(fn,pattern)=>{const op=rhs(fn,pattern);assert.ok(op,pattern.source);return op;};
function guard(fn,compare,semantic,kind,span) {
 const block=fn.blocks.get(compare.block);assert.equal(block.condition,compare.result);
 assert.ok(fn.dominators.get(semantic.block).has(block.successors[0]));
 const trap=fn.events.find(e=>e.kind===kind&&e.start===span[0]&&e.end===span[1]);assert.ok(trap);
 assert.ok(reaches(fn,block.successors[1],trap.block));assert.ok(!reaches(fn,block.successors[1],semantic.block));
 assert.ok(!fn.events.some(e=>e.kind===4&&reaches(fn,trap.block,e.block)));
}
for(const fixture of fixtures.positive)test('LLVM whole graph '+fixture.id,async()=>{
 assert.equal(hash(fixture.input),fixture.inputSHA256);
 const result=await invokeCore(fixture.input,commands[0]);accepted(result);
 const text=result.stdout.toString('utf8'),graph=checkCompilerGraph(text,fixture.expected);
 for(const [index,fn]of graph.native.entries()) {
  const expected=fixture.functions[index];assert.equal(fn.result,expected.result==='bool'?'i1':'i32');
  assert.deepEqual(fn.args.slice(2).map(arg=>arg.type),expected.parameters.map(p=>p==='bool'?'i1':'i32'));
 }
 if(fixture.id==='dynamic-arithmetic') {
  const expected=['add','sub','mul','sub','xor','and','or','xor','sdiv','srem','shl','ashr','lshr'];
  for(let index=0;index<expected.length;index++) {
   const fn=graph.native[index],op=comparison(fn,new RegExp('^'+expected[index]+' i32 '));
   assert.ok(!/\b(nsw|nuw|exact)\b/.test(op.rhs));
   const checkpoint=fn.events.find(e=>e.kind===2&&e.start===10&&e.end===20);assert.ok(checkpoint);successGate(fn,checkpoint.result,op);
  }
  for(const index of [8,9]) {
   const fn=graph.native[index],a=fn.args[2].value,b=fn.args[3].value;
   const operation=comparison(fn,new RegExp('^'+(index===8?'sdiv':'srem')+' i32 '));
   guard(fn,comparison(fn,new RegExp('^icmp ne i32 '+b+', 0$')),operation,index===8?5:6,[10,20]);
   const isMin=comparison(fn,new RegExp('^icmp eq i32 '+a+', -2147483648$'));
   const isNeg=comparison(fn,new RegExp('^icmp eq i32 '+b+', -1$'));
   const both=comparison(fn,new RegExp('^and i1 '+isMin.result+', '+isNeg.result+'$'));
   const safe=comparison(fn,new RegExp('^select i1 '+both.result+', i32 1, i32 '+b+'$'));
   assert.match(operation.rhs,new RegExp(', '+safe.result+'$'));assert.ok(dominates(fn,safe,operation));
   comparison(fn,new RegExp('^select i1 '+both.result+', i32 '+(index===8?'-2147483648':'0')+', i32 '+operation.result+'$'));
  }
  for(const index of [10,11,12]) {
   const fn=graph.native[index],b=fn.args[3].value,op=comparison(fn,new RegExp('^'+expected[index]+' i32 '));
   guard(fn,comparison(fn,new RegExp('^icmp ult i32 '+b+', 32$')),op,7,[10,20]);
  }
  for(const [index,predicate]of ['eq','ne','slt','sle','sgt','sge'].entries())comparison(graph.native[13+index],new RegExp('^icmp '+predicate+' i32 '));
  const boolFn=graph.native[19],boolNot=comparison(boolFn,/^xor i1 /);
  assert.deepEqual(new Set(boolNot.rhs.slice('xor i1 '.length).split(', ')),new Set(['true',boolFn.args[2].value]));
  for(const [index,predicate]of [[20,'eq'],[21,'ne']]){const fn=graph.native[index];assert.ok(instructions(fn).some(op=>op.rhs==='icmp '+predicate+' i1 '+fn.args[2].value+', '+fn.args[3].value));}
 }
 if(fixture.id==='complete-call-order') {
  assert.deepEqual(graph.native.flatMap(fn=>fn.calls.map(call=>call.callee)),fixture.expected.directCallTargets);
  const first=graph.native[0];assert.equal(first.calls[0].args,'ptr '+first.args[0].value+', ptr '+first.args[1].value+', i32 '+first.args[3].value+', i32 '+first.args[2].value+', i1 '+first.args[4].value);
 }
 if(fixture.id==='cfg-short-circuit-traps') {
  const swap=graph.native[0],phis=instructions(swap).filter(op=>op.rhs.startsWith('phi i32 '));assert.equal(phis.length,2);
  for(const phi of phis)assert.ok(phi.rhs.includes(phis.find(other=>other!==phi).result),'swap backedge uses the other old phi');
  const branch=graph.native[1];assert.ok(instructions(branch).filter(op=>op.rhs.startsWith('phi ')).length>=5,'mixed three-argument edges retained');
  for(const [index,opcode,side]of /** @type {[number,string,number][]} */ ([[2,'sdiv',0],[3,'shl',1]])) {
   const fn=graph.native[index],op=comparison(fn,new RegExp('^'+opcode+' i32 '));
   const decision=[...fn.blocks.values()].find(block=>block.condition===fn.args[2].value);assert.ok(decision);
   assert.ok(reaches(fn,decision.successors[side],op.block));assert.ok(!reaches(fn,decision.successors[1-side],op.block));
  }
  const fn=graph.native[4],first=fn.events.find(e=>e.kind===5&&e.start===10&&e.end===20),second=fn.events.find(e=>e.kind===6&&e.start===30&&e.end===40);
  assert.ok(first&&second);assert.ok(!reaches(fn,first.block,second.block),'first trap does not reach the second trap');
 }
});
for(const fixture of fixtures.positive.filter(p=>p.id!=='complete-call-order'))test('COFF data '+fixture.id,async()=>{
 const result=await invokeCore(fixture.input,commands[1]);accepted(result);const object=readCompilerCoff(result.stdout);
 assert.equal(object.timestamp,0);assert.ok(object.sections.some(s=>s.name==='.text'&&s.size>0));
 for(let index=0;index<fixture.expected.nativeFunctions;index++)assert.ok(object.symbols.some(s=>s.name==='native_'+index&&s.section>0));
 assert.ok(object.symbols.some(s=>s.name==='tsfg_native_invoke'&&s.section>0));
 assert.deepEqual(new Set(object.stackmaps.frames.map(f=>f.symbol)),new Set([...fixture.functions.map((_,i)=>'native_'+i),'tsfg_native_invoke']));
 for(const id of object.stackmaps.ids)assert.ok((id>>63n)===1n||id===0xffffffffn||id<BigInt(fixture.expected.nativeFunctions));
});
for(const row of fixtures.negative)test('whole capability '+row.id,async()=>{
 assert.equal(hash(row.input),row.inputSHA256);accepted(await invokeCore(row.input));
 for(const command of commands){const result=await invokeCore(row.input,command);rejected(result);assert.match(result.stderr.toString('utf8'),/r07-native-capability/);}
});
test('complete128 function and64 mixed parameter backend boundaries',async()=>{
 const whole=scalarModule(128);const result=await invokeCore(whole,commands[0]);accepted(result);checkCompilerGraph(result.stdout.toString('utf8'),{nativeFunctions:128});
 const excess=scalarModule(129);accepted(await invokeCore(excess));
 for(const command of commands){const result=await invokeCore(excess,command);rejected(result);assert.match(result.stderr.toString('utf8'),/r07-native-capability/);}
 const parameters=Array.from({length:64},(_,i)=>i%2?'bool':'i32');
 const wide=await invokeCore(scalarModule(1,parameters),commands[0]);accepted(wide);const graph=checkCompilerGraph(wide.stdout.toString('utf8'),{nativeFunctions:1});
 assert.equal(graph.native[0].args.length,66);const wrapper=instructions(graph.wrapper);
 comparison(graph.wrapper,/^getelementptr i8, ptr %3, i32 504$/);comparison(graph.wrapper,/^getelementptr i8, ptr %3, i32 508$/);
 assert.ok(wrapper.some(op=>op.rhs.startsWith('trunc i32 ')));
 for(const command of commands)rejected(await invokeCore(scalarModule(1,[...parameters,'i32']),command));
});
test('nominal u32/i64 are complete capability refusals',async()=>{
 for(const name of ['u32','i64']) {const input=scalarModule(1,[name]);accepted(await invokeCore(input));for(const command of commands){const result=await invokeCore(input,command);rejected(result);assert.match(result.stderr.toString('utf8'),/r07-native-capability/);}}
});
test('original Core gate rejects i32 unary pos before capability',async()=>{
 const input=fixtures.positive[0].input.replace('"tsfg_core.neg"','"tsfg_core.pos"');
 for(const command of commands){const result=await invokeCore(input,command);rejected(result);assert.match(result.stderr.toString('utf8'),/core-ir-type/);}
});
/** @type {[string,(input:string)=>string][]} */
const malformed=[
 ['old-version',input=>input.replace('"0.9.0"','"0.8.0"')],
 ['mixed-schema',input=>input.replace(fixtures.identity.bytecodeSchema,'sha256:'+'0'.repeat(64))],
 ['target',input=>input.replace('windows-x86_64-msvc','linux-x86_64-gnu')],
 ['triple',input=>input.replace('x86_64-pc-windows-msvc','x86_64-unknown-linux-gnu')],
 ['layout',input=>input.replace('e-m:w-','e-m:e-')],
 ['function-id',input=>input.replace(/function_id = "sha256:[0-9a-f]{64}"/,'function_id = "sha256:'+'0'.repeat(64)+'"')],
 ['signature',input=>input.replace(/signature_hash = "sha256:[0-9a-f]{64}"/,'signature_hash = "sha256:'+'0'.repeat(64)+'"')],
 ['type-id',input=>input.replace(/type_id = "sha256:[0-9a-f]{64}"/,'type_id = "sha256:'+'0'.repeat(64)+'"')],
 ['source-range',input=>input.replace('tsfg_source.end = 42','tsfg_source.end = 43')],
 ['source-path',input=>input.replace('/src/main.ts','/src/../main.ts')],
 ['unknown-module-attribute',input=>input.replace('module attributes {','module attributes {tsfg_core.unknown = true, ')],
 ['undefined-ssa',input=>input.replace('"func.return"(%value)','"func.return"(%undefined)')],
 ['absent-entry-fuel',input=>input.replace(/"tsfg_core.fuel"[^\n]*\n/,'')],
 ['unknown-void-op',input=>input.replace('"func.return"','"tsfg_core.unknown_void"() : () -> ()\n"func.return"')],
];
for(const [name,mutate]of malformed)test('original full Core gate '+name,async()=>{
 const input=mutate(fixtures.minimal);assert.notEqual(input,fixtures.minimal);
 for(const command of commands){const result=await invokeCore(input,command);rejected(result);assert.ok(!result.stderr.toString('utf8').includes('r07-native-capability'));}
});
test('complete private families never project scalar functions',async()=>{
 const array=await json('./array-owner-proof/literals.json'),request=JSON.parse(array.files['fresh-disjoint/request.json']);
 const rows=[['closure',(await json('./closure-core-publication-first.json')).defaultCore],
 ['nullable',await read('./fixtures/nullable-owned/v3/expected.core.mlir')],
 ['String',(await json('./string-core-oracle.json')).cases[0].core],
 ['Array',request.coreText],['kernel',(await json('./kernel-global-core-oracle.json')).core],
 ['exception',await read('./first-exception-core.expected.mlir')],
 ['Global',(await json('./module-callable-core-first.json')).rows[1].expectedRawCore]];
 for(const [name,input]of rows){assert.equal(typeof input,'string',name);for(const command of commands)rejected(await invokeCore(input,command));}
});
test('unchanged scalar bytecode and actual owner mode remain byte-exact consumers',async()=>{
 const old=await invokeCore(fixtures.minimal,'--emit-bytecode');accepted(old);assert.equal(old.stdout.subarray(0,8).toString('ascii'),'TSFGTBC0');assert.equal(old.stdout.readUInt32LE(8),9);
 const array=await json('./array-owner-proof/literals.json');const result=await invokeCore(array.files['fresh-disjoint/request.json'],'--array-owner-proof');accepted(result);
 assert.deepEqual(result.stdout,Buffer.from(array.files['fresh-disjoint/expected.stdout.json']));
});
