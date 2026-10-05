// SPDX-License-Identifier: MIT
import { validateFrontendSnapshot, resolveType } from "./frontend.mjs";
import { canonical, functionIdentity, i32SignatureHash, i32TypeId, own, sha256 } from "./identity.mjs";
import registry from "../contracts/registry.json" with { type: "json" };
import bytecodeSchema from "../contracts/bytecode.schema.json" with { type: "json" };

const contract = () => registry["tsfg.hir"];
const exactKeys = (value, keys) => value && typeof value === "object"
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const hash = value => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const validText = value => typeof value === "string" && value.length > 0 && !value.includes("\0")
  && Buffer.byteLength(value) <= 4096 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
function range(value, parent) {
  return exactKeys(value, ["start", "end"]) && Number.isSafeInteger(value.start)
    && Number.isSafeInteger(value.end) && value.start >= parent.start
    && value.end <= parent.end && value.start < value.end;
}

export function verifyHir(hir) {
  const fail = () => { throw new TypeError("r03-hir-invalid: owned HIR identity, type, source or structure differs"); };
  if (!exactKeys(hir, ["contractVersion", "schemaHash", "inputIdentity", "source", "target", "functions"])
      || hir.contractVersion !== contract()?.semver || hir.schemaHash !== contract()?.schemaHash
      || !hash(hir.inputIdentity) || canonical(hir.target) !== canonical(bytecodeSchema.target)
      || !exactKeys(hir.source, ["path", "content", "hash"])
      || !validText(hir.source.path) || !hir.source.path.startsWith("/")
      || !hir.source.path.endsWith(".ts") || hir.source.path.endsWith(".d.ts")
      || typeof hir.source.content !== "string" || hir.source.content.length > 0xffffffff
      || hir.source.hash !== sha256(hir.source.content)
      || !Array.isArray(hir.functions) || hir.functions.length !== 1) fail();
  const fn = hir.functions[0];
  if (!exactKeys(fn, ["id", "name", "signatureHash", "returnType", "parameters", "range", "body"])
      || !validText(fn.name) || fn.id !== functionIdentity(hir.source.path, fn.name)
      || fn.signatureHash !== i32SignatureHash
      || canonical(fn.returnType) !== canonical({ kind: "scalar", name: "i32", id: i32TypeId })
      || !Array.isArray(fn.parameters) || fn.parameters.length !== 0
      || !range(fn.range, { start: 0, end: hir.source.content.length })
      || !Array.isArray(fn.body) || fn.body.length !== 1) fail();
  const returned = fn.body[0], value = returned?.value;
  if (!exactKeys(returned, ["kind", "range", "value"]) || returned.kind !== "return"
      || !range(returned.range, fn.range)
      || !exactKeys(value, ["kind", "type", "decimal", "token", "range"])
      || value.kind !== "constant" || value.type !== i32TypeId
      || !range(value.range, returned.range)
      || typeof value.decimal !== "string" || !/^(?:0|-?[1-9][0-9]*)$/.test(value.decimal)
      || typeof value.token !== "string") fail();
  let integer;
  try {
    const sign = value.token.startsWith("-") ? -1n : 1n;
    integer = sign * BigInt(value.token.replace(/^-/, "").replaceAll("_", ""));
  } catch { fail(); }
  // This only checks the owned integer token against its original anchor;
  // official parsing and typing have already run upstream.
  const anchored = hir.source.content.slice(value.range.start, value.range.end)
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, "").replace(/\s/g, "");
  if (integer.toString() !== value.decimal || integer < -2147483648n || integer > 2147483647n
      || anchored !== value.token) fail();
  return own(hir);
}

export function buildHir(snapshot) {
  try { validateFrontendSnapshot(snapshot); }
  catch (error) { return { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message }] }; }
  const fn = snapshot.functions[0], returned = fn?.body?.[0], expression = returned?.expression;
  if (snapshot.functions.length !== 1 || fn?.parameters?.length !== 0
      || resolveType(snapshot, fn.returnTypeRef).scalar !== "i32"
      || fn.body.length !== 1 || returned?.kind !== "return"
      || expression?.kind !== "integer" || resolveType(snapshot, expression.typeRef).scalar !== "i32") {
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir",
      message: "current execution capability requires one zero-parameter i32 constant-return function",
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? fn?.range ?? { start: 0, end: 0 }) } }] };
  }
  const hir = {
    contractVersion: contract().semver, schemaHash: contract().schemaHash, inputIdentity: snapshot.inputIdentity,
    source: { ...snapshot.source, hash: sha256(snapshot.source.content) }, target: bytecodeSchema.target,
    functions: [{ id: functionIdentity(snapshot.source.path, fn.name), name: fn.name,
      signatureHash: i32SignatureHash, returnType: { kind: "scalar", name: "i32", id: i32TypeId },
      parameters: [], range: fn.range, body: [{ kind: "return", range: returned.range,
        value: { kind: "constant", type: i32TypeId, decimal: expression.literal.decimal,
          token: expression.literal.token, range: expression.range } }] }],
  };
  try { return { status: "ok", hir: verifyHir(hir) }; }
  catch (error) { return { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message,
    primary: { sourceId: snapshot.source.path, ...expression.range } }] }; }
}
export const printHir = hir => `${canonical(verifyHir(hir))}\n`;
export function readHir(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const hir = verifyHir(JSON.parse(text));
  if (text !== printHir(hir)) throw new TypeError("r03-hir-canonical: HIR must use its canonical serialization");
  return hir;
}

export function lowerHir(hir) {
  const verified = verifyHir(hir), fn = verified.functions[0], returned = fn.body[0], value = returned.value;
  const quote = text => JSON.stringify(text).replace(/\\u([0-9a-f]{4})/g, (_, hex) => {
    const code = Number.parseInt(hex, 16);
    return code < 128 ? `\\${hex.slice(2)}` : String.fromCharCode(code);
  });
  const strings = { input_identity: verified.inputIdentity, source_hash: verified.source.hash,
    function_id: fn.id, signature_hash: fn.signatureHash, type_id: fn.returnType.id,
    source_path: verified.source.path, function_name: fn.name,
    target: verified.target.target, triple: verified.target.triple, data_layout: verified.target.llvmDataLayout,
    bytecode_schema: registry["tsfg.bytecode"].schemaHash };
  const attrs = ['tsfg_core.version = "0.1.0"', ...Object.entries(strings)
    .map(([key, item]) => `tsfg_core.${key} = ${quote(item)}`),
    `tsfg_core.source_length = ${verified.source.content.length} : i64`,
    `tsfg_core.function_start = ${fn.range.start} : i64`, `tsfg_core.function_end = ${fn.range.end} : i64`];
  return `module attributes {${attrs.join(", ")}} {\n  func.func @${quote(fn.name)}() -> i32 {\n`
    + `    %value = "tsfg_core.constant"() {value = ${value.decimal} : i32, tsfg_source.start = ${value.range.start} : i64, tsfg_source.end = ${value.range.end} : i64} : () -> i32\n`
    + `    "func.return"(%value) {tsfg_source.start = ${returned.range.start} : i64, tsfg_source.end = ${returned.range.end} : i64} : (i32) -> ()\n  }\n}\n`;
}
