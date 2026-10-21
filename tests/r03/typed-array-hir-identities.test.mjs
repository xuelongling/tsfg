// SPDX-License-Identifier: MIT
// Check the resulting domain graph, independently of projection/reconstruction.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildHir} from '../../compiler/hir.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import manifest from './testdata/typed-array-actual-v8/manifest.json' with {type:'json'};

function walk(value,visit) {
  if(!value||typeof value!=='object')return;
  visit(value);for(const child of Object.values(value))walk(child,visit);
}
test('actual packets produce a closed owned type member and callable graph',async t=>{
  for(const row of manifest)await t.test(row.file,async()=>{
    const bytes=await readFile(new URL('./testdata/typed-array-actual-v8/'+row.file,import.meta.url));
    const facts=readTypedArrayFacts(bytes),built=buildHir(facts,{family:'tsfg.array-facts-context-candidate',
      version:2,factsBytes:bytes,expectedPackageId:row.packageId});
    assert.equal(built.status,'ok');const hir=built.hir;
    const types=new Map(hir.types.map(type=>[type.id,type]));
    const functions=new Map(hir.functions.map(fn=>[fn.id,fn]));
    const fields=new Map(hir.types.flatMap(type=>(type.fields??[]).map(field=>[field.id,field])));
    const members=new Set([...fields.keys(),...functions.keys()]);
    function expression(value) {
      if(typeof value.type==='string')assert.ok(types.has(value.type),'owned expression/binding type');
      if(value.declaredType)assert.ok(types.has(value.declaredType),'owned declared type');
      if(value.kind==='fieldAccess'||value.kind==='fieldTarget')assert.ok(fields.has(value.property),'owned field property');
      if(value.kind==='call')assert.ok(functions.has(value.target)||value.target===hir.intrinsics.readSpan.id,'owned call target');
      if(value.kind==='construct') {
        const type=types.get(value.type);
        assert.ok(type&&['value','reference'].includes(type.kind));
        assert.equal(value.target,type.constructor??type.id,'owned constructor target');
      }
      if(value.kind==='this')assert.ok(types.has(value.ownerType),'owned initializer this');
      if(value.compatibility) {
        assert.ok(types.has(value.compatibility.sourceType)&&types.has(value.compatibility.targetType));
        for(const member of value.compatibility.members)assert.ok(members.has(member.source)&&members.has(member.target));
      }
    }
    for(const type of hir.types) {
      if(type.elementType)assert.ok(types.has(type.elementType));
      for(const member of type.members??[])assert.ok(types.has(member));
      if(type.base)assert.ok(types.has(type.base));
      if(Object.hasOwn(type,'constructor')&&type.constructor)assert.ok(functions.has(type.constructor));
      for(const method of type.methods??[])assert.ok(functions.has(method));
      for(const field of type.fields??[]) {
        assert.ok(types.has(field.type));
        if(field.parameterBinding)assert.ok(functions.get(type.constructor).parameters.some(p=>p.id===field.parameterBinding));
        if(field.initializer)walk(field.initializer,expression);
      }
    }
    for(const fn of hir.functions) {
      assert.ok(types.has(fn.returnType.id));
      if(fn.ownerType)assert.ok(types.has(fn.ownerType));
      if(fn.overrideTarget)assert.ok(functions.has(fn.overrideTarget));
      walk(fn.parameters,expression);walk(fn.body,expression);
    }
    for(const entry of hir.exports)assert.ok(functions.has(entry.functionId));
  });
});

test('cold field and constructor references cannot disappear at projection',async()=>{
  const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'
    ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
  for(const [prefix,kind] of [['38ac49ad','fieldTarget'],['cbac6d61','new']]) {
    const row=manifest.find(entry=>entry.file.startsWith(prefix));
    const value=JSON.parse(await readFile(new URL('./testdata/typed-array-actual-v8/'+row.file,import.meta.url),'utf8'));
    let changed=false;
    walk(value.payload,node=>{
      if(!changed&&node.kind===kind){node[kind==='new'?'callee':'property']='sha256:'+'0'.repeat(64);changed=true;}
    });
    assert.ok(changed);
    value.packageId='sha256:'+createHash('sha256').update('tsfg.array-facts.package.v8\0'+value.schemaHash+'\0'+stable(value.payload)).digest('hex');
    assert.throws(()=>readTypedArrayFacts(Buffer.from(stable(value)+'\n')),/r03-typed-array-(field|signature)/);
  }
});
