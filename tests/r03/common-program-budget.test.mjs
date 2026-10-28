// SPDX-License-Identifier: MIT
// Private low-budget probes do not represent Source/Runtime execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {selectCommonCarriers} from '../../compiler/common-program-carriers.mjs';
import {printCommonFunction} from '../../compiler/common-program-print.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication,commonProgramPublicationScope} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {coreExchangeFormat} from '../../compiler/core-ssa-emitter.mjs';
import {commonCollections,commonSortedSubset,commonTextBudget} from '../../compiler/common-program-budget.mjs';
import {commonReferenceBodyModel} from './common-program-model-cases.mjs';
const limit=/** @param {any} e */e=>e.code==='r03-common-program-limit';
async function program(name){
  const bytes=await fs.readFile(new URL('./common-program-'+name+'.json',import.meta.url)),facts=readCommonProgramFacts(bytes);
  return buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId});
}
test('abstract key charges before reading a nontrivial actual set',()=>{
  let iterated=false;const tags=new Set(['a','b','c']),original=tags[Symbol.iterator].bind(tags);
  tags[Symbol.iterator]=()=>{iterated=true;return original();};
  const a=commonAbstract({types:new Map(),spend:commonMeter(2)}),value={tags,refs:new Set(),cells:new Set(),pairs:new Map(),truth:0,unknown:false,number:null};
  assert.throws(()=>a.key(value),limit);assert.equal(iterated,false);
});
test('inherited field collection pays for members before copying them',()=>{
  let read=false;const fields=new Proxy(Array.from({length:8},()=>({id:'f'})),{get(target,key,receiver){if(key==='0')read=true;return Reflect.get(target,key,receiver);}});
  const a=commonAbstract({types:new Map([['t',{id:'t',kind:'reference',fields}]]),spend:commonMeter(2)});
  assert.throws(()=>a.fields('t'),limit);assert.equal(read,false);
});
test('stable publication scope pays for its input catalogue before copying',()=>{
  let read=false;const types=new Proxy(Array.from({length:8},(_,i)=>({id:'t'+i,kind:'scalar'})),{get(target,key,receiver){if(key==='0')read=true;return Reflect.get(target,key,receiver);}});
  const model={types,environments:[],globals:[],functions:[],modules:[],closure:{roots:[],requiredRoots:[]}};
  assert.throws(()=>commonProgramPublicationScope(model,commonMeter(2)),limit);assert.equal(read,false);
});
test('carrier alternative bound is checked before a tags snapshot',()=>{
  let iterated=false;const tags=new Set(Array.from({length:257},(_,i)=>'t'+i)),original=tags[Symbol.iterator].bind(tags);tags[Symbol.iterator]=()=>{iterated=true;return original();};
  const empty=()=>({tags:new Set(),unknown:false}),a={empty,merge(to,from){to.tags=from.tags;},copy:v=>v};
  const model={types:new Map(),bindings:new Map([['field',{role:'field',type:'t'}]]),spend:commonMeter(1),payload:'payload:unit'},values={abstract:a,
    fieldSeeds:new Map([['field',{tags,unknown:false}]]),globalSeeds:new Map(),elementSeeds:new Map(),capacity:{observed:new Map(),contexts:new Map()}};
  assert.throws(()=>selectCommonCarriers({model,plans:[]},values),limit);assert.equal(iterated,false);
});
test('function printing refuses a small aggregate text cap before returning text',async()=>{
  const physical=commonProgramPhysical(await program('positive')),model={...physical.model,limits:{...physical.model.limits,bytes:64}};
  assert.throws(()=>printCommonFunction(physical.plans[0],model,physical.carriers),limit);
});
test('map scope snapshots and complete carrier records pay before allocation',()=>{
  let iterated=false;const source=new Map([['a',1],['b',2],['c',3]]),original=source[Symbol.iterator].bind(source);
  source[Symbol.iterator]=()=>{iterated=true;return original();};
  assert.throws(()=>commonCollections(commonMeter(2)).map(source),limit);assert.equal(iterated,false);
  const {program:unit,values}=commonReferenceBodyModel(3),old=unit.model.spend;let remaining=1000000;
  unit.model.spend=(amount=1)=>{if(amount>remaining)throw Object.assign(new TypeError('bounded unit'),{code:'r03-common-program-limit'});remaining-=amount;old(amount);};
  const carriers=selectCommonCarriers(unit,values);remaining=1;assert.throws(()=>carriers.record(),limit);
});
test('sorted global subset has bounded linear comparisons',()=>{
  const all=Array.from({length:4096},(_,i)=>String(i).padStart(4,'0'));let work=0;
  assert.equal(commonSortedSubset(all,all,(n=1)=>{work+=n;}),true);assert.ok(work<=4*all.length);
  assert.equal(commonSortedSubset(['9999'],all,commonMeter(5000)),false);
  assert.throws(()=>commonSortedSubset(['9999'],all,commonMeter(2)),limit);
});
test('aggregate text and escaped fragments fail atomically before final join',()=>{
  const exact=commonTextBudget(commonMeter(1000),12),quoted=exact.quote('😀\r\0');assert.equal(Buffer.byteLength(quoted),12);exact.append(quoted);assert.equal(exact.finish(),quoted);
  const text=commonTextBudget(commonMeter(1000),12);text.append('123456');assert.throws(()=>text.append('7890123'),limit);assert.throws(()=>text.finish(),limit);
  const fragment=commonTextBudget(commonMeter(1000),8);assert.throws(()=>fragment.combine(['12345','6789']),limit);assert.throws(()=>fragment.finish(),limit);
});
for(const name of ['positive','mixed'])test('common module carries the ordinary nine-field Core header from its real root: '+name,async()=>{
  const hir=await program(name),publication=createCommonProgramPublication(hir),request={targets:hir.closure.roots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()},text=commonProgramCore(hir,publication,request).text;
  const source=hir.sources.find(s=>s.path===hir.rootFile),strings={version:coreExchangeFormat.version,input_identity:hir.inputIdentity,source_hash:source.hash,
    source_path:source.path,target:hir.target.target,triple:hir.target.triple,data_layout:hir.target.llvmDataLayout,bytecode_schema:coreExchangeFormat.bytecodeSchema};
  for(const [key,value]of Object.entries(strings))assert.ok(text.includes('tsfg_core.'+key+' = '+JSON.stringify(value)),key);
  assert.ok(text.includes('tsfg_core.source_length = '+source.content.length+' : i64'));
});

