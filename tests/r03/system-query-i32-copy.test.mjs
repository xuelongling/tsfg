// SPDX-License-Identifier: MIT
// Exact public Go v6 facts to real static compiler consumers; no kernel execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {canonical,sha256,scalarTypeIds} from '../../compiler/identity.mjs';
import {commonFieldId} from '../../compiler/common-program-identities.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';
import {readSystemQueryFacts,printSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore} from '../../compiler/system-query-core.mjs';
import {readSystemQueryEffects} from '../../compiler/system-query-effects.mjs';

const fixture=new URL('./testdata/system-query-i32-copy/',import.meta.url);
const original=Object.fromEntries(['source.ts','request.json','official-oracle.json','package.json'].map(name=>[name,readFileSync(new URL(name,fixture))]));
const pins={
  'source.ts':'124fad220ad0d29bfc4b7d91dbccd09e6f3cfcf0727854d11e99a8f396cad4aa',
  'request.json':'b0a0af7d70af4bdeeb8657fa91a0a8a995214f1ab633ae49d9e6d4a4fbaf6294',
  'official-oracle.json':'87fb73fc8ae1d23c3e57bb2bd1c1d64c1918be100f708b9151f15629b5f9c816',
  'package.json':'2df2e65cca40cffdf489114180dd72f98dfd647d767ca7d614a70c13454d4f9f',
};
/** @type {typeof import('./testdata/system-query-i32-copy/package.json')} */
const packet=JSON.parse(original['package.json'].toString('utf8'));
/** @type {typeof import('./testdata/system-query-i32-copy/official-oracle.json')} */
const oracle=JSON.parse(original['official-oracle.json'].toString('utf8'));
/** @type {typeof import('./testdata/system-query-i32-copy/request.json')} */
const request=JSON.parse(original['request.json'].toString('utf8'));
const context={family:'tsfg.system-query-context-candidate',version:6,requestBytes:original['request.json'],expectedPackageId:packet.packageId};
const facts=readSystemQueryFacts(original['package.json'],context),core=emitSystemQueryCore(facts,context),system=facts.systems[0],loop=system.loops[0];
const copy=loop.statements[0].value;assert.ok(copy?.target&&copy.value);
const destination=facts.components.find(row=>row.declaration.name==='CopyDestination'),sourceComponent=facts.components.find(row=>row.declaration.name==='CopySource');
assert.ok(destination&&sourceComponent);
const hasAnchor=(line,range)=>line.includes('tsfg_source.start = '+range.start+' : i64')&&line.includes('tsfg_source.end = '+range.end+' : i64');
const coreLoad=core.split('\n').find(line=>line.includes('"tsfg.field_load"')),coreStore=core.split('\n').find(line=>line.includes('"tsfg.field_store"'));
assert.ok(coreLoad&&coreStore);
const loaded=coreLoad.match(/(%\w+) = "tsfg\.field_load"/);assert.ok(loaded);

