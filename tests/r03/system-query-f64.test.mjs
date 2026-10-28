// SPDX-License-Identifier: MIT
// Positive packets are complete original public Source v5 output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readSystemQueryFacts,printSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore} from '../../compiler/system-query-core.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {compileSystemQuery} from '../../compiler/pipeline.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';
import {systemQueryFixture as fixture} from './system-query-fixtures.mjs';

const cases=[['add','+=','add'],['assign','=','mul'],['subtract','-=','sub'],['multiply','*=','mul'],['divide','/=','div'],['nested-rhs','*=','mul'],['independent-widths','+=','add']];
const actual=name=>fixture('../system-query-f64/'+name);
const anchor=range=>'tsfg_source.start = '+range.start+' : i64, tsfg_source.end = '+range.end+' : i64';
for(const [name,operator,operation]of cases)test('actual f64 '+name+' retains width, complete Source and evaluation order',()=>{
  const input=actual(name),facts=readSystemQueryFacts(input.bytes,input.context);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
  assert.deepEqual(facts.program,input.packet.payload.program);assert.deepEqual(facts.nodes,input.packet.payload.nodes);
  const system=facts.systems[0],value=system.loops[0].statements[0].value;
  assert.equal(value.sourceType,'f64');assert.equal(value.operator,operator);
  const core=emitSystemQueryCore(facts,input.context),lines=core.split('\n');
  const store=lines.findIndex(line=>line.includes('"tsfg.field_store"')&&line.includes(anchor(value.range)));
  assert.ok(lines[store].includes(', f64) -> ()'));
  const arithmetic=lines.findIndex(line=>line.includes('"tsfg_core.'+operation+'"')&&line.includes(anchor(operator==='='?value.value.range:value.range)));
  assert.ok(lines[arithmetic].includes('(f64, f64) -> f64'));
  if(operator!=='='){
    const load=lines.findIndex(line=>line.includes('"tsfg.field_load"')&&line.includes(anchor(value.target.range)));
    const old=lines[load].match(/(%\w+) =/)[1];assert.ok(lines[arithmetic].includes('('+old+', '));assert.ok(load<arithmetic&&arithmetic<store);
    const rhs=name==='nested-rhs'?lines.findIndex(line=>line.includes('"tsfg.field_store"')&&line.includes(anchor(value.value.expression.range))):lines.findIndex(line=>line.includes(' = ')&&line.includes(anchor(value.value.range)));
    assert.ok(load<rhs&&rhs<arithmetic);
  }
  assert.ok(facts.nodes.some(row=>row.name==='unused'));assert.ok(facts.nodes.some(row=>row.name==='Box'));
  if(name==='independent-widths'){assert.ok(core.includes('(f32, f32) -> f32'));assert.ok(core.includes('(f64, f64) -> f64'));}
});

