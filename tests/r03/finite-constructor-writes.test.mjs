// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteFieldPhases} from '../../compiler/finite-field-phases.mjs';
import {sha256} from '../../compiler/identity.mjs';

// Source-only expectations from the existing accepted fe82/e4f inputs. These
// describe static permission and real SSA order, never executed payload values.
const input={
  own:{source:'fe82bbf8cf08c1c8a188040c28045067f831ca768ad8273b59cf0a23a7050777',folder:'typed-array-source514',
    packet:'2b3001140d229dea794442b5d1fc77fd7e3dadfc2e90df2d35a7ae78ff25f9e7',
    sourceText:'class Base{protected constructor(public readonly n:i32){}} class D extends Base{readonly x:i32;constructor(a:i32[],i:u32){super(a[i]);this.x=a[i];}} export function make(a:i32[],i:u32):D{return new D(a,i);}'},
  view:{source:'e4f00044a7053cd8d9cb87fc6f2bef2102f35e459ff1f0971289ce9974522f6a',folder:'typed-array-reference-domain',
    packet:'e56cebf4ab207153f5a53d1acd738337a64a93c1fe85148f9ce78733d013e18b',
    sourceText:'class Frozen{readonly n:i32=1;} class Writable{n:i32=1;} export function f(a:Frozen):i32{const b:Writable=a;b.n=7;return a.n;}'}
};
async function actual(row) {
  const bytes=await readFile(new URL('./testdata/'+row.folder+'/'+row.source+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),row.packet);const facts=readTypedArrayFacts(bytes);
  assert.equal(facts.payload.files.find(row=>row.path==='/src/main.ts').content,row.sourceText);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const result=buildHir(facts,context);assert.equal(result.status,'ok',JSON.stringify(result.diagnostics));
  return {hir:result.hir,context};
}
test('accepted own readonly constructor store retains direct receiver, successful super and completed native phase',async()=>{
  const {hir,context}=await actual(input.own),derived=hir.types.find(row=>row.base),field=derived.fields[0];
  assert.equal(field.name,'x');assert.equal(field.readonly,true);
  const frame=hir.functions.find(row=>row.id===derived.constructor);assert.equal(frame.role,'construction-body');
  assert.equal(frame.ownerType,derived.id);
  const phases=buildFiniteFieldPhases(hir,context),phase=phases.find(row=>row.ownerType===derived.id);
  assert.deepEqual(phase.events.map(row=>[row.kind,row.output.field,row.output.state]),[['nativeDefine',field.id,'defined-native-undefined']]);
  const core=lowerFormalHir(hir,context),start=core.indexOf('func.func @"f'+frame.id.slice(7)+'"(');
  assert.ok(start>=0);const text=core.slice(start,core.indexOf('\n  }',start));
  const receiver=text.match(/\((%v\d+):/)[1],store=text.split('\n').find(row=>row.includes('"tsfg_core.domain.field_store"'));
  assert.ok(store);
  assert.ok(store.includes('"tsfg_core.domain.field_store"('+receiver+', '));
  assert.ok(store.includes('member = "'+field.id+'"')&&store.includes('receiver_view = "'+derived.id+'"'));
  const superAt=text.indexOf('"tsfg_core.domain.super"'),phaseAt=text.indexOf('"tsfg_core.domain.initialize_fields"'),
    defineAt=text.indexOf('"tsfg_core.domain.field_define"'),storeAt=text.indexOf(store);
  assert.ok(superAt>=0&&phaseAt>superAt&&defineAt>phaseAt&&storeAt>defineAt);
  const rhs=text.lastIndexOf('"tsfg_core.domain.array_read"',storeAt);
  assert.ok(rhs>defineAt&&rhs<storeAt,'checked RHS executes after actual native definition and before the body store');
  const from=input.own.sourceText.indexOf('this.x=a[i]');
  assert.ok(store.includes('tsfg_source.start = '+from+' : i64')&&store.includes('tsfg_source.end = '+(from+11)+' : i64'));
  assert.equal(text.split('"tsfg_core.domain.field_store"').length-1,1,'body assignment remains an ordinary successful store');
});
test('the existing mutable static alias remains writable on a readonly-declared actual instance',async()=>{
  const {hir,context}=await actual(input.view),frozen=hir.types.find(row=>row.fields?.some(field=>field.readonly)),
    writable=hir.types.find(row=>row.fields?.some(field=>!field.readonly));
  assert.equal(frozen.fields[0].name,'n');assert.equal(writable.fields[0].name,'n');
  const core=lowerFormalHir(hir,context),store=core.split('\n').find(row=>row.includes('"tsfg_core.domain.field_store"'));
  assert.ok(store);
  assert.ok(store.includes('receiver_view = "'+writable.id+'"'));
  assert.ok(store.includes(frozen.id)&&store.includes(frozen.fields[0].id),'actual field dispatch keeps readonly declaration identity');
  assert.notEqual(hir.functions.find(row=>row.name==='f').role,'construction-body','ordinary function did not acquire a construction role');
});
