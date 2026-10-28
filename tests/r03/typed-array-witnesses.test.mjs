// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir} from '../../compiler/hir.mjs';
import manifest from './testdata/typed-array-source514/witnesses.json' with {type:'json'};

const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'
  ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
const digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const load=async row=>JSON.parse(await readFile(new URL('./testdata/typed-array-source514/'+row.file,import.meta.url),'utf8'));
function encoded(value) {
  value.packageId=digest('tsfg.array-facts.package.v8\0'+value.schemaHash+'\0'+stable(value.payload));
  return Buffer.from(stable(value)+'\n');
}
function walk(value,visit) {
  if(!value||typeof value!=='object')return;
  visit(value);for(const child of Object.values(value))walk(child,visit);
}
test('actual nested method union and cyclic M12 proofs produce a closed owned graph',async t=>{
  for(const row of manifest)await t.test(row.file,async()=>{
    const packet=await load(row),bytes=Buffer.from(stable(packet)+'\n'),facts=readTypedArrayFacts(bytes);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:row.packageId};
    const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
    const hir=built.hir,types=new Map(hir.types.map(type=>[type.id,type]));
    const members=new Set(hir.types.flatMap(type=>(type.fields??[]).map(field=>field.id)).concat(hir.functions.map(fn=>fn.id)));
    const key=proof=>stable([proof.origin,proof.sourceType,proof.targetType]);
    const directory=new Map(hir.compatibilityWitnesses.map(record=>[key(record.compatibility),record]));
    const reachable=new Set();
    function reach(proof) {
      const id=key(proof);if(reachable.has(id))return;reachable.add(id);
      const record=directory.get(id);assert.ok(record,'explicit owned proof');
      assert.ok(types.has(proof.sourceType)&&types.has(proof.targetType));
      for(const member of record.compatibility.members)assert.ok(members.has(member.source)&&members.has(member.target));
      for(const pair of record.dependencies)reach({...pair,origin:proof.origin});
    }
    for(const fn of hir.functions)walk(fn,node=>{
      for(const pair of node.compatibilityRoots??[])reach({...pair,origin:{source:fn.sourcePath,...node.range}});
    });
    for(const entry of hir.entryCompatibilityRoots)for(const pair of entry.roots)reach({...pair,origin:entry.origin});
    assert.equal(reachable.size,directory.size);assert.equal(directory.size,packet.payload.compatibilityWitnesses.length);
    const changed=structuredClone(hir);changed.compatibilityWitnesses[0].compatibility.sourceType='sha256:'+'0'.repeat(64);
    assert.throws(()=>verifyHir(changed,context),/r03-typed-array-hir-projection/);
  });
});

test('cold proof closure rejects missing invented orphan duplicate and cross-origin edges',async t=>{
  const original=await load(manifest.find(row=>row.file.startsWith('dea4193')));
  const mutations={
    missingRoot:p=>{p.compatibilityWitnesses.shift();},
    missingNested:p=>{p.compatibilityWitnesses.pop();},
    missingDependency:p=>{
      const selected=p.compatibilityWitnesses.find(record=>record.dependencies.length>0);
      assert.ok(selected,'actual nonempty selected dependency');selected.dependencies=[];
    },
    duplicate:p=>{p.compatibilityWitnesses.push(structuredClone(p.compatibilityWitnesses.at(-1)));},
    orphan:p=>{walk(p.functions,node=>{delete node.compatibilityRoots;});},
    crossOrigin:p=>{p.compatibilityWitnesses[1].compatibility.origin.end--;},
    unusedDependency:p=>{p.compatibilityWitnesses[1].dependencies.push({sourceType:p.compatibilityWitnesses[0].compatibility.sourceType,
      targetType:p.compatibilityWitnesses[0].compatibility.targetType});},
    wrongMember:p=>{p.compatibilityWitnesses[1].compatibility.members[0].source=p.compatibilityWitnesses[0].compatibility.members[0].source;},
  };
  for(const [name,mutate] of Object.entries(mutations))await t.test(name,()=>{
    const value=structuredClone(original);mutate(value.payload);
    assert.throws(()=>readTypedArrayFacts(encoded(value)),/r03-(typed-array|reference)/);
  });
});
