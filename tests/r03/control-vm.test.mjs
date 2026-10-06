// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { compileHir, sourceInput, compileProgram, runBytecode, runRequestSequence, createCompilerSession } from "../../compiler/pipeline.mjs";
import { printHir, readHir, lowerHir, verifyHir } from "../../compiler/hir.mjs";
import { canonical, sha256, boolTypeId } from "../../compiler/identity.mjs";
const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE, core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });
const loop = "export function answer(): i32 { let n: i32 = 0; while (n < 3) { n = n + 1; } return n; }";

test("official control facts become owned source-anchored HIR and typed loop phi", async () => {
  for (const source of [loop, "export function answer(): i32 { if (true) { return 42; } else { return 0; } }",
    "export function answer(): bool { return false && ((1 / 0) === 0); }"]) {
    const checked = await compileHir(await sourceInput(source), tools());
    assert.equal(checked.status, "ok", JSON.stringify(checked));
    const text = printHir(checked.hir);
    assert.equal(printHir(readHir(Buffer.from(text))), text);
    const core = lowerHir(readHir(Buffer.from(text)));
    assert.match(core, /tsfg_core.fuel/);
    assert.match(core, /cf.cond_br/);
    if (source === loop) { assert.match(core, /event = 2 : i32/); assert.match(core, /\^bb1\(%v\d+: i32\)/); }
    if (process.env.TSFG_CONTROL_CORE_SAMPLES) await writeFile(`${process.env.TSFG_CONTROL_CORE_SAMPLES}/${source === loop ? "loop" : source.includes("&&") ? "short" : "if"}.mlir`,core);
  }
});

test("owned control HIR rejects forged types, identities, source conditions and escaping bindings", async () => {
  const checked = await compileHir(await sourceInput(loop),tools());
  assert.equal(checked.status,"ok",JSON.stringify(checked));
  const faults = [hir => hir.functions[0].body[1].condition.type=hir.functions[0].returnType.id,
    hir => hir.functions[0].body[1].body[0].body[0].target.binding="l99",
    hir => hir.contractVersion="0.3.0",
    hir => hir.functions[0].body[1].condition.operator=">",
    hir => hir.functions[0].body[1].body[0].body[0].range.end=hir.source.content.length+1];
  for(const fault of faults){const hir=structuredClone(checked.hir);fault(hir);assert.throws(()=>verifyHir(hir),/r03-hir-invalid/);assert.throws(()=>readHir(Buffer.from(`${canonical(hir)}\n`)),/r03-hir-invalid/);}
});
test("owned structured source retains lexical scopes, empty bodies, unbraced and nested control", async () => {
  const sources = [
    "export function answer(): i32 { let n: i32 = 0; while (false) {} return n; }",
    "export function answer(): i32 { let n: i32 = 0; if (true) n = 42; else n = 0; return n; }",
    "export function answer(): i32 { let n: i32 = 0; while (n < 3 && true) { if (n === 1) { n = n + 2; } else { n = n + 1; } } return n; }",
    "export function answer(): i32 { let n: i32 = 40; { const n: i32 = 9; if (false) { return n; } } return n; }",
    "export function answer(): i32 { if (false) return 1 / 0; return 42; }",
    "/*😀*/ export function answer(): bool { return true || false && ((1 / 0) === 0); }",
  ];
  for (const source of sources) {
    const checked = await compileHir(await sourceInput(source), tools());
    assert.equal(checked.status,"ok",JSON.stringify(checked));
    assert.equal(printHir(readHir(Buffer.from(printHir(checked.hir)))),printHir(checked.hir));
    const core=lowerHir(checked.hir);
    assert.match(core,/tsfg_core.fuel/);
    assert.doesNotMatch(core,/undefined/);
  }
});

