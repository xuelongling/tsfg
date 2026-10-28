// SPDX-License-Identifier: MIT
// Complete original producer fixtures; static IR/effects checks never run a row.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {systemQueryFixture} from './system-query-fixtures.mjs';
import {readSystemQueryFacts,printSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore} from '../../compiler/system-query-core.mjs';
import {readSystemQueryEffects} from '../../compiler/system-query-effects.mjs';
import {readSystemQueryTmeta} from '../../compiler/system-query-tmeta.mjs';
import {compileSystemQuery} from '../../compiler/pipeline.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';

const samples=['f32','f64'].flatMap(width=>['','-literal','-view','-imported','-same-owner'].map(suffix=>({width,name:'locals-'+width+suffix,...systemQueryFixture('../system-query-locals/locals-'+width+suffix)})));
const tool=process.env.TSFG_QUERY_LOCALS_EXE,output=process.env.TSFG_QUERY_LOCALS_OUTPUT,enabled=Boolean(tool&&output),children=[];
const anchor=range=>'tsfg_source.start = '+range.start+' : i64, tsfg_source.end = '+range.end+' : i64';
const run=(name,input,command='--canonicalize',status=0)=>{
  mkdirSync(output,{recursive:true});const prefix=output+'/'+String(children.length).padStart(3,'0')+'-'+name;
  const child=spawnSync(tool,['--system-query',command],{input,windowsHide:true,maxBuffer:16777216,timeout:60000});
  writeFileSync(prefix+'-input.raw',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name,command,pid:child.pid,status:child.status,error:child.error?.message??null});writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.ifError(child.error);assert.equal(child.status,status,child.stderr?.toString('utf8'));if(status!==0)assert.equal(child.stdout.length,0);return child.stdout.toString('utf8');
};

for(const input of samples)test('original '+input.name+' owns initialized locals and SSA snapshots',()=>{
  const facts=readSystemQueryFacts(input.bytes,input.context),loop=facts.systems[0].loops[0],core=emitSystemQueryCore(facts,input.context),lines=core.split('\n').slice(1);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);assert.deepEqual(facts.program,input.packet.payload.program);assert.deepEqual(facts.nodes,input.packet.payload.nodes);
  assert.equal(facts.format.version,6);assert.ok(loop.localBindings.length>=2);assert.ok(facts.scalarHelpers.every(helper=>helper.bindings.length>=2&&helper.statements.at(-1).kind==='return'));
  assert.equal(lines.filter(line=>line.includes('"func.call"')).length,1,'initializer helper executes once in emitted control flow');
  if(input.name.endsWith('literal')){
    const expected=input.width==='f32'?['3f800000','80000000','3c4ccccd','7f7fffff','00000001']:['3ff0000000000000','8000000000000000','3f8999999999999a','7fefffffffffffff','0000000000000001'];
    assert.deepEqual(loop.statements.slice(0,5).map(statement=>statement.initializer.bits),expected);
    assert.equal(lines.filter(line=>line.includes('"tsfg_core.constant"')).length,8);
  }else{
    const snapshot=loop.statements[0],old=lines.find(line=>line.includes('"tsfg.field_load"')&&line.includes(anchor(snapshot.initializer.range))).match(/(%\w+) =/)[1];
    const retained=loop.statements.find(statement=>statement.value?.kind==='fieldAssignment'&&statement.value.value.kind==='bindingReference'&&statement.value.value.binding===snapshot.binding);
    const store=lines.find(line=>line.includes('"tsfg.field_store"')&&line.includes(anchor(retained.value.range)));
    assert.ok(store.includes(', '+old+')'),'snapshot retains the SSA load before later column writes');
    if(input.name.endsWith('view')||input.name.endsWith('imported')||input.name.endsWith('same-owner')){
      const call=lines.find(line=>line.includes('"func.call"')).match(/(%\w+) =/)[1];
      const sum=loop.statements.find(statement=>statement.value?.value?.kind==='binary'&&statement.value.value.left.binding===loop.statements[1].binding).value.value;
      assert.ok(lines.find(line=>line.includes('"tsfg_core.add"')&&line.includes(anchor(sum.range))).includes('('+call+', '+call+')'));
    }
  }
});

