// SPDX-License-Identifier: MIT
// Public Source v8 counterexamples, with independently authored fixed maxima.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,printHir,readHir,analyzeArrayCalls,printArrayCalls,readArrayCalls} from '../../compiler/hir.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import manifest from './testdata/typed-array-consumer-v8/semantic-edges.json' with {type:'json'};
const none={read:false,write:false,structural:false};
for(const row of manifest)test('actual v8 semantic edge: '+row.name,async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-consumer-v8/'+row.file,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId};
  const rules=row.name==='override-active-view'?{
    'Base.m':{parameters:{1:none},local:none},
    'Derived.m':{parameters:{1:{...none,structural:true}},local:none},
  }:row.name.startsWith('structural-method')?{
    'View.m':{parameters:{1:none},local:none},'Actual.m':{parameters:{1:{...none,structural:true}},local:none},
  }:{};
  const publication=staticPublication(facts,rules),result=buildHir(facts,context,publication);
  if(row.name.startsWith('density-short-')||['or-alias-density-neighbor','conditional-array-rebind-neighbor','structural-method-after-use'].includes(row.name)) {
    assert.equal(result.status,'ok',JSON.stringify(result.diagnostics));const hir=result.hir;
    assert.deepEqual(readHir(Buffer.from(printHir(hir,context,publication)),context,publication),hir);
    if(row.name==='structural-method-after-use') {
      const report=analyzeArrayCalls(hir,context,publication),call=report.calls.find(call=>hir.functions.find(fn=>fn.id===call.target)?.name==='m');
      const byName=name=>hir.types.find(type=>type.nominalKey?.declarationPath[0]===name);
      const actual=hir.functions.find(fn=>fn.ownerType===byName('Actual').id&&fn.name==='m');
      const view=hir.functions.find(fn=>fn.ownerType===byName('View').id&&fn.name==='m');
      assert.equal(call.target,view.id);assert.equal(call.signatureHash,view.signatureHash);
      assert.ok(call.targets.some(arm=>arm.target===actual.id&&arm.consumedDigest===publication.contracts.find(row=>row.functionId===actual.id).digest));
      assert.equal(publication.contracts.find(row=>row.functionId===view.id).upper.parameters[0].structural,false);
      const caller=hir.functions.find(fn=>fn.name==='read'),effects=report.functions.find(fn=>fn.functionId===caller.id);
      for(const facet of ['derived','effective'])assert.ok(effects[facet].structural.some(owner=>
        owner.kind==='parameter'&&owner.functionId===caller.id&&owner.index===1));
      assert.deepEqual(readArrayCalls(Buffer.from(printArrayCalls(report,hir,context,publication)),hir,context,publication),report);
      const omitted=structuredClone(report);omitted.calls.find(row=>row.target===view.id).targets=
        call.targets.filter(arm=>arm.target!==actual.id);
      assert.throws(()=>readArrayCalls(Buffer.from(JSON.stringify(omitted)),hir,context,publication),{code:'r03-d-array-call-effects-report'});
    }else assert.ok(JSON.stringify(hir).includes('arrayStoreDenseChecked'),'unknown conditional lengths retain checked operations');
    return;
  }
  assert.equal(result.status,'error','conditional old family and possible override maxima must remain live');
  const diagnostic=result.diagnostics[0];assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
  const source=facts.payload.files.find(file=>file.path===diagnostic.primary.sourceId).content;
  const method=row.name==='override-active-view'||row.name==='structural-method-active';
  assert.equal(source.slice(diagnostic.primary.start,diagnostic.primary.end),method
    ?row.name==='override-active-view'?'b.m(a)':'v.m(a)':'a.length=0');
  assert.equal(diagnostic.conflict.sourceKind,method?'fixedCall':'directResize');
  if(method)assert.equal(diagnostic.conflict.parameterIndex,1);
});