test('repeated real TypeId quoting reuses escaped output within the original work cap',()=>{
  const id='sha256:'+'a'.repeat(64),writer=commonTextBudget(commonMeter(9000),50000),quoted=JSON.stringify(id);
  for(let i=0;i<100;i++)writer.line(writer.quote(id));
  assert.equal(writer.finish(),Array(100).fill(quoted+'\n').join(''));
});
test('quote cache keeps every lookup paid, including repeated empty strings',()=>{
  const writer=commonTextBudget(commonMeter(5));let completed=0;
  assert.throws(()=>{for(let i=0;i<20;i++){writer.quote('');completed++;}},limit);
  assert.ok(completed>0&&completed<20);assert.throws(()=>writer.finish(),limit);
});
test('first quote prepays input and escape expansion and each writer owns its cache',()=>{
  let charged=0;const text='x\n',writer=commonTextBudget(n=>{charged+=n;});writer.quote(text);
  assert.ok(charged>=text.length+Buffer.byteLength(JSON.stringify(text)));
  assert.throws(()=>commonTextBudget(commonMeter(1)).quote(text),limit);
});
test('cached escaped text still checks remaining bytes and terminal state',()=>{
  const writer=commonTextBudget(commonMeter(1000),12),q=writer.quote('😀\r\0');assert.equal(writer.quote('😀\r\0'),q);writer.append(q);
  assert.throws(()=>writer.quote('😀\r\0'),limit);assert.throws(()=>writer.finish(),limit);
  const done=commonTextBudget(commonMeter(1000));done.append(done.quote('x'));assert.equal(done.finish(),'"x"');assert.throws(()=>done.quote('x'),limit);
});
