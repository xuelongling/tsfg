// SPDX-License-Identifier: MIT
// Actual official Source and actual LLVM DataLayout packets; no ABI constants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {readComponentLayouts,printComponentLayouts,componentLayoutSchema} from '../../compiler/component-layouts.mjs';
const hir=name=>{const bytes=readFileSync(new URL('./testdata/component-layouts/'+name+'-facts.json',import.meta.url)),facts=readCommonProgramFacts(bytes);
  return buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId});};
const actual=readFileSync(new URL('../../runtime/jobs/testdata/component-layout.json',import.meta.url)),positive=hir('positive');
for(const [name,layoutFile]of [['positive','component-layout.json'],['scalar-edges','component-layout-scalars.json'],['nested-component','component-layout-nested.json'],['depth-32-declare','component-layout-depth32.json']])test('actual Source/DataLayout cold component catalog: '+name,()=>{
  const input=hir(name),bytes=readFileSync(new URL('../../runtime/jobs/testdata/'+layoutFile,import.meta.url)),layout=readComponentLayouts(bytes,input);
  assert.deepEqual(printComponentLayouts(layout,input),bytes);assert.equal(layout.hirDigest,sha256(canonical(input)+'\n'));
  assert.deepEqual(layout.components,input.types.filter(t=>t.nominalKey?.category==='component').map(t=>t.id).sort());
  assert.ok(Object.isFrozen(layout)&&layout.types.every(t=>Object.isFrozen(t)&&Object.isFrozen(t.fields)));
});
test('GC component content is a storage capability boundary on original complete Source',()=>{
  assert.throws(()=>readComponentLayouts(actual,hir('reference-negative')),{code:'r10-component-capability'});
});
const edit=mutate=>{const envelope=JSON.parse(actual.toString()),payload=JSON.parse(envelope.payload);mutate(envelope,payload);
  envelope.payload=canonical(payload);envelope.payloadHash=sha256('tsfg.component-layout.v1\0'+envelope.payload);return Buffer.from(canonical(envelope)+'\n');};
const component=p=>p.types.find(t=>t.kind==='component'&&t.fields.length>1);
const cases=[
 ['wrong-family',e=>{e.family='foreign';}],['wrong-version',e=>{e.version=2;}],['wrong-schema',e=>{e.schemaHash='sha256:'+'0'.repeat(64);}],
 ['wrong-input',(e,p)=>{p.inputIdentity='sha256:'+'0'.repeat(64);}],['wrong-whole-hir',(e,p)=>{p.hirDigest='sha256:'+'0'.repeat(64);}],
 ['wrong-target',(e,p)=>{p.target.pointerBits='32';}],['partial-components',(e,p)=>{p.components.pop();}],
 ['partial-types',(e,p)=>{p.types.pop();}],['reordered-types',(e,p)=>{p.types.reverse();}],
 ['extra-type-field',(e,p)=>{p.types[0].foreign=1;}],['wrong-scalar-label',(e,p)=>{p.types.find(t=>t.kind==='scalar').scalar='u64';}],
 ['wrong-field-order',(e,p)=>{component(p).fields.reverse();}],['wrong-field-type',(e,p)=>{component(p).fields[0].type='sha256:'+'0'.repeat(64);}],
 ['wrong-utf16-anchor',(e,p)=>{component(p).fields[0].range.start++;}],['wrong-original-path',(e,p)=>{component(p).fields[0].sourcePath='/foreign.ts';}],
 ['wrong-readonly',(e,p)=>{component(p).fields[0].readonly=true;}],['bad-alignment',(e,p)=>{component(p).alignment=3;}],
 ['bad-stride',(e,p)=>{component(p).stride++;}],['overlap',(e,p)=>{component(p).fields[1].offset=0;}],
 ['unaligned-member',(e,p)=>{component(p).fields[1].offset++;}],['outside-member',(e,p)=>{component(p).fields[0].offset=65536;}],
];
for(const[name,mutate]of cases)test('cold component boundary rejects '+name,()=>assert.throws(()=>readComponentLayouts(edit(mutate),positive)));
test('component bytes and owned roundtrip never replace the bound semantic inputs',()=>{
  const bad=JSON.parse(actual.toString());bad.payloadHash='sha256:'+'0'.repeat(64);assert.throws(()=>readComponentLayouts(Buffer.from(canonical(bad)+'\n'),positive));
  assert.throws(()=>readComponentLayouts(Buffer.concat([actual,Buffer.from('\n')]),positive));
  const layout=readComponentLayouts(actual,positive);assert.throws(()=>printComponentLayouts({...layout},positive));
  assert.equal(JSON.parse(actual.toString()).schemaHash,componentLayoutSchema);
});

test('cold boundary rejects actual old-producer cached-DAG overflow bytes',()=>{
  const bytes=readFileSync(new URL('../../runtime/jobs/testdata/component-layout-invalid-depth.json',import.meta.url));
  assert.throws(()=>readComponentLayouts(bytes,hir('depth-dag-overflow-declare')),/cached fixed component type path exceeds 32 nodes/);
});
