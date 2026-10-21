// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyModulePackages} from './m18-module-aot-capture.mjs';
test('complete owned module packages preserve canonical wire and compile ordinary AOT',async()=>{
  assert.ok(process.env.TSFG_M18_MODULE_INPUTS,'fixed complete owned input required');
  await verifyModulePackages(process.env.TSFG_M18_MODULE_INPUTS,
    '8f6267f1a8f8f58c38c42486fdf50eecde975322d943032f0c6a8f46962a4000',
    process.env.TSFG_TEST_STORAGE+'/module-programs.json');
});
