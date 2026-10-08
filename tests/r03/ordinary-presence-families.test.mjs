// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import {compileProgram,sourceInput,runBytecode,createCompilerSession} from "../../compiler/pipeline.mjs";
const tools=()=>({frontend:process.env.TSFG_FRONTEND_EXE,core:process.env.TSFG_CORE_IR_EXE,vm:process.env.TSFG_VM_EXE});

test("grouped official guards preserve omission, undefined, null and present payloads in both lowering modes",async()=>{
  for(const missing of ["undefined","null"])for(const guard of [
    `(value) === ${missing}`, `value === (${missing})`, `(( ${missing} )) === ((value))`,
    `((value)) !== ((${missing}))`,
  ]) {
    const distinct=guard.includes("!=="),annotation=missing==="undefined"?"?: i32":": i32 | null";
    const source=`export function entry(value${annotation}): i32 { if (${guard}) { return ${distinct?"value":"8"}; } return ${distinct?"8":"value"}; }`;
    const input=await sourceInput(source),session=createCompilerSession(tools());
    for(const program of [await compileProgram(input,tools()),await session.compile(input)]) {
      assert.equal(program.status,"ok",JSON.stringify({source,program}));
      const argumentsList=[[{type:missing,value:null}],[{type:"i32",value:"0"}],[{type:"i32",value:"9"}]];
      if(missing==="undefined") argumentsList.unshift([]);
      const actual=await runBytecode(program.bytecode,{...tools(),requests:argumentsList.map(args=>({functionId:program.hir.functions[0].id,arguments:args,depth:16}))});
      assert.deepEqual(actual.map(row=>row.status),argumentsList.map(()=>"returned"));
      assert.deepEqual(actual.map(row=>row.result),argumentsList.map(args=>({type:"i32",value:args.length===0||args[0].type===missing?"8":args[0].value})));
    }
  }
});

test("formal loop execution retains present back edges, aliases, shadows and RHS evaluation once",async()=>{
  for(const [body,expected] of [
    ["value = 2;", "2"], ["value += 2;", "3"],
    ["let alias: i32 | undefined = 2; value = alias;", "2"],
    ["{ let value: i32 | undefined = undefined; value = 9; }", "1"],
    ["let inner: bool = true; while (inner) { value = 2; inner = false; }", "2"],
  ])for(const optimize of [false,true]) {
    const source=`export function entry(run: bool): i32 { let value: i32 | undefined = 1; while (run) { ${body} run = false; } return value; }`;
    const program=await compileProgram(await sourceInput(source),{...tools(),optimize});assert.equal(program.status,"ok",JSON.stringify({source,program}));
    const actual=await runBytecode(program.bytecode,{...tools(),requests:[false,true].map(value=>({functionId:program.hir.functions[0].id,arguments:[{type:"bool",value}],depth:16}))});
    assert.deepEqual(actual.map(row=>row.result),[{type:"i32",value:"1"},{type:"i32",value:expected}]);
  }
  const source="export function entry(run: bool): i32 { let value: i32 | undefined = 1; let count: i32 = 0; while (run) { value = (count += 1); run = false; } return value + count; }";
  for(const optimize of [false,true]) {
    const program=await compileProgram(await sourceInput(source),{...tools(),optimize});assert.equal(program.status,"ok",JSON.stringify(program));
    const actual=await runBytecode(program.bytecode,{...tools(),requests:[false,true].map(value=>({functionId:program.hir.functions[0].id,arguments:[{type:"bool",value}],depth:16}))});
    assert.deepEqual(actual.map(row=>row.result),[{type:"i32",value:"1"},{type:"i32",value:"2"}]);
  }
});

