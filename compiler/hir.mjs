// SPDX-License-Identifier: MIT
import { validateFrontendSnapshot, resolveType, resolveSymbol, identifierName, localReferenceTarget, expressionLeaf } from "./frontend.mjs";
import { canonical, functionIdentity, signatureHash, i32TypeId, boolTypeId, scalarTypeIds, scalarName, integerNames, integerRange, own, sha256 } from "./identity.mjs";
import registry from "../contracts/registry.json" with { type: "json" };
import bytecodeSchema from "../contracts/bytecode.schema.json" with { type: "json" };
import { conversionDeclaration, conversionEntries, verifyConversionOrigin, conversionCallSpelling, admittedConversionScope, admittedInputScope, completeFunctionSource } from "./conversions.mjs";
import { floatNames, floatBits } from "./float.mjs";
import { hasState, presenceIdentity, presenceSignature, presenceEncoding, validParameterPresence, validLocalPresence, annotationStates, validPresenceFlow } from "./presence.mjs";

const contract = () => registry["tsfg.hir"];
const exactKeys = (value, keys) => value && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const hash = value => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const types = scalarTypeIds;
const integerType = id => integerNames.includes(scalarName(id));
const floatType = id => floatNames.includes(scalarName(id));
function checkedExpressionPresence(value) {
  if (value.kind === "group") return checkedExpressionPresence(value.operand);
  if (value.kind === "absence") return value.absence === "undefined" ? 2 : 4;
  if (value.kind === "reference" || value.kind === "write" && ["&&=","||="].includes(value.operator))
    return (value.presenceFlow?.undefined ? 2 : 0) | (value.presenceFlow?.null ? 4 : 0);
  if (value.kind === "write" && ["=","??="].includes(value.operator)) return checkedExpressionPresence(value.right);
  return 0;
}
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
  return exactKeys(binding, ["id", "name", "type", "writable", "range", ...(binding?.presence ? ["presence"] : [])])
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
const declaredStates = shape => 1 | (shape?.undefined ? 2 : 0) | (shape?.null ? 4 : 0);
const cloneLocals = locals => new Map([...locals].map(([id, local]) => [id, { ...local }]));
function expressionStates(value, locals) {
  if (value.kind === "reference") return locals.get(value.binding)?.states ?? 1;
  if (value.kind === "absence") return value.absence === "undefined" ? 2 : 4;
  if (value.kind === "group") return expressionStates(value.operand, locals);
  if (value.kind === "write" && value.operator === "=") return expressionStates(value.right, locals);
  if (value.kind === "write" && ["??=","&&=","||="].includes(value.operator)) return locals.get(localReferenceTarget(value.left)?.binding)?.states ?? 1;
  return 1;
}
function narrowLocals(locals, value, truth) {
  if (value.kind === "group") return narrowLocals(locals, value.operand, truth);
  if (value.kind === "unary" && value.operator === "!") return narrowLocals(locals, value.operand, !truth);
  if (value.kind === "shortCircuit" && (value.operator === "&&" && truth || value.operator === "||" && !truth)) {
    narrowLocals(locals, value.left, truth); narrowLocals(locals, value.right, truth); return;
  }
  if (value.kind !== "presenceTest") return;
  const left=expressionLeaf(value.left),right=expressionLeaf(value.right);
  const reference = left.kind === "reference" ? left : right;
  const absence = left.kind === "absence" ? left : right;
  const local = locals.get(reference.binding), bit = absence.absence === "undefined" ? 2 : 4;
  local.states &= truth === (value.operator === "===") ? bit : ~bit;
}
function loopCarriedStates(statement, locals, fail) {
  // Compute may-states from owned expression effects, independently of the
  // producer's flow claims. The ordinary verifier still authenticates every
  // claim, source anchor and payload read after this finite back-edge pass.
  let remaining = 4096, work = 4096 * (1 + locals.size * 3);
  // Share a finite work bound across nested solvers; resetting one pass's
  // node counter must not permit exponential nested-loop traversal.
  const tick = () => { if (--remaining < 0 || --work < 0) fail(); };
  const merge = (target, alternatives) => {
    for (const [id, local] of target) local.states = alternatives.reduce((states, branch) => states | branch.get(id).states, 0);
  };
  const expression = (value, state) => {
    tick();
    if (!value) fail();
    if (value.kind === "reference") {
      if (!state.has(value.binding)) fail();
      return state.get(value.binding).states;
    }
    if (value.kind === "absence") return value.absence === "undefined" ? 2 : 4;
    if (value.kind === "group") return expression(value.operand, state);
    if (value.kind === "update") {
      const local = state.get(localReferenceTarget(value.operand)?.binding);
      if (!local) fail();
      local.states = 1; return 1;
    }
    if (value.kind === "write") {
      const id = localReferenceTarget(value.left)?.binding, local = state.get(id);
      if (!local) fail();
      const previous = local.states;
      const conditional = ["??=", "&&=", "||="].includes(value.operator);
      const right = conditional ? cloneLocals(state) : state;
      if (value.operator === "??=") right.get(id).states &= 6;
      if (value.operator === "&&=") right.get(id).states &= 1;
      const result = expression(value.right, right);
      if (conditional) merge(state, [state, right]);
      local.states = value.operator === "??=" ? (previous & 1) | (previous & 6 ? result : 0)
        : value.operator === "&&=" ? previous | (previous & 1 ? result : 0)
        : value.operator === "||=" ? (previous & 1) | result
        : value.operator === "=" ? result : 1;
      return local.states;
    }
    if (value.kind === "shortCircuit") {
      expression(value.left, state);
      const selected = cloneLocals(state), skipped = cloneLocals(state);
      narrowLocals(selected, value.left, value.operator === "&&");
      narrowLocals(skipped, value.left, value.operator !== "&&");
      expression(value.right, selected); merge(state, [selected, skipped]); return 1;
    }
    if (["binary", "presenceTest"].includes(value.kind)) { expression(value.left, state); expression(value.right, state); }
    else if (["unary", "conversion"].includes(value.kind)) expression(value.operand, state);
    else if (value.kind === "call") { for (const argument of value.arguments) expression(argument, state); }
    else if (!["constant", "floating", "boolean"].includes(value.kind)) fail();
    return 1;
  };
  const body = (statements, state, depth) => {
    if (depth > 128 || !Array.isArray(statements)) fail();
    for (const item of statements) {
      tick();
      if (item.kind === "local") {
        const states = item.initializer ? expression(item.initializer, state) : 2;
        state.set(item.binding.id, { ...item.binding, states });
      } else if (item.kind === "assign") {
        const states = expression(item.value, state), local = state.get(item.target.binding);
        if (!local) fail();
        local.states = states;
      } else if (item.kind === "evaluate") expression(item.value, state);
      else if (item.kind === "return") { expression(item.value, state); return true; }
      else if (item.kind === "block") {
        const scoped = cloneLocals(state), returned = body(item.body, scoped, depth + 1);
        merge(state, [scoped]); if (returned) return true;
      } else if (item.kind === "if") {
        expression(item.condition, state);
        const left = cloneLocals(state), right = cloneLocals(state);
        narrowLocals(left, item.condition, true); narrowLocals(right, item.condition, false);
        const leftReturn = body(item.thenBody, left, depth + 1), rightReturn = body(item.elseBody, right, depth + 1);
        merge(state, leftReturn ? [right] : rightReturn ? [left] : [left, right]);
        if (leftReturn && rightReturn) return true;
      } else if (item.kind === "while") loop(item, state, depth + 1);
      else fail();
    }
    return false;
  };
  const loop = (item, state, depth) => {
    const initial = cloneLocals(state), head = cloneLocals(state);
    // Each successful iteration adds at least one of three state bits to a
    // finite binding set. No runtime block/register/argument limit changes.
    for (let iteration = 0; iteration <= state.size * 3; iteration++) {
      const savedBudget = remaining; remaining = 4096;
      const back = cloneLocals(head);
      expression(item.condition, back); narrowLocals(back, item.condition, true);
      const returned = body(item.body, back, depth);
      remaining = savedBudget;
      let changed = false;
      for (const [id, local] of head) {
        const states = local.states | initial.get(id).states | (returned ? 0 : back.get(id).states);
        changed ||= states !== local.states; local.states = states;
      }
      if (!changed) {
        merge(state, [head]); expression(item.condition, state); narrowLocals(state, item.condition, false);
        return head;
      }
    }
    fail();
  };
  // The normal verifier consumes the loop condition itself; install the
  // fixed head rather than the abstract exit's narrowed state here.
  const head = loop(statement, cloneLocals(locals), 0);
  merge(locals, [head]);
}
function verifyExpression(value, parent, source, fail, budget, locals, visibleBindings, allowedStates = 1) {
  if (--budget.remaining < 0 || !value || !Object.values(types).includes(value.type)
      || !range(value.range, parent)) fail();
  if (value.kind === "reference") {
    const local = locals.get(value.binding);
    if (!exactKeys(value, ["kind", "type", "binding", "range", ...(hasState(local?.presence) ? ["presenceFlow"] : [])])) fail();
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
    if (hasState(local.presence)) {
      const flow = value.presenceFlow;
      if (!validPresenceFlow(flow,local.presence)
          || flow.undefined !== Boolean(local.states & 2) || flow.null !== Boolean(local.states & 4)) fail();
    }
    if (local.states & ~allowedStates) {
      const error = new TypeError("r03-hir-presence: payload read requires a dominating presence proof");
      Object.assign(error,{code:"r03-hir-presence",ruleId:"r01-evaluation",phase:"hir",primary:{sourceId:budget.sourcePath,...value.range}});
      throw error;
    }
  } else if (value.kind === "absence") {
    if (!exactKeys(value,["kind","type","range","absence"]) || !["undefined","null"].includes(value.absence)
        || sourceTokens(source,value.range.start,value.range.end) !== value.absence
        || value.absence === "undefined" && visibleBindings.has("undefined")
        || !(allowedStates & (value.absence === "undefined" ? 2 : 4))) fail();
  } else if (value.kind === "presenceTest") {
    const left=expressionLeaf(value.left),right=expressionLeaf(value.right);
    const reference=left?.kind === "reference" ? left : right;
    const absence=left?.kind === "absence" ? left : right;
    const local=locals.get(reference?.binding);
    if (!exactKeys(value,["kind","type","range","operator","left","right"]) || value.type !== boolTypeId
        || !["===","!=="].includes(value.operator) || !local || !hasState(local.presence)
        || reference?.kind !== "reference" || absence?.kind !== "absence" || reference.type !== absence.type
        || value.left.range.end > value.right.range.start
        || sourceTokens(source,value.range.start,value.left.range.start) !== ""
        || !scalarOperator(source,value.left.range.end,value.right.range.start,value.operator)
        || sourceTokens(source,value.right.range.end,value.range.end) !== "") fail();
    verifyExpression(value.left,value.range,source,fail,budget,locals,visibleBindings,left === reference ? declaredStates(local.presence) : 7);
    verifyExpression(value.right,value.range,source,fail,budget,locals,visibleBindings,right === reference ? declaredStates(local.presence) : 7);
  } else if (value.kind === "update") {
    const target = localReferenceTarget(value.operand);
    if (!exactKeys(value, ["kind", "type", "range", "operator", "prefix", "operand"])
        || !["++", "--"].includes(value.operator) || typeof value.prefix !== "boolean"
        || !target || value.type !== value.operand.type
        || !locals.get(target.binding)?.writable || !integerType(value.type) && !floatType(value.type)
        || sourceTokens(source, value.range.start, value.operand.range.start) !== (value.prefix ? value.operator : "")
        || sourceTokens(source, value.operand.range.end, value.range.end) !== (value.prefix ? "" : value.operator)) fail();
    verifyExpression(value.operand, value.range, source, fail, budget, locals, visibleBindings);
  } else if (value.kind === "write") {
    const target = localReferenceTarget(value.left), local = locals.get(target?.binding);
    const logical = ["&&=","||="].includes(value.operator);
    if (!exactKeys(value, ["kind", "type", "range", "operator", "left", "right", ...(logical ? ["presenceFlow"] : [])])
        || !["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||=", "??="].includes(value.operator)
        || !exactKeys(target, ["kind", "type", "binding", "range", ...(hasState(local?.presence) ? ["presenceFlow"] : [])]) || target.kind !== "reference"
        || !local?.writable || visibleBindings.get(local.name) !== target.binding
        || target.type !== local.type || value.type !== local.type
        || value.right?.type !== (["<<=", ">>=", ">>>="].includes(value.operator) ? i32TypeId : local.type)
        || !range(value.left.range, value.range) || value.left.range.end > value.right.range.start
        || identifierToken(source, target.range) !== local.name
        || sourceTokens(source, value.range.start, value.left.range.start) !== ""
        || !scalarOperator(source, value.left.range.end, value.right.range.start, value.operator)
        || sourceTokens(source, value.right.range.end, value.range.end) !== "") fail();
    // Validate every explicit group without reading the assignment target:
    // bare locals remain safe targets of = and ??= before initialization.
    for (let group = value.left; group !== target; group = group.operand) {
      if (--budget.remaining < 0 || !exactKeys(group,["kind","type","operand","range"])
          || group.kind !== "group" || group.type !== target.type || !range(group.operand?.range,group.range)
          || sourceTokens(source,group.range.start,group.operand.range.start) !== "("
          || sourceTokens(source,group.operand.range.end,group.range.end) !== ")") fail();
    }
    if (hasState(local.presence) && !validPresenceFlow(target.presenceFlow,local.presence)) fail();
    if (value.operator === "??=" || logical) {
      // The official checker classifies coalescing assignment as a definite
      // target and returns its declared members, independently of read flow.
      const targetStates=hasState(local.presence) ? annotationStates(local.presence,source) | (local.presence.optional && !local.presence.default ? 2 : 0) : 1;
      if (hasState(local.presence) && (target.presenceFlow.undefined !== Boolean(targetStates & 2) || target.presenceFlow.null !== Boolean(targetStates & 4))) fail();
    }
    else if (value.operator !== "=") {
      if (["&&=", "||="].includes(value.operator) ? local.type !== boolTypeId
          : !integerType(local.type) && !(floatType(local.type) && ["+=", "-=", "*=", "/=", "%="].includes(value.operator))) fail();
      verifyExpression(target, value.range, source, fail, budget, locals, visibleBindings);
    }
    if (logical && (local.type !== boolTypeId || !validPresenceFlow(value.presenceFlow,local.presence??{undefined:false,null:false}))) fail();
    const nullish = value.operator === "??=", previousStates=local.states;
    const conditionalWrite = ["&&=", "||=", "??="].includes(value.operator);
    const rightLocals = conditionalWrite ? new Map([...locals].map(([id, item]) => [id, { ...item }])) : locals;
    if (nullish) rightLocals.get(target.binding).states &= 6;
    if (value.operator === "&&=") rightLocals.get(target.binding).states &= 1;
    verifyExpression(value.right, value.range, source, fail, budget, rightLocals, visibleBindings,value.operator === "=" || nullish || logical ? declaredStates(local.presence) : 1);
    if (conditionalWrite) for (const [id,binding] of locals) {
      binding.initialized &&= rightLocals.get(id).initialized;
      binding.states |= rightLocals.get(id).states;
    }
    local.initialized = value.operator === "&&=" ? local.initialized : true;
    local.states = nullish ? (previousStates & 1) | (previousStates & 6 ? expressionStates(value.right,rightLocals) : 0)
      : value.operator === "&&=" ? previousStates | (previousStates & 1 ? expressionStates(value.right,rightLocals) : 0)
      : value.operator === "||=" ? (previousStates & 1) | expressionStates(value.right,rightLocals)
      : expressionStates(value.right,rightLocals);
    if (logical) {
      // The official definite-target expression type can retain declared
      // members even when a preceding guard proves the runtime slot present.
      // Authenticate that whole-result role separately from runtime SSA state.
      const officialMissing=checkedExpressionPresence(value.right) | (value.operator === "&&=" ? checkedExpressionPresence(target) : 0);
      if (value.presenceFlow.undefined !== Boolean(officialMissing & 2) || value.presenceFlow.null !== Boolean(officialMissing & 4)
          || officialMissing & ~allowedStates) fail();
    }
    if (local.states & ~allowedStates) fail();
  } else if (value.kind === "conversion") {
    const entry = conversionEntries.get(value.origin?.entryId);
    if (!exactKeys(value, ["kind", "type", "range", "origin", "operand"]) || !verifyConversionOrigin(value.origin, budget.inputIdentity)
        || !admittedConversionScope(budget.inputScope,budget.inputIdentity) || value.origin.declarationPath !== budget.inputScope.declarations.paths[0]
        || value.type !== types[entry.to] || value.operand?.type !== types[entry.from]
        || !budget.completeSource || visibleBindings.has(entry.name) || [...budget.functions.values()].some(fn => fn.name === entry.name)
        || !conversionCallSpelling(source, value.range, value.operand.range, entry)) fail();
    verifyExpression(value.operand, value.range, source, fail, budget, locals, visibleBindings);
  } else if (value.kind === "call") {
    const target = budget.functions.get(value.target);
    if (!exactKeys(value, ["kind", "type", "range", "target", "signatureHash", "arguments"])
        || !target || target.signatureHash !== value.signatureHash || target.returnType.id !== value.type
        || visibleBindings.has(target.name) || !Array.isArray(value.arguments)
        || value.arguments.length > target.parameters.length
        || target.parameters.slice(value.arguments.length).some(p => !p.presence?.optional)) fail();
    let previous = value.range.start;
    for (const [index, argument] of value.arguments.entries()) {
      verifyExpression(argument, value.range, source, fail, budget, locals, visibleBindings,declaredStates(target.parameters[index].presence));
      const prefix = sourceTrivia(source, previous, argument.range.start).trim();
      if (argument.type !== target.parameters[index].type || argument.range.start < previous) fail();
      if (argument.kind === "absence" && !target.parameters[index].presence?.[argument.absence]) fail();
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
    verifyExpression(value.operand, value.range, source, fail, budget, locals, visibleBindings,group ? allowedStates : 1);
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
        || !(short ? ["&&", "||"].includes(value.operator) : Object.hasOwn(operations, value.operator))) fail();
    verifyExpression(value.left, value.range, source, fail, budget, locals, visibleBindings);
    const rightLocals = short ? cloneLocals(locals) : locals;
    if (short) narrowLocals(rightLocals,value.left,value.operator === "&&");
    verifyExpression(value.right, value.range, source, fail, budget, rightLocals, visibleBindings);
    if (short) {
      const shortcut=cloneLocals(locals); narrowLocals(shortcut,value.left,value.operator !== "&&");
      for (const [id, local] of locals) { local.initialized &&= rightLocals.get(id).initialized; local.states=shortcut.get(id).states | rightLocals.get(id).states; }
    }
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
  return ["block", "return", "assign", "evaluate"].includes(statement.kind);
}

export function verifyHir(hir) {
  const fail = () => { throw new TypeError("r03-hir-invalid: owned HIR identity, type, source or structure differs"); };
  if (!exactKeys(hir, ["contractVersion", "schemaHash", "inputIdentity", "source", "target", "functions", "inputScope"])
      || hir.contractVersion !== contract()?.semver || hir.schemaHash !== contract()?.schemaHash
      || !admittedInputScope(hir.inputScope, hir.inputIdentity)
      || hir.inputScope?.rootFile !== hir.source?.path || hir.inputScope?.files?.find(file=>file.path===hir.source.path)?.content !== hir.source.content
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
  const completeSource = completeFunctionSource(hir.source.content, hir.functions, identifierName);
  const parameterTypesByFunction = new Map();
  for (const fn of hir.functions) {
  if (!Array.isArray(fn.parameters)) fail();
  const parameterNames = fn.parameters.map(parameter => Object.entries(types).find(([,id]) => id === parameter?.type)?.[0]);
  if (!exactKeys(fn, ["id", "name", "signatureHash", "returnType", "parameters", "parameterInitializers", "range", "body"])
      || !validText(fn.name) || !Object.hasOwn(types, fn.returnType?.name)
      || fn.id !== presenceIdentity(hir.source.path, fn.name, fn.returnType.name, fn.parameters)
      || fn.signatureHash !== presenceSignature(fn.returnType.name, fn.parameters)
      || canonical(fn.returnType) !== canonical({ kind: "scalar", name: fn.returnType.name, id: types[fn.returnType.name] })
      || !Array.isArray(fn.parameters) || fn.parameters.length > 64 || parameterNames.some(name => !name)
      || !range(fn.range, { start: 0, end: hir.source.content.length })
      || !Array.isArray(fn.parameterInitializers) || fn.parameterInitializers.length !== fn.parameters.length
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
  const budget = { remaining: 4096, sourcePath: hir.source.path, declarations, functions, completeSource, inputScope:hir.inputScope, inputIdentity:hir.inputIdentity };
  const clone = cloneLocals;
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
            || !bindingFact(binding, statement.range, source) || binding.presence && !validLocalPresence(binding.presence,binding,value,source,statement.range) || ids.has(binding.id)
            || binding.id !== `l${ids.size}` || names.has(binding.name)
            || sourceTokens(source, statement.range.start, binding.range.start) !== "") fail();
        const keyword = before.match(/^;?(const|let)$/)?.[1];
        if (keyword) declarationKind = keyword;
        else if (before !== "," || !declarationKind) fail();
        if (binding.writable !== (declarationKind === "let")) fail();
        const annotations = binding.type === boolTypeId ? [":bool", ":boolean"] : binding.type === types.f64 ? [":f64", ":number"] : [`:${scalarName(binding.type)}`];
        if (value !== null) {
          verifyExpression(value, statement.range, source, fail, budget, locals, visibleBindings,declaredStates(binding.presence));
          const annotation = sourceTokens(source, binding.range.end, value.range.start);
          if (value.type !== binding.type || !binding.presence && !["=", ...annotations.map(item => `${item}=`)].includes(annotation)
              || sourceTokens(source, value.range.end, statement.range.end) !== "") fail();
        } else if (!binding.writable || !binding.presence && !annotations.includes(sourceTokens(source, binding.range.end, statement.range.end))) fail();
        locals.set(binding.id, { ...binding, initialized: value !== null || binding.presence?.undefined === true,
          states: value ? expressionStates(value,locals) : 2 });
        names.add(binding.name); ids.add(binding.id);
      } else {
        declarationKind = undefined;
        if (!/^;?$/.test(before)) fail();
        if (statement.kind === "evaluate") {
          if (!exactKeys(statement, ["kind", "range", "value"])) fail();
          verifyExpression(statement.value, statement.range, source, fail, budget, locals, visibleBindings,7);
          if (sourceTokens(source, statement.range.start, statement.value.range.start) !== ""
              || !/^;?$/.test(sourceTokens(source, statement.value.range.end, statement.range.end))) fail();
        } else if (statement.kind === "block") {
          if (!exactKeys(statement, ["kind", "range", "body"])) fail();
          const scoped = clone(locals);
          const terminated = body(statement.body, statement.range, scoped, "block", visibleBindings);
          for (const [id, local] of locals) { local.initialized = scoped.get(id).initialized; local.states = scoped.get(id).states; }
          returns ||= terminated;
        } else if (statement.kind === "if" || statement.kind === "while") {
          const branch = statement.kind === "if", condition = statement.condition;
          if (!exactKeys(statement, branch ? ["kind", "range", "condition", "thenBody", "elseBody"]
              : ["kind", "range", "condition", "body"]) || condition?.type !== boolTypeId) fail();
          if (!branch) loopCarriedStates(statement,locals,fail);
          verifyExpression(condition, statement.range, source, fail, budget, locals, visibleBindings);
          const selected = branch ? statement.thenBody : statement.body;
          if (!Array.isArray(selected) || selected.length !== 1
              || sourceTokens(source, statement.range.start, condition.range.start) !== `${statement.kind}(`
              || sourceTokens(source, condition.range.end, selected[0]?.range.start) !== ")") fail();
          const left = clone(locals); narrowLocals(left,condition,true);
          const leftReturn = body(selected, { start: selected[0].range.start, end: selected.at(-1).range.end }, left, "plain", visibleBindings);
          let last = selected.at(-1).range.end;
          if (branch) {
            if (!Array.isArray(statement.elseBody) || statement.elseBody.length > 1) fail();
            const right = clone(locals);
            narrowLocals(right,condition,false);
            let rightReturn = false;
            if (statement.elseBody.length) {
              const alternative = statement.elseBody;
              if (!noShortIf(selected[0])
                  || sourceTokens(source, last, alternative[0].range.start) !== "else") fail();
              rightReturn = body(alternative, { start: alternative[0].range.start, end: alternative.at(-1).range.end }, right, "plain", visibleBindings);
              last = alternative.at(-1).range.end;
            }
            for (const [id, local] of locals) {
              local.initialized = leftReturn ? right.get(id).initialized : rightReturn ? left.get(id).initialized
                : left.get(id).initialized && right.get(id).initialized;
              local.states = leftReturn ? right.get(id).states : rightReturn ? left.get(id).states : left.get(id).states | right.get(id).states;
            }
            returns ||= leftReturn && rightReturn;
          } else {
            // Include every possible carried state on the loop's back edge.
            for (const [id,local] of locals) local.states |= left.get(id).states;
            narrowLocals(locals,condition,false);
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
                || !exactKeys(target, ["kind", "type", "binding", "range", ...(hasState(local?.presence) ? ["presenceFlow"] : [])]) || target.kind !== "reference"
                || !local?.writable || visibleBindings.get(local.name) !== target.binding
                || target.type !== local.type || value?.type !== local.type
                || !range(target.range, statement.range) || target.range.end > value.range.start
                || identifierToken(source, target.range) !== local.name
                || sourceTokens(source, statement.range.start, target.range.start) !== ""
                || sourceTokens(source, target.range.end, value.range.start) !== "="
                || hasState(local.presence) && !validPresenceFlow(target.presenceFlow,local.presence)) fail();
          } else fail();
          verifyExpression(value, statement.range, source, fail, budget, locals, visibleBindings,statement.kind === "assign" ? declaredStates(locals.get(statement.target.binding).presence) : 1);
          if (!/^;?$/.test(sourceTokens(source, value.range.end, statement.range.end))) fail();
          if (statement.kind === "assign") { const local=locals.get(statement.target.binding); local.initialized = true; local.states=expressionStates(value,locals); }
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
  if (fn.parameters.length) {
    let previous=fn.range.start;
    for (const [index,parameter] of fn.parameters.entries()) {
      const initializer=fn.parameterInitializers[index];
      if (!bindingFact(parameter,fn.range,source) || parameter.id !== `p${index}` || !parameter.writable
          || visible.has(parameter.name) || !validParameterPresence(parameter.presence,parameter,initializer,source,fn.range)) fail();
      const gap=sourceTrivia(source,previous,parameter.presence.range.start).trim();
      if (index === 0) {
        const opening=gap.match(/^(?:export\s+)?function\s+([^()]+)\(\s*$/);
        if (!opening || identifierToken(opening[1],{start:0,end:opening[1].length}) !== fn.name) fail();
      } else if (gap !== ",") fail();
      let initializerStates=0;
      if (initializer) {
        const before=clone(initial);
        verifyExpression(initializer,parameter.presence.range,source,fail,budget,initial,visible,annotationStates(parameter.presence,source));
        if (initializer.type !== parameter.type) fail();
        initializerStates=expressionStates(initializer,initial);
        for (const [id,local] of initial) {local.initialized &&=before.get(id).initialized;local.states |=before.get(id).states;}
      }
      initial.set(parameter.id,{...parameter,initialized:true,states:(declaredStates(parameter.presence) & (initializer ? ~2 : 7)) | initializerStates}); visible.set(parameter.name,parameter.id);
      previous=parameter.presence.range.end;
    }
    const ending=sourceTokens(source,previous,fn.body[0].range.start);
    const names=fn.returnType.name === "bool" ? ["bool","boolean"] : fn.returnType.name === "f64" ? ["f64","number"] : [fn.returnType.name];
    if (!names.some(name => ["",","].some(comma => [`${comma}):${name}{`, `${comma}):${name}{let`, `${comma}):${name}{const`].includes(ending)))) fail();
  } else {
  const header = sourceTrivia(source,fn.range.start,fn.body[0].range.start);
  const parsedHeader = header.match(/^\s*(?:export\s+)?function\s+([^()]+)\(([^()]*)\)\s*:\s*(i8|i16|i32|i64|u8|u16|u32|u64|isize|usize|bool|boolean|f32|f64|number)\s*\{\s*(?:(?:const|let)\s*)?$/d);
  if (!parsedHeader || identifierToken(parsedHeader[1],{start:0,end:parsedHeader[1].length}) !== fn.name
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
    initial.set(parameter.id, { ...parameter, initialized: true, states: 1 }); visible.set(parameter.name, parameter.id);
    parameterEnd = parameter.range.end;
    parameterStart += parameterTokens[index].length + 1;
  }
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
      || !["minimal-floats-v4", "minimal-conversions-v5"].includes(snapshot.capability) && (floatNames.includes(fn.returnType) || fn.parameters.some(p => floatNames.includes(p.type)))
      || fn.parameters.some(parameter => !types[parameter.type]) || fn.body.length < 1 || fn.body.length > 128)) {
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir",
      message: "current execution capability requires nominal integer/bool functions with direct calls, locals, structured control and returns",
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? first?.range ?? { start: 0, end: 0 }) } }] };
  }
  const functions = new Map(snapshot.functions.map(fn => {
    const parameters=fn.parameters.map((p,index) => ({id:`p${index}`,name:p.name,type:types[p.type],writable:true,range:p.range,presence:structuredClone(p.presence)}));
    return [fn.symbol.id, {
    id: presenceIdentity(snapshot.source.path, fn.name, fn.returnType, parameters), name: fn.name,
    signatureHash: presenceSignature(fn.returnType, parameters),
    returnType: { kind: "scalar", name: fn.returnType, id: types[fn.returnType] },
    parameters,
    range: fn.range,
  }]; }));
  const projectedFunctions = [];
  for (const fn of snapshot.functions) {
  const descriptor = functions.get(fn.symbol.id);
  const bindings = new Map();
  fn.parameters.forEach((p,index) => bindings.set(p.id, descriptor.parameters[index]));
  const project = (value, parentRange) => {
    const type = types[resolveType(snapshot, value.typeRef).scalar];
    if (!type) throw new TypeError("unsupported expression type");
    let projectedRange = value.range;
    if (["call", "conversion"].includes(value.kind) && parentRange && value.range.start < parentRange.start
        && sourceTrivia(snapshot.source.content, value.range.start, parentRange.start).trim() === "") {
      projectedRange = { ...value.range, start: parentRange.start };
    }
    const common = { type, range: projectedRange };
    if (value.kind === "reference") {
      const symbol = resolveSymbol(snapshot, value.symbol), binding = bindings.get(symbol.id);
      if (!binding) throw new TypeError("local reference has no preceding owned declaration");
      return { kind: "reference", ...common, binding: binding.id, ...(value.presenceFlow ? {presenceFlow:structuredClone(value.presenceFlow)} : {}) };
    }
    if (value.kind === "conversion") return {kind:"conversion",...common,origin:structuredClone(value.conversion),operand:project(value.operand,common.range)};
    if (value.kind === "call") {
      const target = functions.get(resolveSymbol(snapshot, value.target).id);
      if (!target) throw new TypeError("call target is outside owned function closure");
      return {kind:"call",...common,target:target.id,signatureHash:target.signatureHash,arguments:value.arguments.map(argument => project(argument, common.range))};
    }
    if (value.kind === "integer") return { kind: "constant", ...common, decimal: value.literal.decimal, token: value.literal.token };
    if (value.kind === "floating") return { kind: "floating", ...common, bits: value.float.bits, token: value.float.token };
    if (value.kind === "boolean") return { kind: "boolean", ...common, value: value.boolean };
    if (value.kind === "absence") return { kind:"absence", ...common, absence:value.absence };
    if (value.kind === "group") return { kind: "group", ...common, operand: project(value.operand, common.range) };
    if (value.kind === "write") return { kind: "write", ...common, operator: value.operator,
      left: project(value.left, common.range), right: project(value.right, common.range),
      ...(["&&=","||="].includes(value.operator) ? {presenceFlow:structuredClone(value.presenceFlow)} : {}) };
    if (value.kind === "presenceTest") return {kind:"presenceTest",...common,operator:value.operator,left:project(value.left,common.range),right:project(value.right,common.range)};
    if (value.kind === "update") return { kind: "update", ...common, operator: value.operator,
      prefix: value.prefix, operand: project(value.operand, common.range) };
    if (value.kind === "unary" && ["+", "-", "~", "!"].includes(value.operator))
      return { kind: "unary", ...common, operator: value.operator, operand: project(value.operand, common.range) };
    if (value.kind === "binary" && Object.hasOwn(operations, value.operator)
        || value.kind === "shortCircuit" && ["&&", "||"].includes(value.operator))
      return { kind: value.kind, ...common, operator: value.operator, left: project(value.left, common.range), right: project(value.right, common.range) };
    throw new TypeError("unsupported checked expression capability");
  };
  let projected;
  const statements = items => (items ?? []).map(item => {
    if (item.kind === "variable") {
      const symbol = resolveSymbol(snapshot, item.symbol.ref), type = types[symbol.type];
      if (symbol.kind !== "local" || !type) throw new TypeError("unsupported local type");
      const initializer = item.initializer ? project(item.initializer, item.range) : null;
      const binding = { id: `l${bindings.size - fn.parameters.length}`, name: symbol.name, type, writable: symbol.writable, range: symbol.range, ...(symbol.presence ? {presence:structuredClone(symbol.presence)} : {}) };
      bindings.set(symbol.id, binding);
      return { kind: "local", range: item.range, binding, initializer };
    }
    if (item.kind === "assignment") return { kind: "assign", range: item.range, target: project(item.target, item.range), value: project(item.value, item.range) };
    if (item.kind === "expression") return { kind: "evaluate", range: item.range, value: project(item.expression, item.range) };
    if (item.kind === "block") return { kind: "block", range: item.range, body: statements(item.body) };
    if (item.kind === "while") return { kind: "while", range: item.range, condition: project(item.condition, item.range), body: statements(item.body) };
    if (item.kind === "if") return { kind: "if", range: item.range, condition: project(item.condition, item.range),
      thenBody: statements(item.thenBody), elseBody: statements(item.elseBody) };
    if (item.kind === "return") return { kind: "return", range: item.range, value: project(item.expression, item.range) };
    throw new TypeError("unsupported checked statement capability");
  });
  try { projected = statements(fn.body); } catch (error) {
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir", message: error.message,
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? fn.range) } }] };
  }
  projectedFunctions.push({...descriptor,parameterInitializers:fn.parameterInitializers.map(value => value ? project(value,fn.range) : null),body:projected});
  }
  const hir = {
    contractVersion: contract().semver, schemaHash: contract().schemaHash, inputIdentity: snapshot.inputIdentity,
    source: { ...snapshot.source, hash: sha256(snapshot.source.content) }, target: bytecodeSchema.target,
    functions: projectedFunctions, inputScope: structuredClone(snapshot.identityInput),
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
  const attrs = ['tsfg_core.version = "0.10.0"', ...Object.entries(strings)
    .map(([key, item]) => `tsfg_core.${key} = ${quote(item)}`),
    `tsfg_core.source_length = ${verified.source.content.length} : i64`];
  const lowerFunction = fn => {
  const blocks = [], bindingTypes = new Map(), bindingStates = new Map();
  // Bare locals have a private, canonical undefined initial state even when
  // their annotation excludes undefined. This flag never changes parameter
  // membership or the public ABI; verified reads require initialization.
  const bareLocals=new Set();
  const collectBare=statements=>{for(const statement of statements){
    if(statement.kind === "local" && !statement.initializer) bareLocals.add(statement.binding.id);
    else if(statement.kind === "if") {collectBare(statement.thenBody);collectBare(statement.elseBody);}
    else if(["block","while"].includes(statement.kind))collectBare(statement.body);
  }};
  collectBare(fn.body);
  let valueIndex = 0, current, definitions = new Map(), declared = new Set();
  const coreType = type => type === i32TypeId ? "i32" : type === boolTypeId ? "i1" : floatType(type) ? scalarName(type) : `!tsfg_core.integer<${quote(scalarName(type))}>`;
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
  const flatTypes = keys => keys.flatMap(id => [bindingTypes.get(id), ...(bindingStates.get(id) ? [i32TypeId] : [])]);
  const flatValues = (keys, values) => keys.flatMap(id => [values.get(id).payload, ...(bindingStates.get(id) ? [values.get(id).state] : [])]);
  const fromParameters = (keys, parameters, start=0) => {
    let index=start;
    return new Map(keys.map(id => [id,{payload:parameters[index++].name, state:bindingStates.get(id) ? parameters[index++].name : null}]));
  };
  fn.parameters.forEach(parameter => {
    declared.add(parameter.id); bindingTypes.set(parameter.id,parameter.type); bindingStates.set(parameter.id,hasState(parameter.presence));
  });
  const parameterKeys=fn.parameters.map(parameter => parameter.id);
  current = newBlock(flatTypes(parameterKeys));
  definitions=fromParameters(parameterKeys,current.parameters);
  fuel(1, fn.range);
  const scalarConstant = (type, token, anchor) => {
    const name=`%v${valueIndex++}`, core=coreType(type);
    const value=floatType(type) ? quote(floatBits(token,scalarName(type))) : type === i32TypeId ? `${token} : ${core}` : type === boolTypeId ? `${token} : i1` : quote(token);
    current.lines.push(`    ${name} = "tsfg_core.constant"() {value = ${value}, ${attrsFor(anchor)}} : () -> ${core}`);
    return name;
  };
  const represent = expression => expression.kind === "group" ? represent(expression.operand)
    : expression.kind === "write" ? (emit(expression),definitions.get(localReferenceTarget(expression.left).binding))
    : expression.kind === "reference" ? definitions.get(expression.binding)
    : expression.kind === "absence" ? {payload:scalarConstant(expression.type,"0",expression.range),state:scalarConstant(i32TypeId,expression.absence === "undefined" ? "1" : "2",expression.range)}
      : {payload:emit(expression),state:null};
  const store = (id, value, anchor) => definitions.set(id,{payload:value.payload,
    state:bindingStates.get(id) ? value.state ?? scalarConstant(i32TypeId,"0",anchor) : null});
  const emit = expression => {
    if (expression.kind === "reference") return definitions.get(expression.binding).payload;
    if (expression.kind === "presenceTest") {
      const left=expressionLeaf(expression.left),right=expressionLeaf(expression.right);
      const reference=left.kind === "reference" ? left : right;
      const absent=left.kind === "absence" ? left : right;
      const state=definitions.get(reference.binding).state, tag=scalarConstant(i32TypeId,absent.absence === "undefined" ? "1" : "2",absent.range), name=`%v${valueIndex++}`;
      current.lines.push(`    ${name} = "tsfg_core.${operations[expression.operator]}"(${state}, ${tag}) {${attrsFor(expression.range)}} : (i32, i32) -> i1`);
      return name;
    }
    if (expression.kind === "update") {
      const old = emit(expression.operand), one = `%v${valueIndex++}`, next = `%v${valueIndex++}`, type = coreType(expression.type);
      const value = floatType(expression.type) ? quote(floatBits("1", scalarName(expression.type)))
        : expression.type === i32TypeId ? `1 : ${type}` : quote("1");
      current.lines.push(`    ${one} = "tsfg_core.constant"() {value = ${value}, ${attrsFor(expression.range)}} : () -> ${type}`);
      current.lines.push(`    ${next} = "tsfg_core.${expression.operator === "++" ? "add" : "sub"}"(${old}, ${one}) {${attrsFor(expression.range)}} : (${type}, ${type}) -> ${type}`);
      store(localReferenceTarget(expression.operand).binding,{payload:next,state:null},expression.range);
      return expression.prefix ? next : old;
    }
    if (expression.kind === "write") {
      const target = localReferenceTarget(expression.left);
      if (expression.operator === "??=") {
        const old=definitions.get(target.binding);
        if (!bindingStates.get(target.binding)) return old.payload;
        const incoming=new Map(definitions), keys=[...incoming.keys()];
        const zero=scalarConstant(i32TypeId,"0",expression.left.range), condition=`%v${valueIndex++}`;
        current.lines.push(`    ${condition} = "tsfg_core.ne"(${old.state}, ${zero}) {${attrsFor(expression.range)}} : (i32, i32) -> i1`);
        const rhs=newBlock(),shortcut=newBlock(),join=newBlock(flatTypes(keys));
        conditional(condition,rhs,shortcut,expression.range);
        current=shortcut;branch(join,flatValues(keys,incoming),expression.range);
        current=rhs;definitions=new Map(incoming);
        store(target.binding,represent(expression.right),expression.range);
        branch(join,flatValues(keys,definitions),expression.range);
        current=join;definitions=fromParameters(keys,join.parameters);
        return definitions.get(target.binding).payload;
      }
      if (["&&=", "||="].includes(expression.operator)) {
        const value = emit({ kind:"shortCircuit", type:boolTypeId, operator:expression.operator.slice(0,-1), left:expression.left,
          right:{...expression, operator:"="}, range:expression.range });
        return value;
      }
      // Compound assignment captures the old definition before evaluating a
      // RHS that can replace that very binding. Each RHS is emitted once.
      const old = expression.operator === "=" ? null : emit(expression.left);
      const representation=represent(expression.right);
      let value = representation.payload;
      if (expression.operator !== "=") {
        const name = `%v${valueIndex++}`, type = coreType(expression.type);
        current.lines.push(`    ${name} = "tsfg_core.${operations[expression.operator.slice(0,-1)]}"(${old}, ${value}) {${attrsFor(expression.range)}} : (${type}, ${coreType(expression.right.type)}) -> ${type}`);
        value = name;
      }
      store(target.binding,{payload:value,state:expression.operator === "=" ? representation.state : null},expression.range);
      return value;
    }
    if (expression.kind === "conversion") {
      const operand=emit(expression.operand), entry=conversionEntries.get(expression.origin.entryId), name=`%v${valueIndex++}`;
      const op={checked:"convert_checked",wrap:"convert_wrap",reinterpret:"reinterpret"}[entry.mode];
      current.lines.push(`    ${name} = "tsfg_core.${op}"(${operand}) {${attrsFor(expression.range)}} : (${coreType(expression.operand.type)}) -> ${coreType(expression.type)}`);
      return name;
    }
    if (expression.kind === "call") {
      const values=expression.arguments.map(represent), target = verified.functions.find(fn => fn.id === expression.target);
      const operands=target.parameters.flatMap((parameter,index) => {
        const value=values[index] ?? {payload:scalarConstant(parameter.type,"0",expression.range),state:scalarConstant(i32TypeId,"1",expression.range)};
        return [value.payload,...(hasState(parameter.presence) ? [value.state ?? scalarConstant(i32TypeId,"0",expression.range)] : [])];
      });
      const argumentTypes=target.parameters.flatMap(parameter => [parameter.type,...(hasState(parameter.presence) ? [i32TypeId] : [])]);
      const name = `%v${valueIndex++}`;
      current.lines.push(`    ${name} = "func.call"(${operands.join(", ")}) {callee = @${quote(target.name)}, tsfg_core.function_id = ${quote(target.id)}, tsfg_core.signature_hash = ${quote(target.signatureHash)}, ${attrsFor(expression.range)}} : (${argumentTypes.map(coreType).join(", ")}) -> ${coreType(expression.type)}`);
      return name;
    }
    if (expression.kind === "group" || expression.kind === "unary" && expression.operator === "+" && !floatType(expression.type)) return emit(expression.operand);
    if (expression.kind === "shortCircuit") {
      const left = emit(expression.left);
      const incoming = new Map(definitions), keys = [...incoming.keys()];
      const rhs = newBlock(), shortcut = newBlock(), join = newBlock([boolTypeId, ...flatTypes(keys)]);
      conditional(left, expression.operator === "&&" ? rhs : shortcut, expression.operator === "&&" ? shortcut : rhs, expression.range);
      current = shortcut; branch(join, [left, ...flatValues(keys,incoming)], expression.range);
      current = rhs; definitions = new Map(incoming);
      const right = emit(expression.right); branch(join, [right, ...flatValues(keys,definitions)], expression.range);
      current = join; definitions = fromParameters(keys,join.parameters,1);
      return join.parameters[0].name;
    }
    const operands = expression.kind === "binary" ? [emit(expression.left), emit(expression.right)]
      : expression.kind === "unary" ? [emit(expression.operand)] : [];
    const name = `%v${valueIndex++}`, type = coreType(expression.type);
    const constant = ["constant", "boolean", "floating"].includes(expression.kind);
    const op = constant ? "constant" : expression.kind === "binary" ? operations[expression.operator]
      : ({ "+": "pos", "-": "neg", "~": "not", "!": "bool_not" })[expression.operator];
    const valueAttr = expression.kind === "floating" ? `value = ${quote(expression.bits)}, ` : constant ? expression.kind === "constant" && expression.type !== i32TypeId
      ? `value = ${quote(expression.decimal)}, `
      : `value = ${expression.kind === "constant" ? expression.decimal : Number(expression.value)} : ${type}, ` : "";
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
        bindingStates.set(statement.binding.id,hasState(statement.binding.presence) || bareLocals.has(statement.binding.id));
        if (statement.initializer) store(statement.binding.id,represent(statement.initializer),statement.range);
        else store(statement.binding.id,
          {payload:scalarConstant(statement.binding.type,"0",statement.range),state:scalarConstant(i32TypeId,"1",statement.range)},statement.range);
      } else if (statement.kind === "assign") store(statement.target.binding,represent(statement.value),statement.range);
      else if (statement.kind === "evaluate") emit(statement.value);
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
          const join = newBlock(flatTypes(keys));
          if (yesExit) { current = yesExit; branch(join, flatValues(keys,yesDefinitions), statement.range); }
          if (noExit) { current = noExit; branch(join, flatValues(keys,noDefinitions), statement.range); }
          current = join; definitions = fromParameters(keys,join.parameters);
        } else { current = null; definitions = outer; }
        declared = outerDeclared;
      } else if (statement.kind === "while") {
        const outer = new Map(definitions), outerDeclared = new Set(declared), keys = [...outer.keys()];
        const header = newBlock(flatTypes(keys));
        branch(header, flatValues(keys,outer), statement.condition.range);
        current = header; definitions = fromParameters(keys,header.parameters);
        fuel(2, statement.condition.range);
        const condition = emit(statement.condition), incoming = new Map(definitions);
        const loop = newBlock(), exit = newBlock();
        conditional(condition, loop, exit, statement.condition.range);
        current = loop; definitions = new Map(incoming); emitBody(statement.body);
        if (current) branch(header, flatValues(keys,definitions), statement.condition.range);
        current = exit; definitions = incoming; declared = outerDeclared;
      }
    }
  };
  for (const [index,parameter] of fn.parameters.entries()) {
    const initializer=fn.parameterInitializers[index];
    if (!initializer) continue;
    const incoming=new Map(definitions), one=scalarConstant(i32TypeId,"1",parameter.presence.range), condition=`%v${valueIndex++}`;
    current.lines.push(`    ${condition} = "tsfg_core.eq"(${incoming.get(parameter.id).state}, ${one}) {${attrsFor(parameter.presence.range)}} : (i32, i32) -> i1`);
    const initialize=newBlock(), supplied=newBlock();
    conditional(condition,initialize,supplied,parameter.presence.range);
    current=initialize; definitions=new Map(incoming);
    store(parameter.id,represent(initializer),initializer.range);
    const initializedExit=current, initialized=new Map(definitions);
    // Unchanged definitions already dominate both branches. Merge every actual
    // initializer effect, including writes to earlier parameters, once.
    const keys=[...incoming.keys()].filter(id => {
      const before=incoming.get(id), after=initialized.get(id);
      return before.payload !== after.payload || before.state !== after.state;
    });
    const join=newBlock(flatTypes(keys));
    current=supplied; branch(join,flatValues(keys,incoming),parameter.presence.range);
    current=initializedExit; branch(join,flatValues(keys,initialized),parameter.presence.range);
    current=join; definitions=new Map([...incoming,...fromParameters(keys,join.parameters)]);
  }
  emitBody(fn.body);
  if (current || blocks.some(block => !block.terminated)) throw new TypeError("r03-hir-cfg: reachable function fallthrough");
  const type = coreType(fn.returnType.id);
  const text = blocks.map((block, index) => `${index ? `  ^${block.name}${block.parameters.length ? `(${block.parameters.map(p => `${p.name}: ${coreType(p.type)}`).join(", ")})` : ""}:\n` : ""}${block.lines.join("\n")}`).join("\n");
  const functionAttrs = `tsfg_core.function_id = ${quote(fn.id)}, tsfg_core.signature_hash = ${quote(fn.signatureHash)}, tsfg_core.type_id = ${quote(fn.returnType.id)}, tsfg_core.parameter_presence = ${quote(presenceEncoding(fn.parameters))}, tsfg_core.function_start = ${fn.range.start} : i64, tsfg_core.function_end = ${fn.range.end} : i64`;
  return `  func.func @${quote(fn.name)}(${blocks[0].parameters.map(p => `${p.name}: ${coreType(p.type)}`).join(", ")}) -> ${type} attributes {${functionAttrs}} {\n${text}\n  }`;
  };
  return `module attributes {${attrs.join(", ")}} {\n${verified.functions.map(lowerFunction).join("\n")}\n}\n`;
}
