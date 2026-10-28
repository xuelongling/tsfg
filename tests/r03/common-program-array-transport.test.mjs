// SPDX-License-Identifier: MIT
// Static complete-Source consumption; the numeric oracle is not guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';

const readHir=name=>projectCommonProgram(readCommonProgramFacts(readFileSync(new URL('./testdata/common-loop-local-factory/'+name+'.json',import.meta.url))));
const hasCode=(error,code)=>error instanceof Error&&'code' in error&&error.code===code;
function consume(name){
  const hir=readHir(name),publication=createCommonProgramPublication(hir),
    request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  return emitCommonProgramCore(hir,publication,request);
}
test('complete official Source keeps a readonly self-held reader through an Array element and loop exit',()=>{
  const core=consume('readonly-callable-array-held-safe');
  assert.equal(typeof core,'string');assert.match(core,/tsfg_program\.array_read/);
});
test('a reader saved before Array overwrite still owns its original capture after the new factory returns',()=>{
  assert.doesNotThrow(()=>consume('readonly-callable-array-saved-old'));
});
for(const name of ['conditional-empty','stored-undefined'])test('actual callable Array read retains absence: '+name,()=>{
  assert.throws(()=>consume('readonly-callable-array-'+name),e=>hasCode(e,'r03-common-program-capability'));
});
test('a proved initialized element still retains a stored undefined payload through verified union views',()=>{
  const hir=readHir('readonly-callable-array-stored-union-undefined'),types=new Map(hir.types.map(t=>[t.id,t])),
    arrays=hir.types.filter(t=>t.kind==='array'&&types.get(t.elementType)?.kind==='function');
  assert.equal(arrays.length,1);
  assert.equal(commonTargets(hir,commonMeter()).arrayElementInitialized(arrays[0].id,0),true);
  assert.throws(()=>createCommonProgramPublication(hir),e=>e instanceof Error&&hasCode(e,'r03-common-program-capability')&&e.message.includes('actual indirect operand is not callable'));
});
test('the full Array writer bound includes an unobserved global-read code arm',()=>{
  assert.throws(()=>consume('readonly-callable-array-unobserved-global-reader'),e=>hasCode(e,'r03-common-program-borrow-pending'));
});
