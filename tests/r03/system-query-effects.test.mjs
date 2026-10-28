// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {readSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore} from '../../compiler/system-query-core.mjs';
import {readSystemQueryEffects} from '../../compiler/system-query-effects.mjs';
import {systemQueryFixture} from './system-query-fixtures.mjs';

const tool=process.env.TSFG_QUERY_EFFECTS_EXE,output=process.env.TSFG_QUERY_EFFECTS_OUTPUT,enabled=Boolean(tool&&output),children=[];
const reports=process.env.TSFG_QUERY_EFFECTS_REPORTS;
const names=['architecture','aliases','duplicate','complete','wrapper-alias','loop-architecture','loop-aliases','loop-multiple','loop-shared-component','loop-inheritance'];
const programs=names.map(name=>({name,...systemQueryFixture(name)}));
const bytes=readFileSync(new URL('./testdata/system-query-effects/multi-facts.json',import.meta.url)),packet=JSON.parse(bytes.toString('utf8'));
const multi={name:'multi',bytes,packet,context:{family:'tsfg.system-query-context-candidate',version:5,requestBytes:readFileSync(new URL('./testdata/system-query-effects/multi-request.json',import.meta.url)),expectedPackageId:packet.packageId}};
const oracle=JSON.parse(readFileSync(new URL('./testdata/system-query-effects/expected.json',import.meta.url),'utf8'));
const retained=reports?JSON.parse(readFileSync(reports+'/children.json','utf8')):[];
const report=name=>{
  const index=retained.findIndex(row=>row.name===name&&row.command==='--effects');assert.ok(index>=0);
  return readFileSync(reports+'/'+String(index).padStart(3,'0')+'-'+name+'-stdout.raw');
};
const run=(name,command,input,expected=0)=>{
  mkdirSync(output,{recursive:true});const serial=String(children.length).padStart(3,'0'),prefix=output+'/'+serial+'-'+name;
  const child=spawnSync(tool,['--system-query',command],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
  writeFileSync(prefix+'-input.mlir',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name,command,pid:child.pid,status:child.status,error:child.error?.message??null,stdoutBytes:child.stdout?.length,stdoutSHA256:sha256(child.stdout??Buffer.alloc(0)),stderr:child.stderr?.toString('utf8')});
  writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');assert.ifError(child.error);assert.equal(child.status,expected,child.stderr.toString('utf8'));return child.stdout;
};
const labels=program=>{
  const fields=new Map(program.packet.payload.types.flatMap(type=>type.fields?.map(field=>[field.id,field.name])??[]));
  const components=new Map(program.facts.components.map(row=>[row.typeId,row.declaration.name]));
  return {field:row=>components.get(row.componentType)+'.'+fields.get(row.sourceField),component:id=>components.get(id)};
};

for(const original of [...programs,multi])test('actual Core field effects and stable bound roundtrip: '+original.name,{skip:!enabled},()=>{
  const facts=readSystemQueryFacts(original.bytes,original.context),program={...original,facts},ir=emitSystemQueryCore(facts,program.context);
  const raw=run(program.name,'--effects',ir),effects=readSystemQueryEffects(raw,facts,program.context);
  const bound=run(program.name,'--canonicalize',ir);
  assert.deepEqual(run(program.name+'-bound','--effects',bound),raw);
  assert.equal(raw.toString('utf8'),canonical(effects)+'\n');assert.ok(Object.isFrozen(effects.systems));
  const label=labels(program);
  if(program.name!=='multi'){
    assert.equal(effects.systems.length,1);assert.deepEqual(effects.conflicts,[]);const system=effects.systems[0];
    const expectedCaps=program.name==='loop-shared-component'?['Position:write']:program.name==='loop-multiple'?['Acceleration:read','Position:write','Velocity:read']:['Position:write','Velocity:read'];
    assert.deepEqual(system.capabilities.map(row=>label.component(row.componentType)+':'+row.mode).sort(),expectedCaps);
    const actual=system.fieldEffects.map(row=>[label.field(row),row.readCount,row.writeCount]).sort();
    const expected=!program.name.startsWith('loop-')?[]:program.name==='loop-shared-component'?[['Position.x',2,1],['Position.y',2,1]]:
      program.name==='loop-multiple'?[['Acceleration.y',1,0],['Position.x',1,1],['Position.y',1,1],['Velocity.x',1,0]]:
      [['Position.x',1,1],['Position.y',1,1],['Velocity.x',1,0],['Velocity.y',1,0]];
    assert.deepEqual(actual,expected);
  }else{
    const sourceNames=new Map(facts.systems.map(row=>[row.declaration.id,row.declaration.name]));
    const systemNames=new Map(effects.systems.map(row=>[row.functionId,sourceNames.get(row.sourceFunctionId)]));
    assert.equal(effects.systems.length,7);
    for(const expected of oracle.systems){const system=effects.systems.find(row=>sourceNames.get(row.sourceFunctionId)===expected.name);assert.ok(system);
      const writes=new Set(expected.declaredWrite),readOnly=expected.declaredRead.filter(name=>!writes.has(name));
      assert.deepEqual(system.capabilities.map(row=>label.component(row.componentType)+':'+row.mode).sort(),[...writes].map(name=>name+':write').concat(readOnly.map(name=>name+':read')).sort());
      assert.equal(system.loops.length,expected.loops);
      assert.deepEqual(system.loops.flatMap(loop=>loop.operations.filter(op=>op.kind==='read').map(label.field)),expected.bodyLoads);
      assert.deepEqual(system.loops.flatMap(loop=>loop.operations.filter(op=>op.kind==='write').map(label.field)),expected.bodyStores);
    }
    const pairs=effects.conflicts.map(row=>[systemNames.get(row.left),systemNames.get(row.right)].sort()).sort();
    assert.deepEqual(pairs,oracle.conflictPairs.map(pair=>[...pair].sort()).sort());assert.equal(21-pairs.length,oracle.noConflictPairsCount);
    const alias=effects.systems.find(row=>sourceNames.get(row.sourceFunctionId)==='aliasPosition');
    assert.deepEqual(alias.loops[0].columns.map(row=>row.mode),['write','read']);assert.equal(alias.capabilities.length,1);
    const copy=effects.systems.find(row=>sourceNames.get(row.sourceFunctionId)==='copyPositionToVelocity');
    assert.deepEqual(copy.loops[0].operations.map(op=>op.kind),['read','write']);
    assert.ok(pairs.some(pair=>pair.join('/')==='writePositionX/writePositionY'),'different fields still conflict on one component column');
  }
  if(program.name==='multi'||program.name==='loop-architecture'){
    assert.deepEqual(run(program.name+'-roundtrip','--canonicalize',bound),bound);
    assert.deepEqual(run(program.name+'-optimize','--optimize',bound),bound);
  }
});

