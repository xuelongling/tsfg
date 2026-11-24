// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';
import {readSystemQueryFacts,systemQueryRequestContext} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore,escapeQueryCompilerBytes} from '../../compiler/system-query-core.mjs';
import {readSystemQueryTmeta,queryTmetaSchema} from '../../compiler/system-query-tmeta.mjs';
import {compileSystemQuery,readQueryCompilerOutputs} from '../../compiler/pipeline.mjs';

const cases=[...['architecture','aliases','duplicate','complete','wrapper-alias','loop-architecture','loop-aliases','loop-multiple','loop-shared-component','loop-inheritance'].map(name=>['system-query',name]),
  ['system-query-effects','multi'],...['direct','imported','local-export'].map(name=>['system-query-scalars',name]),
  ...['view-direct','view-imported','view-aliases','view-same-owner','view-parenthesized'].map(name=>['system-query-views',name])].map(([directory,name])=>{
    const bytes=readFileSync(new URL('./testdata/'+directory+'/'+name+'-facts.json',import.meta.url)),packet=JSON.parse(bytes.toString('utf8'));
    return {name,bytes,context:{family:'tsfg.system-query-context-candidate',version:6,requestBytes:readFileSync(new URL('./testdata/'+directory+'/'+name+'-request.json',import.meta.url)),expectedPackageId:packet.packageId}};
  });
const tool=process.env.TSFG_QUERY_TMETA_EXE,output=process.env.TSFG_QUERY_TMETA_OUTPUT,retained=process.env.TSFG_QUERY_TMETA_RETAINED??output,enabled=Boolean(tool&&output),children=[];
const run=(name,input,command='--tmeta',status=0)=>{
  mkdirSync(output,{recursive:true});const prefix=output+'/'+String(children.length).padStart(3,'0')+'-'+name;
  const child=spawnSync(tool,['--system-query',command],{input,windowsHide:true,maxBuffer:16777216,timeout:60000});
  writeFileSync(prefix+'-input.raw',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name,command,pid:child.pid,status:child.status,error:child.error?.message??null,stdoutBytes:child.stdout?.length,stderr:child.stderr?.toString('utf8')});
  writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');assert.ifError(child.error);assert.equal(child.status,status,child.stderr?.toString('utf8'));
  if(status!==0){assert.equal(child.stdout.length,0);assert.match(child.stderr.toString('utf8'),/core-ir-query-tmeta|core-ir-query-(?:batch|source|op)|core-ir-program-budget|core-ir-common-canonical/);}
  return child.stdout.toString('utf8');
};
function repackLayout(envelope,payload,layout,catalog){
  const {components,target,types}=catalog;
  catalog.hirDigest=sha256(canonical({components,target,types})+'\n');
  layout.payload=canonical(catalog);
  layout.payloadHash=sha256('tsfg.component-layout.v1\0'+layout.payload);
  payload.componentLayouts=canonical(layout)+'\n';
  payload.layoutHash=sha256(payload.componentLayouts);
  envelope.payload=canonical(payload);
  envelope.payloadHash=sha256('tsfg.query-tmeta.v2\0'+envelope.payload);
  return Buffer.from(canonical(envelope)+'\n');
}

test('Query tmeta original-context/current-manifest gates',async()=>{
  const input=cases.at(-1);
  await assert.rejects(compileSystemQuery(input.bytes,{...input.context,expectedPackageId:'sha256:'+'0'.repeat(64)},{core:tool??'missing',tmeta:true}),/identity|differs/);
  await assert.rejects(compileSystemQuery(input.bytes,input.context,{core:'missing',tmeta:true}),/artifact-manifest|ENOENT/);
  assert.match(queryTmetaSchema,/^sha256:[0-9a-f]{64}$/);
});

test('Query rejects an undeclared LLVM output format before tool admission',async()=>{
  const input=cases.at(-1),options={core:'missing',tmeta:true};
  Object.assign(options,{cpuLLVM:'llvm-ir'});
  await assert.rejects(compileSystemQuery(input.bytes,input.context,options),
    /r10-system-query-llvm: unsupported output format/);
});

test('Query public pipeline owns its Source context before artifact admission',{skip:!enabled},async()=>{
  const input=cases.at(-1),requestBytes=Buffer.from(input.context.requestBytes);
  let reads=0;
  const context={...input.context,get requestBytes(){reads++;return requestBytes;}};
  const pending=compileSystemQuery(input.bytes,context,{core:tool,effects:true,cpuBatch:true,tmeta:true});
  requestBytes.fill(0);
  const result=await pending;
  assert.equal(reads,1);
  assert.equal(result.tmeta.payload.sourceRequest,input.context.requestBytes.toString('utf8'));
  assert.equal(result.tmeta.payload.batch,result.cpuBatch);
  assert.deepEqual(result.tmeta.effects,result.effects);
});

test('Query public pipeline owns output options before artifact admission',{skip:!enabled},async()=>{
  const input=cases.at(-1);
  const options={core:tool,optimize:false,effects:true,cpuBatch:false,cpuLLVM:/** @type {'ir'|'dialect'} */('ir'),tmeta:true};
  const pending=compileSystemQuery(input.bytes,input.context,options);
  Object.assign(options,{optimize:true,effects:false,cpuBatch:true,cpuLLVM:'dialect',tmeta:false});
  const result=await pending;
  assert.equal(result.cpuBatch,undefined);
  assert.match(result.cpuLLVM,/^target triple = /mu);
  assert.equal(result.tmeta.payload.sourceRequest,input.context.requestBytes.toString('utf8'));
  assert.deepEqual(result.tmeta.effects,result.effects);
});

