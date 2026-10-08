// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {compileHir,compileProgram,sourceInput,runBytecode} from "../../compiler/pipeline.mjs";
import {verifyHir,printHir,readHir,lowerHir} from "../../compiler/hir.mjs";
const tools=()=>({frontend:process.env.TSFG_FRONTEND_EXE,core:process.env.TSFG_CORE_IR_EXE,vm:process.env.TSFG_VM_EXE});
async function oracle(){
  const bytes=await readFile(new URL("./fixtures/nullish-oracle.FROZEN.json",import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),"016e7ebc7e30c51214b5d87558992d1ba29bf32766a8e0cef601ceb78cee1fe6");
  const rows=JSON.parse(bytes.toString("utf8")).cases;assert.equal(rows.length,27);return rows;
}
test("nullish assignment owns official target/read facts and initialized SSA",async()=>{
  for(const row of await oracle()){
    const result=await compileHir(await sourceInput(row.source),tools());
    if(row.expected.kind==="diagnostic"){
      assert.equal(result.status,"error",row.name);assert.ok(result.diagnostics.some(d=>d.phase==="types"&&d.upstreamCode===row.expected.upstreamCode),row.name);
    }else{
      assert.equal(result.status,"ok",`${row.name}: ${JSON.stringify(result)}`);
      const text=printHir(result.hir);assert.equal(printHir(readHir(Buffer.from(text))),text,row.name);assert.match(lowerHir(result.hir),/tsfg_core.parameter_presence/,row.name);
    }
  }
});
test("cold HIR rejects forged coalescing target type and removed initialization",async()=>{
  const result=await compileHir(await sourceInput("export function entry(): i32 { let value: i32 | undefined = 0; return value ??= 7; }"),tools());
  assert.equal(result.status,"ok",JSON.stringify(result));
  const forged=structuredClone(result.hir);forged.functions[0].body[1].value.left.presenceFlow.undefined=false;
  for(const consume of [verifyHir,printHir,lowerHir])assert.throws(()=>consume(forged));
  const assigned=await compileHir(await sourceInput("export function entry(): i32 { let value: i32; value = 7; return value; }"),tools());
  assert.equal(assigned.status,"ok",JSON.stringify(assigned));
  const missing=structuredClone(assigned.hir);missing.functions[0].body.splice(1,1);
  for(const consume of [verifyHir,printHir,lowerHir])assert.throws(()=>consume(missing));
});
test("nullish assignment executes independent literals through both Core modes",async()=>{
  for(const row of (await oracle()).filter(r=>r.expected.kind!=="diagnostic"))for(const optimize of [false,true]){
    const program=await compileProgram(await sourceInput(row.source),{...tools(),optimize});
    assert.equal(program.status,"ok",`${row.name}: ${JSON.stringify(program)}`);
    const request={functionId:program.hir.functions.find(fn=>fn.name==="entry").id,arguments:(row.arguments??[]).map(value=>({type:"bool",value})),depth:16};
    const [actual]=await runBytecode(program.bytecode,{...tools(),requests:[request]});
    if(row.expected.kind==="returned"){
      assert.equal(actual.status,"returned",`${row.name}: ${JSON.stringify(actual)}`);assert.deepEqual(actual.result,{type:row.expected.type,value:row.expected.value},row.name);
    }else{
      assert.equal(actual.status,"failed",`${row.name}: ${JSON.stringify(actual)}`);assert.equal(actual.code,row.expected.code);assert.ok(actual.ruleIds.includes(row.expected.ruleId));
      assert.equal(actual.source.path,"/src/main.ts");assert.equal(row.source.slice(Number(actual.source.start),Number(actual.source.end)).trim(),row.expected.sourceExpression);
    }
  }
});
