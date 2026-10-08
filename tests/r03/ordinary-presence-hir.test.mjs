// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {compileHir,sourceInput} from "../../compiler/pipeline.mjs";
import {analyzeFrontend,validateFrontendSnapshot} from "../../compiler/frontend.mjs";
import {verifyHir,printHir,readHir,lowerHir} from "../../compiler/hir.mjs";
import {sha256,canonical} from "../../compiler/identity.mjs";

const frontend=()=>({frontend:process.env.TSFG_FRONTEND_EXE});
async function checked(source) {
  const result=await compileHir(await sourceInput(source),frontend());
  assert.equal(result.status,"ok",JSON.stringify(result));return result.hir;
}

test("44 independent frozen ordinary examples cross the official and owned HIR seams",async()=>{
  const bytes=await readFile(new URL("./fixtures/ordinary-oracle.FROZEN.json",import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),"3772b9d88dd5c4cbd604e07d5bd4fb59b868fb9cb579ca6bc095e92e479bfa52");
  const oracle=JSON.parse(bytes.toString("utf8"));assert.equal(oracle.cases.length,44);
  for(const row of oracle.cases) {
    const result=await compileHir(await sourceInput(row.source),frontend());
    if(row.expected.kind==="diagnostic") {
      assert.equal(result.status,"error",row.name);assert.ok(result.diagnostics.every(d=>d.phase==="types"),row.name);
      for(const diagnostic of result.diagnostics) {
        assert.ok(diagnostic.code && diagnostic.ruleId && diagnostic.upstreamCode,row.name);
        assert.equal(diagnostic.primary.sourceId,"/src/main.ts");
        assert.ok(row.source.slice(diagnostic.primary.start,diagnostic.primary.end).trim());
      }
    } else {
      assert.equal(result.status,"ok",`${row.name}: ${JSON.stringify(result)}`);
      const text=printHir(result.hir);assert.equal(printHir(readHir(Buffer.from(text))),text,row.name);
      assert.match(lowerHir(result.hir),/tsfg_core.parameter_presence/,row.name);
    }
  }
});

test("finite local assignment and branch proofs preserve official presence facts",async()=>{
  for(const source of [
    "export function entry(): i32 { let value: i32 | undefined = undefined; value = 4; return value; }",
    "export function entry(): i32 { let value: i32 | null = null; if (value === null) { value = 5; } return value; }",
    "function choose(value?: i32): i32 { if (value === undefined) { return 8; } return value; } export function entry(): i32 { let value: i32 | undefined = undefined; return choose((value)); }",
    "export function entry(value?: i32): i32 { while (value === undefined) { value = 4; } return value; }",
  ]) {
    const hir=await checked(source),text=printHir(hir);assert.equal(printHir(readHir(Buffer.from(text))),text);
    assert.doesNotThrow(()=>lowerHir(hir));
  }
});

test("loop back-edge states follow actual scalar writes, aliases and lexical scopes",async()=>{
  for(const body of [
    "value = 2; run = false;",
    "value += 2; run = false;",
    "let alias: i32 | undefined = 2; value = alias; run = false;",
    "if (run) { value = 2; } else { value = 3; } run = false;",
    "{ let value: i32 | undefined = undefined; value = 9; } run = false;",
    "let inner: bool = true; while (inner) { value = 2; inner = false; } run = false;",
    "return value;",
    "value = undefined; return 0;",
  ]) {
    // Every reachable back edge preserves present; a return has no back edge.
    const source=`export function entry(run: bool): i32 { let value: i32 | undefined = 1; while (run) { ${body} } return value; }`;
    const hir=await checked(source),text=printHir(hir);
    assert.equal(printHir(readHir(Buffer.from(text))),text);
    assert.doesNotThrow(()=>lowerHir(hir));
  }
});

test("terminal null writes do not reach the ordinary loop exit",async()=>{
  const source="export function entry(run: bool): i32 { let value: i32 | null = 1; while (run) { value = null; return 0; } return value; }";
  const hir=await checked(source),text=printHir(hir);
  assert.equal(printHir(readHir(Buffer.from(text))),text);
  assert.doesNotThrow(()=>lowerHir(hir));
});

