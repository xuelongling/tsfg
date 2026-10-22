// SPDX-License-Identifier: MIT
// Independent assertions over real Source captures, not inferred member maps.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import manifest from './testdata/typed-array-source514/roots.json' with {type:'json'};
import ledger from './testdata/typed-array-source514/ledger.json' with {type:'json'};
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'
  ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
function nodes(value,kind) {
  if(!value||typeof value!=='object')return [];
  return [...(value.kind===kind?[value]:[]),...Object.values(value).flatMap(child=>nodes(child,kind))];
}
async function load(row) {
  return readFile(new URL('./testdata/typed-array-source514/'+row.file,import.meta.url));
}
function repaired(packet) {
  packet.packageId='sha256:'+createHash('sha256').update('tsfg.array-facts.package.v8\0'+packet.schemaHash+'\0'+stable(packet.payload)).digest('hex');
  return Buffer.from(stable(packet)+'\n');
}
test('actual source union and presence-only Array assertions retain authoritative identities',async t=>{
  for(const row of manifest)await t.test(row.case,async()=>{
    const bytes=await load(row),facts=readTypedArrayFacts(bytes);
    const built=buildHir(facts,{family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:row.packageId});
    assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));const hir=built.hir;
    const types=new Map(hir.types.map(type=>[type.id,type]));
    if(row.case==='sourceUnion'||row.case==='parenthesizedUnion') {
      const element=nodes(hir,'arrayCreate')[0].elements[0];
      assert.equal(element.compatibilityRoots.length,2);
      const from=element.compatibilityRoots.map(pair=>types.get(pair.sourceType).nominalKey.declarationPath[0]).sort();
      assert.deepEqual(from,['Left','Right']);
      for(const pair of element.compatibilityRoots) {
        assert.equal(types.get(pair.targetType).nominalKey.declarationPath[0],'Base');
        assert.ok(hir.compatibilityWitnesses.some(record=>record.compatibility.sourceType===pair.sourceType
          &&record.compatibility.targetType===pair.targetType&&record.compatibility.origin.start===element.range.start));
      }
    }else if(row.case==='presenceUnion') {
      const assertion=nodes(hir,'assertType')[0],from=types.get(types.get(assertion.operand.type).elementType);
      const to=types.get(types.get(assertion.type).elementType);
      assert.equal(from.members.length,3);assert.equal(to.members.length,2);
      assert.deepEqual(from.members.filter(id=>types.get(id).kind!=='undefined').sort(),[...to.members].sort());
      assert.equal(assertion.compatibilityRoots,undefined);
      assert.ok(nodes(hir,'arrayReadChecked').length>0,'checked access survives presence assertion');
    }else if(row.case==='identitySubset') {
      const assertion=nodes(hir,'assertType')[0],from=types.get(types.get(assertion.operand.type).elementType);
      const to=types.get(assertion.type).elementType;
      assert.ok(from.members.includes(to));assert.equal(assertion.compatibilityRoots,undefined);
      assert.ok(nodes(hir,'arrayReadChecked').length>0);
    }else if(row.case==='transaction') {
      const targets=hir.compatibilityWitnesses.map(record=>types.get(record.compatibility.targetType).nominalKey.declarationPath[0]);
      assert.ok(targets.includes('Good'));assert.ok(!targets.includes('Bad'),'failed candidate proof must not survive');
    }
  });
});

test('every explicit ordinary root is required unique and consumed',async t=>{
  const row=manifest.find(row=>row.case==='sourceUnion'),original=JSON.parse((await load(row)).toString('utf8'));
  const find=packet=>nodes(packet.payload,'arrayLiteral')[0].elements[0];
  const cases={missing:node=>node.compatibilityRoots.pop(),duplicate:node=>node.compatibilityRoots.push({...node.compatibilityRoots[0]}),
    reversed:node=>node.compatibilityRoots.reverse()};
  for(const [name,change] of Object.entries(cases))await t.test(name,()=>{
    const packet=structuredClone(original);change(find(packet));
    assert.throws(()=>readTypedArrayFacts(repaired(packet)),/r03-typed-array-(slot|compatibility)/);
  });
});

test('a failed target candidate cannot consume an extra authoritative root',async()=>{
  const original=JSON.parse((await load(ledger.find(row=>row.case==='main'))).toString('utf8'));
  const seed=JSON.parse((await load(ledger.find(row=>row.case==='seed'))).toString('utf8'));
  assert.doesNotThrow(()=>readTypedArrayFacts(Buffer.from(stable(original)+'\n')));
  const extra=seed.payload.compatibilityWitnesses[0],proof=extra.compatibility;
  const from=original.payload.types.find(type=>type.id===proof.sourceType);
  assert.equal(from.name,'Right');
  const sourceUnion=original.payload.types.find(type=>type.kind==='union'&&type.members.includes(from.id));
  assert.equal(sourceUnion.members[0],from.id,'the partial match must precede the failing source variant');
  const targetUnion=original.payload.types.find(type=>type.kind==='union'&&type.members.every(id=>id.startsWith('array<')));
  assert.equal(targetUnion.members[0],'array<'+proof.targetType+'>','the failing candidate must precede Base[]');
  const expression=nodes(original.payload,'bindingReference').find(node=>node.range.start===proof.origin.start&&node.range.end===proof.origin.end);
  assert.ok(expression);assert.equal(extra.dependencies.length,0);
  const fields=new Map(original.payload.types.flatMap(type=>type.fields??[]).map(field=>[field.id,field]));
  for(const member of proof.members)assert.equal(fields.get(member.source).name,fields.get(member.target).name);
  expression.compatibilityRoots.push({sourceType:proof.sourceType,targetType:proof.targetType});
  const pairOrder=(a,b)=>Buffer.compare(Buffer.from(a.sourceType),Buffer.from(b.sourceType))
    ||Buffer.compare(Buffer.from(a.targetType),Buffer.from(b.targetType));
  expression.compatibilityRoots.sort(pairOrder);original.payload.compatibilityWitnesses.push(extra);
  original.payload.compatibilityWitnesses.sort((a,b)=>Buffer.compare(Buffer.from(a.compatibility.origin.source),Buffer.from(b.compatibility.origin.source))
    ||a.compatibility.origin.start-b.compatibility.origin.start||a.compatibility.origin.end-b.compatibility.origin.end
    ||pairOrder(a.compatibility,b.compatibility));
  assert.throws(()=>readTypedArrayFacts(repaired(original)),{code:'r03-typed-array-compatibility-root'});
});
