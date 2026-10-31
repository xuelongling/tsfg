// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=process.env.TSFG_PUB3_IMPLEMENTATION_ROOT??fileURLToPath(new URL('../..',import.meta.url));
const factsApi=await import(pathToFileURL(root+'/compiler/common-program-facts.mjs').href),
  hirApi=await import(pathToFileURL(root+'/compiler/common-program-hir.mjs').href),
  api=await import(pathToFileURL(root+'/compiler/common-program-analysis.mjs').href),
  coreApi=await import(pathToFileURL(root+'/compiler/common-program-core.mjs').href),
  graphApi=await import(pathToFileURL(root+'/compiler/common-program-return-origin-domain.mjs').href),
  scopeApi=await import(pathToFileURL(root+'/compiler/common-program-return-origin-scope.mjs').href),
  common=await import(pathToFileURL(root+'/compiler/common-program-common.mjs').href);

test('an original acyclic conditional super retains both bound normal and unbound language paths in the cold fixed graph',()=>{
  const bytes=readFileSync(new URL('./testdata/constructor-return-origin/conditional-super-bool.json',import.meta.url)),
    oracle=JSON.parse(readFileSync(new URL('./testdata/constructor-return-origin/conditional-super-bool-oracle.json',import.meta.url),'utf8'));
  assert.equal(common.sha256(bytes),'sha256:5bdfe8390e2046b61a03f53dfc9ef39c3b8a4217760d6a88fd3d5058b482bc9c');
  const facts=factsApi.readCommonProgramFacts(bytes),original=facts.payload.types.find(row=>row.id===oracle.constructor.ownerType).constructor;
  assert.equal(common.sha256(facts.payload.files.find(row=>row.path===oracle.sourcePath).content),'sha256:'+oracle.sourceSha256);
  assert.equal(original.id,oracle.constructor.id);assert.deepEqual(original.declarationRange,oracle.constructor.declarationRange);
  assert.equal(original.body.length,1);assert.equal(original.body[0].kind,'if');assert.deepEqual(original.body[0].else,[]);
  const hir=hirApi.buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:3,factsBytes:bytes,expectedPackageId:facts.packageId}),
    publication=JSON.parse(common.canonical(api.createCommonProgramPublication(hir))),spend=common.commonMeter(2000000),
    directory=scopeApi.commonReturnOriginScopeDirectories(publication.scope,spend),functions=new Map(publication.scope.functions.map(row=>[row.functionId,row])),
    contracts=new Map(publication.contracts.map(row=>{assert.ok(row.returnOrigins);const typed=directory.read(row.functionId,row.returnOrigins);assert.equal(typed.status,'typed');return [row.functionId,{graph:typed.graph,upper:row.upper,protocol:functions.get(row.functionId)}];}));
  const solve=(fn,graph)=>graphApi.solveReturnOriginContexts(graph,contracts,{projectField:()=>null,mayAlias:()=>true,
      actualType:id=>({kind:publication.scope.types.find(row=>row.id===id).shape.kind,fields:[]}),
      environments:new Map(publication.scope.environments.map(row=>[row.id,row])),constructions:new Map(publication.scope.constructions.map(row=>[row.id,row])),rootProtocol:functions.get(fn.id)},spend);
  for(const fn of hir.functions.filter(fn=>fn.sourceBinding===original.id||fn.name==='create')){
    const solved=solve(fn,contracts.get(fn.id).graph);
    assert.equal(solved.normal,true,fn.name+' has the super branch');assert.equal(solved.language,true,fn.name+' retains the no-super ReferenceError');
    assert.equal(publication.contracts.find(row=>row.functionId===fn.id).upper.facets.mayThrow,true,fn.name+' publishes its actual language completion');
  }
  // Reorder evaluation of equivalent control identities. A late live empty
  // path must still contribute unbound after the bound arm reaches the join.
  const owner=hir.functions.find(fn=>fn.sourceBinding===original.id),reordered=structuredClone(contracts.get(owner.id).graph),
    join=reordered.controls.find(row=>row.kind==='join'&&row.inputs.length>1&&row.inputs.includes(0)),start=reordered.controls.length;
  assert.ok(join);for(let index=0;index<16;index++)reordered.controls.push({kind:'join',inputs:[index===15?0:start+index+1]});
  join.inputs=join.inputs.map(input=>input===0?start:input).sort((a,b)=>a-b);
  const typed=directory.read(owner.id,reordered);assert.equal(typed.status,'typed');
  const reorderedResult=solve(owner,typed.graph);assert.equal(reorderedResult.normal,true);
  assert.equal(reorderedResult.language,true,'equivalent control ordering cannot discard the live unbound arm');
  const product=coreApi.commonProgramCore(JSON.parse(common.canonical(hir)),publication,{targets:[]});
  assert.match(product.text,/tsfg_program.receiver_result/);assert.match(product.text,/tsfg_program.receiver_child/);
});
