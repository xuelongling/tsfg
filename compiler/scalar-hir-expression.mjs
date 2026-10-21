// SPDX-License-Identifier: MIT
import { sourceTrivia } from './module-facts.mjs';
import { localReferenceTarget, expressionLeaf, hasOnlyToken } from './scalar-source.mjs';
import { scalarName, scalarTypeIds, i32TypeId, boolTypeId, integerNames, integerRange } from './identity.mjs';
import { floatNames, floatBits } from './float.mjs';
import { conversionEntries, verifyConversionOrigin, conversionCallSpelling, admittedConversionScope } from './conversions.mjs';
import { hasState, annotationStates, validPresenceFlow } from './presence.mjs';
import { checkedExpressionPresence, operations, comparisons, precedence, expressionPrecedence, sourceTokens, identifierToken, scalarOperator, declaredStates, cloneLocals, expressionStates, narrowLocals, range } from './scalar-hir-state.mjs';
const types=scalarTypeIds;
const exactKeys=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const integerType=id=>integerNames.includes(scalarName(id));
const floatType=id=>floatNames.includes(scalarName(id));
export function verifyScalarExpression(value, parent, source, fail, budget, locals, visibleBindings, allowedStates = 1) {
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
        || (value.absence === "undefined" ? identifierToken(source,value.range) !== "undefined"
          : !hasOnlyToken(source.slice(value.range.start,value.range.end), "null"))
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
    verifyScalarExpression(value.left,value.range,source,fail,budget,locals,visibleBindings,left === reference ? declaredStates(local.presence) : 7);
    verifyScalarExpression(value.right,value.range,source,fail,budget,locals,visibleBindings,right === reference ? declaredStates(local.presence) : 7);
  } else if (value.kind === "update") {
    const target = localReferenceTarget(value.operand);
    if (!exactKeys(value, ["kind", "type", "range", "operator", "prefix", "operand"])
        || !["++", "--"].includes(value.operator) || typeof value.prefix !== "boolean"
        || !target || value.type !== value.operand.type
        || !locals.get(target.binding)?.writable || !integerType(value.type) && !floatType(value.type)
        || (value.prefix ? !scalarOperator(source, value.range.start, value.operand.range.start, value.operator)
          : sourceTokens(source, value.range.start, value.operand.range.start) !== "")
        || (value.prefix ? sourceTokens(source, value.operand.range.end, value.range.end) !== ""
          : !scalarOperator(source, value.operand.range.end, value.range.end, value.operator)
            || /[\r\n\u2028\u2029]/.test(source.slice(value.operand.range.end, value.range.end)))) fail();
    verifyScalarExpression(value.operand, value.range, source, fail, budget, locals, visibleBindings);
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
      verifyScalarExpression(target, value.range, source, fail, budget, locals, visibleBindings);
    }
    if (logical && (local.type !== boolTypeId || !validPresenceFlow(value.presenceFlow,local.presence??{undefined:false,null:false}))) fail();
    const nullish = value.operator === "??=", previousStates=local.states;
    const conditionalWrite = ["&&=", "||=", "??="].includes(value.operator);
    const rightLocals = conditionalWrite ? new Map([...locals].map(([id, item]) => [id, { ...item }])) : locals;
    if (nullish) rightLocals.get(target.binding).states &= 6;
    if (value.operator === "&&=") rightLocals.get(target.binding).states &= 1;
    verifyScalarExpression(value.right, value.range, source, fail, budget, rightLocals, visibleBindings,value.operator === "=" || nullish || logical ? declaredStates(local.presence) : 1);
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
    verifyScalarExpression(value.operand, value.range, source, fail, budget, locals, visibleBindings);
  } else if (value.kind === "call") {
    const target = budget.functions.get(value.target);
    if (!exactKeys(value, ["kind", "type", "range", "target", "signatureHash", "arguments"])
        || !target || target.signatureHash !== value.signatureHash || target.returnType.id !== value.type
        || visibleBindings.has(target.name) || !Array.isArray(value.arguments)
        || value.arguments.length > target.parameters.length
        || target.parameters.slice(value.arguments.length).some(p => !p.presence?.optional)) fail();
    let previous = value.range.start;
    for (const [index, argument] of value.arguments.entries()) {
      verifyScalarExpression(argument, value.range, source, fail, budget, locals, visibleBindings,declaredStates(target.parameters[index].presence));
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
    verifyScalarExpression(value.operand, value.range, source, fail, budget, locals, visibleBindings,group ? allowedStates : 1);
    if (!(group ? sourceTokens(source, value.range.start, value.operand.range.start) === "("
        : scalarOperator(source, value.range.start, value.operand.range.start, value.operator))
        || sourceTokens(source, value.operand.range.end, value.range.end) !== (group ? ")" : "")
        || value.type !== value.operand.type || (!group && (expressionPrecedence(value.operand) < 9
        || !["+", "-", "~", "!"].includes(value.operator)
        || (value.operator === "!" ? value.type !== boolTypeId : !integerType(value.type)
          && !(floatType(value.type) && ["+", "-"].includes(value.operator)))))) fail();
  } else if (value.kind === "binary" || value.kind === "shortCircuit") {
    const short = value.kind === "shortCircuit";
    if (!exactKeys(value, ["kind", "type", "operator", "left", "right", "range"])
        || !(short ? ["&&", "||"].includes(value.operator) : Object.hasOwn(operations, value.operator))) fail();
    verifyScalarExpression(value.left, value.range, source, fail, budget, locals, visibleBindings);
    const rightLocals = short ? cloneLocals(locals) : locals;
    if (short) narrowLocals(rightLocals,value.left,value.operator === "&&");
    verifyScalarExpression(value.right, value.range, source, fail, budget, rightLocals, visibleBindings);
    if (short) {
      const shortcut=cloneLocals(locals); narrowLocals(shortcut,value.left,value.operator !== "&&");
      for (const [id, local] of locals) { local.initialized &&= rightLocals.get(id).initialized; local.states=shortcut.get(id).states | rightLocals.get(id).states; }
    }
    const shift = ["<<", ">>", ">>>"].includes(value.operator);
    if ((shift ? value.right.type !== i32TypeId : value.left.type !== value.right.type) || value.left.range.end > value.right.range.start
        || expressionPrecedence(value.left) < precedence[value.operator]
        || expressionPrecedence(value.right) <= precedence[value.operator]
        || sourceTokens(source, value.range.start, value.left.range.start) !== ""
        || !scalarOperator(source, value.left.range.end, value.right.range.start, value.operator)
        || sourceTokens(source, value.right.range.end, value.range.end) !== ""
        || value.type !== (short || comparisons.has(value.operator) ? boolTypeId : value.left.type)
        || (short ? value.left.type !== boolTypeId : !["===", "!=="].includes(value.operator) && !integerType(value.left.type)
          && !(floatType(value.left.type) && (comparisons.has(value.operator) || ["+", "-", "*", "/", "%"].includes(value.operator))))) fail();
  } else fail();
}
