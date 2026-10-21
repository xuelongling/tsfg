// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fn,ret,type,moduleOf} from './strict-floating-aot-fixtures.mjs';
import {accepted,invokeCore,rejected} from './generic-core-package-capture.mjs';
import {readConversions} from './conversions-wire-reader.mjs';
const registry=JSON.parse(readFileSync(new URL('../../contracts/registry.json',import.meta.url),'utf8'));
const current=input=>input.replaceAll('0.10.0',registry['tsfg.bytecode'].semver)
 .replaceAll('sha256:834206c45eaf6a1c47fa481970869e87c5badfa631af039576cb97e34fcac6ac',registry['tsfg.bytecode'].schemaHash);
const conversion=(mode,from,to)=>'%r = "tsfg_core.'+mode+'"(%a0) {tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : ('+type(from)+') -> '+type(to);
const module=(mode,from,to)=>current(moduleOf([fn('convert',[from],to,conversion(mode,from,to)+'\n'+ret('%r',to))]).input);

test('complete 286 nominal conversion entries retain canonical roundtrip and exact wire records',async()=>{
 const entries=JSON.parse(readFileSync(new URL('../../contracts/conversion-entries.json',import.meta.url),'utf8')).entries;
 const functions=entries.map(e=>fn(e.name,[e.from],e.to,conversion(e.mode==='reinterpret'?'reinterpret':'convert_'+e.mode,e.from,e.to)+'\n'+ret('%r',e.to)));
 assert.equal(functions.length,286);
 const input=current(moduleOf(functions).input),first=await invokeCore(input);accepted(first);
 const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(second.stdout,first.stdout);
 const packet=await invokeCore(input,'--emit-bytecode');accepted(packet);
 readConversions(packet.stdout,entries,registry['tsfg.bytecode'].schemaHash);
 for(const command of ['--emit-native-llvm','--emit-native-object'])accepted(await invokeCore(input,command));
});

test('ordinary complete Core accepts checked conversions and emits a guarded LLVM consumer',async()=>{
 const input=module('convert_checked','f64','u64');
 accepted(await invokeCore(input));
 const llvm=await invokeCore(input,'--emit-native-llvm');accepted(llvm);
 const text=llvm.stdout.toString('utf8');
 assert.match(text,/define internal \{ i64, i32 \} @tsfg_aot_convert_40_13_9/);
 assert.match(text,/call \{ i64, i32 \} @tsfg_aot_convert_40_13_9/);
 assert.ok(!/\bfptosi\b|\bfptoui\b/.test(text),'checked conversion must not speculate poison-producing FP casts');
 const object=await invokeCore(input,'--emit-native-object');accepted(object);
 assert.ok(object.stdout.length>100);
});

test('formal conversion verifier rejects bool, floating wrap and unequal-width reinterpret',async()=>{
 for(const [mode,from,to]of [['convert_checked','bool','i32'],['convert_wrap','f32','i32'],['reinterpret','f32','i64']])
  for(const command of ['--canonicalize','--emit-bytecode','--emit-native-llvm'])rejected(await invokeCore(module(mode,from,to),command));
});

test('conversion Core rejects old or mixed identity and extra attributes before publication',async()=>{
 const input=module('convert_checked','f64','u64');
 for(const bad of [input.replace('0.11.0','0.10.0'),input.replace(registry['tsfg.bytecode'].schemaHash,'sha256:'+'0'.repeat(64)),input.replace('tsfg_source.start = 10','unexpected = 1 : i32, tsfg_source.start = 10')])
  for(const command of ['--canonicalize','--emit-bytecode','--emit-native-llvm','--emit-native-object'])rejected(await invokeCore(bad,command));
});
