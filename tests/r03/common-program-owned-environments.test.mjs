// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {ownedEnvironmentModel,ownedClosureChoiceModel} from './common-program-owned-environment-models.mjs';
for(const mode of ['held','restored','throw-held'])test('normalized escaped environment independently holds Array owner: '+mode,()=>{
  const {program,records}=ownedEnvironmentModel(mode);analyzeCommonGraphs(program,records);
});
for(const mode of ['held','pure','throw'])test('normalized returned closure alternatives retain only their own owner: '+mode,()=>{
  const {program,records}=ownedClosureChoiceModel(mode);analyzeCommonGraphs(program,records);
});
for(const mode of ['bad','bad-throw'])test('normalized returned closure alternatives cannot borrow the other owner proof: '+mode,()=>{
  const {program,records}=ownedClosureChoiceModel(mode);
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending'&&e.functionId==='chooser'&&e.primary.start===230);
});
for(const mode of ['indirect','indirect-throw'])test('normalized distinct factory targets at one call own distinct environments: '+mode,()=>{
  const {program,records}=ownedClosureChoiceModel(mode),solved=analyzeCommonGraphs(program,records),
    chooser=[...solved.actual.contexts.values()].find(c=>c.root&&c.plan.owner.id==='chooser'),selected=mode==='indirect'?chooser.returned:chooser.thrown;
  assert.equal(selected.pairs.size,2);assert.equal(selected.refs.size,2);
  for(const pair of selected.pairs.values())assert.equal(solved.actual.objects.get(pair.environment).type,'env:'+program.model.functions.get(pair.functionId).lexicalEnvironment);
});
test('normalized single-call factory targets cannot lend an owner across alternatives',()=>{
  const {program,records}=ownedClosureChoiceModel('indirect-bad');
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending'&&e.functionId==='chooser'&&e.primary.start===230);
});
for(const mode of ['descriptor-only','replaced','throw-replaced','maybe-owner'])test('normalized escaped environment cannot infer an independent Array owner: '+mode,()=>{
  const {program,records}=ownedEnvironmentModel(mode);
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
test('normalized held Array lifetime does not excuse active structural mutation',()=>{
  const {program,records}=ownedEnvironmentModel('resized');
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict'&&e.primary.start===210);
});
for(const name of ['explicit-owner','descriptor-only','owner-replaced','parameter-owner-index1','const-owner-content-write','parent-owned-environment','function-element-parameter'])test('official whole Program Array owner capture '+name,()=>{
  const hir=projectCommonProgram(readCommonProgramFacts(readFileSync(new URL('./testdata/common-owned-environments/'+name+'.json',import.meta.url)))),
    request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  if(name==='function-element-parameter'){
    // Source accepts generic captures. An arbitrary Array element can still
    // be undefined, and capture storage grants no callable payload authority.
    assert.throws(()=>createCommonProgramPublication(hir),/** @param {any} e */e=>e.code==='r03-common-program-capability'&&e.primary.start===1418);return;
  }
  const publication=createCommonProgramPublication(hir);
  if(['descriptor-only','owner-replaced'].includes(name))assert.throws(()=>emitCommonProgramCore(hir,publication,request),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
  else assert.match(emitCommonProgramCore(hir,publication,request),/tsfg_program.env_load/);
  if(name==='const-owner-content-write'){
    const reader=hir.functions.find(fn=>fn.name==='readOwned'),capture=reader.captures.find(c=>hir.environments.some(env=>env.slots.some(slot=>slot.binding===c.binding&&hir.types.find(t=>t.id===slot.type)?.kind==='array'))),
      key=hir.environments.flatMap(env=>env.slots).find(slot=>slot.binding===capture.binding).key,
      upper=publication.contracts.find(row=>row.functionId===reader.id).upper.captures.find(row=>row.slot===key);
    assert.equal(capture.write,false,'Array content mutation does not rebind its const capture');
    assert.equal(upper.write,true,'fixed upper includes writes through the captured Array');
    assert.equal(upper.structural,true,'fixed upper keeps conservative Array element mutation permission');
  }
});