test('effects command rejects malformed Source-bound Core rather than trusting summaries',{skip:!enabled},()=>{
  const program=programs.find(row=>row.name==='loop-architecture'),facts=readSystemQueryFacts(program.bytes,program.context),ir=emitSystemQueryCore(facts,program.context);
  const variants=[['wrong-operation',ir.replace('"tsfg_core.mul"','"tsfg_core.add"')],['wrong-mode',ir.replace('mode = "write"','mode = "read"')],
    ['wrong-anchor',ir.replace(/tsfg_source.start = (\d+) : i64/,(_,start)=>'tsfg_source.start = '+(Number(start)+1)+' : i64')],
    ['wrong-field',ir.replace(/source_field = "sha256:([0-9a-f])/,(_,first)=>'source_field = "sha256:'+(first==='0'?'1':'0'))],
    ['wrong-input',ir.replace('tsfg_core.input_identity = "sha256:','tsfg_core.input_identity = "sha256:0')],
    ['unknown-proof',ir.replace('tsfg.query_version =','tsfg.effects_proof = "claimed-safe", tsfg.query_version =')]];
  for(const [name,bad] of variants){assert.notEqual(bad,ir);assert.equal(run(name,'--effects',bad,3).length,0);}
});

test('checked reader accepts retained actual C++ reports without running C++',{skip:!reports},()=>{
  for(const program of [...programs,multi]){const facts=readSystemQueryFacts(program.bytes,program.context),raw=report(program.name),value=readSystemQueryEffects(raw,facts,program.context);
    assert.equal(canonical(value)+'\n',raw.toString('utf8'));assert.ok(Object.isFrozen(value.source));assert.ok(Object.isFrozen(value.target));assert.ok(Object.isFrozen(value.systems[0].capabilities));
    if(false){
      // @ts-expect-error Actual exported API returns readonly systems, not any.
      value.systems.push(value.systems[0]);
      // @ts-expect-error Actual memory descriptor anchors are readonly.
      value.systems[0].loops[0].operations[0].source.start=0;
      /** @type {'other'} */
      let mode;
      // @ts-expect-error Read/Write is a closed capability domain.
      mode=value.systems[0].capabilities[0].mode;
      // @ts-expect-error The actual target identity is readonly.
      value.target.target='other';
    }
  }
});

test('versioned owning output reader rejects identity, effect and conflict mutations',{skip:!enabled&&!reports},()=>{
  const facts=readSystemQueryFacts(multi.bytes,multi.context),ir=emitSystemQueryCore(facts,multi.context),raw=reports?report('reader'):run('reader','--effects',ir),base=JSON.parse(raw.toString('utf8'));
  const named=(value,name)=>value.systems.find(row=>row.sourceFunctionId===facts.systems.find(row=>row.declaration.name===name).declaration.id);
  const mutations=[value=>{value.version=4;},value=>{value.inputIdentity='sha256:'+'0'.repeat(64);},value=>{value.systems[0].sourceFunctionId=value.systems[0].functionId;},
    value=>{value.conflicts.pop();},value=>{value.conflicts.reverse();},value=>{value.systems.reverse();},
    value=>{value.systems.find(row=>row.loops.length).loops[0].operations[0].kind='write';},
    value=>{value.systems.find(row=>row.fieldEffects.length).fieldEffects[0].readCount+=1;},
    value=>{value.systems.find(row=>row.loops.length).loops[0].capabilities=[];},value=>{value.extra='not-owned';},
    value=>{const system=named(value,'writePositionX');system.loops[0].operations=[];system.loops[0].fieldEffects=[];system.fieldEffects=[];},
    value=>{named(value,'writePositionX').loops[0].operations.reverse();},
    value=>{named(value,'writePositionX').loops[0].operations[0].source.start++;},
    value=>{const system=named(value,'writePositionX'),other=named(value,'writePositionY').fieldEffects[0];
      for(const op of [...system.loops[0].operations,...system.loops[0].fieldEffects,...system.fieldEffects]){op.field=other.field;op.sourceField=other.sourceField;}}];
  for(const mutate of mutations){const bad=structuredClone(base);mutate(bad);assert.throws(()=>readSystemQueryEffects(Buffer.from(canonical(bad)+'\n'),facts,multi.context),/r10-query-effects-input/);}
  assert.throws(()=>readSystemQueryEffects(raw,facts,{...multi.context,expectedPackageId:'sha256:'+'0'.repeat(64)}));
  assert.throws(()=>readSystemQueryEffects(Buffer.from('{"version":1,"version":1}'),facts,multi.context));
  assert.throws(()=>readSystemQueryEffects(Buffer.alloc(8388609,32),facts,multi.context));
});
