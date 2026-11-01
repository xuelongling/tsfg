// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Run one named pure suite. The invoking harness must supply the verified
 * locked TSFG_ZIG_EXE; the path assertion does not establish tool identity.
 * @param {{source: string, prefix: string, expectedPasses: number}} options
 */
export async function nativeUnit({ source, prefix, expectedPasses }) {
  const executable = process.env.TSFG_ZIG_EXE;
  const temp = process.env.TSFG_MLIR_TEST_TEMP_ROOT;
  assert.match(executable, /^E:[\\/]/i, 'TSFG_ZIG_EXE must identify the verified locked Zig tool');
  assert.match(temp, /^E:[\\/]/i);
  const root = await mkdtemp(path.join(temp, prefix));
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const args = ['test', source, `-femit-bin=${path.join(root, 'test.exe')}`,
    '--zig-lib-dir', path.join(path.dirname(executable), 'lib'),
    '--cache-dir', path.join(root, 'zig-local'), '--global-cache-dir', path.join(root, 'zig-global'),
    '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-ODebug'];
  await writeFile(path.join(root, 'command.json'), JSON.stringify({ executable, args, cwd }));
  const result = spawnSync(executable, args, { cwd, windowsHide: true, timeout: 300000, maxBuffer: 1024 * 1024 });
  await writeFile(path.join(root, 'stdout.log'), result.stdout ?? Buffer.alloc(0));
  await writeFile(path.join(root, 'stderr.log'), result.stderr ?? Buffer.alloc(0));
  await writeFile(path.join(root, 'exit.json'), JSON.stringify({ status: result.status, signal: result.signal,
    error: result.error?.message }));
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.match(result.stderr.toString(), new RegExp(`All ${expectedPasses} tests passed\\.`));
}
