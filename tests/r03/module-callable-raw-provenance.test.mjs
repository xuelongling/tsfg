// SPDX-License-Identifier: MIT
// Portable regressions for independently observed raw export and callee-name REDs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import {sample,bytes,canonical,clone,hash,base} from './module-callable-fixtures.mjs';
const first=sample('first-rr');
const star=JSON.parse(await readFile(new URL('./module-callable-export-star.json',import.meta.url),'utf8'));
const i32=JSON.parse(await readFile(new URL('./module-callable-i32-oracle.json',import.meta.url),'utf8'));
const module=(packet,path)=>packet.payload.facts.modules.find(m=>m.sourcePath===path);
const fn=(packet,name)=>packet.payload.facts.functions.find(f=>f.name===name);
async function reject(fixture,change){
 const packet=clone(fixture.packet),before=clone(packet);change(packet);
 assert.deepEqual(packet.payload.exports,before.payload.exports,'enriched export custody remains truthful');assert.deepEqual(packet.payload.annotations,before.payload.annotations);
 assert.deepEqual(packet.payload.facts.symbols,before.payload.facts.symbols,'complete symbol registry remains unchanged');
 const{packageId,...body}=packet;packet.packageId=hash('tsfg.module-callable-facts.package.v1\0'+canonical(body));assert.notEqual(packet.packageId,packageId);
 const origin={...clone(fixture.sourceOrigin),responseSha256:hash(bytes(packet))};
 const imported=await importCapturedFrontendResponse(bytes(fixture.request),bytes(packet),origin),accepted=imported.status==='ok'?buildHir(imported.snapshot):imported;
 assert.equal(accepted.status,'error','repaired false original raw provenance passed public import/build');assert.equal(accepted.diagnostics.length,1);
 for(const[k,v]of Object.entries(base('source','module callable source facts differ')))assert.deepEqual(accepted.diagnostics[0][k],v,k);
}
for(const fixture of [first,star,i32])test('complete original raw provenance control '+fixture.name,async()=>{
 assert.equal(hash(bytes(fixture.request)),fixture.sourceOrigin.requestSha256);assert.equal(hash(bytes(fixture.packet)),fixture.sourceOrigin.responseSha256);
 const imported=await importCapturedFrontendResponse(bytes(fixture.request),bytes(fixture.packet),clone(fixture.sourceOrigin));assert.equal(imported.status,'ok',canonical(imported));
 assert.deepEqual(imported.snapshot.package,fixture.packet);assert.deepEqual(imported.snapshot.request,fixture.request);assert.deepEqual(imported.snapshot.sourceOrigin,fixture.sourceOrigin);
 const built=buildHir(imported.snapshot);assert.equal(built.status,'ok',canonical(built));assert.deepEqual(built.hir.snapshot,imported.snapshot);
 if(fixture.hir)assert.deepEqual(built.hir,fixture.hir);
 else{assert.equal(built.hir.modules.length,5);assert.deepEqual(built.hir.functions.filter(f=>f.kind==='source'),first.hir.functions.filter(f=>f.kind==='source'));assert.deepEqual(built.hir.globals,first.hir.globals);assert.deepEqual(built.hir.types,first.hir.types);}
});
test('original causal false legacy raw export anchor is rejected with truthful enriched exports',async()=>{
 await reject(first,packet=>{const row=module(packet,'/src/app.ts').exports[0];assert.notDeepEqual(row.range,{start:0,end:1});row.range={start:0,end:1};});
});
test('named reexport raw site retains its original ExportSpecifier range',async()=>{
 await reject(first,packet=>{const row=module(packet,'/src/barrel.ts').exports.find(b=>b.name==='chosen');assert.notDeepEqual(row.range,{start:0,end:1});row.range={start:0,end:1};});
});
test('star legacy raw export keeps its whole-source fallback independently of the enriched first-star site',async()=>{
 const content=star.request.input.files.find(f=>f.path==='/src/barrel.ts').content;
 const legacy=module(star.packet,'/src/barrel.ts').exports.find(b=>b.name==='chosen'),enriched=star.packet.payload.exports.find(g=>g.sourcePath==='/src/barrel.ts').bindings.find(b=>b.name==='chosen');
 assert.deepEqual(legacy.range,{start:0,end:content.length});assert.deepEqual(enriched.range,{start:0,end:24});assert.notDeepEqual(legacy.range,enriched.range);
 await reject(star,packet=>{module(packet,'/src/barrel.ts').exports.find(b=>b.name==='chosen').range=clone(enriched.range);});
});
test('original causal false raw indirectCall.name is rejected with the original callee expression',async()=>{
 const original=fn(first.packet,'invoke').body[0].expression;assert.equal(original.kind,'indirectCall');assert.equal(original.name,'fn');
 await reject(first,packet=>{const call=fn(packet,'invoke').body[0].expression,callee=clone(call.callee);call.name='forged';assert.deepEqual(call.callee,callee);});
});
test('i32 raw indirect callee name cannot be replaced with another actual lexical name',async()=>{
 const original=fn(i32.packet,'use').body[1].expression;assert.equal(original.kind,'indirectCall');assert.equal(original.name,'selected');
 await reject(i32,packet=>{const call=fn(packet,'use').body[1].expression;call.name='value';assert.equal(call.callee.symbol,original.callee.symbol);assert.deepEqual(call.range,original.range);});
});
