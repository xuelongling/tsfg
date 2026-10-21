// SPDX-License-Identifier: MIT
import {pinnedContainer} from './array-test-fixtures.mjs';
// Owned-facts metamorphic positive; never a claimed actual Source execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readArrayFactsCandidate} from '../../compiler/array-facts.mjs';
import {buildHir,verifyHir,lowerHir} from '../../compiler/hir.mjs';
import {fresh} from './array-test-fixtures.mjs';
import {parseArrayCore} from './array-core-structural-oracle.mjs';
const o=JSON.parse(await readFile(new URL('./array-core-call-scalar-alias-oracle.json',import.meta.url),'utf8'));
const currentCore12=await pinnedContainer('./array-core12-legacy-oracle.json',1058670,'5d508df006d7191686dd950744d7bf212466fe562f33c5708e041a9b07ece535');
o.core=currentCore12.cases.find(row=>row.name==='owned-facts-scalar-alias-ordinary-call').core;
const ctx=()=>({...o.factsContext,factsBytes:Buffer.from(o.sourcePacket)});
test('independent owned-facts multi-scalar call and live alias whole Core are exact',()=>{
  assert.equal(o.provenance.sourceExecution,false);assert.equal(o.provenance.productionImportedForExpected,false);
  const facts=readArrayFactsCandidate(ctx().factsBytes),built=buildHir(facts,ctx());
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));assert.deepEqual(built.hir,o.hir);
  assert.deepEqual(verifyHir(fresh(o.hir),ctx()),o.hir);
  assert.equal(lowerHir(built.hir,ctx()),o.core);
  const core=parseArrayCore(o.core),call=core.functions[1].operations[6];
  assert.deepEqual(call.operands,['%v5','%v0','%v1','%v6']);
  assert.deepEqual(core.functions[1].operations.slice(4,6).map(op=>op.attributes.value),['3ff8000000000000','4294967295']);
  assert.deepEqual(o.expectedCallRoots[0].records,[{block:0,instruction:6,registers:[3,4]}]);
});
test('wrong same-type scalar order and dropped alias cannot alter the selected owned HIR',()=>{
  /** @type {Array<(h:any)=>void>} */
  const changes=[h=>{const a=h.functions[1].body[2].expression.arguments;[a[0],a[1]]=[a[1],a[0]];},
    h=>{h.functions[1].body[2].expression.arguments[0]=h.functions[1].body[2].expression.arguments[1];},
    h=>{h.functions[1].body[1].initializer.binding=h.functions[0].body[0].binding.id;},
    h=>{h.functions[1].body.splice(1,1);},
    h=>{h.functions[1].body.at(-1).value.receiver.binding=h.functions[1].body[0].binding.id;}];
  for(const change of changes){const h=fresh(o.hir);change(h);
    assert.throws(()=>lowerHir(h,ctx()),{code:'r03-array-hir-invalid'});}
});

test('existing complete SCC controls reject allocation cycles before Core emission',async()=>{
  const original=JSON.parse(await readFile(new URL('./array-scc-adjacent-oracle.json',import.meta.url),'utf8'));
  for(const name of ['direct-fresh-capability','outgoing-transitive-fresh-capability','spin-wide-local-upper']){
    const row=original.cases.find(row=>row.name===name);assert.ok(row);
    const context={...row.factsContext,factsBytes:Buffer.from(row.packageText)};
    if(name==='spin-wide-local-upper')assert.deepEqual(verifyHir(fresh(row.completeHir),context,row.publicationContext),row.completeHir);
    if(name==='spin-wide-local-upper'){
      const current=await pinnedContainer('./readspan-core12-oracle.json',474847,'ea662dcd137a240a947c1fc3c57d9a17dbed31661e99338a4d76950e5dce9ba0');
      assert.equal(lowerHir(fresh(row.completeHir),context,row.publicationContext),current.cases.find(c=>c.name===name).core);
      assert.throws(()=>lowerHir(fresh(row.completeHir),context),{code:'r03-array-hir-context'});continue;
    }
    assert.throws(()=>lowerHir(fresh(row.completeHir),context,row.publicationContext),error=>{
      const e=/** @type {any} */(error);
      for(const[key,value]of Object.entries(row.expectedLowerDiagnostic))
        assert.deepEqual(e[key],key==='message'&&name==='spin-wide-local-upper'
          ?'Array Core lowering requires nominal Array/scalar calls and a final checked read or f64 direct call':value,name+'/'+key);
      return true;
    });
    assert.throws(()=>lowerHir(fresh(row.completeHir),context),{code:'r03-array-hir-context'});
  }
});
