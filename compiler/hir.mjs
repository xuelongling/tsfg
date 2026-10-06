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
const precedence = { "||": -1, "&&": 0, "|": 1, "^": 2, "&": 3, "===": 4, "!==": 4,
  "<": 5, "<=": 5, ">": 5, ">=": 5, "<<": 6, ">>": 6, ">>>": 6,
  "+": 7, "-": 7, "*": 8, "/": 8, "%": 8 };
const sourceTokens = (source, start, end) => source.slice(start, end)
  .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, "").replace(/\s/g, "");
const sourceTrivia = (source, start, end) => source.slice(start, end)
  .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, comment => " ".repeat(comment.length));
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
function verifyExpression(value, parent, source, fail, budget, locals, visibleBindings) {
  if (--budget.remaining < 0 || !value || !Object.values(types).includes(value.type)
      || !range(value.range, parent)) fail();
  if (value.kind === "reference") {
    const local = locals.get(value.binding);
    if (!exactKeys(value, ["kind", "type", "binding", "range"])) fail();
    const declaration = budget.declarations.get(value.binding);
    const claimed = local ?? declaration;
    if (!claimed || claimed.type !== value.type || identifierToken(source, value.range) !== claimed.name
        || visibleBindings.get(claimed.name) !== value.binding) fail();
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
  } else if (value.kind === "call") {
    const target = budget.functions.get(value.target);
    if (!exactKeys(value, ["kind", "type", "range", "target", "signatureHash", "arguments"])
        || !target || target.signatureHash !== value.signatureHash || target.returnType.id !== value.type
        || visibleBindings.has(target.name) || !Array.isArray(value.arguments)
        || value.arguments.length !== target.parameters.length) fail();
    let previous = value.range.start;
    for (const [index, argument] of value.arguments.entries()) {
      verifyExpression(argument, value.range, source, fail, budget, locals, visibleBindings);
      const prefix = sourceTrivia(source, previous, argument.range.start).trim();
      if (argument.type !== target.parameters[index].type || argument.range.start < previous) fail();
      if (index === 0) {
        if (!prefix.endsWith("(") || identifierToken(prefix, {start:0,end:prefix.length-1}) !== target.name) fail();
      } else if (prefix !== ",") fail();
      previous = argument.range.end;
    }
    const tail = sourceTrivia(source, previous, value.range.end).trim();
    if (value.arguments.length ? !/^,?\s*\)$/.test(tail) : !/\(\s*\)$/.test(tail)
        || identifierToken(tail,{start:0,end:tail.lastIndexOf("(")}) !== target.name) fail();
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
    verifyExpression(value.operand, value.range, source, fail, budget, locals, visibleBindings);
    if (!(group ? sourceTokens(source, value.range.start, value.operand.range.start) === "("
        : scalarOperator(source, value.range.start, value.operand.range.start, value.operator))
        || sourceTokens(source, value.operand.range.end, value.range.end) !== (group ? ")" : "")
        || value.type !== value.operand.type || (!group && (["binary", "shortCircuit"].includes(value.operand.kind)
        || !["+", "-", "~", "!"].includes(value.operator)
        || value.type !== (value.operator === "!" ? boolTypeId : i32TypeId)))) fail();
  } else if (value.kind === "binary" || value.kind === "shortCircuit") {
    const short = value.kind === "shortCircuit";
    if (!exactKeys(value, ["kind", "type", "operator", "left", "right", "range"])
        || !(short ? ["&&", "||"].includes(value.operator) : Object.hasOwn(operations, value.operator))) fail();
    verifyExpression(value.left, value.range, source, fail, budget, locals, visibleBindings);
    verifyExpression(value.right, value.range, source, fail, budget, locals, visibleBindings);
    if (value.left.type !== value.right.type || value.left.range.end > value.right.range.start
        || (["binary", "shortCircuit"].includes(value.left.kind) && precedence[value.left.operator] < precedence[value.operator])
        || (["binary", "shortCircuit"].includes(value.right.kind) && precedence[value.right.operator] <= precedence[value.operator])
        || sourceTokens(source, value.range.start, value.left.range.start) !== ""
        || !scalarOperator(source, value.left.range.end, value.right.range.start, value.operator)
        || sourceTokens(source, value.right.range.end, value.range.end) !== ""
        || value.type !== (short || comparisons.has(value.operator) ? boolTypeId : i32TypeId)
        || (short ? value.left.type !== boolTypeId : !["===", "!=="].includes(value.operator) && value.left.type !== i32TypeId)) fail();
  } else fail();
}
const validText = value => typeof value === "string" && value.length > 0 && !value.includes("\0")
  && Buffer.byteLength(value) <= 4096 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
