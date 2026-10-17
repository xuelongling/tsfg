// SPDX-License-Identifier: MIT
// Independent callable source/signature controls; actual captures and forged negatives are distinct.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
const schema='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const pins=[
  {
    "directory": "18",
    "request": "3e71f0803f2e37489ea418cb385998e992d2850e2a9592a9719cf0531f398675",
    "response": "8992c560e4c05af3afbab54452c8acd5ff2871ecac7a147169715fd40e0a938a",
    "origin": "e6e72a787dfb3f323c4a88f55ef19e177912232f98adeafc1b2f051a28b521cf",
    "expected": "8992c560e4c05af3afbab54452c8acd5ff2871ecac7a147169715fd40e0a938a"
  },
  {
    "directory": "19",
    "request": "5d145d184ea752a0330323b6087175689f34adcaed2890a689b60cab42987beb",
    "response": "26ad93bfe793fcd767c6a3e2299001e69e35838fb730fa415935e172c53a2431",
    "origin": "020149b29ef1ec14b1fabe7078fa42f43af99f6521211a979a8c8fbbe91a826f",
    "expected": "26ad93bfe793fcd767c6a3e2299001e69e35838fb730fa415935e172c53a2431"
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
  for(const [index,key] of ['request','response','origin','expected'].entries())assert.equal(hash(buffers[index]),'sha256:'+pin[key]);
  assert.deepEqual(buffers[1],buffers[3],'actual package must equal independently frozen complete expected');
  const [q,p,o]=buffers.slice(0,3).map(buffer=>JSON.parse(buffer.toString('utf8')));
  const verb=pin.directory==='18'?'return':'throw';
  assert.equal(q.input.files.find(file=>file.path===q.input.rootFile).content,'// 😀\r\nexport function entry(payload: () => bool): () => bool { '+verb+' payload; }');
  const signature={parameters:[],returnType:'bool'},facts=p.payload.facts,fn=facts.functions[0];
  assert.deepEqual(fn.returnSignature,signature);assert.deepEqual(fn.parameters[0].signature,signature);
  assert.deepEqual(facts.symbols[1].signature,signature);assert.deepEqual(fn.body[0].expression.signature,signature);
  assert.equal(fn.body[0].kind,verb);assert.equal(fn.body[0].expression.type,'function');
  const frames={requestBytes:buffers[0],responseBytes:buffers[1],origin:o};assertIdentities(frames);
  return {q,p,o,buffers,frames};
}
/** @type {Array<[string,(value:any)=>void]>} */
const mutations=[
  ['parameterSignatureMissingBoth',x=>{delete x.parameter.signature;delete x.parameterDefinition.signature;}],
  ['coherentWrongCallableResult',x=>{for(const s of x.signatures)s.returnType='i32';}],
  ['coherentWrongCallableParameters',x=>{for(const s of x.signatures)s.parameters=['i32'];}],
  ['coherentSignatureUnknownKey',x=>{for(const s of x.signatures)s.optional=true;}],
  ['coherentNestedSignature',x=>{for(const s of x.signatures)s.returnSignature={parameters:[],returnType:'bool'};}],
  ['parameterRegistrySignatureMismatch',x=>{x.parameterDefinition.signature.returnType='i32';}],
  ['parameterHasScalarPresence',x=>{for(const p of [x.parameter,x.parameterDefinition])p.presence={optional:false,default:false,null:false,undefined:false};}],
  ['parameterHasReturnMetadata',x=>{for(const p of [x.parameter,x.parameterDefinition])p.returnPresence={null:false,undefined:false};}],
  ['functionSymbolHasParameterSignature',x=>{x.definition.signature=clone(x.fn.returnSignature);}],
  ['functionSymbolHasReturnSignature',x=>{x.definition.returnSignature=clone(x.fn.returnSignature);}],
  ['functionSymbolHasScalarPresence',x=>{x.definition.returnPresence={null:false,undefined:false};}],
  ['returnSignatureMissing',x=>{delete x.fn.returnSignature;}],
  ['returnSignatureWrongResult',x=>{x.fn.returnSignature.returnType='i32';}],
  ['returnSignatureHasParameters',x=>{x.fn.returnSignature.parameters=['i32'];}],
  ['returnSignatureHasUnknownKey',x=>{x.fn.returnSignature.optional=true;}],
  ['callableRouteHasParameterInitializers',x=>{x.fn.parameterInitializers=[null];}],
  ['referenceSignatureMissing',x=>{delete x.value.signature;}],
  ['referenceSignatureWrongResult',x=>{x.value.signature.returnType='i32';}],
  ['referenceSignatureHasParameters',x=>{x.value.signature.parameters=['i32'];}],
  ['referenceSignatureHasUnknownKey',x=>{x.value.signature.target='s1';}],
  ['referenceHasScalarPresenceFlow',x=>{x.value.presenceFlow={null:false,undefined:false};}],
  ['referenceTargetsFunctionDefinition',x=>{x.value.symbol=x.definition.id;}],
  ['parameterCoherentlyPretendsScalarWithSignature',x=>{x.parameter.type='bool';x.parameterDefinition.type='bool';}],
  ['referencePretendsScalarWithSignature',x=>{x.value.type='bool';}],
  ['functionDtoPretendsScalarWithSignature',x=>{x.fn.returnType='bool';x.definition.type='bool';}],
  ['parameterInitializerInvented',x=>{x.parameter.initializer={kind:'boolean',type:'bool',boolean:true,range:clone(x.parameter.range)};x.parameterDefinition.initializer=clone(x.parameter.initializer);}],
];

test('independent callable source signature and metadata ownership reject repaired fact corruption',async t=>{
  for(const pin of pins) {
    const baseline=await captured(pin);
    await t.test(pin.directory+' actual private positive control',async()=>{
      const result=await importCapturedFrontendResponse(baseline.frames.requestBytes,baseline.frames.responseBytes,baseline.frames.origin);
      assert.equal(result.status,'ok');validateFrontendSnapshot(result.snapshot);
      const cold=JSON.parse(JSON.stringify(result.snapshot));validateFrontendSnapshot(cold);
    });
    for(const [name,mutate] of mutations)await t.test(pin.directory+' '+name,async()=>{
      const q=clone(baseline.q),p=clone(baseline.p),facts=p.payload.facts,fn=facts.functions[0];
      const parameter=fn.parameters[0],definition=facts.symbols.find(symbol=>symbol.id===fn.symbol);
      const parameterDefinition=facts.symbols.find(symbol=>symbol.id===parameter.id),value=fn.body[0].expression;
      mutate({fn,definition,parameter,parameterDefinition,value,signatures:[fn.returnSignature,parameter.signature,parameterDefinition.signature,value.signature]});
      const frames=seal(q,p,baseline.o);assertIdentities(frames);
      assert.deepEqual(q,baseline.q);assert.deepEqual(p.payload.exports,baseline.p.payload.exports);
      const before=[hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)];
      const result=await importCapturedFrontendResponse(frames.requestBytes,frames.responseBytes,frames.origin);
      assert.equal(result.status,'error','corrupted '+pin.directory+' '+name+' must reject');
      const code=result.diagnostics?.[0]?.code;assert.match(code,/^r03-exception-/);assert.notEqual(code,'r03-exception-identity');
      assert.deepEqual([hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)],before);
      t.diagnostic(JSON.stringify({directory:pin.directory,mutation:name,code}));
    });
    assert.deepEqual(baseline.buffers.map(hash),['request','response','origin','expected'].map(key=>'sha256:'+pin[key]));
  }
});
