// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
test('actual complete optional v1 package reaches the old exact reader capability boundary',async()=>{
  const bytes=await readFile(new URL('./testdata/optional-property-v1/source-package.json',import.meta.url));
  const request=await readFile(new URL('./testdata/optional-property-v1/source-request.json',import.meta.url));
  const packet=JSON.parse(bytes.toString()),input=JSON.parse(request.toString());
  assert.equal(bytes.length,17139);assert.equal(bytes.toString(),canonical(packet)+'\n');
  assert.equal(request.length,1900);assert.equal(request.toString(),canonical(input)+'\n');
  assert.equal(packet.requestId,sha256('tsfg.optional-property-facts.request.v1\0'+request));
  assert.equal(packet.packageId,sha256('tsfg.optional-property-facts.package.v1\0'+packet.schemaHash+'\0'+canonical(packet.payload)));
  assert.equal(packet.payload.files.find(file=>file.path===packet.payload.rootFile).byteLength,307);
  assert.deepEqual(packet.payload.functions.map(fn=>fn.name),['inspect','run']);
  assert.equal(packet.payload.types.filter(row=>row.kind==='reference').length,3);
  assert.throws(()=>readTypedArrayFacts(bytes),{code:'r03-typed-array-schema'});
});
