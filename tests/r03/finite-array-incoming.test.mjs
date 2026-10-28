// SPDX-License-Identifier: MIT
// Whole caller-entry expectations were derived from Source before new facts or plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256,scalarName} from '../../compiler/identity.mjs';
const expected=JSON.parse(await readFile(new URL('./testdata/typed-array-entry/49e8a3038cfca9e6b979e6c759b77cf054183509b682fd04be86d5f0a454e3c1-expected.json',import.meta.url),'utf8'));
const actualPacket=new URL('./testdata/typed-array-entry/49e8a3038cfca9e6b979e6c759b77cf054183509b682fd04be86d5f0a454e3c1-package.json',import.meta.url);

test('internal Array read meets every real caller entry without using capacity as memory',async()=>{
  const bytes=await readFile(actualPacket),facts=readTypedArrayFacts(bytes);
  assert.equal(bytes.length,11225);assert.equal(sha256(bytes).slice(7),'7ae483041419ff870213e415a30eb1458bcd7d8f048992a22ce8e73078fab685');
  assert.equal(facts.payload.files.find(row=>row.path==='/src/main.ts').content,expected.source.text);
  assert.equal(sha256(expected.source.text).slice(7),expected.source.sha256);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId},
    built=buildHir(facts,context);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=built.hir,plans=buildFiniteCoreDomains(hir,context),plan=plans.definition,
    fn=hir.functions.find(row=>row.name===expected.helper),read=plan.arrayReaching.reads.find(row=>row.node.startsWith(fn.id+'/'));
  assert.ok(read);assert.deepEqual([read.origin.start,read.origin.end],expected.helperRead);
  const version=row=>{
    const owner=hir.functions.find(fn=>fn.name===row.caller);
    const matches=plan.arrayReaching.writes.filter(write=>write.id.startsWith(owner.id+'/')&&write.kind===row.kind&&
      write.origin.start===row.origin[0]&&write.origin.end===row.origin[1]);
    assert.equal(matches.length,1,'each selected Source occurrence has one canonical version');return matches[0];
  };
  const selected=expected.preceding.map(version);
  assert.equal(read.status,'proven');assert.equal(read.index,'c:'+expected.index.value);
  assert.deepEqual(read.versions,selected.map(row=>row.id).sort());
  assert.deepEqual(read.sources,selected.map(row=>row.node).sort());
  for(const row of expected.excluded)assert.ok(!read.versions.includes(version(row).id));
  const types=domain=>plan.domains.find(row=>row.id===domain).actualTypes.map(id=>
    scalarName(id)??hir.types.find(row=>row.id===id)?.kind).sort();
  const node=plan.nodes.find(row=>row.id===read.node);
  assert.deepEqual(node.pending,[]);assert.deepEqual(types(node.domainId),expected.definitionReadTypes);
  assert.deepEqual(types(plan.carrierNodes.find(row=>row.id===read.node).domainId),expected.fixedResultTypes);
  for(const name of [expected.helper,...expected.callers]) {
    const fn=hir.functions.find(row=>row.name===name),abi=plan.abi.find(row=>row.functionId===fn.id);
    assert.deepEqual(types(abi.result),expected.fixedResultTypes,'ordered sources never narrow fixed result ABI');
  }
  const text=lowerFormalHir(hir,context);
  assert.equal(text.split('"tsfg_core.domain.array_read"').length-1,1);
  assert.equal(text.split('"tsfg_core.domain.array_store"').length-1,1);
  assert.equal(text.split('"tsfg_core.domain.array_create"').length-1,2);
  assert.ok(text.includes('tsfg_source.start = '+expected.helperRead[0]+' : i64'));
  let published,charges=0;
  buildFiniteCoreDomains(hir,context,{cancelled:()=>{charges++;return false;}});
  let seen=0;
  assert.throws(()=>{published=buildFiniteCoreDomains(hir,context,{cancelled:()=>++seen===charges-1});},/cancelled/);
  assert.equal(published,undefined);
  assert.throws(()=>{published=buildFiniteCoreDomains(hir,context,{work:charges-1});},/work limit/);
  assert.equal(published,undefined);
});