test("terminal loop writes affect their return path while ordinary exits retain live state",async()=>{
  for(const absence of ["undefined","null"])for(const optimize of [false,true]) {
    const source=`export function entry(run: bool): i32 { let value: i32 | ${absence} = 1; while (run) { value = ${absence}; return 0; } return value; }`;
    const input=await sourceInput(source),session=createCompilerSession({...tools(),optimize});
    for(const program of [await compileProgram(input,{...tools(),optimize}),await session.compile(input)]) {
      assert.equal(program.status,"ok",JSON.stringify({source,program}));
      const actual=await runBytecode(program.bytecode,{...tools(),requests:[false,true].map(value=>({functionId:program.hir.functions[0].id,arguments:[{type:"bool",value}],depth:16}))});
      assert.deepEqual(actual.map(row=>row.status),["returned","returned"]);
      assert.deepEqual(actual.map(row=>row.result),[{type:"i32",value:"1"},{type:"i32",value:"0"}]);
    }
  }
  for(const terminal of ["if (early) { value = undefined; return 0; }", "while (early) { value = undefined; return 0; }"])for(const optimize of [false,true]) {
    const source=`export function entry(run: bool, early: bool): i32 { let value: i32 | undefined = 1; while (run) { ${terminal} value = 2; run = false; } return value; }`;
    const program=await compileProgram(await sourceInput(source),{...tools(),optimize});assert.equal(program.status,"ok",JSON.stringify({source,program}));
    const actual=await runBytecode(program.bytecode,{...tools(),requests:[[false,false],[false,true],[true,false],[true,true]].map(args=>({functionId:program.hir.functions[0].id,arguments:args.map(value=>({type:"bool",value})),depth:16}))});
    assert.deepEqual(actual.map(row=>row.result),["1","1","2","0"].map(value=>({type:"i32",value})));
  }
});
// Explicit, independent raw payload expectations. Undefined and null use the
// same canonical zero payload in every physical scalar family.
const families=[
  ...["i8","i16","i32","i64","u8","u16","u32","u64","isize","usize"].map(type=>({type,seven:"7",zero:"0",literal:"7",zeroLiteral:"0"})),
  {type:"f32",seven:"40e00000",zero:"00000000",literal:"7",zeroLiteral:"0"},
  {type:"f64",seven:"401c000000000000",zero:"0000000000000000",literal:"7",zeroLiteral:"0"},
  {type:"bool",seven:true,zero:false,literal:"true",zeroLiteral:"false"},
];
test("grouped call absences retain default selection and nullable payloads across scalar families",async()=>{
  for(const family of families)for(const optimize of [false,true]) {
    const source=`function choose(value: ((${family.type}) | null) = ${family.literal}): ${family.type} { if (value === null) { return ${family.zeroLiteral}; } return value; } export function missing(): ${family.type} { return choose(((undefined))); } export function nullable(): ${family.type} { return choose(((null))); } export function present(): ${family.type} { return choose(((${family.zeroLiteral}))); }`;
    const input=await sourceInput(source),session=createCompilerSession({...tools(),optimize});
    for(const program of [await compileProgram(input,{...tools(),optimize}),await session.compile(input)]) {
      assert.equal(program.status,"ok",JSON.stringify({source,program}));
      const names=["missing","nullable","present"];
      const actual=await runBytecode(program.bytecode,{...tools(),requests:names.map(name=>({functionId:program.hir.functions.find(fn=>fn.name===name).id,arguments:[],depth:16}))});
      assert.deepEqual(actual.map(row=>row.status),names.map(()=>"returned"));
      assert.deepEqual(actual.map(row=>row.result),[family.seven,family.zero,family.zero].map(value=>({type:family.type,value})));
    }
  }
});

test("grouped optional and local finite annotations preserve raw payloads in both modes",async()=>{
  for(const family of families)for(const optimize of [false,true]) {
    const source=`function optional(value?: ((${family.type}))): ${family.type} { if (value === undefined) { return ${family.literal}; } return value; } function local(): ${family.type} { let value: ((${family.type}) | (null | undefined)) = null; value ??= ${family.literal}; return value; } export function missing(): ${family.type} { return optional(); } export function present(): ${family.type} { return optional(${family.zeroLiteral}); } export function localized(): ${family.type} { return local(); }`;
    const input=await sourceInput(source),session=createCompilerSession({...tools(),optimize});
    for(const program of [await compileProgram(input,{...tools(),optimize}),await session.compile(input)]) {
      assert.equal(program.status,"ok",JSON.stringify({source,program}));
      const names=["missing","present","localized"];
      const actual=await runBytecode(program.bytecode,{...tools(),requests:names.map(name=>({functionId:program.hir.functions.find(fn=>fn.name===name).id,arguments:[],depth:16}))});
      assert.deepEqual(actual.map(row=>row.status),names.map(()=>"returned"));
      assert.deepEqual(actual.map(row=>row.result),[family.seven,family.zero,family.seven].map(value=>({type:family.type,value})));
    }
  }
});