test("possible missing loop writes retain official rejection and cannot forge a present read",async()=>{
  const unsafe="export function entry(run: bool): i32 { let value: i32 | undefined = 1; while (run) { value = undefined; run = false; } return value; }";
  const rejected=await compileHir(await sourceInput(unsafe),frontend());
  assert.equal(rejected.status,"error",JSON.stringify(rejected));
  assert.ok(rejected.diagnostics.some(item=>item.phase==="types"&&item.upstreamCode===2322));
  const guarded=unsafe.replace("return value;","if (value === undefined) { return 8; } return value;");
  const hir=await checked(guarded),copy=structuredClone(hir);
  copy.functions[0].body[2].condition.left.presenceFlow.undefined=false;
  for(const invoke of [()=>verifyHir(copy),()=>printHir(copy),()=>lowerHir(copy),()=>readHir(Buffer.from(canonical(copy)+"\n"))]) assert.throws(invoke);
});

test("grouped presence guards retain whole and leaf source proofs at every cold HIR seam",async()=>{
  const source="export function entry(value?: i32): i32 { if (((undefined)) === ((value))) { return 8; } return value; }";
  const hir=await checked(source),condition=hir.functions[0].body[0].condition;
  assert.equal(source.slice(condition.left.range.start,condition.left.range.end),"((undefined))");
  assert.equal(source.slice(condition.right.range.start,condition.right.range.end),"((value))");
  const text=printHir(hir);assert.equal(printHir(readHir(Buffer.from(text))),text);
  for(const mutate of [
    h=>{h.functions[0].body[0].condition.right.range.start++;},
    h=>{h.functions[0].body[0].condition.right.operand.operand.presenceFlow.undefined=false;},
    h=>{h.functions[0].body[0].condition.left.operand.operand.absence="null";},
    h=>{h.functions[0].body[0].condition.right.operand.operand.binding="l999";},
    h=>{h.functions[0].body[0].condition.right.operand.type=hir.functions[0].returnType.id+"-forged";},
  ]) {
    const copy=structuredClone(hir);mutate(copy);
    for(const invoke of [()=>verifyHir(copy),()=>printHir(copy),()=>lowerHir(copy),()=>readHir(Buffer.from(canonical(copy)+"\n"))]) assert.throws(invoke);
  }
  for(const unsafe of [
    "export function entry(value?: i32): i32 { if ((value) === (undefined)) { return value; } return 8; }",
    "export function entry(value?: i32): i32 { const undefined: i32 = 7; if ((value) === (undefined)) { return 8; } return value; }",
  ]) {
    const result=await compileHir(await sourceInput(unsafe),frontend());
    assert.equal(result.status,"error",JSON.stringify(result));
    assert.ok(result.diagnostics.some(item=>item.phase==="types"&&item.upstreamCode===2322));
  }
});

test("cold HIR rejects forged presence flow, masks, type spans and old identities",async()=>{
  const source="export function entry(value?: i32): i32 { if (value === undefined) { return 8; } return value; }";
  const hir=await checked(source);
  for(const mutate of [
    h=>{h.functions[0].parameters[0].presence.undefined=false;},
    h=>{h.functions[0].parameters[0].presence.annotation.start++;},
    h=>{h.functions[0].body[0].condition.left.presenceFlow.undefined=false;},
    h=>{delete h.functions[0].body[1].value.presenceFlow;},
    h=>{h.functions[0].body[1].value.presenceFlow.undefined=true;},
    h=>{h.contractVersion="0.9.0";},
    h=>{h.schemaHash="sha256:"+"0".repeat(64);},
  ]) {
    const copy=structuredClone(hir);mutate(copy);
    assert.throws(()=>verifyHir(copy));assert.throws(()=>printHir(copy));assert.throws(()=>lowerHir(copy));
  }
  assert.throws(()=>readHir(Buffer.from(" "+printHir(hir))),/canonical/);
  assert.throws(()=>readHir(Buffer.from([0xff])),/UTF-8/);
});

test("snapshot presence facts stay tied to the official binding and annotation",async()=>{
  const result=await analyzeFrontend(await sourceInput("export function entry(value?: i32): i32 { if (value === undefined) { return 8; } return value; }"),{executable:frontend().frontend});
  assert.equal(result.status,"ok",JSON.stringify(result));validateFrontendSnapshot(result.snapshot);
  for(const mutate of [
    s=>{s.functions[0].parameters[0].presence.null=true;},
    s=>{s.functions[0].body[0].condition.left.presenceFlow.null=true;},
    s=>{delete s.functions[0].body[1].expression.presenceFlow;},
    s=>{s.functions[0].body[0].condition.left.symbol.snapshotId="sha256:"+"0".repeat(64);},
  ]) { const copy=structuredClone(result.snapshot);mutate(copy);assert.throws(()=>validateFrontendSnapshot(copy)); }
});

