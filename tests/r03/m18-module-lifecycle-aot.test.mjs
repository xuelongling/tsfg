// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyModulePackages} from './m18-module-aot-capture.mjs';
test('complete cycle and failure-lifecycle packages preserve canonical wire and compile ordinary AOT',async()=>{
  assert.ok(process.env.TSFG_M18_LIFECYCLE_INPUTS,'fixed complete lifecycle input required');
  await verifyModulePackages(process.env.TSFG_M18_LIFECYCLE_INPUTS,
    '79684b88df9cfc3d8caaeaeafd6993ee0335f0b7bc5142abadb073b77e65e87a',
    process.env.TSFG_TEST_STORAGE+'/module-programs.json');
});