/** @type {[string,(payload:ReturnType<typeof actual>['packet']['payload'])=>void][]} */
const mutations=[
  ['mixed RHS width',payload=>{payload.systems[0].loops[0].statements[0].value.value.type='f32';payload.systems[0].loops[0].statements[0].value.value.flowType='f32';}],
  ['different operator Source anchor',payload=>{const value=payload.systems[0].loops[0].statements[0].value;value.operator=value.operator==='-='?'+=':'-=';}],
  ['operator range',payload=>{payload.systems[0].loops[0].statements[0].value.operatorRange.start++;}],
  ['Read borrow',payload=>{payload.systems[0].loops[0].bindings[0].mode='read';}],
  ['readonly field',payload=>{const loop=payload.systems[0].loops[0];payload.types.find(row=>row.id===loop.bindings[0].componentType).fields.find(row=>row.name==='x').readonly=true;}]
];
for(const [name,mutate]of mutations)test('f64 owner rejects rehashed '+name,()=>{
  const input=actual('add'),packet=structuredClone(input.packet);mutate(packet.payload);
  packet.packageId=sha256('tsfg.system-query.package.v5\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),{...input.context,expectedPackageId:packet.packageId}));
});

test('actual f64 scalar helper retains original signature, call arguments and full Program',()=>{
  const input=actual('scalar-helper'),facts=readSystemQueryFacts(input.bytes,input.context),helper=facts.scalarHelpers[0],core=emitSystemQueryCore(facts,input.context);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);assert.deepEqual(facts.program,input.packet.payload.program);assert.deepEqual(facts.nodes,input.packet.payload.nodes);
  assert.equal(helper.declaration.name,'scaled');assert.equal(helper.sourceReturnType,'f64');assert.deepEqual(helper.sourceSignature.parameters,['f64','f64']);
  assert.deepEqual(helper.parameters.map(parameter=>parameter.logicalType),['f64','f64']);assert.notEqual(helper.id,helper.sourceId);
  assert.ok(core.includes('(%harg0: f64, %harg1: f64) -> f64'));assert.match(core,/"func.call"\(%qv\d+, %arg1\).*-> f64/);
  const returned=core.split('\n').find(line=>line.includes('"func.return"'));assert.ok(returned.includes(': (f64) -> ()'));
  const packet=structuredClone(input.packet);packet.payload.scalarHelpers[0].signature.returnType='f32';
  packet.packageId=sha256('tsfg.system-query.package.v5\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),{...input.context,expectedPackageId:packet.packageId}));
});
for(const name of ['view-helpers','view-imported'])test('actual f64 '+name+' retains view permissions, nested calls and import identity',()=>{
  const input=actual(name),facts=readSystemQueryFacts(input.bytes,input.context),core=emitSystemQueryCore(facts,input.context);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);assert.deepEqual(facts.program,input.packet.payload.program);assert.deepEqual(facts.nodes,input.packet.payload.nodes);
  assert.equal(facts.scalarHelpers.length,3);assert.ok(facts.scalarHelpers.every(helper=>helper.sourceReturnType==='f64'&&helper.sourceSignature.returnType==='f64'));
  const update=facts.scalarHelpers.find(helper=>helper.declaration.name==='update'),scaled=facts.scalarHelpers.find(helper=>helper.declaration.name==='scaledX');
  assert.deepEqual(update.parameters.map(parameter=>parameter.view?.access.mode??parameter.logicalType),['write','read','f64']);
  assert.equal(update.value.value.operator,'/');assert.equal(scaled.value.operator,'-');assert.equal(scaled.value.left.kind,'call');
  assert.equal(core.split('"func.call"').length-1,3);assert.ok(core.includes('"tsfg.view_borrow"'));
  assert.ok(core.split('\n').filter(line=>line.includes('"func.call"')).every(line=>line.endsWith('-> f64')));
  assert.equal(facts.program.files.length,name==='view-imported'?4:3);
  if(name==='view-imported')assert.equal(update.declaration.sourcePath,'/src/helpers.ts');
  for(const change of ['return','scalar','mode']){
    const packet=structuredClone(input.packet),helper=packet.payload.scalarHelpers.find(helper=>helper.declaration.name==='update');
    if(change==='return')helper.returnType='f32';else if(change==='scalar')helper.parameters[2].logicalType='f32';else helper.parameters[0].view.access.mode='read';
    packet.packageId=sha256('tsfg.system-query.package.v5\0'+packet.schemaHash+'\0'+canonical(packet.payload));
    assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),{...input.context,expectedPackageId:packet.packageId}));
  }
});

