// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {moduleCallableCoreView} from '../../compiler/module-callable-core.mjs';
const coreGoldBytes=await readFile(new URL('./module-callable-core-kernel.json',import.meta.url));
assert.equal(createHash('sha256').update(coreGoldBytes).digest('hex'),
  '2c187d3d228a52f89d9a1ebd8ca9bb68e3c63eef7c819e40c66223865d775671');
const coreOracle=JSON.parse(coreGoldBytes.toString('utf8'));
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {buildHir,verifyHir,printHir,readHir,analyzeModuleCalls,verifyModuleCalls,
  printModuleCalls,readModuleCalls,verifyKernelParallelGroup,lowerHir} from '../../compiler/hir.mjs';

// Literal source bodies and fixed Published bounds independently define these
// complete protocol-derived wholes. They confer no official Source authority.
// In particular, narrower current bodies cannot weaken fixed kernel access sets.
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
/** @param {any} actual @param {any} expected */
function dto(actual,expected){for(const[k,v]of Object.entries(expected))assert.deepEqual(actual[k],v,k);return true;}
/** @param {()=>any} run @param {any} expected */
const rejects=(run,expected)=>assert.throws(run,e=>dto(e,expected));
/** @param {any} v */
function frozen(v){if(v===null||typeof v!=='object')return;assert.ok(Object.isFrozen(v));Object.values(v).forEach(frozen);}
/** @param {string} kind @param {string} message */
const callError=(kind,message)=>({code:'r03-d-module-call-effects'+kind,message:'r03-d-module-call-effects'+kind+': '+message,ruleId:'r01-call-contract',phase:'analysis'});
const stale=callError('-identity','fixed module call publication identity differs');
const changedReport=callError('-report','module call report differs from complete recomputation');
/** @param {any} c */
function publication(c){for(const row of c.contracts){const{digest,...body}=row;
  assert.equal(digest,hash('tsfg.module-published-call-contract.v1\0'+jcs(body)));}
  assert.equal(c.expectedDigest,hash('tsfg.module-call-publication.v1\0'+jcs({scopeDigest:c.scopeDigest,contracts:c.contracts})));}
/** @param {any} c */
function repairPublication(c){for(const row of c.contracts){const{digest,...body}=row;row.digest=hash('tsfg.module-published-call-contract.v1\0'+jcs(body));}
  c.expectedDigest=hash('tsfg.module-call-publication.v1\0'+jcs({scopeDigest:c.scopeDigest,contracts:c.contracts}));return c;}

for(const c of data.kernelCases)test('fixed alias Published and kernel whole: '+c.name,async()=>{
  const before=jcs(c);publication(c.context);
  assert.equal(c.context.scopeDigest,hash('tsfg.module-call-scope.v1\0'+jcs(c.scope)));
  assert.equal(c.analysis.hirDigest,hash(bytes(c.hir)));
  const imported=await importCapturedFrontendResponse(bytes(c.request),bytes(c.packet),clone(c.sourceOrigin));
  assert.deepEqual(imported,{status:'ok',snapshot:c.snapshot});frozen(imported);
  const built=buildHir(imported.snapshot);assert.deepEqual(built,{status:'ok',hir:c.hir});frozen(built.hir);
  assert.deepEqual(verifyHir(clone(c.hir)),c.hir);
  assert.equal(printHir(clone(c.hir)),bytes(c.hir).toString('utf8'));
  const cold=readHir(bytes(c.hir));assert.deepEqual(cold,c.hir);frozen(cold);
  const report=analyzeModuleCalls(cold,clone(c.context));assert.deepEqual(report,c.analysis);frozen(report);
  assert.deepEqual(verifyModuleCalls(clone(c.analysis),cold,clone(c.context)),c.analysis);
  assert.equal(printModuleCalls(clone(c.analysis),cold,clone(c.context)),bytes(c.analysis).toString('utf8'));
  assert.deepEqual(readModuleCalls(bytes(c.analysis),cold,clone(c.context)),c.analysis);
  const consume=()=>verifyKernelParallelGroup(cold,clone(c.context),{targets:clone(c.proofs[0].targets)});
  if(c.kernelExpected.status==='ok'){const proof=consume();assert.deepEqual(proof,c.kernelExpected.proof);frozen(proof);}
  else rejects(consume,c.kernelExpected.error);
  const gold=coreOracle.rows.find(row=>row.name===c.name);
  const {functionSelection,...view}=moduleCallableCoreView(cold);
  assert.equal(functionSelection,'complete-original-universe');
  const {emissionSelection,...expectedView}=gold.expectedFormalView;
  assert.deepEqual(emissionSelection,{policy:functionSelection,functionIds:view.functions.map(fn=>fn.id)});
  assert.deepEqual(view,expectedView);
  assert.equal(lowerHir(cold),gold.expectedRawCore);assert.equal(jcs(c),before);
});

