// SPDX-License-Identifier: MIT
// The actual supervisor argv seam; never invoke the supervisor or inspect env.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {windowsOfflineArguments} from '../../eng/build-offline-boundary.mjs';

test('Windows transport forwards each original command to the one real CLI entry',()=>{
 const node='E:\\owned-tools\\node.exe',programs=[node,'E:\\owned-tools\\compiler.exe'];
 const entry=fileURLToPath(new URL('../../eng/tsfg-build.mjs',import.meta.url));
 for(const command of ['build','test','package','verify-workspace','repro-check']) {
  const input=[command,'--out','E:\\owned-output\\artifact','--report','E:\\owned-output\\report.json'];
  const original=[...input],selected=[...programs];
  const actual=windowsOfflineArguments(input,node,programs);
  assert.deepEqual(actual,['--network-only','--deny-network',node,'--deny-network',programs[1],
   '--',node,entry,...input],command);
  assert.deepEqual(input,original);assert.deepEqual(programs,selected);
 }
});
