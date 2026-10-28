// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseKernelCore} from './kernel-global-core-structural.mjs';
const o=JSON.parse(await readFile(new URL('./kernel-global-core-oracle.json',import.meta.url),'utf8'));
test('independent whole Core oracle covers all four functions, UTF-16 sources and every scalar CFG edge',()=>{
  const p=parseKernelCore(o.core),names=p.functions.map(f=>f.attributes['tsfg_core.logical_name']);
  assert.deepEqual(names,['$moduleInit','peer','leaf','entry']);
  assert.deepEqual(p.attributes['tsfg_core.sources'].map(s=>s.length),[{integer:'254',width:'i64'},{integer:'1214',width:'i64'}]);
  assert.deepEqual(JSON.parse(p.attributes['tsfg_core.kernel_global'].payload),o.payload);
  assert.deepEqual(p.functions.map(f=>f.blocks.length),[1,4,4,1]);
  for(const fn of p.functions.slice(1,3)){
    assert.deepEqual(fn.blocks[0].operations.at(-1).successors,[2,1]);
    assert.deepEqual(fn.blocks[1].operations.at(-1).operands,[0]);
    assert.deepEqual(fn.blocks[2].operations.at(-1).operands,[1]);
    assert.deepEqual(fn.blocks[3].parameters,[{id:2,type:'i1'}]);
    assert.deepEqual(fn.blocks[3].operations[0].operands,[2]);
  }
  const call=p.functions[3].blocks[0].operations[1];
  assert.equal(call.name,'func.call');assert.deepEqual(call.operands,[0]);
  assert.deepEqual(call.results,[{id:1,type:'i1'}]);
  assert.equal(call.attributes['tsfg_core.function_id'],o.ssa.entry.callee);
  assert.deepEqual(p.functions[3].blocks[0].operations[2].operands,[1]);
});
test('whole structural oracle preserves a changed join operand and refuses dropped tokens/undefined SSA',()=>{
  const p=parseKernelCore(o.core);
  assert.notDeepEqual(parseKernelCore(o.core.replace('cf.br ^bb3(%v0 : i1)','cf.br ^bb3(%v1 : i1)')),p);
  assert.throws(()=>parseKernelCore(o.core+' garbage'));
  assert.throws(()=>parseKernelCore(o.core.replace('"func.return"(%v2)','"func.return"(%v99)')));
});
