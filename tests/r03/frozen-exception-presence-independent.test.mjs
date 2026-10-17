// SPDX-License-Identifier: MIT
// Independently frozen B Spec controls; Root owns qualified execution.
// Four controls are exact actual Source captures. Mutations are forged negatives.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';

const schema='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const pins=[
  {
    "directory": "14",
    "request": "e219202604df595d823d2643f9c67db8efa2b70f28c68739ed1e826d2cc68659",
    "response": "3dafccd84c8526d267e768d02172f7b073c1bdc640f8f5ebe945d69db245687b",
    "origin": "d0b659726808639fdfd97da7cb1b3b6d593c10d40c896ecb26428d3e5b82c6d2",
    "expected": "3dafccd84c8526d267e768d02172f7b073c1bdc640f8f5ebe945d69db245687b"
  },
  {
    "directory": "15",
    "request": "179b7a0bb1640581b93e0748f9bbaa549749c4d78eb2afb8abf31ef111794daf",
    "response": "c941284a9b15e1ce2335d93b9763c8c14df47c67a95a6c64f9fd0d5e7f5d97e5",
    "origin": "330797e1ede8bcb3881b22e075e351760ac15aba67b3a5782a2689e973899984",
    "expected": "c941284a9b15e1ce2335d93b9763c8c14df47c67a95a6c64f9fd0d5e7f5d97e5"
  },
  {
    "directory": "16",
    "request": "1d6b8648034b46793ac004273002da9e29861f58ce7ed2733c602d89680a8797",
    "response": "6b3606298140dda10de4afbf01163203827621c7723de51681bbb283cb45b402",
    "origin": "b981264d29bf33a70ebb10ec0d3c32b5fbb73f00de5812019548ebf6d885c69b",
    "expected": "6b3606298140dda10de4afbf01163203827621c7723de51681bbb283cb45b402"
  },
  {
    "directory": "17",
    "request": "c79f86de8ee22c47d645c3fa7da0ec14d3a34913bf4aacec5e273583e93cc66f",
    "response": "51343971d29c82adf2c52db82cacb64cd16d22db4a87c897a97bfbba3096190c",
    "origin": "64504aaf9e7a57bac97b2fddcb7955b93b8d75ec338eb5aed6862e0d0ec4ea74",
    "expected": "51343971d29c82adf2c52db82cacb64cd16d22db4a87c897a97bfbba3096190c"
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
/** @param {any} pin */
async function captured(pin) {
  const root=new URL('../fixtures/r03/m21-exception/corpus/'+pin.directory+'/',import.meta.url);
  const buffers=await Promise.all(['request.json','response.json','origin.json','expected-private.json'].map(name=>readFile(new URL(name,root))));
  for(const [index,key] of ['request','response','origin','expected'].entries())assert.equal(hash(buffers[index]),'sha256:'+pin[key],pin.directory+' '+key);
  assert.deepEqual(buffers[1],buffers[3],'actual package equals independent frozen expected');
  const [q,p,o]=buffers.slice(0,3).map(buffer=>JSON.parse(buffer.toString('utf8')));
  const absent=['14','15'].includes(pin.directory)?'null':'undefined',verb=['14','16'].includes(pin.directory)?'return':'throw';
  assert.equal(q.input.files.find(file=>file.path===q.input.rootFile).content,'// 😀\r\nexport function entry(payload: i32 | '+absent+'): i32 | '+absent+' { '+verb+' payload; }');
  const frames={requestBytes:buffers[0],responseBytes:buffers[1],origin:o};assertIdentities(frames);
  return {q,p,o,buffers,frames};
}

// All edits preserve the literal Source and the complete exports; only facts
// are corrupted. Both declaration copies are changed together where specified,
// so a registry-equality check cannot mask a missing source-relation check.
/** @type {Array<[string,(value:any)=>void]>} */
const mutations=[
  ['parameterPresenceMissingBoth',x=>{delete x.parameter.presence;delete x.parameterDefinition.presence;}],
  ['parameterMemberErased',x=>{x.parameter.presence[x.member]=false;x.parameterDefinition.presence[x.member]=false;}],
  ['parameterMemberSwapped',x=>{for(const p of [x.parameter.presence,x.parameterDefinition.presence]){p[x.member]=false;p[x.other]=true;}}],
  ['parameterOptionalInvented',x=>{x.parameter.presence.optional=true;x.parameterDefinition.presence.optional=true;}],
  ['parameterDefaultInvented',x=>{x.parameter.presence.default=true;x.parameterDefinition.presence.default=true;}],
  ['parameterAnnotationShifted',x=>{x.parameter.presence.annotation.start++;x.parameterDefinition.presence.annotation.start++;}],
  ['parameterRangeIsNameOnly',x=>{x.parameter.presence.range=clone(x.parameter.range);x.parameterDefinition.presence.range=clone(x.parameter.range);}],
  ['parameterRegistryMismatch',x=>{x.parameterDefinition.presence[x.member]=false;}],
  ['parameterHasReturnMetadata',x=>{x.parameter.returnPresence=clone(x.fn.returnPresence);x.parameterDefinition.returnPresence=clone(x.fn.returnPresence);}],
  ['returnPresenceMissingBoth',x=>{delete x.fn.returnPresence;delete x.definition.returnPresence;}],
  ['returnMemberSwapped',x=>{for(const p of [x.fn.returnPresence,x.definition.returnPresence]){p[x.member]=false;p[x.other]=true;}}],
  ['returnAnnotationIsParameter',x=>{x.fn.returnPresence.annotation=clone(x.parameter.presence.annotation);x.definition.returnPresence.annotation=clone(x.parameter.presence.annotation);}],
  ['returnRangeIsParameter',x=>{x.fn.returnPresence.range=clone(x.parameter.presence.range);x.definition.returnPresence.range=clone(x.parameter.presence.range);}],
  ['returnRegistryMismatch',x=>{x.definition.returnPresence[x.member]=false;}],
  ['functionHasParameterMetadata',x=>{x.fn.presence=clone(x.parameter.presence);x.definition.presence=clone(x.parameter.presence);}],
  ['referenceFlowMissing',x=>{delete x.value.presenceFlow;}],
  ['referenceFlowErased',x=>{x.value.presenceFlow[x.member]=false;}],
  ['referenceFlowInventedOther',x=>{x.value.presenceFlow[x.other]=true;}],
  ['referenceFlowMalformedBoolean',x=>{x.value.presenceFlow[x.member]='true';}],
  ['referenceFlowHasDeclarationKeys',x=>{x.value.presenceFlow=clone(x.parameter.presence);}],
  ['referencePointsAtFunction',x=>{x.value.symbol=x.definition.id;}],
  ['referenceHasWrongPayloadType',x=>{x.value.type='bool';}],
];

test('B independent nullable ownership and presence relations reject repaired fact corruption',async t=>{
  for(const pin of pins) {
    const baseline=await captured(pin);
    await t.test(pin.directory+' actual private positive control',async()=>{
      const result=await importCapturedFrontendResponse(baseline.frames.requestBytes,baseline.frames.responseBytes,baseline.frames.origin);
      assert.equal(result.status,'ok');validateFrontendSnapshot(result.snapshot);
    });
    for(const [name,mutate] of mutations)await t.test(pin.directory+' '+name,async()=>{
      const q=clone(baseline.q),p=clone(baseline.p),facts=p.payload.facts,fn=facts.functions[0];
      const parameter=fn.parameters[0],definition=facts.symbols.find(symbol=>symbol.id===fn.symbol);
      const parameterDefinition=facts.symbols.find(symbol=>symbol.id===parameter.id),value=fn.body[0].expression;
      const member=['14','15'].includes(pin.directory)?'null':'undefined',other=member==='null'?'undefined':'null';
      mutate({fn,definition,parameter,parameterDefinition,value,member,other});
      const frames=seal(q,p,baseline.o);assertIdentities(frames);
      assert.deepEqual(q,baseline.q,'source/input are unchanged');assert.deepEqual(p.payload.exports,baseline.p.payload.exports,'complete exports are unchanged');
      const before=[hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)];
      const result=await importCapturedFrontendResponse(frames.requestBytes,frames.responseBytes,frames.origin);
      assert.equal(result.status,'error','corrupted '+pin.directory+' '+name+' must be rejected');
      const code=result.diagnostics?.[0]?.code;assert.match(code,/^r03-exception-/);assert.notEqual(code,'r03-exception-identity','repaired negative must reach facts admission');
      assert.deepEqual([hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)],before,'reader must not mutate caller custody');
      t.diagnostic(JSON.stringify({directory:pin.directory,mutation:name,code}));
    });
    assert.deepEqual(baseline.buffers.map(hash),['request','response','origin','expected'].map(key=>'sha256:'+pin[key]));
  }
});
