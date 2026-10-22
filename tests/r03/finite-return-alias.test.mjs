// SPDX-License-Identifier: MIT
// Real checked facts and the production producer: this is not C++ IR execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';

test('checked identity helper keeps its real argument and return SSA in formal Core',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-source514/32182fb1de5d58081e32f41557eb01de78e99056565fde9b7569c2a5a76eabb7-package.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok');const hir=built.hir,pass=hir.functions.find(fn=>fn.name==='pass');assert.ok(pass);
  const plan=buildFiniteCoreDomains(hir,context).definition,core=lowerFormalHir(hir,context);
  assert.deepEqual(plan.fieldReaching.returnAliases.find(row=>row.functionId===pass.id),{functionId:pass.id,parameter:0});
  const body=core.split('  func.func @"f'+pass.id.slice(7)+'"')[1].split('\n  }')[0];
  const parameter=/^\((%\w+):/.exec(body.trimStart());assert.ok(parameter);
  const returned=body.split('\n').find(line=>line.includes('"func.return"'));assert.ok(returned);
  assert.ok(returned.includes(parameter[1]));
  const calls=core.split('\n').filter(line=>line.includes('"func.call"')&&line.includes(pass.id));
  assert.equal(calls.length,1);assert.match(calls[0],/"func\.call"\(%\w+\)/);
});
