// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {importCapturedFrontendResponse} from '../../compiler/frontend.mjs';
import {buildHir,lowerFormalHir,printHir,readHir} from '../../compiler/hir.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir,projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {compileOwnedCore,compileOwnedHir,verifiedConsumer} from '../../compiler/pipeline.mjs';
import {expectedHir} from './formal-exception-source-oracle.mjs';

const fixture=await readFile(new URL('./testdata/formal-cold-profile/owned-snapshot-hir.json',import.meta.url));
assert.equal(sha256(fixture),'sha256:5f22b4e99e09737ef6d58c544fc44a107d8fc0b6dc9d0c00ea52a9f837af8ae7');
const {hir}=JSON.parse(fixture.toString('utf8'));
const cli=fileURLToPath(new URL('../../tooling/tsfgc.mjs',import.meta.url));

async function runCli(value,args,documents={}){
  const directory=await mkdtemp(path.join(tmpdir(),'tsfg-owned-hir-cli-'));
  const input=path.join(directory,'owned-hir.json');
  await writeFile(input,canonical(value)+'\n');
  const command=[cli,'--input',input,...args];
  for(const [option,document] of Object.entries(documents)){
    const file=path.join(directory,option+'.json');
    await writeFile(file,canonical(document)+'\n');
    command.push('--'+option,file);
  }
  const child=spawnSync(process.execPath,command,{windowsHide:true,maxBuffer:16*1024*1024,timeout:30000});
  await writeFile(path.join(directory,'stdout.bin'),child.stdout??Buffer.alloc(0));
  await writeFile(path.join(directory,'stderr.bin'),child.stderr??Buffer.alloc(0));
  await writeFile(path.join(directory,'child.json'),JSON.stringify({pid:child.pid,args:command,status:child.status,signal:child.signal,error:child.error?.message})+'\n');
  assert.equal(child.error,undefined);
  assert.equal(child.signal,null);
  return child;
}

