// SPDX-License-Identifier: MIT
// Independent joins over actual Source packets, not a construction evaluator.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildHir,printHir,readHir} from '../../compiler/hir.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {optionalArrayPublication as staticPublication} from './typed-array-publication-fixtures.mjs';
import manifest from './testdata/typed-array-source514/construction.json' with {type:'json'};
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'
  ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
const load=row=>readFile(new URL('./testdata/typed-array-source514/'+row.file,import.meta.url));
function nodes(value,kind) {
  if(!value||typeof value!=='object')return [];
  return [...(value.kind===kind?[value]:[]),...Object.values(value).flatMap(child=>nodes(child,kind))];
}
function repaired(packet) {
  packet.packageId='sha256:'+createHash('sha256').update('tsfg.array-facts.package.v8\0'+packet.schemaHash+'\0'+stable(packet.payload)).digest('hex');
  return Buffer.from(stable(packet)+'\n');
}
test('actual explicit super implicit forwarding and native initialization enter owned HIR structure',async t=>{
  for(const row of manifest)await t.test(row.case,async()=>{
    const bytes=await load(row),facts=readTypedArrayFacts(bytes);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:row.packageId};
    const publication=staticPublication(facts);
    const built=buildHir(facts,context,publication);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));const hir=built.hir;
    const types=new Map(hir.types.map(type=>[type.id,type])),bySource=new Map(hir.types.map(type=>[type.sourceType,type]));
    const functions=new Map(hir.functions.map(fn=>[fn.id,fn]));
    for(const source of facts.payload.types.filter(type=>type.construction)) {
      const type=bySource.get(source.id),construction=type.construction;assert.ok(construction);
      assert.equal(construction.kind,source.construction.kind);
      assert.equal(construction.receiver.viewType,type.id);assert.equal(construction.receiver.domain,'preserve-actual-instance');
      assert.deepEqual(construction.initialization.map(step=>type.fields.find(field=>field.id===step.field).sourceBinding),source.construction.initializationFields);
      for(const field of type.fields)assert.equal(field.initializer,undefined,'only the construction owns each initializer tree');
      for(const step of construction.initialization) {
        const field=type.fields.find(field=>field.id===step.field);assert.ok(field);
        const original=source.fields.find(row=>row.id===field.sourceBinding);
        assert.deepEqual(step.origin,original.origin);
        if(original.initializer)assert.deepEqual(step.value.range,original.initializer.range);
        else assert.equal(step.value,undefined,'native empty definitions do not fabricate expressions');
        if(step.kind==='fieldDefine')assert.equal(step.definition,'native-undefined');
      }
      if(construction.kind==='explicit') {
        const fn=functions.get(construction.functionId);assert.ok(fn);assert.equal(fn.construction,construction.id);
        assert.equal(fn.role,'construction-body');assert.equal(fn.fallthrough,'current-instance');
        assert.equal(construction.receiver.id,fn.parameters[0].id);
        for(const returned of nodes(source.constructor.body,'return')) {
          const owned=nodes(fn.body,'constructorReturn').find(node=>node.range.start===returned.range.start&&node.range.end===returned.range.end);
          assert.ok(owned);if(!returned.value)assert.equal(owned.value,undefined,'bare constructor completion creates no owner expression');
        }
        for(const parameter of construction.parameters)assert.ok(fn.parameters.some(p=>p.id===parameter.symbol));
        if(!type.base){assert.equal(fn.body[0].construction,construction.id);assert.equal(fn.body[0].receiverBinding,construction.receiver.id);}
      }else {
        assert.equal(construction.functionId,null,'default construction is not a fabricated Source function');
        assert.equal(construction.body.at(-1).kind,'initializeOwnFields');
        if(type.base) {
          const base=types.get(type.base),forward=construction.implicitForward;
          assert.equal(forward.target,base.construction.id);assert.equal(construction.body[0].kind,'forwardBaseConstruction');
          assert.equal(construction.body[0].receiverBinding,construction.receiver.id);
          assert.deepEqual(forward.baseSignature.parameters,base.construction.parameters);
          assert.equal(forward.baseSignature.returnType,base.id);
          for(const [i,parameter] of construction.parameters.entries()) {
            assert.equal(parameter.inheritedFrom,base.construction.parameters[i].symbol);
            assert.deepEqual(parameter.origin,base.construction.parameters[i].origin);
            assert.equal(forward.parameters[i].source,parameter.symbol);
            assert.equal(forward.parameters[i].target,parameter.inheritedFrom);
            const proof=forward.parameters[i].compatibility;
            assert.equal(proof.sourceType,parameter.type);assert.equal(proof.targetType,parameter.type);
            assert.deepEqual(proof.origin,construction.origin);
            for(const member of proof.members) {
              assert.ok(member.source&&member.target);assert.equal(member.source,member.target);
              const kind=types.get(parameter.type).kind;
              if(kind==='array'||kind==='readSpan')assert.equal(member.source,'sha256:'+createHash('sha256')
                .update('tsfg.field\0'+parameter.type+'\0length').digest('hex'));
              else assert.ok([...types.values()].some(type=>(type.fields??[]).some(field=>field.id===member.source))
                ||functions.has(member.source),'owned forwarding member');
            }
          }
        }
      }
    }
    const actualSuper=nodes(facts.payload,'superConstruct'),ownedSuper=nodes(hir,'superConstruct');
    assert.equal(ownedSuper.length,actualSuper.length);
    for(const source of actualSuper) {
      const value=ownedSuper.find(node=>node.range.start===source.range.start&&node.range.end===source.range.end
        &&node.sourceSignature.sourcePath===source.signature.sourcePath);assert.ok(value);
      assert.equal(types.get(value.type).kind,'void');assert.equal(value.construction,bySource.get(source.callee).construction.id);
      assert.equal(value.arguments.length,source.arguments.length);assert.deepEqual(value.arguments.map(v=>v.range),source.arguments.map(v=>v.range));
      assert.ok(value.receiverBinding);assert.equal(value.allocationSite,undefined);
      assert.equal(value.afterSuccess.kind,'initializeOwnFields');
      assert.equal(value.afterSuccess.receiverBinding,value.receiverBinding);
      assert.equal(types.get(value.afterSuccess.ownerType).base,value.target);
    }
    for(const value of nodes(hir,'construct')) {
      assert.equal(value.construction,types.get(value.type).construction.id);
      assert.equal(value.signatureHash,types.get(value.type).construction.signatureHash);
    }
    if(row.file.startsWith('fe82')) {
      const derived=hir.types.find(type=>type.nominalKey?.declarationPath[0]==='D');
      const field=derived.fields.find(field=>field.name==='x'),step=derived.construction.initialization.find(step=>step.field===field.id);
      assert.equal(step.kind,'fieldDefine');assert.equal(step.definition,'native-undefined');assert.equal(step.value,undefined);
      assert.equal(step.initialized,undefined,'native definition grants no typed storage initialization proof');
      const fn=functions.get(derived.constructor),assignment=nodes(fn.body,'fieldAssignment').find(value=>value.target.property===field.id);
      assert.ok(assignment);assert.equal(assignment.value.kind,'arrayReadChecked');
    }
    assert.deepEqual(readHir(Buffer.from(printHir(hir,context,publication)),context,publication),hir);
  });
});
test('construction boundary rejects repaired identities with forged order forwarding provenance and super target',async t=>{
  const ordering=manifest.find(row=>row.file.startsWith('fd57')),forwarding=manifest.find(row=>row.file.startsWith('2ccc'));
  /** @type {[string,any,(packet:any)=>void,RegExp][]} */
  const cases=[
    ['native order',ordering,p=>{p.payload.types.find(type=>type.name==='Derived').construction.initializationFields.reverse();},/field-initialization/],
    ['foreign field',ordering,p=>{const d=p.payload.types.find(type=>type.name==='Derived');d.construction.initializationFields[0]=p.payload.types.find(type=>type.name==='Base').fields[0].id;},/field-initialization/],
    ['wrong direct base',ordering,p=>{nodes(p.payload,'superConstruct')[0].callee=p.payload.types.find(type=>type.name==='Derived').id;},/signature|construction-super/],
    ['wrong inherited origin',forwarding,p=>{p.payload.types.find(type=>type.name==='Leaf').construction.parameters[0].origin.start++;},/construction-forward/],
    ['wrong forward symbol',forwarding,p=>{const f=p.payload.types.find(type=>type.name==='Leaf').construction.implicitForward;f.parameters[0].target=f.parameters[0].source;},/construction-forward/],
    ['missing Array member proof',forwarding,p=>{p.payload.types.find(type=>type.name==='Mid').construction.implicitForward.parameters[0].compatibility.members=[];},/construction-forward/],
    ['wrong ancestor signature',forwarding,p=>{const t=p.payload.types.find(type=>type.name==='Leaf');t.construction.signature.declarationRange={...t.declarationRange};},/construction/],
    ['foreign explicit owner',ordering,p=>{const t=p.payload.types.find(type=>type.name==='Derived');t.constructor.ownerType=p.payload.types.find(type=>type.name==='Base').id;},/construction-owner/],
    ['wrong explicit construct result',ordering,p=>{p.payload.types.find(type=>type.name==='Derived').constructor.returnType='i32';},/construction-owner/],
  ];
  for(const [name,row,change,pattern] of cases)await t.test(name,async()=>{
    const packet=JSON.parse((await load(row)).toString('utf8'));change(packet);
    assert.throws(()=>readTypedArrayFacts(repaired(packet)),pattern);
  });
});
