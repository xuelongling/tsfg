// SPDX-License-Identifier: MIT
// The caller qualifies the metadata-only CMake target and its current inputs.
// Executable path/hash pin the supplied bytes; they do not establish provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('qualified C++ method metadata verifies selected signatures and exact proof origins', async () => {
  const executable = process.env.TSFG_METHOD_MINIMUM_METADATA_EXE;
  const expectedHash = process.env.TSFG_METHOD_MINIMUM_METADATA_SHA256;
  const temp = process.env.TSFG_MLIR_TEST_TEMP_ROOT;
  assert.match(executable, /^E:[\\/]/i, 'qualified tsfg-method-minarity-metadata target required');
  assert.match(expectedHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(temp, /^E:[\\/]/i);
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(executable)) digest.update(bytes);
  assert.equal('sha256:' + digest.digest('hex'), expectedHash);
  const root = await mkdtemp(path.join(temp, 'r03-method-minimum-metadata-'));
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const args = [];
  await writeFile(path.join(root, 'command.json'), JSON.stringify({ executable, sha256: expectedHash, args, cwd }));
  const result = spawnSync(executable, args, { cwd, windowsHide: true, timeout: 300000, maxBuffer: 1024 * 1024 });
  await Promise.all([
    writeFile(path.join(root, 'stdout.log'), result.stdout ?? Buffer.alloc(0)),
    writeFile(path.join(root, 'stderr.log'), result.stderr ?? Buffer.alloc(0)),
    writeFile(path.join(root, 'exit.json'), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message })),
  ]);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.equal(result.stderr.length, 0);
  const cases = ['direct00', 'direct11', 'direct01', 'direct10', 'derived0', 'derived1', 'derivedTotal', 'derivedResult', 'derivedParameter', 'derivedVoidDiscard', 'derivedRefSameOrigin', 'derivedRefMissing', 'derivedRefForeignOrigin', 'derivedRefDuplicateMissing', 'derivedRefDuplicateComplete', 'directNominal0', 'directNominal1', 'directNominalTotal', 'directNominalBoundProjection', 'directNominalUnboundReference'];
  const lines = result.stdout.toString('utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, cases.length);
  cases.forEach((name, index) => assert.ok(lines[index].startsWith(name + ': PASS stage='), lines[index]));
});
