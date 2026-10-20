// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readArrayFactsCandidate} from '../../compiler/array-facts.mjs';
import {buildHir,verifyHir,lowerHir} from '../../compiler/hir.mjs';
test('actual Source complete Array package retains ordinary call and live caller owner',async()=>{
  const o=JSON.parse(await readFile(new URL('./array-core-call-oracle.json',import.meta.url),'utf8'));
  const ctx={...o.factsContext,factsBytes:Buffer.from(o.sourcePacket)};
  const facts=readArrayFactsCandidate(ctx.factsBytes);
  const built=buildHir(facts,ctx,o.publication);assert.equal(built.status,'ok');assert.deepEqual(built.hir,o.hir);
  assert.deepEqual(verifyHir(built.hir,ctx,o.publication),o.hir);
  assert.equal(lowerHir(built.hir,ctx,o.publication),o.core);
});
