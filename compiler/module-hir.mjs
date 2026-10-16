// SPDX-License-Identifier: MIT
import { identifierName, staticBindingName, sourceTrivia, verifyModuleHir } from './module-facts.mjs';
import { initializerIdentity } from './modules.mjs';
import { canonical, functionIdentity, signatureHash, i32TypeId, boolTypeId, scalarTypeIds, scalarName, integerNames, integerRange, own, sha256 } from './identity.mjs';
import registry from '../contracts/registry.json' with {type:'json'};
import bytecodeSchema from '../contracts/bytecode.schema.json' with {type:'json'};
import { floatNames, floatBits } from './float.mjs';

// This module owns complete cold HIR validation before any pruning or lowering.
const contract = () => registry["tsfg.hir"];
const exactKeys = (value, keys) => value && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const hash = value => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const types = scalarTypeIds;
const integerType = id => integerNames.includes(scalarName(id));
const floatType = id => floatNames.includes(scalarName(id));
export const scalarOperations = Object.freeze({ "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "rem",
  "<<": "shl", ">>": "shr", ">>>": "ushr", "&": "and", "|": "or", "^": "xor",
  "===": "eq", "!==": "ne", "<": "lt", "<=": "le", ">": "gt", ">=": "ge" });
const comparisons = new Set(["===", "!==", "<", "<=", ">", ">="]);
// The checked scalar subset inherits TS precedence; every binary operator here
// associates left. Parentheses are explicit group nodes, not inferred anchors.
const precedence = { "||": -1, "&&": 0, "|": 1, "^": 2, "&": 3, "===": 4, "!==": 4,
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
function verifyExpression(value, parent, source, fail, budget, locals, visibleBindings) {
  if (--budget.remaining < 0 || !value || !Object.values(types).includes(value.type)
      || !range(value.range, parent)) fail();
  if (value.kind === "global") {
    const global=budget.modules?.globals.get(value.global);
    if(!exactKeys(value,['kind','type','global','name','range'])||!global||global.type!==value.type
      ||budget.modules.views.get(budget.sourcePath)?.get(value.name)!==value.global
      ||staticBindingName(source.slice(value.range.start,value.range.end))!==staticBindingName(value.name)
      ||visibleBindings.has(value.name)||staticBindingName(value.name).includes('.')&&visibleBindings.has(staticBindingName(value.name).split('.')[0]))fail();
  } else if (value.kind === "reference") {
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
  } else if (value.kind === "call" || value.kind === "host") {
    const host=value.kind==='host';
    const target = host ? budget.modules?.hosts.get(value.target) : budget.functions.get(value.target);
    const callee=budget.modules?value.name:target?.name;
    const resultType=host?target?.returnType:target?.returnType.id;
    const parameters=host?target?.parameterTypes?.map(type=>({type})):target?.parameters;
    if (!exactKeys(value, ["kind", "type", "range", "target", "signatureHash", "arguments",...(budget.modules?['name']:[])])
        || !target || target.kind==='module-initialization' || target.signatureHash !== value.signatureHash || resultType !== value.type
        || visibleBindings.has(callee) || budget.modules && (budget.modules.views.get(budget.sourcePath)?.get(callee)!==value.target
          ||staticBindingName(callee).includes('.')&&visibleBindings.has(staticBindingName(callee).split('.')[0]))
        || !Array.isArray(value.arguments) || value.arguments.length !== parameters.length) fail();
    const calleeToken=(text,anchor)=>budget.modules?staticBindingName(text.slice(anchor.start,anchor.end)):identifierToken(text,anchor);
    const calleeName=budget.modules?staticBindingName(callee):callee;
    let previous = value.range.start;
    for (const [index, argument] of value.arguments.entries()) {
      verifyExpression(argument, value.range, source, fail, budget, locals, visibleBindings);
      const prefix = sourceTrivia(source, previous, argument.range.start).trim();
      if (argument.type !== parameters[index].type || argument.range.start < previous) fail();
      if (index === 0) {
        if (!prefix.endsWith("(") || calleeToken(prefix, {start:0,end:prefix.length-1}) !== calleeName) fail();
      } else if (prefix !== ",") fail();
      previous = argument.range.end;
    }
    const tail = sourceTrivia(source, previous, value.range.end).trim();
    if (value.arguments.length ? !/^,?\s*\)$/.test(tail) : !/\(\s*\)$/.test(tail)
        || calleeToken(tail,{start:0,end:tail.lastIndexOf("(")}) !== calleeName) fail();
  } else if (value.kind === "constant") {
    if (!exactKeys(value, ["kind", "type", "decimal", "token", "range"])
        || !integerType(value.type) || typeof value.decimal !== "string"
        || !/^(?:0|-?[1-9][0-9]*)$/.test(value.decimal) || typeof value.token !== "string") fail();
    let integer;
    try { integer = (value.token.startsWith("-") ? -1n : 1n)
      * BigInt(value.token.replace(/^-/, "").replaceAll("_", "")); } catch { fail(); }
    const anchored = sourceTokens(source, value.range.start, value.range.end);
    const [minimum, maximum] = integerRange(scalarName(value.type));
    if (integer.toString() !== value.decimal || integer < minimum || integer > maximum
        || anchored !== value.token) fail();
  } else if (value.kind === "floating") {
    if (!exactKeys(value, ["kind", "type", "bits", "token", "range"]) || !floatType(value.type)
        || sourceTokens(source, value.range.start, value.range.end) !== value.token) fail();
    try { if (floatBits(value.token, scalarName(value.type)) !== value.bits) fail(); } catch { fail(); }
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
        || (value.operator === "!" ? value.type !== boolTypeId : !integerType(value.type)
          && !(floatType(value.type) && ["+", "-"].includes(value.operator)))))) fail();
  } else if (value.kind === "binary" || value.kind === "shortCircuit") {
    const short = value.kind === "shortCircuit";
    if (!exactKeys(value, ["kind", "type", "operator", "left", "right", "range"])
        || !(short ? ["&&", "||"].includes(value.operator) : Object.hasOwn(scalarOperations, value.operator))) fail();
    verifyExpression(value.left, value.range, source, fail, budget, locals, visibleBindings);
    verifyExpression(value.right, value.range, source, fail, budget, locals, visibleBindings);
    const shift = ["<<", ">>", ">>>"].includes(value.operator);
    if ((shift ? value.right.type !== i32TypeId : value.left.type !== value.right.type) || value.left.range.end > value.right.range.start
        || (["binary", "shortCircuit"].includes(value.left.kind) && precedence[value.left.operator] < precedence[value.operator])
        || (["binary", "shortCircuit"].includes(value.right.kind) && precedence[value.right.operator] <= precedence[value.operator])
        || sourceTokens(source, value.range.start, value.left.range.start) !== ""
        || !scalarOperator(source, value.left.range.end, value.right.range.start, value.operator)
        || sourceTokens(source, value.right.range.end, value.range.end) !== ""
        || value.type !== (short || comparisons.has(value.operator) ? boolTypeId : value.left.type)
        || (short ? value.left.type !== boolTypeId : !["===", "!=="].includes(value.operator) && !integerType(value.left.type)
          && !(floatType(value.left.type) && (comparisons.has(value.operator) || ["+", "-", "*", "/", "%"].includes(value.operator))))) fail();
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
  const moduleMode=hir?.modules!==undefined;
  if (!exactKeys(hir, ["contractVersion", "schemaHash", "inputIdentity", "source", "target", "functions",...(moduleMode?['sources','modules','globals','hostImports','closure']:[])])
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
      || !Array.isArray(hir.functions) || hir.functions.length < 1 || hir.functions.length > 256) fail();
  const moduleFacts=moduleMode?verifyModuleHir(hir,fail):undefined;
  const functions = new Map(), functionNames = new Set();
  const previousFunctionEnd = new Map();
  for (const fn of hir.functions) {
    const sourcePath=moduleMode?fn.sourcePath:hir.source.path,source=moduleFacts?.sources.get(sourcePath)??hir.source;
    const name=`${sourcePath}\0${fn?.kind??'source'}\0${fn?.name}`;
    if (!validText(fn?.name) || functions.has(fn?.id) || functionNames.has(name)
        || fn.kind!=='module-initialization' && !range(fn.range, { start: previousFunctionEnd.get(sourcePath)??0, end: source.content.length })) fail();
    if(fn.kind!=='module-initialization')previousFunctionEnd.set(sourcePath,fn.range.end);
    functions.set(fn.id, fn); functionNames.add(name);
  }
  const parameterTypesByFunction = new Map();
  for (const fn of hir.functions) {
  if (!Array.isArray(fn.parameters)) fail();
  const parameterNames = fn.parameters.map(parameter => Object.entries(types).find(([,id]) => id === parameter?.type)?.[0]);
  const sourcePath=moduleMode?fn.sourcePath:hir.source.path,source=moduleFacts?.sources.get(sourcePath)??hir.source;
  if (!exactKeys(fn, ["id", "name", "signatureHash", "returnType", "parameters", "range", "body",...(moduleMode?['sourcePath','kind']:[])])
      || !validText(fn.name) || !Object.hasOwn(types, fn.returnType?.name)
      || fn.id !== (fn.kind==='module-initialization'?initializerIdentity(sourcePath,source.hash):functionIdentity(sourcePath, fn.name, fn.returnType.name, parameterNames))
      || fn.signatureHash !== signatureHash(fn.returnType.name, parameterNames)
      || canonical(fn.returnType) !== canonical({ kind: "scalar", name: fn.returnType.name, id: types[fn.returnType.name] })
      || !Array.isArray(fn.parameters) || fn.parameters.length > 64 || parameterNames.some(name => !name)
      || fn.kind!=='module-initialization' && !range(fn.range, { start: 0, end: source.content.length })
      || !Array.isArray(fn.body) || fn.kind!=='module-initialization' && fn.body.length < 1 || fn.body.length > 128) fail();
  parameterTypesByFunction.set(fn.id, parameterNames);
  }
  // Resolve calls only after the complete table's identities and signatures
  // have been validated, including functions that are never executed.
  for (const fn of hir.functions) {
  const parameterNames = parameterTypesByFunction.get(fn.id);
  const sourcePath=moduleMode?fn.sourcePath:hir.source.path;
  const source = (moduleFacts?.sources.get(sourcePath)??hir.source).content, declarations = new Map(), ids = new Set(), initializedGlobals=new Set();
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
  const budget = { remaining: 4096, sourcePath, declarations, functions, modules:moduleFacts };
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
      if (index === 0 && frame !== "plain" && frame !== "module") {
        const header = frame === "function" ? before.match(/^(?:[^{}]|\\u\{[0-9a-fA-F]+\})*\{(const|let)?$/)
          : before.match(/^\{(const|let)?$/);
        if (!header) fail();
        before = header[1] ?? "";
      }
      if (statement.kind === "initialize") {
        const global=moduleFacts?.globals.get(statement.global),value=statement.value;
        if(frame!=='module'||!exactKeys(statement,['kind','global','range','value'])||!global
          ||global.sourcePath!==sourcePath||value?.type!==global.type||initializedGlobals.has(global.id))fail();
        if(global.bindingKind==='default-export-expression') {
          declarationKind = undefined;
          if(global.writable||sourceTokens(source,statement.range.start,value.range.start)!=='exportdefault'
            ||global.range.start<value.range.start||global.range.end!==value.range.end)fail();
        }else {
          const keyword=before.match(/(?:^|[^\p{ID_Continue}])(?:export)?(const|let)$/u)?.[1];
          if (keyword) declarationKind = keyword;
          else if (before !== "," || !declarationKind) fail();
          const annotation=sourceTokens(source,global.range.end,value.range.start);
          const annotations=global.type===boolTypeId?[':bool',':boolean']:global.type===types.f64?[':f64',':number']:[`:${scalarName(global.type)}`];
          if(global.writable!==(declarationKind==='let')||!range(global.range,statement.range)
            ||identifierToken(source,global.range)!==global.name||sourceTokens(source,statement.range.start,global.range.start)!==''
            ||!['=',...annotations.map(a=>a+'=')].includes(annotation))fail();
        }
        verifyExpression(value,statement.range,source,fail,budget,locals,visibleBindings);
        const declarationTail=sourceTokens(source,value.range.end,statement.range.end);
        if(!/^;?$/.test(declarationTail))fail();
        if (declarationTail === ";") declarationKind = undefined;
        initializedGlobals.add(global.id);
      } else if (statement.kind === "local") {
        const binding = statement.binding, value = statement.initializer;
        if (!exactKeys(statement, ["kind", "range", "binding", "initializer"])
            || !bindingFact(binding, statement.range, source) || ids.has(binding.id)
            || binding.id !== `l${ids.size}` || names.has(binding.name)
            || sourceTokens(source, statement.range.start, binding.range.start) !== "") fail();
        const keyword = before.match(/^;?(const|let)$/)?.[1];
        if (keyword) declarationKind = keyword;
        else if (before !== "," || !declarationKind) fail();
        if (binding.writable !== (declarationKind === "let")) fail();
        const annotations = binding.type === boolTypeId ? [":bool", ":boolean"] : binding.type === types.f64 ? [":f64", ":number"] : [`:${scalarName(binding.type)}`];
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
        if (frame!=='module' && !/^;?$/.test(before)) fail();
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
          } else if (statement.kind === "expression") {
            if(!moduleMode||!exactKeys(statement,['kind','range','value'])||value?.kind!=='call'&&value?.kind!=='host'
              ||sourceTokens(source,statement.range.start,value.range.start)!=='')fail();
          } else if (statement.kind === "assign" && statement.target?.kind === "global") {
            const target=statement.target,global=moduleFacts?.globals.get(target.global);
            if(!exactKeys(statement,['kind','range','target','value'])||!global?.writable||value?.type!==global.type
              ||target.type!==global.type||!range(target.range,statement.range)||target.range.end>value.range.start
              ||sourceTokens(source,statement.range.start,target.range.start)!==''
              ||sourceTokens(source,target.range.end,value.range.start)!=='=')fail();
            verifyExpression(target,statement.range,source,fail,budget,locals,visibleBindings);
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
          if (statement.kind === "assign" && statement.target.kind==='reference') locals.get(statement.target.binding).initialized = true;
        }
      }
      previousEnd = statement.range.end;
    }
    const tail = sourceTokens(source, previousEnd, parent.end);
    if (frame!=='module' && (statements.length === 0 && frame === "block" ? tail !== "{}"
      : !(frame === "plain" ? /^;?$/ : /^;?\}$/).test(tail))) fail();
    return returns;
  };
  const initial = new Map(), visible = new Map();
  if(fn.kind==='module-initialization') {
    body(fn.body,fn.range,initial,'module',visible);
    const initialized=[...initializedGlobals],expected=[...moduleFacts.globals.values()].filter(g=>g.sourcePath===sourcePath).map(g=>g.id);
    if(canonical(initialized)!==canonical(expected))fail();
    continue;
  }
  const header = sourceTrivia(source,fn.range.start,fn.body[0].range.start);
  const parsedHeader = header.match(/^\s*(?:export\s+(?:default\s+)?)?function\s*([^()]*)\(([^()]*)\)\s*:\s*(i8|i16|i32|i64|u8|u16|u32|u64|isize|usize|bool|boolean|f32|f64|number)\s*\{\s*(?:(?:const|let)\s*)?$/d);
  if (!parsedHeader || (parsedHeader[1].trim()==='' ? !(moduleMode&&fn.name==='default'&&/export\s+default/.test(header))
      : identifierToken(parsedHeader[1],{start:0,end:parsedHeader[1].length}) !== fn.name)
      || parsedHeader[1].trim()!=='' && !/\bfunction\s+/.test(header)
      || ({boolean:"bool",number:"f64"}[parsedHeader[3]] ?? parsedHeader[3]) !== fn.returnType.name) fail();
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
        || ({boolean:"bool",number:"f64"}[parts[1].trim()] ?? parts[1].trim()) !== parameterNames[index]) fail();
    initial.set(parameter.id, { ...parameter, initialized: true }); visible.set(parameter.name, parameter.id);
    parameterEnd = parameter.range.end;
    parameterStart += parameterTokens[index].length + 1;
  }
  if (!body(fn.body, fn.range, initial, "function", visible)) fail();
  }
  if (moduleMode) verifyKernelHostSemantics(hir);
  return own(hir);
}

