// SPDX-License-Identifier: MIT
// Separate real first-case wrapper keeps causal raw storage independent of later suites.
import test from 'node:test';
import assert from 'node:assert/strict';
import {inputs} from './array-packet-v2-fixtures.mjs';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
test('37i first complete Core12 packet equals independent v2 bytes',async()=>{
 const item=inputs[0],result=await invokeCore(item.core,'--emit-array-candidate');
 accepted(result);assert.deepEqual(result.stdout,item.expected);
});
