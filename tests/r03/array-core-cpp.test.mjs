// SPDX-License-Identifier: MIT
// Root supplies the same freshly linked Core CLI. Reuse its existing capture helper.
// Per-child capture retains actual raw stdin/stdout/stderr/exit/close; it is not a new
// launcher, per-child v3 qualification, fsync proof, Source re-admission or execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';
import { pinned, sha } from './array-test-fixtures.mjs';
import { assertArrayCoreSemantics } from './array-core-structural-oracle.mjs';

/** A parser/trait refusal cannot stand in for the explicitly expected private gate.
 * @param {any} actual @param {string} diagnostic */
function refused(actual,diagnostic) {
  assert.equal(actual.close.code,3,actual.stderr.toString('utf8'));
  assert.equal(actual.stdout.length,0,'no partial output on refusal');
  assert.ok(actual.stderr.toString('utf8').includes(diagnostic),
    'exact gate '+diagnostic+'; earlier parser/trait failures receive no private credit:\n'+actual.stderr.toString('utf8'));
}

test('25c same real C++ CLI preserves every complete Array package and closes independent candidate boundaries',async t=>{
  const manifest=await pinned('./array-core-cpp-cases.json',1846677,'7b42a5bef17cb777abc2c6e5d1c7f5de566683def8db6abd6a79801ef5711a17');
  const oracle=await pinned('./array-core-oracle-v1.json',90582,'fc20c7f86b0253e89d10f0a7d3bf353b17d637574ad3f131df60f48394ccb7de');
  assert.deepEqual(manifest.provenance,{newCppOutputSampled:false,productEmitterImported:false,coldCasesReproveSource:false});
  assert.equal(manifest.cases.length,52);assert.equal(new Set(manifest.cases.map(c=>c.id)).size,52);
  assert.equal(manifest.cases.filter(c=>c.expected.exitCode===0).length,10);
  assert.equal(manifest.cases.filter(c=>c.expected.exitCode===3).length,42);
  assert.equal(manifest.wire.length,8);
  let whole={functions:0,sites:0,aliases:0,elements:0,checkedReads:0};
  // Check every frozen input and independently chosen preimage before the first CLI call.
  for(const c of manifest.cases) {
    assert.equal(Buffer.byteLength(c.input),c.bytes,c.id+' complete input bytes');
    assert.equal(sha(c.input),c.sha256,c.id+' complete immutable input hash');
    if(c.sourceOracle) {
      const fixed=oracle.cases.find(row=>row.name===c.sourceOracle);assert.ok(fixed);
      assert.equal(c.input,fixed.core);
      const n=assertArrayCoreSemantics(c.input,fixed);
      for(const key of Object.keys(whole))whole[key]+=n[key];
    }
    if(c.expected.exitCode===0&&c.counts)assert.deepEqual(assertArrayCoreSemantics(c.input,{core:c.input}),c.counts);
    if(c.preimages)for(const p of c.preimages) {
      assert.equal('sha256:'+sha(Buffer.from(p.preimageHex,'hex')),p.id);
      if(p.valueJcsNoLf)assert.equal(Buffer.from(p.domain+'\0'+p.valueJcsNoLf).toString('hex'),p.preimageHex);
    }
  }
  assert.deepEqual(whole,{functions:5,sites:6,aliases:5,elements:20,checkedReads:5});
  const full=oracle.cases[0];
  for(const c of manifest.cases.filter(c=>['alias-chain-flattened','checked-read-other-owner',
    'return-bypasses-checked-read','second-function-omitted'].includes(c.id))) {
    assert.throws(()=>assertArrayCoreSemantics(c.input,full),{code:'ERR_ASSERTION'});
  }
  t.diagnostic('25c C++ frozen controls complete:4 upstream whole packages/5 functions/6 distinct sites/20 elements/5 aliases; other positives are cold static metadata/count controls');
  for(const c of manifest.cases.filter(c=>c.expected.exitCode===0))await t.test(c.id,async()=>{
    const expected={core:c.input};
    const first=await invokeCore(c.input,'--canonicalize');accepted(first);
    assertArrayCoreSemantics(first.stdout.toString('utf8'),expected);
    const reread=await invokeCore(first.stdout,'--canonicalize');accepted(reread);
    assert.deepEqual(reread.stdout,first.stdout,'whole canonical reread');
    const optimized=await invokeCore(first.stdout,'--optimize');accepted(optimized);
    assertArrayCoreSemantics(optimized.stdout.toString('utf8'),expected);
    assert.deepEqual(optimized.stdout,first.stdout,'identity optimize retains all roots, aliases and checked reads');
    const direct=await invokeCore(c.input,'--optimize');accepted(direct);
    assert.deepEqual(direct.stdout,first.stdout,'direct optimize reaches the same canonical complete output');
  });
  for(const c of manifest.cases.filter(c=>c.expected.exitCode===3))await t.test(c.id,async()=>{
    refused(await invokeCore(c.input,'--canonicalize'),c.expected.diagnostic);
  });
  for(const c of manifest.wire)await t.test('wire/'+c.sourceOracle+'/'+c.command,async()=>{
    const expected=oracle.cases.find(row=>row.name===c.sourceOracle);assert.ok(expected);
    const result=await invokeCore(expected.core,c.command);refused(result,c.diagnostic);
    assert.equal(result.stderr.toString('utf8'),c.diagnostic,'whole fixed unsupported-wire diagnostic line');
  });
  const boundary=manifest.inputByteBoundary,empty=manifest.cases.find(c=>c.id===boundary.base);assert.ok(empty);
  await t.test('candidate input exact8388608 after the legacy parser',async()=>{
    const bytes=Buffer.alloc(boundary.exactBytes,32);Buffer.from(empty.input).copy(bytes);
    assert.equal(bytes.length,8388608);
    const result=await invokeCore(bytes,'--canonicalize');accepted(result);
    assertArrayCoreSemantics(result.stdout.toString('utf8'),{core:empty.input});
  });
  await t.test('candidate input8388609 rejects with zero output after the legacy parser',async()=>{
    const bytes=Buffer.alloc(boundary.overflowBytes,32);Buffer.from(empty.input).copy(bytes);
    assert.equal(bytes.length,8388609);
    refused(await invokeCore(bytes,'--canonicalize'),boundary.overflowDiagnostic);
  });
});
// No guest/VM/bounds-trap execution, formal wire success or ResourceProof credit.
// Producer output8MiB remains static-only below the admitted upstream domain.
