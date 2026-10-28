// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { sourceInput } from '../../compiler/pipeline.mjs';
import { prepareFrontendInput } from '../../compiler/frontend-response.mjs';

test('M18 ordinary Source boundary admits the exact 286-entry conversion declaration', async () => {
  const input = await sourceInput('export function entry(x:f64):i8 { return checked_i8_from_f64(x); }', {declarationVersion:'minimal-conversions-v5'});
  const prepared = await prepareFrontendInput(input);
  assert.equal(prepared.status, 'ready');
  const declaration = JSON.parse(await readFile(new URL('../../contracts/conversion-entries.json', import.meta.url), 'utf8'));
  assert.equal(declaration.entries.length, 286);
  const forged = structuredClone(input);
  forged.files[1].content += '\ndeclare function checked_i8_from_f64(x:f64):i8;';
  assert.equal((await prepareFrontendInput(forged)).status, 'error');
});
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir, lowerFormalHir, verifyHir, printHir, readHir} from '../../compiler/hir.mjs';
import {conversionDeclaration} from '../../compiler/conversions.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {conversionFacts,ordinaryFacts,defaultFacts,optionalFacts,postfixFacts} from './m18-ordinary-facts.mjs';

// Independently authored facts at the owned Source/HIR boundary. This does not
// execute a Source binary or assert qualification of the synthetic producer.

test('M18 owned conversion facts lower checked wrap and reinterpret with exact nominal types',async()=>{
  for(const [from,to,mode,op] of [['f64','i8','checked','convert_checked'],['u64','i8','wrap','convert_wrap'],['u32','f32','reinterpret','reinterpret']]) {
    const snapshot=await conversionFacts(from,to,mode);
    validateFrontendSnapshot(snapshot);
    const result=buildHir(snapshot);
    assert.equal(result.status,'ok',JSON.stringify(result));
    const hir=readHir(Buffer.from(printHir(result.hir)));
    const core=lowerFormalHir(hir);
    assert.ok(core.includes(`"tsfg_core.${op}"`),core);
    assert.equal(hir.functions[0].body[0].value.kind,'conversion');
    for(const mutate of [h=>{h.functions[0].body[0].value.origin.entryId='sha256:'+'0'.repeat(64);},h=>{h.inputScope.config.strict=false;h.inputIdentity=sha256(canonical(h.inputScope));h.functions[0].body[0].value.origin.inputIdentity=h.inputIdentity;},h=>{h.functions[0].body[0].value.operand.type=h.functions[0].body[0].value.type;}]) {
      const forged=structuredClone(hir);mutate(forged);assert.throws(()=>verifyHir(forged));assert.throws(()=>lowerFormalHir(forged));
    }
  }
});


test('M18 ordinary compound assignment captures the old local before RHS writes',async()=>{
  const result=buildHir(await ordinaryFacts());assert.equal(result.status,'ok',JSON.stringify(result));
  const hir=readHir(Buffer.from(printHir(result.hir))), core=lowerFormalHir(hir);
  assert.match(core,/"tsfg_core.add"\(%v0, %v1\)/);
  assert.match(core,/%v0 = "tsfg_core.constant"\(\) \{value = 1 : i32/);
  assert.match(core,/%v1 = "tsfg_core.constant"\(\) \{value = 5 : i32/);
});

test('M18 ordinary default parameters retain absence tags and initialize only undefined',async()=>{

  const snapshot=await defaultFacts();
  const result=buildHir(snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
  const hir=readHir(Buffer.from(printHir(result.hir))),core=lowerFormalHir(hir);
  assert.match(core,/func.func @"entry"\(%v0: i32, %v1: i32\)/);
  assert.match(core,/tsfg_core.parameter_presence = "0d"/);
  assert.match(core,/"tsfg_core.eq"\(%v1,/);
  assert.match(core,/cf.cond_br/);
  const forged=structuredClone(hir);forged.functions[0].body[0].value.presenceFlow.undefined=true;
  assert.throws(()=>verifyHir(forged));
});

test('M18 every declared conversion entry survives owned facts and formal lowering',async()=>{
  for(const entry of conversionDeclaration.entries) {
    const result=buildHir(await conversionFacts(entry.from,entry.to,entry.mode));
    assert.equal(result.status,'ok',entry.name+': '+JSON.stringify(result));
    const core=lowerFormalHir(result.hir);
    const op={checked:'convert_checked',wrap:'convert_wrap',reinterpret:'reinterpret'}[entry.mode];
    assert.ok(core.includes(`"tsfg_core.${op}"`),entry.name);
  }
});

test('M18 ordinary optional parameter coalescing assignment carries payload and state through one SSA join',async()=>{

  const snapshot=await optionalFacts();
  const result=buildHir(snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
  const core=lowerFormalHir(readHir(Buffer.from(printHir(result.hir))));
  assert.match(core,/tsfg_core.parameter_presence = "05"/);
  assert.match(core,/"tsfg_core.ne"\(%v1,/);
  assert.match(core,/\^bb3\(%v\d+: i32, %v\d+: i32, %v\d+: i32\)/);
  const forged=structuredClone(result.hir);forged.functions[0].body[0].value.operator='=';
  assert.throws(()=>verifyHir(forged));
});

test('M18 ordinary postfix update returns its old value and exposes the new local to its right operand',async()=>{

  const snapshot=await postfixFacts();
  const result=buildHir(snapshot);assert.equal(result.status,'ok',JSON.stringify(result));
  const core=lowerFormalHir(readHir(Buffer.from(printHir(result.hir))));
  assert.match(core,/%v2 = "tsfg_core.add"\(%v0, %v1\)/);
  assert.match(core,/%v3 = "tsfg_core.add"\(%v0, %v2\)/);
});
