// SPDX-License-Identifier: MIT
// Independent Source-only expectations precede the checked packet and plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256,scalarName} from '../../compiler/identity.mjs';
const expected=JSON.parse(await readFile(new URL('./testdata/typed-array-entry/636f10994484e0fad8ae813a403b5f20136e3c28e5e84766658c470e5cf29571-expected.json',import.meta.url),'utf8'));
const packet=new URL('./testdata/typed-array-entry/'+expected.source.sha256+'-package.json',import.meta.url);
test('only feasible incoming call occurrences supply Array versions; unproductive entry stays pending',async()=>{
  const bytes=await readFile(packet),facts=readTypedArrayFacts(bytes);
  assert.equal(sha256(bytes).slice(7),'7732a541fe22955a8a4a3a4449a6117e793f5807e58cf527fd65f3148d1c5657');
  assert.equal(facts.payload.files.find(row=>row.path==='/src/main.ts').content,expected.source.text);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=built.hir,plan=buildFiniteCoreDomains(hir,context).definition;
  const read=name=>plan.arrayReaching.reads.find(row=>row.node.startsWith(hir.functions.find(fn=>fn.name===name).id+'/'));
  const version=row=>{
    const fn=hir.functions.find(fn=>fn.name===row.caller),matches=plan.arrayReaching.writes.filter(write=>
      write.id.startsWith(fn.id+'/')&&write.kind===row.kind&&write.origin.start===row.origin[0]&&write.origin.end===row.origin[1]);
    assert.equal(matches.length,1,'every Source version remains globally bound');return matches[0];
  };
  const dead=read(expected.deadOnly.helper);
  assert.equal(dead.status,expected.deadOnly.status);assert.deepEqual(dead.versions,[]);assert.deepEqual(dead.sources,[]);
  const common=read(expected.helper),selected=expected.preceding.map(version);
  assert.equal(common.status,'proven');
  assert.deepEqual(common.versions,selected.map(row=>row.id).sort(),'only the six independently derived possible initial versions');
  assert.deepEqual(common.sources,selected.map(row=>row.node).sort());
  for(const row of expected.excluded)assert.ok(!common.versions.includes(version(row).id));
  assert.equal(plan.arrayReaching.writes.length,expected.globalInitials.length);
  expected.globalInitials.forEach(version);
  const types=id=>plan.domains.find(row=>row.id===id).actualTypes.map(id=>scalarName(id)??hir.types.find(row=>row.id===id)?.kind).sort();
  const helper=hir.functions.find(fn=>fn.name===expected.helper);
  assert.deepEqual(types(plan.nodes.find(row=>row.id===common.node).domainId),expected.definitionReadTypes);
  assert.deepEqual(types(plan.carrierNodes.find(row=>row.id===common.node).domainId),expected.fixedResultTypes);
  assert.deepEqual(types(plan.abi.find(row=>row.functionId===helper.id).result),expected.fixedResultTypes);
  const text=lowerFormalHir(hir,context);
  assert.equal(text.split('"func.call"').length-1,expected.staticCallOccurrences);
  assert.equal(text.split('"tsfg_core.domain.array_create"').length-1,expected.globalInitials.length);
});
