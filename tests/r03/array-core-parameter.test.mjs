// SPDX-License-Identifier: MIT
import {migrateArrayCore11} from './array-test-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readArrayFactsCandidate} from '../../compiler/array-facts.mjs';
import {buildHir,verifyHir,lowerHir} from '../../compiler/hir.mjs';
import {parseArrayCore} from './array-core-structural-oracle.mjs';
const o=JSON.parse(await readFile(new URL('./array-core-parameter-oracle.json',import.meta.url),'utf8'));
for(const row of o.cases) row.core=migrateArrayCore11(row.core);
for(const row of o.cases)test('complete actual Array parameter package: '+row.name,()=>{
  const ctx={...row.factsContext,factsBytes:Buffer.from(row.sourcePacket)};
  const input=JSON.stringify(row.hir),packet=Buffer.from(ctx.factsBytes);
  const built=buildHir(readArrayFactsCandidate(ctx.factsBytes),ctx,row.publication);
  assert.equal(built.status,'ok');assert.deepEqual(built.hir,row.hir);
  assert.deepEqual(verifyHir(built.hir,ctx,row.publication),row.hir);
  const core=lowerHir(built.hir,ctx,row.publication);
  assert.equal(core,row.core);assert.deepEqual(parseArrayCore(core),parseArrayCore(row.core));
  assert.equal(JSON.stringify(row.hir),input);assert.deepEqual(ctx.factsBytes,packet);
});
test('actual package identity, full parameters, aliases, call SSA facts and exports cannot be substituted',()=>{
  const row=o.cases[0],ctx={...row.factsContext,factsBytes:Buffer.from(row.sourcePacket)};
  assert.throws(()=>lowerHir(row.hir,{...ctx,expectedPackageId:'sha256:'+'0'.repeat(64)},row.publication),
    {code:'r03-array-hir-context'});
  /** @type {Array<(h:any)=>void>} */
  const changes=[h=>{h.functions[0].parameters.shift();},h=>{h.functions.shift();},
    h=>{h.exports.pop();},h=>{h.functions[0].parameters[0].elementAnnotationRange.end--;},
    h=>{h.functions[1].body[3].expression.arguments[0].binding=h.functions[1].body[2].binding.id;},
    h=>{const a=h.functions[1].body[3].expression.arguments;[a[0],a[2]]=[a[2],a[0]];},
    h=>{h.functions[1].body[3].expression.signatureHash='sha256:'+'0'.repeat(64);},
    h=>{h.functions[1].body[1].initializer.binding=h.functions[0].parameters[0].id;}];
  for(const change of changes){const h=JSON.parse(JSON.stringify(row.hir));change(h);
    assert.throws(()=>lowerHir(h,ctx,row.publication),{code:'r03-array-hir-invalid'});}
});