for(const kind of ['compound','literal'])test('Query public tmeta retains i32 '+kind+' layout and ordered effects',{skip:!enabled},async()=>{
  const fixture=new URL('./testdata/system-query-i32-field-'+kind+'/',import.meta.url);
  const original=name=>readFileSync(new URL(name,fixture));
  const bytes=original('package.json'),packet=JSON.parse(bytes.toString('utf8')),requestBytes=original('request.json');
  const oracle=JSON.parse(original('official-oracle.json').toString('utf8'));
  assert.equal(sha256(original('source.ts')),'sha256:'+oracle.sourceSha256);
  const context={family:'tsfg.system-query-context-candidate',version:6,requestBytes,expectedPackageId:packet.packageId};
  const {tmeta,cpuBatch,effects}=await compileSystemQuery(bytes,context,{core:tool,cpuBatch:true,tmeta:true,effects:true});
  assert.ok(tmeta&&cpuBatch&&effects);
  assert.deepEqual([tmeta.payload.sourcePacket,tmeta.payload.sourceRequest,tmeta.payload.batch],
    [bytes.toString('utf8'),requestBytes.toString('utf8'),cpuBatch]);
  assert.deepEqual(tmeta.effects,effects);

  const layout=JSON.parse(JSON.parse(tmeta.payload.componentLayouts).payload);
  const scalar=layout.types.find(row=>row.kind==='scalar'&&row.name==='i32');
  assert.deepEqual([scalar.byteSize,scalar.alignment,scalar.stride],[4,4,4]);
  const destination=layout.types.find(row=>row.kind==='component'&&row.name==='CopyDestination');
  const source=layout.types.find(row=>row.kind==='component'&&row.name==='CopySource');
  for(const [type,offset] of [[destination,4],[source,0]]){
    const field=type.fields.find(row=>row.name==='n');
    assert.deepEqual([field.type,field.offset],[scalar.id,offset]);
  }
  assert.equal(tmeta.payload.entries.length,1);
  const [entry]=tmeta.payload.entries;
  assert.deepEqual(entry.tupleOccurrences.map(tuple=>{
    const column=entry.columns[tuple.columnIndex];
    return [tuple.tupleIndex,tuple.mode,column.componentType,column.alignment,column.stride];
  }),[[0,'write',destination.id,4,8],[1,'read',source.id,4,4]]);
  const operations=effects.systems[0].loops[0].operations;
  const sourceRange=range=>({path:'/src/main.ts',...range});
  const expected=kind==='compound'
    ? [['read',0,sourceRange(oracle.fields[0].access)],['read',1,sourceRange(oracle.fields[1].access)],['write',0,sourceRange(oracle.expression)]]
    : oracle.assignments.map(row=>['write',0,sourceRange(row.assignment)]);
  assert.deepEqual(operations.map(row=>[row.kind,row.tupleIndex,row.source]),expected);
  assert.ok(operations.every(row=>row.sourceBinding===entry.tupleOccurrences[row.tupleIndex].sourceBinding));
  assert.deepEqual(effects.conflicts,[]);
  const metadata=canonical(tmeta.envelope)+'\n';
  assert.equal(run('i32-'+kind+'-tmeta-cold',metadata,'--canonicalize-tmeta'),metadata);
  assert.equal(run('i32-'+kind+'-tmeta-from-batch',cpuBatch),metadata);
});

for(const input of cases)test('actual Query .tmeta: '+input.name,{skip:!enabled},()=>{
  const facts=readSystemQueryFacts(input.bytes,input.context),core=emitSystemQueryCore(facts,input.context),bytes=run(input.name,core),envelope=JSON.parse(bytes);
  const batch=JSON.parse(envelope.payload).batch,checkedBatch=run(input.name+'-batch',core,'--cpu-batch');
  assert.equal(batch,checkedBatch);const metadata=readSystemQueryTmeta(Buffer.from(bytes),facts,input.context,checkedBatch);
  assert.equal(canonical(metadata.envelope)+'\n',bytes);assert.equal(metadata.payload.entries.length,facts.systems.reduce((count,system)=>count+system.loops.length,0));
  assert.equal(metadata.payload.sourcePacket,canonical(JSON.parse(input.bytes.toString('utf8')))+'\n');
  assert.ok(metadata.payload.entries.every(entry=>entry.logicalFunctionId!==entry.sourceFunctionId));
  const prefix=output+'/retained-'+input.name;
  writeFileSync(prefix+'.tmeta',bytes);writeFileSync(prefix+'-batch.mlir',checkedBatch);writeFileSync(prefix+'-receipt.json',canonical({inputIdentity:facts.inputIdentity,packageId:facts.packageId,payloadHash:envelope.payloadHash})+'\n');
  if(['loop-inheritance','multi','view-imported','view-same-owner','view-parenthesized'].includes(input.name)){
    assert.equal(run(input.name+'-roundtrip',bytes,'--canonicalize-tmeta'),bytes);
    assert.equal(run(input.name+'-from-batch',checkedBatch),bytes);
  }
});

test('Query tmeta checks field extents against the retained catalog',{skip:!retained},()=>{
  const input=cases.at(-1),facts=readSystemQueryFacts(input.bytes,input.context);
  const prefix=retained+'/retained-'+input.name;
  const original=readFileSync(prefix+'.tmeta'),checkedBatch=readFileSync(prefix+'-batch.mlir','utf8');
  assert.equal(canonical(readSystemQueryTmeta(original,facts,input.context,checkedBatch).envelope)+'\n',original.toString('utf8'));
  for(const [fieldIndex,offset] of [[0,4],[0,1],[1,8]]){
    const envelope=JSON.parse(original.toString('utf8')),payload=JSON.parse(envelope.payload);
    const layout=JSON.parse(payload.componentLayouts),catalog=JSON.parse(layout.payload);
    const component=catalog.types.find(row=>row.kind==='component');
    assert.deepEqual(component.fields.map(field=>field.offset),[0,4]);
    component.fields[fieldIndex].offset=offset;
    const bytes=repackLayout(envelope,payload,layout,catalog);
    assert.throws(()=>readSystemQueryTmeta(bytes,facts,input.context,checkedBatch),/r10-query-tmeta: layout field extent differs/,`field ${fieldIndex} at ${offset}`);
  }
});