function range(value, parent) {
  return exactKeys(value, ["start", "end"]) && Number.isSafeInteger(value.start)
    && Number.isSafeInteger(value.end) && value.start >= parent.start
    && value.end <= parent.end && value.start < value.end;
}

function noShortIf(statement) {
  // A verified braced block closes the dangling-else boundary. An unbraced
  // while or either tail of a matched if retains any unmatched inner if.
  if (statement.kind === "while") return noShortIf(statement.body[0]);
  if (statement.kind === "if") return statement.elseBody.length === 1
    && noShortIf(statement.thenBody[0]) && noShortIf(statement.elseBody[0]);
  return ["block", "return", "assign"].includes(statement.kind);
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
      || !Array.isArray(hir.functions) || hir.functions.length < 1 || hir.functions.length > 128) fail();
  const functions = new Map(), functionNames = new Set();
  let previousFunctionEnd = 0;
  for (const fn of hir.functions) {
    if (!validText(fn?.name) || functions.has(fn?.id) || functionNames.has(fn?.name)
        || !range(fn.range, { start: previousFunctionEnd, end: hir.source.content.length })) fail();
    previousFunctionEnd = fn.range.end;
    functions.set(fn.id, fn); functionNames.add(fn.name);
  }
  const parameterTypesByFunction = new Map();
  for (const fn of hir.functions) {
  if (!Array.isArray(fn.parameters)) fail();
  const parameterNames = fn.parameters.map(parameter => Object.entries(types).find(([,id]) => id === parameter?.type)?.[0]);
  if (!exactKeys(fn, ["id", "name", "signatureHash", "returnType", "parameters", "range", "body"])
      || !validText(fn.name) || !Object.hasOwn(types, fn.returnType?.name)
      || fn.id !== functionIdentity(hir.source.path, fn.name, fn.returnType.name, parameterNames)
      || fn.signatureHash !== signatureHash(fn.returnType.name, parameterNames)
      || canonical(fn.returnType) !== canonical({ kind: "scalar", name: fn.returnType.name, id: types[fn.returnType.name] })
      || !Array.isArray(fn.parameters) || fn.parameters.length > 64 || parameterNames.some(name => !name)
      || !range(fn.range, { start: 0, end: hir.source.content.length })
      || !Array.isArray(fn.body) || fn.body.length < 1 || fn.body.length > 128) fail();
  parameterTypesByFunction.set(fn.id, parameterNames);
  }
  // Resolve calls only after the complete table's identities and signatures
  // have been validated, including functions that are never executed.
  for (const fn of hir.functions) {
  const parameterNames = parameterTypesByFunction.get(fn.id);
  const source = hir.source.content, declarations = new Map(), ids = new Set();
  let declarationIndex = 0, remainingStatements = 4096;
  const collect = (body, depth = 0) => {
    if (!Array.isArray(body) || body.length > 128 || depth > 128) fail();
    for (const statement of body) {
      if (--remainingStatements < 0) fail();
      if (statement?.kind === "local") {
        const binding = statement.binding;
        if (bindingFact(binding, statement.range, source) && binding.id === `l${declarationIndex}`)
          declarations.set(binding.id, binding);
        declarationIndex++;
      } else if (statement?.kind === "if") { collect(statement.thenBody, depth + 1); collect(statement.elseBody, depth + 1); }
      else if (["block", "while"].includes(statement?.kind)) collect(statement.body, depth + 1);
    }
  };
  collect(fn.body);
  const budget = { remaining: 4096, sourcePath: hir.source.path, declarations, functions };
  const clone = locals => new Map([...locals].map(([id, local]) => [id, { ...local }]));
  const body = (statements, parent, locals, frame = "plain", outerBindings = new Map()) => {
    // Lexical visibility starts at scope entry, including each declaration's
    // own initializer and the TDZ before later declarations. Processed locals
    // separately retain the existing dominance and initialization diagnostics.
    const visibleBindings = new Map(outerBindings);
    for (const statement of statements) if (statement?.kind === "local") {
      const binding = declarations.get(statement.binding?.id);
      if (!binding) fail();
      visibleBindings.set(binding.name, binding.id);
    }
    let previousEnd = parent.start, returns = false, declarationKind;
    const names = new Set();
    for (const [index, statement] of statements.entries()) {
      if (--budget.remaining < 0 || !range(statement?.range, parent) || statement.range.start < previousEnd) fail();
      let before = sourceTokens(source, previousEnd, statement.range.start);
      if (index === 0 && frame !== "plain") {
        const header = frame === "function" ? before.match(/^(?:[^{}]|\\u\{[0-9a-fA-F]+\})*\{(const|let)?$/)
          : before.match(/^\{(const|let)?$/);
        if (!header) fail();
        before = header[1] ?? "";
      }
      if (statement.kind === "local") {
        const binding = statement.binding, value = statement.initializer;
        if (!exactKeys(statement, ["kind", "range", "binding", "initializer"])
            || !bindingFact(binding, statement.range, source) || ids.has(binding.id)
            || binding.id !== `l${ids.size}` || names.has(binding.name)
            || sourceTokens(source, statement.range.start, binding.range.start) !== "") fail();
        const keyword = before.match(/^;?(const|let)$/)?.[1];
        if (keyword) declarationKind = keyword;
        else if (before !== "," || !declarationKind) fail();
        if (binding.writable !== (declarationKind === "let")) fail();
        const annotations = binding.type === boolTypeId ? [":bool", ":boolean"] : [":i32"];
        if (value !== null) {
          verifyExpression(value, statement.range, source, fail, budget, locals, visibleBindings);
          const annotation = sourceTokens(source, binding.range.end, value.range.start);
          if (value.type !== binding.type || !["=", ...annotations.map(item => `${item}=`)].includes(annotation)
              || sourceTokens(source, value.range.end, statement.range.end) !== "") fail();
        } else if (!binding.writable || !annotations.includes(sourceTokens(source, binding.range.end, statement.range.end))) fail();
        locals.set(binding.id, { ...binding, initialized: value !== null });
        names.add(binding.name); ids.add(binding.id);
      } else {
        declarationKind = undefined;
        if (!/^;?$/.test(before)) fail();
        if (statement.kind === "block") {
          if (!exactKeys(statement, ["kind", "range", "body"])) fail();
          const scoped = clone(locals);
          const terminated = body(statement.body, statement.range, scoped, "block", visibleBindings);
          for (const [id, local] of locals) local.initialized = scoped.get(id).initialized;
          returns ||= terminated;
        } else if (statement.kind === "if" || statement.kind === "while") {
          const branch = statement.kind === "if", condition = statement.condition;
          if (!exactKeys(statement, branch ? ["kind", "range", "condition", "thenBody", "elseBody"]
              : ["kind", "range", "condition", "body"]) || condition?.type !== boolTypeId) fail();
          verifyExpression(condition, statement.range, source, fail, budget, locals, visibleBindings);
          const selected = branch ? statement.thenBody : statement.body;
          if (!Array.isArray(selected) || selected.length !== 1
              || sourceTokens(source, statement.range.start, condition.range.start) !== `${statement.kind}(`
              || sourceTokens(source, condition.range.end, selected[0]?.range.start) !== ")") fail();
          const left = clone(locals), leftReturn = body(selected, { start: selected[0].range.start, end: selected.at(-1).range.end }, left, "plain", visibleBindings);
          let last = selected.at(-1).range.end;
          if (branch) {
            if (!Array.isArray(statement.elseBody) || statement.elseBody.length > 1) fail();
            const right = clone(locals);
            let rightReturn = false;
            if (statement.elseBody.length) {
              const alternative = statement.elseBody;
              if (!noShortIf(selected[0])
                  || sourceTokens(source, last, alternative[0].range.start) !== "else") fail();
              rightReturn = body(alternative, { start: alternative[0].range.start, end: alternative.at(-1).range.end }, right, "plain", visibleBindings);
              last = alternative.at(-1).range.end;
            }
            for (const [id, local] of locals)
              local.initialized = leftReturn ? right.get(id).initialized : rightReturn ? left.get(id).initialized
                : left.get(id).initialized && right.get(id).initialized;
            returns ||= leftReturn && rightReturn;
          }
          if (sourceTokens(source, last, statement.range.end) !== "") fail();
        } else {
          const value = statement.value;
          if (statement.kind === "return") {
            if (!exactKeys(statement, ["kind", "range", "value"]) || value?.type !== fn.returnType.id
                || sourceTokens(source, statement.range.start, value.range.start) !== "return") fail();
            returns = true;
          } else if (statement.kind === "assign") {
            const target = statement.target, local = locals.get(target?.binding);
            if (!exactKeys(statement, ["kind", "range", "target", "value"])
                || !exactKeys(target, ["kind", "type", "binding", "range"]) || target.kind !== "reference"
                || !local?.writable || visibleBindings.get(local.name) !== target.binding
                || target.type !== local.type || value?.type !== local.type
                || !range(target.range, statement.range) || target.range.end > value.range.start
                || identifierToken(source, target.range) !== local.name
                || sourceTokens(source, statement.range.start, target.range.start) !== ""
                || sourceTokens(source, target.range.end, value.range.start) !== "=") fail();
          } else fail();
          verifyExpression(value, statement.range, source, fail, budget, locals, visibleBindings);
          if (!/^;?$/.test(sourceTokens(source, value.range.end, statement.range.end))) fail();
          if (statement.kind === "assign") locals.get(statement.target.binding).initialized = true;
        }
      }
      previousEnd = statement.range.end;
    }
    const tail = sourceTokens(source, previousEnd, parent.end);
    if (statements.length === 0 && frame === "block" ? tail !== "{}"
      : !(frame === "plain" ? /^;?$/ : /^;?\}$/).test(tail)) fail();
    return returns;
  };
  const initial = new Map(), visible = new Map();
  const header = sourceTrivia(source,fn.range.start,fn.body[0].range.start);
  const parsedHeader = header.match(/^\s*(?:export\s+)?function\s+([^()]+)\(([^()]*)\)\s*:\s*(i32|bool|boolean)\s*\{\s*(?:(?:const|let)\s*)?$/d);
  if (!parsedHeader || identifierToken(parsedHeader[1],{start:0,end:parsedHeader[1].length}) !== fn.name
      || (parsedHeader[3] === "boolean" ? "bool" : parsedHeader[3]) !== fn.returnType.name) fail();
  const parameterTokens = parsedHeader[2].trim() === "" ? [] : parsedHeader[2].split(",");
  if (parameterTokens.length > 1 && parameterTokens.at(-1).trim() === "") parameterTokens.pop();
  if (parameterTokens.length !== fn.parameters.length) fail();
  let parameterEnd = fn.range.start;
  let parameterStart = fn.range.start + parsedHeader.indices[2][0];
  for (const [index, parameter] of fn.parameters.entries()) {
    if (!bindingFact(parameter, fn.range, source) || parameter.id !== `p${index}` || !parameter.writable
        || visible.has(parameter.name) || parameter.range.start < parameterEnd) fail();
    const parts=parameterTokens[index].split(":");
    if(parts.length !== 2 || identifierToken(parts[0],{start:0,end:parts[0].length}) !== parameter.name
        || parameter.range.start < parameterStart || parameter.range.end > parameterStart + parts[0].length
        || (parts[1].trim() === "boolean" ? "bool" : parts[1].trim()) !== parameterNames[index]) fail();
    initial.set(parameter.id, { ...parameter, initialized: true }); visible.set(parameter.name, parameter.id);
    parameterEnd = parameter.range.end;
    parameterStart += parameterTokens[index].length + 1;
  }
  if (!body(fn.body, fn.range, initial, "function", visible)) fail();
  }
  return own(hir);
}

export function buildHir(snapshot) {
  try { validateFrontendSnapshot(snapshot); }
  catch (error) { return { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message }] }; }
  const first = snapshot.functions[0], expression = first?.body?.find(item => item.expression)?.expression;
  if (snapshot.functions.length < 1 || snapshot.functions.length > 128 || snapshot.functions.some(fn => fn.parameters.length > 64
      || !Object.hasOwn(types, resolveType(snapshot, fn.returnTypeRef).scalar)
      || fn.parameters.some(parameter => !types[parameter.type]) || fn.body.length < 1 || fn.body.length > 128)) {
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir",
      message: "current execution capability requires scalar i32/bool functions with direct calls, locals, structured control and returns",
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? first?.range ?? { start: 0, end: 0 }) } }] };
  }
  const functions = new Map(snapshot.functions.map(fn => [fn.symbol.id, {
    id: functionIdentity(snapshot.source.path, fn.name, fn.returnType, fn.parameters.map(p => p.type)), name: fn.name,
    signatureHash: signatureHash(fn.returnType, fn.parameters.map(p => p.type)),
    returnType: { kind: "scalar", name: fn.returnType, id: types[fn.returnType] },
    parameters: fn.parameters.map((p,index) => ({id:`p${index}`,name:p.name,type:types[p.type],writable:true,range:p.range})),
    range: fn.range,
  }]));
  const projectedFunctions = [];
  for (const fn of snapshot.functions) {
  const descriptor = functions.get(fn.symbol.id);
  const bindings = new Map();
  fn.parameters.forEach((p,index) => bindings.set(p.id, descriptor.parameters[index]));
  const project = value => {
    const type = types[resolveType(snapshot, value.typeRef).scalar];
    if (!type) throw new TypeError("unsupported expression type");
    const common = { type, range: value.range };
    if (value.kind === "reference") {
      const symbol = resolveSymbol(snapshot, value.symbol), binding = bindings.get(symbol.id);
      if (!binding) throw new TypeError("local reference has no preceding owned declaration");
      return { kind: "reference", ...common, binding: binding.id };
    }
    if (value.kind === "call") {
      const target = functions.get(resolveSymbol(snapshot, value.target).id);
      if (!target) throw new TypeError("call target is outside owned function closure");
      return {kind:"call",...common,target:target.id,signatureHash:target.signatureHash,arguments:value.arguments.map(project)};
    }
    if (value.kind === "integer") return { kind: "constant", ...common, decimal: value.literal.decimal, token: value.literal.token };
    if (value.kind === "boolean") return { kind: "boolean", ...common, value: value.boolean };
    if (value.kind === "group") return { kind: "group", ...common, operand: project(value.operand) };
    if (value.kind === "unary" && ["+", "-", "~", "!"].includes(value.operator))
      return { kind: "unary", ...common, operator: value.operator, operand: project(value.operand) };
    if (value.kind === "binary" && Object.hasOwn(operations, value.operator)
        || value.kind === "shortCircuit" && ["&&", "||"].includes(value.operator))
      return { kind: value.kind, ...common, operator: value.operator, left: project(value.left), right: project(value.right) };
    throw new TypeError("unsupported checked expression capability");
  };
  let projected;
  const statements = items => (items ?? []).map(item => {
    if (item.kind === "variable") {
      const symbol = resolveSymbol(snapshot, item.symbol.ref), type = types[symbol.type];
      if (symbol.kind !== "local" || !type) throw new TypeError("unsupported local type");
      const initializer = item.initializer ? project(item.initializer) : null;
      const binding = { id: `l${bindings.size - fn.parameters.length}`, name: symbol.name, type, writable: symbol.writable, range: symbol.range };
      bindings.set(symbol.id, binding);
      return { kind: "local", range: item.range, binding, initializer };
    }
    if (item.kind === "assignment") return { kind: "assign", range: item.range, target: project(item.target), value: project(item.value) };
    if (item.kind === "block") return { kind: "block", range: item.range, body: statements(item.body) };
    if (item.kind === "while") return { kind: "while", range: item.range, condition: project(item.condition), body: statements(item.body) };
    if (item.kind === "if") return { kind: "if", range: item.range, condition: project(item.condition),
      thenBody: statements(item.thenBody), elseBody: statements(item.elseBody) };
    if (item.kind === "return") return { kind: "return", range: item.range, value: project(item.expression) };
    throw new TypeError("unsupported checked statement capability");
  });
  try { projected = statements(fn.body); } catch (error) {
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir", message: error.message,
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? fn.range) } }] };
  }
  projectedFunctions.push({...descriptor,body:projected});
  }
  const hir = {
    contractVersion: contract().semver, schemaHash: contract().schemaHash, inputIdentity: snapshot.inputIdentity,
    source: { ...snapshot.source, hash: sha256(snapshot.source.content) }, target: bytecodeSchema.target,
    functions: projectedFunctions,
  };
  try { return { status: "ok", hir: verifyHir(hir) }; }
  catch (error) { return { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message,
    primary: { sourceId: snapshot.source.path, ...(expression?.range ?? first.range) } }] }; }
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
  const verified = verifyHir(hir);
  const quote = text => JSON.stringify(text).replace(/\\u([0-9a-f]{4})/g, (_, hex) => {
    const code = Number.parseInt(hex, 16);
    return code < 128 ? `\\${hex.slice(2)}` : String.fromCharCode(code);
  });
  const strings = { input_identity: verified.inputIdentity, source_hash: verified.source.hash,
    source_path: verified.source.path,
    target: verified.target.target, triple: verified.target.triple, data_layout: verified.target.llvmDataLayout,
    bytecode_schema: registry["tsfg.bytecode"].schemaHash };
  const attrs = ['tsfg_core.version = "0.5.0"', ...Object.entries(strings)
    .map(([key, item]) => `tsfg_core.${key} = ${quote(item)}`),
    `tsfg_core.source_length = ${verified.source.content.length} : i64`];
  const lowerFunction = fn => {
  const blocks = [], bindingTypes = new Map();
  let valueIndex = 0, current, definitions = new Map(), declared = new Set();
  const coreType = type => type === i32TypeId ? "i32" : "i1";
  const newBlock = (parameterTypes = []) => {
    const block = { name: `bb${blocks.length}`, parameters: parameterTypes.map(type => ({ name: `%v${valueIndex++}`, type })), lines: [], terminated: false };
    blocks.push(block); return block;
  };
  const attrsFor = anchor => `tsfg_source.start = ${anchor.start} : i64, tsfg_source.end = ${anchor.end} : i64`;
  const edge = (block, values = []) => `^${block.name}${values.length ? `(${values.join(", ")} : ${block.parameters.map(p => coreType(p.type)).join(", ")})` : ""}`;
  const branch = (block, values, anchor) => {
    current.lines.push(`    cf.br ${edge(block, values)} {${attrsFor(anchor)}}`);
    current.terminated = true;
  };
  const conditional = (condition, left, right, anchor) => {
    current.lines.push(`    cf.cond_br ${condition}, ${edge(left)}, ${edge(right)} {${attrsFor(anchor)}}`);
    current.terminated = true;
  };
  const fuel = (event, anchor) => current.lines.push(`    "tsfg_core.fuel"() {event = ${event} : i32, ${attrsFor(anchor)}} : () -> ()`);
  current = newBlock(fn.parameters.map(parameter => parameter.type));
  fn.parameters.forEach((parameter,index) => {
    definitions.set(parameter.id,current.parameters[index].name); declared.add(parameter.id);
    bindingTypes.set(parameter.id,parameter.type);
  });
  fuel(1, fn.range);
  const emit = expression => {
    if (expression.kind === "reference") return definitions.get(expression.binding);
    if (expression.kind === "call") {
      const operands = expression.arguments.map(emit), target = verified.functions.find(fn => fn.id === expression.target);
      const name = `%v${valueIndex++}`;
      current.lines.push(`    ${name} = "func.call"(${operands.join(", ")}) {callee = @${quote(target.name)}, tsfg_core.function_id = ${quote(target.id)}, tsfg_core.signature_hash = ${quote(target.signatureHash)}, ${attrsFor(expression.range)}} : (${expression.arguments.map(argument => coreType(argument.type)).join(", ")}) -> ${coreType(expression.type)}`);
      return name;
    }
    if (expression.kind === "group" || expression.kind === "unary" && expression.operator === "+") return emit(expression.operand);
    if (expression.kind === "shortCircuit") {
      const left = emit(expression.left);
      const rhs = newBlock(), shortcut = newBlock(), join = newBlock([boolTypeId]);
      conditional(left, expression.operator === "&&" ? rhs : shortcut, expression.operator === "&&" ? shortcut : rhs, expression.range);
      current = shortcut; branch(join, [left], expression.range);
      current = rhs; const right = emit(expression.right); branch(join, [right], expression.range);
      current = join; return join.parameters[0].name;
    }
    const operands = expression.kind === "binary" ? [emit(expression.left), emit(expression.right)]
      : expression.kind === "unary" ? [emit(expression.operand)] : [];
    const name = `%v${valueIndex++}`, type = coreType(expression.type);
    const constant = ["constant", "boolean"].includes(expression.kind);
    const op = constant ? "constant" : expression.kind === "binary" ? operations[expression.operator]
      : ({ "-": "neg", "~": "not", "!": "bool_not" })[expression.operator];
    const valueAttr = constant ? `value = ${expression.kind === "constant" ? expression.decimal : Number(expression.value)} : ${type}, ` : "";
    const operandTypes = expression.kind === "binary" ? [expression.left.type, expression.right.type]
      : expression.kind === "unary" ? [expression.operand.type] : [];
    current.lines.push(`    ${name} = "tsfg_core.${op}"(${operands.join(", ")}) {${valueAttr}${attrsFor(expression.range)}} : (${operandTypes.map(coreType).join(", ")}) -> ${type}`);
    return name;
  };
  const emitBody = statements => {
    for (const statement of statements) {
      if (!current) break;
      if (statement.kind === "local") {
        bindingTypes.set(statement.binding.id, statement.binding.type);
        declared.add(statement.binding.id);
        if (statement.initializer) definitions.set(statement.binding.id, emit(statement.initializer));
      } else if (statement.kind === "assign") definitions.set(statement.target.binding, emit(statement.value));
      else if (statement.kind === "return") {
        const result = emit(statement.value), type = coreType(fn.returnType.id);
        current.lines.push(`    "func.return"(${result}) {${attrsFor(statement.range)}} : (${type}) -> ()`);
        current.terminated = true; current = null;
      } else if (statement.kind === "block") {
        const outer = new Set(declared);
        emitBody(statement.body);
        definitions = new Map([...definitions].filter(([id]) => outer.has(id)));
        declared = outer;
      } else if (statement.kind === "if") {
        const condition = emit(statement.condition), outer = new Map(definitions), outerDeclared = new Set(declared);
        const yes = newBlock(), no = newBlock();
        conditional(condition, yes, no, statement.condition.range);
        current = yes; definitions = new Map(outer); emitBody(statement.thenBody);
        const yesExit = current, yesDefinitions = new Map(definitions);
        current = no; definitions = new Map(outer); declared = new Set(outerDeclared); emitBody(statement.elseBody);
        const noExit = current, noDefinitions = new Map(definitions);
        const keys = [...outerDeclared].filter(id => (!yesExit || yesDefinitions.has(id)) && (!noExit || noDefinitions.has(id)));
        if (yesExit || noExit) {
          const join = newBlock(keys.map(id => bindingTypes.get(id)));
          if (yesExit) { current = yesExit; branch(join, keys.map(id => yesDefinitions.get(id)), statement.range); }
          if (noExit) { current = noExit; branch(join, keys.map(id => noDefinitions.get(id)), statement.range); }
          current = join; definitions = new Map(keys.map((id, index) => [id, join.parameters[index].name]));
        } else { current = null; definitions = outer; }
        declared = outerDeclared;
      } else if (statement.kind === "while") {
        const outer = new Map(definitions), outerDeclared = new Set(declared), keys = [...outer.keys()];
        const header = newBlock(keys.map(id => bindingTypes.get(id)));
        branch(header, keys.map(id => outer.get(id)), statement.condition.range);
        current = header; definitions = new Map(keys.map((id, index) => [id, header.parameters[index].name]));
        fuel(2, statement.condition.range);
        const condition = emit(statement.condition), incoming = new Map(definitions);
        const loop = newBlock(), exit = newBlock();
        conditional(condition, loop, exit, statement.condition.range);
        current = loop; definitions = new Map(incoming); emitBody(statement.body);
        if (current) branch(header, keys.map(id => definitions.get(id)), statement.condition.range);
        current = exit; definitions = incoming; declared = outerDeclared;
      }
    }
  };
  emitBody(fn.body);
  if (current || blocks.some(block => !block.terminated)) throw new TypeError("r03-hir-cfg: reachable function fallthrough");
  const type = coreType(fn.returnType.id);
  const text = blocks.map((block, index) => `${index ? `  ^${block.name}${block.parameters.length ? `(${block.parameters.map(p => `${p.name}: ${coreType(p.type)}`).join(", ")})` : ""}:\n` : ""}${block.lines.join("\n")}`).join("\n");
  const functionAttrs = `tsfg_core.function_id = ${quote(fn.id)}, tsfg_core.signature_hash = ${quote(fn.signatureHash)}, tsfg_core.type_id = ${quote(fn.returnType.id)}, tsfg_core.function_start = ${fn.range.start} : i64, tsfg_core.function_end = ${fn.range.end} : i64`;
  return `  func.func @${quote(fn.name)}(${blocks[0].parameters.map(p => `${p.name}: ${coreType(p.type)}`).join(", ")}) -> ${type} attributes {${functionAttrs}} {\n${text}\n  }`;
  };
  return `module attributes {${attrs.join(", ")}} {\n${verified.functions.map(lowerFunction).join("\n")}\n}\n`;
}
