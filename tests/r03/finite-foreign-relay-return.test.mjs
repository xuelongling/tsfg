// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';

// Source365df0c3 produced this complete private-v8 packet. The extra relay
// observes normal return after both nested constructions in foreign callees;
// neither static types nor a hand-edited IR supplies a storage witness.
test('official foreign construction relay keeps ordinary owner and field proofs',async t=>{
  const bytes=await readFile(new URL('./testdata/typed-array-holder-parameter/9e6f36f5ec7bb0af0acb17122ced03eacd144a409057ee935e4c243f3e6653da-package.json',import.meta.url));
  assert.equal(bytes.length,18711);
  assert.equal(sha256(bytes),'sha256:1beb28410a67d42577c460ec636ecc399203dfb58c838c6fb72cb333e4958006');
  const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(f=>f.path===facts.payload.rootFile);
  assert.ok(source);assert.equal(sha256(source.content),'sha256:9e6f36f5ec7bb0af0acb17122ced03eacd144a409057ee935e4c243f3e6653da');
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const none={read:false,write:false,structural:false},read={...none,read:true},rule={parameters:{0:read},local:none};
  const publication=staticPublication(facts,{inner:rule,wrap:rule,relay:rule});
  const built=buildHir(facts,context,publication),storage=process.env.TSFG_TEST_STORAGE?path.join(process.env.TSFG_TEST_STORAGE,'producer'):null;
  if(storage){await mkdir(storage,{recursive:true});await writeFile(path.join(storage,'result.json'),JSON.stringify({status:built.status,diagnostics:built.diagnostics})+'\n',{flag:'wx'});}
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  assert.deepEqual(verifyHir(built.hir,context,publication),built.hir);
  const text=printHir(built.hir,context,publication);
  assert.deepEqual(readHir(Buffer.from(text),context,publication),built.hir);
  const relay=built.hir.functions.find(f=>f.name==='relay'),wrap=built.hir.functions.find(f=>f.name==='wrap');
  assert.ok(relay&&wrap);assert.equal(relay.body.length,1);assert.equal(relay.body[0].kind,'return');
  assert.equal(relay.body[0].value.kind,'call');assert.equal(relay.body[0].value.target,wrap.id);
  const run=built.hir.functions.find(f=>f.name==='run');assert.ok(run);
  const plan=built.hir.readSpanPlan.functions.find(f=>f.functionId===run.id);assert.ok(plan);
  const use=plan.events.find(e=>e.kind==='view-read-complete');assert.ok(use);
  const view=plan.views.find(v=>v.viewId===use.viewId);assert.ok(view);
  const allocation=run.body.find(s=>s.kind==='local'&&s.binding.name==='a');assert.ok(allocation);
  assert.equal(view.owner.kind,'allocation');assert.equal(view.owner.functionId,run.id);
  assert.equal(view.owner.allocationSite,allocation.initializer.allocationSite);
  const core=lowerFormalHir(built.hir,context,publication);
  assert.ok(core.includes('tsfg_core.function_id = "'+relay.id+'"'));
  assert.ok(core.includes('"tsfg_core.domain.field_read"'));
  if(storage)for(const [name,raw]of [['hir.json',text],['core.mlir',core],['publication.json',JSON.stringify(publication)+'\n']])await writeFile(path.join(storage,name),raw,{flag:'wx'});
  if(process.env.TSFG_CORE_IR_EXE)await t.test('formal Core canonical fixed point',async()=>{
    const first=await invokeCore(core);accepted(first);
    const second=await invokeCore(first.stdout);accepted(second);
    assert.deepEqual(second.stdout,first.stdout);
  });
});
