// SPDX-License-Identifier: MIT
// R04 Pillar 2 & 5: Cross-language (JS === Zig) identity parity, RF-01 Reflection Digest,
// real Core IR exchange envelope, Native Patch (.tpatch) with AOT GC root maps,
// transactional Module Reload (forbidding silent migration), and Compiler-Service RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  contractSetId,
  effectHash,
  functionId,
  HANDLE_LAYOUT,
  sha256,
  signatureHash,
  typeIdFnPtr,
  typeIdHandle,
  typeIdNominal,
  typeIdScalar,
  typeIdSpan,
  typeIdStringView,
  WINDOWS_X64_TARGET,
} from '../../compiler/r04-identity.mjs';
import { emitAbiArtifact } from '../../compiler/r04-abi.mjs';
import {
  emitCompilerServiceMessage,
  emitCoreIrExchange,
  emitModuleReload,
  emitNativePatch,
  emitTmetaArtifact,
  emitTmetaToDirectory,
  validateCompilerServiceMessage,
  validateCoreIrExchange,
  validateModuleReload,
  validateNativePatch,
  validateTmetaArtifact,
} from '../../compiler/r04-protocols.mjs';
import { buildFullR04AbiSpec, ensureR04ValidatorExe } from './r04-test-helpers.mjs';

const CORE_EXE = process.env.TSFG_CORE_IR_EXE ?? 'E:\\tsfg-build\\mlir-sdk\\bin\\tsfg-core-ir.exe';

function zigValidate(exe, kind, bytes) {
  const res = spawnSync(exe, ['--validate', kind], { input: bytes, windowsHide: true });
  return { status: res.status, stderr: res.stderr.toString('utf8').trim(), stdout: res.stdout.toString('utf8').trim() };
}

test('R04 Cross-Language Identity Parity: Node/JS === Zig Runtime bit-for-bit', async () => {
  const validatorExe = await ensureR04ValidatorExe();
  const probe = spawnSync(validatorExe, ['--identity-probe'], { windowsHide: true });
  assert.equal(probe.status, 0, probe.stderr.toString('utf8'));
  const zigIds = JSON.parse(probe.stdout.toString('utf8'));

  const nominalId = typeIdNominal('struct', '/src/abi.ts', 'Vec3');
  const i32Id = typeIdScalar('i32');
  const sigHash = signatureHash('i32', ['i32', 'f64']);
  const jsIds = {
    boolTypeId: typeIdScalar('bool'),
    contractSetId: contractSetId(),
    effectHash: effectHash({
      capabilities: ['host.log'],
      mayAllocate: false,
      mayCallHost: true,
      mayThrow: false,
      reads: ['Position'],
      writes: ['Velocity'],
    }),
    fnPtrTypeId: typeIdFnPtr(sigHash),
    functionId: functionId('/src/abi.ts', 'step', 'i32', ['i32', 'f64']),
    handleAlign: HANDLE_LAYOUT.align,
    handleSize: HANDLE_LAYOUT.size,
    handleTypeId: typeIdHandle(nominalId),
    i32TypeId: i32Id,
    nominalTypeId: nominalId,
    readSpanTypeId: typeIdSpan(false, i32Id),
    signatureHash: sigHash,
    spanTypeId: typeIdSpan(true, i32Id),
    stringViewTypeId: typeIdStringView(),
  };

  assert.deepEqual(zigIds, jsIds, 'Node/JS and Zig Runtime identity hashes must match bit-for-bit');
});

