// SPDX-License-Identifier: MIT
import { MlirBuildError } from './mlir-build-inputs.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// These are command responsibilities over one complete Core language. Neither
// changes the dialect, verifier, wire identity, SDKv2 inventory or Native ABI.
const roles = Object.freeze({
  native: Object.freeze({ role: 'native', target: 'tsfg-core-ir', executable: 'tsfg-core-ir.exe',
    symbols: 'tsfg-core-ir.pdb', native: true }),
  static: Object.freeze({ role: 'static', target: 'tsfg-core-static', executable: 'tsfg-core-static.exe',
    symbols: 'tsfg-core-static.pdb', native: false })
});

/** Select a production target before any SDK body or source process is read. */
export function selectMlirCommandRole(options) {
  const role = options.get('--core-command-role') ?? 'native';
  if (!Object.hasOwn(roles, role))
    throw new MlirBuildError('Core command role must be static or native', 'mlir-command-role');
  return roles[role];
}

/** Operational stop point, independent of the unchanged payload build profile. */
export function selectMlirBuildPhase(options, command, sdkRequested = false) {
  const phase = options.get('--mlir-build-phase') ?? 'build';
  if (!['plan', 'build'].includes(phase))
    throw new MlirBuildError('Core build phase must be plan or build', 'mlir-command-role');
  if (options.has('--mlir-build-phase') && options.has('--source-target') && options.get('--source-target') !== 'mlir-core')
    throw new MlirBuildError('Core build phase requires the mlir-core source target', 'mlir-command-role');
  if (phase === 'plan' && (command.role !== 'static' || sdkRequested))
    throw new MlirBuildError('Core planning requires the static direct-source command', 'mlir-command-role');
  return phase;
}

/** Complete the existing factory's plan, before any Core target build. This
 * writes evidence only; its result cannot be admitted as a compiler artifact.
 */
export async function finishMlirPlanning({ phase, command, stage, trace, source, legal, python,
  productIdentity, workspaceState, serialize, verifyInputs }) {
  if (phase === 'build') return null;
  if (phase !== 'plan' || command.role !== 'static')
    throw new MlirBuildError('Core planning requires the static direct-source command', 'mlir-command-role');
  await verifyInputs();
  const tracePath = path.join(stage, 'planned-input-trace.json');
  await writeFile(tracePath, serialize(trace), { flag: 'wx' });
  return { schemaVersion: '1', status: 'planned', sourceBuild: 'not-run', intakeComplete: false,
    executionMode: 'local-development', isolation: 'not-enforced', publishable: false,
    coreCommandRole: command.role, dirty: workspaceState.dirty, source, legal, python, stage, trace: tracePath,
    planning: { target: command.target, productBuildIdentity: productIdentity.buildIdentity,
      targetBuild: 'not-started', finalDependencyClosure: 'not-qualified' } };
}

/** The original SDK intake authenticates the historical full compiler and every
 * inventory body. A static target alone cannot remove those actual dependencies.
 * Keep that intake and SDKv2 membership intact. Static SDK building requires an
 * independently authenticated consumption closure; absence is a local HOLD, not
 * permission to silently trim the lock, skip provenance or relabel a full SDK.
 */
export function requireMlirSdkCommandIntake(command, sdkRequested) {
  if (sdkRequested && command.role === 'static')
    throw new MlirBuildError(
      'Static Core SDK intake is not qualified: the current authenticated intake reads the historical full compiler and complete SDK inventory; a scoped authenticated dependency closure is required',
      'mlir-static-sdk-consumption');
}