test("owned definite assignment retains declarations initialized in both branches or a nested block", async () => {
  for(const source of ["export function answer(): i32 { let n: i32 = 42; if (true) n = 42; else n = 0; return n; }",
    "export function answer(): i32 { let n: i32 = 42; { n = 42; } return n; }"]){
    const checked=await compileHir(await sourceInput(source),tools());
    assert.equal(checked.status,"ok",JSON.stringify(checked));
    // Owned seam only: the current official producer intentionally rejects
    // source declarations without initializers (the existing R01 W1 boundary).
    const hir=structuredClone(checked.hir);
    hir.source.content=source.replace("= 42;","    ;");
    hir.source.hash=sha256(hir.source.content);
    hir.functions[0].body[0].initializer=null;
    assert.doesNotMatch(lowerHir(verifyHir(hir)),/undefined/);
  }
});

test("owned lexical shadowing rejects forged outer read and write bindings before lowering", async () => {
  const cases=[
    {source:"export function answer(): i32 { let n: i32 = 1; { const n: i32 = 2; return n; } }",field:"value"},
    {source:"export function answer(): i32 { let n: i32 = 1; { let n: i32 = 2; n = 3; } return n; }",field:"target"},
  ];
  for(const {source,field} of cases){
    const checked=await compileHir(await sourceInput(source),tools());
    assert.equal(checked.status,"ok",JSON.stringify(checked));
    assert.doesNotThrow(()=>lowerHir(checked.hir));
    const forged=structuredClone(checked.hir);
    forged.functions[0].body[1].body[1][field].binding="l0";
    assert.throws(()=>verifyHir(forged),/r03-hir-invalid/);
    assert.throws(()=>printHir(forged),/r03-hir-invalid/);
    assert.throws(()=>readHir(Buffer.from(canonical(forged)+"\n")),/r03-hir-invalid/);
    assert.throws(()=>lowerHir(forged),/r03-hir-invalid/);
  }
});

test("owned whole-scope TDZ rejects outer aliases in initializers and before inner declarations", async () => {
  const cases=[
    {source:"export function answer(): i32 { let n: i32 = 1; { let n: i32 = 2; return n; } }",index:0,field:"initializer",nearest:"l1"},
    {source:"export function answer(): i32 { let n: i32 = 1; { let m: i32 = 2; let n: i32 = 3; return m; } }",index:0,field:"initializer",nearest:"l2"},
    {source:"export function answer(): i32 { let n: i32 = 1; { let m: i32 = 1; m = 2; let n: i32 = 3; } return n; }",index:1,field:"target",nearest:"l2"},
  ];
  for(const {source,index,field,nearest} of cases){
    const checked=await compileHir(await sourceInput(source),tools());
    assert.equal(checked.status,"ok",JSON.stringify(checked));
    const forged=structuredClone(checked.hir),statement=forged.functions[0].body[1].body[index],original=statement[field];
    const spelling=source.slice(original.range.start,original.range.end);
    forged.source.content=source.slice(0,original.range.start)+spelling.replace(field==="target"?"m":"2","n")+source.slice(original.range.end);
    forged.source.hash=sha256(forged.source.content);
    statement[field]={kind:"reference",type:original.type,binding:"l0",range:original.range};
    for(const admit of [verifyHir,printHir,lowerHir])assert.throws(()=>admit(forged),/r03-hir-invalid/);
    assert.throws(()=>readHir(Buffer.from(canonical(forged)+"\n")),/r03-hir-invalid/);
    statement[field].binding=nearest;
    assert.throws(()=>verifyHir(forged),field==="initializer"?{code:"r03-hir-dominance",ruleId:"r01-evaluation"}:/r03-hir-invalid/);
  }
});

