// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {canonical} from '../../compiler/identity.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';
import {readSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore} from '../../compiler/system-query-core.mjs';
import {readSystemQueryEffects} from '../../compiler/system-query-effects.mjs';
import {compileSystemQuery} from '../../compiler/pipeline.mjs';

const cases=[...['architecture','aliases','duplicate','complete','wrapper-alias','loop-architecture','loop-aliases','loop-multiple','loop-shared-component','loop-inheritance'].map(name=>['system-query',name]),
  ['system-query-effects','multi'],...['direct','imported','local-export'].map(name=>['system-query-scalars',name]),
  ...['view-direct','view-imported','view-aliases','view-same-owner','view-parenthesized'].map(name=>['system-query-views',name])].map(([directory,name])=>{
    const bytes=readFileSync(new URL('./testdata/'+directory+'/'+name+'-facts.json',import.meta.url)),packet=JSON.parse(bytes.toString('utf8'));
    return {name,bytes,packet,context:{family:'tsfg.system-query-context-candidate',version:6,requestBytes:readFileSync(new URL('./testdata/'+directory+'/'+name+'-request.json',import.meta.url)),expectedPackageId:packet.packageId}};
  });
const tool=process.env.TSFG_QUERY_BATCH_EXE,output=process.env.TSFG_QUERY_BATCH_OUTPUT,enabled=Boolean(tool&&output),children=[];
const run=(name,input,command='--cpu-batch',status=0)=>{
  mkdirSync(output,{recursive:true});const prefix=output+'/'+String(children.length).padStart(3,'0')+'-'+name;
  const child=spawnSync(tool,['--system-query',command],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
  writeFileSync(prefix+'-input.mlir',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name,command,pid:child.pid,status:child.status,error:child.error?.message??null,stdoutBytes:child.stdout?.length,stderr:child.stderr?.toString('utf8')});writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.equal(child.status,status,child.stderr?.toString('utf8'));assert.ifError(child.error);return child.stdout.toString('utf8');
};
// Decode only quoted builtin string attributes in retained, verified MLIR.
// The real dialect parser/verifier remains the independent C++ consumer.
const attribute=(text,name)=>{
  const marker=name+' = "',start=text.indexOf(marker);assert.ok(start>=0,name);const bytes=[];
  for(let i=start+marker.length;i<text.length;i++){
    const c=text[i];if(c==='"')return {value:Buffer.from(bytes).toString('utf8'),token:text.slice(start+marker.length-1,i+1)};
    if(c==='\\'){
      const hex=text.slice(i+1,i+3);if(/^[0-9a-f]{2}$/i.test(hex)){bytes.push(Number.parseInt(hex,16));i+=2;}
      else {const escaped=text[++i];bytes.push(({n:10,r:13,t:9})[escaped]??escaped.charCodeAt(0));}
    }else {const point=text.codePointAt(i),value=String.fromCodePoint(point);bytes.push(...Buffer.from(value));i+=value.length-1;}
  }
  assert.fail('unterminated attribute '+name);
};

test('CPU batch public pipeline retains current-manifest and original-context gates',{skip:!enabled},async()=>{
  const input=cases.find(row=>row.name==='view-parenthesized');
  await assert.rejects(compileSystemQuery(input.bytes,{...input.context,expectedPackageId:'sha256:'+'0'.repeat(64)},{core:tool,cpuBatch:true}),/identity|differs/);
  await assert.rejects(compileSystemQuery(input.bytes,input.context,{core:'missing',cpuBatch:true}),/artifact-manifest|ENOENT/);
});

