// SPDX-License-Identifier: MIT
import { validateFrontendSnapshot, resolveType } from "./frontend.mjs";
import { canonical, functionIdentity, signatureHash, i32TypeId, boolTypeId, own, sha256 } from "./identity.mjs";
import registry from "../contracts/registry.json" with { type: "json" };
import bytecodeSchema from "../contracts/bytecode.schema.json" with { type: "json" };

const contract = () => registry["tsfg.hir"];
const exactKeys = (value, keys) => value && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const hash = value => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const types = { i32: i32TypeId, bool: boolTypeId };
const operations = { "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "rem",
  "<<": "shl", ">>": "shr", ">>>": "ushr", "&": "and", "|": "or", "^": "xor",
  "===": "eq", "!==": "ne", "<": "lt", "<=": "le", ">": "gt", ">=": "ge" };
const comparisons = new Set(["===", "!==", "<", "<=", ">", ">="]);
function verifyExpression(value, parent, source, fail, budget) {
  if (--budget.remaining < 0 || !value || !Object.values(types).includes(value.type)
      || !range(value.range, parent)) fail();
  if (value.kind === "constant") {
    if (!exactKeys(value, ["kind", "type", "decimal", "token", "range"])
        || value.type !== i32TypeId || typeof value.decimal !== "string"
        || !/^(?:0|-?[1-9][0-9]*)$/.test(value.decimal) || typeof value.token !== "string") fail();
    let integer;
    try { integer = (value.token.startsWith("-") ? -1n : 1n)
      * BigInt(value.token.replace(/^-/, "").replaceAll("_", "")); } catch { fail(); }
    const anchored = source.slice(value.range.start, value.range.end)
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, "").replace(/\s/g, "");
    if (integer.toString() !== value.decimal || integer < -2147483648n || integer > 2147483647n
        || anchored !== value.token) fail();
  } else if (value.kind === "boolean") {
    if (!exactKeys(value, ["kind", "type", "value", "range"]) || value.type !== boolTypeId
        || typeof value.value !== "boolean" || source.slice(value.range.start, value.range.end).trim() !== String(value.value)) fail();
  } else if (value.kind === "group" || value.kind === "unary") {
    const group = value.kind === "group";
    if (!exactKeys(value, group ? ["kind", "type", "operand", "range"] : ["kind", "type", "operator", "operand", "range"])) fail();
    verifyExpression(value.operand, value.range, source, fail, budget);
    if (value.type !== value.operand.type || (!group && (!["+", "-", "~", "!"].includes(value.operator)
        || value.type !== (value.operator === "!" ? boolTypeId : i32TypeId)))) fail();
  } else if (value.kind === "binary") {
    if (!exactKeys(value, ["kind", "type", "operator", "left", "right", "range"])
        || !Object.hasOwn(operations, value.operator)) fail();
    verifyExpression(value.left, value.range, source, fail, budget);
    verifyExpression(value.right, value.range, source, fail, budget);
    if (value.left.type !== value.right.type || value.left.range.end > value.right.range.start
        || value.type !== (comparisons.has(value.operator) ? boolTypeId : i32TypeId)
        || (!["===", "!=="].includes(value.operator) && value.left.type !== i32TypeId)) fail();
  } else fail();
}
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
      || /[\\:]/.test(hir.source.path)
      || hir.source.path.slice(1).split("/").some(part => !part || part === "." || part === "..")
      || typeof hir.source.content !== "string" || hir.source.content.length > 0xffffffff
      || !hir.source.content.isWellFormed()
      || hir.source.hash !== sha256(hir.source.content)
      || !Array.isArray(hir.functions) || hir.functions.length !== 1) fail();
  const fn = hir.functions[0];
  if (!exactKeys(fn, ["id", "name", "signatureHash", "returnType", "parameters", "range", "body"])
      || !validText(fn.name) || !Object.hasOwn(types, fn.returnType?.name)
      || fn.id !== functionIdentity(hir.source.path, fn.name, fn.returnType.name)
      || fn.signatureHash !== signatureHash(fn.returnType.name)
      || canonical(fn.returnType) !== canonical({ kind: "scalar", name: fn.returnType.name, id: types[fn.returnType.name] })
      || !Array.isArray(fn.parameters) || fn.parameters.length !== 0
      || !range(fn.range, { start: 0, end: hir.source.content.length })
      || !Array.isArray(fn.body) || fn.body.length < 1 || fn.body.length > 128) fail();
  const budget = { remaining: 4096 };
  let previousEnd = fn.range.start;
  for (const returned of fn.body) {
    const value = returned?.value;
    if (!exactKeys(returned, ["kind", "range", "value"]) || returned.kind !== "return"
        || !range(returned.range, fn.range) || returned.range.start < previousEnd
        || value?.type !== fn.returnType.id) fail();
    verifyExpression(value, returned.range, hir.source.content, fail, budget);
    previousEnd = returned.range.end;
  }
  return own(hir);
}

