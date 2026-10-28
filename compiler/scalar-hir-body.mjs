// SPDX-License-Identifier: MIT
import { identifierName, sourceTrivia } from './module-facts.mjs';
import { scalarName, scalarTypeIds, boolTypeId } from './identity.mjs';
import { hasState, validParameterPresence, validLocalPresence, annotationStates, validPresenceFlow } from './presence.mjs';
import { sourceTokens, identifierToken, bindingFact, declaredStates, cloneLocals, expressionStates, narrowLocals, loopCarriedStates, range, noShortIf } from './scalar-hir-state.mjs';
import { completeFunctionSource } from './conversions.mjs';
import { verifyScalarExpression as verifyExpression } from './scalar-hir-expression.mjs';
import {verifyGlobal,verifyInitialization} from './scalar-hir-module.mjs';

const types=scalarTypeIds;
const exactKeys=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===[...keys].sort().join(',');
export function verifyScalarFunctionBody(hir,fn,functions,parameterNames,fail,modules=undefined) {
  const sourceView=modules?.sources.get(fn.sourcePath)??hir.source;
  const completeSource=modules!==undefined || completeFunctionSource(sourceView.content,hir.functions,identifierName);
  const source = sourceView.content, declarations = new Map(), ids = new Set(), initializedGlobals=new Set();
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
  const budget = { remaining: 4096, sourcePath: sourceView.path, declarations, functions, modules, completeSource, inputScope:hir.inputScope, inputIdentity:hir.inputIdentity };
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
      if (index === 0 && frame !== "plain" && frame !== 'module') {
        const header = frame === "function" ? before.match(/^(?:[^{}]|\\u\{[0-9a-fA-F]+\})*\{(const|let)?$/)
          : before.match(/^\{(const|let)?$/);
        if (!header) fail();
        before = header[1] ?? "";
      }
      if (statement.kind === 'initialize') {
        if(frame!=='module')fail();
        declarationKind=verifyInitialization(statement,source,fail,budget,initializedGlobals,before,declarationKind);
        verifyExpression(statement.value,statement.range,source,fail,budget,locals,visibleBindings);
        const tail=sourceTokens(source,statement.value.range.end,statement.range.end);
        if(!/^;?$/.test(tail))fail();
        if(tail===';')declarationKind=undefined;
      } else if (statement.kind === "local") {
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
        if (frame!=='module' && !/^;?$/.test(before)) fail();
        if (statement.kind === "evaluate" || statement.kind === 'expression' && modules) {
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
            // A terminating body has no back edge or ordinary loop exit.
            // Retain the zero-iteration head, and merge only continuing paths.
            if (!leftReturn) for (const [id,local] of locals) local.states |= left.get(id).states;
            narrowLocals(locals,condition,false);
          }
          if (sourceTokens(source, last, statement.range.end) !== "") fail();
        } else {
          const value = statement.value;
          if (statement.kind === "return") {
            if (!exactKeys(statement, ["kind", "range", "value"]) || value?.type !== fn.returnType.id
                || sourceTokens(source, statement.range.start, value.range.start) !== "return") fail();
            returns = true;
          } else if (statement.kind === 'assign' && statement.target?.kind==='global') {
            const target=statement.target;
            verifyGlobal(target,statement.range,source,fail,budget,visibleBindings,true);
            if(!exactKeys(statement,['kind','range','target','value']) || value?.type!==target.type
                || target.range.end>value.range.start || sourceTokens(source,statement.range.start,target.range.start)!==''
                || sourceTokens(source,target.range.end,value.range.start)!=='=')fail();
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
          const assigned=statement.kind==='assign' && statement.target.kind==='reference';
          verifyExpression(value, statement.range, source, fail, budget, locals, visibleBindings,assigned ? declaredStates(locals.get(statement.target.binding).presence) : 1);
          if (!/^;?$/.test(sourceTokens(source, value.range.end, statement.range.end))) fail();
          if (assigned) { const local=locals.get(statement.target.binding); local.initialized = true; local.states=expressionStates(value,locals); }
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
    const expected=[...modules.globals.values()].filter(global=>global.sourcePath===fn.sourcePath).map(global=>global.id);
    if(JSON.stringify([...initializedGlobals])!==JSON.stringify(expected))fail();
    return;
  }
  // Module default declarations retain either their real local name or the
  // official anonymous "default" identity. Share this guard with parameter
  // defaults; only the module context admits an anonymous function header.
  const headerName=(header,spelling)=>spelling.trim()===''
    ? modules!==undefined && fn.name==='default' && /^\s*export\s+default\s+function\s*\(/.test(header)
    : /\bfunction\s+/.test(header) && identifierToken(spelling,{start:0,end:spelling.length})===fn.name;
  if (fn.parameters.some(parameter=>parameter.presence)) {
    let previous=fn.range.start;
    for (const [index,parameter] of fn.parameters.entries()) {
      const initializer=fn.parameterInitializers[index];
      if (!bindingFact(parameter,fn.range,source) || parameter.id !== `p${index}` || !parameter.writable
          || visible.has(parameter.name) || !validParameterPresence(parameter.presence,parameter,initializer,source,fn.range)) fail();
      const gap=sourceTrivia(source,previous,parameter.presence.range.start).trim();
      if (index === 0) {
        const opening=modules ? gap.match(/^(?:export\s+(?:default\s+)?)?function\s*([^()]*)\(\s*$/)
          : gap.match(/^(?:export\s+)?function\s+([^()]+)\(\s*$/);
        if (!opening || !headerName(gap,opening[1])) fail();
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
  const parsedHeader = modules
    ? header.match(/^\s*(?:export\s+(?:default\s+)?)?function\s*([^()]*)\(([^()]*)\)\s*:\s*(i8|i16|i32|i64|u8|u16|u32|u64|isize|usize|bool|boolean|f32|f64|number)\s*\{\s*(?:(?:const|let)\s*)?$/d)
    : header.match(/^\s*(?:export\s+)?function\s+([^()]+)\(([^()]*)\)\s*:\s*(i8|i16|i32|i64|u8|u16|u32|u64|isize|usize|bool|boolean|f32|f64|number)\s*\{\s*(?:(?:const|let)\s*)?$/d);
  if (!parsedHeader || !headerName(header,parsedHeader[1])
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
