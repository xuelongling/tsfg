// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {copyFieldReachingState,copyFieldReachingAliases} from '../../compiler/finite-field-reaching.mjs';
import capture from './testdata/typed-array-entry/field-call.json' with {type:'json'};

test('actual read-before-call capture stays SSA while a later read follows the real field-writing callee',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/'+capture.file,import.meta.url));
  assert.equal(bytes.length,capture.bytes);assert.equal(sha256(bytes).slice(7),capture.sha256);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  const hir=built.hir,plan=buildFiniteCoreDomains(hir,context).definition,core=lowerFormalHir(hir,context),
    clear=hir.functions.find(fn=>fn.name==='clear');assert.ok(clear);
  const nodeTypes=id=>plan.domains.find(domain=>domain.id===plan.nodes.find(node=>node.id===id).domainId).actualTypes;
  assert.equal(plan.fieldReaching.effects.find(row=>row.functionId===clear.id).writesFields,true);
  for(const name of ['captured','reread']) {
    const fn=hir.functions.find(fn=>fn.name===name);assert.ok(fn);
    const read=plan.fieldReaching.reads.find(row=>row.node.startsWith(fn.id+'/'));assert.ok(read);
    const body=core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0],lines=body.split('\n'),
      access=lines.find(line=>line.includes('"tsfg_core.domain.field_read"')),
      call=lines.find(line=>line.includes('"func.call"')&&line.includes(clear.id)),
      returned=lines.find(line=>line.includes('"func.return"'));
    assert.ok(access);assert.ok(call);assert.ok(returned);assert.equal(lines.filter(line=>line.includes('"func.call"')).length,1);
    if(name==='captured') {
      assert.deepEqual(nodeTypes(read.node),[scalarTypeIds.i32]);
      assert.deepEqual(nodeTypes(fn.id+'/return'),[scalarTypeIds.i32]);
      assert.ok(body.indexOf(access)<body.indexOf(call)&&body.indexOf(call)<body.indexOf(returned));
      const value=/^\s*(%\w+) =/.exec(access);assert.ok(value);assert.ok(returned.includes(value[1]));
      assert.ok(read.reaching.every(row=>row.versions.every(version=>version.startsWith(fn.id+'/'))));
    } else {
      assert.ok(nodeTypes(read.node).includes(sha256('tsfg.type\0undefined')),'official post-call i32 flow cannot erase the real undefined write');
      assert.ok(body.indexOf(call)<body.indexOf(access)&&body.indexOf(access)<body.indexOf(returned));
      assert.ok(read.reaching.length>0);
      assert.ok(read.reaching.every(row=>row.versions.every(version=>version.startsWith(clear.id+'/'))));
    }
  }
});

test('production Field snapshots charge versions and alias bindings before publishing',()=>{
  const state=new Map([['location',new Set(['v1','v2'])]]),aliases=new Map([['a','one'],['b','two']]),
    exhausted=new Error('bounded-work'),cancelled=new Error('cancelled');
  let count=0,published;
  assert.throws(()=>{published=copyFieldReachingState(state,()=>{if(++count>2)throw exhausted;});},error=>error===exhausted);
  assert.equal(published,undefined);assert.equal(state.get('location').size,2);
  count=0;assert.throws(()=>copyFieldReachingAliases(aliases,()=>{if(++count>1)throw exhausted;}),error=>error===exhausted);
  assert.deepEqual([...aliases],[['a','one'],['b','two']]);
  count=0;assert.throws(()=>copyFieldReachingState(state,()=>{if(++count===2)throw cancelled;}),error=>error===cancelled);
  const copy=copyFieldReachingState(state,()=>{});copy.get('location').clear();assert.equal(state.get('location').size,2);
});
