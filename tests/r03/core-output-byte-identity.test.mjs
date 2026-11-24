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
import {buildHir,lowerFormalHir,readHir} from '../../compiler/hir.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {readGenericHir} from '../../compiler/generic-hir.mjs';
import {decodeReferenceFacts} from '../../compiler/reference-facts.mjs';
import {buildReferenceHir} from '../../compiler/reference-hir.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {expectedGenericCore} from './generic-core-package-capture.mjs';
import {readClosureSourceCase} from './closure-core-consumer-cases.mjs';
import {expectedExceptionModule} from './formal-exception-module-oracle.mjs';
import {expectedStringCore,expectedStringPacket,stringCases} from './formal-string-gold.mjs';
import {decodeMlirString} from './string-core-structural-oracle.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';

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
const closureCapture=process.env.TSFG_R03_CLOSURE_PAIR_CAPTURE;
const finiteCapture=process.env.TSFG_R03_FINITE_PAIR_CAPTURE;
const commonCapture=process.env.TSFG_R03_COMMON_PAIR_CAPTURE;
const exceptionCapture=process.env.TSFG_R03_EXCEPTION_PAIR_CAPTURE;
const referenceCapture=process.env.TSFG_R03_REFERENCE_PAIR_CAPTURE;
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
  /** @type {Buffer} */
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
  await t.test('ordinary bytecode reads lowering options once after Core admission',async sub=>{
    const reads=[];
    const options={core:/** @type {string|undefined} */(undefined),
      get optimize(){reads.push('optimize');return false;},
      get factsContext(){reads.push('facts');return undefined;},
      get callPublicationContext(){reads.push('publication');return undefined;},
    };
    const missing=await compileOwnedHir(hir,options);
    const withoutCore=reads.splice(0);
    options.core=artifact;
    packetStdout=Buffer.alloc(0);
    sub.after(()=>{packetStdout=undefined;});
    const first=calls.length,pending=compileOwnedHir(hir,options);
    const beforeAdmission=[...reads];
    await pending;
    assert.deepEqual(missing,{status:'tool-error',code:'r03-d-consumer',message:'r03-tool-core: formal executable is required'});
    assert.deepEqual({withoutCore,beforeAdmission,reads},
      {withoutCore:[],beforeAdmission:['optimize'],reads:['optimize','facts','publication']});
    assert.deepEqual(calls.slice(first),[['--canonicalize'],['--emit-bytecode']]);
  });
  await t.test('owned finite Core keeps the original Span request during admission',async sub=>{
    async function finiteFixture(file,digest) {
      const factsBytes=await fs.readFile(new URL('./testdata/'+file,import.meta.url));
      assert.equal(sha256(factsBytes),'sha256:'+digest);
      const facts=readTypedArrayFacts(factsBytes);
      const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
      const publication=staticPublication(facts),built=buildHir(facts,context,publication);
      assert.equal(built.status,'ok');
      return {hir:built.hir,context,publication};
    }
    const [original,replacement]=await Promise.all([
      finiteFixture('typed-array-span-array-slots/f0f4a3e0a384a08fdfe7532a6bd86e63f52e3f6c3704cf53a60f0dfee2629979-package.json',
        '512d8c5d1d5c481f27d7d9af0a13ef5e205f6289b37abf305acc1c225faf399e'),
      finiteFixture('typed-array-aggregate-storage/selected-return-package.json',
        '48b781c24069dc159ffe9802388625abd0612a99e1032e3d526ec631b6dd28a4'),
    ]);
    assert.notEqual(original.hir.inputIdentity,replacement.hir.inputIdentity);
    const missingReads=[];
    const missing=await compileOwnedHir(original.hir,{
      get core(){missingReads.push('core');return undefined;},
      get optimize(){missingReads.push('optimize');return false;},
      get factsContext(){missingReads.push('facts');return original.context;},
      get callPublicationContext(){missingReads.push('publication');return original.publication;},
    });
    assert.deepEqual(missing,{status:'tool-error',code:'r03-d-consumer',message:'r03-tool-core: formal executable is required'});
    assert.deepEqual(missingReads,['core']);
    const lower=value=>lowerFormalHir(value.hir,value.context,value.publication);
    const originalText=lower(original);
    const [matching,foreign]=finiteCapture?await Promise.all(['0002','0003'].map(name=>fs.readFile(path.join(finiteCapture,name,'stdout.bin')))):
      [framedCore(originalText),framedCore(lower(replacement))];
    if(finiteCapture){
      assert.equal(sha256(matching),'sha256:a0c61a625461141b31f901ffce06e990543c97eed9fce6332d46a2f96d6313bb');
      assert.equal(sha256(foreign),'sha256:17aa2a9cae229691646ebce33e5a2addce61199b014962ee6a0664ee37fd4b73');
    }
    function replaceDuringAdmission(compile) {
      const candidate=structuredClone(original.hir),factsContext={...original.context},callPublicationContext=structuredClone(original.publication);
      let factsReads=0;
      const options={core:artifact,optimize:false,get factsContext(){factsReads++;return factsContext;},callPublicationContext};
      const pending=compile(candidate,options);
      assert.equal(factsReads,1);
      Object.assign(candidate,replacement.hir);
      Object.assign(factsContext,replacement.context);
      Object.assign(callPublicationContext,replacement.publication);
      Object.assign(options,{core:'replacement.exe',optimize:true});
      return pending;
    }
    sub.after(()=>{stdout=valid;packetStdout=undefined;});
    stdout=Buffer.from(matching);
    let first=calls.length;
    const accepted=await replaceDuringAdmission(compileOwnedCore);
    assert.deepEqual(calls.slice(first),[['--canonicalize']]);
    assert.equal(sha256(coreInput),sha256(originalText));
    assert.equal(accepted.status,'ok');
    assert.deepEqual(accepted.hir,original.hir);
    assert.deepEqual(Buffer.from(accepted.core,'utf8'),matching);

    stdout=Buffer.from(foreign);packetStdout=Buffer.alloc(0);
    first=calls.length;
    assert.deepEqual(await replaceDuringAdmission(compileOwnedHir),mismatch);
    assert.deepEqual(calls.slice(first),[['--canonicalize']]);
    assert.equal(sha256(coreInput),sha256(originalText));
  });
  await t.test('owned Optional Core keeps the verified request and output identity',async sub=>{
    const factsBytes=await fs.readFile(new URL('./testdata/optional-property-v1/source-package.json',import.meta.url));
    assert.equal(sha256(factsBytes),'sha256:4e1dce8a4319159993e93cd3ef8143850456c923dc5a35a46d33bdefca33c4ab');
    const facts=JSON.parse(factsBytes.toString('utf8'));
    const context={family:'tsfg.optional-property-facts-context-candidate',version:1,factsBytes,expectedPackageId:facts.packageId};
    const built=buildHir(facts,context);
    assert.equal(built.status,'ok');
    const held=built.hir,original=lowerFormalHir(held,context);
    assert.equal(sha256(canonical(held)+'\n'),'sha256:ddb62103bf9a21c766b781b1eebca627675822acf046d299e61096b6d13c4c6a');
    // The existing verified finite body supplies the input. Model only the printer frame.
    const matching=framedCore(original);
    sub.after(()=>{stdout=valid;packetStdout=undefined;});
    await sub.test('caller mutation during admission cannot replace the Optional request',async()=>{
      stdout=matching;
      const candidate=structuredClone(held),factsContext={...context};
      const options={core:artifact,optimize:false,factsContext};
      const first=calls.length,pending=compileOwnedCore(candidate,options);
      Object.assign(candidate,{inputIdentity:hir.inputIdentity});
      Object.assign(factsContext,{factsBytes:Buffer.from('{}')});
      Object.assign(options,{core:'replacement.exe',optimize:true});
      const accepted=await pending;
      assert.equal(accepted.status,'ok');
      assert.deepEqual(accepted.hir,held);
      assert.deepEqual(Buffer.from(accepted.core,'utf8'),matching);
      assert.deepEqual(calls.slice(first),[['--canonicalize']]);
      assert.equal(sha256(coreInput),sha256(original));
    });
    await sub.test('foreign Core stops before Optional bytecode',async()=>{
      stdout=valid;packetStdout=Buffer.alloc(0);
      const first=calls.length,options={core:artifact,factsContext:context};
      const text=await compileOwnedCore(held,options),bytecode=await compileOwnedHir(held,options);
      assert.equal(text.status,'tool-error');
      assert.deepEqual(text,mismatch);
      assert.deepEqual(calls.slice(first),[['--canonicalize'],['--canonicalize']]);
      assert.deepEqual(bytecode,mismatch);
    });
    await sub.test('missing Core and unexpected Optional publication keep their diagnostics',async()=>{
      for(const compile of [compileOwnedCore,compileOwnedHir]){
        const reads=[];
        const failure=await compile(held,{
          get core(){reads.push('core');return undefined;},
          get optimize(){reads.push('optimize');return false;},
          get factsContext(){reads.push('facts');return context;},
          get callPublicationContext(){reads.push('publication');return undefined;},
        });
        assert.deepEqual(failure,{status:'tool-error',code:'r03-d-consumer',message:'r03-tool-core: formal executable is required'});
        assert.deepEqual(reads,compile===compileOwnedCore?['facts','publication','core']:['core']);
      }
      const first=calls.length;
      assert.deepEqual(await compileOwnedHir(held,{core:artifact,factsContext:context,callPublicationContext:{}}),
        {status:'tool-error',code:'r03-d-consumer',message:'r03-optional-property-context: unexpected publication'});
      assert.equal(calls.length,first);
    });
  });
  await t.test('Reference Core transport keeps the verified facts identity',async sub=>{
    async function reference(name,directory,coreHash) {
      const fixture=suffix=>new URL('./fixtures/reference-source/'+name+'.'+suffix,import.meta.url);
      const [bytes,binding]=await Promise.all([fs.readFile(fixture('facts.json')),fs.readFile(fixture('binding.json'),'utf8')]);
      const hir=buildReferenceHir(decodeReferenceFacts(bytes,JSON.parse(binding)));
      const lowered=lowerFormalHir(hir);
      if(!referenceCapture)return {hir,lowered,core:framedCore(lowered)};
      const root=path.join(referenceCapture,directory,'0001');
      const original=await fs.readFile(path.join(root,'stdin.bin'));
      const core=await fs.readFile(path.join(root,'stdout.bin'));
      assert.deepEqual(Buffer.from(lowered),original);
      assert.equal(sha256(core),'sha256:'+coreHash);
      return {hir,lowered,core};
    }
    const [requested,foreign]=await Promise.all([
      reference('terminal-reference-if','reference-core-terminal-if',
        'df921a43b40441640f45b509a6d7fa077056f226d4dd276641669660528aab51'),
      reference('ancestor-super-method','reference-core-ancestor-super',
        '7f44f9f60202b812c865e5f9033eb1f8e03fcb28e114330a1e7cc17e3802e860'),
    ]);
    assert.notEqual(requested.hir.context.factsDigest,foreign.hir.context.factsDigest);
    sub.after(()=>{stdout=valid;packetStdout=undefined;});
    const options={core:artifact},first=calls.length;
    stdout=requested.core;
    const accepted=await compileOwnedCore(requested.hir,options);
    assert.equal(accepted.status,'ok');
    assert.deepEqual(Buffer.from(accepted.core,'utf8'),requested.core);
    assert.equal(coreInput,requested.lowered);
    stdout=foreign.core;packetStdout=Buffer.alloc(0);
    const actual=await compileOwnedCore(requested.hir,options);
    const bytecode=await compileOwnedHir(requested.hir,{...options,optimize:true});
    assert.deepEqual(actual,mismatch);
    assert.deepEqual(bytecode,mismatch);
    assert.deepEqual(calls.slice(first),[['--canonicalize'],['--canonicalize'],['--optimize']]);
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
  await t.test('generic Core transport binds the checked function inventory and default root',async sub=>{
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
    const modeled=(...functions)=>framedCore([header,...functions,'}'].join('\n'));
    const boolRoot=operation('route_bool','i1',rootField),other=operation('route_f64','f64',otherField);
    const remaining=checked.functions.filter(fn=>fn.id!==root).map((fn,index)=>
      operation('instance_'+index,'i1','tsfg_core.function_id = "'+fn.id+'"'));
    const nondefault='sha256:3c570a6d34471b23176a384676fc7189d13b8c3befca039106f798fe8cb0a32c';
    assert.ok(checked.closure.roots.includes(nondefault));
    const omitted=remaining.findIndex(fn=>fn.includes(nondefault));
    assert.ok(omitted>=0);
    stdout=modeled(boolRoot,...remaining);
    const accepted=await compileOwnedCore(checked,options);
    assert.equal(accepted.status,'ok');
    assert.deepEqual(Buffer.from(accepted.core,'utf8'),stdout);

    await sub.test('bytecode preserves the concrete function count',async()=>{
      const {hir:scalar}=stringCases()[0];
      const ids=[root,...checked.closure.functions.filter(id=>id!==root)];
      const packetFor=functions=>expectedStringPacket({...scalar,inputIdentity:checked.inputIdentity,
        functions:functions.map(id=>({...scalar.functions[0],id}))});
      packetStdout=packetFor(ids);
      const matched=await compileOwnedHir(checked,options);
      assert.equal(matched.status,'ok');
      assert.deepEqual(matched.bytecode,packetStdout);
      packetStdout=packetFor(ids.slice(0,-1));
      assert.deepEqual(await compileOwnedHir(checked,options),{status:'tool-error',code:'r03-d-consumer',
        message:'r04-producer-function-count: scalar function count differs from the checked HIR'});
    });

    await sub.test('missing, duplicate or foreign definitions reject before bytecode',async()=>{
      const wrongInventory={status:'tool-error',code:'r03-d-consumer',
        message:'r03-core-output: generic function inventory differs from the checked HIR'};
      const incomplete=remaining.filter((_,index)=>index!==omitted);
      const unrelated=operation('unowned_instance','i1','tsfg_core.function_id = "sha256:'+'f'.repeat(64)+'"');
      const nested=operation('unowned_instance','i1','note = "standalone"',
        ' {tsfg_core.function_id = "'+nondefault+'"}');
      packetStdout=Buffer.alloc(0);
      for(const functions of [incomplete,[...incomplete,remaining[0]],
        [...remaining,unrelated],[...incomplete,unrelated],[...incomplete,nested]]) {
        stdout=modeled(boolRoot,...functions);
        const first=calls.length;
        const actual=await compileOwnedCore(checked,options);
        const packet=await compileOwnedHir(checked,options);
        assert.deepEqual(actual,wrongInventory);
        assert.deepEqual(packet,wrongInventory);
        assert.deepEqual(calls.slice(first),[['--canonicalize'],['--canonicalize']]);
      }
    });

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

      // Reuse every function of the retained producer output and change only
      // the operation order to give the checked default root the first slot.
      const retainedText=retained.toString('utf8');
      const starts=[...retainedText.matchAll(/^  "func\.func"\(\) </gm)].map(match=>match.index);
      assert.equal(starts.length,checked.functions.length);
      const end=retainedText.lastIndexOf('\n',retainedText.trimEnd().length-1)+1;
      const functions=starts.map((start,index)=>retainedText.slice(start,starts[index+1]??end));
      const primary=functions.find(fn=>fn.split('\n').at(-2).includes(rootField));
      assert.ok(primary);
      stdout=Buffer.from(retainedText.slice(0,starts[0])+primary+functions.filter(fn=>fn!==primary).join('')+retainedText.slice(end));
      const reordered=await compileOwnedCore(checked,options);
      assert.equal(reordered.status,'ok');
      assert.deepEqual(Buffer.from(reordered.core,'utf8'),stdout);
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
  await t.test('String Core and bytecode keep the selected facts and HIR during admission',async sub=>{
    const cases=stringCases();
    const original=cases.find(row=>row.name==='lossless'),replacement=cases.find(row=>row.name==='concat');
    assert.ok(original&&replacement);
    assert.notEqual(original.hir.inputIdentity,replacement.hir.inputIdentity);
    const lowered=expectedStringCore(original.hir),packet=expectedStringPacket(original.hir);
    stdout=framedCore(lowered);
    packetStdout=packet;
    sub.after(()=>{stdout=valid;packetStdout=undefined;});
    for(const mode of [false,true]){
      const candidate=structuredClone(original.hir),factsContext=structuredClone(original.context);
      const first=calls.length,options={core:artifact,factsContext,optimize:mode};
      const pending=mode?compileOwnedHir(candidate,options):compileOwnedCore(candidate,options);
      Object.assign(candidate,replacement.hir);Object.assign(factsContext,replacement.context);
      options.optimize=!mode;
      const result=await pending;
      assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,original.hir);
      assert.equal(coreInput,lowered);
      assert.deepEqual(calls.slice(first),mode?[['--optimize'],['--emit-bytecode']]:[['--canonicalize']]);
      assert.equal('bytecode' in result,mode);
      if('bytecode' in result)assert.deepEqual(result.bytecode,packet);
    }
  });
  await t.test('String selection does not inspect proxied HIR rows before tool admission',async()=>{
    const {hir:stringHir,context}=stringCases()[0];
    const first=stringHir.functions[0];
    let reads=0;
    const proxy=value=>new Proxy(value,{getOwnPropertyDescriptor(target,key){
      reads++;
      return Reflect.getOwnPropertyDescriptor(target,key);
    }});
    for(const functions of [proxy(stringHir.functions),[proxy(first)],[{...first,returnType:proxy(first.returnType)}]]){
      const result=await compileOwnedHir({...stringHir,functions},{factsContext:context});
      assert.deepEqual(result,{status:'tool-error',code:'r03-d-consumer',message:'r03-tool-core: formal executable is required'});
    }
    assert.equal(reads,0);
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
    await sub.test('Common output keeps the selected Published and request for the same HIR',async()=>{
      const fixture=new URL('../fixtures/r03/common-fixed-publication/self-held-safe.publication-v6.json',import.meta.url);
      const source=new URL('../fixtures/r03/common-self-held-storage/self-held-external-store-safe-package.json',import.meta.url);
      const [publishedBytes,heldBytes]=await Promise.all([fs.readFile(fixture),fs.readFile(source)]);
      assert.equal(sha256(publishedBytes),'sha256:6b95c791e7b80c11c91ed91af54a864714f8447cf52dabf3276c30ddba15c931');
      assert.equal(sha256(heldBytes),'sha256:d0440c17dd8e5f02e3e9e456cfe116bce415fd163a6d0ab750f3934616842989');
      const held=projectCommonProgram(readCommonProgramFacts(heldBytes)),fixed=JSON.parse(publishedBytes.toString());
      const empty={targets:[]};
      const broader=structuredClone(fixed);
      for(const row of broader.contracts){
        row.upper.facets.lock=true;
        const {digest,...body}=row;row.digest=commonIdentity('published-contract',body);
      }
      broader.expectedDigest=commonIdentity('publication',{scopeDigest:broader.scopeDigest,contracts:broader.contracts});
      assert.notEqual(broader.expectedDigest,fixed.expectedDigest);
      const expected={status:'tool-error',code:'r03-d-consumer',message:'r03-core-output: checked Common publication or request differs'};
      const badPublication=framedCore(commonProgramCore(held,broader,empty).text);
      const selected={core:artifact,callPublicationContext:{publication:fixed,request:empty}};
      stdout=badPublication;
      assert.deepEqual(await compileOwnedCore(held,selected),expected);
      const generic=framedCore(commonProgramCore(held,fixed,empty).text).toString('utf8');
      const hex=generic.replace(/(, (?:publication|request) = )("(?:[^"\\]|\\.)*")/gu,(_,key,token)=>
        key+'"'+Buffer.from(decodeMlirString(token)).toString('latin1').replace(/["\\\x7f-\xff]/gu,byte=>
          '\\'+byte.charCodeAt(0).toString(16).padStart(2,'0'))+'"');
      assert.notEqual(hex,generic);
      stdout=Buffer.from(hex);
      const accepted=await compileOwnedCore(held,selected);
      assert.equal(accepted.status,'ok');assert.equal(accepted.core,hex);
      for(const field of ['tsfg_program.program','publication','request']){
        const altered=hex.replace(', '+field+' = ', ', X'+field+' = ');
        assert.notEqual(altered,hex);
        stdout=Buffer.from(altered);
        assert.deepEqual(await compileOwnedCore(held,selected),expected);
      }
      assert.ok(request.targets.length>1);
      stdout=framedCore(commonProgramCore(common,publication,empty).text);
      packetStdout=Buffer.alloc(0);
      const first=calls.length;
      assert.deepEqual(await compileOwnedHir(common,{...options,optimize:true}),expected);
      await assert.rejects(compileCommonBorrowProof(common,publication,request,{core:artifact}),new RegExp(expected.message));
      assert.deepEqual(calls.slice(first),[['--common-program','--optimize'],['--common-program','--canonicalize']]);
    });
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
    const sourceBytes=commonCapture?await fs.readFile(new URL('./testdata/common-program-gpu-void-v3/package.json',import.meta.url)):factsBytes;
    if(commonCapture)assert.equal(sha256(sourceBytes),'sha256:f6df2a10fcf109dc11881c28b0314200574f98036c995792e38bd9d76447406f');
    const originalFacts=readCommonProgramFacts(sourceBytes);
    const originalCore=commonProgramCore(common,publication,request).text;
    for(const explicit of [false,true])for(const output of ['core','bytecode','static']){
      await sub.test(`Common ${output} owns its request during tool admission (${explicit?'with facts':'persisted HIR'})`,async()=>{
        const candidate=structuredClone(common),publish=structuredClone({publication,request});
        const context=explicit?{family:'tsfg.common-program-context-candidate',version:originalFacts.version,
          factsBytes:Buffer.from(sourceBytes),expectedPackageId:originalFacts.packageId}:undefined;
        const selected={core:artifact,optimize:true,factsContext:context,callPublicationContext:publish};
        const compile=output==='core'?compileOwnedCore:output==='bytecode'?compileOwnedHir:compileOwnedStaticProgram;
        stdout=matching;
        packetStdout=retainedPacket??Buffer.alloc(0);
        const first=calls.length,pending=compile(candidate,selected);
        candidate.inputIdentity='sha256:'+'0'.repeat(64);
        publish.request.targets.length=0;
        if(context)context.factsBytes.fill(0);
        selected.optimize=false;
        const result=await pending;
        assert.deepEqual(calls.slice(first),output==='core'?[['--common-program','--optimize']]:
          [['--common-program','--optimize'],['--common-program','--emit-bytecode']],JSON.stringify(result));
        assert.equal(coreInput,originalCore);
        if(output!=='core')assert.deepEqual(Buffer.from(dependentInput,'utf8'),matching);
        if(output==='core'||output==='bytecode'&&retainedPacket){
          assert.equal(result.status,'ok');
          assert.deepEqual(result.hir,common);
          assert.deepEqual(Buffer.from(result.core,'utf8'),matching);
          if('bytecode' in result)assert.deepEqual(result.bytecode,retainedPacket);
        }else assert.deepEqual(result,{status:'tool-error',code:'r03-d-consumer',message:retainedPacket?
          'r04-producer-input-identity: packet target or input differs from the checked Core':
          'r04-common-producer-identity: output differs from exact Common20 development envelope'});
      });
    }
    await sub.test('Common bytecode keeps the original incompatible facts context during admission',async()=>{
      stdout=matching;
      packetStdout=retainedPacket??Buffer.alloc(0);
      const compatible={family:'tsfg.common-program-context-candidate',version:originalFacts.version,
        factsBytes:sourceBytes,expectedPackageId:originalFacts.packageId};
      for(const replace of [true,false]){
        const selected={core:artifact,factsContext:{},callPublicationContext:{publication,request}};
        const first=calls.length,pending=compileOwnedHir(common,selected);
        if(replace)selected.factsContext=compatible;
        else Object.assign(selected.factsContext,compatible);
        const result=await pending;
        assert.equal(result.status,'tool-error');
        assert.match(result.message,/^r03-d-call-effects:/);
        assert.equal(calls.length,first);
      }
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
  await t.test('formal closure Core retains its checked input identity',async sub=>{
    const [returned,shared]=await Promise.all([readClosureSourceCase('returned'),readClosureSourceCase('shared-mutable')]);
    assert.equal(returned.hir.inputIdentity,'sha256:613d356be4968391608f70569b01a025613864849ab863387a2641c95696eae8');
    assert.equal(shared.hir.inputIdentity,'sha256:f673fc79141586ba4e8c2f7bab377390e0014e1e02954793460c1ea1bab5a231');
    const [matching,foreign]=closureCapture?await Promise.all(['0001','0003'].map(name=>fs.readFile(path.join(closureCapture,name,'stdout.bin')))):
      [framedCore(lowerFormalHir(returned.hir)),framedCore(lowerFormalHir(shared.hir))];
    if(closureCapture){
      assert.equal(sha256(matching),'sha256:724e9b9783f3467e4d62e829c32e4712775bf32b2d954418444eb6d7d2d8144c');
      assert.equal(sha256(foreign),'sha256:53994db6b00f4d7c883d0d34ff218c34b895cb1caa4fd3a522d72ac9da7e924b');
    }
    const options={core:artifact};
    sub.after(()=>{stdout=valid;packetStdout=undefined;});
    for(const {hir:request,output} of [{hir:returned.hir,output:matching},{hir:shared.hir,output:foreign}]){
      stdout=Buffer.from(output);
      const accepted=await compileOwnedCore(request,options);
      assert.equal(accepted.status,'ok');
      assert.deepEqual(Buffer.from(accepted.core,'utf8'),output);
    }

    stdout=Buffer.from(foreign);packetStdout=Buffer.alloc(0);
    const first=calls.length;
    const text=await compileOwnedCore(returned.hir,options);
    const bytecode=await compileOwnedHir(returned.hir,options);
    assert.equal(text.status,'tool-error');
    assert.deepEqual(text,mismatch);
    assert.deepEqual(calls.slice(first),[['--canonicalize'],['--canonicalize']]);
    assert.deepEqual(bytecode,mismatch);
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
  await t.test('Nullable Core transport binds each returned module to its selected input',async sub=>{
    const [hirBytes,coreBytes]=await Promise.all(['nullable-presence-hir-first.json','nullable-presence-core-first.json']
      .map(name=>fs.readFile(new URL(name,import.meta.url))));
    assert.equal(sha256(hirBytes),'sha256:4b70ae12a6e499e2b08007a84bfb1c09f161053fad71ac8ddd61d6e5bdf28bd3');
    assert.equal(sha256(coreBytes),'sha256:36d4c3e469536da1bca2ff44b1fdf8273077e653539163344d185114d04ceb37');
    const {cases}=JSON.parse(hirBytes.toString('utf8')),{cases:goldens}=JSON.parse(coreBytes.toString('utf8'));
    const pairs=cases.slice(0,2).map((row,index)=>{
      const golden=goldens[index];assert.equal(row.name,golden.name);
      const checked=readHir(Buffer.from(row.hirJcsNoLf+'\n'),row.context);
      assert.ok(golden.expectedCore.includes(`tsfg_core.input_identity = "${checked.inputIdentity}"`));
      return {checked,context:row.context,text:golden.expectedCore,output:framedCore(golden.expectedCore)};
    });
    assert.notEqual(pairs[0].checked.inputIdentity,pairs[1].checked.inputIdentity);
    sub.after(()=>{stdout=valid;});
    for(const [index,optimize] of [false,true].entries()){
      const {checked,context,text,output}=pairs[index],options={core:artifact,factsContext:context,optimize};
      const first=calls.length;
      stdout=output;
      const accepted=await compileOwnedCore(checked,options);
      assert.equal(accepted.status,'ok');
      assert.deepEqual(Buffer.from(accepted.core,'utf8'),output);
      assert.equal(sha256(coreInput),sha256(text));
      stdout=pairs[1-index].output;
      assert.deepEqual(await compileOwnedCore(checked,options),mismatch);
      assert.equal(sha256(coreInput),sha256(text));
      const command=optimize?'--optimize':'--canonicalize';
      assert.deepEqual(calls.slice(first),[[command],[command]]);
    }
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
