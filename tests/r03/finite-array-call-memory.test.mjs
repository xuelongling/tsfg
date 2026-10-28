// SPDX-License-Identifier: MIT
// The existing checked Source program, not a synthetic HIR or execution oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256} from '../../compiler/identity.mjs';

test('actual returned Array alias retains the preceding selected callee write',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-reference-domain/b37ee6351a6d88a3a5b21a32423deb4f953f05fe689700157148fd208ae21d59-package.json',import.meta.url)),
    facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
      factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  assert.equal(sha256(bytes),'sha256:382604a7074b320293b7c49a295db248c26a189f024a1158830ccb8dff8a0888');
  assert.match(facts.payload.files.find(row=>row.path==='/src/main.ts').content,/replace\(wide,replacement\);const observed:Base=narrow\[0\]/);
  const hir=built.hir,run=hir.functions.find(fn=>fn.name==='alias'),replace=hir.functions.find(fn=>fn.name==='replace'),
    base=run.body.find(row=>row.kind==='local'&&row.binding.name==='replacement').initializer.declaredType,
    plans=buildFiniteCoreDomains(hir,context),plan=plans.definition,
    read=plan.arrayReaching.reads.find(row=>row.node.startsWith(run.id+'/')),
    write=plan.arrayReaching.writes.find(row=>row.id.startsWith(replace.id+'/'));
  assert.ok(read);assert.ok(write);assert.equal(read.status,'proven');
  assert.deepEqual(read.versions,[write.id]);assert.deepEqual(read.sources,[write.node]);
  const value=plans.reached.nodes.find(row=>row.id===read.node);
  assert.deepEqual(plans.reached.domains.find(row=>row.id===value.domainId).actualTypes,[base],
    'the reached call supplies Base; the definition-level helper parameter retains its separate universal bound');
  const derived=run.body.find(row=>row.kind==='local'&&row.binding.name==='narrow').initializer.elements[0].declaredType,
    capacity=plan.carrierNodes.find(row=>row.id===run.id+'/body/0/initializer/elements');
  assert.deepEqual(plan.domains.find(row=>row.id===capacity.domainId).actualTypes,[base,derived].sort(),
    'selecting a preceding callee version never shrinks the owner-wide physical capacity');
  const text=lowerFormalHir(hir,context);
  assert.match(text,/"tsfg_core.domain.array_store"/);assert.match(text,/"tsfg_core.domain.array_read"/);
  assert.ok(text.includes('array_reaching'));
  let charges=0;buildFiniteCoreDomains(hir,context,{cancelled:()=>{charges++;return false;}});
  let published,seen=0;
  assert.throws(()=>{published=buildFiniteCoreDomains(hir,context,{cancelled:()=>++seen===charges-1});},/cancelled/);
  assert.equal(published,undefined,'a cancelled final transfer publishes no partial plan');
  assert.throws(()=>{published=buildFiniteCoreDomains(hir,context,{work:charges-1});},/work limit/);
  assert.equal(published,undefined);
});