const tool=process.env.TSFG_QUERY_F64_CORE_EXE,output=process.env.TSFG_QUERY_F64_CORE_OUTPUT,enabled=Boolean(tool&&output),children=[];
const run=(name,command,input,status=0)=>{
  mkdirSync(output,{recursive:true});const prefix=output+'/'+String(children.length).padStart(3,'0')+'-'+name;
  const child=spawnSync(tool,['--system-query',command],{input,windowsHide:true,maxBuffer:16777216,timeout:60000});
  writeFileSync(prefix+'-input.txt',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name,command,pid:child.pid,status:child.status,error:child.error?.message??null,stdoutBytes:child.stdout?.length,stderr:child.stderr?.toString('utf8')});
  writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');assert.ifError(child.error);assert.equal(child.status,status,child.stderr?.toString('utf8'));
  if(status!==0)assert.equal(child.stdout.length,0);return child.stdout.toString('utf8');
};
for(const [name,,operation]of cases)test('static f64 '+name+' preserves standard batch, strict LLVM, tmeta2 and cold ownership',{skip:!enabled},async()=>{
  const input=actual(name),result=await compileSystemQuery(input.bytes,input.context,{core:tool,effects:true,cpuBatch:true,cpuLLVM:'ir',tmeta:true});
  mkdirSync(output,{recursive:true});for(const [suffix,bytes]of [['core.mlir',result.core],['batch.mlir',result.cpuBatch],['ll',result.cpuLLVM],['tmeta',canonical(result.tmeta.envelope)+'\n']])writeFileSync(output+'/'+name+'.'+suffix,bytes);
  writeFileSync(output+'/'+name+'-receipt.json',canonical({inputIdentity:result.facts.inputIdentity,packageId:result.facts.packageId,payloadHash:result.tmeta.envelope.payloadHash})+'\n');
  const kinds=name==='assign'?['read','write','read','read','write']:name==='nested-rhs'?['read','write','write','read','read','write']:['read','read','write','read','read','write'];
  assert.deepEqual(result.effects.systems[0].loops[0].operations.map(row=>row.kind),kinds);assert.deepEqual(result.effects.conflicts,[]);
  assert.ok(result.cpuBatch.includes('memref<1xf64>'));assert.ok(result.cpuBatch.includes('"arith.'+operation+'f"'));
  const llvm=result.cpuLLVM.split('\n!')[0];assert.match(llvm,new RegExp('\\bf'+operation+' double\\b'));
  assert.ok(!/\b(?:fadd|fsub|fmul|fdiv)\s+(?:fast|reassoc|contract|nnan|ninf|nsz|arcp|afn)\b/.test(llvm));assert.ok(!/\bnoalias\b/.test(llvm));
  const first=llvm.slice(llvm.indexOf('define '),llvm.indexOf('\n}',llvm.indexOf('define ')));
  const events=first.split('\n').flatMap(line=>/\bload double\b/.test(line)?['load']: /\bstore double\b/.test(line)?['store']: /\bf(?:add|sub|mul|div) double\b/.test(line)?[line.match(/\bf(add|sub|mul|div) double\b/)[1]]:[]);
  const second=name==='independent-widths'?[]:['load','load','mul','add','store'];
  const rhs={add:'mul',subtract:'add',multiply:'sub',divide:'div','independent-widths':'mul'}[name];
  assert.deepEqual(events,name==='assign'?['load','mul','store',...second]:name==='nested-rhs'?['load','store','mul','store',...second]:['load','load',rhs,operation,'store',...second]);
  const envelope=result.tmeta.envelope,payload=result.tmeta.payload;assert.equal(envelope.version,2);
  assert.deepEqual(payload.entries[0].scalars.map(scalar=>scalar.type),name==='independent-widths'?['f64','f32']:['f64']);
  const layouts=JSON.parse(JSON.parse(payload.componentLayouts).payload);
  assert.equal(layouts.types.find(type=>type.scalar==='f64').byteSize,8);
  for(const type of layouts.types.filter(type=>type.kind==='component')){assert.equal(type.stride,16);assert.equal(type.alignment,8);assert.deepEqual(type.fields.map(field=>field.offset),[0,8]);}
  if(name==='subtract'){
    assert.equal(run('f64-core-cold','--canonicalize',result.core),result.core);
    assert.equal(run('f64-batch-cold','--canonicalize',result.cpuBatch),result.cpuBatch);
    assert.equal(run('f64-llvm-cold','--canonicalize-llvm-ir',result.cpuLLVM),result.cpuLLVM);
    assert.equal(run('f64-tmeta-cold','--canonicalize-tmeta',canonical(envelope)+'\n'),canonical(envelope)+'\n');
  }
});

