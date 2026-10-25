// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256} from '../../compiler/identity.mjs';

test('actual Source as undefined preserves checked-read tag, payload carrier and return ABI',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-source514/8411dbd327afea6c1612a697d510e2ab0f872c1b58a6aa28b702df17f943d57b-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:d185ac1d2b54029a6b1cb0113d9d2f892ff4cea0d8da2a350a1622e98f1f86a6');
  const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(row=>row.path===facts.payload.rootFile);
  assert.equal(source.content,'export function f(a:(i32|undefined)[],i:u32):undefined{return a[i] as undefined;}');
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=built.hir,fn=hir.functions[0],assertion=fn.body[0].value,types=new Map(hir.types.map(row=>[row.id,row]));
  assert.equal(assertion.kind,'assertType');assert.equal(types.get(assertion.type).kind,'undefined');
  assert.equal(types.get(fn.returnType.id).kind,'undefined');assert.equal(assertion.operand.kind,'arrayReadChecked');
  const operand=fn.id+'/body/0/value/operand',asserted=fn.id+'/body/0/value',returned=fn.id+'/return';
  const plans=buildFiniteCoreDomains(hir,context);
  for(const plan of [plans.reached,plans.definition]){
    const carriers=[operand,asserted,returned].map(id=>plan.carrierNodes.find(row=>row.id===id));
    assert.equal(carriers[0].domainId,carriers[1].domainId);assert.equal(carriers[1].domainId,carriers[2].domainId);
    const domain=plan.domains.find(row=>row.id===carriers[0].domainId);
    assert.deepEqual(new Set(domain.actualTypes.map(id=>types.get(id).name)),new Set(['i32','undefined']));
    assert.equal(domain.representation,'finite-union');assert.equal(domain.tagBytes,2);assert.equal(domain.byteSize,8);
    assert.equal(plan.abi.find(row=>row.functionId===fn.id).result,domain.id);
    // External dynamic reads keep their ordered-source obligation. The fixed
    // carrier/ABI is a payload bound, not a fabricated successful cell version.
    const read=plan.arrayReaching.reads.find(row=>row.node===operand);
    assert.equal(read.status,'pending');assert.deepEqual(read.versions,[]);assert.deepEqual(read.sources,[]);
    const ordered=[operand,asserted,returned].map(id=>plan.nodes.find(row=>row.id===id));
    assert.deepEqual(ordered[0].pending,ordered[1].pending);assert.deepEqual(ordered[1].pending,ordered[2].pending);
    assert.ok(ordered[0].pending.some(value=>value.startsWith('unproved-ordered-array-read:')));
  }
  assert.deepEqual(verifyHir(hir,context),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);
  const core=lowerFormalHir(hir,context),body=core.split('\n').filter(line=>!line.startsWith('module attributes'));
  const read=body.find(line=>line.includes('"tsfg_core.domain.array_read"'));
  const view=body.find(line=>line.includes('"tsfg_core.domain.view"'));
  const returnedLine=body.find(line=>line.includes('"func.return"'));
  const readResult=read.trim().split(' = ')[0],viewResult=view.trim().split(' = ')[0];
  const domain=plans.definition.abi.find(row=>row.functionId===fn.id).result;
  assert.ok(view.includes('('+readResult+')'));assert.ok(view.includes('view_type = "'+assertion.type+'"'));
  assert.ok(view.includes('domain = "'+domain+'"'));
  assert.ok(view.endsWith(': (!tsfg_core.domain<"'+domain+'">) -> !tsfg_core.domain<"'+domain+'">'));
  assert.ok(returnedLine.includes('('+viewResult+')'));assert.ok(returnedLine.includes('!tsfg_core.domain<"'+domain+'">'));
  assert.deepEqual(body.filter(line=>line.trim().startsWith('%')&&line.includes(' = "')).map(line=>line.match(/= "([^"]+)"/)[1]),
    ['tsfg_core.domain.array_read','tsfg_core.domain.view']);
});
