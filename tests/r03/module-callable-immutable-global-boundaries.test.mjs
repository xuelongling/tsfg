// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,verifyHir,printHir,readHir,analyzeModuleCalls,
  verifyKernelParallelGroup} from '../../compiler/hir.mjs';

// These are complete, independently frozen protocol derivations, not official
// Source output or producer qualification. No child/Source/Core/VM executes here.
// All new-alias admission/proof failures are source errors; shape, identity and
// reconstruction failures retain their own layers. Old capability paths stay old.
const data=JSON.parse(await readFile(new URL('./module-callable-immutable-global-boundaries.json',import.meta.url),'utf8'));
const control=data.control;
/** @param {any} v @returns {string} */
function jcs(v){if(Array.isArray(v))return '['+v.map(jcs).join(',')+']';
  if(v!==null&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+jcs(v[k])).join(',')+'}';
  return JSON.stringify(v)??assert.fail('non-JSON independent fixture');}
/** @param {any} v */
const bytes=v=>Buffer.from(jcs(v)+'\n');
/** @param {any} v */
const clone=v=>structuredClone(v);
/** @param {string|Uint8Array} v */
const hash=v=>'sha256:'+createHash('sha256').update(v).digest('hex');
/** @param {string} kind @param {string} message */
const error=(kind,message)=>({code:'r03-module-callable-'+kind,message:'r03-module-callable-'+kind+': '+message,ruleId:'r01-input-boundary',phase:'hir'});
const identity=error('identity','module callable candidate identity differs');
const input=error('input','invalid module callable candidate');
const canonical=error('canonical','module callable candidate must use canonical JSON plus LF');
const reconstruct=error('reconstruct','module callable HIR differs from complete reconstruction');
/** @param {any} actual @param {any} expected */
function dto(actual,expected){for(const[k,v]of Object.entries(expected))assert.deepEqual(actual[k],v,k);return true;}
/** @param {()=>any} run @param {any} expected */
const rejects=(run,expected)=>assert.throws(run,e=>dto(e,expected));
/** @param {any} v */
function frozen(v){if(v===null||typeof v!=='object')return;assert.ok(Object.isFrozen(v));Object.values(v).forEach(frozen);}
/** @param {any} c */
function identities(c){const {packageId,...body}=c.packet;
  assert.equal(c.packet.payload.inputIdentity,hash('tsfg.module-callable-facts.input.v2\0'+jcs(c.request.input)));
  assert.equal(c.packet.requestId,hash('tsfg.module-callable-facts.request.v2\0'+jcs(c.request)));
  assert.equal(packageId,hash('tsfg.module-callable-facts.package.v2\0'+jcs(body)));
  assert.equal(c.sourceOrigin.requestSha256,hash(bytes(c.request)));
  assert.equal(c.sourceOrigin.responseSha256,hash(bytes(c.packet)));
  assert.deepEqual(c.packet.payload.files,c.request.input.files.map(f=>({path:f.path,digest:hash(f.content),
    byteLength:Buffer.byteLength(f.content),length:f.content.length,positionUnit:'utf16'})));
  c.request.input.files.forEach(f=>assert.equal('sha256:'+f.sha256,hash(f.content)));
}
/** @param {any} c */
function seal(c){const{packageId,...body}=c.packet;c.packet.packageId=hash('tsfg.module-callable-facts.package.v2\0'+jcs(body));
  c.sourceOrigin.requestSha256=hash(bytes(c.request));c.sourceOrigin.responseSha256=hash(bytes(c.packet));return c;}
/** @param {any} c */
async function imported(c){return importCapturedFrontendResponse(bytes(c.request),bytes(c.packet),clone(c.sourceOrigin));}

test('independent cold control retains complete original graph and canonical HIR',async()=>{
  assert.equal(data.authority,'SYNTHETIC_PROTOCOL_DERIVATIONS_NOT_SOURCE_OFFICIAL_OR_PRODUCER_QUALIFICATION');
  identities(control);const result=await imported(control);assert.deepEqual(result,{status:'ok',snapshot:control.snapshot});frozen(result);
  assert.deepEqual(validateFrontendSnapshot(clone(control.snapshot)),control.snapshot);
  const built=buildHir(clone(result.snapshot));assert.deepEqual(built,{status:'ok',hir:control.hir});frozen(built.hir);
  assert.deepEqual(verifyHir(clone(control.hir)),control.hir);
  assert.equal(printHir(clone(control.hir)),bytes(control.hir).toString('utf8'));
  assert.deepEqual(readHir(bytes(control.hir)),control.hir);
});
for(const c of data.coldCases)test('cold new-alias boundary: '+c.name,async()=>{
  identities(c);const before=jcs(c),actual=await imported(c);
  assert.deepEqual(actual,{status:'error',diagnostics:[c.error]});frozen(actual);
  const snapshot={format:clone(control.snapshot.format),inputIdentity:c.packet.payload.inputIdentity,
    sourceOrigin:clone(c.sourceOrigin),request:clone(c.request),package:clone(c.packet)};
  rejects(()=>validateFrontendSnapshot(snapshot),c.error);assert.equal(jcs(c),before);
});

