// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {importNullableCapturedResponse,verifyNullableSnapshot} from '../../compiler/nullable-frontend.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerHir} from '../../compiler/hir.mjs';
const dir=new URL('./testdata/nullable-groups-v5/',import.meta.url);
const read=name=>readFileSync(new URL(name,dir));
const frozen=JSON.parse(read('expected.json').toString()),fresh=value=>JSON.parse(JSON.stringify(value));
const sha=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
/** @param {any} value @returns {string} */
const jcs=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(jcs).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}';

test('nullable groups actual capture and independent official source plan stay exact',()=>{
 assert.equal(sha(read('request.json')),'sha256:7500f2d9585d027d5f5a4cf78573681620956432d126acd7ceb99078c1216d75');
 assert.equal(sha(read('package.json')),'sha256:54aae791b1043e8d758e16fe1292e6706ee219df438a2f3b902aa6ddef05702f');
 assert.equal(sha(read('expected.json')),'sha256:8bd0945d9a5d6f09f3b11668be3fdb9a9a4b6e54c43d1b7a6f8fb46f1b84e4fc');
 const source=frozen.snapshot.source.content;
 assert.equal(Buffer.byteLength(source),525);assert.equal(source.length,523);
 assert.deepEqual(frozen.officialOracle.counts,{call:4,group:12,reference:11,shortCircuit:3});
 for(const item of frozen.officialOracle.anchors)assert.equal(source.slice(item.range.start,item.range.end),item.text);
 const anchors=[];const mask=id=>{const type=frozen.hir.types.find(t=>t.id===id);return type.kind==='scalar'?0:(type.undefined?1:0)|(type.null?2:0);};
 const visit=node=>{if(node.operand)visit(node.operand);if(node.left)visit(node.left);if(node.right)visit(node.right);if(node.arguments)node.arguments.forEach(visit);
  if(node.kind==='nullableWrap')return;const kind=node.kind==='nullableCoalesce'?'shortCircuit':node.kind;
  anchors.push({kind,mask:mask(node.type),range:node.range,text:source.slice(node.range.start,node.range.end)});};
 frozen.hir.functions.forEach(fn=>fn.body.forEach(stmt=>visit(stmt.value)));
 assert.deepEqual(anchors,frozen.officialOracle.anchors);
 const request=JSON.parse(read('request.json').toString());
 assert.equal(sha(jcs({rootFile:request.input.rootFile,files:request.input.files})),frozen.context.expectedOrigin.testedInputSetHash);
});

test('nullable groups real package cold snapshot HIR print read and Core text',()=>{
 const context=fresh(frozen.context);
 const imported=importNullableCapturedResponse(read('request.json'),read('package.json'),fresh(context.expectedOrigin),context);
 assert.deepEqual(imported,{status:'ok',snapshot:frozen.snapshot});
 assert.deepEqual(verifyNullableSnapshot(fresh(imported.snapshot),context),{snapshotId:frozen.snapshot.snapshotId,functions:5,calls:4});
 const built=buildHir(fresh(imported.snapshot),context);assert.equal(built.status,'ok');assert.deepEqual(built.hir,frozen.hir);
 assert.deepEqual(verifyHir(fresh(built.hir),context),frozen.hir);
 const text=printHir(fresh(built.hir),context);assert.equal(text,jcs(frozen.hir)+'\n');
 const cold=readHir(Buffer.from(text),context);assert.deepEqual(cold,frozen.hir);
 const core=lowerHir(cold,context);
 assert.equal((core.match(/"tsfg_nullable.tag_test"/g)||[]).length,3);
 assert.equal((core.match(/"tsfg_nullable.get"/g)||[]).length,3);
 assert.equal((core.match(/"func.call"/g)||[]).length,4);
 assert.equal((core.match(/"tsfg_nullable.wrap_i32"/g)||[]).length,3);
 assert.ok(!core.includes('"tsfg_core.undefined"'));
});
