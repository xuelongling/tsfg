// SPDX-License-Identifier: MIT
// R08 Cross-Backend Differential Runner & Domain-Specific Comparators:
//   1. Strict Equivalence Comparator (VM unfused === VM fused === AOT /O0 === AOT /O2 === Independent Oracle)
//   2. Separate Non-Strict Domain Comparators (fast-math ULP tolerance, parallel reduction order, GPU tolerance)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { compileTsfgPatchDll } from '../../compiler/r07-aot-backend.mjs';
import { encodeDialectToR05Bytecode, evalIndependentOracle } from './r08-generator.mjs';

/**
 * Strict Execution Equivalence Comparator (for ordinary CPU/VM/AOT semantics).
 * NEVER accepts "two backends agree" — every backend MUST match the independent Semantic Oracle!
 */
export function compareStrictOutcomes(oracle, backends) {
  const mismatches = [];
  for (const [name, actual] of Object.entries(backends)) {
    if (actual.trap !== oracle.trap) {
      mismatches.push(`${name}: trap mismatch (oracle=${oracle.trap}, actual=${actual.trap})`);
      continue;
    }
    if (oracle.trap === 0) {
      if (oracle.kind === 'i32' && actual.value !== oracle.value) {
        mismatches.push(`${name}: i32 value mismatch (oracle=${oracle.value}, actual=${actual.value})`);
      } else if (oracle.kind === 'f64' && actual.bits !== oracle.bits) {
        mismatches.push(`${name}: f64 raw bits mismatch (oracle=${oracle.bits}, actual=${actual.bits})`);
      }
    }
  }
  return { mismatches, ok: mismatches.length === 0 };
}

/**
 * Separate Non-Strict Domain Comparator for fast-math, parallel reductions, and GPU kernels.
 * Enforces explicit ULP / absolute tolerance and NaN/Inf contracts without conflating with strict CPU equivalence!
 */
export function compareDomainRelaxedOutcomes(reference, candidate, contract) {
  const domain = contract.domain; // 'fast-math' | 'parallel-reduction' | 'gpu'
  if (!['fast-math', 'parallel-reduction', 'gpu'].includes(domain)) {
    throw new TypeError(`r08-comparator: unknown relaxed domain ${domain}`);
  }
  if (Number.isNaN(reference) || Number.isNaN(candidate)) {
    const ok = contract.allowNanBoth ? (Number.isNaN(reference) && Number.isNaN(candidate)) : false;
    return { absError: NaN, domain, ok, reason: ok ? '' : 'unexpected NaN under domain contract' };
  }
  if (!Number.isFinite(reference) || !Number.isFinite(candidate)) {
    const ok = reference === candidate;
    return { absError: Infinity, domain, ok, reason: ok ? '' : 'Inf mismatch under domain contract' };
  }
  const absError = Math.abs(reference - candidate);
  const relScale = Math.max(1.0, Math.abs(reference));
  const maxErr = (contract.absTolerance ?? 0) + (contract.relTolerance ?? 0) * relScale;
  const ok = absError <= maxErr;
  return {
    absError,
    domain,
    maxAllowedError: maxErr,
    ok,
    reason: ok ? '' : `absError ${absError} exceeded ${domain} bound ${maxErr}`,
  };
}

/**
 * Execute one generated/recorded program across ALL 5 targets:
 *   - Independent Semantic Oracle
 *   - R05 Zig VM (unfused)
 *   - R05 Zig VM (superinstruction-fused)
 *   - R07 Windows x64 Native AOT DLL (`/O0` debug)
 *   - R07 Windows x64 Native AOT DLL (`/O2` release)
 */
export async function runFiveWayDiff(program, arg0, arg1, { r05VmExe, r07LoaderExe, workDir }) {
  const oracle = evalIndependentOracle(program, arg0, arg1);
  const fn = program.functions[0];
  const isF64 = fn.returnType === 'f64';

  const tbcBytes = encodeDialectToR05Bytecode(program);
  const runVm = (unfused) => {
    const vmArgs = ['--run', '0', ...(unfused ? ['--unfused'] : []), '--args', `${arg0},${arg1}`];
    const res = spawnSync(r05VmExe, vmArgs, { input: tbcBytes, windowsHide: true });
    if (res.status !== 0) throw new Error(`R05 VM crashed: ${res.stderr.toString('utf8')}`);
    const j = JSON.parse(res.stdout.toString('utf8'));
    const trap = j.status === 'trap' ? (j.code === 'r01-t-div-zero' ? 3 : 1) : 0;
    return { status: j.status, trap, value: j.i32 };
  };

  const aotO0 = await compileTsfgPatchDll(program, path.join(workDir, `${fn.name}_o0`), {
    codeVersion: 1,
    optLevel: 'O0',
    tag: `${fn.name}_o0`,
  });
  const aotO2 = await compileTsfgPatchDll(program, path.join(workDir, `${fn.name}_o2`), {
    codeVersion: 1,
    optLevel: 'O2',
    tag: `${fn.name}_o2`,
  });

  const runAot = (compiled) => {
    const mode = isF64 ? 'diff-f64' : 'diff-i32';
    const res = spawnSync(r07LoaderExe, [mode, compiled.dllPath, compiled.tpatchPath, fn.name, String(arg0), String(arg1)], {
      windowsHide: true,
    });
    if (res.status !== 0) throw new Error(`R07 AOT loader failed: ${res.stderr.toString('utf8')}`);
    return JSON.parse(res.stdout.toString('utf8'));
  };

  const backends = isF64
    ? {
        aot_o0: runAot(aotO0),
        aot_o2: runAot(aotO2),
      }
    : {
        aot_o0: runAot(aotO0),
        aot_o2: runAot(aotO2),
        vm_fused: runVm(false),
        vm_unfused: runVm(true),
      };

  const verdict = compareStrictOutcomes(oracle, backends);
  return { aotO0Audit: aotO0.audit, aotO2Audit: aotO2.audit, backends, oracle, verdict };
}
