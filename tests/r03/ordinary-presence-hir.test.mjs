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
