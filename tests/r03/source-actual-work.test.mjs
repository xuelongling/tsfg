// SPDX-License-Identifier: MIT
// Cold retained official facts to owned compiler metadata only. No Source or Runtime execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
for(const fixture of ['common-string-capture/local-const','common-value-capture/copy-scalar'])test('complete context work stays within the private4 finite physical profile: '+fixture,()=>{
  const hir=projectCommonProgram(readCommonProgramFacts(readFileSync(new URL('./testdata/'+fixture+'.json',import.meta.url)))),
    physical=commonProgramPhysical(hir);
  assert.equal(physical.model.limits.work,2000000);
  assert.notEqual(physical.values.capacity.contexts,physical.values.actual.contexts);assert.notEqual(physical.values.capacity.objects,physical.values.actual.objects);assert.notEqual(physical.values.capacity.regions.nodes,physical.values.actual.regions.nodes);
  for(const solved of [physical.values.capacity,physical.values.actual]){
    assert.ok(solved.contexts.size>0);
    let ordinal=0;for(const [id,context]of solved.contexts){assert.equal(id,context.id);assert.equal(id,context.plan.owner.id+'/context:'+ordinal++);if(!context.root)assert.equal(context.entryHeap,context.entrySnapshot.entryHeap);}
    const actual=[...solved.contexts.values()].filter(c=>c.constructionRoot);
    const expected=[];
    for(const target of physical.model.types.values())if(target.construction&&['reference','value'].includes(target.kind)){
      let owner=target;while(owner){if(owner.construction)expected.push(owner.construction.id+'/'+target.id);owner=physical.model.types.get(owner.base);}
    }
    assert.deepEqual(actual.map(c=>c.constructionRoot.constructionId+'/'+c.constructionRoot.newTarget).sort(),expected.sort());
    assert.ok(actual.every(c=>c.root),'every owned constructor/new_target pair remains a real root');
  }
});
