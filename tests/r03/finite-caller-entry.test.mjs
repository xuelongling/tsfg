// SPDX-License-Identifier: MIT
// Production Source-facts→HIR→Core data route, not Source or C++ execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';

test('internal field read uses the actual caller-before write, not the official union flow',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/4ba3371076ddd76ce6bec0c842ebff1881a826afcb81800a32914570eb4e9874-package.json',import.meta.url));
  assert.equal(bytes.length,9760);assert.equal(sha256(bytes),'sha256:f133f8c23e44e1ca3672069ab11c19d0277f9c3cabd1b4a156ae7b2f58836f05');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  const hir=built.hir,read=hir.functions.find(fn=>fn.name==='read'),run=hir.functions.find(fn=>fn.name==='run');
  assert.ok(read);assert.ok(run);
  const plan=buildFiniteCoreDomains(hir,context).definition,core=lowerFormalHir(hir,context),
    access=plan.fieldReaching.reads.find(row=>row.node.startsWith(read.id+'/')),
    write=plan.fieldReaching.writes.find(row=>row.id.startsWith(run.id+'/'));
  assert.ok(access);assert.ok(write);assert.ok(access.reaching.length>0);
  assert.ok(access.reaching.every(row=>row.versions.length===1&&row.versions[0]===write.id));
  const value=plan.nodes.find(row=>row.id===access.node);assert.ok(value);
  assert.deepEqual(plan.domains.find(row=>row.id===value.domainId)?.actualTypes,[scalarTypeIds.i32]);
  const caller=core.split('  func.func @"f'+run.id.slice(7)+'"')[1].split('\n  }')[0],
    store=caller.split('\n').find(line=>line.includes('"tsfg_core.domain.field_store"')),
    call=caller.split('\n').find(line=>line.includes('"func.call"')&&line.includes(read.id));
  assert.ok(store);assert.ok(call);assert.ok(caller.indexOf(store)<caller.indexOf(call));
  const callee=core.split('  func.func @"f'+read.id.slice(7)+'"')[1].split('\n  }')[0],
    field=callee.split('\n').find(line=>line.includes('"tsfg_core.domain.field_read"'));
  assert.ok(field);assert.ok(field.includes(write.id),'read version binds the real write in another callable');
  assert.equal(callee.split('\n').filter(line=>line.includes('"tsfg_core.domain.field_read"')).length,1);
});
