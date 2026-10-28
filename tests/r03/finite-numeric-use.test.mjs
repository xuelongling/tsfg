// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256,i32TypeId,boolTypeId} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';

// Official Source private-v8 packet: preserve pure assertions, initialized
// undefined, conditional numeric use and the original operation ranges.
const bytes=await readFile(new URL('./testdata/typed-array-holder-parameter/valid-undefined-numeric-package.json',import.meta.url));
assert.equal(bytes.length,21597);
assert.equal(sha256(bytes),'sha256:5215e5bdcac3dedf45450606499f60ea838a9cd3d6ae1b64f5737165cce5cdfc');
const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
assert.equal(sha256(source.content),'sha256:fa359e55b9a6c435329f6ff155ea6a36f8d3771c1569cbce22d355f4be1e36c9');
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
const none={read:false,write:false,structural:false};
const publication=staticPublication(facts,{keep:{parameters:{0:{...none,read:true}},local:none}});
const built=buildHir(facts,context,publication);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir;

test('official initialized-undefined numeric facts preserve HIR and lower checked Core continuations',async()=>{
  assert.deepEqual(verifyHir(hir,context,publication),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context,publication)),context,publication),hir);
  const core=lowerFormalHir(hir,context,publication);
  const checks=core.split('\n').filter(line=>line.includes('"tsfg_core.domain.numeric_use"'));
  assert.equal(checks.length,4);
  for(const [start,end] of [[235,238],[376,378],[490,501],[580,591]]) {
    const check=checks.find(line=>line.includes('tsfg_source.start = '+start+' : i64'));
    assert.ok(check,'missing full original numeric operation '+start);
    assert.ok(check.includes('tsfg_source.end = '+end+' : i64'));
    assert.ok(check.includes('trap_code = "r01-t-undefined-numeric-use"'));
    assert.ok(check.includes('rule_id = "r01-numeric-use"'));
    assert.ok(check.includes('numeric_operand = 0 : i32'));
    assert.match(check,/\)\[\^bb\d+\]/);
    assert.match(check,/-> \(\)$/);
  }
  assert.equal((core.match(/"tsfg_core.fuel"\(\) \{event = 1 : i32/g)??[]).length,5);
  if(process.env.TSFG_TEST_STORAGE) {
    await mkdir(process.env.TSFG_TEST_STORAGE,{recursive:true});
    await writeFile(path.join(process.env.TSFG_TEST_STORAGE,'core.mlir'),core,{flag:'wx'});
  }
});

test('normal numeric domains do not inherit undefined from the conditional physical ABI',()=>{
  const proofs=buildFiniteCoreDomains(hir,context,{publicationContext:publication});
  for(const plan of [proofs.reached,proofs.definition]) {
    const domains=new Map(plan.domains.map(domain=>[domain.id,domain]));
    const keep=hir.functions.find(fn=>fn.name==='keep');
    const returned=plan.nodes.find(node=>node.id===keep.id+'/return');
    assert.equal(domains.get(returned.domainId).actualTypes.length,2,'pure as/alias/return retains actual undefined');
    for(const expression of plan.expressions.filter(row=>['binary','unary'].includes(row.kind))) {
      const node=plan.nodes.find(node=>node.id===expression.id),domain=domains.get(node.domainId);
      assert.deepEqual(node.pending,[]);
      assert.deepEqual(domain.actualTypes,[expression.range.start===490||expression.range.start===484?boolTypeId:i32TypeId]);
    }
  }
});

test('actual Source i32 plus, operand order and U-only normal continuation use the accepted operation boundary',async()=>{
  const raw=await readFile(new URL('./testdata/typed-array-holder-parameter/numeric-use-order-package.json',import.meta.url));
  assert.equal(raw.length,23356);assert.equal(sha256(raw),'sha256:31d977221743664401bffcba459895e76ece4f42449570a42f7dedcaf8b2410b');
  const facts=readTypedArrayFacts(raw),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:raw,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=built.hir,proofs=buildFiniteCoreDomains(hir,context,{publicationContext:publication}),core=lowerFormalHir(hir,context,publication);
  const fn=name=>hir.functions.find(fn=>fn.name===name);
  for(const plan of [proofs.reached,proofs.definition]) {
    const domains=new Map(plan.domains.map(domain=>[domain.id,domain.actualTypes]));
    for(const name of ['plus','direct','caller']) {
      const returned=plan.nodes.find(node=>node.id===fn(name).id+'/return');
      assert.deepEqual(domains.get(returned.domainId),[],'U-only '+name+' cannot publish a successful return');
      assert.deepEqual(returned.pending,[],'proven numeric trap is distinct from unresolved analysis');
    }
    const result=plan.nodes.find(node=>node.id===fn('plusValue').id+'/return');
    assert.deepEqual(domains.get(result.domainId),[i32TypeId]);
  }
  const body=name=>{const start=core.indexOf('func.func @"f'+fn(name).id.slice(7)+'"');assert.ok(start>=0);const end=core.indexOf('func.func @',start+1);return core.slice(start,end<0?undefined:end);};
  const ordered=body('ordered'),left=ordered.indexOf('callee = @"f'+fn('left').id.slice(7)+'"'),right=ordered.indexOf('callee = @"f'+fn('right').id.slice(7)+'"'),check=ordered.indexOf('"tsfg_core.domain.numeric_use"');
  assert.ok(left>=0&&right>left&&check>right,'both actual calls precede the first consumption check');
  const rhs=body('rhsFails');assert.ok(rhs.indexOf('"tsfg_core.div"')<rhs.indexOf('"tsfg_core.domain.numeric_use"'),'RHS operation precedes outer operand consumption');
  assert.match(body('plus'),/"tsfg_core.pos"/,'checked unary plus retains an actual scalar consumer');
  if(process.env.TSFG_TEST_STORAGE)await writeFile(path.join(process.env.TSFG_TEST_STORAGE,'numeric-order-core.mlir'),core,{flag:'wx'});
});
