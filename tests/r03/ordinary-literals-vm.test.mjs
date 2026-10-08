// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {compileProgram,sourceInput,runBytecode} from "../../compiler/pipeline.mjs";
const tools=()=>({frontend:process.env.TSFG_FRONTEND_EXE,core:process.env.TSFG_CORE_IR_EXE,vm:process.env.TSFG_VM_EXE});
const traps={
  "compound-zero-divisor-trap":{code:"r01-t-divide-zero",rule:"r01-division"},
  "compound-shift-out-of-range-trap":{code:"r01-t-shift-count",rule:"r01-shifts"},
  "omitted-argument-runs-trapping-default":{code:"r01-t-divide-zero",rule:"r01-division"},
  "caller-argument-trap-before-default-body":{code:"r01-t-divide-zero",rule:"r01-division"},
  "undefined-selects-trapping-default-on-nullable-parameter":{code:"r01-t-divide-zero",rule:"r01-division"},
};
test("original 44 frozen independent examples execute or retain official diagnostics",async()=>{
  const bytes=await readFile(new URL("./fixtures/ordinary-oracle.FROZEN.json",import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),"3772b9d88dd5c4cbd604e07d5bd4fb59b868fb9cb579ca6bc095e92e479bfa52");
  const rows=JSON.parse(bytes.toString("utf8")).cases;assert.equal(rows.length,44);
  for(const row of rows)for(const optimize of [false,true]){
    const program=await compileProgram(await sourceInput(row.source),{...tools(),optimize});
    if(row.expected.kind==="diagnostic"){
      assert.equal(program.status,"error",row.name);assert.ok(program.diagnostics.some(d=>d.phase==="types"&&d.upstreamCode),row.name);continue;
    }
    assert.equal(program.status,"ok",`${row.name}: ${JSON.stringify(program)}`);
    const [actual]=await runBytecode(program.bytecode,{...tools(),requests:[{functionId:program.hir.functions.find(fn=>fn.name==="entry").id,depth:16}]});
    if(row.expected.kind==="returned"){
      assert.equal(actual.status,"returned",`${row.name}: ${JSON.stringify(actual)}`);assert.deepEqual(actual.result,{type:row.expected.type,value:row.expected.value},row.name);
    }else{
      const trap=traps[row.name];assert.ok(trap,row.name);assert.equal(actual.status,"failed",row.name);assert.equal(actual.code,trap.code,row.name);assert.ok(actual.ruleIds.includes(trap.rule),row.name);
      assert.equal(actual.source.path,"/src/main.ts");assert.equal(row.source.slice(Number(actual.source.start),Number(actual.source.end)).trim(),row.expected.sourceExpression,row.name);
    }
  }
});
