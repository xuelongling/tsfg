// SPDX-License-Identifier: MIT
// Cross the real module Interfaces using data only. No build process is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canonicalize,digest} from '../../eng/build-data.mjs';
import {parseBuildOptions,parseOptions} from '../../eng/build-options.mjs';
import {selectMlirCommandRole} from '../../eng/mlir-command.mjs';
import {archivePath,parseTar,parseZip} from '../../eng/build-archive-readers.mjs';
import {createTar,createZip} from '../../eng/build-archive-writers.mjs';
import {ConfigurationError} from '../../eng/build-errors.mjs';
import {createBuildPolicy} from '../../eng/build-policy.mjs';

test('production options preserve the Core role and reject duplicate or unknown input',()=>{
 const parsed=parseBuildOptions(['build','--dev','--source-target','mlir-core','--core-command-role','static']);
 assert.equal(parsed.get('--dev'),true);
 assert.equal(selectMlirCommandRole(parsed).target,'tsfg-core-static');
 assert.throws(()=>parseBuildOptions(['build','--core-command-role','static','--core-command-role','native']),ConfigurationError);
 assert.throws(()=>parseOptions(['build','--unknown','value'],new Set()),/unknown option/);
 assert.throws(()=>parseBuildOptions(['build','--core-command-role']),/invalid argument/);
});

test('canonical identity data retains Unicode validation, member ordering and digest',()=>{
 assert.equal(canonicalize({z:[true,'text'],a:{b:2,a:1}}),'{"a":{"a":1,"b":2},"z":[true,"text"]}');
 assert.throws(()=>canonicalize({value:'\ud800'}),/lone surrogate/);
 assert.equal(digest('abc'),'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 const policy=createBuildPolicy('windows-x86_64-msvc','debug',{simdDispatch:'runtime-detected'});
 assert.equal(policy.cpuBaseline,'x86-64-v2');assert.equal(policy.cxx.optimization,'/Od');
 assert.deepEqual(policy.forbidden,{fastMath:false,lto:false,nativeTuning:false,pgo:false});
});

test('package encoders and acquisition readers preserve paths, modes and original bytes',()=>{
 const entries=[{path:'b.txt',mode:0o100644,bytes:Buffer.from('second\n')},
  {path:'a.bin',mode:0o100755,bytes:Buffer.from([0,1,255])}];
 for(const {encode,decode} of [{encode:createTar,decode:parseTar},{encode:createZip,decode:parseZip}]) {
  const bytes=encode(entries,1700000000),decoded=decode(bytes);
  assert.deepEqual(decoded.map(row=>row.name),['a.bin','b.txt']);
  assert.deepEqual(decoded.map(row=>row.bytes),[entries[1].bytes,entries[0].bytes]);
  assert.deepEqual(decoded.map(row=>row.mode),[0o755,0o644]);
  const corrupt=Buffer.from(bytes);corrupt[0]^=1;
  assert.throws(()=>decode(corrupt));
 }
 assert.throws(()=>archivePath('E:/owned-fixture','../outside',0),/unsafe/);
 assert.throws(()=>archivePath('E:/owned-fixture','a\\b',0),/unsafe/);
});

test('all declared command modules are bounded static source files with an acyclic dependency graph',async()=>{
 const declaration=JSON.parse(await readFile(new URL('../../eng/build-inputs.json',import.meta.url),'utf8'));
 const names=declaration.entries.map(row=>row.path).filter(name=>/^eng\/build-[a-z-]+\.mjs$/.test(name));
 assert.equal(names.length,36);
 const graph=new Map();
 for(const name of [...names,'eng/tsfg-build.mjs']) {
  const text=await readFile(new URL('../../'+name,import.meta.url),'utf8');
  assert.ok(text.split('\n').length-1<=500,name);
  assert.doesNotMatch(text,/\bnew Function\(|\beval\(/,name);
  graph.set(name,[...text.matchAll(/^import .* from "\.\/(build-[a-z-]+\.mjs)";/gm)].map(match=>'eng/'+match[1]));
 }
 const done=new Set(),visiting=new Set();
 function visit(name) {
  if(done.has(name))return;
  assert.equal(visiting.has(name),false,'module cycle at '+name);visiting.add(name);
  for(const child of graph.get(name)??[])visit(child);
  visiting.delete(name);done.add(name);
 }
 for(const name of graph.keys())visit(name);
 const entry=await readFile(new URL('../../eng/tsfg-build.mjs',import.meta.url),'utf8');
 assert.match(entry,/await runBuildCommand\(/);assert.match(entry,/await runTestCommand\(/);
 assert.match(entry,/await runPackageCommand\(/);assert.match(entry,/await runReproCommand\(/);
});
