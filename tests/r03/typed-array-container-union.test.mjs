// SPDX-License-Identifier: MIT
// Real Source member proofs select a static container view, preserving its operand.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,printHir,readHir} from '../../compiler/hir.mjs';
import {typedArrayRepresentation} from '../../compiler/typed-array-representation.mjs';
import manifest from './testdata/typed-array-source514/container-union.json' with {type:'json'};
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'
  ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
function nodes(value,kind) {
  if(!value||typeof value!=='object')return [];
  return [...(value.kind===kind?[value]:[]),...Object.values(value).flatMap(child=>nodes(child,kind))];
}
const load=async row=>readFile(new URL('./testdata/typed-array-source514/'+row.file,import.meta.url));
function repaired(packet) {
  packet.packageId='sha256:'+createHash('sha256').update('tsfg.array-facts.package.v8\0'+packet.schemaHash+'\0'+stable(packet.payload)).digest('hex');
  return Buffer.from(stable(packet)+'\n');
}
test('actual Array and ReadSpan assertions select authoritative container-union roots',async t=>{
  for(const row of manifest)await t.test(row.case,async()=>{
    const bytes=await load(row),facts=readTypedArrayFacts(bytes);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:row.packageId};
    const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
    const hir=built.hir,assertion=nodes(hir,'assertType')[0],types=new Map(hir.types.map(type=>[type.id,type]));
    assert.equal(assertion.compatibilityRoots.length,1);
    const pair=assertion.compatibilityRoots[0];
    assert.equal(types.get(pair.sourceType).nominalKey.declarationPath[0],'Left');
    assert.equal(types.get(pair.targetType).nominalKey.declarationPath[0],row.case==='Base seed'?'Base':'OnlyLeftView');
    assert.notEqual(assertion.operand.type,assertion.type);
    assert.equal(assertion.operand.kind,'reference');
    assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);
  });
});
test('container-union assertions cannot omit their selected root',async t=>{
  for(const row of manifest.filter(row=>row.case!=='Base seed'))await t.test(row.case,async()=>{
    const packet=JSON.parse((await load(row)).toString('utf8'));
    delete nodes(packet.payload,'as')[0].compatibilityRoots;
    packet.payload.compatibilityWitnesses=[];
    assert.throws(()=>readTypedArrayFacts(repaired(packet)),{code:'r03-typed-array-compatibility'});
  });
});
test('a valid but nonselected container view root remains unused',async()=>{
  const packet=JSON.parse((await load(manifest.find(row=>row.case==='Array target union'))).toString('utf8'));
  const seed=JSON.parse((await load(manifest.find(row=>row.case==='Base seed'))).toString('utf8'));
  const extra=seed.payload.compatibilityWitnesses[0],proof=extra.compatibility;
  const expression=nodes(packet.payload,'as')[0];
  assert.deepEqual(proof.origin,{source:'/src/main.ts',...expression.range});
  for(const id of [proof.sourceType,proof.targetType]) {
    const actual=packet.payload.types.find(type=>type.id===id),authority=seed.payload.types.find(type=>type.id===id);
    // runtimeKey also binds the complete source bytes, which differ in the
    // equal-width assertion. This proof joins logical IDs, never cell layouts.
    assert.deepEqual(actual.nominalKey,authority.nominalKey);
    assert.deepEqual(actual.fields.map(field=>[field.id,field.type]),authority.fields.map(field=>[field.id,field.type]));
  }
  const pairOrder=(a,b)=>Buffer.compare(Buffer.from(a.sourceType),Buffer.from(b.sourceType))||Buffer.compare(Buffer.from(a.targetType),Buffer.from(b.targetType));
  assert.ok(pairOrder(expression.compatibilityRoots[0],proof)<0,'OnlyLeftView is the first successful candidate');
  // Derived hostile packet joins a second genuine same-origin proof, without
  // fabricating member identities or claiming it was emitted by Source.
  expression.compatibilityRoots.push({sourceType:proof.sourceType,targetType:proof.targetType});
  packet.payload.compatibilityWitnesses.push(extra);
  assert.throws(()=>readTypedArrayFacts(repaired(packet)),{code:'r03-typed-array-compatibility-root'});
});
test('numeric container assertions retain existing-variant overlap',()=>{
  /** @type {Map<string,{id:string,kind:string,members?:string[],elementType?:string}>} */
  const types=new Map(['i32','f32','f64'].map(id=>[id,{id,kind:'scalar'}]));
  const union=members=>{const id='union<'+members.join(',')+'>';types.set(id,{id,kind:'union',members});return id;};
  const array=elementType=>{const id='array<'+elementType+'>';types.set(id,{id,kind:'array',elementType});return id;};
  const source=array(union(['f64','i32'])),target=union([array('f32'),array('i32')]);
  let remaining=1000;const model=typedArrayRepresentation(types,()=>assert.ok(--remaining>=0));
  assert.equal(model.assertion(source,target,()=>assert.fail('numeric assertion needs no class proof')).size,0);
  assert.throws(()=>model.assertion(array('i32'),union([array('f32'),array('f64')]),()=>false),{code:'r03-typed-array-representation'});
});
