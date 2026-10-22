// SPDX-License-Identifier: MIT
// Independent Source/spec data, rawSHA256 01439b1b237fec7f447fd401acc129f41c96805399362d73d6c2155524ea49ad.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256} from '../../compiler/identity.mjs';
import expected from './testdata/typed-array-entry/member-authority-expected.json' with {type:'json'};

function attribute(line,key) {
  const selected=new RegExp(key+' = ("(?:[^"\\\\]|\\\\.)*")').exec(line);
  assert.ok(selected,key);return JSON.parse(selected[1]);
}
test('actual formal producer matches independent actual-member and static permission expectations',async t=>{
  let methods=0,fields=0;
  for(const [index,input] of expected.inputs.entries())await t.test(String(index),async()=>{
    // The retained absolute path is provenance. Reads remain repository-local
    // after integration and do not depend on an old implementation worktree.
    const at=input.path.indexOf('/tests/');assert.ok(at>=0);
    const bytes=await readFile(new URL('../../'+input.path.slice(at+1),import.meta.url));
    assert.equal(bytes.length,input.bytes);assert.equal(sha256(bytes),input.sha256);
    const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
      factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
    const hir=built.hir,plan=buildFiniteCoreDomains(hir,context).definition,core=lowerFormalHir(hir,context),
      types=new Map(hir.types.map(type=>[type.id,type]));
    const domain=id=>plan.domains.find(row=>row.id===plan.nodes.find(row=>row.id===id).domainId);
    for(const sample of expected.cases.filter(row=>row.input===index)) {
      const fn=hir.functions.find(row=>row.id===sample.functionId);assert.ok(fn);
      if('dispatch' in sample) {
        const call=plan.calls.find(row=>row.id.startsWith(fn.id+'/')&&row.member===sample.staticTargetMember);assert.ok(call);
        assert.equal(call.viewType,sample.staticReceiver);
        const keys=['actualType','functionId','signatureHash'],select=row=>Object.fromEntries(keys.map(key=>[key,row[key]]));
        assert.deepEqual(call.targets.map(select),sample.dispatch.map(select));
        assert.deepEqual(domain(call.id).actualTypes,sample.payload.actualResultTypes);
        for(const target of sample.dispatch) {
          assert.equal(types.get(target.actualType).runtimeKey,target.runtimeKey);
          assert.equal(hir.functions.find(row=>row.id===target.functionId).ownerType,target.declaringType);
          const path=[];for(let type=types.get(target.actualType);type;type=types.get(type.base))path.push(type.id);
          assert.deepEqual(path,target.nominalPath);
        }
        const line=core.split('\n').find(line=>line.includes('"tsfg_core.domain.method_call"')&&line.includes('member = "'+sample.staticTargetMember+'"'));
        assert.ok(line);assert.deepEqual(JSON.parse(attribute(line,'dispatch')),call.targets);
        assert.ok(line.includes('tsfg_source.start = '+sample.origin.start+' : i64'));
        assert.ok(line.includes('tsfg_source.end = '+sample.origin.end+' : i64'));methods++;
      } else {
        assert.deepEqual(domain(fn.id+'/binding/'+sample.publishedEntry.binding).actualTypes,sample.publishedEntry.compatibleActualTypes);
        assert.deepEqual(domain(fn.id+'/binding/'+sample.alias.binding).actualTypes,sample.alias.preserveActualTypes);
        for(const operation of sample.fieldOperations) {
          const kind=operation.id.includes('store')?'store':'read',selection=plan.fields.find(row=>row.kind===kind&&row.member===operation.member);assert.ok(selection);
          assert.equal(selection.viewType,operation.receiverView);
          assert.deepEqual(selection.targets,operation.fieldDispatch.map(({actualType,fieldId,fieldType})=>({actualType,fieldId,fieldType})));
          const target=types.get(operation.receiverView).fields.find(field=>field.id===operation.member);
          assert.equal(target.readonly,operation.targetDeclaredReadonly);assert.equal(!target.readonly,operation.staticWriteAllowed);
          for(const field of operation.fieldDispatch) {
            assert.equal(types.get(field.actualType).runtimeKey,field.runtimeKey);
            assert.equal(types.get(field.actualType).fields.find(row=>row.id===field.fieldId).readonly,field.actualDeclaredReadonly);fields++;
          }
          const line=core.split('\n').find(line=>line.includes('"tsfg_core.domain.field_'+kind+'"'));
          assert.ok(line);assert.deepEqual(JSON.parse(attribute(line,'field_dispatch')),selection.targets);
          assert.ok(line.includes('tsfg_source.start = '+operation.origin.start+' : i64'));
          assert.ok(line.includes('tsfg_source.end = '+operation.origin.end+' : i64'));
        }
      }
    }
  });
  assert.deepEqual({methods,fields},{methods:2,fields:4});
  // Nine hostile/permission boundaries are independent expected data. This
  // producer comparison does not claim to have executed the C++ negative cases.
  assert.equal(expected.negativeBoundaries.length,9);
});
