// SPDX-License-Identifier: MIT
// Adversarial data is independently re-signed, never promoted into successful oracles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir,verifyHir,readHir,lowerHir } from '../../compiler/hir.mjs';
import { fixtures,fresh,wire,failure,reframeFacts,replaceSource,context,hirError,trustedHirError } from './array-test-fixtures.mjs';

/** @param {any} error @param {string} kind */
function factsFailure(error,kind){
  assert.equal(error.code,'r03-array-facts-'+kind);assert.equal(error.ruleId,'r01-input-boundary');
  assert.equal(error.phase,'input');assert.equal(error.primary,undefined);
}
test('25d cold facts retain complete parameters, property, alias and mutation source windows after reframing',async t=>{
  const row=(await fixtures())[5];
  /** @type {Array<[string,(p:any)=>void,string]>} */
  const changes=[
    ['parameter omitted',p=>p.payload.functions[0].parameters.pop(),'input'],
    ['parameter order',p=>p.payload.functions[0].parameters.reverse(),'input'],
    ['parameter nominal type',p=>{p.payload.functions[0].parameters[0].declaredType='f64';},'input'],
    ['parameter name',p=>{p.payload.functions[0].parameters[0].name='forged';},'input'],
    ['parameter binding identity',p=>{p.payload.functions[0].parameters[0].id='sha256:'+'0'.repeat(64);},'identity'],
    ['parameter made immutable',p=>{p.payload.functions[0].parameters[0].writable=false;},'input'],
    ['scalar reference wrong function',p=>{p.payload.functions[0].body[3].target.index.binding=p.payload.functions[1].parameters[0].id;},'input'],
    ['index loses u32 provenance',p=>{p.payload.functions[0].body[3].target.index.flowType='f64';},'input'],
    ['RHS loses f64 provenance',p=>{p.payload.functions[0].body[3].value.flowType='u32';},'input'],
    ['RHS replaced with index parameter',p=>{p.payload.functions[0].body[3].value.binding=p.payload.functions[0].parameters[0].id;},'input'],
    ['alias target replaced',p=>{p.payload.functions[0].body[3].target.array.binding=p.payload.functions[0].bindings[0].id;},'input'],
    ['length origin forged',p=>{p.payload.arrayLength.id='sha256:'+'0'.repeat(64);},'input'],
    ['length official type forged',p=>{p.payload.arrayLength.officialType='u32';},'input'],
    ['length property target forged',p=>{p.payload.functions[0].body[4].target.property=p.payload.functions[0].bindings[0].id;},'input'],
    ['length property name range',p=>{p.payload.functions[0].body[4].target.nameRange.start++;},'input'],
    ['assignment omitted',p=>{p.payload.functions[0].body.splice(3,1);},'input'],
    ['assignment order',p=>{const b=p.payload.functions[0].body;[b[3],b[4]]=[b[4],b[3]];},'input'],
    ['operator range',p=>{p.payload.functions[0].body[3].operatorRange.start--;},'input'],
    ['assignment expression range',p=>{p.payload.functions[0].body[3].expressionRange.end--;},'input'],
    ['second function and export omitted',p=>{const id=p.payload.functions.pop().id;p.payload.exports=p.payload.exports.filter(e=>e.functionId!==id);},'input'],
  ];
  for(const [name,mutate,kind]of changes)await t.test(name,()=>{
    const packet=fresh(row.facts.package);mutate(packet);reframeFacts(packet);const before=fresh(packet);
    for(const action of [()=>readArrayFactsCandidate(wire(packet)),()=>writeArrayFactsCandidate(packet)])
      factsFailure(failure(action),kind);
    assert.deepEqual(packet,before);
  });
});

test('25d cold exact-length proof rejects literal gaps and growth without executing any RHS or read',async t=>{
  const rows=await fixtures();
/** @type {Array<[string,any,number]>} */
  const plans=[['overwrite gap',rows[4],1],['empty alias gap',rows[6],2],['length growth',rows[6],4]];
  for(const [name,row,index]of plans)await t.test(name,()=>{
    const p=fresh(row.facts.package),s=p.payload.functions[0].body[index];
    const operand=s.kind==='elementAssignment'?s.target.index:s.value;
    const token=name==='empty alias gap'?'1':'3';
    replaceSource(p,operand.range.start,operand.range.end,token);
    operand.token=token;operand.decimal=token;reframeFacts(p);
    factsFailure(failure(()=>readArrayFactsCandidate(wire(p))),'density');
    factsFailure(failure(()=>writeArrayFactsCandidate(p)),'density');
  });
});