test("default absence must belong to the declared annotation even after rehashing",async()=>{
  const hir=structuredClone(await checked("export function entry(value: i32 = 123456789): i32 { return 3; }"));
  hir.source.content=hir.source.content.replace("123456789","undefined");
  hir.source.hash=sha256(hir.source.content);
  hir.inputScope.files.find(file=>file.path===hir.source.path).content=hir.source.content;
  hir.inputIdentity=sha256(canonical(hir.inputScope));
  const prior=hir.functions[0].parameterInitializers[0];
  hir.functions[0].parameterInitializers[0]={kind:"absence",type:prior.type,range:prior.range,absence:"undefined"};
  assert.throws(()=>verifyHir(hir));assert.throws(()=>printHir(hir));assert.throws(()=>lowerHir(hir));
});

test("assignment targets validate their finite official flow without reading a payload",async()=>{
  const hir=await checked("export function entry(): i32 { let value: i32 | undefined = undefined; value = 4; return value; }");
  for(const mutate of [flow=>{flow.null=true;},flow=>{flow.undefined=37;},flow=>{flow.extra=false;}]) {
    const copy=structuredClone(hir);mutate(copy.functions[0].body[1].target.presenceFlow);
    assert.throws(()=>verifyHir(copy));assert.throws(()=>printHir(copy));assert.throws(()=>lowerHir(copy));
  }
});

test('grouped call builtin facts retain whole and leaf anchors at every cold seam',async()=>{
 const source='function choose(value: i32 | null = 7): i32 { if (value === null) { return 8; } return value; } export function entry(): i32 { return choose(((undefined))) + choose(((null))); }';
 const input=await sourceInput(source),result=await analyzeFrontend(input,{executable:frontend().frontend});
 assert.equal(result.status,'ok',JSON.stringify(result));validateFrontendSnapshot(result.snapshot);
 const argument=s=>s.functions[1].body[0].expression.left.arguments[0];
 const arg=argument(result.snapshot);assert.equal(source.slice(arg.range.start,arg.range.end),'((undefined))');
 assert.equal(source.slice(arg.operand.operand.range.start,arg.operand.operand.range.end),'undefined');
 for(const [index,mutate] of [
  a=>{a.range.start++;}, a=>{a.operand.operand.range={...a.range};}, a=>{a.operand.operand.absence='null';}, a=>{a.operand.type='bool';},
 ].entries()) {const copy=structuredClone(result.snapshot);mutate(argument(copy));assert.throws(()=>validateFrontendSnapshot(copy),`snapshot mutation ${index}`);}
 const projected=await compileHir(input,{frontend:frontend().frontend});assert.equal(projected.status,'ok',JSON.stringify(projected));
 const hir=projected.hir,text=printHir(hir);assert.equal(printHir(readHir(Buffer.from(text))),text);lowerHir(hir);
 const hirArgument=h=>h.functions[1].body[0].value.left.arguments[0];
 for(const [index,mutate] of [
  a=>{a.range.start++;}, a=>{a.operand.operand.range={...a.range};}, a=>{a.operand.operand.absence='null';}, a=>{a.operand.type='forged';},
 ].entries()) {const copy=structuredClone(hir);mutate(hirArgument(copy));for(const invoke of [()=>verifyHir(copy),()=>printHir(copy),()=>lowerHir(copy),()=>readHir(Buffer.from(canonical(copy)+'\n'))])assert.throws(invoke);}
});
test('grouped call arguments keep official incompatible member diagnostics',async()=>{
 for(const [parameter,argument,phase,code] of [['value: i32','(undefined)','syntax','r02b-d-type'],['value: i32 = 7','(null)','types','r01-d-scalar-type']]) {
  const source=`function choose(${parameter}): i32 { return value; } export function entry(): i32 { return choose(${argument}); }`;
  const result=await compileHir(await sourceInput(source),{frontend:frontend().frontend});assert.equal(result.status,'error');
  const diagnostic=result.diagnostics.find(d=>d.phase===phase&&d.code===code&&d.upstreamCode===2345);assert.ok(diagnostic,JSON.stringify(result));
  assert.equal(source.slice(diagnostic.primary.start,diagnostic.primary.end),argument.slice(1,-1));
 }
});

