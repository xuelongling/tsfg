// SPDX-License-Identifier: MIT
// Whole genuine Source3 input; the literal oracle was written before production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,printCommonProgramHir,readCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonMeter,sha256} from '../../compiler/common-program-common.mjs';

test('a captured parameter var initializer consumes its original cell and fixed callable upper',()=>{
  const bytes=readFileSync(new URL('./testdata/common-var-binding-v3/captured-parameter-var-initializer.json',import.meta.url)),
    oracle=JSON.parse(readFileSync(new URL('./testdata/common-var-binding-v3/captured-parameter-var-initializer-oracle.json',import.meta.url),'utf8'));
  assert.equal(sha256(bytes),'sha256:d3436f63bd0ab5a189d8da154203043fc0bfb2cbb2381d13fa350512585772f7');
  const facts=readCommonProgramFacts(bytes),source=facts.payload.files.find(row=>row.path==='/src/main.ts'),original=facts.payload.functions.find(fn=>fn.name==='varBinding'),
    parameter=original.parameters[0],declaration=original.body.find(row=>row.kind==='varDeclaration');
  assert.equal(sha256(source.content),'sha256:'+oracle.sourceSha256);
  for(const row of oracle.functions){const fn=facts.payload.functions.find(fn=>fn.name===row.name);assert.equal(fn.id,row.id);assert.deepEqual(fn.declarationRange,row.declarationRange);}
  assert.equal(parameter.id,oracle.selected.id);assert.equal(parameter.kind,'parameter');assert.equal(original.bindings.length,0);
  assert.equal(declaration.binding,parameter.id);assert.deepEqual(declaration.range,oracle.selected.varDeclaration);
  assert.deepEqual(declaration.initializer.range,oracle.selected.initializer);assert.equal(declaration.initializer.functionId,oracle.functions.find(fn=>fn.name==='second').id);
  const hir=projectCommonProgram(facts),named=name=>hir.functions.find(fn=>fn.name===name),owner=named('varBinding'),reader=named('read'),
    callable=commonTargets(hir,commonMeter()),expected=[named('first').id,named('second').id].sort(),range=reader.body[0].value.range;
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
  assert.deepEqual(callable.site(reader.id,range),{top:false,functions:expected});
  assert.deepEqual(callable.contracts.get(owner.id).parameters,[{index:0,allowed:{top:false,functions:expected}}]);
  const physical=commonProgramPhysical(hir),plan=physical.plans.find(plan=>plan.owner.id===owner.id),ops=plan.graph.blocks.flatMap(block=>block.instructions),
    initial=ops.filter(op=>op.name==='tsfg_program.env_init'&&op.properties.binding===parameter.id),stores=ops.filter(op=>op.name==='tsfg_program.env_store'&&op.properties.binding===parameter.id);
  assert.equal(initial.length,1);assert.equal(stores.length,1);assert.deepEqual(stores[0].range,oracle.selected.varDeclaration);
  let value=initial[0].operands[1],operation=plan.graph.registers.get(value).operation;
  while(operation?.name==='tsfg_program.value_copy'){value=operation.operands[0];operation=plan.graph.registers.get(value).operation;}
  assert.equal(value,plan.entry.parameters[plan.parameters.findIndex(parameter=>parameter.id===oracle.selected.id)].name);
  assert.equal(ops.some(op=>op.name==='tsfg_program.undefined'),false);
  const publication=createCommonProgramPublication(hir),program=commonProgramCore(hir,publication,{targets:[]});
  assert.match(program.text,/tsfg_program.invoke_indirect/);assert.match(program.text,/tsfg_program.env_store/);
  const records=new Map(publication.contracts.map(row=>[row.functionId,structuredClone(row)]));
  records.get(owner.id).callables.parameters[0].allowed={top:false,functions:[named('first').id]};
  assert.throws(()=>commonTargets(hir,commonMeter(),records),{code:'r03-common-program-callable-contract'});
});
