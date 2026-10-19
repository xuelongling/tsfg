// SPDX-License-Identifier: MIT
// Every expected value was frozen by an independent private4 metadata migration before Product4 observation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHir, verifyHir, printHir, readHir } from '../../compiler/hir.mjs';
import { fixtures, fresh, context, hirOracle, jcs, sha, deeplyFrozen } from './array-test-fixtures.mjs';

/** @param {any} object @param {string} path @returns {any} */
function at(object,path) {
  for(const key of path.slice(2).replace(/\[(\d+)\]/g,'.$1').split('.')) object=object[key];
  return object;
}
test('25d all eight frozen whole facts packages reach complete owned HIR',async t=>{
  const rows=await fixtures();
  const oracle=await hirOracle();
  for(const pre of oracle.typePreimages)
    assert.equal('sha256:'+sha(Buffer.from(pre.preimageUtf8Hex,'hex')),pre.id);
  let ranges=0,functions=0,parameters=0;
  for(const row of rows){
    const {facts:f,hir:h}=row,p=f.package;
    assert.equal(jcs(f.request)+'\n',f.requestText);assert.equal(jcs(p)+'\n',f.packageText);
    assert.equal(Buffer.byteLength(f.requestText),f.requestBytes);assert.equal(sha(f.requestText),f.requestSHA256);
    assert.equal(Buffer.byteLength(f.packageText),f.packageBytes);assert.equal(sha(f.packageText),f.packageSHA256);
    assert.equal(p.requestId,'sha256:'+sha('tsfg.array-facts.request.v6\0'+f.requestText));
    assert.equal(p.packageId,'sha256:'+sha('tsfg.array-facts.package.v6\0'+p.schemaHash+'\0'+jcs(p.payload)));
    assert.equal(jcs(h.expectedHir)+'\n',h.hirText);
    assert.equal(Buffer.byteLength(h.hirText),h.hirBytes);assert.equal(sha(h.hirText),h.hirSHA256);
    for(const pre of h.functionPreimages){
      assert.equal('sha256:'+sha(Buffer.from(pre.signaturePreimageUtf8Hex,'hex')),pre.signatureHash);
      assert.equal('sha256:'+sha(Buffer.from(pre.functionPreimageUtf8Hex,'hex')),pre.functionId);
    }
    for(const witness of h.rangeWitnesses){
      const source=h.expectedHir.sources.find(s=>s.path===witness.sourcePath);assert.ok(source);
      assert.deepEqual(at(h.expectedHir,witness.path),witness.range);
      assert.equal(source.content.slice(witness.range.start,witness.range.end),witness.text);ranges++;
    }
    functions+=h.expectedHir.functions.length;
    parameters+=h.expectedHir.functions.reduce((n,fn)=>n+fn.parameters.length,0);
  }
  assert.deepEqual({ranges,functions,parameters},{ranges:390,functions:10,parameters:8});
  for(const row of rows)await t.test(row.facts.name,()=>{
    const packet=fresh(row.facts.package),before=fresh(packet),ctx=context(row);
    const built=buildHir(packet,ctx);assert.equal(built.status,'ok');
    assert.deepEqual(built.hir,row.hir.expectedHir);deeplyFrozen(built.hir);
    assert.equal(printHir(built.hir,ctx),row.hir.hirText);
    assert.deepEqual(verifyHir(fresh(row.hir.expectedHir),ctx),row.hir.expectedHir);
    assert.deepEqual(readHir(Buffer.from(row.hir.hirText),ctx),row.hir.expectedHir);
    assert.deepEqual(packet,before);
  });
});
