// SPDX-License-Identifier: MIT
// Independent Source cases exercise the real ordinary HIR -> finite plan/SSA.
// No Source execution, backend oracle, or synthesized checked facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildFiniteArrayReaching} from '../../compiler/finite-array-reaching.mjs';
import {finiteFieldEffects} from '../../compiler/finite-field-effects.mjs';
import {finiteCoreGuard} from '../../compiler/finite-core-emitter.mjs';
import {buildFiniteFieldReaching} from '../../compiler/finite-field-reaching.mjs';
import {sha256,scalarName,scalarTypeIds} from '../../compiler/identity.mjs';
import {finitePresence} from '../../compiler/finite-presence.mjs';
import {finiteNormalCoalesce,finiteNormalFlow} from '../../compiler/finite-numeric-use.mjs';
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
    const {hir,context}=await actual(row),plans=buildFiniteCoreDomains(hir,context),plan=plans.definition,
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

    const rhs=run.id+'/body/1/expression/right';
    for(const ordered of [plans.reached,plans.definition]) {
      const actualRhs=ordered.nodes.find(item=>item.id===rhs);
      const carrier=ordered.carrierNodes.find(item=>item.id===rhs);
      assert.ok(actualRhs&&carrier,'the original RHS stays in the lexical inventory');
      const domainOf=item=>ordered.domains.find(value=>value.id===item.domainId);
      assert.ok(domainOf(carrier).actualTypes.length,'the RHS retains its carrier');
      assert.equal(domainOf(actualRhs).actualTypes.length>0,row.nullable,'only possible absence reaches the RHS');
      assert.deepEqual(actualRhs.pending,[]);
    }
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

test('only a definitely selected nullish fallback can stop the following Array read',async()=>{
  const {hir,context}=await actual(expected.cases.find(row=>row.name==='nullish-array-i32'));
  const plan=buildFiniteCoreDomains(hir,context).definition,run=hir.functions.find(fn=>fn.name==='run'),
    [initial,conditional,returned]=run.body,root=run.id+'/body',
    left=root+'/1/expression/left',fallback=root+'/1/expression/right',suffix=root+'/2/value',
    undefinedId=hir.types.find(type=>type.kind==='undefined').id,
    single=type=>plan.domains.find(row=>row.actualTypes.length===1&&row.actualTypes[0]===type).id;
  // Project the checked read from the existing HIR into the fallback.
  for(const {kind,domainId,pending,reachesFallback} of [
    {kind:'absent',domainId:single(undefinedId),pending:[],reachesFallback:true},
    {kind:'present',domainId:single(scalarTypeIds.i32),pending:[],reachesFallback:false},
    {kind:'mixed',domainId:null,pending:[],reachesFallback:true},
    {kind:'pending',domainId:single(undefinedId),pending:['unresolved'],reachesFallback:true},
  ]){
    const nodes=plan.nodes.map(node=>node.id===left&&domainId?{...node,domainId,pending}:node);
    for(const missing of [true,false]){
      const right={...returned.value,index:{...returned.value.index,decimal:missing?'1':'0'}},
        fn={...run,body:[initial,{...conditional,expression:{...conditional.expression,right}},returned]},
        model={...hir,functions:hir.functions.map(row=>row===run?fn:row)},
        reaching=buildFiniteArrayReaching(model,{...plan,nodes},()=>{},()=>true).reaching;
      assert.equal(reaching.reads.find(row=>row.node===fallback)?.status,
        reachesFallback?(missing?'missing':'proven'):'pending',kind);
      assert.equal(reaching.reads.find(row=>row.node===suffix)?.status,
        kind==='absent'&&missing?'pending':'proven',kind);
      assert.ok(reaching.writes.some(row=>row.id===root+'/0/initializer/initial/0/array-version'));
    }
  }
  const store=conditional.expression.right.operand;
  assert.equal(store.kind,'arrayStoreDenseChecked');
  const right={...store,kind:'arrayCompoundAssignment',operator:'+=',
    target:{...store.target,index:{...store.target.index,decimal:'1'}}},
    fn={...run,body:[initial,{...conditional,expression:{...conditional.expression,right}}]},
    model={...hir,functions:hir.functions.map(row=>row===run?fn:row)},
    absent={...plan,nodes:plan.nodes.map(node=>node.id===left?{...node,domainId:single(undefinedId)}:node)},
    optional=buildFiniteArrayReaching(model,plan,()=>{},()=>true),
    required=buildFiniteArrayReaching(model,absent,()=>{},()=>true);
  assert.deepEqual(required.reaching.reads,optional.reaching.reads);
  assert.deepEqual(required.reaching.writes,optional.reaching.writes);
  assert.equal(required.reaching.reads.find(row=>row.node===fallback+'/old-value')?.status,'missing');
  assert.deepEqual([...optional.terminalReads??[]],[]);
  assert.deepEqual([...required.terminalReads??[]],[fallback+'/old-value']);
});

