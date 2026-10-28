// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {invokeCore} from './generic-core-package-capture.mjs';
import {index,file,json,streams,stderrBytes,jcs,hash,measure,semantic,transport,generated} from './array-owner-proof-fixtures.mjs';
const command='--array-owner-proof';
function checked(result,expected,stdout,stderr){
  assert.equal(result.exit.code,expected.exit,result.stderr.toString('utf8'));
  assert.equal(result.close.code,expected.exit);
  assert.deepEqual(result.stdout,stdout);
  assert.deepEqual(result.stderr,stderr);
}
async function run(raw,expected,stdout=streams(expected).stdout,stderr=streams(expected).stderr){
  const result=await invokeCore(raw,command);checked(result,expected,stdout,stderr);
}
test('independent complete Array owner Core literal corpus retains exact identities',()=>{
  assert.equal(index.schemaHash,'sha256:69efbb1de3c034ede07d63c0ea0a03a57a08a84add8287e65772587b7cb5d9ab');
  assert.equal(index.cases.length,20);assert.equal(index.counts.semanticVectors,42);assert.equal(index.counts.transportVectors,64);
  for(const row of index.cases){
    const request=json(row.request.path);assert.equal(hash(request.coreText),row.core.sha256);
    assert.equal(Buffer.byteLength(request.coreText),row.core.bytes);
    assert.equal(file(row.request.path).length,row.request.bytes);
    const expected=streams(row.expected);
    if(row.expected.exit===0){
      const proof=JSON.parse(expected.stdout.toString('utf8'));assert.equal(proof.accesses.length,proof.sites.length);
      assert.equal(proof.pairs.length,proof.sites.length*(proof.sites.length-1)/2);
      assert.equal(proof.binding.coreTextDigest,hash('tsfg.array-owner-core-text.v1\0'+request.coreText));
      assert.equal(proof.schemaHash,index.schemaHash);
    }
  }
});
test('real full Array verifier and owner consumer match all20 frozen whole inputs',async t=>{
  for(const row of index.cases)await t.test(row.name,async()=>{
    const expected=streams(row.expected);
    await run(file(row.request.path),row.expected,expected.stdout,expected.stderr);
    if(row.expected.exit===0){
      const request=json(row.request.path);request.mode='verify';request.proof=JSON.parse(expected.stdout.toString('utf8'));
      const counts=measure(request);
      // The envelope's aggregate budget still applies when a maximal valid
      // output is wrapped as verify input. Do not pretend every proof fits twice.
      if(counts.bytes<=8388608&&counts.members<=65536&&counts.tokens<=200000)
        await run(Buffer.from(jcs(request)+'\n'),row.expected,expected.stdout,expected.stderr);
    }
  });
});
test('actual consumer preserves42 semantic identity, full-slot, provenance and strict proof controls',async t=>{
  const rows=json('semantic-vectors.json').vectors;assert.equal(rows.length,42);
  for(const row of rows)await t.test(row.name,async()=>run(semantic(row),row.expected));
});
test('complete transport handles64 independent JCS/IJSON vectors before typed selection',async t=>{
  const vectors=json('transport-vectors.json');assert.equal(vectors.vectors.length,64);
  for(const row of vectors.vectors)await t.test(row.name,async()=>run(transport(row),row.expected));
});
test('actual input byte, string, depth, member and token boundaries remain finite',async t=>{
  const rows=json('transport-vectors.json').budgets;assert.equal(rows.length,10);
  for(const row of rows)await t.test(row.name,async()=>{
    const raw=transport(row);assert.equal(raw.length,row.transportBytes);assert.equal(hash(raw),row.sha256);
    await run(raw,row.expected);
  });
});
test('old path1MiB, real output8MiB and oversize diagnostic use complete independent inputs',async t=>{
  const rows=[...json('long-path-vectors.json').vectors,...json('output-byte-vectors.json').vectors,
    json('diagnostic-budget-vector.json')];
  assert.equal(rows.length,5);
  for(const row of rows)await t.test(row.name,async()=>{
    const value=generated(row);await run(value.raw,row.expected,value.stdout,stderrBytes(row.expected.stderr));
  });
});
// Static C++ consumers only. No Source/VM/guest/Host/inspector or execution credit.
