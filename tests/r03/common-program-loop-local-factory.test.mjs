// SPDX-License-Identifier: MIT
// Whole official Source/checker packets, with a frozen independent lifetime oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
function compile(name){
 const source=readFileSync(new URL('./testdata/common-loop-local-factory/'+name+'.json',import.meta.url)),
  hir=projectCommonProgram(readCommonProgramFacts(source)),publication=createCommonProgramPublication(hir),
  request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
 return emitCommonProgramCore(hir,publication,request);
}
test('official whole Source consumes the current loop-local factory result',()=>{
 const core=compile('loop-local-held-safe');assert.ok(core.includes('tsfg_program.invoke_indirect'));
});
for(const name of ['loop-local-replaced-owner','loop-local-descriptor-only'])test('official loop factory rejects an unheld owner: '+name,()=>{
 assert.throws(()=>compile(name),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