test('Query tmeta binds the original request byte view',{skip:!retained},()=>{
  const input=cases.at(-1),facts=readSystemQueryFacts(input.bytes,input.context);
  const prefix=retained+'/retained-'+input.name,original=readFileSync(prefix+'.tmeta');
  const batch=readFileSync(prefix+'-batch.mlir','utf8');
  const request=input.context.requestBytes;
  const storage=Buffer.concat([Buffer.of(0),request,Buffer.of(0)]);
  const requestBytes=new Uint8Array(storage.buffer,storage.byteOffset+1,request.byteLength);
  Object.defineProperty(requestBytes,'valueOf',{value(){throw new Error('unexpected request byte conversion');}});
  const context={...input.context,requestBytes};
  const result=readSystemQueryTmeta(original,facts,context,batch);
  assert.equal(result.payload.sourceRequest,request.toString('utf8'));
  assert.equal(canonical(result.envelope)+'\n',original.toString('utf8'));
});

test('Query tmeta uses one checked context snapshot',{skip:!retained},()=>{
  const input=cases.at(-1),facts=readSystemQueryFacts(input.bytes,input.context);
  const prefix=retained+'/retained-'+input.name,original=readFileSync(prefix+'.tmeta');
  const batch=readFileSync(prefix+'-batch.mlir','utf8');
  let reads=0;
  const context={...input.context,get requestBytes(){reads++;return input.context.requestBytes;}};
  assert.equal(canonical(readSystemQueryTmeta(original,facts,context,batch).envelope)+'\n',original.toString('utf8'));
  assert.equal(reads,1);
  const other=cases.at(-2),wrongBatch=readFileSync(retained+'/retained-'+other.name+'-batch.mlir','utf8');
  assert.throws(()=>readSystemQueryTmeta(original,facts,{...input.context,requestBytes:other.context.requestBytes},batch),/owned Source request differs/);
  assert.throws(()=>readSystemQueryTmeta(original,facts,input.context,wrongBatch),/Source\/batch\/ABI binding differs/);
});

test('Query tmeta cold Source/identity/column/permission/signature/symbol rejection',{skip:!enabled},()=>{
  const input=cases.at(-1),facts=readSystemQueryFacts(input.bytes,input.context),original=readFileSync(retained+'/retained-'+input.name+'.tmeta','utf8'),payload=JSON.parse(JSON.parse(original).payload);
  const mutations=[
    value=>{value.inputIdentity='sha256:'+'0'.repeat(64);},value=>{value.packageId='sha256:'+'0'.repeat(64);},
    value=>{value.entries[0].sourceFunctionId=value.entries[0].logicalFunctionId;},value=>{value.entries[0].signatureHash='sha256:'+'0'.repeat(64);},
    value=>{value.entries[0].entrySymbol+='wrong';},value=>{value.entries[0].columns[0].stride+=4;},
    value=>{value.entries[0].columns[0].access='read';},value=>{value.entries[0].tupleOccurrences[0].columnIndex=1;},
    value=>{value.entries[0].abiType='() -> ()';},value=>{value.entries=[];},
    value=>{const packet=JSON.parse(value.sourcePacket);packet.payload.program.files[0].content+=' ';value.sourcePacket=canonical(packet)+'\n';},
    value=>{const layout=JSON.parse(value.componentLayouts),data=JSON.parse(layout.payload);data.types.find(type=>type.kind==='component').fields[0].offset+=4;layout.payload=canonical(data);layout.payloadHash=sha256('tsfg.component-layout.v1\0'+layout.payload);value.componentLayouts=canonical(layout)+'\n';value.layoutHash=sha256(value.componentLayouts);},
    value=>{const effects=JSON.parse(value.effects);effects.systems[0].loops[0].operations=[];value.effects=canonical(effects)+'\n';value.effectsHash=sha256(value.effects);},
    value=>{value.entries[0].scalars[0].type='f64';},
  ];
  mutations.forEach((mutate,index)=>{
    const changed=structuredClone(payload);mutate(changed);const envelope=JSON.parse(original);envelope.payload=canonical(changed);envelope.payloadHash=sha256('tsfg.query-tmeta.v2\0'+envelope.payload);const bytes=canonical(envelope)+'\n';
    run('bad-'+index,bytes,'--canonicalize-tmeta',3);
    assert.throws(()=>readSystemQueryTmeta(Buffer.from(bytes),facts,input.context,payload.batch),/tmeta|effects/);
  });
  const wrongVersion=JSON.parse(original);wrongVersion.version=1;run('bad-version',canonical(wrongVersion)+'\n','--canonicalize-tmeta',3);
  assert.throws(()=>readSystemQueryTmeta(Buffer.from(canonical(wrongVersion)+'\n'),facts,input.context,payload.batch),/tmeta/);
  run('bad-json','{','--canonicalize-tmeta',3);
});

test('Query tmeta body above 1 MiB retains strict UTF8 and 8 MiB limit',{skip:!enabled},()=>{
  const bytes=readFileSync(new URL('./testdata/system-query-tmeta/large-facts.json',import.meta.url)),packet=JSON.parse(bytes.toString('utf8'));
  const context={family:'tsfg.system-query-context-candidate',version:6,requestBytes:readFileSync(new URL('./testdata/system-query-tmeta/large-request.json',import.meta.url)),expectedPackageId:packet.packageId};
  const facts=readSystemQueryFacts(bytes,context),core=emitSystemQueryCore(facts,context),metadata=run('large',core),envelope=JSON.parse(metadata),payload=JSON.parse(envelope.payload);
  assert.ok(Buffer.byteLength(envelope.payload)>1048576);assert.ok(Buffer.byteLength(metadata)<8388608);
  const batch=run('large-batch',core,'--cpu-batch');readSystemQueryTmeta(Buffer.from(metadata),facts,context,batch);
  assert.equal(run('large-roundtrip',metadata,'--canonicalize-tmeta'),metadata);
  writeFileSync(output+'/retained-large.tmeta',metadata);writeFileSync(output+'/retained-large-batch.mlir',batch);
  writeFileSync(output+'/retained-large-receipt.json',canonical({inputIdentity:facts.inputIdentity,packageId:facts.packageId,payloadHash:envelope.payloadHash})+'\n');
  // The official Source contains a literal U+FFFD in its EOF comment. Replacing
  // its three UTF8 bytes by FF must not be repaired to the original JSON text.
  const original=Buffer.from(metadata),at=original.indexOf(Buffer.from('\ufffd'));assert.ok(at>=0);
  const invalid=Buffer.concat([original.subarray(0,at),Buffer.from([255]),original.subarray(at+3)]);
  assert.throws(()=>readSystemQueryTmeta(invalid,facts,context,batch),/utf8/);
  run('bad-utf8',invalid,'--canonicalize-tmeta',3);
  const over=Buffer.concat([original,Buffer.alloc(8388609-original.length,32)]);
  assert.throws(()=>readSystemQueryTmeta(over,facts,context,batch),/limit/);
  run('over-limit',over,'--canonicalize-tmeta',3);
});

