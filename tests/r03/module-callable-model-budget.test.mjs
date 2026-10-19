// SPDX-License-Identifier: MIT
// Exact mechanical probes are malformed at the cap; they are not legal-max
// program claims. Actual Source model captures are tested separately below.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,verifyHir,readHir} from '../../compiler/hir.mjs';
import {sample,bytes,canonical,clone,hash,base,assertError} from './module-callable-fixtures.mjs';
const fixture=sample('first-rr'),MAX=8388608,TOKENS=200000;
const size=value=>Buffer.byteLength(canonical(value));
// Grammar-token count: object/array delimiters2, object key1, each primitive1.
const tokens=value=>value&&typeof value==='object'?Array.isArray(value)?2+value.reduce((n,x)=>n+tokens(x),0):2+Object.entries(value).reduce((n,[k,v])=>n+1+tokens(v),0):1;
const errorMessages={input:'invalid module callable candidate',reconstruct:'module callable HIR differs from complete reconstruction',limit:'module callable candidate budget exceeded'};
const fails=(run,kind)=>assert.throws(run,error=>assertError(error,base(kind,errorMessages[kind])));
function diagnostic(result,kind){assert.equal(result.status,'error');assert.equal(result.diagnostics.length,1);const message=kind==='limit'?'module callable candidate budget exceeded':kind==='canonical'?'module callable candidate must use canonical JSON plus LF':'invalid module callable candidate';for(const[k,v]of Object.entries(base(kind,message)))assert.deepEqual(result.diagnostics[0][k],v,k);}
async function imported(request,packet,raw=bytes(packet),sourceOrigin=fixture.sourceOrigin){const origin={...clone(sourceOrigin),requestSha256:hash(bytes(request)),responseSha256:hash(raw)};return importCapturedFrontendResponse(bytes(request),raw,origin);}
function repair(request,packet,origin){packet.payload.inputIdentity=hash('tsfg.module-callable-facts.input.v1\0'+canonical(request.input));packet.requestId=hash('tsfg.module-callable-facts.request.v1\0'+canonical(request));const{packageId,...body}=packet;packet.packageId=hash('tsfg.module-callable-facts.package.v1\0'+canonical(body));return{...clone(origin),requestSha256:hash(bytes(request)),responseSha256:hash(bytes(packet))};}
function pad(value,target){
 value.extra=Array(7).fill('"'.repeat(524288));const remaining=target-size(value)-3;assert.ok(remaining>=0&&remaining<=1048576);value.extra.push('x'.repeat(remaining));assert.equal(size(value),target);assert.ok(value.extra.every(x=>Buffer.byteLength(x)<=1048576));assert.ok(tokens(value)<TOKENS);return value;
}
test('unchanged selected-family full snapshot and HIR control for mechanical boundary probes',async()=>{
 const result=await imported(fixture.request,fixture.packet);assert.equal(result.status,'ok',canonical(result));assert.deepEqual(result.snapshot,fixture.snapshot);assert.deepEqual(validateFrontendSnapshot(clone(fixture.snapshot)),fixture.snapshot);assert.deepEqual(verifyHir(clone(fixture.hir)),fixture.hir);
});
// HIR cold verification rebuilds the entire DTO from its valid snapshot: at
// the budget cap an extra member is a reconstruction mismatch. Snapshot
// validation separately retains its exact-shape input error.
test('selected HIR whole graph200000/+1 tokens precede complete reconstruction mismatch',()=>{
 for(const extra of [0,1]){const hir=clone(fixture.hir);hir.extra=[];hir.extra=Array(TOKENS+extra-tokens(hir)).fill(null);assert.equal(tokens(hir),TOKENS+extra);assert.ok(size(hir)<MAX);fails(()=>verifyHir(hir),extra?'limit':'reconstruct');}
});
test('public complete request+packet+origin frame200000/+1 tokens is counted before package shape',async()=>{
 for(const extra of [0,1]){const request=clone(fixture.request),packet=clone(fixture.packet),origin=clone(fixture.sourceOrigin);packet.extra=[];const frame={request,packet,origin};packet.extra=Array(TOKENS+extra-tokens(frame)).fill(null);const repaired=repair(request,packet,origin);assert.equal(tokens({...frame,origin:repaired}),TOKENS+extra);assert.ok(tokens(packet)<TOKENS);assert.ok(size(frame)<MAX);diagnostic(await imported(request,packet,bytes(packet),repaired),extra?'limit':'input');}
});
test('public package token reader has exact200000/+1 priority before noncanonical input',async()=>{
 for(const extra of [0,1]){const packet=clone(fixture.packet);packet.extra=[];packet.extra=Array(TOKENS+extra-tokens(packet)).fill(null);assert.equal(tokens(packet),TOKENS+extra);const raw=Buffer.from(' '+canonical(packet)+'\n');assert.ok(raw.length<MAX);diagnostic(await imported(fixture.request,packet,raw),extra?'limit':'canonical');}
});
test('selected snapshot and HIR escaped whole graph8MiB/+1 includes the complete original capture',()=>{
 for(const extra of [0,1]){const snapshot=pad(clone(fixture.snapshot),MAX+extra),hir=pad(clone(fixture.hir),MAX+extra);fails(()=>validateFrontendSnapshot(snapshot),extra?'limit':'input');fails(()=>verifyHir(hir),extra?'limit':'reconstruct');}
});
test('cold selected HIR wire8MiB includes its LF and rejects the adjacent byte',()=>{
 for(const extra of [0,1]){const hir=pad(clone(fixture.hir),MAX-1+extra),raw=bytes(hir);assert.equal(raw.length,MAX+extra);fails(()=>readHir(raw),extra?'limit':'reconstruct');}
});
test('public aggregate capture frame8MiB/+1 is stricter than its individual package',async()=>{
 for(const extra of [0,1]){const request=clone(fixture.request),packet=clone(fixture.packet),origin=clone(fixture.sourceOrigin);packet.extra=Array(7).fill('"'.repeat(524288));const frame={request,packet,origin};const remaining=MAX+extra-size(frame)-3;assert.ok(remaining>=0&&remaining<=1048576);packet.extra.push('x'.repeat(remaining));const repaired=repair(request,packet,origin);assert.equal(size({...frame,origin:repaired}),MAX+extra);assert.ok(bytes(packet).length<MAX);diagnostic(await imported(request,packet,bytes(packet),repaired),extra?'limit':'input');}
});
test('public package byte reader8MiB includes LF and precedes noncanonical priority',async()=>{
 const packet=pad(clone(fixture.packet),MAX-2);
 for(const extra of [0,1]){const raw=Buffer.from(' '.repeat(1+extra)+canonical(packet)+'\n');assert.equal(raw.length,MAX+extra);diagnostic(await imported(fixture.request,packet,raw),extra?'limit':'canonical');}
});
test('raw symbol cardinality4096/+1 model guard precedes malformed rows and repaired identity',async()=>{
 for(const extra of [0,1]){const packet=clone(fixture.packet);packet.payload.facts.symbols=Array.from({length:4096+extra},()=>({}));const origin=repair(fixture.request,packet,fixture.sourceOrigin);assert.ok(tokens(packet)<TOKENS);assert.ok(bytes(packet).length<MAX);diagnostic(await imported(fixture.request,packet,bytes(packet),origin),extra?'limit':'input');}
});
test('fresh official Source model captures classify legal inputs and stricter Product whole-HIR budgets',async()=>{
 const captures=JSON.parse(await readFile(new URL('./module-callable-model-budget.json',import.meta.url),'utf8')).cases;
 assert.deepEqual(captures.map(c=>c.name).sort(),['model-ast-16384','model-roots-128','model-symbols-2049']);
 for(const fixture of captures){assert.equal(hash(bytes(fixture.request)),fixture.sourceOrigin.requestSha256);assert.equal(hash(bytes(fixture.packet)),fixture.sourceOrigin.responseSha256);
  const result=await importCapturedFrontendResponse(bytes(fixture.request),bytes(fixture.packet),clone(fixture.sourceOrigin));assert.equal(result.status,'ok',fixture.name+': '+canonical(result));assert.deepEqual(result.snapshot.package,fixture.packet);assert.deepEqual(result.snapshot.request,fixture.request);
  const facts=fixture.packet.payload.facts;assert.equal(facts.symbols.length,fixture.official.symbols);assert.equal(facts.functions.length,fixture.official.functions);
  const built=buildHir(result.snapshot);
  if(fixture.name==='model-roots-128'){assert.equal(fixture.request.input.compilationClosure.roots.length,128);assert.equal(built.status,'ok',canonical(built));assert.equal(built.hir.functions.filter(f=>f.kind==='source').length,128);assert.equal(built.hir.functions.filter(f=>f.kind==='module-initialization').length,1);assert.equal(built.hir.closure.roots.length,128);
   for(const facet of ['roots','requiredRoots']){const request=clone(fixture.request),packet=clone(fixture.packet);const roots=clone(request.input.compilationClosure.roots);roots.push({kind:'application',sourcePath:'/src/app.ts',name:'f000'});roots.sort((a,b)=>Buffer.compare(Buffer.from(a.kind+'\0'+a.sourcePath+'\0'+a.name),Buffer.from(b.kind+'\0'+b.sourcePath+'\0'+b.name)));request.input.compilationClosure[facet]=roots;const origin=repair(request,packet,fixture.sourceOrigin);diagnostic(await imported(request,packet,bytes(packet),origin),'input');}
  }else{if(fixture.name==='model-ast-16384'){assert.equal(fixture.official.ast,16384);assert.equal(fixture.official.symbols,4);}else assert.equal(fixture.official.symbols,2049);diagnostic(built,'limit');}
 }
});
