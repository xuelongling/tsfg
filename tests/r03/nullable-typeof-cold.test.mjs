// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {importNullableCapturedResponse,verifyNullableSnapshot} from '../../compiler/nullable-frontend.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerHir} from '../../compiler/hir.mjs';
import {raw,data,expected,fresh,sha,jcs,packetAttack,spliceSource,groupedContinuationAttack} from './nullable-typeof-fixtures.mjs';

test('typeof undefined actual Source capture matches independently assembled whole facts and frozen input',()=>{
 assert.equal(sha(raw('request.json')),'sha256:c57b92b4f3ac76e4de2835585314637a7da2eed43922087c3d9fe35b7763638e');
 assert.equal(sha(raw('package.json')),'sha256:733eb500d6c51e2e005ec3ce4586d685021ef4a128a9a896e70f19244c19ebf9');
 assert.equal(sha(raw('source.ts')),'sha256:ded7073e5fb837e5bb1d1fc2b73211ddc66f05b47192963abd1ff22101bd4ca7');
 assert.equal(sha(raw('expected.json')),'sha256:98eea8be99fe704e47f0be3678a48847fec85c497c622a0d7d1c1b5d5ac03068');
 assert.equal(sha(raw('core.mlir')),'sha256:eb689c3e3fac0a26c0b0c4a3ebdca201a15e2dd42e86bb4ea978aa77cba30172');
 assert.deepEqual(data('package.json').payload.facts,expected.facts);assert.deepEqual(data('package.json').payload.exports,expected.exports);
 assert.equal(expected.context.expectedOrigin.producerDirty,true);assert.equal(expected.snapshot.source.content,raw('source.ts').toString());
 assert.deepEqual(expected.officialOracle.diagnostics,{global:0,program:0,semantic:0,syntactic:0});
 const input=data('request.json').input;
 assert.equal(sha(jcs({rootFile:input.rootFile,files:input.files})),expected.context.expectedOrigin.testedInputSetHash);
});

test('typeof undefined actual complete capture cold snapshot HIR read print Core equals independent oracle',()=>{
 const c=fresh(expected.context),result=importNullableCapturedResponse(raw('request.json'),raw('package.json'),fresh(c.expectedOrigin),c);
 assert.deepEqual(result,{status:'ok',snapshot:expected.snapshot});
 assert.deepEqual(verifyNullableSnapshot(fresh(result.snapshot),c),{snapshotId:expected.snapshot.snapshotId,functions:6,calls:1});
 const built=buildHir(fresh(result.snapshot),c);assert.equal(built.status,'ok');assert.deepEqual(built.hir,expected.hir);
 assert.deepEqual(verifyHir(fresh(built.hir),c),expected.hir);
 const text=printHir(fresh(built.hir),c);assert.equal(text,jcs(expected.hir)+'\n');
 const cold=readHir(Buffer.from(text),c);assert.deepEqual(cold,expected.hir);
 assert.equal(lowerHir(cold,c),raw('core.mlir').toString());
});

