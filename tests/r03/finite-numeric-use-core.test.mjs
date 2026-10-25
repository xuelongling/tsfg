// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';
const available=Boolean(process.env.TSFG_CORE_IR_EXE);
async function numericCore() {
  const bytes=await readFile(new URL('./testdata/typed-array-holder-parameter/valid-undefined-numeric-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:5215e5bdcac3dedf45450606499f60ea838a9cd3d6ae1b64f5737165cce5cdfc');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},none={read:false,write:false,structural:false};
  const publication=staticPublication(facts,{keep:{parameters:{0:{...none,read:true}},local:none}});
  const built=buildHir(facts,context,publication);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  return lowerFormalHir(built.hir,context,publication);
}
function changeCheck(text,mutate) {
  const lines=text.split('\n'),index=lines.findIndex(line=>line.includes('"tsfg_core.domain.numeric_use"')&&
    line.includes('numeric_operator = "tsfg_core.add"'));
  assert.ok(index>=0,'real binary checked numeric consumption exists');
  const changed=mutate(lines[index]);assert.notEqual(changed,lines[index]);lines[index]=changed;return lines.join('\n');
}

test('Core numeric use verifies real Source transport, trap-only branches and canonical fixed point',{skip:!available},async()=>{
  const first=await invokeCore(await numericCore());accepted(first);
  const second=await invokeCore(first.stdout.toString('utf8'));accepted(second);
  assert.deepEqual(second.stdout,first.stdout,'ordinary generic print/reparse preserves the checked successor');
});

test('Core numeric use rejects forged failure identities, target, group, range and operand mapping',{skip:!available},async t=>{
  const original=await numericCore();
  /** @type {[string,(line:string)=>string][]} */
  const mutations=[
    ['trap identity',line=>line.replace('r01-t-undefined-numeric-use','r01-t-divide-zero')],
    ['rule identity',line=>line.replace('r01-numeric-use','r01-division')],
    ['target identity',line=>line.replace(/target_type = "[^"]+"/,'target_type = "'+sha256('tsfg.type\0undefined')+'"')],
    ['unrelated expression',line=>line.replace(/numeric_group = "[^"]+"/,'numeric_group = "unrelated-expression"')],
    ['wrong scalar consumer',line=>line.replace('numeric_operator = "tsfg_core.add"','numeric_operator = "tsfg_core.sub"')],
    ['wrong operand',line=>line.replace('numeric_operand = 0 : i32','numeric_operand = 1 : i32')],
    ['incomplete range',line=>line.replace(/tsfg_source.start = (\d+) : i64/,(_,start)=>'tsfg_source.start = '+(Number(start)+1)+' : i64')],
  ];
  for(const [name,mutate] of mutations)await t.test(name,async()=>{
    const result=await invokeCore(changeCheck(original,mutate));rejected(result);
    assert.match(result.stderr.toString('utf8'),/numeric|checked/,'rejection belongs to numeric consumption');
  });
});

test('Core numeric checked payload cannot escape as a general projection',{skip:!available},async()=>{
  const original=await numericCore(),lines=original.split('\n');
  const check=lines.find(line=>line.includes('"tsfg_core.domain.numeric_use"')&&line.includes('numeric_operator = "tsfg_core.add"'));
  assert.ok(check);const target=/\[\^(\w+)\]/.exec(check)[1];
  const block=lines.findIndex(line=>line.trim().startsWith('^'+target+'('));assert.ok(block>=0);
  const argument=/\((%[\w]+): i32\)/.exec(lines[block])[1];
  const consumer=lines[block+1];assert.ok(consumer.includes('"tsfg_core.add"'));
  const anchors=/tsfg_source.start = \d+ : i64, tsfg_source.end = \d+ : i64/.exec(consumer)[0];
  lines.splice(block+2,0,'    %numeric_escape = "tsfg_core.pos"('+argument+') {'+anchors+'} : (i32) -> i32');
  const result=await invokeCore(lines.join('\n'));rejected(result);
  assert.match(result.stderr.toString('utf8'),/numeric checked payload cannot escape/);
});

async function numericOrderModule() {
  const bytes=await readFile(new URL('./testdata/typed-array-holder-parameter/numeric-use-order-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:31d977221743664401bffcba459895e76ece4f42449570a42f7dedcaf8b2410b');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},publication=staticPublication(facts);
  const built=buildHir(facts,context,publication);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  return {core:lowerFormalHir(built.hir,context,publication),hir:built.hir};
}

test('Core numeric use retains checked i32 plus and proves U-only direct and caller normal exits',{skip:!available},async()=>{
  const {core}=await numericOrderModule();
  const first=await invokeCore(core);accepted(first);
  const second=await invokeCore(first.stdout.toString('utf8'));accepted(second);
  assert.deepEqual(second.stdout,first.stdout);
});

test('Core normal completion does not turn an unproductive recursive call followed by a constant into success',{skip:!available},async()=>{
  const {core,hir}=await numericOrderModule(),fn=hir.functions.find(row=>row.name==='plusValue');
  const lines=core.split('\n'),start=lines.findIndex(line=>line.includes('func.func @"f'+fn.id.slice(7)+'"'));
  assert.ok(start>=0);const signature=/tsfg_core.signature_hash = "([^"]+)"/.exec(lines[start])[1],
    abi=/tsfg_core.finite_abi = "([^"]+)"/.exec(lines[start])[1];
  // Deliberately derived Core CFG corruption, never an official Source packet
  // or a runtime oracle: the real owned signature stays unchanged.
  const call='    %numeric_recursive = "func.call"() {callee = @"f'+fn.id.slice(7)+'", tsfg_core.function_id = "'+fn.id+
    '", tsfg_core.signature_hash = "'+signature+'", tsfg_core.finite_abi = "'+abi+'", tsfg_source.start = '+fn.range.start+
    ' : i64, tsfg_source.end = '+fn.range.end+' : i64} : () -> i32';
  assert.ok(lines[start+1].includes('"tsfg_core.fuel"'));lines.splice(start+2,0,call);
  const result=await invokeCore(lines.join('\n'));rejected(result);
  assert.match(result.stderr.toString('utf8'),/whole admission requires complete actual parameter, return and Array backing bounds/);
});
