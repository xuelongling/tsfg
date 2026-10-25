// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import expected from './testdata/typed-array-entry/universal-definition-abi-expected.json' with {type:'json'};
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';
const order=(a,b)=>a<b?-1:a>b?1:0;
function attribute(text,name) {
  const encoded=new RegExp('tsfg_core\\.'+name+' = ("(?:[^"\\\\]|\\\\.)*")').exec(text);
  assert.ok(encoded,'ordinary Core contains '+name);const raw=JSON.parse(encoded[1]),value=JSON.parse(raw);
  assert.equal(raw,canonical(value));return value;
}

test('ordinary Core preserves independent Source entry authority and all definition ABI slots',async t=>{
  let definitions=0,parameters=0,results=0,entries=0;
  for(const input of expected.caseInputs)await t.test(input.case,async()=>{
    const bytes=await readFile(new URL('../../'+input.packetPath,import.meta.url));
    assert.equal(sha256(bytes).slice(7),input.packetSHA256);
    const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
      factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
    const hir=built.hir,text=lowerFormalHir(hir,context),exports=attribute(text,'source_exports'),
      authority=attribute(text,'entry_compatibility_roots'),callables=attribute(text,'callable_contracts'),
      plan=attribute(text,'finite_domains'),gold=expected.rows.filter(row=>row.case===input.case);
    assert.deepEqual(exports,hir.exports);
    assert.deepEqual(authority,hir.entryCompatibilityRoots.map(row=>({...row,roots:[...row.roots].sort((a,b)=>order(a.sourceType,b.sourceType)||order(a.targetType,b.targetType))}))
      .sort((a,b)=>order(a.functionId,b.functionId)||order(a.parameterBinding,b.parameterBinding)));
    for(const entry of authority) {
      const fn=hir.functions.find(row=>row.id===entry.functionId),parameter=fn.parameters.find(row=>row.id===entry.parameterBinding);
      assert.ok(exports.some(row=>row.functionId===fn.id));assert.equal(entry.viewType,parameter.type);
      assert.deepEqual(entry.origin,{source:fn.sourcePath,...parameter.range});
      const source=facts.payload.functions.find(row=>row.id===fn.sourceBinding),original=source.parameters.find(row=>row.id===parameter.id);
      assert.deepEqual(entry.origin,{source:source.sourcePath,...original.declarationRange});entries++;
    }
    for(const row of gold) {
      const abi=plan.abi.find(value=>value.functionId===row.functionId),callable=callables.find(value=>value.id===row.functionId);
      assert.deepEqual({parameters:abi.parameters,result:abi.result,id:abi.id},row.abi);
      for(const [index,parameter] of callable.parameters.entries()) {
        assert.equal(parameter.origin===null,Boolean(callable.ownerType)&&index===0);
        const entry=authority.find(value=>value.functionId===callable.id&&value.parameterBinding===parameter.id);
        if(entry)assert.deepEqual(parameter.origin,entry.origin);
      }
      parameters+=row.parameters.length;results+=row.result===null?0:1;definitions++;
    }
    for(const published of plan.published) {
      const {id,...value}=published;assert.equal(id,sha256('tsfg.published-call.v1\0'+canonical(value)));
      assert.equal(value.closureIdentity,hir.inputIdentity);assert.ok(exports.some(row=>row.functionId===value.functionId));
    }
  });
  assert.deepEqual({definitions,parameters,results},{definitions:22,parameters:29,results:11});assert.ok(entries>0);
});

// Real C++ admission for the same owned entry fixture used above. No Source
// process is needed, and the original producer output is never edited in place.
async function nominalCore() {
  const input=expected.caseInputs.find(row=>row.case==='readonly');assert.ok(input);
  const bytes=await readFile(new URL('../../'+input.packetPath,import.meta.url));
  assert.equal(sha256(bytes).slice(7),input.packetSHA256);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok');return lowerFormalHir(built.hir,context);
}
/** @param {string} core @param {unknown} methods */
function withNominalMethods(core,methods) {
  const pattern=/tsfg_core\.semantic_types = ("(?:[^"\\]|\\.)*")/;
  const selected=pattern.exec(core);assert.ok(selected);
  /** @type {Array<Record<string,unknown>>} */
  const types=JSON.parse(JSON.parse(selected[1]));
  const changed=types.map(row=>row.kind==='reference'||row.kind==='value'?{...row,methods}:row);
  return core.replace(pattern,()=> 'tsfg_core.semantic_types = '+JSON.stringify(canonical(changed)));
}
const hasCore=Boolean(process.env.TSFG_CORE_IR_EXE);
test('Core nominal method catalogue accepts absent and explicit empty directories',{skip:!hasCore},async t=>{
  const core=await nominalCore(),types=attribute(core,'semantic_types');
  assert.ok(types.some(/** @param {any} row */ row=>row.kind==='reference'));
  assert.ok(types.every(/** @param {any} row */ row=>!Object.hasOwn(row,'methods')));
  for(const [name,input] of [['absent',core],['empty',withNominalMethods(core,[])]])await t.test(name,async()=>{
    const first=await invokeCore(input);accepted(first);
    const fixed=await invokeCore(first.stdout);accepted(fixed);assert.deepEqual(fixed.stdout,first.stdout);
  });
});
test('Core nominal method catalogue rejects present bad shape, elements and unknown callables',{skip:!hasCore},async t=>{
  const core=await nominalCore();
  /** @type {Array<[string,unknown]>} */
  const cases=[['null',null],['object',{}],['string','invalid'],['element',[0]],['callable',['sha256:'+'0'.repeat(64)]]];
  for(const [name,methods] of cases)await t.test(name,async()=>{
    const result=await invokeCore(withNominalMethods(core,methods));rejected(result);
    assert.match(result.stderr.toString('utf8'),/core-ir-finite-module/);
  });
});