test('real body writes cover both read-write orientations and write-write without fake alias GlobalId',()=>{
  const shared=control.hir.globals[0].id;
  for(const[name,facet]of [['leaf-writes-peer-reads','readWrite'],['leaf-reads-peer-writes','writeRead'],['leaf-and-peer-write','writeWrite']]){
    const c=data.kernelCases.find(c=>c.name===name),error=c.kernelExpected.error;
    assert.deepEqual(error.conflicts[facet],[shared]);assert.equal(c.hir.globals.length,1);
    const raw=c.packet.payload.facts.functions.filter(f=>f.body.some(s=>s.kind==='assignment'));
    assert.equal(raw.length,name==='leaf-and-peer-write'?2:1);
    for(const fn of raw){assert.equal(fn.body[0].target.symbol,'s1');assert.equal(fn.body[0].value.name,'value');}
    assert.equal(c.hir.modules[0].bindings.find(b=>b.name==='op').target,c.hir.functions.find(f=>f.name==='leaf').id);
  }
});

test('narrow bodies retain fixed upper RR and WW while empty and shared access are truly disjoint',()=>{
  const rr=data.kernelCases.find(c=>c.name==='leaf-narrow-keeps-fixed-read-upper');
  assert.deepEqual(rr.context,control.context);
  const leaf=rr.hir.functions.find(f=>f.name==='leaf');
  assert.deepEqual(rr.analysis.functions.find(r=>r.functionId===leaf.id).derived,{reads:[],writes:[],unknown:false});
  assert.deepEqual(rr.kernelExpected.proof.pairs[0].readRead,[control.hir.globals[0].id]);
  const ww=data.kernelCases.find(c=>c.name==='bodies-narrow-keep-fixed-write-upper');
  for(const row of ww.analysis.functions)assert.deepEqual(row.derived,{reads:[],writes:[],unknown:false});
  assert.deepEqual(ww.kernelExpected.error.conflicts.writeWrite,[control.hir.globals[0].id]);
  const disjoint=data.kernelCases.find(c=>c.name==='disjoint-empty-and-shared');
  assert.deepEqual(disjoint.kernelExpected.proof.pairs[0],{left:control.proofs[0].targets[0],right:control.proofs[0].targets[1],readRead:[],writeWrite:[],writeRead:[],readWrite:[]});
});

test('body widening is rejected against the unchanged fixed Published upper',()=>{
  const write=data.kernelCases.find(c=>c.name==='leaf-writes-peer-reads'),leaf=write.hir.functions.find(f=>f.name==='leaf');
  assert.equal(write.context.scopeDigest,control.context.scopeDigest);
  const expected={...callError('-contract','module implementation exceeds fixed published upper bound'),
    functionId:leaf.id,facet:'effects',primary:{sourceId:leaf.sourcePath,...leaf.range}};
  rejects(()=>analyzeModuleCalls(clone(write.hir),clone(control.context)),expected);
});

test('same-signature retargeting changes binding and scope and cannot reuse old fixed identity',()=>{
  const c=data.kernelCases.find(c=>c.name==='retarget-same-signature-peer'),peer=c.hir.functions.find(f=>f.name==='peer');
  assert.equal(c.snapshot.package.payload.facts.modules[0].initialization[1].initializer.target,'s5');
  assert.equal(c.hir.modules[0].bindings.find(b=>b.name==='op').target,peer.id);
  assert.equal(c.hir.functions.find(f=>f.name==='entry').body[0].value.target,peer.id);
  assert.notEqual(c.context.scopeDigest,control.context.scopeDigest);
  rejects(()=>analyzeModuleCalls(clone(c.hir),clone(control.context)),stale);
  const old=clone(control.context);repairPublication(old);rejects(()=>analyzeModuleCalls(clone(c.hir),old),stale);
});

test('fixed identity domains reject parameter-as-global, function/signature drift and unsorted contracts',()=>{
  /** @type {Array<(c:any)=>void>} */
  const changes=[c=>{c.contracts[0].signatureHash=hash('foreign signature');},
    c=>{c.contracts[0].upper.reads=[hash('lexical p0 is not a GlobalId')];},
    c=>{c.scopeDigest=hash('old binding scope');}];
  for(const change of changes){const c=clone(control.context);change(c);repairPublication(c);
    rejects(()=>analyzeModuleCalls(clone(control.hir),c),stale);}
  const c=clone(control.context);c.contracts.reverse();repairPublication(c);
  rejects(()=>analyzeModuleCalls(clone(control.hir),c),callError('','invalid fixed module call publication'));
});

test('full report and roundtrip require current HIR and unchanged fixed context',()=>{
  /** @type {Array<(r:any)=>void>} */
  const changes=[r=>{r.functions.find(f=>f.dependencies.length).dependencies=[];},r=>{r.derivedTargets.calls=[];},
    r=>{r.hirDigest=hash('stale HIR');},r=>{r.initializers[0].effective.writes=[];}];
  for(const change of changes){const r=clone(control.analysis);change(r);
    rejects(()=>verifyModuleCalls(r,clone(control.hir),clone(control.context)),changedReport);}
  const narrow=data.kernelCases.find(c=>c.name==='leaf-narrow-keeps-fixed-read-upper');
  rejects(()=>printModuleCalls(clone(control.analysis),clone(narrow.hir),clone(narrow.context)),changedReport);
  rejects(()=>readModuleCalls(Buffer.from(' '+bytes(control.analysis)),clone(control.hir),clone(control.context)),callError('-canonical','module call report must use canonical JSON plus LF'));
});
