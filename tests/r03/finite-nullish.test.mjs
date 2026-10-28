// SPDX-License-Identifier: MIT
// Independent Source cases exercise the real ordinary HIR -> finite plan/SSA.
// No Source execution, backend oracle, or synthesized checked facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256,scalarName} from '../../compiler/identity.mjs';
import {finitePresence} from '../../compiler/finite-presence.mjs';
const expected=JSON.parse(await readFile('E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/finite-nullish-expected.json','utf8'));
async function actual(row) {
  const bytes=await readFile(row.packet.path);assert.equal(bytes.length,row.packet.bytes);
  assert.equal(sha256(bytes).slice(7),row.packet.sha256);
  const source=await readFile(row.source.path);assert.equal(source.toString(),row.sourceText);
  assert.equal(sha256(source).slice(7),row.source.sha256);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:row.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));return {hir:built.hir,context};
}
for(const row of expected.cases) {
  test(row.name+' preserves possible preceding writes and the original payload',async()=>{
    const {hir,context}=await actual(row),plan=buildFiniteCoreDomains(hir,context).definition,
      run=hir.functions.find(fn=>fn.name==='run'),expressions=new Map(plan.expressions.map(item=>[item.id,item])),
      reads=row.memory==='array'?plan.arrayReaching.reads:plan.fieldReaching.reads,
      read=reads.find(item=>item.node.startsWith(run.id+'/')&&expressions.get(item.node)?.range.start===row.read[0]);
    assert.ok(read,'final read retains its original Source range');
    const sources=row.memory==='array'?read.sources:read.reaching.flatMap(item=>item.sources),
      ranges=[...new Set(sources.map(id=>{const expression=expressions.get(id);assert.ok(expression,'real SSA source');
        return JSON.stringify([expression.range.start,expression.range.end]);}))].map(value=>JSON.parse(value));
    assert.deepEqual(ranges.sort((a,b)=>a[0]-b[0]),row.sources,'a conditional RHS write is not a must write');
    const node=plan.nodes.find(item=>item.id===read.node),domain=plan.domains.find(item=>item.id===node.domainId);
    assert.deepEqual(domain.actualTypes.map(id=>scalarName(id)??hir.types.find(type=>type.id===id)?.kind).sort(),row.types);
    assert.deepEqual(node.pending,[],'only genuinely proved finite read sources publish actuals');
  });
  test(row.name+' lowers nullish effects through real presence control, not eager scalar binary',async()=>{
    const {hir,context}=await actual(row),core=lowerFormalHir(hir,context),run=hir.functions.find(fn=>fn.name==='run'),
      body=core.split('  func.func @"f'+run.id.slice(7)+'"')[1].split('\n  }')[0],
      store=row.memory==='array'?'"tsfg_core.domain.array_store"':'"tsfg_core.domain.field_store"',
      lines=body.split('\n'),branch=lines.findIndex(line=>line.includes('cf.cond_br')),
      rhs=lines.findIndex(line=>line.includes(store)&&line.includes('tsfg_source.start = '+
        (row.memory==='field'?72:row.name==='nullish-array-string'?91:row.nullable?63:53)+' : i64'));
    assert.doesNotMatch(body,/"tsfg_core\.undefined"/,'?? has no scalar arithmetic operation mapping');
    if(row.nullable){assert.ok(branch>=0,'unknown presence keeps a skipped RHS path');assert.ok(rhs>branch,'RHS effect is in its guarded continuation');
      assert.match(body,/"tsfg_core.domain.presence_equal"/,'zero/empty String are not Boolean false shortcuts');
      const stores=lines.filter(line=>line.includes(store)&&line.includes('tsfg_source.start = '+(row.memory==='field'?72:row.name==='nullish-array-string'?91:63)+' : i64'));
      assert.equal(stores.length,1,'the one Source RHS is emitted only once');}
    else assert.ok(rhs<0||branch>=0&&rhs>branch,'a proven nonabsence left never executes an eager RHS store');
    assert.match(body,row.memory==='array'?/"tsfg_core.domain.array_read"/:/"tsfg_core.domain.field_read"/);
  });
}

test('finite presence charges its proof snapshot and preserves missing/pending as two possible paths',()=>{
  // A bounded proof-state component, not a synthesized Source program.
  const plan={nodes:[{id:'left',domainId:'D',pending:[]}],domains:[{id:'D',actualTypes:['I']}]},
    types=new Map([['I',{kind:'scalar'}]]),first=new Error('work-limit');
  let count=0,published;
  assert.throws(()=>{published=finitePresence(plan,types,()=>{if(++count>1)throw first;});},error=>error===first);
  assert.equal(published,undefined);
  const presence=finitePresence(plan,types,()=>{});assert.deepEqual(presence('left'),{present:true,absent:false});
  assert.deepEqual(presence('missing'),{present:true,absent:true});
});

test('the actual coalesce solver preserves cancellation/work first failure and publishes no partial plan',async()=>{
  const {hir,context}=await actual(expected.cases[0]);let result;
  assert.throws(()=>{result=buildFiniteCoreDomains(hir,context,{work:1});},/work limit/);assert.equal(result,undefined);
  assert.throws(()=>{result=buildFiniteCoreDomains(hir,context,{cancelled:()=>true});},/cancelled/);assert.equal(result,undefined);
});