/** @type {[string,(packet:ReturnType<typeof systemQueryFixture>['packet'])=>void][]} */
const mutations=[
  ['wrong declaration identity',packet=>{packet.payload.systems[0].loops[0].localBindings[0].id='sha256:'+'0'.repeat(64);}],
  ['foreign owner',packet=>{packet.payload.systems[0].loops[0].localBindings[0].lexicalOwner=packet.payload.scalarHelpers[0].id;}],
  ['wrong binding',packet=>{packet.payload.systems[0].loops[0].statements[3].value.value.binding=packet.payload.systems[0].loops[0].localBindings[1].id;}],
  ['const writable',packet=>{packet.payload.systems[0].loops[0].localBindings[0].writable=true;}],
  ['initializer range',packet=>{packet.payload.systems[0].loops[0].statements[0].initializer.range.start++;}],
  ['missing declaration',packet=>{packet.payload.systems[0].loops[0].localBindings.pop();}],
  ['duplicate declaration',packet=>{packet.payload.systems[0].loops[0].localBindings.push(structuredClone(packet.payload.systems[0].loops[0].localBindings[0]));}],
  ['reordered directory',packet=>{packet.payload.systems[0].loops[0].localBindings.reverse();}],
  ['foreign helper local',packet=>{packet.payload.systems[0].loops[0].statements[0].initializer.binding=packet.payload.scalarHelpers[0].bindings[0].id;packet.payload.systems[0].loops[0].statements[0].initializer.kind='bindingReference';delete packet.payload.systems[0].loops[0].statements[0].initializer.receiver;delete packet.payload.systems[0].loops[0].statements[0].initializer.property;delete packet.payload.systems[0].loops[0].statements[0].initializer.nameRange;}],
  ['local width',packet=>{packet.payload.systems[0].loops[0].localBindings[1].declaredType='f64';}],
  ['helper missing return',packet=>{packet.payload.scalarHelpers[0].statements.pop();}],
  ['reordered initialization',packet=>{packet.payload.systems[0].loops[0].statements.reverse();}]
];
const rehash=packet=>{packet.packageId=sha256('tsfg.system-query.package.v6\0'+packet.schemaHash+'\0'+canonical(packet.payload));return Buffer.from(canonical(packet)+'\n');};
for(const [name,mutate]of mutations)test('owning boundary rejects rehashed local '+name,()=>{
  const input=samples[0],packet=structuredClone(input.packet);mutate(packet);const bytes=rehash(packet);
  assert.throws(()=>readSystemQueryFacts(bytes,{...input.context,expectedPackageId:packet.packageId}));
});
test('literal bits, width and original Source token remain independently owned',()=>{
  const input=samples.find(input=>input.name==='locals-f32-literal');
  for(const change of ['bits','width','token','inferred-narrowing']){
    const packet=structuredClone(input.packet),literal=packet.payload.systems[0].loops[0].statements[0].initializer;
    if(change==='inferred-narrowing'){const loop=packet.payload.systems[0].loops[0];loop.localBindings[5].declaredType='f32';Object.assign(loop.statements[5].initializer,{type:'f32',flowType:'f32',bits:'3c4ccccd'});}
    else if(change==='bits')literal.bits='00000000';else if(change==='width')literal.type=literal.flowType='f64';else literal.token='2';
    const bytes=rehash(packet);assert.throws(()=>readSystemQueryFacts(bytes,{...input.context,expectedPackageId:packet.packageId}));
  }
});
test('retired private Query v5 request, context and package are refused',()=>{
  const input=samples[0],packet=structuredClone(input.packet);packet.version=5;
  assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),input.context));
  assert.throws(()=>readSystemQueryFacts(input.bytes,{...input.context,version:5}));
  const request=JSON.parse(input.context.requestBytes.toString('utf8'));request.version=5;
  assert.throws(()=>readSystemQueryFacts(input.bytes,{...input.context,requestBytes:Buffer.from(canonical(request)+'\n')}));
});

