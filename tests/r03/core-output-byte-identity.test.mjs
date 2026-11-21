// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {compileCommonBorrowProof,compileOwnedCore,compileOwnedHir,compileOwnedStaticProgram} from '../../compiler/pipeline.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {importCapturedFrontendResponse} from '../../compiler/frontend.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {readGenericHir} from '../../compiler/generic-hir.mjs';
import {expectedGenericCore} from './generic-core-package-capture.mjs';
import {expectedExceptionModule} from './formal-exception-module-oracle.mjs';
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
const commonCapture=process.env.TSFG_R03_COMMON_PAIR_CAPTURE;
const exceptionCapture=process.env.TSFG_R03_EXCEPTION_PAIR_CAPTURE;
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
  let dependentInput;
  let stdout=valid;
  /** @type {Buffer | undefined} */
  let packetStdout;
  /** @type {Buffer | undefined} */
  let borrowStdout;
  t.mock.method(childProcess,'spawnSync',(executable,args,options)=>{
    assert.equal(executable,artifact);
    assert.ok(Array.isArray(args));
    calls.push(args);
    const action=args.at(-1);
    const output=action==='--emit-bytecode'?packetStdout:action==='--borrow-proof'?borrowStdout:stdout;
    assert.ok(output&&['--canonicalize','--optimize','--emit-bytecode','--borrow-proof'].includes(action),'unexpected downstream stage '+args.join(' '));
    if(action==='--emit-bytecode'||action==='--borrow-proof')dependentInput=options.input;
    else coreInput=options.input;
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
  await t.test('generic Core transport binds its first top-level function',async sub=>{
    const fixture=name=>fs.readFile(new URL('./fixtures/'+name,import.meta.url));
    const [hirBytes,coreBytes]=await Promise.all([
      fixture('generic-recursive-conditional-hir-v7.json'),fixture('generic-recursive-conditional-core-v7.mlir'),
    ]);
    const checked=readGenericHir(hirBytes),root=checked.closure.roots[0];
    const header=coreBytes.toString('utf8').split('\n',1)[0];
    const rootField='tsfg_core.function_id = "'+root+'"';
    const otherField='tsfg_core.function_id = "sha256:80608d127848d931cf95b6f74401576cde929a49d0f2b89c97e6636b7161c4d4"';
    assert.equal(root,'sha256:de5deb74229f008bb111bfb9140de6260737fcecfa13f252a01296f9c251006f');
    const options={core:artifact},wrongRoot={status:'tool-error',code:'r03-d-consumer',
      message:'r03-core-output: first generic function differs from the checked default root'};
    sub.after(()=>{stdout=valid;packetStdout=undefined;});
    // Model the printer's function region and own dictionary, with the checked
    // bool root first. The archived HIR supplies its real identity and order.
    const operation=(name,type,fields,bodyFields='')=>'  "func.func"() <{function_type = ('+type+') -> '+type+
      ', sym_name = "'+name+'"}> ({\n  ^bb0(%arg: '+type+'):\n    "func.return"(%arg)'+bodyFields+' : ('+type+') -> ()\n  }) {'+
      fields+'} : () -> ()';
    const modeled=(first,second)=>framedCore([header,first,second,'}'].join('\n'));
    const boolRoot=operation('route_bool','i1',rootField),other=operation('route_f64','f64',otherField);
    stdout=modeled(boolRoot,other);
    const accepted=await compileOwnedCore(checked,options);
    assert.equal(accepted.status,'ok');
    assert.deepEqual(Buffer.from(accepted.core,'utf8'),stdout);

    await sub.test('retained same-input Core is rejected before the next stage',{skip:!capture},async()=>{
      const retained=await fs.readFile(path.join(capture,'tsfg-owned-hir-cli-VGcGjr','stdout.bin'));
      stdout=Buffer.from(retained);
      assert.equal(sha256(stdout),'sha256:bb72e86dc34b310a43851ffa15a1f3e3e313e101c65399d4e246d168b710f3fa');
      packetStdout=Buffer.alloc(0);
      const first=calls.length;
      const text=await compileOwnedCore(checked,{...options,optimize:true});
      const bytecode=await compileOwnedHir(checked,options);
      assert.equal(text.status,'tool-error');
      assert.deepEqual(text,wrongRoot);
      assert.deepEqual(calls.slice(first),[['--optimize'],['--canonicalize']]);
      assert.deepEqual(bytecode,wrongRoot);
    });
    await sub.test('nested and later IDs cannot replace a unique own field',async()=>{
      for(const fields of [otherField,'nested = [{'+rootField+'}]',
        'note = '+JSON.stringify(rootField),rootField+', '+rootField]){
        stdout=modeled(operation('route_f64','f64',fields,' {'+rootField+'}'),boolRoot);
        const result=await compileOwnedCore(checked,options);
        assert.equal(result.status,'tool-error');
        assert.deepEqual(result,wrongRoot);
      }
    });
    await sub.test('alternate spellings cannot hide a duplicate own ID',async()=>{
      const quoted='"tsfg_core.function_id" = "'+root+'"';
      const escaped='"\\74sfg_core.function_id" = "'+root+'"';
      const results=[];
      for(const duplicate of ['  '+rootField,' '+quoted,' '+escaped]){
        stdout=modeled(operation('route_bool','i1',rootField+','+duplicate),other);
        results.push(await compileOwnedCore(checked,options));
      }
      assert.deepEqual(results.map(result=>result.status),['tool-error','tool-error','tool-error']);
      assert.deepEqual(results,[wrongRoot,wrongRoot,wrongRoot]);
    });
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
  await t.test('Common transport checks Core input before its dependent stage',async sub=>{
    let common,publication,request,matching,foreign,retainedPacket;
    if(commonCapture){
      const retained=JSON.parse(await fs.readFile(commonCapture,'utf8'));
      const [right,plus,packet]=await Promise.all([retained.right,retained.foreign,retained.packet].map(file=>fs.readFile(file)));
      assert.equal(sha256(right),'sha256:7c278bf56fe5b45b9f0b57b5dec97bb149f4224d24eb454dd25826b39a064314');
      assert.equal(sha256(plus),'sha256:1ec57ca88342428241ff365bc6d08ff5d045417b2fbda2c21cf031c940f18614');
      assert.equal(sha256(packet),'sha256:b16b5cba1c72a906b14ac1854e304b2f32a34d68a4810b45c1e386a2b38ba807');
      common=JSON.parse(retained.context.hir);publication=JSON.parse(retained.context.publication);request=JSON.parse(retained.context.request);
      assert.equal(common.inputIdentity,'sha256:3dce93bcece355dbd642fe88f4f1fb140442cb1af5a81f19588cce7889945f16');
      // These retained inputs supply module bodies; only the printer frame is modeled.
      matching=framedCore(right.toString('utf8'));foreign=framedCore(plus.toString('utf8'));retainedPacket=packet;
    }else{
      common=projectCommonProgram(facts);publication=createCommonProgramPublication(common);
      request={targets:common.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
      matching=framedCore(commonProgramCore(common,publication,request).text);foreign=valid;
    }
    const options={core:artifact,callPublicationContext:{publication,request},factsContext:commonCapture?undefined:{
      family:'tsfg.common-program-context-candidate',version:facts.version,factsBytes,expectedPackageId:facts.packageId,
    }};
    sub.after(()=>{stdout=valid;packetStdout=undefined;borrowStdout=undefined;});
    await sub.test('Common Core text rejects the foreign module',async()=>{
      stdout=matching;
      const accepted=await compileOwnedCore(common,options);
      assert.equal(accepted.status,'ok');
      assert.deepEqual(Buffer.from(accepted.core,'utf8'),matching);
      stdout=foreign;
      const rejected=await compileOwnedCore(common,{...options,optimize:true});
      assert.equal(rejected.status,'tool-error');
      assert.deepEqual(rejected,mismatch);
    });
    await sub.test('Common bytecode checks the input before emission',async()=>{
      packetStdout=retainedPacket??Buffer.alloc(0);
      stdout=matching;
      let first=calls.length;
      const accepted=await compileOwnedHir(common,options);
      assert.deepEqual(calls.slice(first),[['--common-program','--canonicalize'],['--common-program','--emit-bytecode']]);
      assert.deepEqual(Buffer.from(dependentInput,'utf8'),matching);
      if(retainedPacket){
        assert.equal(accepted.status,'ok');
        assert.deepEqual(accepted.bytecode,retainedPacket);
      }else assert.deepEqual(accepted,{status:'tool-error',code:'r03-d-consumer',
        message:'r04-common-producer-identity: output differs from exact Common20 development envelope'});
      stdout=foreign;
      first=calls.length;
      const rejected=await compileOwnedHir(common,options);
      assert.deepEqual(calls.slice(first),[['--common-program','--canonicalize']]);
      assert.deepEqual(rejected,mismatch);
    });
    await sub.test('Common borrow proof checks the input before analysis',async()=>{
      const expected=commonProgramCore(common,publication,request,{borrowProof:true}).borrowProof;
      borrowStdout=Buffer.from(canonical(expected)+'\n');
      stdout=matching;
      let first=calls.length;
      const accepted=await compileCommonBorrowProof(common,publication,request,{core:artifact});
      assert.deepEqual(accepted.proof,expected);
      assert.deepEqual(calls.slice(first),[['--common-program','--canonicalize'],['--common-program','--borrow-proof']]);
      assert.deepEqual(Buffer.from(dependentInput,'utf8'),matching);
      stdout=foreign;
      first=calls.length;
      await assert.rejects(compileCommonBorrowProof(common,publication,request,{core:artifact}),
        /r03-core-output: checked input identity differs/);
      assert.deepEqual(calls.slice(first),[['--common-program','--canonicalize']]);
    });
  });
  await t.test('exception Core retains the checked module initializer input',async sub=>{
    const fixture=new URL('../fixtures/r03/m21-exception/controls/module-initialization/',import.meta.url);
    const [request,response,origin]=await Promise.all(['request.json','response.json','origin.json'].map(name=>fs.readFile(new URL(name,fixture))));
    assert.equal(sha256(response),'sha256:52de1db4d66779fea3376102df4f455b72c687348659e92abb42c20350ebb6b7');
    const imported=await importCapturedFrontendResponse(request,response,JSON.parse(origin.toString('utf8')));
    assert.equal(imported.status,'ok');
    const built=buildHir(imported.snapshot);
    assert.equal(built.status,'ok');
    const checked=built.hir;
    assert.deepEqual(checked,expectedExceptionModule(imported.snapshot));
    let matching=framedCore(lowerFormalHir(checked)),foreign=valid;
    if(exceptionCapture){
      const [retainedMatch,retainedForeign]=await Promise.all(['0092','0001'].map(name=>
        fs.readFile(path.join(exceptionCapture,name,'stdout.bin'))));
      assert.equal(sha256(retainedMatch),'sha256:7d6b53ef26791a3a273b4de16423a05f87f228dbd65ae3c2143303701ec30312');
      assert.equal(sha256(retainedForeign),'sha256:98f8cd0dad23620ece611814fdfdbd34e5cb75f574c22f3908866154004eaf65');
      matching=Buffer.from(retainedMatch);foreign=Buffer.from(retainedForeign);
    }
    sub.after(()=>{stdout=valid;packetStdout=undefined;});
    stdout=matching;
    const accepted=await compileOwnedCore(checked,{core:artifact});
    assert.equal(accepted.status,'ok');
    assert.deepEqual(Buffer.from(accepted.core,'utf8'),matching);
    stdout=foreign;
    packetStdout=Buffer.alloc(0);
    const first=calls.length;
    const rejected=[
      await compileOwnedCore(checked,{core:artifact,optimize:true}),
      await compileOwnedHir(checked,{core:artifact}),
    ];
    assert.deepEqual(rejected,[mismatch,mismatch]);
    assert.deepEqual(calls.slice(first),[['--optimize'],['--canonicalize']]);
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
