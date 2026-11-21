// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { sha256 } from '../../compiler/identity.mjs';
import { createCounterHostContract } from '../../eng/host-semantic-contract.mjs';
import { stageVmRuntimeSources } from '../../eng/vm-build.mjs';
import { nativeUnit } from './native-unit.mjs';

const negativeSource = 'runtime/wire-program-checked-reader-test.zig';
const positiveSource = 'runtime/wire-program-checked-positive-test.zig';
const common18 = 'runtime/test-data/common18-decoder/positive.tbc';
const common20 = 'runtime/test-data/common20/right.tbc';
const rightPacketPath = process.env.TSFG_COMMON20_RIGHT_PACKET;

async function stageReader(productRoot, testRoot, source) {
  const build = process.env.TSFG_VM_BOOTSTRAP_STAGE;
  assert.match(build, /^E:[\\/]/i, 'TSFG_VM_BOOTSTRAP_STAGE must name the retained initial-false Runtime build stage');
  const identity = JSON.parse(await readFile(path.join(build, 'bootstrap-evidence.json'), 'utf8'));
  assert.equal(identity.buildIdentity.options.sourceTarget, 'tsfg-vm');
  const host = createCounterHostContract(identity);
  assert.equal(await readFile(path.join(build, 'host-semantic-contract.json'), 'utf8'), host.contractText);
  await mkdir(path.join(testRoot, 'runtime'), { recursive: true });
  await stageVmRuntimeSources({ productRoot, product: testRoot, identity, sha256 });
  await copyFile(path.join(productRoot, source), path.join(testRoot, source));
  await writeFile(path.join(testRoot, 'runtime/host_semantic_identity.zig'), host.identitySource, { flag: 'wx' });
}

test('owning Common20 reader rejects malformed and old packets', async () => {
  await nativeUnit({
    source: negativeSource, prefix: 'r03-checked-reader-', expectedPasses: 24,
    async stageSource(productRoot, testRoot) {
      await stageReader(productRoot, testRoot, negativeSource);
      await mkdir(path.dirname(path.join(testRoot, common18)), { recursive: true });
      await copyFile(path.join(productRoot, common18), path.join(testRoot, common18));
    },
  });
});

test('owning Common20 reader checks the retained right packet', {
  skip: rightPacketPath === undefined && 'TSFG_COMMON20_RIGHT_PACKET is not set',
}, async () => {
  assert.match(rightPacketPath, /^E:[\\/]/i, 'TSFG_COMMON20_RIGHT_PACKET must identify the retained Common20 packet');
  const packet = await readFile(rightPacketPath);
  assert.equal(packet.length, 30046);
  assert.equal(sha256(packet), 'sha256:b16b5cba1c72a906b14ac1854e304b2f32a34d68a4810b45c1e386a2b38ba807');
  await nativeUnit({
    source: positiveSource, prefix: 'r03-checked-reader-right-', expectedPasses: 20,
    async stageSource(productRoot, testRoot) {
      await stageReader(productRoot, testRoot, positiveSource);
      await mkdir(path.dirname(path.join(testRoot, common20)), { recursive: true });
      await writeFile(path.join(testRoot, common20), packet, { flag: 'wx' });
    },
  });
});
