// SPDX-License-Identifier: MIT
// R09 Production Incremental Compiler Service (`tsfg-compiler-service`).
// Speaks versioned R04 `tsfg.compiler-service` envelopes, compiles a SINGLE Core IR /
// `tsfg` dialect source into BOTH verified R05 `TSFGR05B` bytecode (Phase 2) AND real
// Windows x64 LLD `.dll` + `.tpatch` (Phase 1 / Phase 3), maintains an incremental IR
// digest cache, enforces Published Call Contract / signature / capture / static-schema
// compatibility before publishing, and handles simulated link/service crashes cleanly.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonical, sha256, WINDOWS_X64_TARGET } from '../../compiler/r04-identity.mjs';
import {
  emitCompilerServiceMessage,
  emitModuleReload,
  validateCompilerServiceMessage,
} from '../../compiler/r04-protocols.mjs';
import { compileTsfgPatchDll } from '../../compiler/r07-aot-backend.mjs';
import { encodeDialectToR05Bytecode } from '../diff-platform/r08-generator.mjs';

export class R09CompilerService {
  constructor(opts = {}) {
    this.workRoot = opts.workRoot ?? 'E:\\tsfg-temp\\r09-service';
    this.abiHash = opts.abiHash ?? sha256(Buffer.from('r09-service-abi-v1'));
    this.publishedContracts = new Map(); // functionId -> { signatureHash, effectHash, captureLayoutHash, staticSchemaHash, codeVersion }
    this.irCache = new Map(); // irDigest -> compiled artifact entry
    this.crashed = false;
    this.requestCount = 0;
    this.cacheHits = 0;
  }

  /** Register a baseline Published Call Contract for a hot-reloadable function. */
  registerContract(functionId, contract) {
    this.publishedContracts.set(functionId, {
      signatureHash: contract.signatureHash,
      effectHash: contract.effectHash,
      captureLayoutHash: contract.captureLayoutHash,
      staticSchemaHash: contract.staticSchemaHash,
      codeVersion: contract.codeVersion ?? 0,
    });
  }

  /** Simulate a compiler-service crash (runtime retains previous working version!). */
  simulateCrash(flag = true) {
    this.crashed = flag;
  }

  /** Process an R04 `tsfg.compiler-service` request envelope and return a sealed response envelope. */
  async handleRequest(reqBytes, extra = {}) {
    this.requestCount += 1;
    const { payload: req } = validateCompilerServiceMessage(reqBytes);
    if (req.direction !== 'request') {
      throw new TypeError('r09-service: expected direction=request');
    }

    if (this.crashed) {
      return {
        envelope: emitCompilerServiceMessage({
          direction: 'response',
          operation: req.operation,
          requestId: req.requestId,
          epoch: req.epoch,
          status: 'error',
          diagnosticCode: 'r09-service-crashed',
        }),
        artifacts: null,
      };
    }

    if (req.operation === 'health') {
      return {
        envelope: emitCompilerServiceMessage({
          direction: 'response',
          operation: 'health',
          requestId: req.requestId,
          epoch: req.epoch,
          status: 'ok',
          artifactDigest: sha256(Buffer.from(`healthy:${this.requestCount}:${this.cacheHits}`)),
        }),
        artifacts: { cacheHits: this.cacheHits, requestCount: this.requestCount },
      };
    }

    if (req.operation === 'inspect_abi') {
      return {
        envelope: emitCompilerServiceMessage({
          direction: 'response',
          operation: 'inspect_abi',
          requestId: req.requestId,
          epoch: req.epoch,
          status: 'ok',
          artifactDigest: this.abiHash,
        }),
        artifacts: { target: WINDOWS_X64_TARGET, abiHash: this.abiHash },
      };
    }

    if (req.operation === 'compile_patch') {
      return this.#compilePatch(req, extra);
    }

    if (req.operation === 'compile_module_reload') {
      return this.#compileModuleReload(req, extra);
    }

    throw new TypeError(`r09-service: unsupported operation ${req.operation}`);
  }

  async #compilePatch(req, extra) {
    const { functionId, contract, program, codeVersion, phase = 'both', patchName = `patch_v${codeVersion}` } = extra;
    const baseline = this.publishedContracts.get(functionId);

    // Enforce Published Call Contract, signature, capture layout, and static schema invariants
    if (baseline) {
      const reject = (code) => ({
        envelope: emitCompilerServiceMessage({
          direction: 'response',
          operation: 'compile_patch',
          requestId: req.requestId,
          epoch: req.epoch,
          status: 'rejected',
          diagnosticCode: code,
        }),
        artifacts: null,
      });

      if (codeVersion <= baseline.codeVersion) {
        return reject('r09-stale-version');
      }
      if (contract.staticSchemaHash !== baseline.staticSchemaHash) {
        return reject('r09-data-migration-forbidden');
      }
      if (contract.signatureHash !== baseline.signatureHash) {
        return reject('r09-signature-mismatch');
      }
      if (contract.effectHash !== baseline.effectHash) {
        return reject('r09-published-effect-mismatch');
      }
      if (contract.captureLayoutHash !== baseline.captureLayoutHash) {
        return reject('r09-capture-layout-mismatch');
      }
    }

