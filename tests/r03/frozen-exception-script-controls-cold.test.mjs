// SPDX-License-Identifier: MIT
// Uses two actual Go private frames after fresh official and independent full-packet assertions.
// expected-private.json comes from frozen fresh-official+independent-public-golden Go assertions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';

const root = new URL('../fixtures/r03/m21-exception/script-controls/', import.meta.url);
const schemaHash = 'sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') { assert.ok(value.isWellFormed()); return JSON.stringify(value); }
  if (typeof value === 'number') { assert.ok(Number.isFinite(value) && !Object.is(value, -0)); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
function frozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  assert.ok(!seen.has(value)); seen.add(value);
  assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) frozen(child, seen);
  seen.delete(value);
}
test('legal script and same-spelling module retain complete cold owned private facts', async t => {
  // Missing actual fixture/manifest is a failure; it never skips or synthesizes a frame.
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  assert.equal(manifest.schema,'r03.m21c.actual-private-script-controls.v1');
  assert.equal(manifest.cases.length,2);
  assert.equal(new Set(manifest.cases.map(item=>item.directory)).size,2);
  for (const item of manifest.cases) await t.test(item.test,async () => {
    assert.match(item.directory,/^\d\d$/);
    const names=['request.json','response.json','origin.json','expected-private.json'];
    const buffers=await Promise.all(names.map(name=>readFile(new URL(item.directory+'/'+name,root))));
    buffers.forEach((bytes,index)=>assert.equal(hash(bytes),'sha256:'+item.files[names[index]].sha256));
    const [requestBytes,responseBytes,originBytes,expectedBytes]=buffers;
    const decode=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    const requestText=decode(requestBytes),responseText=decode(responseBytes);
    const request=JSON.parse(requestText),packet=JSON.parse(responseText),origin=JSON.parse(decode(originBytes));
    const expectedPacket=JSON.parse(decode(expectedBytes));
    assert.equal(requestText,jcs(request)); assert.equal(responseText,jcs(packet));
    assert.deepEqual(packet,expectedPacket,'complete independent packet expected before reader import');
    assert.equal(packet.schemaHash,schemaHash); assert.equal(packet.family,'tsfg.exception-facts-package-candidate');
    assert.equal(packet.version,1);
    assert.equal(origin.kind,'owned-go-exception-response');
    assert.equal(origin.requestSha256,hash(requestBytes)); assert.equal(origin.responseSha256,hash(responseBytes));
    const files=request.input.files.map(file=>({path:file.path,content:file.content}))
      .sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
    const identityInput={...structuredClone(request.input),files};
    const inputIdentity=hash(jcs(identityInput));
    const manifestFiles=files.map(file=>({path:file.path,digest:hash(file.content),
      byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'}));
    assert.equal(packet.payload.inputIdentity,inputIdentity); assert.deepEqual(packet.payload.files,manifestFiles);
    assert.equal(packet.requestId,hash('tsfg.exception-facts.request.v1\0'+requestText));
    assert.equal(packet.packageId,hash('tsfg.exception-facts.package.v1\0'+schemaHash+'\0'+jcs(packet.payload)));
    const sources=files.filter(file=>!file.path.endsWith('.d.ts')).map(file=>({...file,hash:hash(file.content),
      length:file.content.length,positionUnit:'utf16'}));
    const expected={format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash},
      snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+schemaHash+'\0'+jcs({inputIdentity,sourceOrigin:origin})),
      sourceOrigin:structuredClone(origin),inputIdentity,identityInput,sources,target:request.input.target??null,
      facts:structuredClone(expectedPacket.payload.facts),exports:structuredClone(expectedPacket.payload.exports),
      capture:{request:requestText,response:responseText}};
    const before=buffers.map(hash),callerRequest=Uint8Array.from(requestBytes),callerResponse=Uint8Array.from(responseBytes);
    const imported=await importCapturedFrontendResponse(callerRequest,callerResponse,origin);
    assert.equal(imported.status,'ok','actual private corpus frame rejected: '+jcs(imported));
    assert.deepEqual(imported.snapshot,expected,'all10 fields and optional presence');
    frozen(imported); assert.doesNotThrow(()=>validateFrontendSnapshot(imported.snapshot));
    const text=jcs(imported.snapshot),cold=JSON.parse(text);
    assert.notStrictEqual(cold.facts,imported.snapshot.facts);
    assert.doesNotThrow(()=>validateFrontendSnapshot(cold)); assert.equal(jcs(cold),text);
    callerRequest.fill(0);callerResponse.fill(0);origin.producerDirty=!origin.producerDirty;
    assert.equal(jcs(imported.snapshot),jcs(expected));
    assert.doesNotThrow(()=>validateFrontendSnapshot(JSON.parse(text)));
    assert.deepEqual(buffers.map(hash),before);
  });
});