test('shared JSON engine preserves old owning string and coreText policies',{skip:!enabled},()=>{
  const input=cases.at(-1),facts=readSystemQueryFacts(input.bytes,input.context),core=emitSystemQueryCore(facts,input.context);
  const marker='tsfg.query_facts = '+coreQuote(canonical(JSON.parse(input.bytes.toString('utf8'))));assert.ok(core.includes(marker));
  const large='x'.repeat(1048577);
  // These are malformed Source packets, never fabricated passing facts. They
  // distinguish the original JSON boundary from the later Source-family gate.
  for(const [name,value,canonicalRejected] of [['ordinary',{value:large},true],['nested-coreText',{nested:{coreText:large}},true],['root-coreText',{coreText:large},false]]){
    run('legacy-'+name,core.replace(marker,'tsfg.query_facts = '+coreQuote(canonical(value))),'--canonicalize',3);
    const diagnostic=children.at(-1).stderr;
    assert.match(diagnostic,canonicalRejected?/core-ir-common-canonical/:/core-ir-query-source/);
  }
});

test('Query pipeline pairs the retained LLVM IR and metadata through one batch',
  {skip:!process.env.TSFG_QUERY_PAIRED_CAPTURE},async t=>{
  const capture=process.env.TSFG_QUERY_PAIRED_CAPTURE;
  assert.ok(path.isAbsolute(capture));
  const bytes=name=>readFileSync(path.join(capture,name));
  const core=bytes('001-bound-cold-stdout.bin');
  assert.equal(sha256(core),'sha256:19e3f22128ddd95e88c2a4c32c8a0a27c907dddc0e9b88ec9205d2e9aad4713c');
  const batch=bytes('003-batch-cold-stdout.bin');
  const llvm=bytes('007-llvm-ir-stdout.bin');
  assert.deepEqual(llvm,bytes('008-llvm-ir-cold-stdout.bin'));
  assert.equal(sha256(llvm),'sha256:0efe58d6f77b590396dc2ac1181f1774b2778537c29fc584ba5883d78376211e');
  const meta=readFileSync(new URL('../../runtime/jobs/testdata/query-tmeta-i32-copy.tmeta',import.meta.url));
  const envelope=JSON.parse(meta.toString('utf8')),payload=JSON.parse(envelope.payload);
  const packet=Buffer.from(payload.sourcePacket),request=Buffer.from(payload.sourceRequest);
  const context=systemQueryRequestContext(packet,request),facts=readSystemQueryFacts(packet,context);
  /** @type {Array<[string,string,Buffer]>} */
  const steps=[['--cpu-batch',core.toString('utf8'),batch],['--llvm-ir',batch.toString('utf8'),llvm],['--tmeta',batch.toString('utf8'),meta]];
  const product=readQueryCompilerOutputs(facts,context,core,{cpuLLVM:'ir',tmeta:true},(command,input)=>{
    const step=steps.shift();
    assert.ok(step);
    const [expectedCommand,expectedInput,output]=step;
    assert.equal(command,expectedCommand);
    assert.equal(sha256(input),sha256(expectedInput),'each producer uses the original checked batch');
    return output;
  });
  assert.deepEqual(steps,[]);
  assert.equal(sha256(product.core),sha256(core));
  assert.equal(product.cpuBatch,undefined);
  assert.equal(product.cpuLLVM,llvm.toString('utf8'));
  assert.deepEqual(product.llvmArtifact,{llvmHash:sha256(llvm),batchHash:sha256(batch),metadataHash:envelope.payloadHash});
  assert.equal(sha256(product.cpuLLVM),product.llvmArtifact.llvmHash);

  const malformed=Buffer.from(llvm);
  malformed[0]=0xff;
  let requestedMetadata=false;
  assert.throws(()=>readQueryCompilerOutputs(facts,context,core,{cpuLLVM:'ir',tmeta:true},command=>{
    if(command==='--cpu-batch')return batch;
    if(command==='--llvm-ir')return malformed;
    assert.equal(command,'--tmeta');
    requestedMetadata=true;
    return meta;
  }),/r10-system-query-llvm: invalid UTF-8 in compiler output/);
  assert.equal(requestedMetadata,false);

  for(const {name,output} of [{name:'empty',output:Buffer.alloc(0)},{name:'over-limit',output:Buffer.alloc(8*1024*1024+1,32)}])
    await t.test('reject '+name+' LLVM output before metadata',()=>{
      const calls=[];
      assert.throws(()=>readQueryCompilerOutputs(facts,context,core,{cpuLLVM:'ir',tmeta:true},command=>{
        calls.push(command);
        return command==='--cpu-batch'?batch:command==='--llvm-ir'?output:meta;
      }),/r10-system-query-llvm: compiler output size differs/);
      assert.deepEqual(calls,['--cpu-batch','--llvm-ir']);
    });

  const oversizedBatch=Buffer.concat([Buffer.alloc(8*1024*1024+1-batch.length,32),batch]);
  for(const {name,output} of [{name:'empty',output:Buffer.alloc(0)},{name:'over-limit',output:oversizedBatch}])
    await t.test('reject '+name+' checked batch before LLVM',()=>{
      const calls=[];
      assert.throws(()=>readQueryCompilerOutputs(facts,context,core,{cpuBatch:true,cpuLLVM:'ir'},command=>{
        calls.push(command);
        return command==='--cpu-batch'?output:llvm;
      }),/r10-system-query-batch: compiler output size differs/);
      assert.deepEqual(calls,['--cpu-batch']);
    });

  await t.test('reject checked batch missing its final LF before LLVM',()=>{
    assert.equal(batch.at(-1),10);
    const unterminated=Buffer.from(batch.toString('utf8').replace(/\n+$/u,''));
    const calls=[];
    assert.throws(()=>readQueryCompilerOutputs(facts,context,core,{cpuBatch:true,cpuLLVM:'ir'},command=>{
      calls.push(command);
      return command==='--cpu-batch'?unterminated:llvm;
    }),/r10-system-query-batch: compiler output requires a final LF/);
    assert.deepEqual(calls,['--cpu-batch']);
  });

  const malformedBatch=Buffer.from(batch);
  malformedBatch[0]=0xff;
  for(const pair of [false,true])await t.test(pair?'reject malformed batch before downstream stages':'reject malformed standalone batch',()=>{
    const calls=[];
    assert.throws(()=>readQueryCompilerOutputs(facts,context,core,
      {cpuBatch:true,cpuLLVM:pair?'ir':undefined,tmeta:pair},command=>{
        calls.push(command);
        return command==='--cpu-batch'?malformedBatch:command==='--llvm-ir'?llvm:meta;
      }),/r10-system-query-batch: invalid UTF-8 in compiler output/);
    assert.deepEqual(calls,['--cpu-batch']);
  });

  const malformedCore=Buffer.from(core);
  malformedCore[0]=0xff;
  for(const downstream of [false,true])await t.test(downstream?'reject malformed Core before downstream stages':'reject malformed standalone Core',()=>{
    let called=false;
    assert.throws(()=>readQueryCompilerOutputs(facts,context,malformedCore,{cpuBatch:downstream,effects:downstream},()=>{
      called=true;
      return batch;
    }),/r10-system-query-core: invalid UTF-8 in compiler output/);
    assert.equal(called,false);
  });
});

