// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {canonical,sha256} from '../../compiler/identity.mjs';

const fixture=await readFile(new URL('./testdata/formal-cold-profile/owned-snapshot-hir.json',import.meta.url));
assert.equal(sha256(fixture),'sha256:331ed141e873e7da26e2bbd65301d1e5f1b7eb61dcd3b6ee61800a52bb00ae6b');
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
    assert.equal(wire.stdout.readUInt32LE(8),10);
    assert.equal(wire.stdout.readUInt32LE(44),wire.stdout.length);
    assert.equal('sha256:'+wire.stdout.subarray(48,80).toString('hex'),sha256(wire.stdout.subarray(80)));
  });
}