test("checked builtin undefined accepts identifier escapes and grouped trivia at every HIR seam",async()=>{
  for(const argument of [String.raw`\u0075ndefined`,String.raw`(\u0075ndefined)`,
    String.raw`( /* ) ( */ (\u{75}ndefined /* ) */ ) )`,"(\u2028/* ) ( */ undefined\u00a0/* ( ) */)"]) {
    const source=`function choose(value: i32 = 7): i32 { return value; } export function entry(): i32 { return choose(${argument}); }`;
    const hir=await checked(source),text=printHir(hir);assert.equal(printHir(readHir(Buffer.from(text))),text);lowerHir(hir);
  }
  const argument=String.raw`\u006eull`;
  const source=`function choose(value: i32 = 7): i32 { return value; } export function entry(): i32 { return choose(${argument}); }`;
  const rejected=await compileHir(await sourceInput(source),frontend());assert.equal(rejected.status,"error",JSON.stringify(rejected));
  const diagnostic=rejected.diagnostics.find(d=>d.phase==="syntax"&&d.upstreamCode===1260);assert.ok(diagnostic,JSON.stringify(rejected));
  assert.equal(source.slice(diagnostic.primary.start,diagnostic.primary.end),argument);
});

const coldSeams = hir => [()=>verifyHir(hir),()=>printHir(hir),()=>lowerHir(hir),()=>readHir(Buffer.from(canonical(hir)+"\n"))];
function newOperatorGroup(value) {
  if(!value || typeof value!=="object")return null;
  for(const [key,child] of Object.entries(value)) {
    if(child?.kind==="group" && ["write","presenceTest"].includes(child.operand.kind))return {parent:value,key,group:child};
    const found=newOperatorGroup(child);if(found)return found;
  }
  return null;
}
function replaceOwnedSource(hir, source) {
  hir.source.content=source;hir.source.hash=sha256(source);
  hir.inputScope.files.find(file=>file.path===hir.source.path).content=source;
  hir.inputIdentity=sha256(canonical(hir.inputScope));
}

test("new expression precedence rejects normally rehashed group removal at every cold seam",async()=>{
  for(const source of [
    "export function entry(): i32 { let x: i32 = 2; let y: i32 = 3; return x + (y = 5); }",
    "export function entry(): i32 { let x: i32 = 2; return -(x = 5); }",
    "export function entry(): bool { let x: bool = true; let y: bool = true; return x && (y = false); }",
    "export function entry(value?: bool): bool { return !(value === undefined); }",
    "export function entry(value?: bool): bool { let flag: bool = true; return flag === (value === undefined); }",
  ]) {
    const hir=await checked(source);for(const invoke of coldSeams(hir))invoke();
    const copy=structuredClone(hir),location=newOperatorGroup(copy);assert.ok(location);
    const {parent,key,group}=location,spelling=source.slice(group.range.start,group.range.end);
    const open=spelling.indexOf("("),close=spelling.lastIndexOf(")");assert.ok(open>=0 && close>open);
    const chars=source.split("");chars[group.range.start+open]=" ";chars[group.range.start+close]=" ";
    const forged=chars.join("");assert.equal(forged.length,source.length);parent[key]=group.operand;
    replaceOwnedSource(copy,forged);
    const official=await compileHir(await sourceInput(forged),frontend());assert.equal(official.status,"error");
    assert.ok(official.diagnostics.some(d=>d.phase===(group.operand.kind==="write"?"syntax":"types")));
    for(const invoke of coldSeams(copy))assert.throws(invoke);
  }
});

test("assignment associativity and equality presence precedence retain legal source trees",async()=>{
  for(const source of [
    "export function entry(): i32 { let x: i32 = 0; let y: i32 = 0; return x = y = 5; }",
    "export function entry(): i32 { let x: i32 = 1; let y: i32 = 2; return x += y += 5; }",
    "export function entry(): i32 { let x: i32 = 2; let y: i32 = 3; return x + -y * 2; }",
    "export function entry(): i32 { let x: i32 = 2; let y: i32 = 3; return x - y - 5; }",
    "export function entry(): bool { let x: bool = true; let y: bool = false; return x || y && x; }",
    "export function entry(value?: bool): bool { let flag: bool = true; return value === undefined === flag; }",
  ]) {
    const hir=await checked(source),text=printHir(hir);
    assert.equal(printHir(readHir(Buffer.from(text))),text);lowerHir(hir);
  }
});

test("finite annotations preserve legal grouping, repeated members and nominal identifier spelling",async()=>{
  for(const parameter of ["value: (i32 | undefined) = 7","value?: ((i32))",
    "value: ((i32) | (undefined | null)) = 7","value: i32 | undefined | undefined",
    "value: (/* outside ) */ i32 | /* ( */ undefined)",String.raw`value: (\u006932 | undefined)`]) {
    const source=`export function entry(${parameter}): i32 { if (value === undefined) { return 8; } if (value === null) { return 9; } return value; }`;
    const hir=await checked(source),text=printHir(hir);
    assert.equal(printHir(readHir(Buffer.from(text))),text);lowerHir(hir);
  }
  const hir=await checked("export function entry(): i32 { let value: ((i32) | (null | undefined)) = null; value ??= 7; return value; }");
  const text=printHir(hir);assert.equal(printHir(readHir(Buffer.from(text))),text);lowerHir(hir);
});

