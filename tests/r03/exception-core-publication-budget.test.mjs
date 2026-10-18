// SPDX-License-Identifier: MIT
// Independent finite factory boundaries from descriptor62e69eda; not large-Source/public-lowering/native credit.
import assert from 'node:assert/strict';
import test from 'node:test';
import { publicationBudget } from '../../compiler/exception-core-common.mjs';

// Expectations come from the frozen contract, never from producer limits or descriptor exports.
const coreBytes=8_388_608;
const quoteInput="\"\\\r\n\t\u0000😀";
const quoteExpected="\"\\22\\5C\\0D\\0A\\09\\00\\F0\\9F\\98\\80\"";
const attributeExpected="{version = 1 : i32, name = \"\\F0\\9F\\98\\80\", range = {start = 0 : i64, end = 170 : i64}, flags = [true, false]}";
/** @param {any} error */
function finiteLimit(error) {
  assert.equal(error instanceof TypeError,true);assert.equal(error.code,'r03-exception-core-limit');
  assert.equal(error.ruleId,'r01-input-boundary');assert.equal(error.phase,'lowering');
  assert.match(error.message,/^r03-exception-core-limit: /);assert.ok(error.message.length<=256);
  return true;
}
/** @param {() => unknown} action */
function limit(action) {
  let returned=false;
  assert.throws(()=>{action();returned=true;},finiteLimit);
  assert.equal(returned,false,'exhausted reservation produces no partial return');
}

test('exception Core publication budget enforces frozen finite limits',async t=>{
  await t.test('numericReservationExactlyEightMiBAndOneByteOver',()=>{
    const p=publicationBudget();p.reserve(coreBytes);p.reserve(0);limit(()=>p.reserve(1));
  });
  await t.test('invalidAndUnsafeReservationsHaveFiniteTypedErrors',()=>{
    for(const count of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])limit(()=>publicationBudget().reserve(count));
  });
  await t.test('appendAccountsForUtf8BytesBeforeReturningSmallText',()=>{
    const p=publicationBudget();p.reserve(coreBytes-6);assert.equal(p.append('é😀'),'é😀');limit(()=>p.reserve(1));
    const short=publicationBudget();short.reserve(coreBytes-5);limit(()=>short.append('é😀'));
  });
  await t.test('labelReservesItsBytesBeforePublication',()=>{
    const p=publicationBudget();p.reserve(coreBytes-5);assert.equal(p.budget.label('^bb1:'),undefined);limit(()=>p.reserve(1));
    const short=publicationBudget();short.reserve(coreBytes-4);limit(()=>short.budget.label('^bb1:'));
  });
  await t.test('instructionLineReservesTheFinalLfToo',()=>{
    const p=publicationBudget();p.reserve(coreBytes-3);assert.equal(p.budget.line('op'),undefined);limit(()=>p.reserve(1));
    const short=publicationBudget();short.reserve(coreBytes-2);limit(()=>short.budget.line('op'));
  });
  await t.test('smallQuoteExactlyReservesThirtyTwoEscapedBytes',()=>{
    assert.equal(Buffer.byteLength(quoteInput),10);assert.equal(Buffer.byteLength(quoteExpected),32);
    const p=publicationBudget();p.reserve(coreBytes-32);assert.equal(p.quote(quoteInput),quoteExpected);limit(()=>p.reserve(1));
  });
  await t.test('smallQuoteRejectsThirtyOneRemainingBytesWithoutReturningText',()=>{
    const p=publicationBudget();p.reserve(coreBytes-31);limit(()=>p.quote(quoteInput));
  });
  await t.test('completeSmallAttributeReservesItsEscapedStructuralBytes',()=>{
    const value={version:1,name:'😀',range:{start:0,end:170},flags:[true,false]};
    assert.equal(Buffer.byteLength(attributeExpected),109);
    const p=publicationBudget();p.reserve(coreBytes-109);assert.equal(p.attribute(value),attributeExpected);limit(()=>p.reserve(1));
    const short=publicationBudget();short.reserve(coreBytes-108);limit(()=>short.attribute(value));
  });
  await t.test('structuralWorkAllowsOneHundredThousandAndRejectsNextStep',()=>{
    const p=publicationBudget();for(let i=0;i<100_000;i++)p.step();limit(()=>p.step());
  });
  await t.test('blocksAllow256AndReject257',()=>{
    const p=publicationBudget();assert.equal(p.budget.block(256),undefined);limit(()=>p.budget.block(257));
  });
  await t.test('valuesAllow4096AndReject4097',()=>{
    const p=publicationBudget();assert.equal(p.budget.register(4096),undefined);limit(()=>p.budget.register(4097));
  });
  await t.test('instructionsAllow2048AndReject2049',()=>{
    const p=publicationBudget();for(let i=0;i<2_048;i++)p.budget.line('');limit(()=>p.budget.line(''));
  });
  await t.test('edgesAllow256AndReject257',()=>{
    const p=publicationBudget();assert.equal(p.budget.edge(256),undefined);limit(()=>p.budget.edge(257));
  });
  await t.test('parametersAllow64AndReject65',()=>{
    const p=publicationBudget();assert.equal(p.budget.parameters(64),undefined);limit(()=>p.budget.parameters(65));
  });
  await t.test('factoryReservationsAreIndependent',()=>{
    const first=publicationBudget();first.reserve(coreBytes);limit(()=>first.append('x'));
    const next=publicationBudget();assert.equal(next.append('x'),'x');next.reserve(coreBytes-1);limit(()=>next.reserve(1));
  });
  t.diagnostic('Factory numeric reservations/small strings only; sourceBindings257/full-public allocation paths and native thresholds remain unqualified');
});