const queryFixtures=new URL('../../runtime/jobs/testdata/',import.meta.url);
function retainedQuery(name){
  return readRetainedQuery(readFileSync(new URL('query-tmeta-'+name+'.tmeta',queryFixtures)));
}
/** @param {Buffer} metadata */
function readRetainedQuery(metadata){
  const payload=JSON.parse(JSON.parse(metadata.toString('utf8')).payload);
  const packet=Buffer.from(payload.sourcePacket),request=Buffer.from(payload.sourceRequest);
  const context=systemQueryRequestContext(packet,request),facts=readSystemQueryFacts(packet,context);
  const snapshot=/tsfg\.cpu_batch_source = "((?:[^"\\]|\\.)*)"/u.exec(payload.batch)?.[1];
  assert.ok(snapshot);
  const core=Buffer.from(snapshot.replace(/\\(\\|[0-9A-F]{2})/gu,(_,byte)=>
    byte==='\\'?'\\':String.fromCharCode(Number.parseInt(byte,16))),'latin1');
  return {metadata,payload,core,facts,context};
}

test('C61 Query Core preserves its exact Source facts and request',async t=>{
  const original=readRetainedQuery(readFileSync(new URL('query-effects-multi.tmeta',queryFixtures)));
  const other=retainedQuery('i32-copy');
  assert.equal(sha256(original.core),'sha256:89ea394feac3da6afd835dc2b915d5e158eac425d9571083086bab37f4a89563');
  const {facts,context,core,payload}=original;
  const text=core.toString('utf8');
  const accepted=readQueryCompilerOutputs(facts,context,core,{},()=>assert.fail('Core-only output has no next stage'));
  assert.deepEqual(Buffer.from(accepted.core),core);
  const proof=(field,value)=>field+' = "'+escapeQueryCompilerBytes(Buffer.from(value.slice(0,-1)))+'"';
  for(const [field,source,foreign] of [
    ['tsfg.query_facts',payload.sourcePacket,other.payload.sourcePacket],
    ['tsfg.query_request',payload.sourceRequest,other.payload.sourceRequest],
  ]){
    const originalField=proof(field,source);
    assert.ok(text.includes(originalField+', '));
    for(const [kind,changed] of [
      ['missing',text.replace(originalField+', ','')],
      ['foreign',text.replace(originalField,()=>proof(field,foreign))],
    ])await t.test('reject '+kind+' '+field,()=>{
      assert.notEqual(changed,text);
      for(const options of [{},{effects:true,cpuBatch:true,tmeta:true}]){
        const calls=[];
        assert.throws(()=>readQueryCompilerOutputs(facts,context,Buffer.from(changed),options,command=>{
          calls.push(command);
          return Buffer.from(payload.batch);
        }),/r10-system-query-core: checked Source receipt differs/);
        assert.deepEqual(calls,[]);
      }
    });
  }
});

