// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkConstructionStoragePureData,checkConstructionStorageCompositionPureData} from './fixtures/construction-storage-fixtures.mjs';
let remaining=2000000;
const charge=units=>{assert.ok(Number.isSafeInteger(units)&&units>=0,'Charge must receive explicit nonnegative integer units');assert.ok(units<=remaining,'shared finite data-test work budget exceeded');remaining-=units;};
test('fixed construction storage and independent event oracle',()=>assert.deepEqual(checkConstructionStoragePureData(charge),{status:'passed'}));
test('selected M12 witness composition and optional presence',()=>assert.deepEqual(checkConstructionStorageCompositionPureData(charge),{status:'passed'}));
