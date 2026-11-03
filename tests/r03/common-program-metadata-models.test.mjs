// SPDX-License-Identifier: MIT
// The invoker supplies the qualified tsfg-common-metadata-models target built
// from the current common catalog/test source with the locked SDK/toolchain.
// Path/SHA equality pins that supplied executable; it is not build provenance.
// This registration calls only these two pure metadata modes, never Core/VM,
// Frontend, Guest, native generation, the historical argc4 or fixture modes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('qualified C++ metadata models preserve completion and full exception potential', async t => {
  const executable = process.env.TSFG_CORE_METADATA_MODELS_EXE;
  const expectedHash = process.env.TSFG_CORE_METADATA_MODELS_SHA256;
  const temp = process.env.TSFG_MLIR_TEST_TEMP_ROOT;
  assert.match(executable, /^E:[\\/]/i, 'invoker must supply the qualified metadata-model target');
  assert.match(expectedHash, /^sha256:[a-f0-9]{64}$/, 'invoker must pin the qualified executable bytes');
  assert.match(temp, /^E:[\\/]/i);
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(executable)) digest.update(bytes);
  assert.equal('sha256:' + digest.digest('hex'), expectedHash, 'supplied executable changed');
  const root = await mkdtemp(path.join(temp, 'r03-core-metadata-'));
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const modes = [
    { argument: '--literal-copy', expected: [
      'PASS normalized literal copy preserves type/input and both receiver-completion controls',
      'PASS production Domain preserves normal/language literal liveness',
      'PASS non-normalized Source-only graph remains exact',
    ] },
    { argument: '--direct-throw-potential', expected: [
      'PASS direct normalized language route forwards complete fixed mayThrow potential',
      'PASS intercepted/changed/ambiguous/cyclic/missing routes remain Pending and shared budget errors stay hard',
      'PASS potential remains independent of narrower data Domain language completion',
    ] },
  ];
  for (const { argument, expected } of modes) await t.test(argument, async () => {
    const args = [argument], name = argument.slice(2);
    await writeFile(path.join(root, name + '-command.json'), JSON.stringify({ executable, sha256: expectedHash, args, cwd }));
    const result = spawnSync(executable, args, { cwd, windowsHide: true, timeout: 300000, maxBuffer: 1024 * 1024 });
    await Promise.all([
      writeFile(path.join(root, name + '-stdout.log'), result.stdout ?? Buffer.alloc(0)),
      writeFile(path.join(root, name + '-stderr.log'), result.stderr ?? Buffer.alloc(0)),
      writeFile(path.join(root, name + '-exit.json'), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message })),
    ]);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr?.toString());
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(result.stderr.toString('utf8').trim().split(/\r?\n/), expected);
  });
});
