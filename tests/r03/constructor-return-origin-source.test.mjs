// SPDX-License-Identifier: MIT
// Genuine complete Source3 and a producer-independent literal provenance oracle.
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
  common=await import(pathToFileURL(root+'/compiler/common-program-common.mjs').href),
  identities=await import(pathToFileURL(root+'/compiler/common-program-identities.mjs').href);

test('a genuine constructor receiver carries its stored parameter through the fixed archive and cold Core',()=>{
  const bytes=readFileSync(new URL('./testdata/constructor-return-origin/receiver-alias.json',import.meta.url)),
    oracle=JSON.parse(readFileSync(new URL('./testdata/constructor-return-origin/receiver-alias-oracle.json',import.meta.url),'utf8'));
  assert.equal(common.sha256(bytes),'sha256:09d7958315b3056b4b1e9018c305e80ac2f7b9a108d141993029e97b4509a13b');
  const facts=factsApi.readCommonProgramFacts(bytes),source=facts.payload.files.find(row=>row.path===oracle.sourcePath),
    original=facts.payload.functions.find(fn=>fn.name==='pass'),box=facts.payload.types.find(type=>type.id===oracle.constructor.ownerType),ctor=box.constructor;
  assert.equal(common.sha256(source.content),'sha256:'+oracle.sourceSha256);
  assert.equal(original.id,oracle.pass.id);assert.deepEqual(original.declarationRange,oracle.pass.declarationRange);
  assert.equal(original.parameters[0].id,oracle.pass.parameter.id);assert.equal(ctor.id,oracle.constructor.id);
  assert.deepEqual(ctor.declarationRange,oracle.constructor.declarationRange);
  assert.equal(ctor.parameters[0].id,oracle.constructor.parameter.id);
  assert.equal(box.fields[0].parameterBinding,ctor.parameters[0].id);assert.equal(box.fields[0].id,oracle.fieldAccess.fieldId);
  assert.deepEqual(original.body[0].value.range,oracle.fieldAccess.range);
  assert.deepEqual(original.body[0].value.receiver.range,oracle.construction.range);
  const hir=hirApi.buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:3,factsBytes:bytes,expectedPackageId:facts.packageId}),
    owner=hir.functions.find(fn=>fn.sourceBinding===ctor.id),pass=hir.functions.find(fn=>fn.sourceBinding===original.id),publication=api.createCommonProgramPublication(hir),
    constructorRow=publication.contracts.find(row=>row.functionId===owner.id),passRow=publication.contracts.find(row=>row.functionId===pass.id);
  assert.ok(constructorRow.returnOrigins,'the real constructor needs a selected receiver graph');
  assert.ok(passRow.returnOrigins,'the caller needs the real constructed receiver and its stored content');
  assert.equal(passRow.returnOrigins.format.version,5);assert.equal(publication.scope.profile,'common-program-fixed-v6');
  assert.ok(Object.isFrozen(publication));
  for(const row of publication.contracts){const {digest,...body}=row;assert.equal(digest,identities.commonIdentity('published-contract',body));}
  assert.equal(publication.scopeDigest,identities.commonIdentity('publication-scope',publication.scope));
  assert.equal(publication.expectedDigest,identities.commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts}));
  assert.equal(api.printCommonProgramPublication(publication,hir),common.canonical(publication)+'\n');
  const spend=common.commonMeter(2000000),directory=scopeApi.commonReturnOriginScopeDirectories(publication.scope,spend),
    functions=new Map(publication.scope.functions.map(fn=>[fn.functionId,fn])),types=new Map(publication.scope.types.map(type=>[type.id,type.shape])),
    protocol=fn=>({lexicalEnvironment:fn.lexicalEnvironment,activationEnvironment:fn.activationEnvironment,construction:fn.construction}),
    contracts=new Map(publication.contracts.map(row=>{const typed=directory.read(row.functionId,row.returnOrigins);assert.equal(typed.status,'typed');return [row.functionId,{graph:typed.graph,upper:row.upper,protocol:protocol(functions.get(row.functionId))}];}));
  const graph=contracts.get(pass.id).graph,solved=graphApi.solveReturnOriginContexts(graph,contracts,{
    projectField:()=>null,mayAlias:()=>true,actualType:id=>({kind:types.get(id).kind,fields:[]}),
    environments:new Map(publication.scope.environments.map(env=>[env.id,env])),
    constructions:new Map(publication.scope.constructions.map(row=>[row.id,row])),rootProtocol:protocol(functions.get(pass.id))
  },spend);
  assert.equal(solved.normal,true);assert.equal(solved.language,false);
  assert.deepEqual([...solved.owners(new Set(graph.normal))].sort(),['p:0']);
  const repeated=structuredClone(graph),creation=repeated.nodes.find(row=>row.kind==='receiverFrame'),cycle=repeated.controls.length;
  assert.ok(creation);repeated.controls.push({kind:'join',inputs:[cycle]});creation.control=cycle;
  assert.deepEqual(directory.read(pass.id,repeated),{status:'open',reason:'repeated-receiver-frame-activation'});
  assert.throws(()=>graphApi.solveReturnOriginContexts(repeated,contracts,{
    projectField:()=>null,mayAlias:()=>true,actualType:id=>({kind:types.get(id).kind,fields:[]}),
    environments:new Map(publication.scope.environments.map(env=>[env.id,env])),constructions:new Map(publication.scope.constructions.map(row=>[row.id,row])),rootProtocol:protocol(functions.get(pass.id))
  },spend),{code:'r03-common-program-return-origin-repeat-frame-open'});
  const existingFrame=structuredClone(contracts.get(owner.id).graph),unusedCycle=existingFrame.controls.length;
  assert.ok(existingFrame.nodes.every(row=>row.kind!=='receiverFrame'));existingFrame.controls.push({kind:'join',inputs:[unusedCycle]});
  assert.equal(directory.read(owner.id,existingFrame).status,'typed','an existing receiverInput does not claim a fresh activation');
  const recursive=structuredClone(graph),recursiveCall=recursive.calls.length,recursiveControl=recursive.controls.length,
    parameter=recursive.nodes.findIndex(row=>row.kind==='parameter'&&row.index===0);
  recursive.calls.push({functionId:pass.id,arguments:[[parameter]],environment:null,callee:null,receiver:null,heap:0,control:0,site:'recursive-before-create'});
  recursive.controls.push({kind:'call',call:recursiveCall,completion:'normal'});recursive.nodes.find(row=>row.kind==='receiverFrame').control=recursiveControl;
  const recursiveTyped=directory.read(pass.id,recursive);assert.equal(recursiveTyped.status,'typed');
  const recursiveContracts=new Map(contracts);recursiveContracts.set(pass.id,{...contracts.get(pass.id),graph:recursiveTyped.graph});
  assert.throws(()=>graphApi.solveReturnOriginContexts(recursiveTyped.graph,recursiveContracts,{
    projectField:()=>null,mayAlias:()=>true,actualType:id=>({kind:types.get(id).kind,fields:[]}),environments:new Map(publication.scope.environments.map(env=>[env.id,env])),
    constructions:new Map(publication.scope.constructions.map(row=>[row.id,row])),rootProtocol:protocol(functions.get(pass.id))
  },spend),{code:'r03-common-program-return-origin-recursive-frame-open'});
  const cold=JSON.parse(common.canonical({hir,publication,request:{targets:[]}})),rebuilt=hirApi.readCommonProgramHir(Buffer.from(common.canonical(cold.hir)+'\n')),
    product=coreApi.commonProgramCore(rebuilt,cold.publication,cold.request);
  assert.equal(product.hir.inputIdentity,facts.packageId);assert.match(product.text,/tsfg_program.receiver_bind/);
  const wider=structuredClone(publication);wider.contracts.find(row=>row.functionId===owner.id).upper.parameters[1].write=true;
  assert.throws(()=>api.verifyCommonProgramPublication(wider,hir),{code:'r03-common-program-publication-identity'});
  for(const row of wider.contracts){const {digest,...body}=row;row.digest=identities.commonIdentity('published-contract',body);}
  wider.expectedDigest=identities.commonIdentity('publication',{scopeDigest:wider.scopeDigest,contracts:wider.contracts});
  assert.throws(()=>api.analyzeCommonProgram(hir,wider),{code:'r03-common-program-contract'});
  const throwGrant=structuredClone(publication);
  for(const row of throwGrant.contracts){if(row.functionId===owner.id||row.functionId===pass.id)row.upper.facets.mayThrow=true;
    const {digest,...body}=row;row.digest=identities.commonIdentity('published-contract',body);}
  throwGrant.expectedDigest=identities.commonIdentity('publication',{scopeDigest:throwGrant.scopeDigest,contracts:throwGrant.contracts});
  const pending=api.analyzeCommonProgram(hir,throwGrant).functions.find(row=>row.functionId===pass.id).returnOriginStatus;
  assert.deepEqual(pending,{status:'open',reason:'fixed-potential-language-open'},'the actual nonthrowing graph cannot erase a complete fixed throw grant');
  const noNormal=structuredClone(publication),restricted=noNormal.contracts.find(row=>row.functionId===pass.id);
  restricted.returnOrigins.normal=[];restricted.returnOrigins.exits.normal=[];
  for(const row of noNormal.contracts){const {digest,...body}=row;row.digest=identities.commonIdentity('published-contract',body);}
  noNormal.expectedDigest=identities.commonIdentity('publication',{scopeDigest:noNormal.scopeDigest,contracts:noNormal.contracts});
  assert.throws(()=>api.analyzeCommonProgram(hir,noNormal),{code:'r03-common-program-return-origin-contract'},'an unmatched receiver completion cannot become a vacuous ordinary control certificate');
});