for(const input of samples)test('static '+input.name+' passes original C++ effects/batch/LLVM/cold/tmeta',{skip:!enabled},()=>{
  const facts=readSystemQueryFacts(input.bytes,input.context),core=run(input.name+'-bind',emitSystemQueryCore(facts,input.context));
  const effects=readSystemQueryEffects(Buffer.from(run(input.name+'-effects',core,'--effects')),facts,input.context);
  const cpuBatch=run(input.name+'-batch',core,'--cpu-batch'),cpuLLVM=run(input.name+'-llvm',cpuBatch,'--llvm-ir');
  const tmeta=readSystemQueryTmeta(Buffer.from(run(input.name+'-metadata',cpuBatch,'--tmeta')),facts,input.context,cpuBatch),result={facts,core,effects,cpuBatch,cpuLLVM,tmeta};
  mkdirSync(output,{recursive:true});for(const [suffix,bytes]of [['core.mlir',result.core],['batch.mlir',result.cpuBatch],['ll',result.cpuLLVM],['tmeta',canonical(result.tmeta.envelope)+'\n']])writeFileSync(output+'/'+input.name+'.'+suffix,bytes);
  const kinds=input.name.endsWith('literal')?['write','read','read','write']:input.name==='locals-'+input.width?['read','read','write','read','write','write','read','read','write']:['read','read','read','write','write','write','write','read','read','write'];
  assert.deepEqual(result.effects.systems[0].loops[0].operations.map(operation=>operation.kind),kinds);
  assert.equal(result.effects.systems[0].calls.length,1);assert.deepEqual(result.effects.conflicts,[]);assert.equal(result.tmeta.envelope.version,2);
  assert.ok(!/\b(?:fadd|fsub|fmul|fdiv)\s+(?:fast|reassoc|contract|nnan|ninf|nsz|arcp|afn)\b/.test(result.cpuLLVM));
  assert.ok(result.cpuBatch.includes('memref<1x'+input.width+'>'));
  assert.equal(run(input.name+'-cold-core',result.core),result.core);
  assert.equal(run(input.name+'-cold-batch',result.cpuBatch),result.cpuBatch);
  assert.equal(run(input.name+'-cold-llvm',result.cpuLLVM,'--canonicalize-llvm-ir'),result.cpuLLVM);
  assert.equal(run(input.name+'-cold-tmeta',canonical(result.tmeta.envelope)+'\n','--canonicalize-tmeta'),canonical(result.tmeta.envelope)+'\n');
});
const formal=process.env.TSFG_QUERY_LOCALS_FORMAL_EXE;
for(const input of samples)test('source-built public pipeline admits '+input.name,{skip:!formal},async()=>{
  const result=await compileSystemQuery(input.bytes,input.context,{core:formal,effects:true,cpuBatch:true,cpuLLVM:'ir',tmeta:true});
  assert.equal(result.status,'ok');assert.equal(result.tmeta.envelope.version,2);assert.equal(result.effects.systems[0].calls.length,1);
});
test('independent original C++ rejects rehashed local facts and stale snapshot SSA',{skip:!enabled},()=>{
  const input=samples[0],facts=readSystemQueryFacts(input.bytes,input.context),core=emitSystemQueryCore(facts,input.context);
  for(const [name,mutate]of mutations){const packet=structuredClone(input.packet);mutate(packet);rehash(packet);const bad=core.replace(coreQuote(canonical(input.packet)),coreQuote(canonical(packet)));assert.notEqual(bad,core);run('forged-'+name,bad,'--canonicalize',3);}
  const loop=facts.systems[0].loops[0],snapshot=loop.statements[0],retained=loop.statements[6].value;
  const line=core.split('\n').find(line=>line.includes('"tsfg.field_store"')&&line.includes(anchor(retained.range))),old=core.split('\n').find(line=>line.includes('"tsfg.field_load"')&&line.includes(anchor(snapshot.initializer.range))).match(/(%\w+) =/)[1];
  const bad=core.replace(line,line.replace(', '+old+')',', %arg1)'));assert.notEqual(bad,core);run('stale-snapshot',bad,'--canonicalize',3);
});
for(const width of ['f32','f64'])test('independent C++ retains '+width+' literal defaults, exact bits and finite Source boundary',{skip:!enabled},()=>{
  const input=samples.find(sample=>sample.name==='locals-'+width+'-literal'),facts=readSystemQueryFacts(input.bytes,input.context),core=emitSystemQueryCore(facts,input.context);
  for(const change of ['bits','token','inferred-narrowing']){
    const packet=structuredClone(input.packet),loop=packet.payload.systems[0].loops[0];
    if(change==='bits')loop.statements[2].initializer.bits='0'.repeat(width==='f32'?8:16);
    else if(change==='token')loop.statements[2].initializer.token='2';
    else{loop.localBindings[5].declaredType='f32';Object.assign(loop.statements[5].initializer,{type:'f32',flowType:'f32',bits:'3c4ccccd'});}
    rehash(packet);run(width+'-'+change,core.replace(coreQuote(canonical(input.packet)),coreQuote(canonical(packet))),'--canonicalize',3);
  }
  // This is a deliberately malformed, whole-rehashed packet, never claimed as
  // producer output. Its original Source AST shape/ranges remain unchanged.
  const packet=structuredClone(input.packet),request=JSON.parse(input.context.requestBytes.toString('utf8')),literal=packet.payload.systems[0].loops[0].statements[2].initializer,file=packet.payload.program.files.find(file=>file.path==='/src/main.ts'),source=request.input.files.find(source=>source.path===file.path),token=width==='f32'?'1.0e+40':'1.0e400';
  const oldHash=file.sha256;assert.equal(token.length,literal.range.end-literal.range.start);
  file.content=file.content.slice(0,literal.range.start)+token+file.content.slice(literal.range.end);file.sha256=sha256(file.content).slice(7);source.content=file.content;source.sha256=file.sha256;
  for(const type of packet.payload.types)if(type.nominalKey)type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({files:packet.payload.program.files.map(({path,sha256})=>({path,sha256})),nominalKey:type.nominalKey}));
  literal.token=token;literal.bits=width==='f32'?'7f800000':'7ff0000000000000';packet.requestId=sha256('tsfg.system-query.request.v6\0'+canonical(request)+'\n');rehash(packet);
  assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),{...input.context,requestBytes:Buffer.from(canonical(request)+'\n'),expectedPackageId:packet.packageId}));
  const changed=core.replace(coreQuote(canonical(input.packet)),coreQuote(canonical(packet))).replace(coreQuote(input.context.requestBytes.toString('utf8').trimEnd()),coreQuote(canonical(request))).replace('tsfg_core.input_identity = '+coreQuote(facts.inputIdentity),'tsfg_core.input_identity = '+coreQuote(packet.requestId)).replace('tsfg_core.source_hash = '+coreQuote('sha256:'+oldHash),'tsfg_core.source_hash = '+coreQuote('sha256:'+file.sha256));
  const line=changed.split('\n').find(line=>line.includes('"tsfg_core.constant"')&&line.includes(anchor(literal.range)));
  const bad=changed.replace(line,line.replace(/value = "[0-9a-f]+"/,'value = '+coreQuote(literal.bits)));run(width+'-overflow',bad,'--canonicalize',3);
  assert.match(readFileSync(output+'/'+String(children.length-1).padStart(3,'0')+'-'+width+'-overflow-stderr.raw','utf8'),/finite floating-point value/);
});
test('current runtime Query goldens retain independently checked static identities and effects',{skip:!enabled},()=>{
  const oracle=JSON.parse(readFileSync(new URL('../../runtime/jobs/testdata/query-effects-expected.json',import.meta.url),'utf8'));
  for(const name of ['multi','multiple','shared','double-loop']){
    const bytes=readFileSync(new URL('../../runtime/jobs/testdata/query-effects-'+name+'.tmeta',import.meta.url)),envelope=JSON.parse(bytes.toString('utf8')),payload=JSON.parse(envelope.payload),packet=JSON.parse(payload.sourcePacket),context={family:'tsfg.system-query-context-candidate',version:6,requestBytes:Buffer.from(payload.sourceRequest),expectedPackageId:packet.packageId};
    const facts=readSystemQueryFacts(Buffer.from(payload.sourcePacket),context),checked=readSystemQueryTmeta(bytes,facts,context,payload.batch),row=oracle.cases.find(row=>row.name===name);
    assert.deepEqual(checked.payload.effectsHash,row.effectsHash);assert.deepEqual(JSON.parse(checked.payload.effects),row.expectedEffects);
    assert.equal(run('runtime-'+name,bytes,'--canonicalize-tmeta'),bytes.toString('utf8'));
  }
});
