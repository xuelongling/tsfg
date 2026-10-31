// SPDX-License-Identifier: MIT
// Pure metadata cases; existing nonempty solver coverage is registered separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNeverNormalBase,checkNeverNormalDerived,checkNeverDefinedField,checkBottomUnknownAndMissing,checkBottomCopyProjection} from './fixtures/construction-storage-bottom-fixtures.mjs';
import {checkConstructionStorageProjectionPureData} from './fixtures/common-construction-storage-projection-fixtures.mjs';
let remaining=2000000;
const charge=units=>{assert.ok(Number.isSafeInteger(units)&&units>=0,'Charge requires explicit nonnegative integer units');assert.ok(units<=remaining,'shared finite Bottom test budget exceeded');remaining-=units;};
test('proved never-normal Base retains allocation/escape prefix without Derived bind',()=>assert.deepEqual(checkNeverNormalBase(charge),{status:'passed'}));
test('proved never-normal Derived retains own initialization without descendant bind',()=>assert.deepEqual(checkNeverNormalDerived(charge),{status:'passed'}));
test('no-defined-payload field retains presence slot and rejects all definitions',()=>assert.deepEqual(checkNeverDefinedField(charge),{status:'passed'}));
test('unknown missing incomplete uppers stay OPEN',()=>assert.deepEqual(checkBottomUnknownAndMissing(charge),{status:'passed'}));
test('proved Bottom value slot retains internal copy representative',()=>assert.deepEqual(checkBottomCopyProjection(charge),{status:'passed'}));
test('existing actual-value full copy projection',()=>assert.deepEqual(checkConstructionStorageProjectionPureData(charge),{status:'passed'}));
