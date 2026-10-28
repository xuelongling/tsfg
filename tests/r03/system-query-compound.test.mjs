// SPDX-License-Identifier: MIT
// Every positive pair is complete original public Go v5 output, byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {systemQueryFixture as fixture} from './system-query-fixtures.mjs';
import {readSystemQueryFacts,printSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore} from '../../compiler/system-query-core.mjs';
import {readSystemQueryEffects} from '../../compiler/system-query-effects.mjs';
import {compileSystemQuery} from '../../compiler/pipeline.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';

const cases=[['mul','*=','mul'],['sub','-=','sub'],['div','/=','div'],
  ['helper-sub','-=','sub'],['helper-mul','*=','mul'],['helper-div','/=','div'],['nested','*=','mul']];
const actual=name=>fixture('../system-query-compound/'+name);
const anchor=range=>'tsfg_source.start = '+range.start+' : i64, tsfg_source.end = '+range.end+' : i64';

for(const [name,operator,operation]of cases)test('actual v5 '+name+' compound captures its old target before its RHS',()=>{
  const input=actual(name),facts=readSystemQueryFacts(input.bytes,input.context);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
  assert.deepEqual(facts.program,input.packet.payload.program);assert.deepEqual(facts.nodes,input.packet.payload.nodes);
  const system=facts.systems.find(row=>row.declaration.name==='integrate'),helper=facts.scalarHelpers.find(row=>row.declaration.name==='update');
  const owner=name.startsWith('helper-')?helper:system,value=name.startsWith('helper-')?helper.value:system.loops[0].statements[0].value;
  assert.equal(value.operator,operator);assert.equal(value.target.access,'readwrite');
  const source=facts.program.files.find(row=>row.path===owner.declaration.sourcePath).content;
  assert.equal(source.slice(value.operatorRange.start,value.operatorRange.end),operator);
  const lines=emitSystemQueryCore(facts,input.context).split('\n');
  const selected=lines.filter(line=>line.includes('"tsfg.field_load"')&&line.includes(anchor(value.target.range)));
  assert.equal(selected.length,1);
  const load=lines.indexOf(selected[0]),oldValue=selected[0].match(/(%\w+) =/)[1];
  const receiver=selected[0].match(/"tsfg\.field_load"\((%\w+)\)/)[1];
  const store=lines.findIndex(line=>line.includes('"tsfg.field_store"')&&line.includes(anchor(value.range)));
  let right,rhs;
  if(name==='nested'){
    const inner=value.value.expression;assert.equal(inner.kind,'fieldAssignment');assert.equal(inner.operator,'=');
    rhs=lines.findIndex(line=>line.includes('"tsfg.field_store"')&&line.includes(anchor(inner.range)));
    right=lines[rhs].match(/"tsfg\.field_store"\(%\w+, (%\w+)\)/)[1];
  }else{
    rhs=lines.findIndex(line=>line.includes(anchor(value.value.range))&&/ = "/.test(line));
    right=lines[rhs].match(/(%\w+) =/)[1];
    if(!name.startsWith('helper-'))assert.equal(source.slice(value.value.range.start,value.value.range.end),'update(p,v,dt)');
  }
  const arithmetic=lines.findIndex(line=>line.includes('"tsfg_core.'+operation+'"('+oldValue+', '+right+')')&&line.includes(anchor(value.range)));
  assert.ok(load<rhs&&rhs<arithmetic&&arithmetic<store);
  assert.ok(lines[store].includes('"tsfg.field_store"('+receiver+', '));
  assert.ok(facts.nodes.some(row=>row.kind==='KindClassDeclaration'&&row.name==='Box'));
  assert.ok(facts.nodes.some(row=>row.kind==='KindFunctionDeclaration'&&row.name==='unused'));
  assert.ok(facts.nodes.some(row=>row.kind==='KindFunctionDeclaration'&&row.name==='update'));
  assert.equal(facts.scalarHelpers.length,name==='nested'?2:3);
});

const mutations=[
  {name:'different legal operator',mutate:payload=>{payload.systems[0].loops[0].statements[0].value.operator='-=';}},
  {name:'operator anchor',mutate:payload=>{payload.systems[0].loops[0].statements[0].value.operatorRange.start++;}},
  {name:'original receiver binding',mutate:payload=>{const loop=payload.systems[0].loops[0];loop.statements[0].value.target.receiver.binding=loop.bindings[1].declaration.id;}},
  {name:'Read tuple claim',mutate:payload=>{payload.systems[0].loops[0].bindings[0].mode='read';}},
  {name:'readonly Source claim',mutate:payload=>{const loop=payload.systems[0].loops[0];payload.types.find(row=>row.id===loop.bindings[0].componentType).fields.find(row=>row.name==='x').readonly=true;}},
  {name:'unselected operator',mutate:payload=>{payload.systems[0].loops[0].statements[0].value.operator='%=';}}
];
const rehash=(input,mutate)=>{
  const packet=structuredClone(input.packet);mutate(packet.payload);
  packet.packageId=sha256('tsfg.system-query.package.v5\0'+packet.schemaHash+'\0'+canonical(packet.payload));return packet;
};
for(const {name,mutate}of mutations)test('owned compound packet rejects rehashed '+name,()=>{
  const input=actual('mul'),packet=rehash(input,mutate);
  assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),{...input.context,expectedPackageId:packet.packageId}));
});

