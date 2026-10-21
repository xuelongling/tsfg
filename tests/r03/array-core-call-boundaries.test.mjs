// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedArrayCore13 } from './array-core13-literal.mjs';
import {readFile} from 'node:fs/promises';
import {lowerHir,verifyHir} from '../../compiler/hir.mjs';
import {parseArrayCore} from './array-core-structural-oracle.mjs';
import {old18Oracle,fresh,pinnedContainer} from './array-test-fixtures.mjs';
const o=JSON.parse(await readFile(new URL('./array-core-call-oracle.json',import.meta.url),'utf8'));
const legacyWhole=await pinnedContainer('./array-core12-legacy-oracle.json',1058670,
  '5d508df006d7191686dd950744d7bf212466fe562f33c5708e041a9b07ece535');
const nodeWhole=await pinnedContainer('./array-core12-node-additions.json',1330667,
  '60abad7dd96ab271f822e63a12bb3ba7816dd142c8eecbd172e01566b32b4792');
const scalarWhole=legacyWhole.cases.find(c=>c.name==='actual-source-scalar-ordinary-call');assert.ok(scalarWhole);
o.core=scalarWhole.core;
const context=()=>({...o.factsContext,factsBytes:Buffer.from(o.sourcePacket)});
test('whole ordinary-call Core retains both complete functions and every typed edge',()=>{
  const input=fresh(o.hir),before=fresh(input),ctx=context(),bytes=Buffer.from(ctx.factsBytes);
  const core=lowerHir(input,ctx,o.publication),expectedCore=expectedArrayCore13(input,ctx,o.publication);assert.equal(core,expectedCore);
  assert.deepEqual(parseArrayCore(core),parseArrayCore(expectedCore));
  assert.deepEqual(input,before);assert.deepEqual(ctx.factsBytes,bytes);
  assert.equal(parseArrayCore(core).functions.length,2);
  assert.deepEqual(parseArrayCore(core).functions[1].operations.map(op=>op.name),
    ['tsfg_core.fuel','tsfg_core.constant','tsfg_array.create','func.call','tsfg_core.constant','tsfg_array.read_checked','func.return']);
});
test('complete captured identity is checked before an ordinary call can be emitted',()=>{
  const wrong=context();wrong.expectedPackageId='sha256:'+'0'.repeat(64);
  assert.throws(()=>lowerHir(fresh(o.hir),wrong,o.publication),{code:'r03-array-hir-context'});
});
test('call target, signature, source binding, original range and whole graph cannot be substituted',()=>{
  /** @type {Array<(h:any)=>void>} */
  const mutations=[
    h=>{h.functions[1].body[1].expression.target=h.functions[1].id;},
    h=>{h.functions[1].body[1].expression.signatureHash='sha256:'+'0'.repeat(64);},
    h=>{h.functions[1].body[1].expression.sourceCallee=h.functions[1].sourceBinding;},
    h=>{h.functions[1].body[1].expression.calleeRange.end--;},
    h=>{h.functions[1].body[1].expression.arguments.push(h.functions[1].body[0].initializer);},
    h=>{h.functions.shift();},
  ];
  for(const change of mutations){const h=fresh(o.hir);change(h);
    assert.throws(()=>lowerHir(h,context(),o.publication),{code:'r03-array-hir-invalid'});}
});
test('actual Array parameters, ReadSpan RR and floating returns retain whole source Core',async()=>{
  const all=await old18Oracle();
  const prior=JSON.parse(await readFile(new URL('./array-parallel-oracle.json',import.meta.url),'utf8'));
  const view=prior.cases.find(row=>row.name==='shared-readspan-RR');assert.ok(view);
  const viewCtx={family:'tsfg.array-facts-context-candidate',version:1,expectedPackageId:view.hir.inputIdentity,
    factsBytes:Buffer.from(view.source.packetText)};
  assert.deepEqual(verifyHir(fresh(view.hir),viewCtx,view.context),view.hir);
  const viewExpected=nodeWhole.cases.find(c=>c.name===view.name);assert.ok(viewExpected);
  const viewInput=fresh(view.hir),viewBefore=fresh(view.hir),contextBefore=fresh(view.context);
  assert.equal(lowerHir(viewInput,viewCtx,view.context),expectedArrayCore13(viewInput,viewCtx,view.context));
  assert.deepEqual(viewInput,viewBefore);assert.deepEqual(view.hir,viewBefore);assert.deepEqual(view.context,contextBefore);
  for(const name of ['first-touch-alias','core-new-return-only-refusal']){
    const row=all.cases.find(row=>row.name===name);assert.ok(row);
    const ctx={...row.factsContext,factsBytes:Buffer.from(row.packageText)};
    assert.deepEqual(verifyHir(fresh(row.hir),ctx),row.hir);
    if(name==='first-touch-alias'){
      const input=fresh(row.hir),text=lowerHir(input,ctx);assert.equal(text,expectedArrayCore13(input,ctx));
      const core=parseArrayCore(text);
      assert.deepEqual(core.functions.map(fn=>fn.properties.sym_name),['touch','entry']);continue;
    }
    const expected=nodeWhole.cases.find(c=>c.name===name);assert.ok(expected);
    const input=fresh(row.hir),before=fresh(input);
    assert.equal(lowerHir(input,ctx),expectedArrayCore13(input,ctx));assert.deepEqual(input,before);
  }
});
