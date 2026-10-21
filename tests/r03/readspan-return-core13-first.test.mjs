// SPDX-License-Identifier: MIT
// One unchanged complete first pair: baseline capability RED, then exact Core13 GREEN.
// Only independent frozen literal text is expected; no compiler output becomes gold.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { projectArrayFacts } from '../../compiler/array-hir-model.mjs';
import { jcs,sha,deeplyFrozen } from './array-test-fixtures.mjs';

// Root explicitly selects the unchanged baseline or candidate module for the
// same test/input/assertions. No version conversion or expected-output fallback.
const moduleURL=process.env.TSFG_CORE13_HIR_MODULE
  ? pathToFileURL(process.env.TSFG_CORE13_HIR_MODULE).href
  : new URL('../../compiler/hir.mjs',import.meta.url).href;
const {buildHir,verifyHir,lowerHir,analyzeArrayCalls}=await import(moduleURL);
const freezePath=process.env.TSFG_CORE13_FIRST_FREEZE;
assert.ok(freezePath,'Root must bind the accepted independent oracle freeze');
const freezeBytes=await readFile(freezePath);
assert.equal(freezeBytes.length,9864);
assert.equal(sha(freezeBytes),'7d88da7df2703da0e695dd7d18ea1dba780ef70003cc935916847c819ec4e59b');
/** @type {{files:{path:string,bytes:number,sha256:string}[],inputs:{file:string,bytes:number,sha256:string,selector:string}[],contract:any}} */
const freeze=JSON.parse(freezeBytes.toString('utf8'));
const directory=dirname(freezePath);
/** @param {string} path @returns {Promise<Buffer>} */
async function literal(path) {
  const pin=freeze.files.find(row=>row.path===path);assert.ok(pin,'exact frozen file '+path);
  const bytes=await readFile(resolve(directory,path));
  assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);return bytes;
}
/** @type {{cases:any[]}} */
const gold=JSON.parse((await literal('oracle/first-whole-oracle.json')).toString('utf8'));
/** @type {{cases:any[]}} */
const inputs=JSON.parse((await literal('oracle/first-complete-inputs.json')).toString('utf8'));
assert.equal(freeze.contract.core.schema,'sha256:39a7877720fab4c3e7fc78d28f2232576865ab3c949e064ef7cc1e979548976b');
assert.deepEqual(gold.cases.map(row=>row.name),['26c-first-after','26d-first-after']);
assert.deepEqual(inputs.cases.map(row=>row.name),gold.cases.map(row=>row.name));
for(const expected of gold.cases) {
  const input=inputs.cases.find(row=>row.name===expected.name);assert.ok(input);
  const original=input.original,sourcePin=freeze.inputs.find(row=>row.file===expected.original.file);assert.ok(sourcePin);
  const sourceBytes=await readFile(new URL('./'+sourcePin.file,import.meta.url));
  assert.equal(sourceBytes.length,sourcePin.bytes);assert.equal(sha(sourceBytes),sourcePin.sha256);
  const source=sourcePin.selector.split('.').reduce((value,key)=>value[key],JSON.parse(sourceBytes.toString('utf8')));
  assert.deepEqual(original,source,'complete original input row, with original wide fixed context');
  assert.equal((await literal(expected.rawFile)).toString('utf8'),expected.expectedRawCore);
  test('26g same complete first input to literal Core13: '+expected.name,t=>{
    const raw=Buffer.from(original.packageText),before=Buffer.from(raw),snapshot=jcs(original);
    const facts={...original.factsContext,factsBytes:Buffer.from(raw)};
    const context=JSON.parse(jcs(original.publicationContext));
    assert.equal(original.expectedDiagnostic,null);
    assert.equal(original.package.packageId,expected.original.packageId);
    assert.equal(context.scopeDigest,expected.original.scopeDigest);
    assert.equal(context.expectedDigest,expected.original.publishedDigest);
    assert.equal(original.completeHir.functions.length,3);
    assert.deepEqual(Buffer.from(original.factsContext.factsBytes),raw);
    const packet=readArrayFactsCandidate(raw);assert.deepEqual(packet,original.package);deeplyFrozen(packet);
    assert.deepEqual(writeArrayFactsCandidate(packet),raw);
    const base=original.projectedHIR??JSON.parse(jcs(original.completeHir));
    if(!original.projectedHIR)delete base.readSpanPlan;
    assert.deepEqual(projectArrayFacts(packet),base);
    const built=buildHir(packet,facts,context);
    assert.deepEqual(built,{status:'ok',hir:original.completeHir});deeplyFrozen(built);
    const hir=verifyHir(built.hir,facts,context);
    assert.deepEqual(hir,original.completeHir);deeplyFrozen(hir);
    assert.deepEqual(analyzeArrayCalls(hir,facts,context),original.completeAnalysis);
    t.diagnostic('complete facts7/HIR8/Published4 validated: '+expected.original.packageId);
    try {
      assert.equal(lowerHir(hir,facts,context),expected.expectedRawCore,'entire literal Core13; all3 functions/ranges/SSA/fixed upper retained');
    } finally {
      assert.deepEqual(raw,before);assert.equal(jcs(original),snapshot);
      assert.deepEqual(context,original.publicationContext,'fixed upper is unchanged');
    }
  });
}
