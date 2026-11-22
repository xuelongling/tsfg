// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {finiteBranchEffects} from '../../compiler/finite-numeric-use.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-logical-method/package.json',import.meta.url));
assert.equal(sha256(factsBytes),'sha256:19b249202a4aaeb82ab731548f09e3a297f50450eaac96e61bf2acab3d51d66b');
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir,plan=buildFiniteCoreDomains(hir,context).definition;
const core=lowerFormalHir(hir,context);
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const fnBody=fn=>core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
const label=block=>/^\s*(\^bb\d+)/u.exec(block)?.[1];
const branch=block=>/cf\.cond_br (%\w+), (\^bb\d+), (\^bb\d+)/u.exec(block);

for(const [name,edge] of /** @type {const} */ ([['selected',0],['early',1]])) {
  test(`${name} keeps the receiver field write on the selected method-call path`,()=>{
    const fn=hir.functions.find(row=>row.name===name);
    const index=fn.body.findIndex(row=>row.kind==='if'),statement=fn.body[index];
    const {left:comparison,right:call}=statement.condition;
    assert.ok(call.receiver);
    const callNode=fn.id+'/body/'+index+'/condition/right';
    const dispatch=plan.carrierCalls.find(row=>row.id===callNode);
    assert.equal(dispatch?.targets.length,1);
    const target=hir.functions.find(row=>row.id===dispatch.targets[0].functionId);
    const targetCore=fnBody(target);
    assert.match(targetCore,/"tsfg_core\.domain\.field_store"/u);

    const text=fnBody(fn),blocks=text.split(/\n\s*(?=\^bb\d+(?:\([^)]*\))?:\s*\n)/u);
    const begin=blocks.find(block=>block.includes('"tsfg_core.domain.presence_equal"')&&block.includes(anchor(comparison.range)));
    const methods=blocks.filter(block=>block.includes('"tsfg_core.domain.method_call"'));
    assert.equal(methods.length,1);
    const [method]=methods;
    assert.ok(begin);
    assert.equal(branch(begin)?.[2+edge],label(method));
    assert.deepEqual(blocks.filter(block=>branch(block)?.slice(2).includes(label(method))),[begin]);
    const callLine=method.split('\n').find(line=>line.includes('"tsfg_core.domain.method_call"'));
    assert.ok(callLine.includes(anchor(call.range))&&callLine.includes(target.id));
    const callResult=/(%\w+) = "tsfg_core\.domain\.method_call"/u.exec(callLine)?.[1];
    assert.ok(callResult);
    assert.equal(branch(method)?.[1],callResult);
    assert.equal(branch(method)?.[3-edge],branch(begin)?.[3-edge]);
    const use=name==='selected'?'/'+index+'/then/0/value/left':'/'+(index+1)+'/value/left';
    const proof=plan.expressions.find(row=>row.id===fn.id+'/body'+use)?.presenceProof;
    assert.deepEqual(proof,{type:sha256('tsfg.type\0null'),equal:false,range:comparison.range});
  });
}

test('the field read on the method-only edge admits exactly its actual first write',()=>{
  const {reads,writes}=plan.fieldReaching;
  const target=hir.functions.find(row=>row.name==='take');
  const selected=hir.functions.find(row=>row.name==='selected');
  const early=hir.functions.find(row=>row.name==='early');
  const versions=path=>reads.find(row=>row.node===path)?.reaching.flatMap(row=>row.versions);
  const methodWrites=writes.filter(row=>row.node.startsWith(target.id+'/')).map(row=>row.id);
  const both=writes.map(row=>row.id).sort();
  assert.equal(methodWrites.length,1);
  assert.equal(both.length,2);
  assert.deepEqual(versions(selected.id+'/body/1/then/0/value/right'),methodWrites);
  assert.deepEqual(versions(selected.id+'/body/2/value'),both);
  assert.deepEqual(versions(early.id+'/body/1/then/0/value'),both);
});