test('Query standalone batch corresponds to the verified input Core',async t=>{
  const copy=retainedQuery('i32-copy'),compound=retainedQuery('i32-compound');
  assert.equal(sha256(copy.core),'sha256:19e3f22128ddd95e88c2a4c32c8a0a27c907dddc0e9b88ec9205d2e9aad4713c');
  assert.equal(sha256(compound.core),'sha256:d467525f88c304d6132ae0cf2b41fbe20b2c244850ab3276a50c6e472f1d37e0');
  assert.notEqual(copy.facts.inputIdentity,compound.facts.inputIdentity);
  assert.ok(copy.core.includes('\\F0\\9F\\98\\80'));
  for(const retained of [copy,compound]){
    const matched=readQueryCompilerOutputs(retained.facts,retained.context,retained.core,{},()=>assert.fail('Core-only output has no dependent stage'));
    assert.deepEqual(Buffer.from(matched.core,'utf8'),retained.core);
  }
  for(const downstream of [false,true])await t.test(downstream?'foreign Core stops before dependent Query outputs':'foreign Core is rejected on its own',()=>{
    const calls=[];
    const options=downstream?{effects:true,cpuBatch:true,cpuLLVM:/** @type {const} */('ir'),tmeta:true}:{};
    assert.throws(()=>readQueryCompilerOutputs(copy.facts,copy.context,compound.core,options,command=>{
      calls.push(command);
      return Buffer.from(copy.payload.batch);
    }),error=>{
      assert.deepEqual(calls,[]);
      assert.match(String(error),/r10-system-query-core: checked input identity differs/);
      return true;
    });
    assert.deepEqual(calls,[]);
  });
  const collect=(batch,paired=false,core=copy.core)=>readQueryCompilerOutputs(copy.facts,copy.context,core,
    {cpuBatch:true,cpuLLVM:paired?'ir':undefined},(command,input)=>{
      assert.equal(command,'--cpu-batch');
      assert.equal(input,core.toString('utf8'));
      return Buffer.from(batch);
    });
  assert.equal(collect(copy.payload.batch).cpuBatch,copy.payload.batch);
  for(const paired of [false,true])assert.throws(()=>collect(compound.payload.batch,paired),/r10-system-query-batch: checked input/);
  assert.throws(()=>collect(copy.payload.batch,false,compound.core),/r10-system-query-core: checked input identity differs/);
  const wrongIdentity=copy.payload.batch.replace('tsfg_core.input_identity = "'+copy.facts.inputIdentity+'"',
    'tsfg_core.input_identity = "'+compound.facts.inputIdentity+'"');
  assert.notEqual(wrongIdentity,copy.payload.batch);
  assert.throws(()=>collect(wrongIdentity),/r10-system-query-batch: checked input/);
  const wrongVersion=copy.payload.batch.replace('tsfg.cpu_batch_version = 1 : i32','tsfg.cpu_batch_version = 2 : i32');
  assert.notEqual(wrongVersion,copy.payload.batch);
  assert.throws(()=>collect(wrongVersion),/r10-system-query-batch: checked input/);
});

test('Query standalone LLVM IR binds the checked batch and entry ABI',()=>{
  const llvm=readFileSync(new URL('query-tmeta-i32-copy-retained.ll',queryFixtures));
  const copy=retainedQuery('i32-copy'),compound=retainedQuery('i32-compound');
  /** @type {{command:string,input:string}[]} */
  const calls=[];
  /** @param {ReturnType<typeof retainedQuery>} retained @param {Buffer} [output] */
  const collect=(retained,output=llvm)=>readQueryCompilerOutputs(retained.facts,retained.context,retained.core,
    {cpuLLVM:'ir'},(command,input)=>{
      calls.push({command,input});
      if(command==='--cpu-batch')return Buffer.from(retained.payload.batch);
      assert.equal(command,'--llvm-ir');
      return output;
    });
  assert.throws(()=>collect(compound),/r10-system-query-llvm: checked batch proof differs/);
  assert.deepEqual(calls.splice(0),[
    {command:'--cpu-batch',input:compound.core.toString('utf8')},
    {command:'--llvm-ir',input:compound.payload.batch},
  ]);
  const product=collect(copy);
  assert.equal(product.cpuLLVM,llvm.toString('utf8'));
  for(const field of ['cpuBatch','tmeta','llvmArtifact'])assert.equal(Object.hasOwn(product,field),false);
  assert.deepEqual(calls,[
    {command:'--cpu-batch',input:copy.core.toString('utf8')},
    {command:'--llvm-ir',input:copy.payload.batch},
  ]);
  const text=llvm.toString('utf8');
  const definition=text.split('\n').find(line=>line.startsWith('define void @batch_'));
  assert.ok(definition);
  const wrongType=definition.replace('ptr %1,','i64 %1,');
  assert.notEqual(wrongType,definition);
  assert.throws(()=>collect(copy,Buffer.from(text.replace(definition,wrongType))),
    /r10-system-query-llvm: checked entry ABI differs/);
  assert.deepEqual(calls.slice(2),[
    {command:'--cpu-batch',input:copy.core.toString('utf8')},
    {command:'--llvm-ir',input:copy.payload.batch},
  ]);
});

test('Query LLVM dialect binds the retained batch and target',
  {skip:!process.env.TSFG_QUERY_PAIRED_CAPTURE},async t=>{
  const capture=process.env.TSFG_QUERY_PAIRED_CAPTURE;
  assert.ok(path.isAbsolute(capture));
  const dialect=readFileSync(path.join(capture,'005-llvm-dialect-stdout.bin'));
  assert.equal(sha256(dialect),'sha256:96aac736f8a7f3c81ad0b33ededc0d05aad550dcfd075ece05eb9130da61589a');
  assert.deepEqual(dialect,readFileSync(path.join(capture,'006-llvm-dialect-cold-stdout.bin')));
  const copy=retainedQuery('i32-copy'),compound=retainedQuery('i32-compound');
  /** @type {string[]} */
  const calls=[];
  /**
   * @param {ReturnType<typeof retainedQuery>} retained
   * @param {Buffer} output
   * @param {boolean} [tmeta]
   */
  const collect=(retained,output,tmeta=false)=>readQueryCompilerOutputs(retained.facts,retained.context,retained.core,
    {cpuLLVM:'dialect',tmeta},(command,input)=>{
      calls.push(command);
      if(command==='--cpu-batch'){
        assert.equal(input,retained.core.toString('utf8'));
        return Buffer.from(retained.payload.batch);
      }
      assert.equal(input,retained.payload.batch);
      if(command==='--cpu-llvm')return output;
      assert.equal(command,'--tmeta');
      return retained.metadata;
    });
  assert.throws(()=>collect(compound,dialect),/r10-system-query-llvm: checked dialect proof differs/);
  assert.deepEqual(calls.splice(0),['--cpu-batch','--cpu-llvm']);
  const product=collect(copy,dialect);
  assert.equal(product.cpuLLVM,dialect.toString('utf8'));
  assert.equal(Object.hasOwn(product,'cpuBatch'),false);
  assert.deepEqual(calls.splice(0),['--cpu-batch','--cpu-llvm']);
  const original=dialect.toString('utf8');
  for(const replacement of [
    original.replace('llvm.target_triple = "x86_64-pc-windows-msvc"','llvm.target_triple = "aarch64-pc-windows-msvc"'),
    original.replace('tsfg.cpu_llvm_version = 1 : i32','tsfg.cpu_llvm_version = 2 : i32'),
  ]){
    assert.notEqual(replacement,original);
    assert.throws(()=>collect(copy,Buffer.from(replacement)),/r10-system-query-llvm: checked dialect proof differs/);
    assert.deepEqual(calls.splice(0),['--cpu-batch','--cpu-llvm']);
  }
  const entry=original.split('\n').find(line=>line.startsWith('  "llvm.func"'));
  assert.ok(entry);
  const entrySymbol=/sym_name = "([^"]+)"/u.exec(entry)?.[1];
  assert.ok(entrySymbol);
  const first=original.indexOf(entry),last=original.lastIndexOf('\n}) {');
  const body=original.slice(first,last),foreignBody=body.replace(entrySymbol,'batch_'+'0'.repeat(64)+'_0');
  const header=original.slice(0,first),proof=original.slice(last);
  for(const [name,changed] of [
    ['wrong function type',original.replace(entry,entry.replace('void (i64,','void (i32,'))],
    ['wrong calling convention',original.replace(entry,entry.replace('#llvm.cconv<ccc>','#llvm.cconv<fastcc>'))],
    ['wrong linkage',original.replace(entry,entry.replace('#llvm.linkage<external>','#llvm.linkage<internal>'))],
    ['missing entry',header+proof],['foreign entry',header+foreignBody+proof],
    ['duplicate entry',header+body+'\n'+body+proof],['extra entry',header+body+'\n'+foreignBody+proof],
  ])await t.test('reject '+name,()=>{
    calls.length=0;
    assert.notEqual(changed,original);
    assert.throws(()=>collect(copy,Buffer.from(changed),true),/r10-system-query-llvm: checked entry ABI differs/);
    assert.deepEqual(calls.splice(0),['--cpu-batch','--cpu-llvm']);
  });
});

