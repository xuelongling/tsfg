// SPDX-License-Identifier: MIT
// Complete producer output and original literal provenance; static compiler only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=process.env.TSFG_PUB3_IMPLEMENTATION_ROOT??fileURLToPath(new URL('../..',import.meta.url));
const factsApi=await import(pathToFileURL(root+'/compiler/common-program-facts.mjs').href),
  hirApi=await import(pathToFileURL(root+'/compiler/common-program-hir.mjs').href),
  api=await import(pathToFileURL(root+'/compiler/common-program-analysis.mjs').href),
  coreApi=await import(pathToFileURL(root+'/compiler/common-program-core.mjs').href),
  bodyApi=await import(pathToFileURL(root+'/compiler/common-program-body.mjs').href),
  sourceApi=await import(pathToFileURL(root+'/compiler/common-program-source.mjs').href),
  identities=await import(pathToFileURL(root+'/compiler/common-program-identities.mjs').href),
  common=await import(pathToFileURL(root+'/compiler/common-program-common.mjs').href);

test('a genuine Source3 const Global permits its owned field write through fixed publication and cold Core text',()=>{
  const sourceRoot=new URL('./testdata/const-global-payload/',import.meta.url),bytes=readFileSync(new URL('package.json',sourceRoot)),
    oracle=JSON.parse(readFileSync(new URL('original-literal-oracle.json',sourceRoot),'utf8'));
  assert.equal(common.sha256(bytes),'sha256:e3849f349c06599e5b4be2865be62e3ab88e6f48f4c41a1eaf3ea9f8845d2ad1');
  const facts=factsApi.readCommonProgramFacts(bytes),source=facts.payload.files.find(row=>row.path===oracle.sourcePath),
    originalGlobal=facts.payload.globals.find(row=>row.binding.id===oracle.global.id),originalCell=facts.payload.types.find(row=>row.id===oracle.cell.id),
    originalFunction=facts.payload.functions.find(row=>row.id===oracle.function.id),write=originalFunction.body[0].value,read=originalFunction.body[1].value;
  assert.equal(facts.version,common.commonSourceFormatV3.version);assert.equal(facts.schemaHash,common.commonSourceFormatV3.schemaHash);
  assert.equal(common.sha256(source.content),'sha256:'+oracle.sourceSha256);
  assert.equal(originalGlobal.bindingKind,'const');assert.equal(originalGlobal.binding.writable,false);assert.equal(originalGlobal.binding.declaredType,oracle.global.type);
  assert.deepEqual(originalGlobal.binding.declarationRange,oracle.global.declarationRange);assert.deepEqual(originalGlobal.binding.nameRange,oracle.global.nameRange);
  assert.deepEqual(originalGlobal.binding.annotationRange,oracle.global.annotationRange);assert.equal(originalCell.constructor,null);
  assert.equal(originalCell.construction.kind,'implicit-base');assert.deepEqual(originalCell.declarationRange,oracle.cell.declarationRange);
  assert.equal(originalCell.fields[0].id,oracle.cell.field.id);assert.deepEqual(originalCell.fields[0].origin,{source:oracle.sourcePath,...oracle.cell.field.declarationRange});
  assert.equal(originalCell.fields[0].readonly,false);assert.equal(write.kind,'fieldAssignment');assert.equal(write.target.property,oracle.fieldWrite.property);
  assert.equal(write.target.receiver.binding,oracle.global.id);assert.equal(write.value.binding,oracle.function.parameter.id);
  assert.deepEqual(write.range,oracle.fieldWrite.range);assert.deepEqual(write.target.range,oracle.fieldWrite.targetRange);assert.deepEqual(write.target.nameRange,oracle.fieldWrite.nameRange);
  assert.equal(read.kind,'fieldAccess');assert.equal(read.property,oracle.fieldRead.property);assert.equal(read.receiver.binding,oracle.global.id);
  assert.deepEqual(read.range,oracle.fieldRead.range);assert.deepEqual(read.nameRange,oracle.fieldRead.nameRange);
  const hir=hirApi.buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:3,factsBytes:bytes,expectedPackageId:facts.packageId}),
    global=hir.globals.find(row=>row.sourceBinding===oracle.global.id),cell=hir.types.find(row=>row.name==='Cell'),field=cell.fields[0],
    fn=hir.functions.find(row=>row.sourceBinding===oracle.function.id),publication=api.createCommonProgramPublication(hir),row=publication.contracts.find(row=>row.functionId===fn.id),request={targets:[]};
  assert.equal(global.writable,false);assert.equal(global.bindingKind,'const');assert.equal(global.type,cell.id);
  assert.equal(global.id,common.sha256('tsfg.global\0'+oracle.sourcePath+'\0shared\0'+cell.id));
  assert.deepEqual(global.range,oracle.global.declarationRange);assert.equal(field.sourceBinding,oracle.cell.field.id);
  assert.equal(field.id,identities.commonFieldId(cell.id,'value',0));assert.deepEqual(field.origin,originalCell.fields[0].origin);
  assert.equal(fn.body[0].value.target.receiver.global,global.id);assert.equal(fn.body[0].value.target.property,field.id);
  assert.deepEqual(fn.body[0].value.target.range,oracle.fieldWrite.targetRange);assert.equal(fn.body[1].value.receiver.global,global.id);
  assert.deepEqual(row.upper.globals.writes,[global.id]);assert.deepEqual(row.upper.globals.reads,[global.id]);
  const cold=JSON.parse(common.canonical({hir,publication,request})),output=process.env.TSFG_PUB3_INTEROP_OUTPUT;
  if(output){mkdirSync(output,{recursive:true});writeFileSync(output+'/owned-input.json',common.canonical(cold)+'\n',{flag:'wx'});}
  const rebuilt=hirApi.readCommonProgramHir(Buffer.from(common.canonical(cold.hir)+'\n')),admitted=api.readCommonProgramPublication(Buffer.from(api.printCommonProgramPublication(cold.publication,rebuilt)),rebuilt);
  assert.equal(admitted.expectedDigest,publication.expectedDigest);assert.equal(admitted.scopeDigest,publication.scopeDigest);assert.ok(Object.isFrozen(admitted));
  assert.equal(admitted.scope.globals.find(row=>row.globalId===global.id).writable,false);
  const analysis=api.analyzeCommonProgram(rebuilt,admitted),effective=analysis.functions.find(row=>row.functionId===fn.id);
  assert.deepEqual(effective.effective.globals.writes,[global.id]);assert.equal(effective.returnOriginStatus.status,'covered');
  const product=coreApi.commonProgramCore(rebuilt,admitted,cold.request);
  assert.equal(product.hir.inputIdentity,facts.packageId);assert.equal(product.proof.publishedDigest,publication.expectedDigest);assert.deepEqual(product.proof.targets,[]);
  assert.ok(product.text.includes('"tsfg_program.global_load"'));assert.ok(product.text.includes('"tsfg_program.field_store"'));assert.ok(product.text.includes('"tsfg_program.global_store"'));
  assert.ok(product.text.includes(global.id));assert.ok(product.text.includes(field.id));assert.ok(product.text.endsWith('\n'));
  // Mutated fixed metadata is not a new Source packet. Rebind its digests so
  // the ownership/order gates, rather than stale identity, reject each row.
  const missing='sha256:'+'0'.repeat(64);assert.ok(!hir.globals.some(row=>row.id===missing));
  for(const [writes,code]of [[[missing],'r03-common-program-publication-identity'],[[global.id,global.id],'r03-common-program-publication']]){
    const invalid=structuredClone(admitted);invalid.contracts.find(row=>row.functionId===fn.id).upper.globals.writes=writes;
    for(const row of invalid.contracts){const {digest,...body}=row;row.digest=identities.commonIdentity('published-contract',body);}
    invalid.expectedDigest=identities.commonIdentity('publication',{scopeDigest:invalid.scopeDigest,contracts:invalid.contracts});
    assert.throws(()=>api.verifyCommonProgramPublication(invalid,rebuilt),{name:'TypeError',code,ruleId:'r01-input-boundary',phase:'hir',message:code+': complete common Program differs'});
  }
  // Exercise the exported typed inner boundary with the complete original
  // context. This controlled target is not claimed to correspond to Source.
  const payload=facts.payload,spend=common.commonMeter(),sources=new Map(payload.files.map(row=>[row.path,row])),types=new Map(payload.types.map(row=>[row.id,row])),
    grammars=new Map([[source.path,sourceApi.commonSourceGrammar(source,spend)]]),visible=new Map([[source.path,new Map([
      ...payload.types.filter(row=>row.sourcePath===source.path).map(row=>[row.name,row.id]),
      ...payload.functions.filter(row=>row.sourcePath===source.path&&row.lexicalParent===null).map(row=>[row.name,row.id]),
      ...payload.globals.filter(row=>row.sourcePath===source.path).map(row=>[row.binding.name,row.binding.id])])]]);
  assert.equal(payload.modules.length,1);assert.equal(payload.modules[0].imports.length,0);
  bodyApi.validateCommonBodies(payload,sources,types,grammars,visible,spend);
  const controlled=structuredClone(payload),controlledFn=controlled.functions.find(row=>row.id===oracle.function.id);
  controlledFn.body[0].value={kind:'bindingAssignment',type:oracle.global.type,flowType:oracle.global.type,operator:'=',operatorRange:write.operatorRange,range:write.range,
    target:{kind:'bindingTarget',type:oracle.global.type,binding:oracle.global.id,range:write.target.receiver.range},value:structuredClone(write.target.receiver)};
  assert.throws(()=>bodyApi.validateCommonBodies(controlled,sources,types,grammars,visible,spend),{name:'TypeError',code:'r03-common-program-permission',
    ruleId:'r01-input-boundary',phase:'hir',message:'r03-common-program-permission: complete common Program differs'});
  if(output){writeFileSync(output+'/const-global.mlir',product.text,{flag:'wx'});writeFileSync(output+'/positive.json',common.canonical({inputIdentity:facts.packageId,global:global.id,writable:global.writable,field:field.id,
    functionId:fn.id,schemaHash:facts.schemaHash,scopeDigest:admitted.scopeDigest,publishedDigest:admitted.expectedDigest,writes:effective.effective.globals.writes,coreSHA256:common.sha256(product.text),qualification:'agent-run static Source3/HIR/publication/JSON cold Core text; no execution'})+'\n',{flag:'wx'});}
});
