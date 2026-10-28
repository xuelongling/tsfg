// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {systemQueryFixture} from './system-query-fixtures.mjs';
import {readSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore} from '../../compiler/system-query-core.mjs';
import {compileSystemQuery} from '../../compiler/pipeline.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';

const cases=[...['architecture','aliases','duplicate','complete','wrapper-alias','loop-architecture','loop-aliases','loop-multiple','loop-shared-component','loop-inheritance'].map(name=>[name,name]),
  ['multi','../system-query-effects/multi'],...['direct','imported','local-export'].map(name=>[name,'../system-query-scalars/'+name]),
  ...['view-direct','view-imported','view-aliases','view-same-owner','view-parenthesized'].map(name=>[name,'../system-query-views/'+name])].map(([name,path])=>({name,...systemQueryFixture(path)}));
const tool=process.env.TSFG_QUERY_LLVM_EXE,output=process.env.TSFG_QUERY_LLVM_OUTPUT,enabled=Boolean(tool&&output),children=[];
const run=(name,input,command,status=0)=>{
  mkdirSync(output,{recursive:true});const prefix=output+'/'+String(children.length).padStart(3,'0')+'-'+name;
  const child=spawnSync(tool,['--system-query',command],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
  writeFileSync(prefix+'-input.txt',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name,command,pid:child.pid,status:child.status,error:child.error?.message??null,stdoutBytes:child.stdout?.length,stderr:child.stderr?.toString('utf8')});writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.equal(child.status,status,child.stderr?.toString('utf8'));assert.ifError(child.error);return child.stdout.toString('utf8');
};
// Read only printed string tokens in the real official consumer's output.
// Both MLIR and LLVM IR hex escapes are decoded; production uses their parsers.
const quoted=(text,marker)=>{
  const start=text.indexOf(marker);assert.ok(start>=0,marker);const bytes=[];
  for(let i=start+marker.length;i<text.length;i++){
    const c=text[i];if(c==='"')return {value:Buffer.from(bytes).toString('utf8'),token:text.slice(start+marker.length-1,i+1)};
    if(c==='\\'){const hex=text.slice(i+1,i+3);if(/^[0-9a-f]{2}$/i.test(hex)){bytes.push(Number.parseInt(hex,16));i+=2;}else {const escaped=text[++i];bytes.push(({n:10,r:13,t:9})[escaped]??escaped.charCodeAt(0));}}
    else {const point=text.codePointAt(i),value=String.fromCodePoint(point);bytes.push(...Buffer.from(value));i+=value.length-1;}
  }
  assert.fail('unterminated printed string');
};

test('LLVM public pipeline retains original context and factory manifest gates',{skip:!enabled},async()=>{
  const input=cases.find(row=>row.name==='view-parenthesized');
  await assert.rejects(compileSystemQuery(input.bytes,{...input.context,expectedPackageId:'sha256:'+'0'.repeat(64)},{core:tool,cpuLLVM:'ir'}),/identity|differs/);
  await assert.rejects(compileSystemQuery(input.bytes,input.context,{core:'missing',cpuLLVM:'dialect'}),/artifact-manifest|ENOENT/);
});

for(const [name,operands]of [['null-version','null, !"x"'],['null-source','!"1", null']])
test('LLVM cold metadata rejects nullable proof operands normally: '+name,{skip:!enabled},()=>{
    const ir='!tsfg.query.cpu = !{!0}\n!0 = !{'+operands+'}\n';
    assert.equal(run(name,ir,'--canonicalize-llvm-ir',3),'');
    assert.match(children.at(-1).stderr??'',/\[core-ir-query-llvm\] owned LLVM IR proof or exact Source conversion differs/);
});

