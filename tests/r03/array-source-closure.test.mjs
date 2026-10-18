// SPDX-License-Identifier: MIT
// These are self-consistent hostile selected packets, never successful Source oracles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { verifyHir } from '../../compiler/hir.mjs';
import { fixtures, fresh, wire, failure, reframeFacts, replaceSource, hirError } from './array-test-fixtures.mjs';

/** @param {any} packet */
function reject(packet) {
  const e=failure(()=>readArrayFactsCandidate(wire(packet)));
  assert.equal(e.code,'r03-array-facts-input');assert.equal(e.ruleId,'r01-input-boundary');
  assert.equal(e.phase,'input');assert.equal(e.primary,undefined);
}

test('25b complete source windows reject independently re-signed omissions that table/hash checks cannot detect',async t=>{
  const row=(await fixtures())[0];
  assert.deepEqual(readArrayFactsCandidate(Buffer.from(row.facts.packageText)),row.facts.package);
  /** @type {Array<[string,(p:any)=>void]>} */
  const changes=[
    ['unrepresented last function',p=>{
      const removed=p.payload.functions.pop().id;
      p.payload.exports=p.payload.exports.filter(e=>e.functionId!==removed);
      reframeFacts(p);
    }],
    ['unrepresented middle const',p=>{
      const fn=p.payload.functions[0],removed=fn.body[1].binding;
      fn.body.splice(1,1);fn.bindings=fn.bindings.filter(b=>b.id!==removed);reframeFacts(p);
    }],
    ['unrepresented original array element',p=>{
      p.payload.functions[0].body[0].initializer.elements.splice(4,1);reframeFacts(p);
    }],
    ['unrepresented inserted call',p=>{
      const n=p.payload.functions[0].body[0].range.end;replaceSource(p,n,n,' ignored();');
    }],
    ['unrepresented inserted statement',p=>{
      const n=p.payload.functions[0].body[0].range.end;replaceSource(p,n,n,' const omitted: f64[] = [7];');
    }],
    ['unrepresented inserted array element',p=>{
      const n=p.payload.functions[0].body[0].initializer.elements[0].range.end;replaceSource(p,n,n,', 7');
    }],
    ['split index token is not concatenation',p=>{
      const index=p.payload.functions[0].body.at(-1).value.index;
      replaceSource(p,index.range.start,index.range.end,'1/**/2');
      index.token='12';index.decimal='12';reframeFacts(p);
    }],
    ['return newline is ASI, not a returned checked access',p=>{
      const n=p.payload.functions[0].body.at(-1).range.start+'return'.length;replaceSource(p,n,n,'\n');
    }],
  ];
  for(const [name,mutate]of changes)await t.test(name,()=>{
    const p=fresh(row.facts.package);mutate(p);reject(p);
    assert.equal(p.requestId.startsWith('sha256:'),true);
    // An attacker can choose a matching new expected ID; selected facts must
    // still reject before any HIR traversal or location can be trusted.
    const ctx={family:'tsfg.array-facts-context-candidate',version:1,expectedPackageId:p.packageId,factsBytes:wire(p)};
    let traps=0;
    const hostile=new Proxy({},{get(){traps++;throw Error('HIR sentinel');},ownKeys(){traps++;throw Error('HIR keys sentinel');}});
    assert.deepEqual(failure(()=>verifyHir(hostile,ctx)),hirError('context'));assert.equal(traps,0);
  });
});

test('25b complete source windows admit represented operations with legal inter-statement comments',async()=>{
  const row=(await fixtures())[0],p=fresh(row.facts.package);
  const n=p.payload.functions[0].body[0].range.end;
  replaceSource(p,n,n,' /* lexical gap is only trivia */');
  assert.deepEqual(readArrayFactsCandidate(wire(p)),p);
});
