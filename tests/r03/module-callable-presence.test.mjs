// SPDX-License-Identifier: MIT
// Portable regression for the independently reproduced presence provenance RED.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import {sample,bytes,canonical,clone,hash,base} from './module-callable-fixtures.mjs';
const finite=sample('finite-conflicts'),first=sample('first-rr');
const i32=JSON.parse(await readFile(new URL('./module-callable-i32-oracle.json',import.meta.url),'utf8'));
const direct=JSON.parse(await readFile(new URL('./module-callable-presence-direct.json',import.meta.url),'utf8'));
const fn=(packet,name)=>packet.payload.facts.functions.find(f=>f.name===name);
// Canonical registry equality remains intact whenever a raw symbol is changed.
function alterSymbol(packet,id,change){let count=0;function walk(value){if(!value||typeof value!=='object')return;if(value.id===id&&value.kind==='parameter'||value.id===id&&value.kind==='local'){change(value);count++;}for(const x of Object.values(value))if(x&&typeof x==='object')walk(x);}walk(packet.payload.facts);assert.equal(count,2,'registry plus independently embedded declaration');}
async function reject(fixture,change){
 const packet=clone(fixture.packet),before=clone(packet);change(packet);
 assert.deepEqual(packet.payload.annotations,before.payload.annotations);assert.deepEqual(packet.payload.exports,before.payload.exports);
 const{packageId,...body}=packet;packet.packageId=hash('tsfg.module-callable-facts.package.v2\0'+canonical(body));assert.notEqual(packet.packageId,packageId);
 const origin={...clone(fixture.sourceOrigin),responseSha256:hash(bytes(packet))};
 const imported=await importCapturedFrontendResponse(bytes(fixture.request),bytes(packet),origin);
 const accepted=imported.status==='ok'?buildHir(imported.snapshot):imported;
 assert.equal(accepted.status,'error','repaired false raw presence provenance was accepted');assert.equal(accepted.diagnostics.length,1);
 for(const[k,v]of Object.entries(base('source','module callable source facts differ')))assert.deepEqual(accepted.diagnostics[0][k],v,k);
}
for(const fixture of [finite,first,i32])test('unchanged complete presence path control '+fixture.name,async()=>{
 assert.equal(hash(bytes(fixture.request)),fixture.sourceOrigin.requestSha256);assert.equal(hash(bytes(fixture.packet)),fixture.sourceOrigin.responseSha256);
 const imported=await importCapturedFrontendResponse(bytes(fixture.request),bytes(fixture.packet),clone(fixture.sourceOrigin));
 assert.equal(imported.status,'ok',canonical(imported));assert.deepEqual(imported.snapshot,fixture.snapshot);
 const built=buildHir(imported.snapshot);assert.equal(built.status,'ok',canonical(built));assert.deepEqual(built.hir,fixture.hir);
});
test('original causal scalar presence annotation mutation remains rejected after outer digest repair',async()=>{
 const symbol=finite.packet.payload.facts.symbols.find(s=>s.id==='s11');assert.equal(symbol.name,'flag');assert.deepEqual(symbol.presence.annotation,{start:78,end:82});
 await reject(finite,packet=>alterSymbol(packet,'s11',s=>{assert.deepEqual(s.presence.annotation,{start:78,end:82});s.presence.annotation={start:0,end:1};}));
});
test('scalar presence range must be the complete original ParameterDeclaration',async()=>{
 assert.deepEqual(fn(finite.packet,'choose').parameters[0].presence.range,{start:72,end:82});
 await reject(finite,packet=>alterSymbol(packet,'s11',s=>{s.presence.range={start:73,end:82};}));
});
test('a real same-type annotation from another parameter cannot replace its own annotation anchor',async()=>{
 const other=fn(finite.packet,'entry').parameters[0].presence.annotation;assert.notDeepEqual(other,fn(finite.packet,'choose').parameters[0].presence.annotation);
 await reject(finite,packet=>alterSymbol(packet,'s11',s=>{s.presence.annotation=clone(other);}));
});
test('callable direct signature must not acquire scalar-header presence metadata',async()=>{
 const signature=fn(first.packet,'entry').body[0].initializer.signature;assert.equal(Object.hasOwn(signature,'presence'),false);assert.deepEqual(signature.parameters,['function']);
 await reject(first,packet=>{fn(packet,'entry').body[0].initializer.signature.presence=[null];});
});
test('nested callable parameter signature rejects schema-legal injected presence',async()=>{
 const signature=fn(first.packet,'entry').body[0].initializer.signature.parameterSignatures[0];assert.equal(Object.hasOwn(signature,'presence'),false);
 await reject(first,packet=>{fn(packet,'entry').body[0].initializer.signature.parameterSignatures[0].presence=[null];});
});
test('nested callable return signature rejects schema-legal injected presence',async()=>{
 const signature=fn(first.packet,'entry').body[0].initializer.signature.returnSignature;assert.equal(Object.hasOwn(signature,'presence'),false);
 await reject(first,packet=>{fn(packet,'entry').body[0].initializer.signature.returnSignature.presence=[null];});
});
test('callable parameter symbol signatures preserve metadata absence in registry and embedded row',async()=>{
 const p=fn(first.packet,'identity').parameters[0];assert.equal(p.type,'function');assert.equal(Object.hasOwn(p.signature,'presence'),false);
 await reject(first,packet=>alterSymbol(packet,p.id,s=>{s.signature.presence=[null];}));
});
test('callable local symbol signatures preserve metadata absence in registry and embedded row',async()=>{
 const local=fn(first.packet,'entry').body[0].symbol;assert.equal(local.type,'function');assert.equal(Object.hasOwn(local.signature,'presence'),false);
 await reject(first,packet=>alterSymbol(packet,local.id,s=>{s.signature.presence=[null];}));
});
test('callable function returnSignature preserves metadata absence',async()=>{
 assert.equal(Object.hasOwn(fn(first.packet,'identity').returnSignature,'presence'),false);
 await reject(first,packet=>{fn(packet,'identity').returnSignature.presence=[null];});
});
test('i32 functionReference signature has no presence even with a real scalar parameter',async()=>{
 const identity=fn(i32.packet,'identity'),reference=fn(i32.packet,'use').body[0].initializer;
 assert.equal(reference.kind,'functionReference');assert.deepEqual(reference.signature.parameters,['i32']);assert.equal(Object.hasOwn(reference.signature,'presence'),false);
 await reject(i32,packet=>{fn(packet,'use').body[0].initializer.signature.presence=[clone(identity.parameters[0].presence)];});
});
test('i32 indirectCall signature has no presence even with valid scalar declaration metadata',async()=>{
 const use=fn(i32.packet,'use'),call=use.body[1].expression;assert.equal(call.kind,'indirectCall');assert.deepEqual(call.signature.parameters,['i32']);assert.equal(Object.hasOwn(call.signature,'presence'),false);
 await reject(i32,packet=>{fn(packet,'use').body[1].expression.signature.presence=[clone(use.parameters[0].presence)];});
});
test('i32 callable reference signature preserves function-value metadata absence',async()=>{
 const call=fn(i32.packet,'use').body[1].expression;assert.equal(call.callee.kind,'reference');assert.equal(Object.hasOwn(call.callee.signature,'presence'),false);
 await reject(i32,packet=>{fn(packet,'use').body[1].expression.callee.signature.presence=[clone(fn(i32.packet,'use').parameters[0].presence)];});
});