function groupedBoolean(operand) {
  const outer={kind:'group',type:scalarTypeIds.bool,range:operand.range};
  return {...outer,operand:{...outer,operand}};
}

test('a direct parenthesized Core guard keeps the literal and branch anchors',()=>{
  const literal={kind:'boolean',value:false,type:scalarTypeIds.bool,range:{start:12,end:17},domainNode:'guard/operand/operand'};
  const group={...groupedBoolean(literal),range:{start:10,end:19}};
  let work=0;
  const charge=()=>{work++;};
  assert.deepEqual(finiteCoreGuard(group,charge),{...literal,range:group.range,literalRange:literal.range});
  assert.equal(work,2);
  const assertion=groupedBoolean({kind:'assertType',operand:literal,range:{start:12,end:28}});
  const alias=groupedBoolean({kind:'reference',binding:'flag',range:{start:12,end:16}});
  for(const value of [assertion,alias])assert.equal(finiteCoreGuard(value,charge),value);
});

test('parenthesized Boolean short circuit keeps lexical field writes and selects the reached version',async()=>{
  const {hir,context}=await actual(expected.cases.find(row=>row.memory==='field'));
  const plan=buildFiniteCoreDomains(hir,context).definition,run=hir.functions.find(fn=>fn.name==='run');
  const [initial,conditional,returned]=run.body,original=conditional.expression;
  assert.equal(original.operator,'??');assert.equal(initial.expression.kind,'fieldAssignment');
  const rhsPath=run.id+'/body/1/expression/right',rhsOperand=rhsPath+'/left';
  const rhsWrite=plan.fieldReaching.writes.find(row=>row.node.startsWith(rhsPath));
  assert.ok(rhsWrite);
  const first=run.id+'/body/0/expression/value',second=rhsOperand+rhsWrite.node.slice(rhsPath.length);
  const moveFields=rows=>rows.map(row=>row.id.startsWith(rhsPath+'/')?{...row,id:rhsOperand+row.id.slice(rhsPath.length)}:row);
  const modelPlan={...plan,fields:moveFields(plan.fields),carrierFields:moveFields(plan.carrierFields)};
  // Component analysis of checked field operations under a literal Boolean guard.
  for(const [operator,literal,takesRhs] of [['&&',false,false],['||',true,false],['&&',true,true],['||',false,true]]){
    const left=groupedBoolean({kind:'boolean',value:literal,type:scalarTypeIds.bool,range:original.left.range});
    const right={kind:'binary',operator:'===',left:original.right,right:initial.expression.value,type:scalarTypeIds.bool,range:original.right.range};
    const expression={...original,kind:'shortCircuit',operator,left,right,type:scalarTypeIds.bool};
    const fn={...run,body:[initial,{...conditional,expression},returned]};
    const model={...hir,functions:hir.functions.map(row=>row.id===run.id?fn:row)};
    const reaching=buildFiniteFieldReaching(model,modelPlan,()=>{});
    assert.deepEqual(reaching.writes.filter(row=>row.id.startsWith(run.id+'/')).map(row=>row.node),[first,second]);
    const read=reaching.reads.find(row=>row.node===run.id+'/body/2/value');
    assert.deepEqual(read?.reaching.flatMap(row=>row.sources),[takesRhs?second:first]);
  }
});

test('a parenthesized literal if keeps both field stores and selects the reached version',async()=>{
  const {hir,context}=await actual(expected.cases.find(row=>row.memory==='field'));
  const plan=buildFiniteCoreDomains(hir,context).definition,run=hir.functions.find(fn=>fn.name==='run');
  const [initial,conditional,returned]=run.body,original=conditional.expression,root=run.id+'/body/';
  const oldPath=root+'1/expression/right',rhsWrite=plan.fieldReaching.writes.find(row=>row.node.startsWith(oldPath));
  assert.ok(rhsWrite);
  for(const arm of ['then','else']) {
    const rhsPath=root+'1/'+arm+'/0/expression',first=root+'0/expression/value',second=rhsPath+rhsWrite.node.slice(oldPath.length);
    const move=rows=>rows.map(row=>row.id.startsWith(oldPath+'/')?{...row,id:rhsPath+row.id.slice(oldPath.length)}:row);
    const modelPlan={...plan,fields:move(plan.fields),carrierFields:move(plan.carrierFields)};
    for(const taken of [false,true]) {
      const condition=groupedBoolean({kind:'boolean',value:taken===(arm==='then'),type:scalarTypeIds.bool,range:original.left.range});
      const branch={kind:'if',range:conditional.range,condition,then:[],else:[],[arm]:[{...conditional,expression:original.right}]};
      const fn={...run,body:[initial,branch,returned]},model={...hir,functions:hir.functions.map(row=>row.id===run.id?fn:row)};
      const reaching=buildFiniteFieldReaching(model,modelPlan,()=>{});
      assert.deepEqual(reaching.writes.filter(row=>row.id.startsWith(root)).map(row=>row.node),[first,second]);
      const read=reaching.reads.find(row=>row.node===root+'2/value');
      assert.deepEqual(read?.reaching.flatMap(row=>row.sources),[taken?second:first]);
    }
  }
});