const tool=process.env.TSFG_QUERY_COMPOUND_CORE_EXE,output=process.env.TSFG_QUERY_COMPOUND_CORE_OUTPUT,enabled=Boolean(tool&&output),children=[];
const run=(name,command,input,status=0)=>{
  mkdirSync(output,{recursive:true});const prefix=output+'/'+String(children.length).padStart(3,'0')+'-'+name;
  const child=spawnSync(tool,['--system-query',command],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
  writeFileSync(prefix+'-input.txt',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name,command,pid:child.pid,status:child.status,error:child.error?.message??null,stdoutBytes:child.stdout?.length,stderr:child.stderr?.toString('utf8')});
  writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');assert.ifError(child.error);assert.equal(child.status,status,child.stderr?.toString('utf8'));return child.stdout.toString('utf8');
};

for(const [name,,operation]of cases)test('official static compound '+name+' preserves Source, effects and LLVM order',{skip:!enabled},async()=>{
  const input=actual(name),facts=readSystemQueryFacts(input.bytes,input.context);mkdirSync(output,{recursive:true});
  writeFileSync(output+'/'+name+'-input.mlir',emitSystemQueryCore(facts,input.context));
  const result=await compileSystemQuery(input.bytes,input.context,{core:tool,effects:true,cpuBatch:true,cpuLLVM:'ir'});
  writeFileSync(output+'/'+name+'-canonical.mlir',result.core);writeFileSync(output+'/'+name+'-batch.mlir',result.cpuBatch);writeFileSync(output+'/'+name+'.ll',result.cpuLLVM);
  writeFileSync(output+'/'+name+'-effects.json',canonical(result.effects)+'\n');
  const loop=result.effects.systems[0].loops[0],helper=name.startsWith('helper-');
  const kinds=name==='nested'?['read','write','write','read','read','write']:helper?['read','read','write','write','read','read','write']:['read','read','read','write','write','read','read','write'];
  const depths=name==='nested'?[0,0,0,0,2,0]:helper?[1,1,1,0,0,2,0]:[0,1,1,1,0,0,2,0];
  assert.deepEqual(loop.operations.map(row=>row.kind),kinds);assert.deepEqual(loop.operations.map(row=>row.callPath.length),depths);
  const system=facts.systems[0],selected=helper?facts.scalarHelpers.find(row=>row.declaration.name==='update').value:system.loops[0].statements[0].value;
  assert.deepEqual(loop.operations[0].source,{path:system.declaration.sourcePath,...selected.target.range});
  assert.equal(loop.operations[0].tupleIndex,0);assert.equal(loop.operations[0].sourceBinding,system.loops[0].bindings[0].declaration.id);
  assert.deepEqual(loop.capabilities.map(row=>row.mode).sort(),['read','write']);assert.deepEqual(result.effects.conflicts,[]);
  assert.ok(result.cpuBatch.includes('"arith.'+operation+'f"'));
  const code=result.cpuLLVM.split('\n!')[0];assert.match(code,new RegExp('\\bf'+operation+' float\\b'));
  assert.ok(!/\b(?:fadd|fsub|fmul|fdiv)\s+(?:fast|reassoc|contract|nnan|ninf|nsz|arcp|afn)\b/.test(code));assert.ok(!/\bnoalias\b/.test(code));
  if(!helper){
    const first=code.slice(code.indexOf('define '),code.indexOf('\n}',code.indexOf('define ')));
    const update=facts.scalarHelpers.find(row=>row.declaration.name==='update'),scaled=facts.scalarHelpers.find(row=>row.declaration.name==='scaledX');
    const events=first.split('\n').flatMap(line=>update&&line.includes('call float @batch_helper_'+update.id.slice(7))?['update']:line.includes('call float @batch_helper_'+scaled.id.slice(7))?['scaledX']:/\bstore float\b/.test(line)?['store']:/\bload float\b/.test(line)?['load']:new RegExp('\\bf'+operation+' float\\b').test(line)?[operation]:[]);
    assert.deepEqual(events,name==='nested'?['load','store','mul','store','load','scaledX','store']:['load','update',operation,'store','load','scaledX','store']);
  }
  if(name==='sub'){
    assert.equal(run('sub-roundtrip','--canonicalize',result.core),result.core);
    assert.equal(run('sub-llvm-cold','--canonicalize-llvm-ir',result.cpuLLVM),result.cpuLLVM);
  }
});