for(const input of cases)test('official LLVM lowering: '+input.name,{skip:!enabled},()=>{
  const facts=readSystemQueryFacts(input.bytes,input.context),core=emitSystemQueryCore(facts,input.context),dialect=run(input.name,core,'--cpu-llvm');
  assert.ok(dialect.includes('tsfg.cpu_llvm_version = 1 : i32'));
  const batch=quoted(dialect,'tsfg.cpu_llvm_source = "').value;
  assert.ok(batch.includes('tsfg.cpu_batch_source'));assert.ok(batch.includes(facts.inputIdentity));
  assert.ok(!/^\s*(?:%[^=]+ = )?"(?:scf|arith|memref|func|tsfg)\./m.test(dialect));
  const ir=run(input.name+'-ir',dialect,'--llvm-ir'),code=ir.split('\n!')[0];
  assert.ok(ir.includes('!tsfg.query.cpu = !{'));assert.ok(ir.includes('target triple = "x86_64-pc-windows-msvc"'));
  assert.ok(!/\b(?:fadd|fsub|fmul|fdiv)\s+(?:fast|reassoc|contract|nnan|ninf|nsz|arcp|afn)\b/.test(code));
  assert.ok(!/\bnoalias\b/.test(code));
  if(['loop-shared-component','loop-inheritance','view-imported','view-parenthesized'].includes(input.name)){
    assert.equal(run(input.name+'-dialect-cold',dialect,'--canonicalize'),dialect);
    assert.equal(run(input.name+'-ir-cold',ir,'--canonicalize-llvm-ir'),ir);
  }
  if(input.name==='loop-inheritance'){assert.match(code,/add i64 [^\n]+, 8\b/);assert.match(code,/add i64 [^\n]+, 12\b/);}
  if(input.name==='view-parenthesized'){
    assert.equal(run(input.name+'-direct-ir',core,'--llvm-ir'),ir);
    const standard=run(input.name+'-batch',core,'--cpu-batch');assert.equal(run(input.name+'-from-batch',standard,'--cpu-llvm'),dialect);
    const update=facts.scalarHelpers.find(row=>row.declaration.name==='update'),scaled=facts.scalarHelpers.find(row=>row.declaration.name==='scaledX');
    const firstFunction=code.slice(code.indexOf('define '),code.indexOf('\n}',code.indexOf('define ')));
    const events=firstFunction.split('\n').flatMap(line=>line.includes('call float @batch_helper_'+update.id.slice(7))?['update']:line.includes('call float @batch_helper_'+scaled.id.slice(7))?['scaledX']:/\bstore float\b/.test(line)?['store']:/\bload float\b/.test(line)?['load']:[]);
    assert.deepEqual(events,['update','store','load','scaledX','store']);
  }
});

test('LLVM dialect and LLVM IR cold consumers bind real Source and actual instructions',{skip:!enabled},()=>{
  const input=cases.find(row=>row.name==='view-parenthesized'),facts=readSystemQueryFacts(input.bytes,input.context),dialect=run('bad-base',emitSystemQueryCore(facts,input.context),'--cpu-llvm'),ir=run('bad-base-ir',dialect,'--llvm-ir');
  const source=quoted(dialect,'tsfg.cpu_llvm_source = "'),wrongSource=source.value.replace('tsfg_core.input_identity = "sha256:','tsfg_core.input_identity = "sha256:0');
  const dialectVariants=[['dialect-version',dialect.replace('tsfg.cpu_llvm_version = 1 : i32','tsfg.cpu_llvm_version = 2 : i32')],
    ['dialect-operation',dialect.replace('"llvm.fmul"','"llvm.fadd"')],
    ['dialect-source',dialect.replace('tsfg.cpu_llvm_source = '+source.token,'tsfg.cpu_llvm_source = '+coreQuote(wrongSource))]];
  for(const [name,bad]of dialectVariants){assert.notEqual(bad,dialect,name);assert.equal(run(name,bad,'--canonicalize',3),'');}
  const metadata=quoted(ir,'!{!"1", !"');
  const irQuote=value=>'"'+[...Buffer.from(value)].map(byte=>byte>=32&&byte<=126&&byte!==34&&byte!==92?String.fromCharCode(byte):'\\'+byte.toString(16).padStart(2,'0').toUpperCase()).join('')+'"';
  const wrongIRSource=metadata.value.replace('tsfg_core.input_identity = "sha256:','tsfg_core.input_identity = "sha256:0');
  const wrongAnchor=metadata.value.replace(/tsfg_source.start = (\d+)/,(_,n)=>'tsfg_source.start = '+(Number(n)+1));
  const definition=ir.split('\n').find(line=>line.startsWith('define ')&&line.includes('ptr %'));
  const irVariants=[['ir-version',ir.replace('!{!"1", !"','!{!"2", !"')],['ir-source',ir.replace('!{!"1", !'+metadata.token,'!{!"1", !'+irQuote(wrongIRSource))],
    ['ir-layout',ir.replace('-i64:64-','-i64:32-')],['ir-operation',ir.replace('fmul float','fadd float')],['ir-fastmath',ir.replace('fmul float','fmul fast float')],
    ['ir-address',ir.replace(/(add i64 [^\n]+, )4\b/,(_,prefix)=>prefix+'8')],['ir-noalias',ir.replace(definition,definition.replace('ptr %','ptr noalias %'))],
    ['ir-source-anchor',ir.replace('!{!"1", !'+metadata.token,'!{!"1", !'+irQuote(wrongAnchor))]];
  for(const [name,bad]of irVariants){assert.notEqual(bad,ir,name);assert.equal(run(name,bad,'--canonicalize-llvm-ir',3),'');}
  const imported=cases.find(row=>row.name==='imported'),importFacts=readSystemQueryFacts(imported.bytes,imported.context);
  const callIR=run('call-base',emitSystemQueryCore(importFacts,imported.context),'--llvm-ir');
  const scaled=importFacts.scalarHelpers.find(row=>row.declaration.name==='scaled'),multiply=importFacts.scalarHelpers.find(row=>row.declaration.name==='multiply');
  assert.deepEqual(scaled.parameters.map(parameter=>parameter.logicalType),multiply.parameters.map(parameter=>parameter.logicalType));
  const badCall=callIR.replace('call float @batch_helper_'+scaled.id.slice(7),'call float @batch_helper_'+multiply.id.slice(7));
  assert.notEqual(badCall,callIR);assert.equal(run('ir-same-signature-callee',badCall,'--canonicalize-llvm-ir',3),'');
});