test('parenthesized false while preserves the reached field version and records the lexical loop store',async()=>{
  const {hir,context}=await actual(expected.cases.find(row=>row.memory==='field'));
  const plan=buildFiniteCoreDomains(hir,context).definition,run=hir.functions.find(fn=>fn.name==='run');
  const [initial,conditional,returned]=run.body,original=conditional.expression,root=run.id+'/body/';
  const oldPath=root+'1/expression/right',loopPath=root+'1/body/0/expression',
    rhsWrite=plan.fieldReaching.writes.find(row=>row.node.startsWith(oldPath));
  assert.ok(rhsWrite);
  const first=root+'0/expression/value',second=loopPath+rhsWrite.node.slice(oldPath.length);
  const move=rows=>rows.map(row=>row.id.startsWith(oldPath+'/')?{...row,id:loopPath+row.id.slice(oldPath.length)}:row);
  const modelPlan={...plan,fields:move(plan.fields),carrierFields:move(plan.carrierFields)};
  const literalFalse={kind:'boolean',value:false,type:scalarTypeIds.bool,range:original.left.range},
    unknown={kind:'binary',operator:'===',left:original.left,right:initial.expression.value,type:scalarTypeIds.bool,range:original.left.range};
  for(const condition of [literalFalse,unknown]) {
    const loop={kind:'while',range:conditional.range,condition:groupedBoolean(condition),body:[{...conditional,expression:original.right}]};
    const fn={...run,body:[initial,loop,returned]},model={...hir,functions:hir.functions.map(row=>row.id===run.id?fn:row)};
    const reaching=buildFiniteFieldReaching(model,modelPlan,()=>{});
    assert.deepEqual(reaching.writes.filter(row=>row.id.startsWith(root)).map(row=>row.node),[first,second]);
    const read=reaching.reads.find(row=>row.node===root+'2/value');
    assert.deepEqual(read?.reaching.flatMap(row=>row.sources),condition===literalFalse?[first]:[]);
    const nestedLoop={...loop,condition:unknown,body:[]};
    const loopOnly={...fn,body:[{kind:'block',range:initial.range,body:[]},{...loop,body:[...loop.body,nestedLoop]}]};
    const {effects,cyclicFunctions}=finiteFieldEffects(model,modelPlan,[loopOnly],new Map(),()=>{},new Map(),false);
    assert.equal(cyclicFunctions.has(run.id),condition===unknown);
    assert.equal(effects.get(run.id).unknown,condition===unknown);
    assert.equal(effects.get(run.id).writes,true,'the lexical write summary stays conservative');
  }
});

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

test('nullish completion waits for the fallback only on absent paths',()=>{
  for(const row of [
    {left:['present'],pending:false,fallback:false,right:false,normal:true},
    {left:['undefined'],pending:false,fallback:false,right:true,normal:false},
    {left:['null'],pending:false,fallback:true,right:true,normal:true},
    {left:['undefined','present'],pending:false,fallback:false,right:true,normal:true},
    {left:[],pending:true,fallback:false,right:true,normal:true},
  ]) {
    const nodes=new Map(),flow=finiteNormalFlow(true,()=>{},nodes),reached=new Set();
    const emit=(id,gate,types,dependencies=[],pending=false)=>{
      flow.entry(id,gate);nodes.set(id,{actual:new Set(),pending:new Set()});flow.finish(id,dependencies);
      flow.publish(id,()=>{
        reached.add(id);
        const value=nodes.get(id);
        for(const type of types)value.actual.add(type);
        if(pending)value.pending.add('unresolved');
        flow.changed(id);
      });
      return id;
    };
    const result=finiteNormalCoalesce(flow,flow.always,(id,gate)=>id==='left'?
      emit(id,gate,row.left,[],row.pending):emit(id,gate,row.fallback?['present']:[]),
      type=>type==='null'||type==='undefined');
    emit('result',flow.always,['present'],result.dependencies);
    flow.seal();
    assert.ok(nodes.has('right'),'lexical fallback');
    assert.equal(reached.has('right'),row.right,'fallback reachability');
    assert.equal(reached.has('result'),row.normal,'normal continuation');
  }
});

test('the actual coalesce solver preserves cancellation/work first failure and publishes no partial plan',async()=>{
  const {hir,context}=await actual(expected.cases[0]);let result;
  assert.throws(()=>{result=buildFiniteCoreDomains(hir,context,{work:1});},/work limit/);assert.equal(result,undefined);
  assert.throws(()=>{result=buildFiniteCoreDomains(hir,context,{cancelled:()=>true});},/cancelled/);assert.equal(result,undefined);
});