test('Query LLVM pairing validates the retained batch and target',async t=>{
  const llvm=readFileSync(new URL('query-tmeta-i32-copy-retained.ll',queryFixtures));
  /** @param {string} name @param {string[]} calls @param {Buffer} [llvmOutput] */
  const run=(name,calls,llvmOutput=llvm)=>{
    const {metadata,payload,core,facts,context}=retainedQuery(name);
    return readQueryCompilerOutputs(facts,context,core,{cpuBatch:true,cpuLLVM:'ir',tmeta:true},(command,source)=>{
      calls.push(command);
      if(command==='--cpu-batch')return Buffer.from(payload.batch);
      assert.equal(source,payload.batch);
      if(command==='--llvm-ir')return llvmOutput;
      assert.equal(command,'--tmeta');
      return metadata;
    });
  };
  /** @type {string[]} */
  const matching=[];
  const product=run('i32-copy',matching);
  assert.deepEqual(matching,['--cpu-batch','--llvm-ir','--tmeta']);
  assert.equal(product.llvmArtifact?.llvmHash,sha256(llvm));
  assert.ok(typeof product.cpuBatch==='string');
  assert.equal(product.llvmArtifact?.batchHash,sha256(product.cpuBatch));

  /** @type {string[]} */
  const mismatched=[];
  assert.throws(()=>run('i32-compound',mismatched),/r10-system-query-llvm: checked batch proof differs/);
  assert.deepEqual(mismatched,['--cpu-batch','--llvm-ir']);

  const original=llvm.toString('utf8');
  const replacements=[
    ['target triple','x86_64-pc-windows-msvc','aarch64-pc-windows-msvc'],
    ['target datalayout','-S128"','-S64"'],
  ];
  for(const [name,before,after] of replacements)await t.test('reject mismatched '+name,()=>{
    const changed=original.replace(before,after);
    assert.notEqual(changed,original);
    const calls=[];
    assert.throws(()=>run('i32-copy',calls,Buffer.from(changed)),/r10-system-query-llvm: checked target differs/);
    assert.deepEqual(calls,['--cpu-batch','--llvm-ir']);
  });

  const symbol='batch_7b22872314488f78b6db981f5caf2e405c3641b76dd51cfcf62f7b5d96924df3_0';
  const definition=original.split('\n').find(line=>line.startsWith('define void @'+symbol+'('));
  assert.ok(definition);
  const renamed=definition.replace(symbol,'batch_'+'0'.repeat(64)+'_0');
  const wrongType=definition.replace('ptr %1,','i64 %1,');
  const repeatedSlot=definition.replace('ptr %2,','ptr %1,');
  for(const [name,replacement] of [['wrong entry symbol',renamed],['wrong entry argument type',wrongType],
    ['repeated entry argument slot',repeatedSlot]])await t.test('reject '+name,()=>{
    assert.notEqual(replacement,definition);
    const calls=[];
    const changed=Buffer.from(original.replace(definition,replacement));
    assert.throws(()=>run('i32-copy',calls,changed),/r10-system-query-llvm: checked entry ABI differs/);
    assert.deepEqual(calls,['--cpu-batch','--llvm-ir']);
  });
  await t.test('reject definitions absent from the checked Source and batch',()=>{
    for(const symbol of ['unrelated','batch_helper_'+'0'.repeat(64)]){
      const calls=[];
      const changed=Buffer.from(original.replace(definition,`define i32 @${symbol}() {\n  ret i32 0\n}\n\n`+definition));
      assert.throws(()=>run('i32-copy',calls,changed),/r10-system-query-llvm: checked entry ABI differs/);
      assert.deepEqual(calls,['--cpu-batch','--llvm-ir']);
    }
  });
});

test('Query tmeta rejects an otherwise matching batch missing its final LF',()=>{
  const original=readFileSync(new URL('../../runtime/jobs/testdata/query-tmeta-i32-copy.tmeta',import.meta.url));
  const envelope=JSON.parse(original.toString('utf8')),payload=JSON.parse(envelope.payload);
  const packet=Buffer.from(payload.sourcePacket),request=Buffer.from(payload.sourceRequest);
  const context=systemQueryRequestContext(packet,request),facts=readSystemQueryFacts(packet,context);
  assert.equal(canonical(readSystemQueryTmeta(original,facts,context,payload.batch).envelope)+'\n',original.toString('utf8'));
  assert.ok(payload.batch.endsWith('\n'));
  payload.batch=payload.batch.replace(/\n+$/u,'');
  payload.batchHash=sha256(payload.batch);
  envelope.payload=canonical(payload);
  envelope.payloadHash=sha256('tsfg.query-tmeta.v2\0'+envelope.payload);
  const edited=Buffer.from(canonical(envelope)+'\n');
  assert.throws(()=>readSystemQueryTmeta(edited,facts,context,payload.batch),/r10-query-tmeta: checked batch requires a final LF/);
});

