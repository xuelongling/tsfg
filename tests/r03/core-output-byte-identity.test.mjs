// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {compileCommonBorrowProof,compileOwnedCore,compileOwnedHir,compileOwnedStaticProgram} from '../../compiler/pipeline.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {readGenericHir} from '../../compiler/generic-hir.mjs';
import {expectedGenericCore} from './generic-core-package-capture.mjs';

const artifact=path.join(import.meta.dirname,'core-transport-only','core.exe');
const manifestPath=path.join(path.dirname(artifact),'artifact-manifest.json');
const fakeExecutable=Buffer.from('test transport only; no executable');
const product=new URL('../../',import.meta.url);
const sourceCatalog='compiler/core-ir/sources.json';
const catalog=JSON.parse(await fs.readFile(new URL(sourceCatalog,product),'utf8'));
const required=[sourceCatalog,'compiler/core-ir/CMakeLists.txt','eng/core-ir-inputs.mjs',
  'eng/mlir-command.mjs','contracts/registry.json','contracts/bytecode.schema.json',
  ...[catalog.common,catalog.static].flatMap(({sources,headers,externalHeaders})=>
    [...sources,...headers].map(name=>'compiler/core-ir/'+name).concat(externalHeaders))];
const entries=await Promise.all(required.map(async name=>({projectId:'tsfg',repositoryRelativePath:name,
  sha256:sha256(await fs.readFile(new URL(name,product)))})));
const manifest=JSON.stringify({
  outputs:[{path:'core.exe',sha256:sha256(fakeExecutable)}],buildInputSet:{entries},
  buildIdentity:{target:'windows-x86_64-msvc',profile:'debug',options:{coreCommandRole:'static'}},
});
const profile=new URL('./testdata/formal-cold-profile/',import.meta.url);
const {hir}=JSON.parse(await fs.readFile(new URL('owned-snapshot-hir.json',profile),'utf8'));
const core=await fs.readFile(new URL('checked-i8.core.mlir',profile));
assert.equal(sha256(core),'sha256:908bcb58249895f78d1c2e8e1ec8cee5b4a10d4b5d66f9b0e0bd803a0c12f05a');
const comment=Buffer.from('// Source note: ');
const valid=Buffer.concat([core,comment,Buffer.from('\ufffd\n')]);
const malformed=Buffer.concat([core,comment,Buffer.of(255,10)]);

test('Core transport preserves valid bytes and rejects malformed stdout before dependent stages',async t=>{
  const readFile=fs.readFile;
  t.mock.method(fs,'readFile',async (file,...args)=>{
    if(file===artifact)return fakeExecutable;
    if(file===manifestPath)return manifest;
    return Reflect.apply(readFile,fs,[file,...args]);
  });
  /** @type {string[][]} */
  const calls=[];
  let coreInput;
  let stdout=valid;
  t.mock.method(childProcess,'spawnSync',(executable,args,options)=>{
    assert.equal(executable,artifact);
    assert.ok(Array.isArray(args));
    calls.push(args);
    assert.ok(['--canonicalize','--optimize'].includes(args.at(-1)),'unexpected downstream stage '+args.join(' '));
    coreInput=options.input;
    return {stdout,stderr:Buffer.alloc(0),status:0,signal:null,output:[null,stdout,Buffer.alloc(0)],pid:0};
  });
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});

  const compiled=await compileOwnedCore(hir,{core:artifact});
  assert.equal(compiled.status,'ok');
  assert.deepEqual(Buffer.from(compiled.core,'utf8'),valid);
  const factsBytes=await fs.readFile(new URL('./testdata/common-borrow-proof/safe-lastuse-facts.json',import.meta.url));
  const facts=readCommonProgramFacts(factsBytes);
  await t.test('Core transport keeps the lowering context across asynchronous admission',async()=>{
    const options={core:artifact};
    const first=calls.length;
    const pending=compileOwnedCore(hir,options);
    Object.assign(options,{factsContext:{family:'tsfg.common-program-context-candidate',version:facts.version,
      factsBytes,expectedPackageId:facts.packageId}});
    assert.equal((await pending).status,'ok');
    assert.deepEqual(calls.slice(first),[['--canonicalize']]);
  });
  assert.equal(valid.toString('utf8'),malformed.toString('utf8'));
  stdout=malformed;
  const expected={status:'tool-error',code:'r03-d-consumer',message:'r03-core-output: invalid UTF-8 in compiler output'};
  await t.test('AOT entry retains the original owned generic HIR and mode during admission',async()=>{
    const fixture=name=>fs.readFile(new URL('./fixtures/'+name,import.meta.url));
    const [conditionalBytes,mappedBytes,conditionalCore]=await Promise.all([
      fixture('generic-recursive-conditional-hir-v7.json'),fixture('generic-recursive-mapped-hir-v7.json'),
      fixture('generic-recursive-conditional-core-v7.mlir'),
    ]);
    const conditional=readGenericHir(conditionalBytes),mapped=readGenericHir(mappedBytes);
    const candidate=structuredClone(conditional),options={core:artifact,optimize:false};
    const first=calls.length;
    const pending=compileOwnedStaticProgram(candidate,options);
    Object.assign(candidate,mapped);
    options.optimize=true;
    assert.deepEqual(await pending,expected);
    assert.deepEqual([calls.slice(first),sha256(coreInput)],
      [[['--canonicalize']],sha256(expectedGenericCore(conditionalCore.toString('utf8'),conditional.closure.roots[0]))]);
  });
  for(const {name,compile,optimize} of [
    {name:'optimized text',compile:compileOwnedCore,optimize:true},
    {name:'bytecode',compile:compileOwnedHir,optimize:false},
    {name:'program object',compile:compileOwnedStaticProgram,optimize:false},
  ])await t.test(name,async()=>{
    const first=calls.length;
    assert.deepEqual(await compile(hir,{core:artifact,optimize}),expected);
    assert.deepEqual(calls.slice(first),[[optimize?'--optimize':'--canonicalize']]);
  });

  await t.test('Common borrow proof',async()=>{
    const common=projectCommonProgram(facts),publication=createCommonProgramPublication(common);
    const request={targets:common.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
    const first=calls.length;
    await assert.rejects(compileCommonBorrowProof(common,publication,request,{core:artifact}),
      /r03-core-output: invalid UTF-8 in compiler output/);
    assert.deepEqual(calls.slice(first),[['--common-program','--canonicalize']]);
  });
});
