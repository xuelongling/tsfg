// SPDX-License-Identifier: MIT
// Independent final-review regressions with exact actual controls and repaired frames.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
const schema='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const pins={"22":{"request":"e17ffaf98896f8148dabf47fea5ec75940654423b62620ee40c237574edce806","response":"eabb2d2f4e483f20777d8c0db3316850105d9fdd07f883ecbcc1a3aadf00d14a","origin":"e0017e70e38aedb9c9d9da56df3f284e316343f08ba3746cc4bebed829d1a116","expected-private":"eabb2d2f4e483f20777d8c0db3316850105d9fdd07f883ecbcc1a3aadf00d14a"},"08":{"request":"584a1c04fa3686f223a2cf3c38c83b3e3ba91ac8ab6c4ea49c67f6139f05145b","response":"ec8f399ef5ea0208b41003886c6aa308de07c7e9d611917e5150748a880184a8","origin":"97a5939eb78f38694bb662cbf0c898dd91c4c3600159957a87d0edf4222f0d3e","expected-private":"ec8f399ef5ea0208b41003886c6aa308de07c7e9d611917e5150748a880184a8"},"09":{"request":"a7bca733fa641a4a81c2796e7f18cf07f9b1f38f20e098b76f694b5a975a8d91","response":"b0182cf425db65f5afb6f8f0e5300b38a7230c478f38d4a912f8864d7d335035","origin":"de2a946f1957288763fbaf640a63de18d92025fe91c5fbdea6c24d17d13343b2","expected-private":"b0182cf425db65f5afb6f8f0e5300b38a7230c478f38d4a912f8864d7d335035"}};
const cases=[{"name":"scriptPairControl","className":"Pair","external":false,"invalid":false,"source":"// 😀\r\n@tsfgValue class Pair {}\r\nfunction entry(): Pair { return new Pair(); }","bytes":80,"utf16":78,"sha256":"cc548f7d580c5b3a015f218f9926544bd9664f31024f9b1f4ae66c50c94fb120"},{"name":"moduleI32Control","className":"i32","external":true,"invalid":false,"source":"// 😀\r\n@tsfgValue class i32 {}\r\nexport function entry(): i32 { return new i32(); }","bytes":84,"utf16":82,"sha256":"89e011df1586c0879e423fd58a1a4cc4a69851ec5fb472558cb743c987ee6c42"},{"name":"scriptI32TypeAliasConflict","className":"i32","external":false,"invalid":true,"source":"// 😀\r\n@tsfgValue class i32 {}\r\nfunction entry(): i32 { return new i32(); }","bytes":77,"utf16":75,"sha256":"e1c592b14c49d05ee2a65e855d3894f19349464f364f41c8f89b77657d9a29eb"},{"name":"scriptBoolTypeAliasConflict","className":"bool","external":false,"invalid":true,"source":"// 😀\r\n@tsfgValue class bool {}\r\nfunction entry(): bool { return new bool(); }","bytes":80,"utf16":78,"sha256":"d42889ce8462b2422afa8379659ee6813aadf313d6b33e1af98c86b6b3f8f549"},{"name":"scriptF64TypeAliasConflict","className":"f64","external":false,"invalid":true,"source":"// 😀\r\n@tsfgValue class f64 {}\r\nfunction entry(): f64 { return new f64(); }","bytes":77,"utf16":75,"sha256":"f9cbcd878be8b87378533fa9bd7004a443704319d45cef21d73b6f88aefc20c0"}];
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
  for(const file of q.input.files)if(Object.hasOwn(file,'sha256'))file.sha256=hash(file.content);
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
function identities(frames) {
  const q=JSON.parse(frames.requestBytes.toString('utf8')),p=JSON.parse(frames.responseBytes.toString('utf8'));
  assert.equal(jcs(q),frames.requestBytes.toString('utf8'));assert.equal(jcs(p),frames.responseBytes.toString('utf8'));
  assert.equal(q.schemaHash,schema);assert.equal(p.schemaHash,schema);
  assert.equal(frames.origin.requestSha256,hash(frames.requestBytes));assert.equal(frames.origin.responseSha256,hash(frames.responseBytes));
  assert.equal(p.requestId,hash('tsfg.exception-facts.request.v1\0'+frames.requestBytes));
  assert.equal(p.packageId,hash('tsfg.exception-facts.package.v1\0'+schema+'\0'+jcs(p.payload)));
  const files=q.input.files.map(file=>({path:file.path,content:file.content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  assert.equal(p.payload.inputIdentity,hash(jcs({...q.input,files})));
  assert.deepEqual(p.payload.files,files.map(file=>({path:file.path,digest:hash(file.content),byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'})));
  for(const file of q.input.files)if(Object.hasOwn(file,'sha256'))assert.equal(file.sha256,hash(file.content));
}
/** @param {string} directory */
async function load(directory) {
  const root=new URL('../fixtures/r03/m21-exception/corpus/'+directory+'/',import.meta.url);
  const names=['request','response','origin','expected-private'];
  const buffers=await Promise.all(names.map(name=>readFile(new URL(name+'.json',root))));
  for(const [index,name] of names.entries())assert.equal(hash(buffers[index]),'sha256:'+pins[directory][name]);
  assert.deepEqual(buffers[1],buffers[3],'actual complete packet equals independent frozen expected');
  const [q,p,o]=buffers.slice(0,3).map(buffer=>JSON.parse(buffer.toString('utf8')));
  return {q,p,o,buffers,frames:{requestBytes:buffers[0],responseBytes:buffers[1],origin:o}};
}
/** @param {any} q @param {any} p @param {any} o @param {any} frames */
function expectedSnapshot(q,p,o,frames) {
  const files=q.input.files.map(file=>({path:file.path,content:file.content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  return {format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:schema},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+schema+'\0'+jcs({inputIdentity:p.payload.inputIdentity,sourceOrigin:o})),
    sourceOrigin:clone(o),inputIdentity:p.payload.inputIdentity,identityInput:{...clone(q.input),files},
    sources:files.filter(file=>!file.path.endsWith('.d.ts')).map(file=>({...file,hash:hash(file.content),length:file.content.length,positionUnit:'utf16'})),
    target:clone(q.input.target??null),facts:clone(p.payload.facts),exports:clone(p.payload.exports),
    capture:{request:frames.requestBytes.toString('utf8'),response:frames.responseBytes.toString('utf8')}};
}
/** @param {any} value @param {(p:number)=>number} point */
function ranges(value,point) {
  if(!value||typeof value!=='object')return;
  if(!Array.isArray(value)&&Object.keys(value).sort().join(',')==='end,start'){
    value.start=point(value.start);value.end=point(value.end);return;
  }
  for(const [key,child] of Object.entries(value))if(key!=='declarationRange')ranges(child,point);
}
/** @param {any} q @param {any} p @param {any} tc */
function transform(q,p,tc) {
  const file=q.input.files.find(file=>file.path===q.input.rootFile),before=file.content;
  assert.equal(before,'// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(): Pair { return new Pair(); }');
  const edits=[...before.matchAll(/Pair/g)].map(match=>({start:match.index,end:match.index+4,text:tc.className}));
  assert.equal(edits.length,3);
  if(!tc.external){const start=before.indexOf('export function');assert.ok(start>=0);edits.push({start,end:start+7,text:''});}
  edits.sort((a,b)=>a.start-b.start);
  const point=position=>{
    let shift=0;
    for(const edit of edits){
      assert.ok(position<=edit.start||position>=edit.end,'no owned anchor may land inside replaced spelling');
      if(position>=edit.end)shift+=edit.text.length-(edit.end-edit.start);
    }
    return position+shift;
  };
  file.content=edits.reduceRight((value,edit)=>value.slice(0,edit.start)+edit.text+value.slice(edit.end),before);
  assert.equal(file.content,tc.source);assert.equal(hash(file.content),'sha256:'+tc.sha256);
  assert.equal(Buffer.byteLength(file.content),tc.bytes);assert.equal(file.content.length,tc.utf16);
  ranges(p.payload.facts,point);ranges(p.payload.exports,point);
  const aggregate=p.payload.facts.aggregateFacts,declaration=aggregate.declarations[0];
  declaration.name=tc.className;declaration.nominalKey.declarationPath=[tc.className];
  aggregate.sourceCoverage[0].name=tc.className;p.payload.facts.symbols[0].name=tc.className;
}
/** @param {any} value */
function frozen(value){if(!value||typeof value!=='object')return;assert.ok(Object.isFrozen(value));for(const child of Object.values(value))frozen(child);}
test('script classes respect the actual pinned DTS type namespace',async t=>{
  const baseline=await load('22'),declarations=clone(baseline.q.input.files.slice(1));identities(baseline.frames);
  for(const tc of cases)await t.test(tc.name,async()=>{
    const q=clone(baseline.q),p=clone(baseline.p);transform(q,p,tc);
    if(!tc.external){p.payload.exports[0].external=false;p.payload.exports[0].bindings=[];}
    assert.deepEqual(q.input.files.slice(1),declarations);
    const frames=seal(q,p,baseline.o);identities(frames);
    const preserved=[hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)];
    const result=await importCapturedFrontendResponse(frames.requestBytes,frames.responseBytes,frames.origin);
    t.diagnostic(JSON.stringify({name:tc.name,sourceSha256:tc.sha256,status:result.status,code:result.diagnostics?.[0]?.code??null}));
    if(tc.invalid){
      assert.equal(result.status,'error','an officially invalid script class must not gain admission from repaired frames');
      const code=result.diagnostics?.[0]?.code;assert.match(code,/^r03-exception-/);assert.notEqual(code,'r03-exception-identity');
    }else{
      assert.equal(result.status,'ok');assert.deepEqual(result.snapshot,expectedSnapshot(q,p,frames.origin,frames));frozen(result.snapshot);
      const expected={snapshotId:result.snapshot.snapshotId,functions:1,calls:0};
      assert.deepEqual(validateFrontendSnapshot(result.snapshot),expected);
      assert.deepEqual(validateFrontendSnapshot(clone(result.snapshot)),expected);
    }
    assert.deepEqual([hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)],preserved);
    assert.deepEqual(q.input.files.slice(1),declarations);
  });
});
test('cold validation reports actual structural call counts',async t=>{
  for(const tc of [{directory:'22',functions:1,calls:0},{directory:'08',functions:2,calls:1},{directory:'09',functions:2,calls:1}])
    await t.test(tc.directory,async()=>{
      const {q,p,o,frames}=await load(tc.directory);identities(frames);
      const result=await importCapturedFrontendResponse(frames.requestBytes,frames.responseBytes,frames.origin);
      assert.equal(result.status,'ok');assert.deepEqual(result.snapshot,expectedSnapshot(q,p,o,frames));frozen(result.snapshot);
      const expected={snapshotId:result.snapshot.snapshotId,functions:tc.functions,calls:tc.calls};
      const summary=validateFrontendSnapshot(result.snapshot);t.diagnostic(JSON.stringify({directory:tc.directory,summary,expected}));
      assert.deepEqual(summary,expected);assert.deepEqual(validateFrontendSnapshot(clone(result.snapshot)),expected);
    });
});
