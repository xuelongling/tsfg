// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {whole,complete,table,unsupported,oracle} from './strict-floating-aot-fixtures.mjs';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
import {checkCompilerGraph,instructions} from './aot-compiler-llvm.mjs';
import {readCompilerCoff} from './aot-compiler-coff.mjs';
const kinds=['none','i32','bool','i8','i16','i64','u8','u16','u32','u64','isize','usize','f32','f64'];
const signatures=functions=>functions.map(f=>({parameters:f.parameters.map(p=>kinds.indexOf(p)),result:kinds.indexOf(f.result)}));
const bodies=text=>new Map([...text.matchAll(/^define (?:internal )?(?:float|double|i\d+) @([a-zA-Z0-9_]+)\([^\n]*\)(?: #\d+)? \{\n([\s\S]*?)^\}/gm)].map(m=>[m[1],m[2]]));
function coff(bytes,count){const object=readCompilerCoff(bytes);assert.equal(object.timestamp,0);for(let i=0;i<count;i++)assert.ok(object.symbols.some(s=>s.name==='native_'+i&&s.section>0));assert.equal(object.stackmaps.frames.length,count+1);assert.ok(!object.symbols.some(s=>s.section===0&&/^(fmod|fmodf|remainder|_?fltused|__.*sf3|__.*df3)$/.test(s.name)),'no undeclared floating CRT/libm dependency');return object;}
test('complete ordinary AOT retains f32/f64 parameters, results and every arithmetic definition',async()=>{
 accepted(await invokeCore(whole.input));
 const ir=await invokeCore(whole.input,'--emit-native-llvm');accepted(ir);const text=ir.stdout.toString('utf8'),functions=bodies(text);
 assert.equal([...functions.keys()].filter(k=>k.startsWith('native_')).length,whole.functions.length);
 for(const t of ['f32','f64']){
  for(const op of ['add','sub','mul','div']){const body=functions.get('tsfg_aot_'+t+'_'+op);assert.ok(body);assert.match(body,new RegExp('@llvm.experimental.constrained.f'+op+'\\.'+t+'\\('));assert.match(body,/metadata !"round.tonearest", metadata !"fpexcept.ignore"/);assert.match(body,/icmp ugt/);assert.match(body,/select i1/);}
  for(const op of ['pos','neg']){const body=functions.get('tsfg_aot_'+t+'_'+op);assert.match(body,/icmp ugt/);assert.match(body,/select i1/);assert.ok(!/\b(?:fadd|fsub|fmul|fdiv|fneg)\b/.test(body));}
  const remainder=functions.get('tsfg_aot_'+t+'_rem');assert.match(remainder,/normalize_x:/);assert.match(remainder,/normalize_y:/);assert.match(remainder,/divide:/);assert.match(remainder,/subnormal:/);assert.ok(!/\b(?:fdiv|frem|sdiv|udiv|srem|urem)\b/.test(remainder));
 }
 assert.ok(!/\b(?:fast|reassoc|contract|afn|nnan|ninf|nsz|arcp|fma|fmuladd|fpext|fptrunc)\b/.test(text));
 const object=await invokeCore(whole.input,'--emit-native-object');accepted(object);coff(object.stdout,whole.functions.length);
});
test('complete mixed module preserves108 comparisons, raw payload constants, calls, recursive CFG and64 parameters',async()=>{
 accepted(await invokeCore(complete.input));
 const result=await invokeCore(complete.input,'--emit-native-llvm');accepted(result);const text=result.stdout.toString('utf8');
 const graph=checkCompilerGraph(text,{nativeFunctions:complete.functions.length,signatures:signatures(complete.functions),allowElidedEvents:true});
 for(const [index,source]of complete.functions.entries()){
  const fn=graph.native[index];assert.ok(fn);
  if(source.name.startsWith('relay64_')){assert.equal(fn.args.length,66);assert.equal(fn.calls.length,1);assert.equal(fn.calls[0].args.split(', ').length,66);}
  if(source.name.startsWith('recursive_'))assert.equal(fn.calls[0].callee,index);
  if(source.name.startsWith('parallel_phi_'))assert.ok(instructions(fn).some(op=>op.rhs.startsWith('phi ')));
 }
 const functions=bodies(text);
 for(const t of ['f32','f64'])for(const [op,predicate]of Object.entries({eq:'oeq',ne:'une',lt:'olt',le:'ole',gt:'ogt',ge:'oge'}))assert.match(functions.get('tsfg_aot_'+t+'_'+op),new RegExp('@llvm.experimental.constrained.fcmp\\.'+t+'\\([^\\n]+metadata !"'+predicate+'", metadata !"fpexcept.ignore"'));
 for(const fn of [...graph.native,graph.wrapper]){
  const ops=instructions(fn);assert.ok(ops.some(op=>op.rhs==='call void @llvm.x86.sse.stmxcsr(ptr %caller_mxcsr)'));
  assert.ok(ops.some(op=>op.rhs.includes('asm sideeffect "fnstcw ($0)"')));
  for(const ret of ops.filter(op=>op.rhs.startsWith('ret '))){const block=fn.blocks.get(ret.block);assert.match(block.instructions[ret.index-1].rhs,/asm sideeffect "fldcw \(\$0\)".*%caller_x87/);assert.equal(block.instructions[ret.index-2].rhs,'call void @llvm.x86.sse.ldmxcsr(ptr %caller_mxcsr)');}
  for(const event of fn.events){const block=fn.blocks.get(event.block);assert.match(block.instructions[event.index+1].rhs,/@llvm.x86.sse.ldmxcsr\(ptr %strict_mxcsr\)/);assert.match(block.instructions[event.index+2].rhs,/fldcw.*%strict_x87/);}
 }
 const object=await invokeCore(complete.input,'--emit-native-object');accepted(object);coff(object.stdout,complete.functions.length);
 // The frozen mathematical expectations are retained as proof inputs. These
 // compiler checks deliberately do not interpret IR or claim guest execution.
 assert.equal(oracle.arithmeticCases.length,136);assert.equal(oracle.comparisonCases.length*6,108);assert.equal(oracle.rawTransportCases.length,16);
});
test('all512 alternating f32/f64 functions survive both ordinary outputs',async()=>{
 const input=table(512).input;accepted(await invokeCore(input));const ir=await invokeCore(input,'--emit-native-llvm');accepted(ir);assert.equal([...ir.stdout.toString('utf8').matchAll(/^define (?:float|double) @native_\d+\(/gm)].length,512);const object=await invokeCore(input,'--emit-native-object');accepted(object);coff(object.stdout,512);
});
for(const [name,input]of [['513 definitions',table(513).input],['one unsupported String function after valid floats',unsupported.input]])test('whole-module refusal for '+name,async()=>{
 if(name.startsWith('one unsupported'))accepted(await invokeCore(input));
 for(const command of ['--emit-native-llvm','--emit-native-object']){const r=await invokeCore(input,command);assert.equal(r.close.code,3,r.stderr.toString('utf8'));assert.equal(r.stdout.length,0);if(name.startsWith('one unsupported'))assert.match(r.stderr.toString('utf8'),/r07-native-capability/);}
});