test("formal three-iteration while charges initial and final false conditions with exact residual fuel", async () => {
  const compiled = await compileProgram(await sourceInput(loop),tools());
  assert.equal(compiled.status,"ok",JSON.stringify(compiled));
  const outcomes = await runBytecode(compiled.bytecode,{...tools(),requests:[{semanticFuel:4},{semanticFuel:5},{semanticFuel:6}]});
  // Independently enumerate events: entry; n=0 true; n=1 true; n=2 true; n=3 false.
  assert.equal(outcomes[0].code,"r01-t-fuel"); assert.equal(outcomes[0].category,"trap");
  assert.deepEqual(outcomes[0].ruleIds,["r01-fuel"]);
  assert.equal(loop.slice(Number(outcomes[0].source.start),Number(outcomes[0].source.end)).trim(),"n < 3");
  for(const [index,remaining] of [[1,"0"],[2,"1"]]){
    assert.deepEqual(outcomes[index].result,{type:"i32",value:"3"});
    assert.equal(outcomes[index].fuelConsumed,"5");assert.equal(outcomes[index].fuelRemaining,remaining);
  }
  assert.equal(outcomes[0].fuelConsumed,"4");assert.equal(outcomes[0].fuelRemaining,"0");
  for(const result of outcomes) assert.equal(result.activeRequests,"0");
});
test("formal zero-loop and condition trap distinguish budget-event failure from expression failure", async () => {
  const zero="export function answer(): i32 { while (false) {} return 42; }";
  const trap="export function answer(): i32 { while ((1 / 0) === 0) {} return 42; }";
  for(const {source,budgets,codes} of [{source:zero,budgets:[1,2],codes:["r01-t-fuel",null]},{source:trap,budgets:[1,2],codes:["r01-t-fuel","r01-t-divide-zero"]}]){
    const compiled=await compileProgram(await sourceInput(source),tools());assert.equal(compiled.status,"ok",JSON.stringify(compiled));
    const outcomes=await runBytecode(compiled.bytecode,{...tools(),requests:budgets.map(semanticFuel=>({semanticFuel}))});
    assert.equal(outcomes[0].code,codes[0]);assert.equal(outcomes[0].fuelConsumed,"1");
    if(codes[1]){assert.equal(outcomes[1].code,codes[1]);assert.equal(source.slice(Number(outcomes[1].source.start),Number(outcomes[1].source.end)).trim(),"1 / 0");}
    else {assert.deepEqual(outcomes[1].result,{type:"i32",value:"42"});assert.equal(outcomes[1].fuelConsumed,"2");assert.equal(outcomes[1].fuelRemaining,"0");}
  }
});

test("unreached if and boolean paths do not execute traps or add semantic events", async () => {
  const cases=[
    ["export function answer(): i32 { if (false) { return 1 / 0; } else { return 42; } }","i32","42"],
    ["export function answer(): i32 { let n: i32 = 0; if (true) n = 42; else n = 1 / 0; return n; }","i32","42"],
    ["export function answer(): bool { return false && ((1 / 0) === 0); }","bool",false],
    ["export function answer(): bool { return true || ((1 / 0) === 0); }","bool",true],
    ["export function answer(): bool { return true || false && ((1 / 0) === 0); }","bool",true],
    ["export function answer(): bool { return false || true && false; }","bool",false],
    ["export function answer(): i32 { let n: i32 = 1; { const n: i32 = 2; return n; } }","i32","2"],
    ["export function answer(): i32 { let n: i32 = 1; { let n: i32 = 2; n = 3; } return n; }","i32","1"],
  ];
  for(const [source,type,value] of cases){
    const compiled=await compileProgram(await sourceInput(source),tools());assert.equal(compiled.status,"ok",JSON.stringify(compiled));
    const [outcome]=await runBytecode(compiled.bytecode,{...tools(),requests:[{semanticFuel:1}]});
    assert.deepEqual(outcome.result,{type,value});assert.equal(outcome.fuelConsumed,"1");assert.equal(outcome.fuelRemaining,"0");
  }
});

