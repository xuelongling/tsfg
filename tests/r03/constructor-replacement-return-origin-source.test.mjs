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

test('an original object constructor replacement keeps its incoming owner through the admitted compatibility witness and cold Core',()=>{
  const bytes=readFileSync(new URL('./testdata/constructor-return-origin/replacement-object.json',import.meta.url)),
    oracle=JSON.parse(readFileSync(new URL('./testdata/constructor-return-origin/replacement-object-oracle.json',import.meta.url),'utf8'));
  assert.equal(common.sha256(bytes),'sha256:817ff531ac3ca3eafd43225a43a19260e901e1275ad5a1d37aa4859ae130bd6a');
  const facts=factsApi.readCommonProgramFacts(bytes),carrier=facts.payload.types.find(row=>row.id===oracle.constructorReturn.ownerType),
    original=facts.payload.functions.find(row=>row.id===oracle.pass.id),replacement=carrier.constructor.body[0].value,outer=original.body[0].value.receiver;
  assert.equal(common.sha256(facts.payload.files.find(row=>row.path===oracle.sourcePath).content),'sha256:'+oracle.sourceSha256);
  assert.equal(replacement.type,oracle.constructorReturn.expression.type);assert.deepEqual(replacement.range,oracle.constructorReturn.expression.range);
  assert.equal(outer.type,oracle.outerNew.type);assert.deepEqual(outer.range,oracle.outerNew.range);assert.notEqual(replacement.type,outer.type);
  const hir=hirApi.buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:3,factsBytes:bytes,expectedPackageId:facts.packageId}),
    publication=JSON.parse(common.canonical(api.createCommonProgramPublication(hir))),pass=hir.functions.find(row=>row.sourceBinding===original.id),
    spend=common.commonMeter(2000000),directory=scopeApi.commonReturnOriginScopeDirectories(publication.scope,spend),functions=new Map(publication.scope.functions.map(row=>[row.functionId,row])),
    contracts=new Map(publication.contracts.map(row=>{assert.ok(row.returnOrigins);const typed=directory.read(row.functionId,row.returnOrigins);assert.equal(typed.status,'typed');return [row.functionId,{graph:typed.graph,upper:row.upper,protocol:functions.get(row.functionId)}];}));
  const solved=graphApi.solveReturnOriginContexts(contracts.get(pass.id).graph,contracts,{projectField:()=>null,mayAlias:()=>true,
    actualType:id=>({kind:publication.scope.types.find(row=>row.id===id).shape.kind,fields:[]}),environments:new Map(publication.scope.environments.map(row=>[row.id,row])),
    constructions:new Map(publication.scope.constructions.map(row=>[row.id,row])),rootProtocol:functions.get(pass.id)},spend);
  assert.equal(solved.normal,true);assert.equal(solved.language,false);assert.deepEqual([...solved.owners(new Set(contracts.get(pass.id).graph.normal))].sort(),['p:0']);
  const product=coreApi.commonProgramCore(JSON.parse(common.canonical(hir)),publication,{targets:[]});
  assert.match(product.text,/tsfg_program.receiver_create/);assert.match(product.text,/tsfg_program.receiver_result/);
});
