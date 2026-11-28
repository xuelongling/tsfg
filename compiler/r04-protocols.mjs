// SPDX-License-Identifier: MIT
// R04 canonical producers & strict validators for:
//   - tsfg.tmeta (v1, with RF-01 deterministic Reflection Digest)
//   - tsfg.core-ir-exchange (v1)
//   - tsfg.native-patch (v1, .tpatch — cross-tier call & AOT GC stackmap contract)
//   - tsfg.module-reload (v1 — explicit transactional schema migration)
//   - tsfg.compiler-service (v1 — versioned RPC request/response protocol)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  canonical,
  contractSetId,
  effectHash,
  reflectionDigest,
  sealEnvelope,
  sha256,
  verifyEnvelope,
  WINDOWS_X64_TARGET,
} from './r04-identity.mjs';

const VALID_ROOT_KINDS = new Set(['derived_span', 'live_ref', 'nullable_ref', 'union_active_ref']);
const VALID_TIER_ADAPTERS = new Set(['direct_c_abi', 'vm_trampoline']);
const VALID_ARTIFACT_FORMATS = new Set(['coff-dll', 'coff-obj']);
const VALID_DIALECTS = new Set(['tsfg_core', 'tsfg_program', 'tsfg_query']);
const VALID_RELOAD_PHASES = new Set(['begin', 'commit', 'rollback', 'stage', 'validate']);
const VALID_MIGRATION_MODES = new Set(['explicit_transform', 'none', 'reset_state']);
const VALID_SERVICE_OPS = new Set(['compile_module_reload', 'compile_patch', 'health', 'inspect_abi']);
const VALID_SERVICE_STATUSES = new Set(['error', 'ok', 'rejected']);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