test("loop phi transfers preserve old scalar values and nested loops retain every condition event", async () => {
  const swap="export function answer(): i32 { let a: i32 = 1, b: i32 = 2, n: i32 = 0; while (n < 1) { const old: i32 = a; a = b; b = old; n = n + 1; } return a * 10 + b; }";
  const nested="export function answer(): i32 { let outer: i32 = 0, total: i32 = 0; while (outer < 1) { let inner: i32 = 0; while (inner < 2) { total = total + 1; inner = inner + 1; } outer = outer + 1; } return total; }";
  for(const [source,result,cost] of [[swap,"21","3"],[nested,"2","6"]]){
    const compiled=await compileProgram(await sourceInput(source),tools());assert.equal(compiled.status,"ok",JSON.stringify(compiled));
    const [outcome]=await runBytecode(compiled.bytecode,{...tools(),requests:[{semanticFuel:Number(cost)}]});
    assert.deepEqual(outcome.result,{type:"i32",value:result});assert.equal(outcome.fuelConsumed,cost);assert.equal(outcome.fuelRemaining,"0");
  }
});

test("entry fuel and physical bounds have independent failures and the same host accepts another request", async () => {
  const trapped=await compileProgram(await sourceInput("export function answer(): i32 { return 1 / 0; }"),tools());
  const good=await compileProgram(await sourceInput("export function answer(): i32 { return 42; }"),tools());
  assert.equal(trapped.status,"ok",JSON.stringify(trapped));assert.equal(good.status,"ok",JSON.stringify(good));
  const outcomes=await runRequestSequence([trapped.bytecode,trapped.bytecode,good.bytecode,good.bytecode],{...tools(),requests:[{semanticFuel:0,instructionBudget:0},{semanticFuel:1},{semanticFuel:1,instructionBudget:0},{semanticFuel:1}]});
  assert.equal(outcomes[0].code,"r01-t-fuel");assert.equal(outcomes[0].fuelConsumed,"0");
  assert.equal(outcomes[1].code,"r01-t-divide-zero");assert.equal(outcomes[1].fuelConsumed,"1");
  assert.equal(outcomes[2].code,"r05-execution-abort");assert.equal(outcomes[2].category,"execution-abort");
  assert.deepEqual(outcomes[3].result,{type:"i32",value:"42"});
  for(const result of outcomes)assert.equal(result.activeRequests,"0");
});

test("control source metamorphisms, optimized pipeline and full/incremental execution stay equivalent", async () => {
  const sources=[loop,"/*😀*/ export function answer(): i32 {\n let n: i32 = 0;\n while (/*before*/ n < 0x3) { n = n + 0x1; }\n return n;\n}",
    "export function answer(): bool { return false || true && false; }"];
  const session=createCompilerSession(tools());let identity;
  for(const source of sources){
    const input=await sourceInput(source),full=await compileProgram(input,tools()),incremental=await session.compile(input),optimized=await compileProgram(input,{...tools(),optimize:true});
    for(const compiled of [full,incremental,optimized])assert.equal(compiled.status,"ok",JSON.stringify(compiled));
    assert.deepEqual(incremental.hir,full.hir);assert.equal(incremental.core,full.core);assert.deepEqual(incremental.bytecode,full.bytecode);
    assert.deepEqual((await session.compile(input)).bytecode,full.bytecode);
    assert.deepEqual(await runBytecode(full.bytecode,{...tools(),command:"--roundtrip"}),full.bytecode);
    const request={semanticFuel:source.includes("while")?5:1};
    const baseline=await runBytecode(full.bytecode,{...tools(),requests:[request]});
    assert.deepEqual(await runBytecode(incremental.bytecode,{...tools(),requests:[request]}),baseline);
    assert.deepEqual(await runBytecode(optimized.bytecode,{...tools(),requests:[request]}),baseline);
    assert.deepEqual(baseline[0].result,source.includes("while")?{type:"i32",value:"3"}:{type:"bool",value:false});
    assert.equal(baseline[0].fuelConsumed,source.includes("while")?"5":"1");assert.equal(baseline[0].source.hash,sha256(source));
    if(source.includes("while")){if(identity)assert.equal(baseline[0].functionId,identity);identity=baseline[0].functionId;}
  }
  assert.deepEqual(session.statistics(),{analyses:6,lowerings:3,reuses:3});
});