test('R04 RF-01 Reflection Digest determinism across independent output dirs + mutation detection', async () => {
  const validatorExe = await ensureR04ValidatorExe();
  const abi = emitAbiArtifact(buildFullR04AbiSpec());
  const fnId = functionId('/src/game.ts', 'integrate', 'void', ['f32']);
  const sigHash = signatureHash('void', ['f32']);
  const effHash = effectHash({ reads: ['Velocity'], writes: ['Position'] });
  const staticSchema = sha256('static-schema-v1');
  const captureHash = sha256('capture-empty');

  const spec = {
    abiHash: abi.payload.abiHash,
    components: ['Position', 'Velocity'],
    functions: [
      {
        captureLayoutHash: captureHash,
        effectHash: effHash,
        functionId: fnId,
        name: 'integrate',
        signatureHash: sigHash,
        staticSchemaHash: staticSchema,
      },
    ],
    inputIdentity: sha256('input-game-v1'),
    queries: [
      {
        conflictsWith: [],
        name: 'integrate',
        queryTmetaDigest: sha256('query-tmeta-v2-integrate'),
        reads: ['Velocity'],
        writes: ['Position'],
      },
    ],
    types: abi.payload.types.filter((t) => t.kind === 'struct'),
  };

  const baseTmp = 'E:\\tsfg-temp\\r04-rf01-test';
  try {
    const outA = await emitTmetaToDirectory(path.join(baseTmp, 'dir-one'), spec);
    const outB = await emitTmetaToDirectory(path.join(baseTmp, 'dir-two'), spec);
    assert.ok(outA.bytes.equals(outB.bytes), 'RF-01: .tmeta bytes must be identical across independent output dirs');
    assert.equal(outA.reflectionDigest, outB.reflectionDigest, 'RF-01: reflectionDigest must match across dirs');

    validateTmetaArtifact(outA.bytes, { abiHash: abi.payload.abiHash });
    assert.equal(zigValidate(validatorExe, 'tmeta', outA.bytes).status, 0);

    // Mutate relevant input -> digest MUST change
    const outMut = await emitTmetaToDirectory(path.join(baseTmp, 'dir-mut'), {
      ...spec,
      queries: [{ ...spec.queries[0], writes: ['Position', 'Velocity'] }],
    });
    assert.notEqual(outMut.reflectionDigest, outA.reflectionDigest, 'RF-01: mutating query write set must change digest');
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});

test('R04 Core IR Exchange, Native Patch (.tpatch + GC stackmap), Module Reload, and Compiler-Service RPC (JS + Zig)', async () => {
  const validatorExe = await ensureR04ValidatorExe();
  const abi = emitAbiArtifact(buildFullR04AbiSpec());
  const fnId = functionId('/src/hot.ts', 'tick', 'i32', ['i32']);
  const sigHash = signatureHash('i32', ['i32']);
  const effHash = effectHash({ reads: ['Position'], writes: ['Position'] });
  const captureHash = sha256('capture-env-v1');
  const schemaV1 = sha256('module-static-schema-v1');
  const schemaV2 = sha256('module-static-schema-v2');

  // 1. Core IR Exchange wrapping real canonical MLIR text
  const sampleIr = 'builtin.module {\n  func.func @tick(%arg0: i32) -> i32 {\n    return %arg0 : i32\n  }\n}\n';
  const irEx = emitCoreIrExchange({
    abiHash: abi.payload.abiHash,
    canonicalIr: sampleIr,
    capabilities: ['common20', 'win64_c'],
    inputIdentity: sha256('core-ir-input'),
    irDialect: 'tsfg_program',
    publishedFunctions: [{ effectHash: effHash, functionId: fnId, signatureHash: sigHash }],
    sourceDigest: sha256('source-hot-ts'),
  });
  validateCoreIrExchange(irEx.bytes, { abiHash: abi.payload.abiHash });
  assert.equal(zigValidate(validatorExe, 'core-ir-exchange', irEx.bytes).status, 0);

  // Corrupt IR text inside envelope -> rejected by both JS and Zig
  const badIrBytes = Buffer.from(irEx.bytes.toString('utf8').replace('return %arg0', 'return %arg1'), 'utf8');
  assert.throws(() => validateCoreIrExchange(badIrBytes), /r04-payload-corrupted|r04-core-ir/);
  assert.equal(zigValidate(validatorExe, 'core-ir-exchange', badIrBytes).status, 4);

  // 2. Native Patch (.tpatch) with AOT GC safepoint root map + live FunctionCell checks
  const patchSpec = {
    abiHash: abi.payload.abiHash,
    artifact: { byteSize: 4096, format: 'coff-dll', sha256: sha256('coff-dll-bytes-v2') },
    codeVersion: 2,
    epoch: 10,
    functions: [
      {
        abiCallConv: 'win64_c',
        captureLayoutHash: captureHash,
        effectHash: effHash,
        entrySymbol: 'tsfg_hot_tick_v2',
        functionId: fnId,
        signatureHash: sigHash,
        stackMap: [
          {
            frameSize: 64,
            pcOffset: 24,
            roots: [
              { kind: 'live_ref', slotOffset: 8, tagOffset: -1 },
              { kind: 'nullable_ref', slotOffset: 16, tagOffset: -1 },
              { kind: 'union_active_ref', slotOffset: 24, tagOffset: 20 },
              { kind: 'derived_span', slotOffset: 32, tagOffset: -1 },
            ],
          },
        ],
        tierAdapter: 'vm_trampoline',
      },
    ],
    moduleId: sha256('/src/hot.ts'),
    patchId: sha256('patch-v2'),
    staticSchemaHash: schemaV1,
  };
  const patch = emitNativePatch(patchSpec);
  const liveState = {
    abiHash: abi.payload.abiHash,
    cells: new Map([[fnId, { captureLayoutHash: captureHash, effectHash: effHash, signatureHash: sigHash }]]),
    codeVersion: 1,
    staticSchemaHash: schemaV1,
  };
  validateNativePatch(patch.bytes, liveState);
  assert.equal(zigValidate(validatorExe, 'native-patch', patch.bytes).status, 0);

  // Negative patch cases: stale version, silent schema migration, signature/effect/capture mismatch, invalid root kind
  assert.throws(() => validateNativePatch(patch.bytes, { ...liveState, codeVersion: 2 }), /r04-patch-stale-version/);
  assert.throws(() => validateNativePatch(patch.bytes, { ...liveState, staticSchemaHash: schemaV2 }), /r04-patch-static-schema-mismatch/);
  assert.throws(
    () => validateNativePatch(patch.bytes, { ...liveState, cells: new Map([[fnId, { captureLayoutHash: captureHash, effectHash: effHash, signatureHash: sha256('other-sig') }]]) }),
    /r04-patch-signature-mismatch/,
  );
  assert.throws(
    () => emitNativePatch({ ...patchSpec, forbidDataMigration: false }),
    /r04-patch-migration-forbidden/,
  );
  assert.throws(
    () => emitNativePatch({
      ...patchSpec,
      functions: [{ ...patchSpec.functions[0], stackMap: [{ frameSize: 32, pcOffset: 8, roots: [{ kind: 'scalar_i32', slotOffset: 0 }] }] }],
    }),
    /r04-patch-root-kind/,
  );

  // 3. Module Reload Transaction (explicit schema transform + rollback)
  const migHook = functionId('/src/hot.ts', 'migrateV1ToV2', 'void', []);
  const reload = emitModuleReload({
    abiHash: abi.payload.abiHash,
    affectedGlobals: ['score', 'wave'],
    fromEpoch: 10,
    migrationHookFunctionId: migHook,
    migrationMode: 'explicit_transform',
    moduleId: sha256('/src/hot.ts'),
    nextSchemaHash: schemaV2,
    patchDigest: patch.envelope.payloadHash,
    phase: 'stage',
    previousSchemaHash: schemaV1,
    toEpoch: 11,
    transactionId: sha256('tx-reload-1'),
  });
  validateModuleReload(reload.bytes, { abiHash: abi.payload.abiHash });
  assert.equal(zigValidate(validatorExe, 'module-reload', reload.bytes).status, 0);

  // Negative: schema changed with migrationMode='none' MUST be rejected
  assert.throws(
    () => emitModuleReload({
      abiHash: abi.payload.abiHash,
      fromEpoch: 10,
      migrationMode: 'none',
      moduleId: sha256('/src/hot.ts'),
      nextSchemaHash: schemaV2,
      patchDigest: patch.envelope.payloadHash,
      phase: 'stage',
      previousSchemaHash: schemaV1,
      toEpoch: 11,
      transactionId: sha256('tx-bad'),
    }),
    /r04-reload-schema-change/,
  );

  // 4. Compiler-Service RPC Request & Response
  const reqMsg = emitCompilerServiceMessage({
    direction: 'request',
    epoch: 11,
    inputDigest: sha256('req-input-11'),
    operation: 'compile_patch',
    options: { optimize: true },
    requestId: 'req-0011',
  });
  validateCompilerServiceMessage(reqMsg.bytes, { contractSetId: contractSetId(), minEpoch: 10 });
  assert.equal(zigValidate(validatorExe, 'compiler-service', reqMsg.bytes).status, 0);
  assert.throws(() => validateCompilerServiceMessage(reqMsg.bytes, { minEpoch: 12 }), /r04-service-stale-epoch/);

  const resOk = emitCompilerServiceMessage({
    artifactDigest: patch.envelope.payloadHash,
    artifactFamily: 'tsfg.native-patch',
    direction: 'response',
    elapsedMs: 14,
    epoch: 11,
    operation: 'compile_patch',
    requestId: 'req-0011',
    status: 'ok',
  });
  validateCompilerServiceMessage(resOk.bytes, { minEpoch: 11 });
  assert.equal(zigValidate(validatorExe, 'compiler-service', resOk.bytes).status, 0);

  const resErr = emitCompilerServiceMessage({
    diagnosticCode: 'r04-patch-static-schema-mismatch',
    direction: 'response',
    elapsedMs: 3,
    epoch: 11,
    operation: 'compile_patch',
    requestId: 'req-0012',
    status: 'rejected',
  });
  validateCompilerServiceMessage(resErr.bytes, { minEpoch: 11 });
  assert.equal(zigValidate(validatorExe, 'compiler-service', resErr.bytes).status, 0);
  assert.throws(
    () => emitCompilerServiceMessage({ direction: 'response', epoch: 11, operation: 'compile_patch', requestId: 'x', status: 'rejected' }),
    /r04-service-diag/,
  );
});