export function buildHir(snapshot) {
  try { validateFrontendSnapshot(snapshot); }
  catch (error) { return { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message }] }; }
  const fn = snapshot.functions[0], returned = fn?.body?.[0], expression = returned?.expression;
  if (snapshot.functions.length !== 1 || fn?.parameters?.length !== 0
      || !Object.hasOwn(types, resolveType(snapshot, fn.returnTypeRef).scalar)
      || fn.body.length < 1 || fn.body.length > 128 || fn.body.some(item => item.kind !== "return" || !item.expression)
      || !expression) {
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir",
      message: "current execution capability requires one zero-parameter i32/bool function containing only scalar returns",
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? fn?.range ?? { start: 0, end: 0 }) } }] };
  }
  const project = value => {
    const type = types[resolveType(snapshot, value.typeRef).scalar];
    if (!type) throw new TypeError("unsupported expression type");
    const common = { type, range: value.range };
    if (value.kind === "integer") return { kind: "constant", ...common, decimal: value.literal.decimal, token: value.literal.token };
    if (value.kind === "boolean") return { kind: "boolean", ...common, value: value.boolean };
    if (value.kind === "group") return { kind: "group", ...common, operand: project(value.operand) };
    if (value.kind === "unary" && ["+", "-", "~", "!"].includes(value.operator))
      return { kind: "unary", ...common, operator: value.operator, operand: project(value.operand) };
    if (value.kind === "binary" && Object.hasOwn(operations, value.operator))
      return { kind: "binary", ...common, operator: value.operator, left: project(value.left), right: project(value.right) };
    throw new TypeError("unsupported checked expression capability");
  };
  let projected;
  try { projected = fn.body.map(item => ({ kind: "return", range: item.range, value: project(item.expression) })); } catch (error) {
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir", message: error.message,
      primary: { sourceId: snapshot.source.path, ...expression.range } }] };
  }
  const returnType = resolveType(snapshot, fn.returnTypeRef).scalar;
  const hir = {
    contractVersion: contract().semver, schemaHash: contract().schemaHash, inputIdentity: snapshot.inputIdentity,
    source: { ...snapshot.source, hash: sha256(snapshot.source.content) }, target: bytecodeSchema.target,
    functions: [{ id: functionIdentity(snapshot.source.path, fn.name, returnType), name: fn.name,
      signatureHash: signatureHash(returnType), returnType: { kind: "scalar", name: returnType, id: types[returnType] },
      parameters: [], range: fn.range, body: projected }],
  };
  try { return { status: "ok", hir: verifyHir(hir) }; }
  catch (error) { return { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message,
    primary: { sourceId: snapshot.source.path, ...expression.range } }] }; }
}
export const printHir = hir => `${canonical(verifyHir(hir))}\n`;
export function readHir(bytes) {
  let text, value;
  try {
    // Preserve a leading BOM so JSON rejects its noncanonical wire bytes.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError("r03-hir-invalid: HIR must contain valid UTF-8 JSON", { cause: error });
  }
  const hir = verifyHir(value);
  if (text !== printHir(hir)) throw new TypeError("r03-hir-canonical: HIR must use its canonical serialization");
  return hir;
}

export function lowerHir(hir) {
  // Only the first return is reached. Later checked returns stay owned in HIR;
  // no CFG, speculation or compile-time evaluation is introduced here.
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
  const attrs = ['tsfg_core.version = "0.2.0"', ...Object.entries(strings)
    .map(([key, item]) => `tsfg_core.${key} = ${quote(item)}`),
    `tsfg_core.source_length = ${verified.source.content.length} : i64`,
    `tsfg_core.function_start = ${fn.range.start} : i64`, `tsfg_core.function_end = ${fn.range.end} : i64`];
  const instructions = [];
  const coreType = type => type === i32TypeId ? "i32" : "i1";
  const emit = expression => {
    if (expression.kind === "group" || (expression.kind === "unary" && expression.operator === "+")) return emit(expression.operand);
    const operands = expression.kind === "binary" ? [emit(expression.left), emit(expression.right)]
      : expression.kind === "unary" ? [emit(expression.operand)] : [];
    const name = `%v${instructions.length}`, type = coreType(expression.type);
    const constant = ["constant", "boolean"].includes(expression.kind);
    const op = constant ? "constant" : expression.kind === "binary" ? operations[expression.operator]
      : ({ "-": "neg", "~": "not", "!": "bool_not" })[expression.operator];
    const valueAttr = constant ? `value = ${expression.kind === "constant" ? expression.decimal : Number(expression.value)} : ${type}, ` : "";
    const operandTypes = expression.kind === "binary" ? [expression.left.type, expression.right.type]
      : expression.kind === "unary" ? [expression.operand.type] : [];
    instructions.push(`    ${name} = "tsfg_core.${op}"(${operands.join(", ")}) {${valueAttr}tsfg_source.start = ${expression.range.start} : i64, tsfg_source.end = ${expression.range.end} : i64} : (${operandTypes.map(coreType).join(", ")}) -> ${type}`);
    return name;
  };
  const result = emit(value), type = coreType(fn.returnType.id);
  return `module attributes {${attrs.join(", ")}} {\n  func.func @${quote(fn.name)}() -> ${type} {\n`
    + `${instructions.join("\n")}\n    "func.return"(${result}) {tsfg_source.start = ${returned.range.start} : i64, tsfg_source.end = ${returned.range.end} : i64} : (${type}) -> ()\n  }\n}\n`;
}
