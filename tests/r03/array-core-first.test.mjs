// SPDX-License-Identifier: MIT
// A frozen whole-protocol oracle reaches the existing public Array Core capability gap.
// Expected Core was derived from the independent facts/HIR inputs before the emitter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readArrayFactsCandidate, writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { parseArrayCore, assertArrayCoreSemantics } from './array-core-structural-oracle.mjs';
import { decodeMlirString } from './string-core-structural-oracle.mjs';

/** Kept independent of the earlier FIRST source so its retained failure bytes never change.
 * @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+jcs(value[k])).join(',') + '}';
}
/** @param {string | Uint8Array} value */
const sha = value => createHash('sha256').update(value).digest('hex');
/** @param {any} value @returns {any} */
const fresh = value => JSON.parse(jcs(value));
/** @param {string} file @param {number} bytes @param {string} digest @returns {Promise<any>} */
async function frozen(file, bytes, digest) {
  const raw = await readFile(new URL(file,import.meta.url));
  assert.equal(raw.length,bytes,file+' complete bytes');assert.equal(sha(raw),digest,file+' immutable pin');
  const value=JSON.parse(raw.toString('utf8'));
  assert.equal(jcs(value)+'\n',raw.toString('utf8'));return value;
}
/** @param {any} value @param {Array<string | number>} path @returns {any} */
function at(value,path) {for(const key of path)value=value[key];return value;}
/** @param {any} value @param {string} path */
function atHir(value,path) {
  assert.ok(path.startsWith('$.'));
  return at(value,path.slice(2).replace(/\[(\d+)\]/g,'.$1').split('.'));
}
/** @param {string} source @param {{start:number,end:number}} range @param {string} expected */
function originalRange(source,range,expected) {
  assert.ok(Number.isSafeInteger(range.start)&&Number.isSafeInteger(range.end));
  assert.ok(!Object.is(range.start,-0)&&!Object.is(range.end,-0));
  assert.ok(range.start>=0&&range.start<range.end&&range.end<=source.length);
  for(const n of [range.start,range.end])assert.ok(!(n>0&&n<source.length
    &&source.charCodeAt(n)>=0xdc00&&source.charCodeAt(n)<=0xdfff
    &&source.charCodeAt(n-1)>=0xd800&&source.charCodeAt(n-1)<=0xdbff));
  assert.equal(source.slice(range.start,range.end),expected);
}