    // Incremental cache lookup keyed by canonical program + contract + codeVersion + phase
    const irDigest = sha256(Buffer.from(canonical({ program, contract, codeVersion, phase })));
    if (this.irCache.has(irDigest)) {
      this.cacheHits += 1;
      const cached = this.irCache.get(irDigest);
      return {
        envelope: emitCompilerServiceMessage({
          direction: 'response',
          operation: 'compile_patch',
          requestId: req.requestId,
          epoch: req.epoch,
          status: 'ok',
          artifactDigest: cached.artifactDigest,
        }),
        artifacts: { ...cached, cacheHit: true },
      };
    }

    const outDir = path.join(this.workRoot, patchName);
    await mkdir(outDir, { recursive: true });

    let bytecodePath = null;
    let bytecodeFnHex = null;
    let dllPath = null;
    let tpatchPath = null;
    let artifactDigest = irDigest;

    const mod = {
      dialect: 'tsfg',
      version: 1,
      target: WINDOWS_X64_TARGET,
      moduleId: sha256(Buffer.from(patchName)),
      abiHash: this.abiHash,
      staticSchemaHash: contract.staticSchemaHash,
      functions: [
        {
          functionId: functionId.startsWith('sha256:') ? functionId : sha256(Buffer.from(functionId)),
          name: program.name,
          returnType: program.returnType,
          params: [
            { name: 'a', type: program.returnType },
            { name: 'b', type: program.returnType },
          ],
          ops: program.ops,
          signatureHash: contract.signatureHash,
          effectHash: contract.effectHash,
          captureLayoutHash: contract.captureLayoutHash,
          staticSchemaHash: contract.staticSchemaHash,
        },
      ],
    };

    // Emit verified R05 bytecode (Phase 2) from the SAME Core IR program
    if (phase === 'bytecode' || phase === 'both') {
      const bcOps = program.ops[0]?.op === 'tsfg.fuel' ? program.ops : [{ op: 'tsfg.fuel' }, ...program.ops];
      const bcMod = { ...mod, functions: [{ ...mod.functions[0], ops: bcOps }] };
      const bcBytes = encodeDialectToR05Bytecode(bcMod);
      bytecodePath = path.join(outDir, `${patchName}.tbc`);
      await writeFile(bytecodePath, bcBytes);
      bytecodeFnHex = createHash('sha256').update(mod.functions[0].functionId).digest('hex');
      artifactDigest = sha256(bcBytes);
    }

    // Emit REAL Windows x64 LLD `.dll` + R04 `.tpatch` (Phase 1 / Phase 3) from the SAME Core IR program
    if (phase === 'native' || phase === 'both') {
      const compiled = await compileTsfgPatchDll(mod, outDir, {
        tag: patchName,
        optLevel: 'O2',
        codeVersion,
      });
      dllPath = compiled.dllPath;
      tpatchPath = compiled.tpatchPath;
      artifactDigest = compiled.dllSha;
    }

    if (baseline) {
      baseline.codeVersion = codeVersion;
    } else {
      this.registerContract(functionId, { ...contract, codeVersion });
    }

    const artifacts = {
      bytecodePath,
      bytecodeFnHex,
      dllPath,
      tpatchPath,
      artifactDigest,
      codeVersion,
      cacheHit: false,
    };
    this.irCache.set(irDigest, artifacts);

    return {
      envelope: emitCompilerServiceMessage({
        direction: 'response',
        operation: 'compile_patch',
        requestId: req.requestId,
        epoch: req.epoch,
        status: 'ok',
        artifactDigest,
      }),
      artifacts,
    };
  }

  async #compileModuleReload(req, extra) {
    const { moduleId, fromEpoch, toEpoch, oldSchemaHash, newSchemaHash, migrationHook } = extra;
    const tx = emitModuleReload({
      moduleId,
      phase: 'stage',
      fromEpoch,
      toEpoch,
      oldSchemaHash,
      newSchemaHash,
      migrationMode: 'explicit_transform',
      migrationHook,
      rollbackPolicy: 'restore_previous_epoch',
      affectedFunctions: extra.affectedFunctions ?? [],
    });

    // Update registered contracts to new static schema hash upon committed reload planning
    if (extra.applyToContracts) {
      for (const c of this.publishedContracts.values()) {
        c.staticSchemaHash = newSchemaHash;
      }
    }

    return {
      envelope: emitCompilerServiceMessage({
        direction: 'response',
        operation: 'compile_module_reload',
        requestId: req.requestId,
        epoch: req.epoch,
        status: 'ok',
        artifactDigest: sha256(tx.bytes),
      }),
      artifacts: { reloadEnvelope: tx },
    };
  }
}
