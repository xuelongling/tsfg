// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {readSystemQueryFacts,printSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore} from '../../compiler/system-query-core.mjs';
import {readSystemQueryEffects} from '../../compiler/system-query-effects.mjs';
import {canonical,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';

const fixture=new URL('./testdata/system-query-i32-field-literal/',import.meta.url);
const original=name=>readFileSync(new URL(name,fixture));
const bytes=original('package.json'),packet=JSON.parse(bytes.toString('utf8'));
const oracle=JSON.parse(original('official-oracle.json').toString('utf8'));
const context={family:'tsfg.system-query-context-candidate',version:6,requestBytes:original('request.json'),expectedPackageId:packet.packageId};
const anchor=range=>'tsfg_source.start = '+range.start+' : i64, tsfg_source.end = '+range.end+' : i64';
/** @type {Array<[string,(payload:typeof packet.payload)=>void]>} */
const corruptions=[
  ['foreign decimal',payload=>{payload.systems[0].loops[0].statements[0].value.value.decimal='0';}],
  ['foreign spelling',payload=>{payload.systems[0].loops[0].statements[1].value.value.token='2147483647';}],
  ['Read destination',payload=>{payload.systems[0].loops[0].bindings[0].mode='read';}],
];
function changedPacket(mutate){
  const changed=structuredClone(packet);
  mutate(changed.payload);
  changed.packageId=sha256('tsfg.system-query.package.v6\0'+changed.schemaHash+'\0'+canonical(changed.payload));
  return changed;
}

test('official literal facts keep exact i32 values and write the original field',()=>{
  const source=original('source.ts'),facts=readSystemQueryFacts(bytes,context);
  assert.equal(sha256(source),'sha256:'+oracle.sourceSha256);
  assert.equal(facts.program.files.find(file=>file.path==='/src/main.ts')?.content,source.toString('utf8'));
  assert.deepEqual(printSystemQueryFacts(facts,context),bytes);
  const loop=facts.systems[0].loops[0],core=emitSystemQueryCore(facts,context),rows=core.split('\n');
  assert.equal(loop.statements.length,2);
  assert.equal(rows.filter(row=>row.includes('"tsfg.field_load"')).length,0);
  const constants=rows.filter(row=>row.includes('"tsfg_core.constant"'));
  const stores=rows.filter(row=>row.includes('"tsfg.field_store"'));
  assert.equal(constants.length,2);
  assert.equal(stores.length,2);
  for(const [index,expected] of oracle.assignments.entries()){
    const statement=loop.statements[index].value;
    assert.ok(statement?.target&&statement.value);
    assert.deepEqual([statement.kind,statement.type,statement.operator,statement.range,statement.operatorRange],
      ['fieldAssignment',scalarTypeIds.i32,'=',expected.assignment,expected.operator]);
    assert.deepEqual([statement.target.access,statement.target.receiver?.binding,statement.target.range],
      ['write',loop.bindings[0].declaration.id,expected.target]);
    assert.deepEqual([statement.value.kind,statement.value.type,statement.value.token,statement.value.decimal,statement.value.range],
      ['numericLiteral',scalarTypeIds.i32,expected.token,expected.decimal,expected.literal]);
    const constant=constants[index],store=stores[index],ssa=constant.match(/(%\w+) = /);
    assert.ok(ssa&&constant.includes('value = '+expected.decimal+' : i32')&&constant.includes(anchor(expected.literal)));
    assert.ok(store.includes(', '+ssa[1]+')')&&store.includes(anchor(expected.assignment)));
  }
  if(process.env.TSFG_QUERY_LITERAL_CORE_OUT)writeFileSync(process.env.TSFG_QUERY_LITERAL_CORE_OUT,core,{flag:'wx'});
});

test('Node rejects changed literal values, spellings and destination permission',()=>{
  for(const [name,mutate] of corruptions){
    const changed=changedPacket(mutate);
    assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(changed)+'\n'),{...context,expectedPackageId:changed.packageId}),TypeError,name);
  }
});

const tool=process.env.TSFG_QUERY_LLVM_EXE,out=process.env.TSFG_QUERY_LLVM_OUTPUT;
test('C++ verifies exact i32 constant stores, effects, LLVM and cold input',{skip:!tool||!out},()=>{
  assert.ok(tool&&out);
  const directory=out+'/i32-literal';
  mkdirSync(directory,{recursive:true});
  const run=(name,command,input,status=0)=>{
    const child=spawnSync(tool,['--system-query',command],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
    const stdout=child.stdout??Buffer.alloc(0),stderr=child.stderr??Buffer.alloc(0);
    writeFileSync(directory+'/'+name+'-stdout.bin',stdout,{flag:'wx'});
    writeFileSync(directory+'/'+name+'-stderr.bin',stderr,{flag:'wx'});
    writeFileSync(directory+'/'+name+'.json',JSON.stringify({pid:child.pid,status:child.status,signal:child.signal,command,input:sha256(input),stdout:sha256(stdout),stderr:sha256(stderr)})+'\n',{flag:'wx'});
    assert.ifError(child.error);
    assert.equal(child.signal,null);
    assert.equal(child.status,status,stderr.toString('utf8'));
    assert.equal(status===0?stderr.length:stdout.length,0);
    return stdout.toString('utf8');
  };
  const facts=readSystemQueryFacts(bytes,context),core=emitSystemQueryCore(facts,context);
  if(process.env.TSFG_QUERY_LITERAL_FIXED_CORE)assert.equal(core,readFileSync(process.env.TSFG_QUERY_LITERAL_FIXED_CORE,'utf8'));
  const bound=run('bound','--canonicalize',core);
  assert.equal(run('bound-cold','--canonicalize',bound),bound);
  const effects=readSystemQueryEffects(Buffer.from(run('effects','--effects',bound)),facts,context);
  const loop=facts.systems[0].loops[0];
  assert.deepEqual(effects.systems[0].loops[0].operations.map(row=>[row.kind,row.sourceField,row.sourceBinding,row.source]),
    oracle.assignments.map((expected,index)=>['write',loop.statements[index].value?.target?.sourceField,loop.bindings[0].declaration.id,{path:'/src/main.ts',...expected.assignment}]));
  const batch=run('batch','--cpu-batch',bound);
  assert.equal(batch.split('\n').filter(row=>row.includes('"memref.store"')).length,2);
  assert.ok(!batch.includes('"memref.load"'));
  const ir=run('llvm','--llvm-ir',batch);
  assert.equal(run('llvm-cold','--canonicalize-llvm-ir',ir),ir);
  const code=ir.split('\n!')[0];
  assert.deepEqual([...code.matchAll(/\bstore i32 (-?\d+),/g)].map(match=>match[1]),['-2147483648','2147483647']);
  assert.ok(!/\bload i32\b/.test(code));
  for(const [name,mutate] of corruptions){
    const bad=core.replace('tsfg.query_facts = '+coreQuote(canonical(packet)),'tsfg.query_facts = '+coreQuote(canonical(changedPacket(mutate))));
    assert.notEqual(bad,core);
    run(name.replaceAll(' ','-'),'--canonicalize',bad,3);
  }
});
