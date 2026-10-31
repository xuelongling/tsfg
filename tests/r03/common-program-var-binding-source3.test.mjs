// SPDX-License-Identifier: MIT
// Complete original var facts preserve one function activation and shared writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir,readCommonProgramHir,printCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {commonProgramPlan} from '../../compiler/common-program-plan.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {canonical} from '../../compiler/identity.mjs';

test('complete official var preserves entry undefined and shared binding',()=>{
  const bytes=readFileSync(new URL('./testdata/common-var-binding-v3/hoisted-shared.json',import.meta.url)),
    oracleBytes=readFileSync(new URL('./testdata/common-var-binding-v3/hoisted-shared-oracle.json',import.meta.url));
  assert.equal(bytes.length,12746);assert.equal(oracleBytes.length,919);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'621b53e8c4df3a7762603bb00ba6d2bf7f78a11032bca48e9fa490c93b909824');
  assert.equal(createHash('sha256').update(oracleBytes).digest('hex'),'0e3c22e40da68bcf5c2bc27d197361abb1830aa5a40cbbd7fc8621e308018f88');
  const original=JSON.parse(bytes.toString('utf8')),oracle=JSON.parse(oracleBytes.toString('utf8')),
    source=original.payload.files.find(file=>file.path==='/src/main.ts'),
    sourceOwner=original.payload.functions.find(fn=>fn.name==='varBinding'),
    sourceCell=sourceOwner.bindings.find(binding=>binding.name==='x'),declaration=sourceOwner.body[1].body[0];
  assert.equal(original.schemaHash,'sha256:27ec37bdb71bbfc957906bcf3bbd5fc5594ab2c7394a97efdee9879addc46ae3');
  assert.equal(Buffer.byteLength(source.content),354);assert.equal(source.sha256,oracle.SourceSHA);
  assert.equal(createHash('sha256').update(source.content).digest('hex'),oracle.SourceSHA);
  assert.equal(sourceOwner.id,oracle.FunctionIDs.varBinding);assert.equal(original.payload.functions.length,3);
  assert.equal(sourceCell.id,oracle.BindingID);assert.equal(sourceCell.lexicalOwner,sourceOwner.id);
  assert.equal(sourceCell.declaredType,'union<i32,undefined>');assert.equal(sourceCell.writable,true);
  assert.deepEqual(sourceCell.declarationRange,oracle.Declaration);assert.deepEqual(sourceCell.nameRange,oracle.Name);
  assert.equal(sourceOwner.body[0].initializer.kind,'bindingReference');
  assert.equal(sourceOwner.body[0].initializer.binding,sourceCell.id);assert.deepEqual(sourceOwner.body[0].initializer.range,oracle.Before);
  assert.equal(declaration.kind,'varDeclaration');assert.equal(declaration.binding,sourceCell.id);
  assert.deepEqual(declaration.nameRange,oracle.Name);assert.deepEqual(declaration.annotationRange,sourceCell.annotationRange);
  assert.deepEqual(declaration.range,oracle.Declaration);assert.deepEqual(declaration.initializer.range,oracle.Initializer);
  for(const [name,read,write,range]of [['read',true,false,oracle.Read],['write',false,true,oracle.Write]]){
    const closure=original.payload.functions.find(fn=>fn.name===name);assert.equal(closure.id,oracle.FunctionIDs[name]);
    assert.deepEqual(closure.captures,[{binding:sourceCell.id,read,write,occurrences:[{range,read,write}]}]);
  }
  // The retained independent official AST/Symbol/type oracle precedes this Product
  // boundary; accepting it must not synthesize a Source undefinedLiteral.
  const facts=readCommonProgramFacts(bytes),hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:3,factsBytes:bytes,expectedPackageId:facts.packageId}),
    owner=hir.functions.find(fn=>fn.sourceBinding===sourceOwner.id),cell=owner.bindings.find(b=>b.id===sourceCell.id),
    layouts=hir.environments.filter(env=>env.slots.some(slot=>slot.binding===sourceCell.id));
  assert.equal(layouts.length,1);const layout=layouts[0];
  assert.equal(layout.owner,owner.id);assert.equal(layout.scope,undefined);assert.equal(owner.activationEnvironment,layout.id);
  assert.equal(layout.slots.filter(slot=>slot.binding===cell.id).length,1);assert.equal(layout.slots.find(slot=>slot.binding===cell.id).type,cell.type);
  assert.equal(owner.body[0].initializer.kind,'bindingReference');assert.equal(owner.body[0].initializer.binding,cell.id);
  assert.equal(owner.body[1].body[0].kind,'varDeclaration');assert.deepEqual(owner.body[1].body[0].nameRange,oracle.Name);
  assert.deepEqual(owner.body[1].body[0].annotationRange,declaration.annotationRange);
  const closures=hir.functions.filter(fn=>fn.captures.some(c=>c.binding===cell.id));assert.equal(closures.length,2);
  for(const closure of closures)assert.equal(closure.lexicalEnvironment,layout.id);
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
  const planned=commonProgramPlan(hir),plan=planned.plans.find(p=>p.owner.id===owner.id),
    all=plan.graph.blocks.flatMap(block=>block.instructions),entry=plan.entry.instructions,
    allocation=entry.find(op=>op.name==='tsfg_program.env_alloc'&&op.properties.layout===layout.id),
    initialization=entry.filter(op=>op.name==='tsfg_program.env_init'&&op.properties.binding===cell.id),
    before=all.find(op=>op.name==='tsfg_program.env_load'&&op.properties.binding===cell.id&&op.range.start===oracle.Before.start),
    assignment=all.filter(op=>op.name==='tsfg_program.env_store'&&op.properties.binding===cell.id&&op.range.start===oracle.Declaration.start);
  assert.ok(allocation);assert.equal(initialization.length,1);assert.deepEqual(initialization[0].range,oracle.Declaration);
  assert.equal(initialization[0].operands[0],allocation.result);
  let initialValue=all.find(op=>op.result===initialization[0].operands[1]);
  while(initialValue?.name==='tsfg_program.value_copy')initialValue=all.find(op=>op.result===initialValue.operands[0]);
  assert.equal(initialValue?.name,'tsfg_program.undefined','function entry initializes the actual value, not the original AST');
  assert.ok(before);assert.equal(before.operands[0],allocation.result);
  assert.ok(entry.indexOf(initialization[0])<entry.indexOf(before));
  assert.equal(assignment.length,1);assert.equal(assignment[0].operands[0],allocation.result);
  assert.deepEqual(assignment[0].range,oracle.Declaration);
  assert.ok(all.indexOf(before)<all.indexOf(assignment[0]));
  assert.equal(all.filter(op=>op.name==='tsfg_program.env_init'&&op.properties.binding===cell.id).length,1);
  const publication=createCommonProgramPublication(hir),request={targets:[]},program=commonProgramCore(hir,publication,request,{borrowProof:true});
  assert.ok(program.borrowProof);assert.ok(program.text.includes('"tsfg_program.env_init"'));
  if(process.env.TSFG_VAR_BINDING_CORE_ROOT){
    mkdirSync(process.env.TSFG_VAR_BINDING_CORE_ROOT,{recursive:true});
    for(const [suffix,text]of [['.mlir',program.text],['.proof.json',canonical(program.borrowProof)+'\n'],['.owned.json',canonical({hir,publication,request})+'\n']]){
      const path=process.env.TSFG_VAR_BINDING_CORE_ROOT+'/hoisted-shared'+suffix;
      if(existsSync(path))assert.equal(readFileSync(path,'utf8'),text);else writeFileSync(path,text,{flag:'wx'});
    }
  }
});