test('the Array read after a required call excludes the short-circuit initialization version',async()=>{
  const bytes=await readFile(new URL('./testdata/finite-logical-method/array-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:ffac8f1687c98b96fff3dfdccac7be54f07683cc60c11ae407bf2a983d6f33bc');
  const facts=readTypedArrayFacts(bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const result=buildHir(facts,context);
  assert.equal(result.status,'ok',JSON.stringify(result.diagnostics));
  const {hir}=result,entry=hir.functions.find(row=>row.name==='fromArray'),callee=hir.functions.find(row=>row.name==='put');
  const {reads,writes}=buildFiniteCoreDomains(hir,context).definition.arrayReaching;
  const required=reads.find(read=>read.node.startsWith(entry.id+'/body/1/then/'));
  const continuing=reads.find(read=>read.node.startsWith(entry.id+'/body/2/value'));
  const update=writes.filter(write=>write.node.startsWith(callee.id+'/')).map(write=>write.id);
  const both=writes.map(write=>write.id).sort();
  assert.equal(update.length,1);
  assert.equal(both.length,2);
  assert.equal(required?.status,'proven');
  assert.equal(continuing?.status,'proven');
  assert.deepEqual(required.versions,update);
  assert.deepEqual(continuing.versions,both);
  assert.match(lowerFormalHir(hir,context),/"tsfg_core\.domain\.array_read"/u);
});

test('grouped call leaves keep their original operand paths in the shared branch analysis',()=>{
  const fn=hir.functions.find(row=>row.name==='selected'),{condition}=fn.body[1];
  const grouped={kind:'group',operand:{...condition,right:{kind:'group',operand:condition.right}}};
  const visits=[];
  assert.ok(finiteBranchEffects(grouped,'condition',{},(leaf,path,state)=>{
    visits.push([leaf.kind,path]);return {yes:state,no:state};
  },(left,right)=>left??right,()=>{}));
  assert.deepEqual(visits,[['binary','condition/operand/left'],['group','condition/operand/right']]);
});

for(const [name,requiredExit] of /** @type {const} */ ([['selected','yes'],['early','no']])) {
  test(`${name} keeps the effect of a negated method on its original short-circuit path`,()=>{
    const fn=hir.functions.find(row=>row.name===name);
    const {condition}=fn.body[1];
    const call=condition.right;
    const negated={kind:'unary',operator:'!',type:call.type,operand:{kind:'group',type:call.type,operand:call}};
    const visits=[];
    const skippedExit=requiredExit==='yes'?'no':'yes';
    const exits=finiteBranchEffects({...condition,right:negated},'condition',[],(leaf,path,state)=>{
      visits.push(path);
      if(leaf===condition.left)return {yes:['yes'],no:['no']};
      assert.equal(leaf,negated);
      assert.equal(leaf.operand.operand,call);
      assert.deepEqual(state,[requiredExit]);
      return {yes:['updated'],no:['updated']};
    },(left,right)=>[...new Set([...left,...right])].sort(),()=>{});
    assert.deepEqual(visits,['condition/left','condition/right']);
    assert.deepEqual(exits?.[requiredExit],['updated']);
    assert.deepEqual(exits?.[skippedExit],[skippedExit,'updated'].sort());
  });
}

test('a negated method whose receiver rebinds a local uses ordinary condition analysis',()=>{
  const fn=hir.functions.find(row=>row.name==='selected');
  const {condition}=fn.body[1];
  const call=condition.right;
  const receiver={...call.receiver,kind:'assignment',target:{binding:'local'},value:call.receiver};
  const right={kind:'unary',operator:'!',type:call.type,operand:{...call,receiver}};
  assert.equal(finiteBranchEffects({...condition,right},'condition',[],()=>assert.fail('call is not eligible'),
    ()=>assert.fail('call is not eligible'),()=>{}),undefined);
});
