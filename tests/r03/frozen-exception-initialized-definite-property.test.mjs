// SPDX-License-Identifier: MIT
// Actual controls and fully repaired forged negatives retain distinct provenance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
const schema='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const pins=[
  {
    "directory": "01",
    "request": "2f5063c5198335f321cfd6bafd94f4cf61ad429159f3f2ff9523387eb39933c9",
    "response": "c86d8865f1c85f9d5d4cdc3befc0ba4688888fd6ec629a2be105a5fb83bdc4e1",
    "origin": "9009777fa1420e354f6063ef5b00ed14072f51f81ae7ffb3e6cd31a2aa04f704",
    "expected": "c86d8865f1c85f9d5d4cdc3befc0ba4688888fd6ec629a2be105a5fb83bdc4e1",
    "oracle": "9d8388a718f61ef8c3e6e398f015d2a3f93cdc405bb34dbba12fbdb00973d478"
  },
  {
    "directory": "02",
    "request": "7101e4e71a9322eb61612cb88a97f3aeabc6592f128db24a97c46cfdacb811e0",
    "response": "0bf062e6e27e59f9e985dc68918919fe88abee53238ddbf7f3e30061ff1a0656",
    "origin": "4b6d057758a943b6c50d0d27b6350f0f5198d4dd578805ea8a96bd59363943ee",
    "expected": "0bf062e6e27e59f9e985dc68918919fe88abee53238ddbf7f3e30061ff1a0656",
    "oracle": "cd0c35a5c64da78643412a8ab3b2e0d7d7ee9e753053efa39b9ace5c3f115b02"
  }
];
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
/** @param {any} value @returns {string} */
function jcs(value) {
  if(value===null||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='string'){assert.ok(value.isWellFormed());return JSON.stringify(value);}
  if(typeof value==='number'){assert.ok(Number.isFinite(value));return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(jcs).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}';
}
/** @param {any} q @param {any} p @param {any} o */
function seal(q,p,o) {
  const files=q.input.files.map(file=>({path:file.path,content:file.content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  p.payload.inputIdentity=hash(jcs({...q.input,files}));
  p.payload.files=files.map(file=>({path:file.path,digest:hash(file.content),byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'}));
  const requestBytes=Buffer.from(jcs(q));
  p.requestId=hash('tsfg.exception-facts.request.v1\0'+requestBytes);
  p.packageId=hash('tsfg.exception-facts.package.v1\0'+schema+'\0'+jcs(p.payload));
  const responseBytes=Buffer.from(jcs(p));
  return {requestBytes,responseBytes,origin:{...clone(o),requestSha256:hash(requestBytes),responseSha256:hash(responseBytes)}};
}
/** @param {any} frames */
function assertIdentities(frames) {
  const q=JSON.parse(frames.requestBytes.toString('utf8')),p=JSON.parse(frames.responseBytes.toString('utf8'));
  assert.equal(jcs(q),frames.requestBytes.toString('utf8'));assert.equal(jcs(p),frames.responseBytes.toString('utf8'));
  assert.equal(frames.origin.requestSha256,hash(frames.requestBytes));assert.equal(frames.origin.responseSha256,hash(frames.responseBytes));
  assert.equal(p.requestId,hash('tsfg.exception-facts.request.v1\0'+frames.requestBytes));
  assert.equal(p.packageId,hash('tsfg.exception-facts.package.v1\0'+schema+'\0'+jcs(p.payload)));
  const files=q.input.files.map(file=>({path:file.path,content:file.content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  assert.equal(p.payload.inputIdentity,hash(jcs({...q.input,files})));
  assert.deepEqual(p.payload.files,files.map(file=>({path:file.path,digest:hash(file.content),byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'})));
}

/** @param {any} value @param {number} point */
function shiftSourceRanges(value,point) {
  if(Array.isArray(value)){for(const item of value)shiftSourceRanges(item,point);return;}
  if(value===null||typeof value!=='object')return;
  if(Object.keys(value).sort().join(',')==='end,start'){
    if(value.start>=point)value.start++;
    if(value.end>point)value.end++;
    return;
  }
  for(const key of Object.keys(value)){
    // Marker declarationRange belongs to the unchanged DTS, unlike its source decorator range.
    if(key==='markerOrigin')shiftSourceRanges(value[key].range,point);
    else shiftSourceRanges(value[key],point);
  }
}

test('official initialized-definite field errors reject fully repaired source and facts',async t=>{
  for(const pin of pins){
    const root=new URL('../fixtures/r03/m21-exception/corpus/'+pin.directory+'/',import.meta.url);
    const buffers=await Promise.all(['request.json','response.json','origin.json','expected-private.json'].map(name=>readFile(new URL(name,root))));
    for(const [index,key] of ['request','response','origin','expected'].entries())assert.equal(hash(buffers[index]),'sha256:'+pin[key]);
    assert.deepEqual(buffers[1],buffers[3],'actual control equals the independently frozen complete expected packet');
    const [q0,p0,o]=buffers.slice(0,3).map(buffer=>JSON.parse(buffer.toString('utf8')));
    const frames0={requestBytes:buffers[0],responseBytes:buffers[1],origin:o};assertIdentities(frames0);
    await t.test(pin.directory+' actual initialized-field control',async()=>{
      const result=await importCapturedFrontendResponse(frames0.requestBytes,frames0.responseBytes,frames0.origin);
      assert.equal(result.status,'ok');validateFrontendSnapshot(result.snapshot);
      validateFrontendSnapshot(JSON.parse(JSON.stringify(result.snapshot)));
    });
    await t.test(pin.directory+' forbidden definite assertion with initializer',async()=>{
      const q=clone(q0),p=clone(p0),source=q.input.files.find(file=>file.path===q.input.rootFile);
      const needle='flag: bool = true;',index=source.content.indexOf(needle);
      assert.ok(index>=0);assert.equal(source.content.lastIndexOf(needle),index);
      const point=index+'flag'.length;
      source.content=source.content.slice(0,point)+'!'+source.content.slice(point);
      shiftSourceRanges(p.payload.facts,point);shiftSourceRanges(p.payload.exports,point);
      const field=p.payload.facts.aggregateFacts.declarations[0].fields[0];
      assert.equal(field.definiteAssertionSyntax,false);assert.notEqual(field.initializer,null);field.definiteAssertionSyntax=true;
      const oracleBytes=await readFile(new URL('../fixtures/r03/m21-exception/initialized-definite-property/'+pin.directory+'.official.json',import.meta.url));
      assert.equal(hash(oracleBytes),'sha256:'+pin.oracle);
      const oracle=JSON.parse(oracleBytes.toString('utf8'));
      assert.equal(oracle.source,source.content);assert.equal('sha256:'+oracle.sourceSha256,hash(source.content));
      assert.equal(oracle.invalid,true);assert.equal(oracle.expectedCode,1263);assert.equal(oracle.positionsAgree,true);
      assert.deepEqual(oracle.diagnostics,[{code:1263,file:q.input.rootFile,group:'semantic',utf16:[point,point+1],utf8:[Buffer.byteLength(source.content.slice(0,point)),Buffer.byteLength(source.content.slice(0,point+1))]}]);
      const frames=seal(q,p,o);assertIdentities(frames);
      const before=[hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)];
      const result=await importCapturedFrontendResponse(frames.requestBytes,frames.responseBytes,frames.origin);
      assert.equal(result.status,'error','an officially invalid field must not acquire cold admission by repairing metadata');
      const code=result.diagnostics?.[0]?.code;assert.match(code,/^r03-exception-/);assert.notEqual(code,'r03-exception-identity');
      assert.deepEqual([hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)],before);
      t.diagnostic(JSON.stringify({directory:pin.directory,officialCode:1263,code}));
    });
    assert.deepEqual(buffers.map(hash),['request','response','origin','expected'].map(key=>'sha256:'+pin[key]));
  }
});
