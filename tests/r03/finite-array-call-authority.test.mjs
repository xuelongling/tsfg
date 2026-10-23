// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import manifest from './testdata/typed-array-consumer-v8/manifest.json' with {type:'json'};
import edges from './testdata/typed-array-consumer-v8/semantic-edges.json' with {type:'json'};

const none={read:false,write:false,structural:false};
async function actual(name,rules={}) {
  const row=[...manifest,...edges].find(row=>row.name===name);assert.ok(row);
  const bytes=await readFile(new URL('./testdata/typed-array-consumer-v8/'+row.file,import.meta.url));
  assert.equal(sha256(bytes).slice(7),row.sha256);const facts=readTypedArrayFacts(bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts,rules),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));return {hir:built.hir,context,publication};
}
function authority(core) {
  const token=core.match(/tsfg_core\.array_call_authority = ("(?:\\.|[^"\\])*")/);
  assert.ok(token,'ordinary emitter must retain the complete fixed authority');
  return JSON.parse(JSON.parse(token[1].replaceAll('\\22','\\"').replaceAll('\\5C','\\\\')));
}
for(const name of ['after-last-use','box-view-return','structural-method-after-use','generic-union-parameter-scc'])
test('ordinary emitter retains full fixed authority: '+name,async()=>{
  const rules=name==='generic-union-parameter-scc'?Object.fromEntries(['even','odd','read'].map(name=>[name,
    {parameters:{0:{read:true,write:false,structural:false}},local:none}])):{};
  const {hir,context,publication}=await actual(name,rules),core=lowerFormalHir(hir,context,publication);
  assert.deepEqual(authority(core),{rootFile:hir.rootFile,publicationContext:publication});
  assert.equal(canonical(authority(core).publicationContext),canonical(publication));
});
test('empty callee body cannot narrow the published upper; malformed authority is rejected',async()=>{
  const rules={touch:{parameters:{0:{read:true,write:false,structural:false}},local:none}};
  const {hir,context,publication}=await actual('fixed-call-upper',rules);
  const touch=hir.functions.find(row=>row.name==='touch');assert.equal(touch.body.length,1);assert.equal(touch.body[0].kind,'return');
  assert.equal(publication.contracts.find(row=>row.functionId===touch.id).upper.parameters[0].read,true);
  const core=lowerFormalHir(hir,context,publication);assert.deepEqual(authority(core).publicationContext,publication);
  for(const mutate of [p=>p.contracts.pop(),p=>p.contracts.push(p.contracts[0]),p=>p.contracts[0].signatureHash='sha256:'+'0'.repeat(64),
    p=>p.contracts[0].upper.parameters.push({index:7,...none}),p=>p.contracts[0].digest='sha256:'+'0'.repeat(64),
    p=>p.scopeDigest='sha256:'+'0'.repeat(64),p=>p.expectedDigest='sha256:'+'0'.repeat(64),p=>p.contracts=[]]) {
    const bad=structuredClone(publication);mutate(bad);assert.throws(()=>lowerFormalHir(hir,context,bad),/r03-/);
  }
});
test('optional missing publication remains absent at ordinary lowering',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-source514/fe82bbf8cf08c1c8a188040c28045067f831ca768ad8273b59cf0a23a7050777-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),'2b3001140d229dea794442b5d1fc77fd7e3dadfc2e90df2d35a7ae78ff25f9e7');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const result=buildHir(facts,context);assert.equal(result.status,'ok',JSON.stringify(result.diagnostics));
  assert.ok(!lowerFormalHir(result.hir,context).includes('tsfg_core.array_call_authority'));
});