for(const input of cases)test('actual Query to standard CPU batch: '+input.name,{skip:!enabled},()=>{
  const facts=readSystemQueryFacts(input.bytes,input.context),batch=run(input.name,emitSystemQueryCore(facts,input.context)),abi=JSON.parse(attribute(batch,'tsfg.cpu_batch_abi').value);
  assert.equal(abi.version,1);assert.equal(abi.execution,'chunk-work-only');assert.equal(abi.entries.length,facts.systems.reduce((n,system)=>n+system.loops.length,0));
  assert.equal(attribute(batch,'tsfg_core.input_identity').value,facts.inputIdentity);
  assert.ok(!/^\s*(?:%[^=]+ = )?"tsfg\./m.test(batch));
  assert.ok(batch.split('\n').filter(line=>/^\s*"func.func"\(/.test(line)).every(line=>!line.includes('!tsfg.')));
  assert.ok(attribute(batch,'tsfg.cpu_batch_source').value.includes('tsfg.query_facts'));
  const effects=readSystemQueryEffects(Buffer.from(attribute(batch,'tsfg.cpu_batch_effects').value),facts,input.context);
  assert.equal(effects.systems.length,facts.systems.length);
  for(const entry of abi.entries){
    const system=facts.systems.find(system=>system.declaration.id===entry.sourceFunctionId),loop=system.loops[entry.loop];assert.equal(entry.queryBinding,loop.queryBinding);
    assert.deepEqual(entry.columns.map(column=>column.componentType),[...new Set(loop.bindings.map(binding=>binding.componentType))].sort());
    assert.equal(entry.rowCountArgument,0);assert.equal(entry.tupleOccurrences.length,loop.bindings.length);
    for(const tuple of entry.tupleOccurrences){const binding=loop.bindings[tuple.tupleIndex],column=entry.columns.find(column=>column.componentType===binding.componentType);
      assert.equal(tuple.sourceBinding,binding.declaration.id);assert.equal(tuple.mode,binding.mode);assert.equal(tuple.bufferArgument,column.bufferArgument);
      assert.equal(column.mode,loop.bindings.some(binding=>binding.componentType===column.componentType&&binding.mode==='write')?'write':'read');
    }
  }
  if(['loop-shared-component','loop-inheritance','view-imported','view-parenthesized'].includes(input.name)){
    assert.equal(run(input.name+'-roundtrip',batch,'--canonicalize'),batch);assert.equal(run(input.name+'-optimize',batch,'--optimize'),batch);
    const cold=readSystemQueryEffects(Buffer.from(run(input.name+'-effects',batch,'--effects')),facts,input.context);assert.deepEqual(cold,effects);
  }
  if(input.name==='loop-shared-component')assert.equal(abi.entries[0].columns.length,1);
  if(input.name==='loop-inheritance'){
    const ids=new Map(facts.components.map(row=>[row.typeId,row.declaration.name]));
    assert.deepEqual(abi.entries[0].columns.map(column=>[ids.get(column.componentType),column.stride]).sort(),[['Position',16],['Velocity',8]]);
    const loads=batch.split('\n').filter(line=>line.includes('"memref.load"'));
    assert.deepEqual(loads.map(line=>Number(line.match(/tsfg\.batch\.offset = (\d+) : i64/)[1])),[8,0,12,4]);
  }
  if(input.name==='view-parenthesized'){
    assert.ok(batch.includes('"scf.for"'));assert.ok(batch.includes('"memref.view"'));assert.ok(batch.includes('"arith.muli"'));
    assert.ok(!/fastmath[^\n]*(?:reassoc|contract|fast>)/.test(batch));
    const calls=batch.split('\n').filter(line=>line.includes('"func.call"'));assert.equal(calls.length,3);
    assert.ok(calls.every(line=>line.includes('tsfg.batch.callee')));
    const helpers=new Map(facts.scalarHelpers.map(helper=>[helper.id,helper.declaration.name]));
    const components=new Map(facts.components.map(row=>[row.typeId,row.declaration.name]));
    const functions=batch.split(/\n  (?="func.func"\()/).slice(1);
    const update=facts.scalarHelpers.find(helper=>helper.declaration.name==='update');
    const events=body=>body.split('\n').flatMap(line=>{
      const op=line.match(/"([^"\n]+)"\(/)?.[1];
      if(op==='func.call')return ['call:'+helpers.get(line.match(/tsfg.batch.callee = "([^"]+)"/)[1])];
      if(op==='memref.load'||op==='memref.store')return [op+':'+components.get(line.match(/tsfg.batch.component_type = "([^"]+)"/)[1])+':'+line.match(/tsfg.batch.offset = (\d+)/)[1]];
      return op==='arith.mulf'||op==='arith.addf'?[op]:[];
    });
    // Independent Source oracle: compound target read precedes RHS read;
    // helper return completes before the outer assignment and later alias use.
    assert.deepEqual(events(functions.find(body=>body.includes('tsfg.batch.helper = '+coreQuote(update.id)))),['memref.load:Position:0','memref.load:Velocity:0','arith.mulf','arith.addf','memref.store:Position:0']);
    assert.deepEqual(events(functions[0]),['call:update','memref.store:Position:0','memref.load:Position:4','call:scaledX','arith.addf','memref.store:Position:4']);
  }
  if(input.name==='view-same-owner'){
    const update=facts.scalarHelpers.find(helper=>helper.declaration.name==='update');
    const call=batch.split('\n').find(line=>line.includes('"func.call"')&&line.includes('tsfg.batch.callee = '+coreQuote(update.id)));
    const args=call.match(/"func.call"\(([^)]+)\)/)[1].split(',').map(value=>value.trim());
    assert.equal(args[0],args[2]);assert.equal(args[1],args[3]);
  }
});

test('CPU batch cold verifier binds Source, byte addresses, strides, modes and call order',{skip:!enabled},()=>{
  const input=cases.find(row=>row.name==='view-parenthesized'),facts=readSystemQueryFacts(input.bytes,input.context),batch=run('mutations-base',emitSystemQueryCore(facts,input.context)),abiAttribute=attribute(batch,'tsfg.cpu_batch_abi'),abi=JSON.parse(abiAttribute.value);
  const lines=batch.split('\n'),multiply=lines.find(line=>line.includes('"arith.muli"')),address=lines.find(line=>line.includes('"arith.addi"')),load=lines.find(line=>line.includes('"memref.load"'));
  assert.ok(multiply&&address&&load);
  const args=multiply.match(/"arith.muli"\(([^)]+)\)/)[1].split(',').map(value=>value.trim());
  const addArgs=address.match(/"arith.addi"\(([^)]+)\)/)[1].split(',').map(value=>value.trim());
  const changedABI=structuredClone(abi);changedABI.entries[0].columns[0].stride+=4;
  const changedMode=structuredClone(abi);changedMode.entries[0].columns[0].mode=changedMode.entries[0].columns[0].mode==='read'?'write':'read';
  const update=facts.scalarHelpers.find(helper=>helper.declaration.name==='update'),call=lines.find(line=>line.includes('"func.call"')&&line.includes('tsfg.batch.callee = '+coreQuote(update.id)));
  assert.ok(call);const callArgs=call.match(/"func.call"\(([^)]+)\)/)[1].split(',').map(value=>value.trim());assert.equal(callArgs.length,5);
  const variants=[['stride-source',batch.replace(multiply,multiply.replace(args[1],args[0]))],
    ['address-offset',batch.replace(address,address.replace(addArgs[1],addArgs[0]))],
    ['field-layout',batch.replace(load,load.replace(/tsfg.batch.offset = (\d+) : i64/,(_,n)=>'tsfg.batch.offset = '+(Number(n)+4)+' : i64'))],
    ['abi-stride',batch.replace('tsfg.cpu_batch_abi = '+abiAttribute.token,'tsfg.cpu_batch_abi = '+coreQuote(canonical(changedABI)))],
    ['abi-mode',batch.replace('tsfg.cpu_batch_abi = '+abiAttribute.token,'tsfg.cpu_batch_abi = '+coreQuote(canonical(changedMode)))],
    ['call-column-order',batch.replace(call,call.replace(callArgs.join(', '),[callArgs[2],callArgs[3],callArgs[0],callArgs[1],callArgs[4]].join(', ')))],
    ['source-anchor',batch.replace(load,load.replace(/tsfg_source.start = (\d+)/,(_,n)=>'tsfg_source.start = '+(Number(n)+1)))],
    ['wrong-input',batch.replace('tsfg_core.input_identity = "sha256:','tsfg_core.input_identity = "sha256:0')],
    ['operation',batch.replace('"arith.mulf"','"arith.addf"')]];
  for(const [name,bad]of variants){assert.notEqual(bad,batch,name);assert.equal(run(name,bad,'--canonicalize',3),'');}
});
