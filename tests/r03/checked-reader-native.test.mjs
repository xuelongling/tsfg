// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { sha256 } from '../../compiler/identity.mjs';
import { createCounterHostContract } from '../../eng/host-semantic-contract.mjs';
import { stageVmRuntimeSources } from '../../eng/vm-build.mjs';
import { nativeUnit } from './native-unit.mjs';

const source = 'runtime/wire-program-checked-reader-test.zig';
const fixture = 'runtime/test-data/common18-decoder/positive.tbc';

test('owning Common20 reader rejects malformed and old packets', async () => {
  const build = process.env.TSFG_VM_BOOTSTRAP_STAGE;
  assert.match(build, /^E:[\\/]/i, 'TSFG_VM_BOOTSTRAP_STAGE must name the retained initial-false Runtime build stage');
  const identity = JSON.parse(await readFile(path.join(build, 'bootstrap-evidence.json'), 'utf8'));
  assert.equal(identity.buildIdentity.options.sourceTarget, 'tsfg-vm');
  const host = createCounterHostContract(identity);
  assert.equal(await readFile(path.join(build, 'host-semantic-contract.json'), 'utf8'), host.contractText);

  await nativeUnit({
    source, prefix: 'r03-checked-reader-', expectedPasses: 20,
    async stageSource(productRoot, testRoot) {
      await mkdir(path.dirname(path.join(testRoot, fixture)), { recursive: true });
      await stageVmRuntimeSources({ productRoot, product: testRoot, identity, sha256 });
      await copyFile(path.join(productRoot, source), path.join(testRoot, source));
      await copyFile(path.join(productRoot, fixture), path.join(testRoot, fixture));
      await writeFile(path.join(testRoot, 'runtime/host_semantic_identity.zig'), host.identitySource, { flag: 'wx' });
    },
  });
});