// ============================================================================
// 1. tsfg.tmeta (v1) + RF-01 Reflection Digest
// ============================================================================
export function emitTmetaArtifact(spec) {
  const target = spec.target ?? WINDOWS_X64_TARGET;
  const components = [...(spec.components ?? [])].sort();
  const types = [...(spec.types ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const queries = [...(spec.queries ?? [])]
    .map((q) => ({
      conflictsWith: [...(q.conflictsWith ?? [])].sort(),
      name: q.name,
      queryTmetaDigest: q.queryTmetaDigest,
      reads: [...(q.reads ?? [])].sort(),
      writes: [...(q.writes ?? [])].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const functions = [...(spec.functions ?? [])]
    .map((f) => ({
      captureLayoutHash: f.captureLayoutHash,
      effectHash: f.effectHash ?? effectHash(f.effects ?? {}),
      functionId: f.functionId,
      name: f.name,
      signatureHash: f.signatureHash,
      staticSchemaHash: f.staticSchemaHash,
    }))
    .sort((a, b) => a.functionId.localeCompare(b.functionId));

  const core = {
    abiHash: spec.abiHash,
    components,
    functions,
    queries,
    target,
    types,
  };
  const payload = {
    abiHash: spec.abiHash,
    components,
    contractSetId: spec.contractSetId ?? contractSetId(),
    functions,
    inputIdentity: spec.inputIdentity,
    queries,
    reflectionDigest: reflectionDigest(core),
    target,
    types,
  };
  return sealEnvelope('tsfg.tmeta', 1, payload);
}

export function validateTmetaArtifact(bytes, expected = {}) {
  const { envelope, payload } = verifyEnvelope(bytes, 'tsfg.tmeta', 1, { maxBytes: 8388608, maxDepth: 64 });
  if (!DIGEST_RE.test(payload.abiHash) || !DIGEST_RE.test(payload.inputIdentity) || !DIGEST_RE.test(payload.contractSetId)) {
    throw new TypeError('r04-tmeta-digest: invalid identity digest in .tmeta');
  }
  const recomputed = reflectionDigest({
    abiHash: payload.abiHash,
    components: payload.components,
    functions: payload.functions,
    queries: payload.queries,
    target: payload.target,
    types: payload.types,
  });
  if (payload.reflectionDigest !== recomputed) {
    throw new TypeError(`r04-tmeta-rf01: reflectionDigest mismatch (expected ${recomputed}, got ${payload.reflectionDigest})`);
  }
  if (expected.abiHash && payload.abiHash !== expected.abiHash) {
    throw new TypeError('r04-tmeta-abi-mismatch');
  }
  if (expected.contractSetId && payload.contractSetId !== expected.contractSetId) {
    throw new TypeError('r04-tmeta-contract-set-mismatch');
  }
  return { envelope, payload };
}

/**
 * RF-01 helper: emit `.tmeta` into an isolated output directory and return the written path + reflectionDigest.
 * Guarantees zero output-path contamination in the canonical `.tmeta` bytes or reflectionDigest.
 */
export async function emitTmetaToDirectory(outDir, spec) {
  await mkdir(outDir, { recursive: true });
  const artifact = emitTmetaArtifact(spec);
  const outPath = path.join(outDir, 'module.tmeta');
  await writeFile(outPath, artifact.bytes);
  return { bytes: artifact.bytes, outPath, reflectionDigest: artifact.payload.reflectionDigest };
}

// ============================================================================
// 2. tsfg.core-ir-exchange (v1)
// ============================================================================
export function emitCoreIrExchange(spec) {
  if (!VALID_DIALECTS.has(spec.irDialect)) {
    throw new TypeError(`r04-core-ir-dialect: unsupported dialect ${spec.irDialect}`);
  }
  if (typeof spec.canonicalIr !== 'string' || spec.canonicalIr.length === 0) {
    throw new TypeError('r04-core-ir-empty: canonicalIr must be non-empty MLIR text');
  }
  const payload = {
    abiHash: spec.abiHash,
    canonicalIr: spec.canonicalIr,
    capabilities: [...(spec.capabilities ?? [])].sort(),
    contractSetId: spec.contractSetId ?? contractSetId(),
    inputIdentity: spec.inputIdentity,
    irDialect: spec.irDialect,
    irDigest: sha256(Buffer.from(spec.canonicalIr, 'utf8')),
    publishedFunctions: [...(spec.publishedFunctions ?? [])].sort((a, b) => a.functionId.localeCompare(b.functionId)),
    sourceDigest: spec.sourceDigest,
    target: spec.target ?? WINDOWS_X64_TARGET,
  };
  return sealEnvelope('tsfg.core-ir-exchange', 1, payload);
}

export function validateCoreIrExchange(bytes, expected = {}) {
  const { envelope, payload } = verifyEnvelope(bytes, 'tsfg.core-ir-exchange', 1, { maxBytes: 8388608, maxDepth: 32 });
  if (!VALID_DIALECTS.has(payload.irDialect)) {
    throw new TypeError(`r04-core-ir-dialect: invalid dialect ${payload.irDialect}`);
  }
  const actualIrDigest = sha256(Buffer.from(payload.canonicalIr, 'utf8'));
  if (payload.irDigest !== actualIrDigest) {
    throw new TypeError(`r04-core-ir-corrupted: irDigest mismatch (${payload.irDigest} !== ${actualIrDigest})`);
  }
  if (expected.target && payload.target.target !== expected.target) {
    throw new TypeError('r04-core-ir-target-mismatch');
  }
  if (expected.abiHash && payload.abiHash !== expected.abiHash) {
    throw new TypeError('r04-core-ir-abi-mismatch');
  }
  return { envelope, payload };
}

// ============================================================================
// 3. tsfg.native-patch (v1, .tpatch)
// ============================================================================
export function emitNativePatch(spec) {
  if (spec.forbidDataMigration === false) {
    throw new TypeError('r04-patch-migration-forbidden: function-level patches cannot perform data migration');
  }
  if (!Number.isInteger(spec.codeVersion) || spec.codeVersion <= 0) {
    throw new TypeError('r04-patch-version: codeVersion must be a positive integer');
  }
  if (!VALID_ARTIFACT_FORMATS.has(spec.artifact?.format)) {
    throw new TypeError(`r04-patch-artifact-format: invalid format ${spec.artifact?.format}`);
  }
  const functions = (spec.functions ?? []).map((f) => {
    if (!VALID_TIER_ADAPTERS.has(f.tierAdapter)) {
      throw new TypeError(`r04-patch-tier-adapter: invalid adapter ${f.tierAdapter}`);
    }
    const stackMap = (f.stackMap ?? []).map((sp) => {
      const seenSlots = new Set();
      const roots = (sp.roots ?? []).map((r) => {
        if (!VALID_ROOT_KINDS.has(r.kind)) {
          throw new TypeError(`r04-patch-root-kind: invalid root kind ${r.kind}`);
        }
        if (seenSlots.has(r.slotOffset)) {
          throw new TypeError(`r04-patch-duplicate-root-slot: duplicate slot ${r.slotOffset}`);
        }
        seenSlots.add(r.slotOffset);
        return {
          kind: r.kind,
          slotOffset: r.slotOffset,
          tagOffset: r.tagOffset ?? -1,
        };
      }).sort((a, b) => a.slotOffset - b.slotOffset);
      return {
        frameSize: sp.frameSize,
        pcOffset: sp.pcOffset,
        roots,
      };
    }).sort((a, b) => a.pcOffset - b.pcOffset);
    return {
      abiCallConv: f.abiCallConv ?? 'win64_c',
      captureLayoutHash: f.captureLayoutHash,
      effectHash: f.effectHash,
      entrySymbol: f.entrySymbol,
      functionId: f.functionId,
      signatureHash: f.signatureHash,
      stackMap,
      tierAdapter: f.tierAdapter,
    };
  }).sort((a, b) => a.functionId.localeCompare(b.functionId));

  const payload = {
    abiHash: spec.abiHash,
    artifact: {
      byteSize: spec.artifact.byteSize,
      format: spec.artifact.format,
      sha256: spec.artifact.sha256,
    },
    codeVersion: spec.codeVersion,
    epoch: spec.epoch,
    forbidDataMigration: true,
    functions,
    moduleId: spec.moduleId,
    patchId: spec.patchId,
    staticSchemaHash: spec.staticSchemaHash,
    target: spec.target ?? WINDOWS_X64_TARGET,
  };
  return sealEnvelope('tsfg.native-patch', 1, payload);
}

export function validateNativePatch(bytes, liveState = null) {
  const { envelope, payload } = verifyEnvelope(bytes, 'tsfg.native-patch', 1, { maxBytes: 8388608, maxDepth: 32 });
  if (payload.forbidDataMigration !== true) {
    throw new TypeError('r04-patch-migration-forbidden: forbidDataMigration must be true');
  }
  if (!Number.isInteger(payload.codeVersion) || payload.codeVersion <= 0) {
    throw new TypeError('r04-patch-version: non-positive codeVersion');
  }
  if (!VALID_ARTIFACT_FORMATS.has(payload.artifact?.format) || !DIGEST_RE.test(payload.artifact?.sha256)) {
    throw new TypeError('r04-patch-artifact: invalid artifact metadata');
  }
  for (const fn of payload.functions) {
    if (!VALID_TIER_ADAPTERS.has(fn.tierAdapter)) {
      throw new TypeError(`r04-patch-tier-adapter: ${fn.tierAdapter}`);
    }
    for (const sp of fn.stackMap) {
      const seen = new Set();
      for (const r of sp.roots) {
        if (!VALID_ROOT_KINDS.has(r.kind)) throw new TypeError(`r04-patch-root-kind: ${r.kind}`);
        if (r.slotOffset < 0 || r.slotOffset >= sp.frameSize || seen.has(r.slotOffset)) {
          throw new TypeError(`r04-patch-root-slot: invalid or duplicate root slot ${r.slotOffset}`);
        }
        seen.add(r.slotOffset);
      }
    }
  }
  if (liveState) {
    if (payload.codeVersion <= liveState.codeVersion) {
      throw new TypeError(`r04-patch-stale-version: ${payload.codeVersion} <= ${liveState.codeVersion}`);
    }
    if (payload.abiHash !== liveState.abiHash) {
      throw new TypeError('r04-patch-abi-mismatch');
    }
    if (payload.staticSchemaHash !== liveState.staticSchemaHash) {
      throw new TypeError('r04-patch-static-schema-mismatch: use tsfg.module-reload for schema migration');
    }
    for (const fn of payload.functions) {
      const cell = liveState.cells?.get?.(fn.functionId);
      if (cell) {
        if (fn.signatureHash !== cell.signatureHash) throw new TypeError(`r04-patch-signature-mismatch: ${fn.functionId}`);
        if (fn.effectHash !== cell.effectHash) throw new TypeError(`r04-patch-effect-mismatch: ${fn.functionId}`);
        if (fn.captureLayoutHash !== cell.captureLayoutHash) throw new TypeError(`r04-patch-capture-mismatch: ${fn.functionId}`);
      }
    }
  }
  return { envelope, payload };
}

// ============================================================================
// 4. tsfg.module-reload (v1)
// ============================================================================
export function emitModuleReload(spec) {
  if (!VALID_RELOAD_PHASES.has(spec.phase)) {
    throw new TypeError(`r04-reload-phase: invalid phase ${spec.phase}`);
  }
  if (!VALID_MIGRATION_MODES.has(spec.migrationMode)) {
    throw new TypeError(`r04-reload-migration: invalid migrationMode ${spec.migrationMode}`);
  }
  if (spec.toEpoch !== spec.fromEpoch + 1) {
    throw new TypeError(`r04-reload-epoch: toEpoch (${spec.toEpoch}) must equal fromEpoch + 1`);
  }
  const schemaChanged = spec.previousSchemaHash !== spec.nextSchemaHash;
  if (schemaChanged && spec.migrationMode === 'none') {
    throw new TypeError('r04-reload-schema-change: schema changed without explicit migrationMode');
  }
  if (spec.migrationMode === 'explicit_transform' && !DIGEST_RE.test(spec.migrationHookFunctionId ?? '')) {
    throw new TypeError('r04-reload-missing-hook: explicit_transform requires valid migrationHookFunctionId');
  }
  const payload = {
    abiHash: spec.abiHash,
    affectedGlobals: [...(spec.affectedGlobals ?? [])].sort(),
    fromEpoch: spec.fromEpoch,
    migrationHookFunctionId: spec.migrationHookFunctionId ?? '',
    migrationMode: spec.migrationMode,
    moduleId: spec.moduleId,
    nextSchemaHash: spec.nextSchemaHash,
    patchDigest: spec.patchDigest,
    phase: spec.phase,
    previousSchemaHash: spec.previousSchemaHash,
    rollbackPolicy: 'restore_previous_snapshot',
    toEpoch: spec.toEpoch,
    transactionId: spec.transactionId,
  };
  return sealEnvelope('tsfg.module-reload', 1, payload);
}

export function validateModuleReload(bytes, expected = {}) {
  const { envelope, payload } = verifyEnvelope(bytes, 'tsfg.module-reload', 1, { maxBytes: 4194304, maxDepth: 32 });
  if (!VALID_RELOAD_PHASES.has(payload.phase)) throw new TypeError(`r04-reload-phase: ${payload.phase}`);
  if (!VALID_MIGRATION_MODES.has(payload.migrationMode)) throw new TypeError(`r04-reload-migration: ${payload.migrationMode}`);
  if (payload.toEpoch !== payload.fromEpoch + 1) throw new TypeError('r04-reload-epoch');
  if (payload.previousSchemaHash !== payload.nextSchemaHash && payload.migrationMode === 'none') {
    throw new TypeError('r04-reload-schema-change');
  }
  if (payload.migrationMode === 'explicit_transform' && !DIGEST_RE.test(payload.migrationHookFunctionId)) {
    throw new TypeError('r04-reload-missing-hook');
  }
  if (payload.rollbackPolicy !== 'restore_previous_snapshot') {
    throw new TypeError('r04-reload-rollback-policy');
  }
  if (expected.abiHash && payload.abiHash !== expected.abiHash) throw new TypeError('r04-reload-abi-mismatch');
  return { envelope, payload };
}

// ============================================================================
// 5. tsfg.compiler-service (v1)
// ============================================================================
export function emitCompilerServiceMessage(spec) {
  if (!VALID_SERVICE_OPS.has(spec.operation)) {
    throw new TypeError(`r04-service-op: unknown operation ${spec.operation}`);
  }
  if (spec.direction === 'request') {
    const payload = {
      contractSetId: spec.contractSetId ?? contractSetId(),
      direction: 'request',
      epoch: spec.epoch,
      inputDigest: spec.inputDigest,
      operation: spec.operation,
      options: spec.options ?? {},
      requestId: spec.requestId,
      target: spec.target ?? WINDOWS_X64_TARGET,
    };
    return sealEnvelope('tsfg.compiler-service', 1, payload);
  }
  if (spec.direction === 'response') {
    if (!VALID_SERVICE_STATUSES.has(spec.status)) {
      throw new TypeError(`r04-service-status: invalid status ${spec.status}`);
    }
    if (spec.status === 'ok' && spec.diagnosticCode) {
      throw new TypeError('r04-service-diag: ok response must have empty diagnosticCode');
    }
    if (spec.status !== 'ok' && !spec.diagnosticCode) {
      throw new TypeError('r04-service-diag: failure response requires non-empty diagnosticCode');
    }
    const payload = {
      artifactDigest: spec.artifactDigest ?? '',
      artifactFamily: spec.artifactFamily ?? '',
      diagnosticCode: spec.diagnosticCode ?? '',
      direction: 'response',
      elapsedMs: spec.elapsedMs ?? 0,
      epoch: spec.epoch,
      operation: spec.operation,
      requestId: spec.requestId,
      status: spec.status,
    };
    return sealEnvelope('tsfg.compiler-service', 1, payload);
  }
  throw new TypeError(`r04-service-direction: invalid direction ${spec.direction}`);
}

export function validateCompilerServiceMessage(bytes, expected = {}) {
  const { envelope, payload } = verifyEnvelope(bytes, 'tsfg.compiler-service', 1, { maxBytes: 8388608, maxDepth: 32 });
  if (!VALID_SERVICE_OPS.has(payload.operation)) throw new TypeError(`r04-service-op: ${payload.operation}`);
  if (expected.minEpoch !== undefined && payload.epoch < expected.minEpoch) {
    throw new TypeError(`r04-service-stale-epoch: ${payload.epoch} < ${expected.minEpoch}`);
  }
  if (payload.direction === 'request') {
    if (!DIGEST_RE.test(payload.contractSetId) || !DIGEST_RE.test(payload.inputDigest)) {
      throw new TypeError('r04-service-request-digest');
    }
    if (expected.contractSetId && payload.contractSetId !== expected.contractSetId) {
      throw new TypeError('r04-service-contract-set-mismatch');
    }
  } else if (payload.direction === 'response') {
    if (!VALID_SERVICE_STATUSES.has(payload.status)) throw new TypeError('r04-service-status');
    if (payload.status === 'ok' && payload.diagnosticCode !== '') throw new TypeError('r04-service-diag');
    if (payload.status !== 'ok' && payload.diagnosticCode === '') throw new TypeError('r04-service-diag');
  } else {
    throw new TypeError(`r04-service-direction: ${payload.direction}`);
  }
  return { envelope, payload };
}
