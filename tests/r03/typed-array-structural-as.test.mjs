// SPDX-License-Identifier: MIT
// Actual authoritative multi-reference assertions preserve their operand graph.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,printHir,readHir} from '../../compiler/hir.mjs';
import manifest from './testdata/typed-array-source514/structural-as.json' with {type:'json'};
import previous from './testdata/typed-array-source514/manifest.json' with {type:'json'};
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'
  ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
function nodes(value,kind) {
  if(!value||typeof value!=='object')return [];
  return [...(value.kind===kind?[value]:[]),...Object.values(value).flatMap(child=>nodes(child,kind))];
}
const bytes=async row=>readFile(new URL('./testdata/typed-array-source514/'+row.file,import.meta.url));
test('actual multi-reference structural assertions consume every authoritative root',async t=>{
  for(const row of manifest)await t.test(row.case,async()=>{
    const input=await bytes(row),facts=readTypedArrayFacts(input);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:input,expectedPackageId:row.packageId};
    const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
    const hir=built.hir,types=new Map(hir.types.map(type=>[type.id,type]));
    const assertions=nodes(hir,'assertType');assert.ok(assertions.length>0);
    const assertion=assertions.find(node=>node.compatibilityRoots?.length===2);assert.ok(assertion);
    const sources=assertion.compatibilityRoots.map(pair=>types.get(pair.sourceType).nominalKey.declarationPath[0]).sort();
    assert.deepEqual(sources,['Left','Right']);
    const owner=hir.functions.find(fn=>nodes(fn,'assertType').includes(assertion));assert.ok(owner);
    for(const pair of assertion.compatibilityRoots)assert.ok(hir.compatibilityWitnesses.some(record=>
      record.compatibility.sourceType===pair.sourceType&&record.compatibility.targetType===pair.targetType
      &&record.compatibility.origin.source===owner.sourcePath&&record.compatibility.origin.start===assertion.range.start
      &&record.compatibility.origin.end===assertion.range.end));
    assert.notEqual(assertion.operand.type,assertion.type,'static view retains the original operand type');
    assert.equal(nodes(hir,'arrayReadChecked').length,nodes(facts.payload,'checkedElementAccess').length,
      'as retains every actual checked access, including array-return cases with none');
    assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);
  });
});

test('structural assertion cannot omit a source root or bypass existing representation guards',async t=>{
  const original=JSON.parse((await bytes(manifest[0])).toString('utf8'));
  const assertion=nodes(original.payload,'as').find(node=>node.compatibilityRoots?.length===2);
  assertion.compatibilityRoots.pop();
  original.packageId='sha256:'+createHash('sha256').update('tsfg.array-facts.package.v8\0'+original.schemaHash+'\0'+stable(original.payload)).digest('hex');
  assert.throws(()=>readTypedArrayFacts(Buffer.from(stable(original)+'\n')),/r03-typed-array-compatibility/);
  for(const row of previous.filter(row=>row.expect==='reject'))await t.test(row.file,async()=>{
    // Historical actual malformed packets retain their original schema and
    // semantic failure evidence. New-format representation regressions below
    // use hostile derivatives of the current actual successful packets.
    const input=await bytes(row);assert.throws(()=>readTypedArrayFacts(input),{code:'r03-typed-array-schema'});
  });
  await t.test('a different value identity cannot replace an existing-variant assertion',async()=>{
    const row=previous.find(row=>row.file.startsWith('a1b88a8d'));
    const packet=JSON.parse((await bytes(row)).toString('utf8'));
    const values=packet.payload.types.filter(type=>type.kind==='value');
    const v=values.find(type=>type.name==='V'),w=values.find(type=>type.name==='W');
    const union=packet.payload.types.find(type=>type.kind==='union'&&type.members.includes(v.id)&&type.members.includes(w.id));
    const oldUnion=union.id,oldArray='array<'+oldUnion+'>';
    union.members=union.members.filter(id=>id!==v.id);const newUnion='union<'+union.members.join(',')+'>';
    // Hostile data deliberately removes V from the source domain. The actual
    // V/W nominal IDs and fields remain untouched; no Source output is claimed.
    function replace(value) {
      if(!value||typeof value!=='object')return;
      for(const [key,child] of Object.entries(value)) {
        if(child===oldUnion)value[key]=newUnion;
        else if(child===oldArray)value[key]='array<'+newUnion+'>';
        else replace(child);
      }
    }
    replace(packet.payload);packet.payload.types.sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
    packet.packageId='sha256:'+createHash('sha256').update('tsfg.array-facts.package.v8\0'+packet.schemaHash+'\0'+stable(packet.payload)).digest('hex');
    assert.throws(()=>readTypedArrayFacts(Buffer.from(stable(packet)+'\n')),{code:'r03-typed-array-representation'});
  });
});
