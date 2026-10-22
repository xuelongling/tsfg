// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256,scalarTypeIds} from '../../compiler/identity.mjs';
import capture from './testdata/typed-array-entry/method-view.json' with {type:'json'};

test('actual M12 method views preserve argument effects and adapt only the selected callable ABI',async t=>{
  for(const sample of capture.cases)await t.test(sample.kind,async()=>{
    const bytes=await readFile(new URL('./testdata/typed-array-entry/'+sample.file,import.meta.url));
    assert.equal(bytes.length,sample.bytes);assert.equal(sha256(bytes).slice(7),sample.sha256);
    const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
      factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
    const hir=built.hir,implType=hir.types.find(type=>type.nominalKey?.declarationPath[0]==='Impl'),
      viewType=hir.types.find(type=>type.nominalKey?.declarationPath[0]==='View'),
      implementation=hir.functions.find(fn=>fn.ownerType===implType.id&&fn.name==='m'),
      header=hir.functions.find(fn=>fn.ownerType===viewType.id&&fn.name==='m'),run=hir.functions.find(fn=>fn.name==='run');
    const plan=buildFiniteCoreDomains(hir,context).definition,abi=plan.abi.find(row=>row.functionId===implementation.id),
      call=plan.calls.find(row=>row.id.startsWith(run.id+'/')&&row.member===header.id);
    assert.equal(implementation.parameters.length,1,'actual implementation has only its real receiver');
    assert.equal(abi.parameters.length,1);assert.deepEqual(call.targets.map(row=>row.functionId),[implementation.id]);
    const result=plan.domains.find(row=>row.id===plan.nodes.find(row=>row.id===call.id).domainId);
    assert.deepEqual(result.actualTypes,[scalarTypeIds.i32]);
    const core=lowerFormalHir(hir,context),body=core.split('  func.func @"f'+run.id.slice(7)+'"')[1].split('\n  }')[0],
      dispatch=body.split('\n').find(line=>line.includes('"tsfg_core.domain.method_call"'));
    assert.ok(dispatch);assert.ok(dispatch.includes(implementation.id));assert.ok(dispatch.includes(abi.id));
    assert.ok(dispatch.includes(' = "tsfg_core.domain.method_call"'),'actual i32 result exists before any void discard');
    if(sample.kind==='fewer-parameters') {
      const effect=hir.functions.find(fn=>fn.name==='effect'),lines=body.split('\n').filter(line=>line.includes('"func.call"'));
      assert.equal(header.parameters.length,2);assert.equal(lines.length,1);
      assert.ok(lines[0].includes('callee = @"f'+effect.id.slice(7)+'"'));assert.ok(body.indexOf(lines[0])<body.indexOf(dispatch));
      const value=/^\s*(%\w+) =/.exec(lines[0]);assert.ok(value);assert.ok(dispatch.includes(value[1]));
      const effectBody=core.split('  func.func @"f'+effect.id.slice(7)+'"')[1].split('\n  }')[0];
      assert.equal(effectBody.split('"tsfg_core.domain.array_store"').length-1,1);
      assert.ok(effectBody.indexOf('"tsfg_core.domain.array_read"')<effectBody.indexOf('"tsfg_core.domain.array_store"'));
    } else {
      const returned=body.split('\n').filter(line=>line.includes('"func.return"'));
      assert.equal(hir.types.find(type=>type.id===header.returnType.id).kind,'void');
      assert.equal(returned.length,1);assert.match(returned[0],/"func.return"\(\).*: \(\) -> \(\)/);
      assert.ok(body.indexOf(dispatch)<body.indexOf(returned[0]));
    }
  });
});