test('transitive cycle negative retains leaf to peer to original op and complete declarations',()=>{
  const c=data.coldCases.find(c=>c.name==='transitive-alias-cycle'),raw=c.packet.payload.facts;
  assert.deepEqual(raw.symbols.map(s=>s.id),['s1','s2','s3','s4','s5','s6','s7','s8']);
  assert.equal(raw.functions.find(f=>f.name==='leaf').body[0].expression.target,'s5');
  const peer=raw.functions.find(f=>f.name==='peer').body[0].expression;
  assert.equal(peer.kind,'indirectCall');assert.equal(peer.callee.symbol,'s3');
  assert.equal(raw.modules[0].initialization[1].initializer.target,'s2');
  const cross=data.coldCases.find(c=>c.name==='cross-module-original-initializer');
  assert.equal(cross.packet.payload.facts.modules.length,2);assert.equal(cross.request.input.files.length,3);
  assert.equal(cross.packet.payload.facts.modules[0].imports[0].bindings[0].target,'s4');
  assert.equal(cross.packet.payload.facts.modules[0].initialization[0].initializer.target,'s4');
});

test('wrong wire identity is distinct from schema and source proof failure',async()=>{
  /** @type {Array<[string,(c:any)=>void,any]>} */
  const cases=[['request hash',c=>{c.packet.requestId=hash('foreign request');},identity],
    ['input hash',c=>{c.packet.payload.inputIdentity=hash('foreign input');},identity],
    ['schema hash',c=>{c.packet.schemaHash=hash('foreign schema');},identity],
    ['manifest length',c=>{c.packet.payload.files[0].length++;},identity],
    ['old version',c=>{c.packet.version=1;},input]];
  for(const[name,change,expected]of cases){const c=clone(control);change(c);seal(c);
    const actual=await imported(c);assert.deepEqual(actual,{status:'error',diagnostics:[expected]},name);}
  const c=clone(control);c.sourceOrigin.responseSha256=hash('stale transport');
  assert.deepEqual(await imported(c),{status:'error',diagnostics:[identity]});
  rejects(()=>validateFrontendSnapshot({...clone(control.snapshot),sourceOrigin:c.sourceOrigin}),identity);
});

test('strict canonical transport rejects noncanonical bytes after transport rehash',async()=>{
  const good=bytes(control.packet).toString('utf8');
  for(const text of ['\ufeff'+good,' '+good,good.trimEnd(),good+' ',good.replace('{','{"family":"duplicate",')]){
    const bad=Buffer.from(text),origin={...clone(control.sourceOrigin),responseSha256:hash(bad)};
    assert.deepEqual(await importCapturedFrontendResponse(bytes(control.request),bad,origin),{status:'error',diagnostics:[canonical]});}
  rejects(()=>readHir(Buffer.from(' '+bytes(control.hir))),canonical);
});

test('complete HIR reconstruction rejects fake op binding, call target and partial universe',()=>{
  /** @type {Array<(h:any)=>void>} */
  const changes=[h=>h.functions.pop(),h=>{h.closure.functions=[];},
    h=>{h.functions.find(f=>f.name==='entry').body[0].value.target=hash('foreign target');},
    h=>{h.modules[0].bindings.find(b=>b.name==='op').target=hash('fake GlobalId');},
    h=>{h.functions.find(f=>f.kind==='module-initialization').body=[];}];
  for(const change of changes){const h=clone(control.hir);change(h);rejects(()=>verifyHir(h),reconstruct);}
});

test('unsafe getters and Proxy traps are never invoked at public graph boundaries',()=>{
  let reads=0;const getter={enumerable:true,get(){reads++;throw Error('getter must not run');}};
  const h=clone(control.hir);Object.defineProperty(h.snapshot.package.payload.facts.symbols[2].signature,'untrusted',getter);
  rejects(()=>verifyHir(h),input);
  const s=clone(control.snapshot);Object.defineProperty(s.format,'family',getter);rejects(()=>validateFrontendSnapshot(s),input);
  const proxy=new Proxy(clone(control.hir),{get(){reads++;throw Error('Proxy get');},ownKeys(){reads++;throw Error('Proxy ownKeys');}});
  rejects(()=>verifyHir(proxy),input);
  const c=clone(control.context);Object.defineProperty(c.contracts[0].upper,'untrusted',getter);
  rejects(()=>analyzeModuleCalls(clone(control.hir),c),{code:'r03-d-module-call-effects',message:'r03-d-module-call-effects: invalid fixed module call publication',ruleId:'r01-call-contract',phase:'analysis'});
  const request={targets:clone(control.proofs[0].targets)};Object.defineProperty(request,'untrusted',getter);
  rejects(()=>verifyKernelParallelGroup(clone(control.hir),clone(control.context),request),{code:'r03-d-kernel-access',message:'r03-d-kernel-access: invalid explicit kernel parallel group',ruleId:'r01-kernel',phase:'hir'});
  assert.equal(reads,0);
});

test('outputs own and freeze source buffers, full snapshot, HIR and proof independently',async()=>{
  const request=bytes(control.request),packet=bytes(control.packet),origin=clone(control.sourceOrigin);
  const result=await importCapturedFrontendResponse(request,packet,origin);assert.equal(result.status,'ok');
  request.fill(0);packet.fill(0);origin.responseSha256=hash('changed caller origin');
  assert.deepEqual(result.snapshot,control.snapshot);frozen(result.snapshot);
  const h=clone(control.hir),c=clone(control.context),proof=verifyKernelParallelGroup(h,c,{targets:clone(control.proofs[0].targets)});
  h.functions[0].body=[];c.contracts[0].upper.unknown=true;assert.deepEqual(proof,control.proofs[0].proof);frozen(proof);
  const roundtrip=readHir(bytes(control.hir));frozen(roundtrip);assert.notEqual(roundtrip.snapshot,control.snapshot);
});
