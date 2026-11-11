// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {sha256} from '../../compiler/identity.mjs';

const directory=new URL('./testdata/common-null-local-refinement/',import.meta.url);
const read=name=>readFileSync(new URL(name+'.json',directory));
function project(name){
  const facts=readCommonProgramFacts(read(name)),oracle=JSON.parse(read(name+'-oracle').toString('utf8'));
  const source=facts.payload.files.find(row=>row.path==='/src/main.ts');
  assert.ok(source);
  assert.equal(sha256(source.content),'sha256:'+oracle.sourceSha256);
  const hir=projectCommonProgram(facts),publication=createCommonProgramPublication(hir);
  const physical=commonProgramPhysical(hir,new Map(publication.contracts.map(row=>[row.functionId,row])));
  const core=commonProgramCore(hir,publication,{targets:[]});
  const box=hir.types.find(row=>row.kind==='reference'&&row.name==='Box');
  const absent=hir.types.find(row=>row.kind==='null');
  assert.ok(box&&absent);
  return {hir,physical,core,source:source.content,oracle,box:box.id,absent:absent.id};
}

test('official strict null guard preserves the parameter tag and returns only Box',()=>{
  const {hir,physical,core,source,oracle,box,absent}=project('positive');
  const owner=hir.functions.find(row=>row.name==='guarded');
  assert.ok(owner);
  assert.deepEqual(owner.range,oracle.guarded);
  const abi=core.representation.functions.find(row=>row.id===owner.id);
  assert.ok(abi);
  assert.deepEqual(abi,physical.carriers.functions.get(owner.id));
  const parameter=core.representation.domains.find(row=>row.id===abi.parameters[0]);
  assert.ok(parameter);
  assert.deepEqual(parameter.actualTypes,[box,absent].sort());
  assert.equal(parameter.representation,'finite-union');
  assert.equal(parameter.tagBytes,2);
  assert.equal(abi.result,box);

  const plan=physical.plans.find(row=>row.owner.id===owner.id);
  assert.ok(plan);
  const operations=plan.graph.blocks.flatMap(block=>block.instructions);
  const compare=operations.find(row=>row.name==='tsfg_program.strict_equal');
  const branch=operations.find(row=>row.name==='cf.cond_br');
  const narrowed=operations.find(row=>row.name==='tsfg_program.view'&&row.view===box);
  assert.ok(compare?.result&&branch&&narrowed?.result);
  assert.equal(compare.properties.operator,'===');
  assert.deepEqual(compare.range,oracle.condition);
  assert.deepEqual(branch.range,oracle.condition);
  assert.deepEqual(branch.operands,[compare.result]);
  assert.deepEqual(narrowed.range,oracle.narrowedReturn);
  assert.equal(source.slice(oracle.condition.start,oracle.condition.end),'value === null');
  assert.equal(source.slice(oracle.narrowedReturn.start,oracle.narrowedReturn.end),'value');
  const result=physical.values.actual.observed.get(owner.id+'/'+narrowed.result);
  assert.ok(result);
  assert.equal(result.unknown,false);
  assert.deepEqual([...result.tags],[box]);
});

test('official inverted null guard narrows its own load and preserves alternate stores',()=>{
  const {hir,physical,core,source,oracle,box,absent}=project('controls');
  for(const name of ['reverse','alias','overwrite']){
    const expected=oracle[name],owner=hir.functions.find(row=>row.name===name);
    assert.ok(owner);
    assert.deepEqual(owner.range,expected.function);
    const abi=core.representation.functions.find(row=>row.id===owner.id),plan=physical.plans.find(row=>row.owner.id===owner.id);
    assert.ok(abi&&plan);
    const blocks=plan.graph.blocks,operations=blocks.flatMap(block=>block.instructions);
    const compare=operations.find(row=>row.name==='tsfg_program.strict_equal');
    const branch=operations.find(row=>row.name==='cf.cond_br');
    const returned=operations.find(row=>row.name==='tsfg_program.load'&&row.range.start===expected.load.start);
    assert.ok(compare?.result&&branch&&returned?.result);
    const tested=operations.find(row=>row.result===compare.operands[0]);
    assert.ok(tested?.name==='tsfg_program.load');
    assert.equal(tested.properties.binding===returned.properties.binding,expected.sameBinding);
    const operator=name==='reverse'?'!==':'===';
    assert.equal(compare.properties.operator,operator);
    assert.deepEqual(compare.range,expected.condition);
    assert.deepEqual(branch.range,expected.condition);
    assert.deepEqual(branch.operands,[compare.result]);
    assert.deepEqual(returned.range,expected.load);
    assert.equal(source.slice(expected.condition.start,expected.condition.end),'value '+operator+' null');
    assert.equal(source.slice(expected.load.start,expected.load.end),name==='alias'?'other':'value');

    const result=physical.values.actual.observed.get(owner.id+'/'+returned.result);
    assert.ok(result);
    assert.equal(result.unknown,false);
    if(name==='reverse'){
      assert.equal(blocks.find(block=>block.instructions.includes(returned))?.name,branch.successors[0]);
      assert.equal(abi.result,box);
      assert.deepEqual([...result.tags],[box]);
    }else{
      const domain=core.representation.domains.find(row=>row.id===abi.result);
      assert.ok(domain);
      assert.deepEqual(domain.actualTypes,[box,absent].sort());
      assert.equal(domain.tagBytes,2);
      assert.deepEqual([...result.tags].sort(),name==='alias'?[box,absent].sort():[absent]);
      if(name==='overwrite'){
        const write=operations.find(row=>row.name==='tsfg_program.store'&&row.range.start===expected.overwrite.start);
        assert.ok(write);
        assert.deepEqual(write.range,expected.overwrite);
        assert.equal(write.properties.binding,returned.properties.binding);
        assert.ok(operations.indexOf(write)<operations.indexOf(returned));
      }
    }
  }
});
