// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { sha256 } from './identity.mjs';
import sourceLock from '../eng/frontend-source.lock.json' with { type: 'json' };
import registry from '../contracts/registry.json' with { type: 'json' };

// The real locked Source execution boundary. No caller-supplied lock, runner,
// admission bypass or arbitrary argv is supported. This preserves the adopted
// Snapshot command exactly; package command dispatch remains an explicit future
// dependency until its same-version entry and Source build are adopted.
/** @param {string} input @param {{executable?: string}} [options] */
export async function runLockedFrontend(input, { executable } = {}) {
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
  const child = spawnSync(executable, [], { input, encoding: 'utf8', windowsHide: true,
    timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  if (child.error || child.status !== 0)
    return { status: 'tool-error', message: child.error?.message ?? child.stderr };
  return { status: 'ok', frontendSource, stdout: child.stdout };
}
