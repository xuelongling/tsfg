// SPDX-License-Identifier: MIT
// Genuine Source3, static compiler only; Global owners are reachable resources.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=process.env.TSFG_PUB3_IMPLEMENTATION_ROOT??fileURLToPath(new URL('../..',import.meta.url));
const factsApi=await import(pathToFileURL(root+'/compiler/common-program-facts.mjs').href),
  hirApi=await import(pathToFileURL(root+'/compiler/common-program-hir.mjs').href),
  api=await import(pathToFileURL(root+'/compiler/common-program-analysis.mjs').href),
  physicalApi=await import(pathToFileURL(root+'/compiler/common-program-physical.mjs').href),
  coreApi=await import(pathToFileURL(root+'/compiler/common-program-core.mjs').href),
  common=await import(pathToFileURL(root+'/compiler/common-program-common.mjs').href);

test('a genuine native-view const Global retains managed payload and its conditional write grant through cold Core',()=>{
  const sourceRoot=new URL('./testdata/const-hidden-managed-view/',import.meta.url),bytes=readFileSync(new URL('package.json',sourceRoot)),
    oracle=JSON.parse(readFileSync(new URL('original-literal-oracle.json',sourceRoot),'utf8'));
  assert.equal(common.sha256(bytes),'sha256:8d23588bb2b48bbc7e9708a3fc1385c0e8e41e023b5a914ac105f0af792c6dc5');
  const facts=factsApi.readCommonProgramFacts(bytes),source=facts.payload.files.find(row=>row.path===oracle.sourcePath),
    originalGlobal=facts.payload.globals.find(row=>row.binding.id===oracle.global.id),originalCell=facts.payload.types.find(row=>row.id===oracle.cell.id),
    originalFunction=facts.payload.functions.find(row=>row.id===oracle.function.id),local=originalFunction.body[0],write=originalFunction.body[1].value,read=originalFunction.body[2].value,
    initialization=facts.payload.modules.flatMap(row=>row.initialization).find(row=>row.binding===oracle.global.id).initializer;
  assert.equal(common.sha256(source.content),'sha256:'+oracle.sourceSha256);
  assert.equal(originalGlobal.bindingKind,'const');assert.equal(originalGlobal.binding.writable,false);assert.equal(originalGlobal.binding.declaredType,'i32');
  assert.deepEqual(originalGlobal.binding.declarationRange,oracle.global.declarationRange);assert.deepEqual(originalGlobal.binding.annotationRange,oracle.global.annotationRange);
  assert.equal(originalCell.constructor,null);assert.equal(originalCell.construction.kind,'implicit-base');
  assert.equal(originalCell.fields[0].id,oracle.cell.field.id);assert.deepEqual(originalCell.fields[0].origin,{source:oracle.sourcePath,...oracle.cell.field.declarationRange});
  for(const [outer,expected]of [[initialization,oracle.global.initializer],[local.initializer,oracle.local.initializer]]){
    assert.equal(outer.kind,'as');assert.equal(outer.type,expected.outerViewType);assert.deepEqual(outer.range,expected.outerRange);
    assert.equal(outer.expression.kind,'as');assert.equal(outer.expression.type,'unknown');assert.deepEqual(outer.expression.range,expected.innerRange);
  }
  assert.equal(initialization.expression.expression.kind,'new');assert.equal(initialization.expression.expression.type,oracle.cell.id);
  assert.deepEqual(initialization.expression.expression.range,oracle.global.initializer.newRange);
  assert.equal(local.binding,oracle.local.id);assert.equal(local.initializer.expression.expression.binding,oracle.global.id);
  assert.equal(local.initializer.expression.expression.type,'i32');assert.deepEqual(local.initializer.expression.expression.range,oracle.local.initializer.bindingRange);
  assert.equal(write.kind,'fieldAssignment');assert.equal(write.target.receiver.binding,oracle.local.id);assert.equal(write.target.property,oracle.cell.field.id);
  assert.deepEqual(write.range,oracle.fieldWrite.range);assert.deepEqual(write.target.range,oracle.fieldWrite.targetRange);assert.deepEqual(write.target.nameRange,oracle.fieldWrite.nameRange);
  assert.equal(write.value.binding,oracle.function.parameter.id);assert.deepEqual(read.range,oracle.fieldRead.range);assert.equal(read.receiver.binding,oracle.local.id);
  const hir=hirApi.buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:3,factsBytes:bytes,expectedPackageId:facts.packageId}),
    global=hir.globals.find(row=>row.sourceBinding===oracle.global.id),cell=hir.types.find(row=>row.sourceType===oracle.cell.id),
    fn=hir.functions.find(row=>row.sourceBinding===oracle.function.id),native=hir.types.find(row=>row.sourceType==='i32'),
    publication=api.createCommonProgramPublication(hir),row=publication.contracts.find(row=>row.functionId===fn.id);
  assert.equal(global.type,native.id);assert.notEqual(global.type,cell.id);assert.equal(global.writable,false);
  assert.deepEqual(row.upper.globals.writes,[global.id]);assert.deepEqual(row.upper.globals.reads,[global.id]);
  const cold=JSON.parse(common.canonical({hir,publication,request:{targets:[]}})),output=process.env.TSFG_PUB3_INTEROP_OUTPUT;
  if(output){mkdirSync(output,{recursive:true});writeFileSync(output+'/owned-input.json',common.canonical(cold)+'\n',{flag:'wx'});}
  const rebuilt=hirApi.readCommonProgramHir(Buffer.from(common.canonical(cold.hir)+'\n')),
    admitted=api.readCommonProgramPublication(Buffer.from(api.printCommonProgramPublication(cold.publication,rebuilt)),rebuilt);
  assert.equal(admitted.expectedDigest,publication.expectedDigest);assert.equal(admitted.scopeDigest,publication.scopeDigest);
  assert.equal(admitted.scope.globals.find(row=>row.globalId===global.id).writable,false);
  const physical=physicalApi.commonProgramPhysical(rebuilt,new Map(admitted.contracts.map(row=>[row.functionId,row]))),
    plan=physical.plans.find(plan=>plan.owner.id===fn.id),ops=plan.graph.blocks.flatMap(block=>block.instructions),
    load=ops.find(op=>op.name==='tsfg_program.global_load'&&op.properties.global===global.id),
    casts=ops.filter(op=>op.name==='tsfg_program.assert'),actual=physical.values.actual.observed.get(fn.id+'/'+load.result);
  assert.equal(load.view,native.id);assert.ok(actual.tags.has(cell.id));assert.ok(actual.refs.size>0);
  assert.ok([...actual.refs].some(ref=>physical.values.actual.objects.get(ref)?.type===cell.id));
  assert.equal(casts.length,2);
  for(const cast of casts){const selected=physical.values.actual.observed.get(fn.id+'/'+cast.result);
    assert.deepEqual([...selected.tags].sort(),[...actual.tags].sort());assert.deepEqual([...selected.refs].sort(),[...actual.refs].sort());}
  const analysis=api.analyzeCommonProgram(rebuilt,admitted),effective=analysis.functions.find(row=>row.functionId===fn.id),
    product=coreApi.commonProgramCore(rebuilt,admitted,cold.request);
  assert.deepEqual(effective.effective.globals.writes,[global.id]);assert.equal(product.hir.inputIdentity,facts.packageId);
  assert.equal(product.proof.publishedDigest,publication.expectedDigest);assert.deepEqual(product.proof.targets,[]);
  assert.ok(product.text.includes('"tsfg_program.global_load"'));assert.ok(product.text.includes('"tsfg_program.field_store"'));
  assert.ok(product.text.includes('"tsfg_program.assert"'));assert.ok(product.text.includes(global.id));assert.ok(product.text.endsWith('\n'));
  if(output){writeFileSync(output+'/hidden-global.mlir',product.text,{flag:'wx'});writeFileSync(output+'/positive.json',common.canonical({inputIdentity:facts.packageId,
    global:global.id,declaredType:global.type,writable:global.writable,managedType:cell.id,actualTypes:[...actual.tags].sort(),managedReferences:actual.refs.size,
    functionId:fn.id,scopeDigest:admitted.scopeDigest,publishedDigest:admitted.expectedDigest,writes:effective.effective.globals.writes,
    coreSHA256:common.sha256(product.text),qualification:'agent-run static Source3/HIR/actual solver/publication/JSON cold Core text; no execution; reachable Global owner only'})+'\n',{flag:'wx'});}
});
