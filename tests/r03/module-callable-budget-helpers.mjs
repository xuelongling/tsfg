// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {buildHir} from '../../compiler/hir.mjs';
export const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
export const bytes=x=>Buffer.from(canonical(x)+'\n');
export const hash=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const domain=(name,value)=>hash(name+'\0'+canonical(value));
const order=(a,b)=>Buffer.from(a).compare(Buffer.from(b));
export function metrics(value,level=1){
 let tokens=1,depth=typeof value==='object'&&value!==null?level:0,stringBytes=typeof value==='string'?Buffer.byteLength(value):0;
 if(value&&typeof value==='object'){
  tokens=2;
  for(const [key,child]of Object.entries(value)){
   if(!Array.isArray(value)){tokens++;stringBytes=Math.max(stringBytes,Buffer.byteLength(key));}
   const row=metrics(child,level+1);tokens+=row.tokens;depth=Math.max(depth,row.depth);stringBytes=Math.max(stringBytes,row.stringBytes);
  }
 }
 return {bytes:Buffer.byteLength(canonical(value)),tokens,depth,stringBytes};
}
export function within(value,label){const m=metrics(value);assert.ok(m.bytes<=8388608,label+' bytes '+m.bytes);assert.ok(m.tokens<=200000,label+' tokens '+m.tokens);assert.ok(m.depth<=128,label+' depth '+m.depth);assert.ok(m.stringBytes<=1048576,label+' string '+m.stringBytes);return m;}
export async function capture(name){
 const bundle=JSON.parse(await readFile(new URL('./module-callable-budget-data/'+name+'.json',import.meta.url),'utf8'));
 assert.equal(bundle.name,name);assert.ok(bundle.sourceOrigin,'Root-qualified Source custody is required; never synthesize it');
 const {request,packet,sourceOrigin}=bundle;
 assert.equal(sourceOrigin.requestSha256,hash(bytes(request)));assert.equal(sourceOrigin.responseSha256,hash(bytes(packet)));
 assert.equal(packet.requestId,domain('tsfg.module-callable-facts.request.v1',request));
 const {packageId,...body}=packet;assert.equal(packageId,domain('tsfg.module-callable-facts.package.v1',body));
 const front=within({request,packet,origin:sourceOrigin},name+' complete import graph');
 const imported=await importCapturedFrontendResponse(bytes(request),bytes(packet),sourceOrigin);
 assert.equal(imported.status,'ok',name+' must cross the real public import before a model/analysis budget assertion: '+canonical(imported));
 within(imported.snapshot,name+' snapshot');
 const built=buildHir(imported.snapshot);
 if(bundle.kind==='types'&&bundle.scale===257){assert.equal(built.status,'error');assert.equal(built.diagnostics.length,1);assert.equal(built.diagnostics[0].code,'r03-module-callable-limit');return {bundle,built,front};}
 assert.equal(built.status,'ok',name+' must cross real public typed build before analysis limit: '+canonical(built));
 const hir=built.hir,hirMetrics=within(hir,name+' HIR');
 console.log('TSFG_MODULE_CALLABLE_23D_BUDGET_FRONT '+canonical({name,front,hir:hirMetrics}));
 return {bundle,hir,front,hirMetrics};
}
function rawType(kind,signature){if(kind!=='function')return kind;return {parameters:signature.parameters.map((k,i)=>rawType(k,signature.parameterSignatures?.[i])),returns:rawType(signature.returnType,signature.returnSignature)};}
export function publication(bundle,hir){
 const raw=bundle.packet.payload.facts,source=hir.functions.filter(f=>f.kind==='source');
 for(const f of raw.functions){const descriptor={parameters:f.parameters.map(p=>rawType(p.type,p.signature)),returns:rawType(f.returnType,f.returnSignature)};const signatureHash=domain('tsfg.module-callable-signature.candidate.v1',descriptor);const id=domain('tsfg.module-callable-function.candidate.v1',{path:f.sourcePath,name:f.name,signatureHash});const actual=source.find(x=>x.sourcePath===f.sourcePath&&x.name===f.name);assert.equal(actual?.id,id);assert.equal(actual.signatureHash,signatureHash);}
 const globals=hir.globals.map(g=>g.id).sort(order),sorted=[...source].sort((a,b)=>order(a.id,b.id));
 const candidates=source.filter(f=>/^f\d+$/.test(f.name)).map(f=>f.id).sort(order);
 const contracts=sorted.map(f=>{
  const original=raw.functions.find(r=>r.name===f.name&&r.sourcePath===f.sourcePath);
  const parameters=original.parameters.flatMap((p,index)=>p.type==='function'?[{index,allowed:{top:true,functions:[]}}]:[]);
  if(bundle.kind==='solver-growth-top'&&f.name==='invoke')parameters.find(p=>p.index===1).allowed={top:false,functions:candidates};
  let upper={reads:[],writes:[],unknown:false};
  if(bundle.kind==='solver-growth-top'&&['entry','invoke'].includes(f.name))upper={reads:[],writes:[],unknown:true};
  if(bundle.kind==='aggregation-work')upper=f.id===sorted.at(-1).id?{reads:globals,writes:[],unknown:false}:{reads:[],writes:[],unknown:true};
  if(bundle.kind==='aggregation-members')upper=f.name==='callee'?{reads:globals,writes:[],unknown:false}:{reads:[],writes:[],unknown:true};
  const row={functionId:f.id,signatureHash:f.signatureHash,parameters,returns:null,upper};return {...row,digest:domain('tsfg.module-published-call-contract.v1',row)};
 });
 const scope={roots:{roots:hir.closure.roots.map(({kind,sourcePath,name})=>({kind,sourcePath,name})),requiredRoots:hir.closure.requiredRoots},modules:hir.modules.map(({id,sourcePath,dependencies,exports,bindings})=>({moduleId:id,sourcePath,dependencies,exports,bindings})),functions:source.map(f=>({functionId:f.id,sourcePath:f.sourcePath,name:f.name,signatureHash:f.signatureHash,parameters:f.parameters.map(p=>p.type),returnType:f.returnType})),globals:hir.globals.map(({id,sourcePath,name,type,writable})=>({globalId:id,sourcePath,name,type,writable}))};
 const scopeDigest=domain('tsfg.module-call-scope.v1',scope),context={mode:'fixed',scopeDigest,expectedDigest:domain('tsfg.module-call-publication.v1',{scopeDigest,contracts}),contracts};
 within(scope,bundle.name+' independent publication scope');within(context,bundle.name+' independent fixed context');
 return context;
}
export function analysisLimit(error){assert.ok(error instanceof TypeError && 'code' in error && 'ruleId' in error && 'phase' in error);assert.ok(Object.hasOwn(error,'code')&&Object.hasOwn(error,'ruleId')&&Object.hasOwn(error,'phase'));assert.equal(error.code,'r03-d-module-call-effects-limit');assert.equal(error.message,'r03-d-module-call-effects-limit: module call analysis budget exceeded');assert.equal(error.ruleId,'r01-call-contract');assert.equal(error.phase,'analysis');return true;}
export function assertPure(report){for(const row of [...report.functions,...report.initializers]){assert.equal(row.effective.unknown,false);assert.equal(row.effective.reads.length,0);assert.equal(row.effective.writes.length,0);}}
