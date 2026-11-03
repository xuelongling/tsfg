// SPDX-License-Identifier: MIT
// Reuse the delivered complete Source3 byte stream, never restamp a snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=process.env.TSFG_PUB3_IMPLEMENTATION_ROOT??fileURLToPath(new URL('../..',import.meta.url)),
  factsApi=await import(pathToFileURL(root+'/compiler/common-program-facts.mjs').href),
  hirApi=await import(pathToFileURL(root+'/compiler/common-program-hir.mjs').href),
  api=await import(pathToFileURL(root+'/compiler/common-program-analysis.mjs').href),
  coreApi=await import(pathToFileURL(root+'/compiler/common-program-core.mjs').href),
  common=await import(pathToFileURL(root+'/compiler/common-program-common.mjs').href),
  scopeApi=await import(pathToFileURL(root+'/compiler/common-program-return-origin-scope.mjs').href),
  physicalApi=await import(pathToFileURL(root+'/compiler/common-program-physical.mjs').href);

test('original Source3 constructor defaults publish both completion heaps through derived and cold Core',()=>{
  const bytes=readFileSync(new URL('./common-program-constructor-default-source-v3.json',import.meta.url));
  assert.equal(common.sha256(bytes),'sha256:6d7d996c0fd2c8f857557e10093b5afb178b6f5a906b8e541ea5aba6e3d5c53f');
  const facts=factsApi.readCommonProgramFacts(bytes),hir=hirApi.buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:3,factsBytes:bytes,expectedPackageId:facts.packageId}),
    publication=api.createCommonProgramPublication(hir),named=name=>hir.functions.find(fn=>fn.name===name),
    ctor=name=>hir.functions.find(fn=>fn.kind==='construction-body'&&fn.ownerType===hir.types.find(type=>type.name===name).id),
    row=fn=>publication.contracts.find(row=>row.functionId===fn.id),directory=scopeApi.commonReturnOriginScopeDirectories(publication.scope,common.commonMeter(2000000));
  for(const owner of [ctor('Numeric'),ctor('Derived'),ctor('Broken')]){
    const graph=row(owner).returnOrigins;assert.ok(graph,owner.name+' requires its actual ordered receiver CFG');assert.equal(graph.format.version,5);
    assert.equal(directory.read(owner.id,graph).status,'typed');assert.ok(graph.exits.normal.length+graph.exits.language.length>0);
  }
  for(const owner of [named('omitted'),named('derived'),named('throwsAfterEffects')])assert.equal(row(owner).returnOrigins,null,'a global payload store remains explicitly outside this graph transfer');
  assert.equal(row(ctor('Broken')).upper.facets.mayThrow,true);
  const physical=physicalApi.commonProgramPhysical(hir),broken=ctor('Broken'),called=[...physical.values.actual.contexts.values()].filter(context=>context.plan.owner.id===broken.id&&!context.root);
  assert.ok(called.length);assert.ok(called.every(context=>context.language&&!context.normal),'the existing actual solver retains the real default throw');
  const cold=JSON.parse(common.canonical({hir,publication,request:{targets:[]}})),product=coreApi.commonProgramCore(cold.hir,cold.publication,cold.request);
  assert.match(product.text,/tsfg_program.initialize_field/);assert.match(product.text,/tsfg_program.receiver_child/);
  assert.equal(product.text.match(/, schema = "([^"]+)"/)[1],'sha256:db46cd091d08f951a4a1564e8cf24702dca6137fe0585bbfe256c522e6ee3332');
});
