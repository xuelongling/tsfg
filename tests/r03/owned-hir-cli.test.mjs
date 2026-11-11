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
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {compileOwnedCore,compileOwnedHir,verifiedConsumer} from '../../compiler/pipeline.mjs';
import {expectedHir} from './formal-exception-source-oracle.mjs';

const fixture=await readFile(new URL('./testdata/formal-cold-profile/owned-snapshot-hir.json',import.meta.url));
assert.equal(sha256(fixture),'sha256:5f22b4e99e09737ef6d58c544fc44a107d8fc0b6dc9d0c00ea52a9f837af8ae7');
const {hir}=JSON.parse(fixture.toString('utf8'));
const cli=fileURLToPath(new URL('../../tooling/tsfgc.mjs',import.meta.url));

async function runCli(value,args){
  const directory=await mkdtemp(path.join(tmpdir(),'tsfg-owned-hir-cli-'));
  const input=path.join(directory,'owned-hir.json');
  await writeFile(input,canonical(value)+'\n');
  const command=[cli,'--input',input,...args];
  const child=spawnSync(process.execPath,command,{windowsHide:true,maxBuffer:16*1024*1024,timeout:30000});
  await writeFile(path.join(directory,'stdout.bin'),child.stdout??Buffer.alloc(0));
  await writeFile(path.join(directory,'stderr.bin'),child.stderr??Buffer.alloc(0));
  await writeFile(path.join(directory,'child.json'),JSON.stringify({pid:child.pid,args:command,status:child.status,signal:child.signal,error:child.error?.message})+'\n');
  assert.equal(child.error,undefined);
  assert.equal(child.signal,null);
  return child;
}

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
