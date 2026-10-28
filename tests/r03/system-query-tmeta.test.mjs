// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';
import {readSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore} from '../../compiler/system-query-core.mjs';
import {readSystemQueryTmeta,queryTmetaSchema} from '../../compiler/system-query-tmeta.mjs';
import {compileSystemQuery} from '../../compiler/pipeline.mjs';

const cases=[...['architecture','aliases','duplicate','complete','wrapper-alias','loop-architecture','loop-aliases','loop-multiple','loop-shared-component','loop-inheritance'].map(name=>['system-query',name]),
  ['system-query-effects','multi'],...['direct','imported','local-export'].map(name=>['system-query-scalars',name]),
  ...['view-direct','view-imported','view-aliases','view-same-owner','view-parenthesized'].map(name=>['system-query-views',name])].map(([directory,name])=>{
    const bytes=readFileSync(new URL('./testdata/'+directory+'/'+name+'-facts.json',import.meta.url)),packet=JSON.parse(bytes.toString('utf8'));
    return {name,bytes,context:{family:'tsfg.system-query-context-candidate',version:5,requestBytes:readFileSync(new URL('./testdata/'+directory+'/'+name+'-request.json',import.meta.url)),expectedPackageId:packet.packageId}};
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

test('Query tmeta original-context/current-manifest gates',async()=>{
  const input=cases.at(-1);
  await assert.rejects(compileSystemQuery(input.bytes,{...input.context,expectedPackageId:'sha256:'+'0'.repeat(64)},{core:tool??'missing',tmeta:true}),/identity|differs/);
  await assert.rejects(compileSystemQuery(input.bytes,input.context,{core:'missing',tmeta:true}),/artifact-manifest|ENOENT/);
  assert.match(queryTmetaSchema,/^sha256:[0-9a-f]{64}$/);
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
    // The complete layout-offset mutant is checked by LLVM DataLayout in C++;
    // Node deliberately does not duplicate that official ABI implementation.
    if(index!==11)assert.throws(()=>readSystemQueryTmeta(Buffer.from(bytes),facts,input.context,payload.batch),/tmeta|effects/);
  });
  const wrongVersion=JSON.parse(original);wrongVersion.version=1;run('bad-version',canonical(wrongVersion)+'\n','--canonicalize-tmeta',3);
  assert.throws(()=>readSystemQueryTmeta(Buffer.from(canonical(wrongVersion)+'\n'),facts,input.context,payload.batch),/tmeta/);
  run('bad-json','{','--canonicalize-tmeta',3);
});

test('Query tmeta body above 1 MiB retains strict UTF8 and 8 MiB limit',{skip:!enabled},()=>{
  const bytes=readFileSync(new URL('./testdata/system-query-tmeta/large-facts.json',import.meta.url)),packet=JSON.parse(bytes.toString('utf8'));
  const context={family:'tsfg.system-query-context-candidate',version:5,requestBytes:readFileSync(new URL('./testdata/system-query-tmeta/large-request.json',import.meta.url)),expectedPackageId:packet.packageId};
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