test('genuine i32 copy owns the complete official Source, context and typed field transport',()=>{
  for(const [name,hash]of Object.entries(pins))assert.equal(sha256(original[name]),'sha256:'+hash,name);
  const text=original['source.ts'].toString('utf8');
  assert.equal(original['source.ts'].length,472);assert.equal(text.length,470);assert.deepEqual(oracle.sourceRange,{start:0,end:text.length});
  assert.equal(oracle.sourceSha256,pins['source.ts']);assert.deepEqual(printSystemQueryFacts(facts,context),original['package.json']);
  assert.deepEqual(facts.program,packet.payload.program);assert.deepEqual(facts.nodes,packet.payload.nodes);
  assert.deepEqual(facts.program.config,request.input.config);assert.deepEqual(facts.program.target,request.input.target);assert.deepEqual(facts.program.declarations,request.input.declarations);
  assert.equal(facts.program.files.length,3);assert.deepEqual(facts.program.files.map(row=>row.path),request.input.files.map(row=>row.path));
  for(const expected of request.input.files){
    const actual=facts.program.files.find(row=>row.path===expected.path);assert.ok(actual);
    assert.equal(actual.content,expected.content);assert.equal(actual.sha256,expected.sha256);
    assert.equal(actual.byteLength,Buffer.byteLength(expected.content));assert.equal(actual.utf16Length,expected.content.length);
  }
  assert.equal(facts.program.files.find(row=>row.path==='/src/main.ts').content,text);
  assert.equal(facts.program.files.find(row=>row.path==='/src/minimal-arrays-v8.d.ts').sha256,'0d30a2f626bb7455decf36f5a7a8d3308d4254100d2cb10e7c0d2353d28b141e');
  assert.equal(facts.program.files.find(row=>row.path==='/src/system-query-context.d.ts').sha256,'7fefda1fbc86170ff7c6479a4f3646ff8194b8dc5f7476107763c3c11fab604b');
  assert.deepEqual(oracle.members.map(row=>row.name),['CopyDestination','CopySource','copyI32','unused','Box']);
  for(const expected of oracle.members){
    const matches=facts.nodes.filter(row=>row.sourcePath==='/src/main.ts'&&row.kind===expected.kind&&canonical(row.range)===canonical(expected.range));
    assert.equal(matches.length,1);assert.equal(matches[0].name,expected.name);assert.deepEqual(matches[0].nameRange,expected.nameRange);
    assert.equal(text.slice(expected.nameRange.start,expected.nameRange.end),expected.name);
  }
  assert.equal(facts.systems.length,1);assert.equal(facts.scalarHelpers.length,0);assert.equal(system.declaration.id,oracle.systemId);
  assert.deepEqual(system.declaration.range,oracle.members[2].range);assert.deepEqual(system.declaration.nameRange,oracle.members[2].nameRange);
  assert.equal(system.parameters.length,1);assert.equal(system.parameters[0].binding.id,oracle.queryBinding);assert.ok(system.parameters[0].query);
  assert.equal(system.loops.length,1);assert.deepEqual(loop.range,oracle.loop);assert.equal(loop.queryBinding,oracle.queryBinding);
  assert.equal(loop.localBindings.length,0);assert.equal(loop.statements.length,1);assert.deepEqual(loop.statements[0].range,oracle.statement);
  assert.equal(copy.kind,'fieldAssignment');assert.equal(copy.sourceType,'i32');assert.equal(copy.type,scalarTypeIds.i32);
  assert.equal(copy.operator,'=');assert.deepEqual(copy.range,oracle.expression);assert.deepEqual(copy.operatorRange,oracle.operator);
  assert.equal(text.slice(oracle.expression.start,oracle.expression.end),'dst.n = src.n');
  for(const [index,field]of [copy.target,copy.value].entries()){
    const expected=oracle.fields[index],component=index===0?destination:sourceComponent,binding=loop.bindings[index],selection=system.parameters[0].query.items[index];
    assert.deepEqual(component.declaration.range,expected.component.range);assert.deepEqual(component.declaration.nameRange,expected.component.nameRange);assert.notEqual(component.typeId,component.sourceType);
    const raw=packet.payload.types.find(row=>row.id===component.sourceType);assert.ok(raw?.fields);
    const fieldIndex=raw.fields.findIndex(row=>row.id===expected.fieldId);assert.ok(fieldIndex>=0);const declaration=raw.fields[fieldIndex];
    assert.equal(declaration.type,'i32');assert.equal(declaration.readonly,false);assert.equal(declaration.access,'public');
    assert.deepEqual(declaration.origin,{source:'/src/main.ts',...expected.field.range});
    assert.equal(field.kind,index===0?'fieldTarget':'fieldAccess');assert.equal(field.sourceType,'i32');assert.equal(field.type,scalarTypeIds.i32);
    assert.equal(field.property,commonFieldId(component.typeId,'n',fieldIndex));assert.equal(field.sourceField,expected.fieldId);
    assert.deepEqual(field.range,expected.access);assert.deepEqual(field.nameRange,expected.nameRange);assert.ok(field.receiver);
    assert.equal(field.receiver.binding,expected.bindingId);assert.deepEqual(field.receiver.range,expected.receiver);
    assert.equal(binding.declaration.id,expected.bindingId);assert.deepEqual(binding.declaration.range,expected.bindingRange);
    assert.equal(binding.mode,expected.mode);assert.equal(binding.componentType,component.typeId);assert.equal(binding.sourceComponentType,component.sourceType);
    assert.equal(selection.mode,expected.mode);assert.equal(selection.componentType,component.typeId);
  }
  assert.equal(core.split('"tsfg.field_load"').length-1,1);assert.equal(core.split('"tsfg.field_store"').length-1,1);
  assert.ok(coreLoad.includes(' -> i32')&&hasAnchor(coreLoad,oracle.fields[1].access));
  assert.ok(coreStore.includes(', '+loaded[1]+')')&&coreStore.includes(', i32) -> ()')&&hasAnchor(coreStore,oracle.expression));
  assert.equal(core.split('\n').some(line=>/^\s*(?:%\w+ = )?"tsfg_core\./.test(line)),false,'no i32 arithmetic, literal or conversion is emitted');
  assert.ok(core.includes('tsfg.query_facts = '+coreQuote(canonical(packet))));
  assert.ok(core.includes('tsfg.query_request = '+coreQuote(canonical(request))));
});

/** @type {Array<[string,(value:typeof packet.payload)=>void]>} */
const mutations=[
  ['foreign field',value=>{value.systems[0].loops[0].statements[0].value.target.property=oracle.fields[1].fieldId;}],
  ['foreign Source anchor',value=>{value.systems[0].loops[0].statements[0].value.value.nameRange.start++;}],
  ['mixed field width',value=>{const rhs=value.systems[0].loops[0].statements[0].value.value;rhs.type='f32';rhs.flowType='f32';}],
  ['i32 compound',value=>{value.systems[0].loops[0].statements[0].value.operator='+=';}],
  ['forged Read destination',value=>{value.systems[0].loops[0].bindings[0].mode='read';}],
  ['forged readonly field',value=>{const row=value.types.find(row=>row.name==='CopyDestination');assert.ok(row?.fields);const field=row.fields.find(row=>row.name==='n');assert.ok(field);field.readonly=true;}],
];
for(const [name,mutate]of mutations)test('i32 cold Source boundary rejects rehashed '+name,()=>{
  // These are explicitly corrupted transport negatives, never official Go outputs.
  const changed=structuredClone(packet);mutate(changed.payload);
  changed.packageId=sha256('tsfg.system-query.package.v6\0'+changed.schemaHash+'\0'+canonical(changed.payload));
  assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(changed)+'\n'),{...context,expectedPackageId:changed.packageId}),TypeError);
});
test('i32 facts and emitter reject a foreign packet identity and original request',()=>{
  const wrong={...context,expectedPackageId:'sha256:'+'0'.repeat(64)};
  assert.throws(()=>readSystemQueryFacts(original['package.json'],wrong),TypeError);assert.throws(()=>emitSystemQueryCore(facts,wrong),TypeError);
  const changed=structuredClone(request);changed.input.config.strict=false;
  assert.throws(()=>readSystemQueryFacts(original['package.json'],{...context,requestBytes:Buffer.from(canonical(changed)+'\n')}),TypeError);
});