test('25c FIRST: all complete facts/HIR controls precede public lowerHir whole Core equality',async t=>{
  const oracle=await frozen('./array-core-oracle-v1.json',90582,'fc20c7f86b0253e89d10f0a7d3bf353b17d637574ad3f131df60f48394ccb7de');
  assert.deepEqual(oracle.provenance,{productImported:false,newEmitterImported:false,lowerHirCalled:false,
    newOutputSampled:false,sourceCredit:'unchanged qualified 25a result reused; no new official producer invocation'});
  const fpin=oracle.factsOraclePin,hpin=oracle.hirOraclePin,dpin=oracle.descriptorPin;
  const facts=await frozen('./'+fpin.file,fpin.bytes,fpin.sha256);
  const hir=await frozen('./'+hpin.file,hpin.bytes,hpin.sha256);
  const descriptor=await frozen('./'+dpin.file,dpin.bytes,dpin.sha256);
  assert.equal('sha256:'+sha(jcs(descriptor)),dpin.schemaHash);
  assert.deepEqual(oracle.cases.map(c=>c.name),['full-fresh-aliases','empty-checked-read',
    'length-equal-checked-read','far-oob-checked-read']);
  for(const p of hir.typePreimages)assert.equal('sha256:'+sha(Buffer.from(p.preimageUtf8Hex,'hex')),p.id);
  for(const v of oracle.jcsPreimageVectors) {
    const value=v.field==='nameRange'?{nameRange:v.range,sourcePath:v.sourcePath}:{range:v.range,sourcePath:v.sourcePath};
    assert.equal(jcs(value),v.jcs);assert.equal(Buffer.from(v.jcs).toString('hex'),v.utf8Hex);
    assert.equal(Buffer.from(v.domain+'\0'+v.jcs).toString('hex'),v.preimageHex);
    assert.equal('sha256:'+sha(Buffer.from(v.preimageHex,'hex')),v.id);
  }
  for(const v of oracle.additionalIndependentPreimages) {
    assert.equal(jcs({nameRange:v.nameRange,sourcePath:v.sourcePath}),v.bindingJcs);
    assert.equal(jcs({range:v.range,sourcePath:v.sourcePath}),v.siteJcs);
    assert.equal(Buffer.from('tsfg.array-facts.binding.v1\0'+v.bindingJcs).toString('hex'),v.bindingPreimageHex);
    assert.equal(Buffer.from('tsfg.array-facts.allocation-site.v1\0'+v.siteJcs).toString('hex'),v.sitePreimageHex);
    assert.equal('sha256:'+sha(Buffer.from(v.bindingPreimageHex,'hex')),v.bindingId);
    assert.equal('sha256:'+sha(Buffer.from(v.sitePreimageHex,'hex')),v.siteId);
  }
  for(const v of oracle.quoteVectors)assert.equal(decodeMlirString(v.coreToken),v.text);
  const counts={sourceRanges:0,hirRanges:0,functions:0,sites:0,aliases:0,elements:0,checkedReads:0};
  /** @type {Array<{h:any,context:any,c:any}>} */ const prepared=[];
  for(let i=0;i<oracle.cases.length;i++) {
    const c=oracle.cases[i],f=facts.cases[i],h=hir.cases[i];
    assert.equal(c.name,f.name);assert.equal(c.name,h.name);
    assert.equal(jcs(f.request)+'\n',f.requestText);assert.equal(sha(f.requestText),f.requestSHA256);
    assert.equal(Buffer.byteLength(f.requestText),f.requestBytes);
    assert.equal(jcs(f.package)+'\n',f.packageText);
    assert.equal(Buffer.byteLength(f.packageText),c.factsPackageBytes);assert.equal(sha(f.packageText),c.factsPackageSHA256);
    assert.equal(f.package.requestId,'sha256:'+sha('tsfg.array-facts.request.v1\0'+f.requestText));
    assert.equal(f.package.packageId,'sha256:'+sha('tsfg.array-facts.package.v1\0'+f.package.schemaHash+'\0'+jcs(f.package.payload)));
    assert.equal(f.package.packageId,c.expectedPackageId);
    for(const p of f.identityPreimages)assert.equal('sha256:'+sha(p.domain+'\0'+p.valueJcsNoLf),p.id);
    for(const p of h.functionPreimages) {
      assert.equal('sha256:'+sha(Buffer.from(p.signaturePreimageUtf8Hex,'hex')),p.signatureHash);
      assert.equal('sha256:'+sha(Buffer.from(p.functionPreimageUtf8Hex,'hex')),p.functionId);
    }
    for(const w of f.rangeAudit) {
      const file=f.package.payload.files.find(s=>s.path===w.sourcePath);assert.ok(file);
      originalRange(file.content,w.range,w.text);counts.sourceRanges++;
    }
    assert.equal(Buffer.byteLength(h.hirText),c.hirBytes);assert.equal(sha(h.hirText),c.hirSHA256);
    assert.equal(jcs(h.expectedHir)+'\n',h.hirText);
    assert.equal(Buffer.byteLength(c.core),c.coreBytes);assert.equal(sha(c.core),c.coreSHA256);
    const structure=parseArrayCore(c.core),semantic=assertArrayCoreSemantics(c.core,c);
    for(const key of ['functions','sites','aliases','elements','checkedReads'])counts[key]+=semantic[key];
    assert.equal(c.rangeCorrespondence.length,h.rangeWitnesses.length);
    for(let j=0;j<c.rangeCorrespondence.length;j++) {
      const w=c.rangeCorrespondence[j],original=h.rangeWitnesses[j];
      assert.deepEqual({path:w.path,range:w.range,sourcePath:w.sourcePath,text:w.text},original);
      assert.deepEqual(atHir(h.expectedHir,w.path),w.range);
      assert.equal(Number(at(structure,w.coreStartPath)),w.range.start);
      assert.equal(Number(at(structure,w.coreEndPath)),w.range.end);
      const file=h.expectedHir.sources.find(s=>s.path===w.sourcePath);assert.ok(file);
      originalRange(file.content,w.range,w.text);counts.hirRanges++;
    }
    const factBytes=Buffer.from(f.packageText),context={...h.context,factsBytes:Buffer.from(factBytes)};
    const read=readArrayFactsCandidate(factBytes);assert.deepEqual(read,f.package);
    assert.deepEqual(writeArrayFactsCandidate(read),factBytes);
    const built=buildHir(fresh(f.package),context);
    assert.equal(built.status,'ok',c.name+' complete existing HIR positive control');
    assert.deepEqual(built.hir,h.expectedHir);
    assert.deepEqual(verifyHir(fresh(h.expectedHir),context),h.expectedHir);
    assert.equal(printHir(built.hir,context),h.hirText);
    assert.deepEqual(readHir(Buffer.from(h.hirText),context),h.expectedHir);
    prepared.push({h:fresh(h.expectedHir),context,c});
  }
  assert.deepEqual(counts,{sourceRanges:115,hirRanges:135,functions:5,sites:6,aliases:5,elements:20,checkedReads:5});
  t.diagnostic('25c ALL_FROZEN_CONTROLS_COMPLETE:4 packages/5 functions/6 sites/20 elements/5 aliases/115 Source ranges/135 HIR ranges; static Core API gap, no new Source or execution credit');
  // The fixed BASE naturally throws at its first fully verified checked-read range.
  // Keep that real RED; do not catch it as expected rejection or credit later calls.
  for(const {h,context,c} of prepared) {
    t.diagnostic('25c EXISTING_PUBLIC_LOWER_REACHED '+c.name);
    assert.equal(lowerHir(h,context),c.core,c.name+' whole independent Core bytes');
    assert.deepEqual(h,hir.cases.find(row=>row.name===c.name).expectedHir);
    assert.equal(sha(context.factsBytes),c.factsPackageSHA256);
  }
});