test('independent f64 Core rejects whole-rehashed widths, source anchors and reversed noncommutative SSA',{skip:!enabled},()=>{
  const input=actual('subtract'),facts=readSystemQueryFacts(input.bytes,input.context),core=emitSystemQueryCore(facts,input.context);
  for(const [name,mutate]of mutations){
    const packet=structuredClone(input.packet);mutate(packet.payload);packet.packageId=sha256('tsfg.system-query.package.v5\0'+packet.schemaHash+'\0'+canonical(packet.payload));
    const bad=core.replace('tsfg.query_facts = '+coreQuote(canonical(input.packet)),'tsfg.query_facts = '+coreQuote(canonical(packet)));assert.notEqual(bad,core);run('rehashed-'+name,'--canonicalize',bad,3);
  }
  const value=facts.systems[0].loops[0].statements[0].value,lines=core.split('\n'),operation=lines.find(line=>line.includes('"tsfg_core.sub"')&&line.includes(anchor(value.range))),load=lines.find(line=>line.includes('"tsfg.field_load"')&&line.includes(anchor(value.target.range)));
  const swapped=core.replace(operation,operation.replace(/\((%\w+), (%\w+)\)/,'($2, $1)'));
  assert.notEqual(swapped,core);run('reversed-subtract','--canonicalize',swapped,3);
  const narrow=core.replace(operation,operation.replaceAll('f64','f32'));assert.notEqual(narrow,core);run('narrowed-result','--canonicalize',narrow,3);
  const moved=[...lines];moved.splice(moved.indexOf(load),1);moved.splice(moved.indexOf(operation),0,load);
  assert.notEqual(moved.join('\n'),core);run('late-old-target','--canonicalize',moved.join('\n'),3);
});

for(const name of ['scalar-helper','view-helpers','view-imported'])test('static f64 '+name+' preserves original callable signatures, transitive effects and tmeta2',{skip:!enabled},async()=>{
  const input=actual(name),result=await compileSystemQuery(input.bytes,input.context,{core:tool,effects:true,cpuBatch:true,cpuLLVM:'ir',tmeta:true});
  mkdirSync(output,{recursive:true});for(const [suffix,bytes]of [['core.mlir',result.core],['batch.mlir',result.cpuBatch],['ll',result.cpuLLVM],['tmeta',canonical(result.tmeta.envelope)+'\n']])writeFileSync(output+'/'+name+'.'+suffix,bytes);
  writeFileSync(output+'/'+name+'-receipt.json',canonical({inputIdentity:result.facts.inputIdentity,packageId:result.facts.packageId,payloadHash:result.tmeta.envelope.payloadHash})+'\n');
  const code=result.cpuLLVM.split('\n!')[0];assert.match(code,/call double @batch_helper_/);assert.ok(result.cpuBatch.includes('memref<1xf64>'));
  assert.equal(result.tmeta.envelope.version,2);assert.deepEqual(result.tmeta.payload.entries[0].scalars.map(scalar=>scalar.type),['f64']);
  if(name==='scalar-helper')assert.deepEqual(result.effects.systems[0].loops[0].operations.map(row=>row.kind),['read','read','write','read','read','write']);
  else{
    assert.match(code,/\bfsub double\b/);assert.match(code,/\bfdiv double\b/);
    assert.deepEqual(result.effects.systems[0].loops[0].operations.map(row=>row.kind),['read','read','write','write','read','read','write']);
    assert.deepEqual(result.effects.systems[0].loops[0].operations.map(row=>row.callPath.length),[1,1,1,0,0,2,0]);
  }
  if(name==='view-imported'){
    assert.equal(run('f64-imported-cold','--canonicalize',result.core),result.core);
    assert.equal(run('f64-imported-tmeta','--canonicalize-tmeta',canonical(result.tmeta.envelope)+'\n'),canonical(result.tmeta.envelope)+'\n');
  }
});
