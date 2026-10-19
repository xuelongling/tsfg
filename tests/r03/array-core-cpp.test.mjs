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

test('26a same real C++ CLI preserves Array5 no-view/no-call packages and independent candidate boundaries',async t=>{
  const manifest=await pinned('./array-core-cpp-cases-v5.json',2563931,'cd793b575f4f2b40c233fa73f9ef9aab97dd44b47581cba64bcd5c3d750e2dc5');
  const oracle=await pinned('./legacy-v5-old8-core-oracle.json',627351,'464443dc2ed8bdf6fcdf27227d26ba7344237aef21d822a55ded867fc3cb579b');
  assert.deepEqual(manifest.provenance,{CLIExecuted:false,coldCasesReproveSource:false,compiled:false,linked:false,
    newCppOutputSampled:false,productEmitterImported:false,sourceModuleImported:false,
    wholeSourceCredit:'only separate pinned independent whole oracle; no cold Source admission'});
  assert.equal(manifest.version,5);assert.equal(oracle.version,5);
  assert.deepEqual(oracle.format,{family:'tsfg.core-array-candidate',version:5,facts_version:5,
    profile:'dense-f64-array-readspan-params-checked-v5',
    schemaHash:'sha256:0411c646cc819836c03327ee44327c62e5c6aae668e8492e2b917acfa8dabb08'});
  assert.equal(manifest.cases.length,105);assert.equal(new Set(manifest.cases.map(c=>c.id)).size,105);
  assert.equal(manifest.cases.filter(c=>c.expected.exitCode===0).length,15);
  assert.equal(manifest.cases.filter(c=>c.expected.exitCode===3).length,90);
  assert.equal(manifest.wire.length,16);
  // Synthetic cold controls retain opaque envelope IDs; they do not reprove Source.
  // Complete old2/old3/old4 originals are explicit refusals, never legal5 inputs.
  for(const version of [2,3,4]){
    const legacy=manifest.cases.find(c=>c.id==='old-v'+version+'-marker-rejected');assert.ok(legacy);
    assert.equal(legacy.sourceOracle,undefined);assert.equal(legacy.expected.exitCode,3);
    assert.equal(legacy.expected.diagnostic,'[core-ir-array-marker]');
    assert.ok(legacy.input.includes('version = '+version+' : i32'));
    assert.ok(legacy.input.includes('facts_version = '+version+' : i32'));
  }
  const marker5='tsfg_core.array = {family = "tsfg.core-array-candidate", version = 5 : i32, schema = "sha256:0411c646cc819836c03327ee44327c62e5c6aae668e8492e2b917acfa8dabb08", profile = "dense-f64-array-readspan-params-checked-v5", facts_version = 5 : i32}';
  for(const c of manifest.cases.filter(c=>c.expected.exitCode===0))assert.ok(c.input.includes(marker5),c.id+' legal5 marker');
  assert.equal(15*4+90+manifest.wire.length+2,168,'preserved authorized CLI geometry');
  assert.equal(1+manifest.cases.length+manifest.wire.length+2,124,'complete parent and TAP subtests');
  let whole={functions:0,parameters:0,sites:0,aliases:0,elements:0,checkedReads:0,stores:0,resizes:0,constants:0,operations:0,registers:0};
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
  assert.deepEqual(whole,{functions:10,parameters:8,sites:11,aliases:9,elements:27,checkedReads:12,stores:7,resizes:4,constants:45,operations:108,registers:85});
  const full=oracle.cases[0];
  for(const c of manifest.cases.filter(c=>['alias-chain-flattened','checked-read-other-owner',
    'return-bypasses-checked-read','second-function-omitted'].includes(c.id))) {
    assert.throws(()=>assertArrayCoreSemantics(c.input,full),{code:'ERR_ASSERTION'});
  }
  t.diagnostic('26a Array5 C++ frozen controls complete:8 whole packages/10 functions/8 parameters/11 sites/7 stores/4 resizes/12 reads; other positives are cold static metadata/count controls');
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
