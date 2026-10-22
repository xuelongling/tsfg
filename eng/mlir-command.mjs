// SPDX-License-Identifier: MIT
import { MlirBuildError } from './mlir-build-inputs.mjs';

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