/** A negative missing-proof witness, never a kernel certificate or Published summary. */
export class KernelHostSemanticError extends TypeError {
  constructor(primary, chain, host) {
    const code = 'r03-d-kernel-host-semantics';
    const message = code + ': kernel call requires a trusted HostSemanticContract; '
      + chain.join(' -> ') + ' (declaration ' + host.sourcePath + ':' + host.name + ')';
    super(message);
    this.code = code;
    this.ruleId = 'r01-kernel';
    this.phase = 'hir';
    this.primary = primary;
  }
}

/**
 * Q8: after complete owned-HIR verification, reject a kernel-reachable host
 * lacking semantic trust. The current host representation has no such proof.
 * This uses body facts only to find a forbidden operation, never to authorize a
 * replaceable function using its narrower current body (R03 Q9/ADR0018).
 */
function verifyKernelHostSemantics(hir) {
  if (!hir.modules) return;
  const functions = new Map(hir.functions.map(fn => [fn.id, fn]));
  const hosts = new Map(hir.hostImports.map(host => [host.id, host]));
  const edges = new Map();
  const collect = (value, found) => {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'call' || value.kind === 'host') found.push(value);
    for (const nested of Object.values(value)) {
      if (Array.isArray(nested)) for (const item of nested) collect(item, found);
      else if (nested && typeof nested === 'object') collect(nested, found);
    }
  };
  for (const fn of hir.functions) {
    const found = [];
    collect(fn.body, found);
    edges.set(fn.id, found);
  }
  for (const root of hir.closure.roots) {
    if (root.kind !== 'kernel') continue;
    const entry = functions.get(root.target);
    const pending = [{target: root.target, chain: [entry.sourcePath + ':' + entry.name]}];
    const scheduled = new Set([root.target]);
    for (let index = 0; index < pending.length; index++) {
      const {target, chain} = pending[index];
      const fn = functions.get(target);
      for (const edge of edges.get(target)) {
        const site = fn.sourcePath + ':' + edge.range.start + '-' + edge.range.end;
        if (edge.kind === 'host') {
          const host = hosts.get(edge.target);
          throw new KernelHostSemanticError({sourceId: fn.sourcePath, ...edge.range},
            [...chain, site + ' host ' + host.name], host);
        }
        const callee = functions.get(edge.target);
        if (!scheduled.has(callee.id)) {
          scheduled.add(callee.id);
          pending.push({target: callee.id,
            chain: [...chain, site + ' call ' + callee.sourcePath + ':' + callee.name]});
        }
      }
    }
  }
  // Retained owner initializers are intentionally absent from this worklist.
  // Ordinary top-level Host/application behavior is outside the kernel body.
}