test("null surrounding trivia suppresses trapping defaults and preserves nullable values",async()=>{
  for(const argument of ["/* outside ( ) */ null","// outside ) (\nnull","\u2028/* outside */ null\u00a0"])for(const optimize of [false,true]) {
    const source=`function fail(): i32 { return 1 / 0; } function choose(value: ((i32) | (null | undefined)) = fail()): i32 { if (value === null) { return 8; } if (value === undefined) { return 9; } return value; } export function entry(): i32 { return choose(${argument}); }`;
    const input=await sourceInput(source),session=createCompilerSession({...tools(),optimize});
    for(const program of [await compileProgram(input,{...tools(),optimize}),await session.compile(input)]) {
      assert.equal(program.status,"ok",JSON.stringify({source,program}));
      const actual=await runBytecode(program.bytecode,{...tools(),requests:[{functionId:program.hir.functions.find(fn=>fn.name==="entry").id,arguments:[],depth:16}]});
      assert.equal(actual[0].status,"returned");assert.deepEqual(actual[0].result,{type:"i32",value:"8"});
    }
  }
});
test("grouped optional call arguments distinguish builtin undefined from a shadowing scalar",async()=>{
  for(const optimize of [false,true])for(const [argument,shadow,expected] of [
    ["((undefined))","","7"], ["((undefined))","const undefined: i32 = 3;","3"], ["((0))","","0"],
    [String.raw`\u0075ndefined`,"","7"], [String.raw`(\u0075ndefined)`,"","7"],
    [String.raw`( /* ) ( */ (\u{75}ndefined /* ) */ ) )`,"","7"],
    [String.raw`(\u0075ndefined)`,"const undefined: i32 = 3;","3"],
    ["(\u2028/* ) ( */ undefined\u00a0/* ( ) */)","","7"],
  ]) {
    const source=`function choose(value?: i32): i32 { if (value === undefined) { return 7; } return value; } export function entry(): i32 { ${shadow} return choose(${argument}); }`;
    const program=await compileProgram(await sourceInput(source),{...tools(),optimize});
    assert.equal(program.status,"ok",JSON.stringify({source,program}));
    const [actual]=await runBytecode(program.bytecode,{...tools(),requests:[{functionId:program.hir.functions.find(fn=>fn.name==="entry").id,arguments:[],depth:16}]});
    assert.equal(actual.status,"returned");assert.deepEqual(actual.result,{type:"i32",value:expected});
  }
});
test("optional and nullable default presence executes for every admitted scalar payload family",async()=>{
  for(const family of families)for(const optimize of [false,true])for(const optional of [false,true]){
    const source=optional
      ? `export function entry(value?: ${family.type}): ${family.type} { if (value === undefined) { return ${family.literal}; } return value; }`
      : `export function entry(value: ${family.type} | null = ${family.literal}): ${family.type} { if (value === null) { return ${family.zeroLiteral}; } return value; }`;
    const program=await compileProgram(await sourceInput(source),{...tools(),optimize});assert.equal(program.status,"ok",JSON.stringify({source,program}));
    const request=argument=>({functionId:program.hir.functions[0].id,depth:16,arguments:argument===undefined?[]:[argument]});
    const requests=[request(),request({type:"undefined",value:null}),request({type:family.type,value:family.zero})];
    if(!optional)requests.push(request({type:"null",value:null}));
    const actual=await runBytecode(program.bytecode,{...tools(),requests});
    for(let index=0;index<actual.length;index++){
      assert.equal(actual[index].status,"returned",JSON.stringify({source,index,actual}));
      assert.deepEqual(actual[index].result,{type:family.type,value:index<2?family.seven:family.zero});
    }
  }
});
test("optional boolean narrowing retains logical assignment effects",async()=>{
  for(const source of [
    "export function entry(value?: bool): bool { if (value === undefined) { value = false; } value ||= true; return value; }",
    "export function entry(value?: bool): bool { if (value === undefined) { return false; } value &&= false; return value; }",
  ]){
    const program=await compileProgram(await sourceInput(source),tools());assert.equal(program.status,"ok",JSON.stringify({source,program}));
    const [actual]=await runBytecode(program.bytecode,{...tools(),requests:[{functionId:program.hir.functions[0].id,arguments:[{type:"bool",value:true}],depth:16}]});
    assert.equal(actual.status,"returned");assert.deepEqual(actual.result,{type:"bool",value:source.includes("||=")});
  }
});
