// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {compileHir,compileProgram,sourceInput,runBytecode} from "../../compiler/pipeline.mjs";
import {printHir,readHir,lowerHir} from "../../compiler/hir.mjs";
const tools=()=>({frontend:process.env.TSFG_FRONTEND_EXE,core:process.env.TSFG_CORE_IR_EXE,vm:process.env.TSFG_VM_EXE});
async function rows(){
  const bytes=await readFile(new URL("./fixtures/ordinary-families.FROZEN.json",import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),"350d36f6f3127a161c65ed7a73e2c0ee4b4141bf841ca711952f690df6c4111d");const cases=JSON.parse(bytes.toString("utf8")).cases;assert.equal(cases.length,204);return cases;
}
test("all defined ordinary scalar families retain official facts and cold HIR roundtrip",async()=>{
  for(const row of await rows()){
    const result=await compileHir(await sourceInput(row.source),tools());assert.equal(result.status,"ok",`${row.name}: ${JSON.stringify(result)}`);
    const text=printHir(result.hir);assert.equal(printHir(readHir(Buffer.from(text))),text,row.name);assert.doesNotThrow(()=>lowerHir(result.hir),row.name);
  }
});
test("all defined ordinary scalar primitives execute independent mathematical and IEEE-bit literals",async()=>{
  for(const row of await rows())for(const optimize of [false,true]){
    const program=await compileProgram(await sourceInput(row.source),{...tools(),optimize});assert.equal(program.status,"ok",`${row.name}: ${JSON.stringify(program)}`);
    const [actual]=await runBytecode(program.bytecode,{...tools(),requests:[{functionId:program.hir.functions.find(fn=>fn.name==="entry").id,arguments:row.arguments??[],depth:16}]});
    assert.equal(actual.status,"returned",`${row.name}: ${JSON.stringify(actual)}`);assert.deepEqual(actual.result,{type:row.expected.type,value:row.expected.value},row.name);
  }
});
