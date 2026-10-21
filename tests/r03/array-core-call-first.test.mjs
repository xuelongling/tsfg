// SPDX-License-Identifier: MIT
import {pinnedContainer} from './array-test-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedArrayCore13 } from './array-core13-literal.mjs';
import {readFile} from 'node:fs/promises';
import {readArrayFactsCandidate} from '../../compiler/array-facts.mjs';
import {buildHir,verifyHir,lowerHir} from '../../compiler/hir.mjs';
test('actual Source complete Array package retains ordinary call and live caller owner',async()=>{
  const o=JSON.parse(await readFile(new URL('./array-core-call-oracle.json',import.meta.url),'utf8'));
const currentCore12=await pinnedContainer('./array-core12-legacy-oracle.json',1058670,'5d508df006d7191686dd950744d7bf212466fe562f33c5708e041a9b07ece535');
o.core=currentCore12.cases.find(row=>row.name==='actual-source-scalar-ordinary-call').core;
  const ctx={...o.factsContext,factsBytes:Buffer.from(o.sourcePacket)};
  const facts=readArrayFactsCandidate(ctx.factsBytes);
  const built=buildHir(facts,ctx,o.publication);assert.equal(built.status,'ok');assert.deepEqual(built.hir,o.hir);
  assert.deepEqual(verifyHir(built.hir,ctx,o.publication),o.hir);
  assert.equal(lowerHir(built.hir,ctx,o.publication),expectedArrayCore13(built.hir,ctx,o.publication));
});
