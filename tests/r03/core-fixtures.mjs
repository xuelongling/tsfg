// SPDX-License-Identifier: MIT
// Complete public Core exchange fixtures; scalar expectations remain authored
// literal/structural oracles, never copied from execution output.
import { functionIdentity, signatureHash, i32TypeId, boolTypeId, sha256 } from "../../compiler/identity.mjs";
import registry from "../../contracts/registry.json" with { type: "json" };
import schema from "../../contracts/bytecode.schema.json" with { type: "json" };
export const sourceAttributes = "tsfg_source.start = 0 : i64, tsfg_source.end = 42 : i64";
export function coreTestModule(body, type = "i32", name = "sample") {
  const scalar = type === "i32" ? "i32" : "bool";
  const fields = { version: "0.5.0", input_identity: sha256("public Core fixture"), source_hash: sha256("export function sample(): i32 { return 42; }"),
    source_path: "/src/main.ts", target: schema.target.target, triple: schema.target.triple,
    data_layout: schema.target.llvmDataLayout, bytecode_schema: registry["tsfg.bytecode"].schemaHash };
  const attrs = Object.entries(fields).map(([key, value]) => `tsfg_core.${key} = ${JSON.stringify(value)}`);
  attrs.push("tsfg_core.source_length = 42 : i64");
  const functionFields = { function_id: functionIdentity("/src/main.ts", name, scalar), signature_hash: signatureHash(scalar), type_id: scalar === "i32" ? i32TypeId : boolTypeId };
  const functionAttrs = Object.entries(functionFields).map(([key, value]) => `tsfg_core.${key} = ${JSON.stringify(value)}`);
  functionAttrs.push("tsfg_core.function_start = 0 : i64", "tsfg_core.function_end = 42 : i64");
  return `module attributes {${attrs.join(", ")}} {\nfunc.func @${name}() -> ${type} attributes {${functionAttrs.join(", ")}} {\n"tsfg_core.fuel"() {event = 1 : i32, ${sourceAttributes}} : () -> ()\n${body}\n}\n}\n`;
}
