// SPDX-License-Identifier: MIT
// Actual checked Source through the production formal producer. This does not
// execute Source or the C++ IR consumer; the latter is separately object-tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';

test('narrow local allocation and alias copy retain actual U in formal element equations',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/87d0326f6f0e3e1eb887a77b7eb207a938c3ca173f094f8cdb21f1820284a4ad-package.json',import.meta.url));
  assert.equal(bytes.length,9504);assert.equal(sha256(bytes),'sha256:042eee481c55e941ee47e8ebe284feff0d16621cf37f60c3615d3b247eb9d051');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  const hir=built.hir,run=hir.functions.find(row=>row.name==='run'),
    plan=buildFiniteCoreDomains(hir,context).definition,core=lowerFormalHir(hir,context),
    copied=run.body.find(row=>row.kind==='local'&&row.binding.name==='copied');
  assert.equal(copied.initializer.kind,'arrayReadChecked');assert.equal(copied.initializer.type,scalarTypeIds.i32);
  const source=hir.sources.find(row=>row.path==='/src/main.ts').content;
  assert.equal(source.slice(copied.initializer.range.start,copied.initializer.range.end),'narrow[0]');
  const actual=[scalarTypeIds.i32,sha256('tsfg.type\0undefined')].sort(),
    elements=plan.nodes.filter(row=>row.id.startsWith(run.id+'/')&&row.id.endsWith('/elements'));
  assert.equal(elements.length,1);
  assert.deepEqual(plan.domains.find(row=>row.id===elements[0].domainId).actualTypes,actual);
  const allocation=plan.nodes.find(row=>row.id===elements[0].id.slice(0,-'/elements'.length));
  assert.deepEqual(allocation.arrayOwners,[allocation.id]);
  const body=core.split('  func.func @"f'+run.id.slice(7)+'"')[1].split('\n  }')[0],lines=body.split('\n'),
    create=lines.filter(row=>row.includes('"tsfg_core.domain.array_create"')),
    stores=lines.filter(row=>row.includes('"tsfg_core.domain.array_store"')),
    reads=lines.filter(row=>row.includes('"tsfg_core.domain.array_read"'));
  assert.equal(create.length,1);assert.equal(stores.length,2);assert.equal(reads.length,2);
  assert.ok(create[0].includes('element_domain = "'+elements[0].domainId+'"'));
  assert.ok(create[0].includes('owner = "'+allocation.id+'"'));
  assert.ok(body.indexOf(create[0])<body.indexOf(stores[0]));
  assert.ok(body.indexOf(stores[0])<body.indexOf(reads[0]));
  assert.ok(body.indexOf(reads[0])<body.indexOf(stores[1]));
  assert.ok(body.indexOf(stores[1])<body.indexOf(reads[1]));
  const captured=/^\s*(%\w+) =/.exec(reads[0])[1];
  assert.ok(stores[1].includes(', '+captured+')'),'copy-store consumes the one original read result');
  for(const read of reads)assert.ok(read.includes('domain = "'+elements[0].domainId+'"'));
});