const tool=process.env.TSFG_QUERY_LLVM_EXE,output=process.env.TSFG_QUERY_LLVM_OUTPUT;
const skip=tool&&output?false:'TSFG_QUERY_LLVM_EXE and TSFG_QUERY_LLVM_OUTPUT are not supplied';
/** @type {Array<{name:string,command:string,pid:number|undefined,status:number|null,signal:string|null,error:string|null,inputHash:string,stdoutHash:string,stderrHash:string}>} */
const children=[];
const run=(name,input,command='--canonicalize',status=0)=>{
  assert.ok(tool&&output);assert.match(tool,/^E:[\\/]/i);assert.match(output,/^E:[\\/]/i);
  const directory=output+'/i32-copy';mkdirSync(directory,{recursive:true});const prefix=directory+'/'+String(children.length).padStart(3,'0')+'-'+name;
  writeFileSync(prefix+'-input.txt',input,{flag:'wx'});
  const child=spawnSync(tool,['--system-query',command],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
  const stdout=child.stdout??Buffer.alloc(0),stderr=child.stderr??Buffer.alloc(0);
  writeFileSync(prefix+'-stdout.bin',stdout,{flag:'wx'});writeFileSync(prefix+'-stderr.bin',stderr,{flag:'wx'});
  children.push({name,command,pid:child.pid,status:child.status,signal:child.signal,error:child.error?.message??null,inputHash:sha256(input),stdoutHash:sha256(stdout),stderrHash:sha256(stderr)});
  writeFileSync(directory+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.ifError(child.error);assert.equal(child.signal,null);assert.equal(child.status,status,stderr.toString('utf8'));
  if(status===0)assert.equal(stderr.length,0);else assert.equal(stdout.length,0);
  return stdout.toString('utf8');
};
// Decode printed string attributes only. Production uses real MLIR/LLVM parsers.
const quoted=(text,marker)=>{
  const start=text.indexOf(marker);assert.ok(start>=0,marker);const bytes=[];
  for(let i=start+marker.length;i<text.length;i++){
    const c=text[i];if(c==='"')return Buffer.from(bytes).toString('utf8');
    if(c==='\\'){const hex=text.slice(i+1,i+3);if(/^[0-9a-f]{2}$/i.test(hex)){bytes.push(Number.parseInt(hex,16));i+=2;}else{const escaped=text[++i];bytes.push(({n:10,r:13,t:9})[escaped]??escaped.charCodeAt(0));}}
    else{const point=text.codePointAt(i);assert.notEqual(point,undefined);const value=String.fromCodePoint(point);bytes.push(...Buffer.from(value));i+=value.length-1;}
  }
  assert.fail('unterminated printed string');
};

test('real C++ verifies i32 copy layout, batch, effects and LLVM cold binding',{skip},()=>{
  const bound=run('bound',core);assert.equal(run('bound-cold',bound),bound);
  /** @type {{types:Array<{id:string,stride:number,alignment:number,fields:Array<{id:string,offset:number,type:string}>}>}} */
  const layouts=JSON.parse(quoted(bound,'tsfg.query_layouts = "'));
  for(const {component,stride,offset}of [{component:destination,stride:8,offset:4},{component:sourceComponent,stride:4,offset:0}]){
    const layout=layouts.types.find(row=>row.id===component.typeId);assert.ok(layout);assert.equal(layout.stride,stride);assert.equal(layout.alignment,4);
    const field=layout.fields.find(row=>row.id===(component===destination?copy.target.property:copy.value.property));assert.ok(field);assert.equal(field.offset,offset);assert.equal(field.type,scalarTypeIds.i32);
  }
  const batch=run('batch',bound,'--cpu-batch');assert.equal(run('batch-cold',batch),batch);
  /** @type {{version:number,execution:string,entries:Array<{sourceFunctionId:string,queryBinding:string,columns:Array<{componentType:string,mode:string,stride:number}>}>}} */
  const abi=JSON.parse(quoted(batch,'tsfg.cpu_batch_abi = "'));assert.equal(abi.version,1);assert.equal(abi.execution,'chunk-work-only');assert.equal(abi.entries.length,1);
  assert.equal(abi.entries[0].sourceFunctionId,oracle.systemId);assert.equal(abi.entries[0].queryBinding,oracle.queryBinding);
  assert.deepEqual(abi.entries[0].columns.map(row=>[row.componentType,row.mode,row.stride]).sort(),[[destination.typeId,'write',8],[sourceComponent.typeId,'read',4]].sort());
  const loads=batch.split('\n').filter(line=>line.includes('"memref.load"')),stores=batch.split('\n').filter(line=>line.includes('"memref.store"'));
  assert.equal(loads.length,1);assert.equal(stores.length,1);assert.match(loads[0],/-> i32$/);
  const result=loads[0].match(/(%\w+) =/);assert.ok(result);assert.ok(stores[0].includes('"memref.store"('+result[1]+', '));
  assert.ok(loads[0].includes('tsfg.batch.offset = 0 : i64')&&stores[0].includes('tsfg.batch.offset = 4 : i64'));
  assert.ok(hasAnchor(loads[0],oracle.fields[1].access)&&hasAnchor(stores[0],oracle.expression));
  assert.equal(batch.split('\n').some(line=>/^\s*(?:%\w+ = )?"arith\.(?:addi|subi|muli|divsi|divui|addf|subf|mulf|divf|trunci|extsi|extui|sitofp|fptosi|constant)"/.test(line)&&line.includes('i32')),false);
  const effectsRaw=run('effects',bound,'--effects'),effects=readSystemQueryEffects(Buffer.from(effectsRaw),facts,context);
  assert.equal(effects.systems.length,1);assert.deepEqual(effects.conflicts,[],'one genuine system is not a two-system conflict witness');
  assert.deepEqual(effects.systems[0].loops[0].operations.map(row=>[row.kind,row.sourceField,row.source]),[
    ['read',oracle.fields[1].fieldId,{path:'/src/main.ts',...oracle.fields[1].access}],['write',oracle.fields[0].fieldId,{path:'/src/main.ts',...oracle.expression}],
  ]);
  assert.deepEqual(effects.systems[0].fieldEffects.map(row=>[row.sourceField,row.readCount,row.writeCount]).sort(),[[oracle.fields[0].fieldId,0,1],[oracle.fields[1].fieldId,1,0]].sort());
  const dialect=run('llvm-dialect',batch,'--cpu-llvm');assert.equal(run('llvm-dialect-cold',dialect),dialect);
  const ir=run('llvm-ir',dialect,'--llvm-ir');assert.equal(run('llvm-ir-cold',ir,'--canonicalize-llvm-ir'),ir);
  const code=ir.split('\n!')[0],load=code.match(/(%[\w.]+) = load i32,/);assert.ok(load);
  assert.equal((code.match(/\bload i32,/g)??[]).length,1);assert.equal((code.match(/\bstore i32 /g)??[]).length,1);
  assert.ok(code.includes('store i32 '+load[1]+','));
  assert.equal(/\b(?:add|sub|mul|sdiv|udiv) i32\b|\b(?:sext|zext|sitofp) i32\b|\b(?:trunc|fptosi) [^\n]+ to i32\b|\b(?:fadd|fsub|fmul|fdiv)\b/.test(code),false);
  // True reader/API negatives, not offline predicate mutations or genuine Source examples.
  const boundLoad=bound.split('\n').find(line=>line.includes('"tsfg.field_load"')),boundStore=bound.split('\n').find(line=>line.includes('"tsfg.field_store"'));assert.ok(boundLoad&&boundStore);
  for(const [name,bad]of [
    ['wrong-field-type',bound.replace(boundLoad,boundLoad.replace('-> i32','-> f32')).replace(boundStore,boundStore.replace(', i32) -> ()',', f32) -> ()'))],
    ['wrong-source-anchor',bound.replace(boundLoad,boundLoad.replace('tsfg_source.start = '+oracle.fields[1].access.start+' : i64','tsfg_source.start = '+(oracle.fields[1].access.start+1)+' : i64'))],
    ['wrong-input-identity',bound.replace(/(tsfg_core.input_identity = "sha256:)([0-9a-f])/,(_,prefix,first)=>prefix+(first==='0'?'1':'0'))],
    ['wrong-bound-offset',bound.replace(/offset = 4 : i64/,'offset = 0 : i64')],
    ['wrong-source-field',bound.replace('source_field = '+coreQuote(oracle.fields[1].fieldId),'source_field = '+coreQuote(oracle.fields[0].fieldId))],
  ]){assert.notEqual(bad,bound,name);run(name,bad,'--canonicalize',3);}
  const badStore=ir.replace('store i32 '+load[1]+',','store i32 0,');assert.notEqual(badStore,ir);run('wrong-llvm-value',badStore,'--canonicalize-llvm-ir',3);
  for(const change of ['write-permission','invented-conflict']){
    const bad={...effects,conflicts:[...effects.conflicts],systems:effects.systems.map(system=>({...system,loops:system.loops.map(loop=>({...loop,columns:loop.columns.map(column=>({...column}))}))}))};
    if(change==='write-permission'){
      const column=bad.systems[0].loops[0].columns.find(row=>row.componentType===destination.typeId);assert.ok(column);column.mode='read';
    }else bad.conflicts.push({left:bad.systems[0].functionId,right:bad.systems[0].functionId,components:[destination.typeId]});
    assert.throws(()=>readSystemQueryEffects(Buffer.from(canonical(bad)+'\n'),facts,context),TypeError);
  }
});

// A second complete official Source packet, not duplicated systems in a DTO.
const conflictFixture=new URL('conflict/',fixture);
const conflictOriginal=Object.fromEntries(['source.ts','request.json','official-oracle.json','package.json'].map(name=>[name,readFileSync(new URL(name,conflictFixture))]));
const conflictPins={
  'source.ts':'7810c1e100d02e074699bab421836de5f5591029e7577de10a5e829d1e4ecf69',
  'request.json':'0bf3cfe42ed286e1530f1ed84267c342ee0a91d84804fc6191f88a775ac0f8e9',
  'official-oracle.json':'38cc8ae9dea15dffc6defe497cc1a5a5d432e7dca6499db89ac1662d0d37354d',
  'package.json':'8a2d7beb490ee2368ba336ddbc192e7c57b6c528a22a702eb9604e17c0307c3c',
};
/** @type {typeof import('./testdata/system-query-i32-copy/conflict/package.json')} */
const conflictPacket=JSON.parse(conflictOriginal['package.json'].toString('utf8'));
/** @type {typeof import('./testdata/system-query-i32-copy/conflict/official-oracle.json')} */
const conflictOracle=JSON.parse(conflictOriginal['official-oracle.json'].toString('utf8'));
/** @type {typeof import('./testdata/system-query-i32-copy/conflict/request.json')} */
const conflictRequest=JSON.parse(conflictOriginal['request.json'].toString('utf8'));
const conflictContext={family:'tsfg.system-query-context-candidate',version:6,requestBytes:conflictOriginal['request.json'],expectedPackageId:conflictPacket.packageId};
const conflictFacts=readSystemQueryFacts(conflictOriginal['package.json'],conflictContext),conflictCore=emitSystemQueryCore(conflictFacts,conflictContext);
const sharedDestination=conflictFacts.components.find(row=>row.declaration.name==='CopyDestination'),sharedSource=conflictFacts.components.find(row=>row.declaration.name==='CopySource');
assert.ok(sharedDestination&&sharedSource);

test('two genuine i32 systems retain distinct Source bindings and one shared writable field',()=>{
  for(const [name,hash]of Object.entries(conflictPins))assert.equal(sha256(conflictOriginal[name]),'sha256:'+hash,name);
  const text=conflictOriginal['source.ts'].toString('utf8');assert.equal(conflictOriginal['source.ts'].length,625);assert.equal(text.length,623);
  assert.equal(conflictOracle.sourceSha256,conflictPins['source.ts']);assert.deepEqual(conflictOracle.sourceRange,{start:0,end:text.length});
  assert.deepEqual(printSystemQueryFacts(conflictFacts,conflictContext),conflictOriginal['package.json']);
  assert.deepEqual(conflictFacts.program,conflictPacket.payload.program);assert.deepEqual(conflictFacts.nodes,conflictPacket.payload.nodes);
  assert.equal(conflictFacts.program.files.length,3);assert.deepEqual(conflictFacts.program.config,conflictRequest.input.config);assert.deepEqual(conflictFacts.program.target,conflictRequest.input.target);
  for(const original of conflictRequest.input.files){
    const actual=conflictFacts.program.files.find(row=>row.path===original.path);assert.ok(actual);
    assert.equal(actual.content,original.content);assert.equal(actual.sha256,original.sha256);assert.equal(actual.byteLength,Buffer.byteLength(original.content));assert.equal(actual.utf16Length,original.content.length);
  }
  assert.deepEqual(conflictOracle.members.map(row=>row.name),['CopyDestination','CopySource','copyI32','copyAgain','unused','Box']);
  for(const expected of conflictOracle.members){
    const matches=conflictFacts.nodes.filter(row=>row.sourcePath===expected.sourcePath&&row.kind===expected.kind&&canonical(row.range)===canonical(expected.range));
    assert.equal(matches.length,1);assert.equal(matches[0].name,expected.name);assert.deepEqual(matches[0].nameRange,expected.nameRange);
  }
  assert.equal(conflictFacts.systems.length,2);assert.equal(conflictFacts.scalarHelpers.length,0);
  assert.equal(new Set(conflictOracle.systems.map(row=>row.systemId)).size,2);
  /** @type {Set<string>} */
  const semanticIds=new Set();
  for(const expected of conflictOracle.systems){
    const system=conflictFacts.systems.find(row=>row.declaration.id===expected.systemId);assert.ok(system);
    assert.equal(system.declaration.name,expected.declaration.name);assert.deepEqual(system.declaration.range,expected.declaration.range);
    assert.equal(system.parameters.length,1);assert.ok(system.parameters[0].query);assert.equal(system.parameters[0].query.items.length,2);
    assert.equal(system.parameters[0].binding.id,expected.queryBinding);assert.deepEqual(system.parameters[0].binding.range,expected.queryRange);assert.equal(system.loops.length,1);
    const loop=system.loops[0],value=loop.statements[0].value;assert.ok(value?.target&&value.value);
    assert.deepEqual(loop.range,expected.loop);assert.equal(loop.queryBinding,expected.queryBinding);
    assert.equal(loop.bindings.length,2);assert.equal(loop.localBindings.length,0);assert.equal(loop.statements.length,1);assert.deepEqual(loop.statements[0].range,expected.statement);
    assert.equal(value.kind,'fieldAssignment');assert.equal(value.operator,'=');assert.equal(value.sourceType,'i32');assert.deepEqual(value.range,expected.expression);assert.deepEqual(value.operatorRange,expected.operator);
    for(const [index,field]of [value.target,value.value].entries()){
      const original=expected.fields[index],component=index===0?sharedDestination:sharedSource,binding=loop.bindings[index],selection=system.parameters[0].query.items[index];
      assert.equal(field.kind,index===0?'fieldTarget':'fieldAccess');assert.equal(field.sourceType,'i32');assert.equal(field.type,scalarTypeIds.i32);assert.equal(field.sourceField,original.fieldId);
      assert.deepEqual(field.range,original.access);assert.deepEqual(field.nameRange,original.nameRange);assert.ok(field.receiver);
      assert.equal(field.receiver.binding,original.bindingId);assert.deepEqual(field.receiver.range,original.receiver);
      assert.equal(binding.declaration.id,original.bindingId);assert.deepEqual(binding.declaration.range,original.bindingRange);
      assert.equal(binding.mode,original.mode);assert.equal(binding.componentType,component.typeId);assert.equal(selection.mode,original.mode);assert.equal(selection.componentType,component.typeId);
      const raw=conflictPacket.payload.types.find(row=>row.id===component.sourceType);assert.ok(raw?.fields);const fieldIndex=raw.fields.findIndex(row=>row.id===original.fieldId);assert.ok(fieldIndex>=0);
      assert.equal(raw.fields[fieldIndex].readonly,false);assert.equal(field.property,commonFieldId(component.typeId,'n',fieldIndex));
    }
    const declaration=conflictCore.split('\n').find(line=>line.trimStart().startsWith('func.func @')&&line.includes('tsfg.query_source_function = '+coreQuote(expected.systemId)));assert.ok(declaration);
    const semantic=declaration.match(/tsfg_core\.function_id = "(sha256:[0-9a-f]{64})"/);assert.ok(semantic);assert.notEqual(semantic[1],expected.systemId);semanticIds.add(semantic[1]);
  }
  assert.equal(semanticIds.size,2);
  for(const index of [0,1]){
    assert.equal(conflictOracle.systems[0].fields[index].fieldId,conflictOracle.systems[1].fields[index].fieldId);
    assert.notEqual(conflictOracle.systems[0].fields[index].bindingId,conflictOracle.systems[1].fields[index].bindingId);
  }
});

test('actual C++ i32 conflict comes from shared Write destination, not shared Read source',{skip},()=>{
  const raw=run('shared-write-effects',conflictCore,'--effects'),effects=readSystemQueryEffects(Buffer.from(raw),conflictFacts,conflictContext);
  assert.equal(effects.systems.length,2);assert.equal(new Set(effects.systems.map(row=>row.functionId)).size,2);
  for(const actual of effects.systems){
    const expected=conflictOracle.systems.find(row=>row.systemId===actual.sourceFunctionId);assert.ok(expected);assert.notEqual(actual.functionId,actual.sourceFunctionId);
    assert.ok(conflictCore.includes('tsfg_core.function_id = '+coreQuote(actual.functionId)));
    assert.deepEqual(actual.capabilities.map(row=>[row.componentType,row.mode]).sort(),[[sharedDestination.typeId,'write'],[sharedSource.typeId,'read']].sort());
    assert.equal(actual.loops.length,1);assert.deepEqual(actual.loops[0].operations.map(row=>[row.kind,row.sourceField,row.source]),[
      ['read',expected.fields[1].fieldId,{path:'/src/main.ts',...expected.fields[1].access}],['write',expected.fields[0].fieldId,{path:'/src/main.ts',...expected.expression}],
    ]);
    assert.deepEqual(actual.fieldEffects.map(row=>[row.sourceField,row.readCount,row.writeCount]).sort(),[[expected.fields[0].fieldId,0,1],[expected.fields[1].fieldId,1,0]].sort());
  }
  assert.equal(effects.conflicts.length,1);const conflict=effects.conflicts[0];
  assert.deepEqual([conflict.left,conflict.right].sort(),effects.systems.map(row=>row.functionId).sort());assert.notEqual(conflict.left,conflict.right);
  assert.deepEqual(conflict.components,[sharedDestination.typeId]);assert.equal(conflict.components.includes(sharedSource.typeId),false);
  // Unlike the true pair above, these are corrupted-report reader negatives.
  for(const conflicts of [[],[{...conflict,components:[sharedSource.typeId]}]])
    assert.throws(()=>readSystemQueryEffects(Buffer.from(canonical({...effects,conflicts})+'\n'),conflictFacts,conflictContext),TypeError);
});

const additionFixture=new URL('./testdata/system-query-i32-addition/',import.meta.url);
const additionPins={
  'source.ts':'d5bdb6679b7668844b4085dc87be666d9074f2b52b6b2726ced49bbbd4d5d9d5',
  'request.json':'e96cdbe7d6c78b06b15d0dc4793b81616edcb53de27ce9fd7ca28a4ed369fb22',
  'official-oracle.json':'56136fd9c543935557c241c1bbb1ddd0848933097f54f9431348186f259a80f0',
  'package.json':'bd7c61229a118e33bf88b7fc69a798f07c7cde0c4adfb7916b4c7baa4d727657',
};
const additionOriginal=Object.fromEntries(Object.keys(additionPins).map(name=>[name,readFileSync(new URL(name,additionFixture))]));
/** @type {typeof import('./testdata/system-query-i32-addition/package.json')} */
const additionPacket=JSON.parse(additionOriginal['package.json'].toString('utf8'));
/** @type {typeof import('./testdata/system-query-i32-addition/official-oracle.json')} */
const additionOracle=JSON.parse(additionOriginal['official-oracle.json'].toString('utf8'));
const additionContext={family:'tsfg.system-query-context-candidate',version:6,requestBytes:additionOriginal['request.json'],expectedPackageId:additionPacket.packageId};
const additionFacts=readSystemQueryFacts(additionOriginal['package.json'],additionContext);
const additionCore=emitSystemQueryCore(additionFacts,additionContext);

test('genuine i32 field addition retains the v6 packet and original typed Core dataflow',()=>{
  for(const [name,hash] of Object.entries(additionPins))assert.equal(sha256(additionOriginal[name]),'sha256:'+hash,name);
  const source=additionOriginal['source.ts'].toString('utf8'),original=additionOracle.addition;
  assert.equal(additionOracle.sourceSha256,additionPins['source.ts']);
  assert.deepEqual(additionOracle.sourceRange,{start:0,end:source.length});
  assert.deepEqual(printSystemQueryFacts(additionFacts,additionContext),additionOriginal['package.json']);
  assert.deepEqual(additionFacts.program,additionPacket.payload.program);
  assert.deepEqual(additionFacts.nodes,additionPacket.payload.nodes);
  assert.equal(additionFacts.program.files.find(file=>file.path==='/src/main.ts').content,source);
  const owned=additionFacts.systems[0];
  assert.equal(owned.declaration.id,additionOracle.systemId);
  const loop=owned.loops[0],assignment=loop.statements[0].value;
  assert.equal(loop.queryBinding,additionOracle.queryBinding);
  assert.deepEqual(loop.bindings.map(binding=>[binding.mode,binding.declaration.id]),additionOracle.fields.map(field=>[field.mode,field.bindingId]));
  assert.ok(assignment?.target&&assignment.value?.left&&assignment.value?.right);
  const {target,value:addition}=assignment,{left,right}=addition;
  assert.equal(assignment.operator,'=');
  assert.deepEqual(assignment.range,additionOracle.expression);
  assert.deepEqual([target.sourceField,left.sourceField],additionOracle.fields.map(field=>field.fieldId));
  assert.deepEqual([target.range,left.range],additionOracle.fields.map(field=>field.access));
  assert.deepEqual([addition.operator,addition.sourceType,addition.range,addition.operatorRange],['+','i32',original.range,original.operator]);
  assert.deepEqual([right.kind,right.type,right.token,right.decimal,right.range],['numericLiteral',scalarTypeIds.i32,original.token,original.decimal,original.literal]);
  assert.equal(source.slice(original.literal.start,original.literal.end),'1');
  const rows=additionCore.split('\n');
  const load=rows.find(line=>line.includes('"tsfg.field_load"'));
  const literal=rows.find(line=>line.includes('"tsfg_core.constant"'));
  const add=rows.find(line=>line.includes('"tsfg_core.add"'));
  const store=rows.find(line=>line.includes('"tsfg.field_store"'));
  assert.ok(load&&literal&&add&&store);
  const loaded=load.match(/(%\w+) = /),constant=literal.match(/(%\w+) = /),result=add.match(/(%\w+) = /);
  assert.ok(loaded&&constant&&result);
  assert.match(literal,/value = 1 : i32.*-> i32$/);
  assert.ok(add.includes('"tsfg_core.add"('+loaded[1]+', '+constant[1]+')'));
  assert.match(add,/\(i32, i32\) -> i32$/);
  assert.ok(store.includes(', '+result[1]+')'));
  assert.ok(hasAnchor(load,additionOracle.fields[1].access)&&hasAnchor(literal,original.literal)&&hasAnchor(add,original.range)&&hasAnchor(store,additionOracle.expression));
  assert.ok(add.includes('operator_start = '+original.operator.start+' : i64')&&add.includes('operator_end = '+original.operator.end+' : i64'));
});

test('i32 field addition rejects forged literal, operator and write permission',()=>{
  /** @type {Array<(value:typeof additionPacket.payload)=>void>} */
  const corruptions=[
    payload=>{payload.systems[0].loops[0].statements[0].value.value.right.decimal='2';},
    payload=>{payload.systems[0].loops[0].statements[0].value.value.operator='-';},
    payload=>{payload.systems[0].loops[0].bindings[0].mode='read';},
  ];
  for(const corrupt of corruptions){
    const changed=structuredClone(additionPacket);
    corrupt(changed.payload);
    changed.packageId=sha256('tsfg.system-query.package.v6\0'+changed.schemaHash+'\0'+canonical(changed.payload));
    assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(changed)+'\n'),{...additionContext,expectedPackageId:changed.packageId}),TypeError);
  }
});

test('real C++ i32 field addition preserves bound layouts, effects, and wrapping LLVM SSA',{skip},()=>{
  const bound=run('addition-bound',additionCore);
  assert.equal(run('addition-bound-cold',bound),bound);
  const batch=run('addition-batch',bound,'--cpu-batch');
  assert.equal(run('addition-batch-cold',batch),batch);
  const load=batch.split('\n').find(line=>line.includes('"memref.load"'));
  const add=batch.split('\n').find(line=>line.includes('"arith.addi"')&&line.endsWith('-> i32'));
  const store=batch.split('\n').find(line=>line.includes('"memref.store"'));
  assert.ok(load&&add&&store);
  assert.match(load,/-> i32$/);
  assert.ok(load.includes('tsfg.batch.offset = 0 : i64')&&store.includes('tsfg.batch.offset = 4 : i64'));
  assert.ok(hasAnchor(add,additionOracle.addition.range)&&hasAnchor(load,additionOracle.fields[1].access)&&hasAnchor(store,additionOracle.expression));
  const effects=readSystemQueryEffects(Buffer.from(run('addition-effects',bound,'--effects')),additionFacts,additionContext);
  assert.deepEqual(effects.conflicts,[]);
  assert.deepEqual(effects.systems[0].loops[0].operations.map(row=>[row.kind,row.sourceField,row.source]),[
    ['read',additionOracle.fields[1].fieldId,{path:'/src/main.ts',...additionOracle.fields[1].access}],
    ['write',additionOracle.fields[0].fieldId,{path:'/src/main.ts',...additionOracle.expression}],
  ]);
  const dialect=run('addition-llvm-dialect',batch,'--cpu-llvm');
  assert.equal(run('addition-llvm-dialect-cold',dialect),dialect);
  const ir=run('addition-llvm-ir',dialect,'--llvm-ir');
  assert.equal(run('addition-llvm-ir-cold',ir,'--canonicalize-llvm-ir'),ir);
  const code=ir.split('\n!')[0],loaded=code.match(/(%[\w.]+) = load i32,/),summed=code.match(/(%[\w.]+) = add i32 (%[\w.]+), 1(?:\s|$)/);
  assert.ok(loaded&&summed);
  assert.equal(summed[2],loaded[1]);
  assert.match(code,new RegExp('store i32 '+summed[1].replaceAll('.','\\.')+','));
  assert.equal((code.match(/\badd i32\b/g)??[]).length,1);
  assert.doesNotMatch(code,/\badd (?:nsw|nuw)\b[^\n]* i32\b/);
  const badLiteral=bound.replace(/("tsfg_core\.constant"\(\) \{[^\n]*value = )1 : i32/,(_,prefix)=>prefix+'2 : i32');
  const badAdd=ir.replace(' = add i32 '+loaded[1]+', 1',' = add nsw i32 '+loaded[1]+', 1');
  assert.notEqual(badLiteral,bound);
  assert.notEqual(badAdd,ir);
  run('addition-wrong-core-literal',badLiteral,'--canonicalize',3);
  run('addition-forged-llvm-wrap-flag',badAdd,'--canonicalize-llvm-ir',3);
});