test('independent compound Core rejects rehashed Source claims and reordered SSA',{skip:!enabled},()=>{
  const input=actual('mul'),facts=readSystemQueryFacts(input.bytes,input.context),core=emitSystemQueryCore(facts,input.context);
  for(const {name,mutate}of mutations){
    const packet=rehash(input,mutate),bad=core.replace('tsfg.query_facts = '+coreQuote(canonical(input.packet)),'tsfg.query_facts = '+coreQuote(canonical(packet)));
    assert.notEqual(bad,core);assert.equal(run('rehashed-'+name,'--canonicalize',bad,3),'');
  }
  const sub=actual('sub'),subFacts=readSystemQueryFacts(sub.bytes,sub.context),ir=emitSystemQueryCore(subFacts,sub.context),value=subFacts.systems[0].loops[0].statements[0].value;
  const lines=ir.split('\n'),load=lines.find(line=>line.includes('"tsfg.field_load"')&&line.includes(anchor(value.target.range)));
  const call=lines.find(line=>line.includes('"func.call"')&&line.includes(anchor(value.value.range)));
  const arithmetic=lines.find(line=>line.includes('"tsfg_core.sub"')&&line.includes(anchor(value.range)));
  const reversed=arithmetic.replace(/\((%\w+), (%\w+)\)/,'($2, $1)'),moved=[...lines];
  moved.splice(moved.indexOf(load),1);moved.splice(moved.indexOf(call)+1,0,load);
  const duplicate=load.replace(/%\w+ =/,'%compoundDuplicate =');
  const variants=[['reversed-subtract',ir.replace(arithmetic,reversed)],['late-old-target',moved.join('\n')],['duplicate-target-load',ir.replace(load,load+'\n'+duplicate)]];
  for(const [name,bad]of variants){assert.notEqual(bad,ir);assert.equal(run(name,'--canonicalize',bad,3),'');}
});

test('compound effects reader rejects a self-consistent omitted old-value access',{skip:!enabled},()=>{
  const input=actual('mul'),facts=readSystemQueryFacts(input.bytes,input.context),raw=run('exact-effects','--effects',emitSystemQueryCore(facts,input.context));
  const report=JSON.parse(raw);assert.equal(canonical(readSystemQueryEffects(Buffer.from(raw),facts,input.context)),canonical(report));
  const system=report.systems[0],loop=system.loops[0],removed=loop.operations.shift();
  for(const counts of [loop.fieldEffects,system.fieldEffects])counts.find(row=>row.field===removed.field).readCount--;
  assert.throws(()=>readSystemQueryEffects(Buffer.from(canonical(report)+'\n'),facts,input.context));
});

test('compound extension retains whole-component conflicts and shared Read declarations',{skip:!enabled},()=>{
  const input=fixture('../system-query-effects/multi'),facts=readSystemQueryFacts(input.bytes,input.context);
  const effects=readSystemQueryEffects(Buffer.from(run('old-multi','--effects',emitSystemQueryCore(facts,input.context))),facts,input.context);
  const sourceNames=new Map(facts.systems.map(row=>[row.declaration.id,row.declaration.name]));
  const names=new Map(effects.systems.map(row=>[row.functionId,sourceNames.get(row.sourceFunctionId)]));
  const expected=JSON.parse(readFileSync(new URL('./testdata/system-query-effects/expected.json',import.meta.url),'utf8'));
  const pairs=effects.conflicts.map(row=>[names.get(row.left),names.get(row.right)].sort()).sort();
  assert.deepEqual(pairs,expected.conflictPairs.map(pair=>[...pair].sort()).sort());assert.equal(effects.conflicts.length,13);
  const empty=effects.systems.find(row=>names.get(row.functionId)==='readPosition');assert.deepEqual(empty.fieldEffects,[]);assert.equal(empty.capabilities[0].mode,'read');
  const alias=effects.systems.find(row=>names.get(row.functionId)==='aliasPosition');assert.deepEqual(alias.loops[0].columns.map(row=>row.mode),['write','read']);assert.equal(alias.capabilities.length,1);
});