test('typeof undefined Core uses strict complement and preserves null through lazy existing CFG',()=>{
 const core=lowerHir(fresh(expected.hir),fresh(expected.context));
 const chunks=core.split('  func.func @').slice(1),byName=new Map(chunks.map(s=>[s.slice(1,s.indexOf('"',1)),s]));
 for(const name of ['eq','mirrorEq'])assert.match(byName.get(name),/tag = 1 : i32/);
 for(const name of ['ne','mirrorNe']){
  const text=byName.get(name);assert.match(text,/tag = 0 : i32/);assert.equal((text.match(/tsfg_nullable.get/g)||[]).length,1);
  assert.ok(text.indexOf('  ^bb1:')<text.indexOf('tsfg_nullable.get'));assert.ok(text.indexOf('tsfg_nullable.get')<text.indexOf('  ^bb2:'));
 }
 const keep=byName.get('keepNull');assert.match(keep,/\(%v0: !tsfg_nullable.i32<3>/);
 assert.equal((keep.match(/tsfg_nullable.tag_test/g)||[]).length,2);assert.equal((keep.match(/tsfg_nullable.get/g)||[]).length,1);
 assert.ok(keep.indexOf('  ^bb4:')<keep.indexOf('tsfg_nullable.get'));assert.ok(keep.indexOf('tsfg_nullable.get')<keep.indexOf('  ^bb5:'));
 assert.match(keep,/\^bb5:\n    cf.br \^bb6\(%v4 : i32\)/);assert.ok(!core.includes('nullable.retype'));
 const plan=expected.corePlan.operations;
 for(const [op,count] of Object.entries(plan))assert.equal((core.match(new RegExp('"'+(op==='call'?'func.call':op==='fuel'?'tsfg_core.fuel':'tsfg_nullable.'+op)+'"','g'))||[]).length,count);
});

test('typeof string tag accepts single quotes without treating undefined as a binding',()=>{
 // All transformations below are source/DTO consistency tests of the cold
 // consumer, not new Go captures or independent official-checker evidence.
 const result=packetAttack((p,r)=>{const f=r.input.files.find(f=>f.path===r.input.rootFile);f.content=f.content.replaceAll('"undefined"',"'undefined'");})();
 assert.equal(result.status,'ok');assert.ok(result.snapshot.source.content.includes("typeof x==='undefined'"));
 const shadowed=packetAttack((p,r)=>{
  // A scalar parameter called undefined cannot shadow a typeof string literal.
  spliceSource(p,r,73,74,'undefined');spliceSource(p,r,28,29,'undefined');
  p.payload.facts.functions[0].parameters[1].name='undefined';p.payload.facts.symbols[7].name='undefined';
 })();
 assert.equal(shadowed.status,'ok');assert.ok(shadowed.snapshot.source.content.includes('undefined:i32'));
 for(const spelling of ['"\\u0075ndefined"','"unde\\\r\nfined"']){
  const escaped=packetAttack((p,r)=>{spliceSource(p,r,53,64,spelling);})();
  assert.equal(escaped.status,'ok');
 }
 for(const [index,position,key] of [[0,42,'typeofRange'],[0,53,'tagRange'],[2,222,'tagRange'],[2,236,'typeofRange']]){
  const trivia=packetAttack((p,r)=>{
   spliceSource(p,r,position,position,' /*😀*/ ');
   p.payload.facts.functions[index].body[0].condition.typeTest[key].start=position;
  })();
  assert.equal(trivia.status,'ok');
 }
});

test('typeof equality continuation preserves nested trivia groups around the proved parameter',()=>{
 // Synthetic source/DTO consistency control; no new Go capture or checker run.
 const result=groupedContinuationAttack()();
 const context={...expected.context,expectedPackageId:JSON.parse(result.snapshot.capture.response).packageId,expectedOrigin:result.snapshot.sourceOrigin};
 const built=buildHir(fresh(result.snapshot),context);
 assert.equal(built.status,'ok');
 const value=built.hir.functions[0].body[1].value;
 assert.equal(value.kind,'group');assert.equal(value.operand.kind,'group');assert.equal(value.operand.operand.kind,'nullableGet');
 assert.deepEqual(value.range,{start:83,end:95});assert.deepEqual(value.operand.range,{start:91,end:94});
 assert.deepEqual(value.operand.operand.range,{start:92,end:93});
 const cold=readHir(Buffer.from(printHir(built.hir,context)),context);assert.deepEqual(cold,built.hir);
 const core=lowerHir(cold,context).split('  func.func @"ne"')[0];
 assert.equal((core.match(/"tsfg_nullable.get"/g)||[]).length,1);
 assert.match(core,/"tsfg_nullable.get"\(%v3\).*tsfg_source.start = 92 : i64, tsfg_source.end = 93 : i64/);
 // The current Source6 inequality route requires a direct scalar fallback;
 // grouping it is outside that exact profile even though equality permits it.
 assert.throws(packetAttack((p,r)=>{
  spliceSource(p,r,170,171,'(b)');
  p.payload.facts.functions[1].body[1].expression={kind:'group',type:'i32',operand:{kind:'reference',type:'i32',symbol:'s10',range:{start:171,end:172}},range:{start:170,end:173}};
 }),{code:'r03-nullable-schema'});
});
