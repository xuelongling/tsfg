// SPDX-License-Identifier: MIT
// Real exported Array inputs: static aliases do not establish an instance,
// and a broad shared write is not filtered by a narrow reader's view.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256,scalarTypeIds} from '../../compiler/identity.mjs';
const inputs={
  shared:{source:'06b4f526067edba140db846a26d32539bcee0c402d9797002ca5fee8a936f041',
    packet:'80dffafc8e81e3e71f2a1d5c85044cb6f1c2eac248d028d1e759f88a06b89ecf',
    text:'class Base{n:i32=1;} class Derived extends Base{extra:i32=2;} export function shared(a:Derived[],b:Base[]):Base{b[0]=new Base();return a[0];}'},
  separated:{source:'fe96067658500046a532a07df42adbc372b311686c1ff4017d92fa5aeb3b0578',
    packet:'1bfd67459d03da26d7a4054adfcd252f9700f936d7c8592764b0fb5007ad682c',
    text:'export function separated(a:i32[],b:u32[]):i32{a[0]+=1;return a[0];}'}
};
async function actual(row) {
  const bytes=await readFile(new URL('./testdata/typed-array-entry/'+row.source+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),row.packet);const facts=readTypedArrayFacts(bytes);
  assert.equal(facts.payload.files.find(file=>file.path==='/src/main.ts').content,row.text);
  assert.equal(sha256(row.text).slice(7),row.source);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  return {hir:built.hir,context};
}
test('a possible shared exported owner retains broad Base writes and its checked read',async()=>{
  const {hir,context}=await actual(inputs.shared),plan=buildFiniteCoreDomains(hir,context).definition,
    fn=hir.functions.find(row=>row.name==='shared'),reads=plan.arrayReaching.reads;
  assert.equal(reads.length,1);assert.equal(reads[0].status,'pending');assert.deepEqual(reads[0].versions,[]);
  const selected=plan.carrierNodes.find(row=>row.id===reads[0].node),types=plan.domains.find(row=>row.id===selected.domainId).actualTypes;
  assert.deepEqual(types,[...hir.types.filter(row=>row.kind==='reference').map(row=>row.id)].sort());
  const a=plan.carrierNodes.find(row=>row.id===fn.id+'/binding/'+fn.parameters[0].id),
    b=plan.carrierNodes.find(row=>row.id===fn.id+'/binding/'+fn.parameters[1].id);
  assert.equal(a.arrayOwners.length,1);assert.equal(b.arrayOwners.length,1);
  assert.ok(plan.aliases.some(row=>[row.left,row.right].includes(a.arrayOwners[0])&&[row.left,row.right].includes(b.arrayOwners[0])));
  const core=lowerFormalHir(hir,context);
  assert.equal(core.split('"tsfg_core.domain.array_store"').length-1,1);
  assert.equal(core.split('"tsfg_core.domain.array_read"').length-1,1);
  assert.equal(core.split('"tsfg_core.domain.array_create"').length-1,0,'parameter roles never allocate an Array');
});
test('distinct native entry storage is not merged merely because both are parameter roles',async()=>{
  const {hir,context}=await actual(inputs.separated),plan=buildFiniteCoreDomains(hir,context).definition,
    fn=hir.functions.find(row=>row.name==='separated'),returned=plan.carrierNodes.find(row=>row.id===fn.id+'/return');
  assert.deepEqual(plan.domains.find(row=>row.id===returned.domainId).actualTypes,[scalarTypeIds.i32]);
  assert.deepEqual(plan.aliases,[]);assert.ok(plan.arrayReaching.reads.some(row=>row.status==='pending'));
  assert.match(lowerFormalHir(hir,context),/"tsfg_core.domain.array_read"/);
});
