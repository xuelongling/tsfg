// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import {sample,bytes,canonical,clone,hash,base} from './module-callable-fixtures.mjs';
// Independently checked ninth Source package, separate from the frozen eight.
// Both star branches resolve to the same original declaration. Provenance still
// requires the first resolving declaration in source order.
const fixture=JSON.parse(await readFile(new URL('./module-callable-export-star.json',import.meta.url),'utf8'));
const barrel=fixture.request.input.files.find(f=>f.path==='/src/barrel.ts').content;
const firstStart=barrel.indexOf('export'),firstEnd=barrel.indexOf(';',firstStart)+1;
const secondStart=barrel.indexOf('export',firstEnd),secondEnd=barrel.indexOf(';',secondStart)+1;
assert.equal(barrel,"export * from './path1';\nexport * from './path2';\n");
const group=packet=>packet.payload.exports.find(m=>m.sourcePath==='/src/barrel.ts');
const chosen=packet=>group(packet).bindings.find(b=>b.name==='chosen');
const snapshot=()=>({format:{family:'tsfg.frontend-module-callable-candidate',version:2,schemaHash:fixture.request.schemaHash},inputIdentity:fixture.packet.payload.inputIdentity,sourceOrigin:fixture.sourceOrigin,request:fixture.request,package:fixture.packet});
test('independent actual star graph imports and builds using the first resolving source site',async()=>{
 assert.deepEqual(chosen(fixture.packet).range,{start:firstStart,end:firstEnd});
 assert.equal(hash(bytes(fixture.request)),fixture.sourceOrigin.requestSha256);assert.equal(hash(bytes(fixture.packet)),fixture.sourceOrigin.responseSha256);
 const result=await importCapturedFrontendResponse(bytes(fixture.request),bytes(fixture.packet),clone(fixture.sourceOrigin));
 assert.equal(result.status,'ok',canonical(result));assert.deepEqual(result.snapshot,snapshot());
 const built=buildHir(result.snapshot);assert.equal(built.status,'ok',canonical(built));assert.equal(built.hir.modules.length,5);
 const first=sample('first-rr');assert.deepEqual(built.hir.functions.filter(f=>f.kind==='source'),first.hir.functions.filter(f=>f.kind==='source'));assert.deepEqual(built.hir.globals,first.hir.globals);assert.deepEqual(built.hir.types,first.hir.types);
});
test('second resolving star provenance is rejected even for the same target and repaired outer digests',async()=>{
 const packet=clone(fixture.packet),before=clone(packet.payload.facts.modules),binding=chosen(packet),target=binding.target;
 binding.range={start:secondStart,end:secondEnd};
 assert.equal(binding.target,target);assert.deepEqual(packet.payload.facts.modules,before);
 // No request/source/semantic or raw legacy export row changes. Only the
 // enriched exporting site and unavoidable enclosing transport digests differ.
 const{packageId,...body}=packet;packet.packageId=hash('tsfg.module-callable-facts.package.v2\0'+canonical(body));
 const origin={...clone(fixture.sourceOrigin),responseSha256:hash(bytes(packet))};
 const result=await importCapturedFrontendResponse(bytes(fixture.request),bytes(packet),origin);
 assert.equal(result.status,'error','second same-target star must not pass provenance');assert.equal(result.diagnostics.length,1);
 for(const[k,v]of Object.entries(base('source','module callable source facts differ')))assert.deepEqual(result.diagnostics[0][k],v,k);
});
