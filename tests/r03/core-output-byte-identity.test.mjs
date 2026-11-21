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
import {expectedStringCore,expectedStringPacket,stringCases} from './formal-string-gold.mjs';

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

// Mock only the printer's outer framing. The compiler body remains fixture text.
/** @param {string} text @param {Buffer} [tail] */
function framedCore(text,tail=Buffer.alloc(0)){
  const [header,...body]=text.trimEnd().split('\n');
  const prefix='module attributes {';
  assert.ok(header.startsWith(prefix)&&header.endsWith('} {'));
  assert.equal(body.pop(),'}');
  return Buffer.concat([Buffer.from('"builtin.module"() ({\n'+body.join('\n')+'\n'),
    tail,Buffer.from('}) {'+header.slice(prefix.length,-3)+'} : () -> ()\n')]);
}
const valid=framedCore(core.toString('utf8'),Buffer.from('// Source note: \ufffd\n'));
const malformed=framedCore(core.toString('utf8'),Buffer.concat([Buffer.from('// Source note: '),Buffer.of(255,10)]));
const capture=process.env.TSFG_R03_CORE_PAIR_CAPTURE;
const mismatch={status:'tool-error',code:'r03-d-consumer',message:'r03-core-output: checked input identity differs'};

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
  /** @type {Buffer | undefined} */
  let packetStdout;
  t.mock.method(childProcess,'spawnSync',(executable,args,options)=>{
    assert.equal(executable,artifact);
    assert.ok(Array.isArray(args));
    calls.push(args);
    const emitPacket=args.at(-1)==='--emit-bytecode';
    assert.ok(emitPacket?packetStdout:['--canonicalize','--optimize'].includes(args.at(-1)),'unexpected downstream stage '+args.join(' '));
    if(!emitPacket)coreInput=options.input;
    const output=emitPacket?packetStdout:stdout;
    return {stdout:output,stderr:Buffer.alloc(0),status:0,signal:null,output:[null,output,Buffer.alloc(0)],pid:0};
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
  await t.test('registered Core transport rejects a foreign input before bytecode',async sub=>{
    const {hir:foreignHir}=stringCases()[0];
    const foreign=framedCore(expectedStringCore(foreignHir)).toString('utf8');
    sub.after(()=>{stdout=valid;});
    for(const text of [foreign,foreign.replace('}) {','}) {nested = [{tsfg_core.input_identity = "'+hir.inputIdentity+'"}], ')]){
      stdout=Buffer.from(text);
      const first=calls.length;
      const result=await compileOwnedHir(hir,{core:artifact});
      assert.deepEqual(result,mismatch);
      assert.deepEqual(calls.slice(first),[['--canonicalize']]);
    }
  });
  await t.test('registered Core transport binds retained compiler stdout',{skip:!capture},async sub=>{
    assert.ok(capture);
    const [matching,foreign]=await Promise.all(['3FrC2E','VGcGjr'].map(name=>
      fs.readFile(path.join(capture,'tsfg-owned-hir-cli-'+name,'stdout.bin'))));
    assert.equal(sha256(matching),'sha256:d726b11309b39a075267614589ad1c557b9d0163148f3dd8171967af0c10d3e5');
    assert.equal(sha256(foreign),'sha256:bb72e86dc34b310a43851ffa15a1f3e3e313e101c65399d4e246d168b710f3fa');
    sub.after(()=>{stdout=valid;});
    stdout=Buffer.from(matching);
    const result=await compileOwnedCore(hir,{core:artifact});
    assert.equal(result.status,'ok');
    assert.deepEqual(Buffer.from(result.core,'utf8'),matching);
    stdout=Buffer.from(foreign);
    const rejected=await compileOwnedCore(hir,{core:artifact,optimize:true});
    assert.equal(rejected.status,'tool-error');
    assert.deepEqual(rejected,mismatch);
  });
  await t.test('registered bytecode transport keeps the checked input identity',async sub=>{
    const {hir:stringHir,context}=stringCases()[0];
    const packet=expectedStringPacket(stringHir);
    assert.notEqual(hir.inputIdentity,stringHir.inputIdentity);
    const first=calls.length;
    packetStdout=packet;
    sub.after(()=>{packetStdout=undefined;stdout=valid;});
    stdout=framedCore(expectedStringCore(stringHir));
    const matched=await compileOwnedHir(stringHir,{core:artifact,factsContext:context});
    assert.equal(matched.status,'ok');
    assert.deepEqual(matched.bytecode,packet);
    stdout=framedCore(core.toString('utf8'));
    assert.deepEqual(await compileOwnedHir(hir,{core:artifact}),
      {status:'tool-error',code:'r03-d-consumer',message:'r04-producer-input-identity: packet target or input differs from the checked HIR'});
    assert.deepEqual(calls.slice(first),[['--canonicalize'],['--emit-bytecode'],['--canonicalize'],['--emit-bytecode']]);
  });
  await t.test('registered scalar bytecode transport keeps the default function',async sub=>{
    const {hir:stringHir,context}=stringCases()[0];
    const [first,second,...rest]=stringHir.functions;
    assert.notEqual(first.id,second.id);
    const selectedCore=framedCore(expectedStringCore(stringHir));
    const options={core:artifact,factsContext:context};
    const packet=expectedStringPacket(stringHir);
    stdout=selectedCore;
    packetStdout=packet;
    sub.after(()=>{packetStdout=undefined;stdout=valid;});
    const matched=await compileOwnedHir(stringHir,options);
    assert.equal(matched.status,'ok');
    assert.deepEqual(matched.bytecode,packet);

    // Both packets bind the same HIR input. Only the descriptor order differs.
    packetStdout=expectedStringPacket({...stringHir,functions:[second,first,...rest]});
    const mismatched=await compileOwnedHir(stringHir,options);
    assert.equal(mismatched.status,'tool-error');
    assert.deepEqual(mismatched,{status:'tool-error',code:'r03-d-consumer',
      message:'r04-producer-default-root: first scalar function differs from the checked default root'});
  });
  assert.equal(valid.toString('utf8'),malformed.toString('utf8'));
  stdout=malformed;
  const expected={status:'tool-error',code:'r03-d-consumer',message:'r03-core-output: invalid UTF-8 in compiler output'};
  await t.test('owned scalar compilation keeps the requested mode during admission',async()=>{
    for(const {compile,optimize} of [{compile:compileOwnedCore,optimize:false},{compile:compileOwnedHir,optimize:true}]){
      const options={core:artifact,optimize};
      const first=calls.length;
      const pending=compile(hir,options);
      options.optimize=!optimize;
      assert.deepEqual(await pending,expected);
      assert.deepEqual(calls.slice(first),[[optimize?'--optimize':'--canonicalize']]);
    }
  });
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
