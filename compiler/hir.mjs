// SPDX-License-Identifier: MIT
import { validateFrontendSnapshot, resolveType, resolveSymbol, identifierName } from "./frontend.mjs";
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
// The checked scalar subset inherits TS precedence; every binary operator here
// associates left. Parentheses are explicit group nodes, not inferred anchors.
const precedence = { "|": 1, "^": 2, "&": 3, "===": 4, "!==": 4,
  "<": 5, "<=": 5, ">": 5, ">=": 5, "<<": 6, ">>": 6, ">>>": 6,
  "+": 7, "-": 7, "*": 8, "/": 8, "%": 8 };
const sourceTokens = (source, start, end) => source.slice(start, end)
  .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, "").replace(/\s/g, "");
function identifierToken(source, anchor) {
  // This owned token guard preserves internal spelling. Only surrounding
  // trivia is removed; a split token cannot manufacture a checked identifier.
  try { return identifierName(source.slice(anchor.start, anchor.end)); }
  catch { return undefined; }
}
function bindingFact(binding, parent, source) {
  return exactKeys(binding, ["id", "name", "type", "writable", "range"])
    && validText(binding.name) && Object.values(types).includes(binding.type)
    && typeof binding.writable === "boolean" && range(binding.range, parent)
    && identifierToken(source, binding.range) === binding.name;
}
function scalarOperator(source, start, end, operator) {
  const spelling = source.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, comment => " ".repeat(comment.length));
  if (spelling.trim() !== operator) return false;
  const position = start + spelling.search(/\S/);
  // TS scans adjacent ++/-- as one token. Trivia may separate scalar signs;
  // persisted HIR must not reinterpret an unsupported update expression.
  return !["+", "-"].includes(operator)
    || (source[position - 1] !== operator && source[position + 1] !== operator);
}
function verifyExpression(value, parent, source, fail, budget, locals) {
  if (--budget.remaining < 0 || !value || !Object.values(types).includes(value.type)
      || !range(value.range, parent)) fail();
  if (value.kind === "reference") {
    const local = locals.get(value.binding);
    if (!exactKeys(value, ["kind", "type", "binding", "range"])) fail();
    const declaration = budget.declarations.get(value.binding);
    const claimed = local ?? declaration;
    if (!claimed || claimed.type !== value.type || identifierToken(source, value.range) !== claimed.name) fail();
    if (!local) {
      const error = new TypeError("r03-hir-dominance: local read has no preceding declaration");
      Object.assign(error, { code: "r03-hir-dominance", ruleId: "r01-evaluation", phase: "hir",
        primary: { sourceId: budget.sourcePath, ...value.range } });
      throw error;
    }
    if (local && !local.initialized) {
      const error = new TypeError("r03-hir-uninitialized: local read has no preceding initialization");
      Object.assign(error, { code: "r03-hir-uninitialized", ruleId: "r01-evaluation", phase: "hir",
        primary: { sourceId: budget.sourcePath, ...value.range } });
      throw error;
    }
  } else if (value.kind === "constant") {
    if (!exactKeys(value, ["kind", "type", "decimal", "token", "range"])
        || value.type !== i32TypeId || typeof value.decimal !== "string"
        || !/^(?:0|-?[1-9][0-9]*)$/.test(value.decimal) || typeof value.token !== "string") fail();
    let integer;
    try { integer = (value.token.startsWith("-") ? -1n : 1n)
      * BigInt(value.token.replace(/^-/, "").replaceAll("_", "")); } catch { fail(); }
    const anchored = sourceTokens(source, value.range.start, value.range.end);
    if (integer.toString() !== value.decimal || integer < -2147483648n || integer > 2147483647n
        || anchored !== value.token) fail();
  } else if (value.kind === "boolean") {
    if (!exactKeys(value, ["kind", "type", "value", "range"]) || value.type !== boolTypeId
        || typeof value.value !== "boolean" || sourceTokens(source, value.range.start, value.range.end) !== String(value.value)) fail();
  } else if (value.kind === "group" || value.kind === "unary") {
    const group = value.kind === "group";
    if (!exactKeys(value, group ? ["kind", "type", "operand", "range"] : ["kind", "type", "operator", "operand", "range"])) fail();
    verifyExpression(value.operand, value.range, source, fail, budget, locals);
    if (!(group ? sourceTokens(source, value.range.start, value.operand.range.start) === "("
        : scalarOperator(source, value.range.start, value.operand.range.start, value.operator))
        || sourceTokens(source, value.operand.range.end, value.range.end) !== (group ? ")" : "")
        || value.type !== value.operand.type || (!group && (value.operand.kind === "binary"
        || !["+", "-", "~", "!"].includes(value.operator)
        || value.type !== (value.operator === "!" ? boolTypeId : i32TypeId)))) fail();
  } else if (value.kind === "binary") {
    if (!exactKeys(value, ["kind", "type", "operator", "left", "right", "range"])
        || !Object.hasOwn(operations, value.operator)) fail();
    verifyExpression(value.left, value.range, source, fail, budget, locals);
    verifyExpression(value.right, value.range, source, fail, budget, locals);
    if (value.left.type !== value.right.type || value.left.range.end > value.right.range.start
        || (value.left.kind === "binary" && precedence[value.left.operator] < precedence[value.operator])
        || (value.right.kind === "binary" && precedence[value.right.operator] <= precedence[value.operator])
        || sourceTokens(source, value.range.start, value.left.range.start) !== ""
        || !scalarOperator(source, value.left.range.end, value.right.range.start, value.operator)
        || sourceTokens(source, value.right.range.end, value.range.end) !== ""
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
  const locals = new Map(), names = new Set(), source = hir.source.content;
  // Future declaration facts only identify a source-anchored forward read;
  // they never authorize a reference or populate the sequential local state.
  const declarations = new Map();
  let declarationIndex = 0;
  for (const statement of fn.body) {
    if (statement?.kind !== "local") continue;
    const binding = statement.binding;
    if (range(statement.range, fn.range) && bindingFact(binding, statement.range, source)
        && binding.id === `l${declarationIndex}`)
      declarations.set(binding.id, binding);
    declarationIndex++;
  }
  const budget = { remaining: 4096, sourcePath: hir.source.path, declarations };
  let previousEnd = fn.range.start, hasReturn = false, declarationKind;
  for (const [index, statement] of fn.body.entries()) {
    if (!range(statement?.range, fn.range) || statement.range.start < previousEnd) fail();
    let before = sourceTokens(source, previousEnd, statement.range.start);
    // Braces in a checked Unicode identifier escape are part of the header;
    // only the unescaped opening brace begins the complete return sequence.
    if (index === 0) {
      const header = before.match(/^(?:[^{}]|\\u\{[0-9a-fA-F]+\})*\{(const|let)?$/);
      if (!header) fail();
      before = header[1] ?? "";
    }
    if (statement.kind === "local") {
      const binding = statement.binding, value = statement.initializer;
      if (!exactKeys(statement, ["kind", "range", "binding", "initializer"])
          || !bindingFact(binding, statement.range, source)
          || binding.id !== `l${locals.size}` || names.has(binding.name)
          || sourceTokens(source, statement.range.start, binding.range.start) !== "") fail();
      const keyword = before.match(/^;?(const|let)$/)?.[1];
      if (keyword) declarationKind = keyword;
      else if (before !== "," || !declarationKind) fail();
      if (binding.writable !== (declarationKind === "let")) fail();
      const annotations = binding.type === boolTypeId ? [":bool", ":boolean"] : [":i32"];
      if (value !== null) {
        verifyExpression(value, statement.range, source, fail, budget, locals);
        const annotation = sourceTokens(source, binding.range.end, value.range.start);
        if (value.type !== binding.type || !["=", ...annotations.map(item => `${item}=`)].includes(annotation)
            || sourceTokens(source, value.range.end, statement.range.end) !== "") fail();
      } else if (!binding.writable || !annotations.includes(sourceTokens(source, binding.range.end, statement.range.end))) fail();
      locals.set(binding.id, { ...binding, initialized: value !== null });
      names.add(binding.name);
    } else {
      declarationKind = undefined;
      if (!/^;?$/.test(before)) fail();
      const value = statement.value;
      if (statement.kind === "return") {
        if (!exactKeys(statement, ["kind", "range", "value"]) || value?.type !== fn.returnType.id
            || sourceTokens(source, statement.range.start, value.range.start) !== "return") fail();
        hasReturn = true;
      } else if (statement.kind === "assign") {
        const target = statement.target, local = locals.get(target?.binding);
        if (!exactKeys(statement, ["kind", "range", "target", "value"])
            || !exactKeys(target, ["kind", "type", "binding", "range"]) || target.kind !== "reference"
            || !local?.writable || target.type !== local.type || value?.type !== local.type
            || !range(target.range, statement.range) || target.range.end > value.range.start
            || identifierToken(source, target.range) !== local.name
            || sourceTokens(source, statement.range.start, target.range.start) !== ""
            || sourceTokens(source, target.range.end, value.range.start) !== "=") fail();
      } else fail();
      verifyExpression(value, statement.range, source, fail, budget, locals);
      if (!/^;?$/.test(sourceTokens(source, value.range.end, statement.range.end))) fail();
      if (statement.kind === "assign") locals.get(statement.target.binding).initialized = true;
    }
    previousEnd = statement.range.end;
  }
  if (!hasReturn || !/^;?\}$/.test(sourceTokens(source, previousEnd, fn.range.end))) fail();
  return own(hir);
}

export function buildHir(snapshot) {
  try { validateFrontendSnapshot(snapshot); }
  catch (error) { return { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message }] }; }
  const fn = snapshot.functions[0], expression = fn?.body?.find(item => item.expression)?.expression;
  if (snapshot.functions.length !== 1 || fn?.parameters?.length !== 0
      || !Object.hasOwn(types, resolveType(snapshot, fn.returnTypeRef).scalar)
      || fn.body.length < 1 || fn.body.length > 128 || fn.body.some(item => !["return", "variable", "assignment"].includes(item.kind))
      || !expression) {
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir",
      message: "current execution capability requires one zero-parameter i32/bool function with linear scalar locals, assignments and returns",
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? fn?.range ?? { start: 0, end: 0 }) } }] };
  }
  const bindings = new Map();
  const project = value => {
    const type = types[resolveType(snapshot, value.typeRef).scalar];
    if (!type) throw new TypeError("unsupported expression type");
    const common = { type, range: value.range };
    if (value.kind === "reference") {
      const symbol = resolveSymbol(snapshot, value.symbol), binding = bindings.get(symbol.id);
      if (!binding) throw new TypeError("local reference has no preceding owned declaration");
      return { kind: "reference", ...common, binding: binding.id };
    }
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
  try { projected = fn.body.map(item => {
    if (item.kind === "variable") {
      const symbol = resolveSymbol(snapshot, item.symbol.ref), type = types[symbol.type];
      if (symbol.kind !== "local" || !type) throw new TypeError("unsupported local type");
      const initializer = item.initializer ? project(item.initializer) : null;
      const binding = { id: `l${bindings.size}`, name: symbol.name, type, writable: symbol.writable, range: symbol.range };
      bindings.set(symbol.id, binding);
      return { kind: "local", range: item.range, binding, initializer };
    }
    if (item.kind === "assignment") return { kind: "assign", range: item.range, target: project(item.target), value: project(item.value) };
    return { kind: "return", range: item.range, value: project(item.expression) };
  }); } catch (error) {
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
  // Binding updates select new SSA definitions; each initializer/RHS is emitted
  // once in statement order. Reads reuse that definition, never reevaluate it.
  const verified = verifyHir(hir), fn = verified.functions[0];
  const quote = text => JSON.stringify(text).replace(/\\u([0-9a-f]{4})/g, (_, hex) => {
    const code = Number.parseInt(hex, 16);
    return code < 128 ? `\\${hex.slice(2)}` : String.fromCharCode(code);
  });
  const strings = { input_identity: verified.inputIdentity, source_hash: verified.source.hash,
    function_id: fn.id, signature_hash: fn.signatureHash, type_id: fn.returnType.id,
    source_path: verified.source.path, function_name: fn.name,
    target: verified.target.target, triple: verified.target.triple, data_layout: verified.target.llvmDataLayout,
    bytecode_schema: registry["tsfg.bytecode"].schemaHash };
  const attrs = ['tsfg_core.version = "0.3.0"', ...Object.entries(strings)
    .map(([key, item]) => `tsfg_core.${key} = ${quote(item)}`),
    `tsfg_core.source_length = ${verified.source.content.length} : i64`,
    `tsfg_core.function_start = ${fn.range.start} : i64`, `tsfg_core.function_end = ${fn.range.end} : i64`];
  const instructions = [], definitions = new Map();
  const coreType = type => type === i32TypeId ? "i32" : "i1";
  const emit = expression => {
    if (expression.kind === "reference") return definitions.get(expression.binding);
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
  let result, returned;
  for (const statement of fn.body) {
    if (statement.kind === "local") {
      if (statement.initializer) definitions.set(statement.binding.id, emit(statement.initializer));
    } else if (statement.kind === "assign") definitions.set(statement.target.binding, emit(statement.value));
    else { result = emit(statement.value); returned = statement; break; }
  }
  const type = coreType(fn.returnType.id);
  return `module attributes {${attrs.join(", ")}} {\n  func.func @${quote(fn.name)}() -> ${type} {\n`
    + `${instructions.join("\n")}\n    "func.return"(${result}) {tsfg_source.start = ${returned.range.start} : i64, tsfg_source.end = ${returned.range.end} : i64} : (${type}) -> ()\n  }\n}\n`;
}