test('25d HIR and lowering preserve all dynamic uses and trusted anchors before publishing any Core',async t=>{
  const row=(await fixtures())[5];
  /** @type {Array<[string,(h:any)=>void]>} */
  const changes=[
    ['parameter omitted',h=>h.functions[0].parameters.pop()],
    ['parameter order',h=>h.functions[0].parameters.reverse()],
    ['parameter renamed',h=>{h.functions[0].parameters[0].name='p0';}],
    ['parameter source range',h=>{h.functions[0].parameters[0].range.end--;}],
    ['parameter nominal type',h=>{h.functions[0].parameters[0].type=h.types[0].id;}],
    ['signature order',h=>{h.functions[0].signatureHash=h.functions[1].signatureHash;}],
    ['source binding parameter',h=>{h.functions[0].parameters[0].id=h.functions[1].parameters[0].id;}],
    ['store removed',h=>h.functions[0].body.splice(3,1)],
    ['resize removed',h=>h.functions[0].body.splice(4,1)],
    ['store receiver flattened',h=>{h.functions[0].body[3].target.receiver.binding=h.functions[0].body[0].binding.id;}],
    ['index reference substituted',h=>{h.functions[0].body[3].target.index.binding=h.functions[0].parameters[1].id;}],
    ['RHS parameter substituted',h=>{h.functions[0].body[3].value.binding=h.functions[0].parameters[0].id;}],
    ['RHS use range',h=>{h.functions[0].body[3].value.range.start++;}],
    ['operator range',h=>{h.functions[0].body[3].operatorRange.end++;}],
    ['target range',h=>{h.functions[0].body[3].target.range.end++;}],
    ['property origin',h=>{h.arrayLength.officialType='u32';}],
    ['property identity',h=>{h.functions[0].body[4].target.property=h.functions[0].parameters[0].id;}],
    ['property use range',h=>{h.functions[0].body[4].target.nameRange.start++;}],
    ['new length scalar edge',h=>{h.functions[0].body[4].value.binding=h.functions[0].parameters[0].id;}],
    ['dynamic checked read removed',h=>{h.functions[0].body.at(-1).value.kind='arrayRead';}],
    ['second function omitted',h=>h.functions.pop()],
  ];
  for(const [name,mutate]of changes)await t.test(name,()=>{
    const h=fresh(row.hir.expectedHir);mutate(h);const before=fresh(h);let publication;
    const error=failure(()=>verifyHir(h,context(row)));trustedHirError(row,error,'invalid');
    assert.deepEqual(failure(()=>{publication=lowerHir(h,context(row));}),error);
    assert.equal(publication,undefined);assert.deepEqual(h,before);
  });
  const rhsRow=(await fixtures())[6];
  for(const name of ['RHS check removed','RHS receiver changed','RHS range moved'])await t.test(name,()=>{
    const h=fresh(rhsRow.hir.expectedHir),store=h.functions[0].body[3];
    if(name==='RHS check removed')store.value.kind='arrayRead';
    else if(name==='RHS receiver changed')store.value.receiver.binding=h.functions[0].body[0].binding.id;
    else store.value.range={...store.target.range};
    const error=failure(()=>verifyHir(h,context(rhsRow)));trustedHirError(rhsRow,error,'invalid');
    assert.deepEqual(failure(()=>lowerHir(h,context(rhsRow))),error);
  });
});

test('25d mutation and parameter HIR budgets are checked before projection equality',async t=>{
  const row=(await fixtures())[5];
  /** @type {Array<[string,(h:any)=>void]>} */
  const changes=[
    ['params9',h=>{h.functions[0].parameters=Array.from({length:9},()=>fresh(h.functions[0].parameters[0]));}],
    ['mutations33',h=>{const f=h.functions[0];f.body=[f.body[0],...Array.from({length:33},()=>fresh(f.body[3])),f.body.at(-1)];}],
    ['statements51',h=>{const f=h.functions[0];f.body=Array.from({length:51},()=>fresh(f.body[0]));}],
  ];
  for(const [name,mutate]of changes)await t.test(name,()=>{
    const h=fresh(row.hir.expectedHir);mutate(h);
    assert.deepEqual(failure(()=>verifyHir(h,context(row))),hirError('limit'));
    assert.deepEqual(failure(()=>lowerHir(h,context(row))),hirError('limit'));
  });
});

test('25d active v3 paths reject old v1 facts and HIR with no compatibility route',async()=>{
  const rows=await fixtures(),row=rows[0];
  const oldFacts=JSON.parse(await readFile(new URL('./array-facts-oracle-v1.json',import.meta.url),'utf8')).cases[0];
  factsFailure(failure(()=>readArrayFactsCandidate(Buffer.from(oldFacts.packageText))),'schema');
  const oldHir=JSON.parse(await readFile(new URL('./array-hir-oracle-v1.json',import.meta.url),'utf8')).cases[0];
  trustedHirError(row,failure(()=>verifyHir(oldHir.expectedHir,context(row))),'invalid');
  trustedHirError(row,failure(()=>readHir(Buffer.from(oldHir.hirText),context(row))),'invalid');
  const result=buildHir(oldFacts.package,context(row));assert.equal(result.status,'error');
});
