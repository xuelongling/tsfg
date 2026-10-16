// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { sha256 } from './identity.mjs';
import sourceLock from '../eng/frontend-source.lock.json' with { type: 'json' };
import registry from '../contracts/registry.json' with { type: 'json' };

// Both transports share the same locked Source identity and execution policy.
// The named candidate mode selects one fixed argv; it does not adopt a new
// Source build, protocol family or executable admission.
/** @typedef {{status: 'tool-error', message: string}} ExecutionFailure */
/** @typedef {{forkOid: string, binarySha256: string}} FrontendSource */
/**
 * @overload
 * @param {string} input
 * @param {{executable?: string, mode?: 'snapshot'}} [options]
 * @returns {Promise<ExecutionFailure | {status: 'ok', frontendSource: FrontendSource, stdout: string}>}
 */
/**
 * @overload
 * @param {Uint8Array} input
 * @param {{executable?: string, mode: 'generic-package-io-candidate-v1'}} options
 * @returns {Promise<ExecutionFailure | {status: 'ok', frontendSource: FrontendSource, stdout: Buffer}>}
 */
/**
 * @overload
 * @param {string | Uint8Array} input
 * @param {{executable?: string, mode?: string}} [options]
 * @returns {Promise<ExecutionFailure | {status: 'ok', frontendSource: FrontendSource, stdout: string | Buffer}>}
 */
/**
 * @param {string | Uint8Array} input
 * @param {{executable?: string, mode?: string}} [options]
 * @returns {Promise<ExecutionFailure | {status: 'ok', frontendSource: FrontendSource, stdout: string | Buffer}>}
 */
export async function runLockedFrontend(input, { executable, mode = 'snapshot' } = {}) {
  if (!['snapshot', 'generic-package-io-candidate-v1'].includes(mode))
    return { status: 'tool-error', message: 'unsupported frontend execution mode' };
  const packageIo = mode === 'generic-package-io-candidate-v1';
  if (packageIo && !(input instanceof Uint8Array))
    return { status: 'tool-error', message: 'package frontend requires raw request bytes' };
  const ownedInput = input instanceof Uint8Array ? Uint8Array.from(input) : input;
  if (typeof executable !== 'string' || !executable)
    return { status: 'tool-error', message: 'frontend executable is required' };
  let binary;
  try { binary = await readFile(executable); }
  catch { return { status: 'tool-error', message: 'frontend executable is unavailable' }; }
  const binarySha256 = sha256(binary);
  if (binarySha256 !== sourceLock.executableSha256)
    return { status: 'tool-error', message: 'frontend executable differs from locked source build' };
  if (sourceLock.contractVersion !== registry['tsfg.frontend-snapshot'].semver)
    return { status: 'tool-error', message: 'frontend source and snapshot contracts differ' };
  const frontendSource = { forkOid: sourceLock.forkOid, binarySha256 };
  /** @type {import('node:child_process').SpawnSyncOptions} */
  const executionOptions = { input: ownedInput, encoding: packageIo ? undefined : 'utf8',
    windowsHide: true, timeout: 300000, maxBuffer: 16 * 1024 * 1024 };
  const child = spawnSync(executable, packageIo ? ['--generic-package-io-v1'] : [], executionOptions);
  if (child.error || child.status !== 0)
    return { status: 'tool-error', message: child.error?.message
      ?? (typeof child.stderr === 'string' ? child.stderr : child.stderr.toString('utf8')) };
  return { status: 'ok', frontendSource, stdout: child.stdout };
}