test('Query tmeta rejects a changed physical i32 scalar extent',()=>{
  const metadata=new URL('../../runtime/jobs/testdata/query-tmeta-i32-copy.tmeta',import.meta.url);
  const original=readFileSync(metadata),envelope=JSON.parse(original.toString('utf8')),payload=JSON.parse(envelope.payload);
  const receipt=JSON.parse(readFileSync(new URL('query-tmeta-i32-copy-receipt.json',metadata),'utf8'));
  const fixture=new URL('./testdata/system-query-i32-copy/',import.meta.url);
  const packet=readFileSync(new URL('package.json',fixture)),requestBytes=readFileSync(new URL('request.json',fixture));
  const context={family:'tsfg.system-query-context-candidate',version:6,requestBytes,expectedPackageId:receipt.packageId};
  const facts=readSystemQueryFacts(packet,context),checkedBatch=payload.batch;
  assert.equal(facts.inputIdentity,receipt.inputIdentity);
  assert.equal(envelope.payloadHash,receipt.payloadHash);
  assert.deepEqual(readSystemQueryTmeta(original,facts,context,checkedBatch).envelope,envelope);

  const layout=JSON.parse(payload.componentLayouts),catalog=JSON.parse(layout.payload);
  /** @type {{kind:string,scalar:string,byteSize:number,alignment:number,stride:number}[]} */
  const types=catalog.types;
  const scalar=types.find(row=>row.kind==='scalar'&&row.scalar==='i32');
  assert.ok(scalar);
  assert.deepEqual([scalar.byteSize,scalar.alignment,scalar.stride],[4,4,4]);
  Object.assign(scalar,{byteSize:2,alignment:2,stride:2});
  const changed=repackLayout(envelope,payload,layout,catalog);
  assert.throws(()=>readSystemQueryTmeta(changed,facts,context,checkedBatch),/scalar layout differs/);
});

test('Query tmeta enforces exact nominal field placement and final extent',()=>{
  const metadata=new URL('../../runtime/jobs/testdata/query-effects-shared.tmeta',import.meta.url);
  const original=readFileSync(metadata),envelope=JSON.parse(original.toString('utf8')),payload=JSON.parse(envelope.payload);
  const receipt=JSON.parse(readFileSync(new URL('query-effects-shared-receipt.json',metadata),'utf8'));
  const packet=Buffer.from(payload.sourcePacket),request=Buffer.from(payload.sourceRequest);
  const context=systemQueryRequestContext(packet,request),facts=readSystemQueryFacts(packet,context),checkedBatch=payload.batch;
  assert.equal(facts.inputIdentity,receipt.inputIdentity);
  assert.equal(facts.packageId,receipt.packageId);
  assert.equal(envelope.payloadHash,receipt.payloadHash);
  assert.deepEqual(readSystemQueryTmeta(original,facts,context,checkedBatch).envelope,envelope);
  const edits=[
    {name:'extra field gap',apply:row=>{row.fields[1].offset=8;row.byteSize=row.stride=12;},diagnostic:/layout field extent differs/},
    {name:'extra tail padding',apply:row=>{row.byteSize=row.stride=12;},diagnostic:/nominal layout extent differs/},
    {name:'extra struct alignment',apply:row=>{row.alignment=8;},diagnostic:/nominal layout extent differs/},
  ];
  for(const {name,apply,diagnostic} of edits){
    const layout=JSON.parse(payload.componentLayouts),catalog=JSON.parse(layout.payload);
    const row=catalog.types.find(row=>row.kind==='component'&&row.name==='Velocity');
    assert.deepEqual([row.byteSize,row.alignment,row.stride,row.fields.map(field=>field.offset)],[8,4,8,[0,4]]);
    assert.ok(!payload.entries.some(entry=>entry.columns.some(column=>column.componentType===row.id)));
    apply(row);
    const changed=repackLayout({...envelope},{...payload},layout,catalog);
    assert.throws(()=>readSystemQueryTmeta(changed,facts,context,checkedBatch),diagnostic,name);
  }
});

test('Query tmeta keeps the original metadata bytes when reading the request',()=>{
  const metadata=new URL('../../runtime/jobs/testdata/query-tmeta-i32-copy.tmeta',import.meta.url);
  const original=readFileSync(metadata),envelope=JSON.parse(original.toString('utf8')),payload=JSON.parse(envelope.payload);
  const receipt=JSON.parse(readFileSync(new URL('query-tmeta-i32-copy-receipt.json',metadata),'utf8'));
  const packet=Buffer.from(payload.sourcePacket),request=Buffer.from(payload.sourceRequest);
  const context=systemQueryRequestContext(packet,request),facts=readSystemQueryFacts(packet,context);
  assert.deepEqual([envelope.payloadHash,facts.inputIdentity,facts.packageId],
    [receipt.payloadHash,receipt.inputIdentity,receipt.packageId]);

  assert.equal(payload.entries[0].rowCountArgument,0);
  payload.entries[0].rowCountArgument=1;
  const body=canonical(payload);
  const changed=Buffer.from(canonical({...envelope,payload:body,payloadHash:sha256('tsfg.query-tmeta.v2\0'+body)})+'\n');
  assert.equal(changed.length,original.length);
  assert.throws(()=>readSystemQueryTmeta(changed,facts,context,payload.batch),/Source\/batch\/ABI binding differs/);

  const supplied=Buffer.from(original);
  let requestReads=0;
  const withRequest={...context,get requestBytes(){requestReads++;changed.copy(supplied);return request;}};
  const result=readSystemQueryTmeta(supplied,facts,withRequest,payload.batch);
  assert.deepEqual(result.envelope,envelope);
  assert.equal(requestReads,1);
});
