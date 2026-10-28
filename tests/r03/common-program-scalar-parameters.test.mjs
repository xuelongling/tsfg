// SPDX-License-Identifier: MIT
// Complete official Source packets retain original parameter identity. Numeric
// results are independent, unexecuted oracles; these tests check static consumers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
for(const name of ['direct-readonly','shared-mutation','ancestor-forward','shadow-local'])test('complete original scalar parameter capture: '+name,()=>{
  const facts=readCommonProgramFacts(readFileSync(new URL('./testdata/common-scalar-parameters/'+name+'.json',import.meta.url))),hir=projectCommonProgram(facts),
    factory=hir.functions.find(f=>f.name==='makeOwnedReader'),reader=hir.functions.find(f=>f.name==='readOwned'),
    sourceFactory=facts.payload.functions.find(f=>f.name==='makeOwnedReader'),seed=factory.parameters.find(p=>p.name==='seed');
  assert.equal(seed.id,sourceFactory.parameters[0].id);assert.equal(seed.sourceBinding,seed.id);
  assert.equal(seed.kind,'parameter');assert.equal(seed.lexicalOwner,factory.id);assert.equal(seed.writable,true);
  const captures=reader.captures.filter(c=>c.binding===seed.id),slots=hir.environments.flatMap(e=>e.slots).filter(s=>s.binding===seed.id);
  if(name==='shadow-local'){
    assert.equal(captures.length,0);assert.equal(slots.length,0);
    const shadow=reader.bindings.find(b=>b.name==='seed');assert.ok(shadow);assert.notEqual(shadow.id,seed.id);assert.equal(shadow.lexicalOwner,reader.id);
  }else{
    assert.equal(captures.length,1);assert.equal(captures[0].read,true);assert.equal(captures[0].write,name==='shared-mutation');
    assert.equal(slots.length,1);assert.equal(slots[0].kind,'parameter');assert.equal(slots[0].type,seed.type);assert.equal(slots[0].writable,true);
    assert.equal(reader.lexicalEnvironment,factory.activationEnvironment);
    if(name==='ancestor-forward'){
      assert.notEqual(reader.lexicalParent,factory.id);
      assert.equal(hir.functions.find(f=>f.id===reader.lexicalParent).lexicalParent,factory.id);
    }
  }
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()},
    core=emitCommonProgramCore(hir,publication,request);assert.match(core,/tsfg_program.env_load/);assert.match(core,/tsfg_program.array_read/);
  if(name==='shared-mutation')assert.match(core,/tsfg_program.env_store/);
});