async function mixedCommonHir(){
  const factsBytes=await readFile(new URL('./common-program-mixed.json',import.meta.url));
  assert.equal(sha256(factsBytes),'sha256:520a692f14cbcb7632a13cc338d78ae46f7abdbdb62d1290fe40a81c645447f0');
  const facts=readCommonProgramFacts(factsBytes);
  const factsContext={family:'tsfg.common-program-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
  return {mixed:buildCommonProgramHir(facts,factsContext),factsContext};
}

test('owned HIR CLI and reader preserve the complete mixed Common Program',async()=>{
  const {mixed,factsContext}=await mixedCommonHir();
  const bytes=Buffer.from(printHir(mixed));
  assert.equal(sha256(bytes),'sha256:a50a8050c89e1eeb1b58f2f304f69a10642baf561932dfd86ebb000576fa2e90');
  const cliResult=await runCli(mixed,['--input-kind','hir','--emit','hir']);
  assert.equal(cliResult.status,0,cliResult.stderr.toString('utf8'));
  assert.equal(cliResult.stderr.length,0);
  assert.deepEqual(cliResult.stdout,bytes);
  const cold=readHir(bytes);
  assert.deepEqual(cold,mixed);
  assert.equal(cold.functions.length,7);
  assert.equal(cold.modules.length,4);
  const statement=cold.functions.find(fn=>fn.name==='ordinary').body[1];
  assert.equal(statement.kind,'try');
  assert.ok(statement.finallyBlock);

  assert.deepEqual(readHir(bytes,factsContext),cold);
  assert.throws(()=>readHir(bytes,{...factsContext,expectedPackageId:'sha256:'+'0'.repeat(64)}),
    {code:'r03-common-program-context'});
  assert.throws(()=>readHir(Buffer.concat([bytes,Buffer.from('\n')])),{code:'r03-common-program-canonical'});
  const foreign={...mixed,format:{...mixed.format,version:1}};
  assert.throws(()=>readHir(Buffer.from(canonical(foreign)+'\n')),{code:'r03-common-program-identity'});
});

test('owned HIR CLI cold roundtrip preserves the complete actual Source result without a frontend',async()=>{
  const bytes=Buffer.from(canonical(hir)+'\n');
  const child=await runCli(hir,['--input-kind','hir','--emit','hir']);
  assert.equal(child.status,0,child.stderr?.toString('utf8'));
  assert.equal(child.stderr.length,0);
  assert.deepEqual(child.stdout,bytes);
});

test('owned HIR CLI rejects corrupt identity and conflicting Source, Query or borrow inputs before tools',async()=>{
  const invalid=structuredClone(hir);
  invalid.schemaHash='sha256:'+'0'.repeat(64);
  const corrupt=await runCli(invalid,['--input-kind','hir','--emit','hir']);
  assert.equal(corrupt.status,2);
  assert.equal(corrupt.stdout.length,0);
  assert.match(corrupt.stderr.toString('utf8'),/r03-hir-invalid/);
  for(const args of [
    ['--input-kind','unknown','--emit','hir'],
    ['--input-kind','hir','--emit','hir','--frontend','unused'],
    ['--input-kind','hir','--emit','hir','--query-request','unused'],
    ['--input-kind','hir','--emit','hir','--publication','unused'],
    ['--input-kind','hir','--emit','hir','--kernel-request','unused'],
    ['--input-kind','hir','--emit','query-effects'],
    ['--input-kind','hir','--emit','borrow-proof'],
  ]){
    const rejected=await runCli(hir,args);
    assert.equal(rejected.status,2);
    assert.equal(rejected.stdout.length,0);
    assert.match(rejected.stderr.toString('utf8'),/r03-cli-options/);
  }
});

if(process.env.TSFG_CORE_IR_EXE){
  test('cold Common Core CLI consumes its original fixed publication and request',async()=>{
    const factsPath=new URL('../fixtures/r03/common-self-held-storage/self-held-external-store-safe-package.json',import.meta.url);
    const directory=new URL('../fixtures/r03/common-fixed-publication/',import.meta.url);
    const publicationPath=new URL('self-held-safe.publication-v6.json',directory);
    const [factsBytes,publicationBytes,historicalBytes]=await Promise.all([
      readFile(factsPath),readFile(publicationPath),readFile(new URL('self-held-safe.owned.json',directory)),
    ]);
    assert.equal(sha256(factsBytes),'sha256:d0440c17dd8e5f02e3e9e456cfe116bce415fd163a6d0ab750f3934616842989');
    assert.equal(sha256(publicationBytes),'sha256:6b95c791e7b80c11c91ed91af54a864714f8447cf52dabf3276c30ddba15c931');
    const owned=projectCommonProgram(readCommonProgramFacts(factsBytes));
    const publication=JSON.parse(publicationBytes.toString('utf8'));
    const historical=JSON.parse(historicalBytes.toString('utf8'));
    const request=historical.request;
    const core=process.env.TSFG_CORE_IR_EXE;
    const expected=await compileOwnedCore(owned,{core,callPublicationContext:{publication,request}});
    assert.equal(expected.status,'ok',expected.message);
    const args=['--input-kind','hir','--emit','core','--core',core];
    const withPublication=[...args,'--publication',fileURLToPath(publicationPath)];
    const documents={'kernel-request':request};
    const result=await runCli(owned,withPublication,documents);
    assert.equal(result.status,0,result.stderr.toString('utf8'));
    assert.equal(result.stderr.length,0);
    assert.deepEqual(result.stdout,Buffer.from(expected.core));
    assert.equal(owned.functions.length,2);
    for(const fn of owned.functions) assert.ok(result.stdout.includes(Buffer.from(fn.id)));
    assert.ok(result.stdout.includes(Buffer.from(publication.expectedDigest)));

    for(const child of [
      await runCli(owned,withPublication),
      await runCli(owned,args,documents),
      await runCli(hir,withPublication,documents),
    ]){
      assert.equal(child.status,2);
      assert.equal(child.stdout.length,0);
      assert.match(child.stderr.toString('utf8'),/r03-cli-options/);
    }
    const old=await runCli(owned,args,{publication:historical.publication,...documents});
    assert.equal(old.status,11);
    assert.match(JSON.parse(old.stdout.toString('utf8')).message,/r03-common-program-schema/);
  });

  test('cold Common Core still requires fixed publication and request',async()=>{
    const {mixed}=await mixedCommonHir();
    const cold=readHir(Buffer.from(printHir(mixed)));
    const result=await compileOwnedCore(cold,{core:process.env.TSFG_CORE_IR_EXE});
    assert.deepEqual(result,{status:'tool-error',code:'r03-d-consumer',message:'r03-common-program-input: complete common Program differs'});
  });

  test('owned HIR CLI uses the admitted static Core for real Core and R04 output',async()=>{
    const core=await runCli(hir,['--input-kind','hir','--emit','core','--core',process.env.TSFG_CORE_IR_EXE]);
    assert.equal(core.status,0,core.stdout.toString('utf8')+core.stderr.toString('utf8'));
    assert.equal(core.stderr.length,0);
    assert.match(core.stdout.toString('utf8'),/"func.func"/);
    assert.match(core.stdout.toString('utf8'),/sym_name = "entry"/);
    assert.ok(core.stdout.includes(Buffer.from(hir.functions[0].id)));
    const wire=await runCli(hir,['--input-kind','hir','--emit','bytecode','--core',process.env.TSFG_CORE_IR_EXE]);
    assert.equal(wire.status,0,wire.stdout.toString('utf8')+wire.stderr.toString('utf8'));
    assert.equal(wire.stderr.length,0);
    assert.equal(wire.stdout.subarray(0,8).toString('ascii'),'TSFGTBC0');
    assert.equal(wire.stdout.readUInt32LE(8),12);
    assert.equal(wire.stdout.readUInt32LE(44),wire.stdout.length);
    assert.equal('sha256:'+wire.stdout.subarray(48,80).toString('hex'),sha256(wire.stdout.subarray(80)));
  });

  test('cold exception Core output completes without a wire12 packet',async()=>{
    const source=new URL('../fixtures/r03/m21-exception/first/',import.meta.url);
    const [request,response,provenance]=await Promise.all(['request.json','response.json','origin.json']
      .map(name=>readFile(new URL(name,source))));
    assert.deepEqual([request,response,provenance].map(sha256),[
      'sha256:8b081a06e3853bf8557206f3aafac4f8211622a224899a363c7c63bb34a030ed',
      'sha256:45317ccc970c8464d90cba8da674aea3da5756fbb39a7ba5dfc3326fad2d1a5a',
      'sha256:58842dfb6862b162c2cd82a6e79298905ebd3eec5d6e30618797d5e91b67f612']);
    const origin=JSON.parse(provenance.toString('utf8'));
    const imported=await importCapturedFrontendResponse(request,response,origin);
    assert.equal(imported.status,'ok');
    const built=buildHir(imported.snapshot);
    assert.equal(built.status,'ok');
    assert.deepEqual(built.hir,expectedHir(origin));

    const executable=await verifiedConsumer(process.env.TSFG_CORE_IR_EXE,'core');
    const canonicalized=spawnSync(executable,['--canonicalize'],{
      input:lowerFormalHir(built.hir),windowsHide:true,maxBuffer:16*1024*1024});
    assert.ifError(canonicalized.error);
    assert.equal(canonicalized.status,0,canonicalized.stderr.toString('utf8'));
    const arguments_=['--input-kind','hir','--core',executable,'--emit'];
    const core=await runCli(built.hir,[...arguments_,'core']);
    assert.equal(core.status,0,core.stdout.toString('utf8')+core.stderr.toString('utf8'));
    assert.equal(core.stderr.length,0);
    assert.deepEqual(core.stdout,canonicalized.stdout);
    const optimized=await compileOwnedCore(built.hir,{core:executable,optimize:true});
    assert.deepEqual(optimized,{status:'ok',hir:built.hir,core:canonicalized.stdout.toString('utf8')});

    const wire=await runCli(built.hir,[...arguments_,'bytecode']);
    assert.equal(wire.status,11);
    assert.equal(wire.stderr.length,0);
    assert.match(JSON.parse(wire.stdout.toString('utf8')).message,/^\[r04-core-exception-unsupported\]/);
  });

  test('cold generic Core and R04 CLI output preserves the concrete instance closure',async()=>{
    const bytes=await readFile(new URL('./fixtures/generic-recursive-conditional-hir-v7.json',import.meta.url));
    assert.equal(sha256(bytes),'sha256:322986e704120209b4ea700eff06f2cc6536ce7e821c48cfcfc7ea51f6992bc5');
    const generic=JSON.parse(bytes.toString('utf8'));
    const executable=process.env.TSFG_CORE_IR_EXE;
    const compiled=await compileOwnedHir(generic,{core:executable});
    assert.equal(compiled.status,'ok',JSON.stringify(compiled));
    const arguments_=['--input-kind','hir','--core',executable,'--emit'];
    for(const [mode,expected] of [['core',Buffer.from(compiled.core)],['bytecode',compiled.bytecode]]){
      const actual=await runCli(generic,[...arguments_,mode]);
      assert.equal(actual.status,0,actual.stderr.toString('utf8'));
      assert.equal(actual.stderr.length,0);
      assert.deepEqual(actual.stdout,expected);
    }
  });
}
