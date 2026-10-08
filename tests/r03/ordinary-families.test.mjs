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

test('float prefix and postfix updates preserve old raw bits and produce strict arithmetic results',async()=>{
 const cases=[
  ['f32','let value: f32 = 3.0; return value++;','40400000'],
  ['f32','let value: f32 = 3.0; return ++value;','40800000'],
  ['f32','let value: f32 = 3.0; return value--;','40400000'],
  ['f32','let value: f32 = 3.0; return --value;','40000000'],
  ['f64','let value: f64 = 3.0; return value++;','4008000000000000'],
  ['f64','let value: f64 = 3.0; return ++value;','4010000000000000'],
  ['f64','let value: f64 = 3.0; return value--;','4008000000000000'],
  ['f64','let value: f64 = 3.0; return --value;','4000000000000000'],
 ];
 for(const [type,body,bits]of cases)for(const optimize of [false,true]){
  const source=`export function entry(): ${type} { ${body} }`,program=await compileProgram(await sourceInput(source),{...tools(),optimize});
  assert.equal(program.status,'ok',JSON.stringify({source,program}));
  const [actual]=await runBytecode(program.bytecode,{...tools(),requests:[{functionId:program.hir.functions[0].id,depth:16}]});
  assert.equal(actual.status,'returned');assert.deepEqual(actual.result,{type,value:bits});
 }
});
test('float update assignment returns preserve negative zero and signaling NaN old bits',async()=>{
 const families=[
  ['f32','80000000','7fa00001','3f800000','bf800000','7fc00000'],
  ['f64','8000000000000000','7ff0000000000001','3ff0000000000000','bff0000000000000','7ff8000000000000'],
 ];
 for(const [type,zero,snan,one,negativeOne,nan]of families)for(const operator of ['++','--'])for(const prefix of [false,true])for(const optimize of [false,true]){
  const source=`export function entry(value: ${type}): ${type} { return ${prefix?operator:''}value${prefix?'':operator}; }`,program=await compileProgram(await sourceInput(source),{...tools(),optimize});
  assert.equal(program.status,'ok',JSON.stringify({source,program}));
  const actual=await runBytecode(program.bytecode,{...tools(),requests:[zero,snan].map(value=>({functionId:program.hir.functions[0].id,arguments:[{type,value}],depth:16}))});
  const expected=prefix?[operator==='++'?one:negativeOne,nan]:[zero,snan];
  for(const [index,value]of expected.entries()){assert.equal(actual[index].status,'returned');assert.deepEqual(actual[index].result,{type,value});}
 }
});