test('independent direct i32 packet retains full scalar header presence through public import and build',async()=>{
 assert.equal(hash(bytes(direct.request)),direct.sourceOrigin.requestSha256);assert.equal(hash(bytes(direct.packet)),direct.sourceOrigin.responseSha256);
 const identity=fn(direct.packet,'identity'),call=fn(direct.packet,'use').body[0].expression;
 assert.equal(call.kind,'call');assert.deepEqual(call.signature,{parameters:['i32'],returnType:'i32',presence:[clone(identity.parameters[0].presence)]});
 assert.deepEqual(identity.parameters[0].presence,{undefined:false,null:false,optional:false,default:false,range:{start:25,end:35},annotation:{start:32,end:35}});
 const imported=await importCapturedFrontendResponse(bytes(direct.request),bytes(direct.packet),clone(direct.sourceOrigin));
 assert.equal(imported.status,'ok',canonical(imported));assert.deepEqual(imported.snapshot.package,direct.packet);assert.deepEqual(imported.snapshot.request,direct.request);
 const built=buildHir(imported.snapshot);assert.equal(built.status,'ok',canonical(built));
 const retained=fn(built.hir.snapshot.package,'use').body[0].expression.signature;assert.deepEqual(retained,call.signature);
 const identityHIR=built.hir.functions.find(f=>f.name==='identity'),useHIR=built.hir.functions.find(f=>f.name==='use');assert.equal(useHIR.body[0].value.kind,'call');assert.equal(useHIR.body[0].value.target,identityHIR.id);
});
test('direct scalar signature cannot silently discard its actual required presence vector',async()=>{
 await reject(direct,packet=>{assert.equal(fn(packet,'use').body[0].expression.signature.presence.length,1);delete fn(packet,'use').body[0].expression.signature.presence;});
});
test('direct scalar signature presence annotation must retain the actual callee TypeNode anchor',async()=>{
 await reject(direct,packet=>{fn(packet,'use').body[0].expression.signature.presence[0].annotation={start:0,end:1};});
});
test('direct scalar signature presence range cannot be replaced by the caller ParameterDeclaration',async()=>{
 await reject(direct,packet=>{const use=fn(packet,'use');use.body[0].expression.signature.presence[0].range=clone(use.parameters[0].presence.range);});
});
