// SPDX-License-Identifier: MIT
// Official packets enter through the ordinary public HIR/SSA API. A fixed
// publication is authority for a call boundary, not an observed runtime value.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteActualDomains,buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildFiniteFieldPhases} from '../../compiler/finite-field-phases.mjs';
import {buildTypedArrayBacking,writeTypedArrayBacking} from '../../compiler/typed-array-backing.mjs';
import {buildTypedFieldBacking,writeTypedFieldBacking} from '../../compiler/typed-field-backing.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {sha256} from '../../compiler/identity.mjs';
import manifest from './testdata/typed-array-consumer-v8/manifest.json' with {type:'json'};

const none={read:false,write:false,structural:false};
const rules={touch:{parameters:{0:{read:true,write:false,structural:false}},local:none},
  even:{parameters:{0:{read:true,write:false,structural:false}},local:none},
  odd:{parameters:{0:{read:true,write:false,structural:false}},local:none},
  read:{parameters:{0:{read:true,write:false,structural:false}},local:none}};
for(const name of ['fixed-call-upper','box-view-return','generic-union-parameter-scc'])
test('real fixed5 publication reaches finite analysis/backing/ordinary SSA: '+name,async()=>{
  const source=manifest.find(row=>row.name===name);assert.ok(source);
  const bytes=await readFile(new URL('./testdata/typed-array-consumer-v8/'+source.file,import.meta.url));
  assert.equal(sha256(bytes).slice(7),source.sha256);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},publication=staticPublication(facts,name==='box-view-return'?{}:rules),
    options={publicationContext:publication},built=buildHir(facts,context,publication);
  assert.equal(publication.version,5);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=built.hir;assert.deepEqual(verifyHir(hir,context,publication),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context,publication)),context,publication),hir);
  const plans=buildFiniteCoreDomains(hir,context,options),actual=buildFiniteActualDomains(hir,context,options);
  assert.equal(plans.definition.inputIdentity,hir.inputIdentity);assert.deepEqual(actual.nodes,plans.reached.nodes);
  const array=buildTypedArrayBacking(hir,context,options),field=buildTypedFieldBacking(hir,context,options);
  assert.ok(array.arrays.length);assert.equal(writeTypedArrayBacking(hir,context,options).subarray(0,8).toString(),'TSGARR01');
  assert.equal(writeTypedFieldBacking(hir,context,options).subarray(0,8).toString(),'TSGFLD01');
  const phases=buildFiniteFieldPhases(hir,context,options);assert.ok(Array.isArray(phases));
  if(name==='box-view-return'){assert.ok(field.cells.length);assert.ok(phases.length);}
  const core=lowerFormalHir(hir,context,publication);assert.equal(lowerHir(hir,context,publication),core);
  assert.match(core,/"tsfg_core.domain.array_read"/);
  if(name!=='generic-union-parameter-scc')assert.match(core,/"tsfg_core.domain.read_span"/);
  else assert.match(core,/"func.call"/);
  const bad={...publication,expectedDigest:'sha256:'+'0'.repeat(64)};
  for(const consume of [()=>lowerFormalHir(hir,context,bad),()=>buildFiniteCoreDomains(hir,context,{publicationContext:bad}),
    ()=>writeTypedArrayBacking(hir,context,{publicationContext:bad}),()=>writeTypedFieldBacking(hir,context,{publicationContext:bad}),
    ()=>buildFiniteFieldPhases(hir,context,{publicationContext:bad})])assert.throws(consume,/publication|digest|context/i);
  assert.throws(()=>buildFiniteActualDomains(hir,context,{...options,work:1}),/work limit/);
  assert.throws(()=>buildFiniteCoreDomains(hir,context,{...options,cancelled:()=>true}),/cancelled/);
  if(name==='fixed-call-upper') {
    const broad=staticPublication(facts);
    const rejected=buildHir(facts,context,broad);assert.equal(rejected.status,'error');
    assert.equal(rejected.diagnostics[0].code,'r03-d-readspan-structural-conflict');
    assert.throws(()=>lowerFormalHir(hir,context,broad),/r03-/,
      'fixed call upper bound cannot be replaced by the narrower reached body effects');
  }
});