test("cold finite annotation guards retain token boundaries, payloads and union grammar",async()=>{
  const source="export function entry(value: i32    | undefined     | null    ): i32 { if (value === undefined) { return 8; } if (value === null) { return 9; } return value; }";
  const hir=await checked(source);
  /** @type {Array<[string, string, number]>} */
  const mutations=[["i32    ","i/**/32",0],["undefined     ","unde/**/fined ",0],
    ["null    ","nu/**/ll",4],["| undefined","||undefined",0],["i32","u32",0],
    ["undefined     ",String.raw`\u0075ndefined`,0]];
  for(const [from,to,extend] of mutations) {
    assert.equal(from.length,to.length);const copy=structuredClone(hir);
    replaceOwnedSource(copy,source.replace(from,to));
    if(extend){copy.functions[0].parameters[0].presence.annotation.end+=extend;copy.functions[0].parameters[0].presence.range.end+=extend;}
    for(const invoke of coldSeams(copy))assert.throws(invoke);
  }
  for(const keyword of [String.raw`\u0075ndefined`,String.raw`\u006eull`,String.raw`\u0062oolean`,String.raw`\u006eumber`]) {
    const result=await compileHir(await sourceInput(`export function entry(value: (${keyword})): i32 { return 7; }`),frontend());
    assert.equal(result.status,"error");assert.ok(result.diagnostics.some(d=>d.phase==="syntax"&&d.upstreamCode===1260));
  }
});

test("null source guards accept surrounding trivia and reject split keywords at every cold seam",async()=>{
  for(const argument of ["null","/* outside ( ) */ null","null /* outside ( ) */","// outside ) (\nnull","( /* outside */ null )","\u2028/* outside */ null\u00a0"]) {
    const hir=await checked(`function choose(value: i32 | null): i32 { if (value === null) { return 8; } return value; } export function entry(): i32 { return choose(${argument}); }`);
    const text=printHir(hir);assert.equal(printHir(readHir(Buffer.from(text))),text);lowerHir(hir);
  }
  const source="export function entry(value: i32 | null = null    ): i32 { if (value === null) { return 8; } return value; }";
  const hir=await checked(source),initializer=hir.functions[0].parameterInitializers[0];
  const copy=structuredClone(hir),start=initializer.range.end-4;
  replaceOwnedSource(copy,source.slice(0,start)+"nu/**/ll"+source.slice(start+8));
  copy.functions[0].parameterInitializers[0].range.end+=4;copy.functions[0].parameters[0].presence.range.end+=4;
  for(const invoke of coldSeams(copy))assert.throws(invoke);
});

test("cold updates require continuous operators and the official postfix line boundary",async()=>{
  for(const operator of ["++","--"])for(const prefix of [true,false]) {
    const expression=prefix?`${operator}    value`:`value${operator}    `;
    const source=`export function entry(): i32 { let value: i32 = 1; ${expression}; return value; }`;
    const hir=await checked(source),copy=structuredClone(hir);
    replaceOwnedSource(copy,source.replace(`${operator}    `,`${operator[0]}/**/${operator[1]}`));
    if(!prefix)copy.functions[0].body[1].value.range.end+=4;
    for(const invoke of coldSeams(copy))assert.throws(invoke);
    const control=source.replace(expression,prefix?`${operator} /* outside */ value`:`value /* outside */ ${operator}`);
    const legal=await checked(control),text=printHir(legal);assert.equal(printHir(readHir(Buffer.from(text))),text);lowerHir(legal);
  }
  const source="export function entry(): i32 { let value: i32 = 1; value    ++; return value; }",hir=await checked(source);
  for(const newline of ["\n","\r","\u2028","\u2029"]) {
    const copy=structuredClone(hir);replaceOwnedSource(copy,source.replace("value    ++",`value${newline}   ++`));
    for(const invoke of coldSeams(copy))assert.throws(invoke);
  }
  const invalid=await compileHir(await sourceInput(source.replace("value    ++","value\n   ++")),frontend());
  assert.equal(invalid.status,"error");assert.ok(invalid.diagnostics.some(d=>d.phase==="syntax"&&d.upstreamCode===1109));
  const prefix=await checked(source.replace("value    ++","++\nvalue"));
  const text=printHir(prefix);assert.equal(printHir(readHir(Buffer.from(text))),text);lowerHir(prefix);
});
