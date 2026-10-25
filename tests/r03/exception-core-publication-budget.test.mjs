// SPDX-License-Identifier: MIT
// Independent finite factory boundaries from the current ordinary development descriptor; not large-Source/public-lowering/native credit.
import assert from 'node:assert/strict';
import test from 'node:test';
import { publicationBudget } from '../../compiler/exception-core-common.mjs';
import { createCoreSsaGraph } from '../../compiler/core-ssa-graph.mjs';

// Expectations come from the frozen contract, never from producer limits or descriptor exports.
const coreBytes=8_388_608;
const quoteInput="\"\\\r\n\t\u0000😀";
const quoteExpected="\"\\22\\5C\\0D\\0A\\09\\00\\F0\\9F\\98\\80\"";
const attributeExpected="{version = 1 : i32, name = \"\\F0\\9F\\98\\80\", range = {start = 0 : i64, end = 170 : i64}, flags = [true, false]}";
/** @param {any} error */
function finiteLimit(error) {
  assert.equal(error instanceof TypeError,true);assert.equal(error.code,'r03-formal-exception-core-limit');
  assert.equal(error.ruleId,'r01-input-boundary');assert.equal(error.phase,'lowering');
  assert.match(error.message,/^r03-formal-exception-core-limit: /);assert.ok(error.message.length<=256);
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
  await t.test('headerFragmentsReserveUtf8AndSeparatorsBeforeJoining',()=>{
    const p=publicationBudget();p.reserve(coreBytes-8);assert.equal(p.combine(['é','😀'],', '),'é, 😀');limit(()=>p.reserve(1));
    const short=publicationBudget();short.reserve(coreBytes-7);limit(()=>short.combine(['é','😀'],', '));
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
  await t.test('structuralWorkAllowsOneMillionAndRejectsNextStep',()=>{
    const p=publicationBudget();for(let i=0;i<1_000_000;i++)p.step();limit(()=>p.step());
  });
  await t.test('blocksAllow16384AndReject16385',()=>{
    const p=publicationBudget();assert.equal(p.budget.block(16384),undefined);limit(()=>p.budget.block(16385));
  });
  await t.test('valuesAllow65536AndReject65537',()=>{
    const p=publicationBudget();assert.equal(p.budget.register(65536),undefined);limit(()=>p.budget.register(65537));
  });
  await t.test('instructionsAllow65536AndReject65537',()=>{
    const p=publicationBudget();for(let i=0;i<65_536;i++)p.budget.line('');limit(()=>p.budget.line(''));
  });
  await t.test('edgesAllow32768AndReject32769',()=>{
    const p=publicationBudget();assert.equal(p.budget.edge(32768),undefined);limit(()=>p.budget.edge(32769));
  });
  await t.test('realSsaConditionalAndSuccessorTerminatorsShareEdgeAccounting',()=>{
    const p=publicationBudget(),graph=createCoreSsaGraph(type=>type,p.budget);
    const from=graph.newBlock(),left=graph.newBlock(),right=graph.newBlock();
    graph.successors(32766);graph.conditional(from,'%condition',left,right,{start:0,end:1});
    limit(()=>graph.branch(left,right,[],{start:0,end:1}));
    assert.equal(left.lines.length,0,'edge failure precedes publishing a branch');
  });
  await t.test('internalLogicalArgumentsAllow4096AndReject4097',()=>{
    const p=publicationBudget();assert.equal(p.budget.parameters(4096),undefined);limit(()=>p.budget.parameters(4097));
  });
  await t.test('factoryReservationsAreIndependent',()=>{
    const first=publicationBudget();first.reserve(coreBytes);limit(()=>first.append('x'));
    const next=publicationBudget();assert.equal(next.append('x'),'x');next.reserve(coreBytes-1);limit(()=>next.reserve(1));
  });
  t.diagnostic('Factory numeric reservations/small strings only; sourceBindings257/full-public allocation paths and native thresholds remain unqualified');
});
