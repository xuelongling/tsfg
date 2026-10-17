// SPDX-License-Identifier: MIT
import { verifyNullableSnapshot } from "./nullable-frontend.mjs";
import { verifyExceptionSnapshot } from "./exception-frontend.mjs";
import { verifyClosureSnapshot } from "./closure-frontend.mjs";
import { runLockedFrontend } from "./frontend-execution.mjs";
import { validateModuleFacts, skipCallTrivia, hasCallArgumentList, identifierName, staticBindingName } from "./module-facts.mjs";
import { prepareFrontendInput, materializeFrontendResponse, matchesSnapshotContract, digest, deepFreeze } from "./frontend-response.mjs";
export { frontendContractVersion, importCapturedFrontendResponse } from "./frontend-response.mjs";

/** @param {any} input @param {{ executable?: string }} [options] */
export async function analyzeFrontend(input, { executable } = {}) {
  const prepared = await prepareFrontendInput(input);
  if (prepared.status !== "ready") return prepared;
  const execution = await runLockedFrontend(JSON.stringify(prepared.ownedInput), { executable });
  if (execution.status !== "ok") return { status: "tool-error", inputIdentity: prepared.inputIdentity, message: execution.message };
  return materializeFrontendResponse(prepared, execution.stdout, execution.frontendSource);
}

function resolveLocal(snapshot, ref, collection) {
  if (!matchesSnapshotContract(snapshot) || !ref
      || Object.keys(ref).sort().join(",") !== "id,snapshotId"
      || typeof ref.id !== "string" || ref.snapshotId !== snapshot.snapshotId) {
    throw new TypeError("reference belongs to a different snapshot or contract");
  }
  const value = snapshot[collection]?.find(item => item.id === ref.id);
  if (!value) throw new RangeError("unknown snapshot reference");
  return value;
}

export function resolveSymbol(snapshot, ref) {
  const symbol = resolveLocal(snapshot, ref, "symbols");
  if (symbol.ref?.snapshotId !== snapshot.snapshotId || symbol.ref?.id !== symbol.id) {
    throw new TypeError("symbol definition has a foreign reference");
  }
  return symbol;
}

export const resolveNode = (snapshot, ref) => resolveLocal(snapshot, ref, "nodes");
export const resolveType = (snapshot, ref) => resolveLocal(snapshot, ref, "types");

export function validateFrontendSnapshot(snapshot) {
  if (snapshot?.format?.family === "tsfg.frontend-exception-candidate") return verifyExceptionSnapshot(snapshot);
  if (snapshot?.format?.family === "tsfg.frontend-nullable-candidate") return verifyNullableSnapshot(snapshot);
  if (snapshot?.format?.family === "tsfg.frontend-closure-candidate") return verifyClosureSnapshot(snapshot);
  if (!matchesSnapshotContract(snapshot)
      || !Array.isArray(snapshot.functions) || !Array.isArray(snapshot.symbols)
      || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.types)
      || typeof snapshot.source?.content !== "string"
      || snapshot.inputs?.find(file => file.path === snapshot.source.path)?.sha256 !== digest(snapshot.source.content)) {
    throw new TypeError("unsupported frontend snapshot contract");
  }
  const moduleFacts = snapshot.modules ? validateModuleFacts(snapshot) : undefined;
  let source = snapshot.source;
  let calls = 0;
  const usedNodes = new Set();
  const sameRange = (left, right) => left?.start === right?.start && left?.end === right?.end;
  const sourceSpan = range => {
    if (!Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end)
        || range.start < 0 || range.end <= range.start
        || range.end > source.content.length) {
      throw new TypeError("invalid source range");
    }
    return source.content.slice(range.start, range.end).trim();
  };
  const checkNode = (value, kind) => {
    const node = resolveNode(snapshot, value.node);
    if (node.kind !== kind || !sameRange(node.range, value.range)
        || moduleFacts && node.sourcePath !== source.path
        || usedNodes.has(node.id)) {
      throw new TypeError("node differs from its reference");
    }
    sourceSpan(value.range);
    usedNodes.add(node.id);
  };
  const checkType = (name, ref) => {
    const type = resolveType(snapshot, ref);
    if (type.kind !== "scalar" || type.scalar !== name) throw new TypeError("type differs from its reference");
  };
  if (new Set(snapshot.symbols.map(symbol => symbol.id)).size !== snapshot.symbols.length
      || new Set(snapshot.nodes.map(node => node.id)).size !== snapshot.nodes.length
      || new Set(snapshot.types.map(type => type.id)).size !== snapshot.types.length
      || new Set(snapshot.types.map(type => type.scalar)).size !== snapshot.types.length) {
    throw new TypeError("duplicate snapshot definition");
  }
  for (const symbol of snapshot.symbols) {
    if (moduleFacts) { source=moduleFacts.sources.get(symbol.sourcePath); if(!source) throw new TypeError("symbol has foreign source"); }
    resolveSymbol(snapshot, symbol.ref);
    checkType(symbol.type, symbol.typeRef);
    const syntheticDefault = moduleFacts && (symbol.bindingKind === "default-export-expression" && symbol.kind === "global"
      && moduleFacts.modules.get(symbol.sourcePath)?.exports.some(binding=>binding.name==="default" && binding.target===symbol.id)
      || symbol.name === "default" && symbol.kind === "function"
      && /^export\s+default\s+function\s*\(/.test(sourceSpan(symbol.range)));
    if (!syntheticDefault && identifierName(sourceSpan(symbol.range)) !== symbol.name) {
      throw new TypeError("symbol differs from its source declaration");
    }
  }
  const visitExpression = (expression, scope) => {
    if (!expression || typeof expression !== "object") throw new TypeError("invalid expression");
    checkNode(expression, expression.kind);
    checkType(expression.type, expression.typeRef);
    if (expression.kind === "reference") {
      const symbol = resolveSymbol(snapshot, expression.symbol);
      const name=moduleFacts ? expression.name : symbol.name;
      if (scope.get(name) !== symbol.id || (moduleFacts ? staticBindingName(name) !== staticBindingName(sourceSpan(expression.range))
          : name !== identifierName(sourceSpan(expression.range)))
          || symbol.type !== expression.type) {
        throw new TypeError("reference differs from its symbol");
      }
    } else if (expression.symbol) {
      throw new TypeError("non-reference expression has a symbol");
    }
    if (expression.kind === "call" && !expression.target) {
      throw new TypeError("call has no target");
    }
    if (expression.target) {
      const target = resolveSymbol(snapshot, expression.target);
      const fn = snapshot.functions.find(item => item.symbol.id === target.id)
        ?? snapshot.hostImports?.find(item=>item.symbol===target.id);
      const parameters = fn?.parameterTypes ?? fn?.parameters?.map(parameter => parameter.type);
      const arguments_ = expression.arguments;
      const sourceCall = sourceSpan(expression.range);
      const start = skipCallTrivia(sourceCall);
      const spelling = moduleFacts ? sourceCall.slice(start,sourceCall.indexOf("(",start)).trim()
        : (start < 0 ? "" : sourceCall.slice(start)).match(/^(?:\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})|[^\\\s(/])+/u)?.[0];
      if (expression.kind !== "call" || !fn || !Array.isArray(parameters)
          || !Array.isArray(arguments_) || !Array.isArray(expression.signature?.parameters)
          || !spelling || (moduleFacts ? staticBindingName(spelling) !== staticBindingName(expression.name)
              : identifierName(spelling) !== target.name)
          || moduleFacts && scope.get(expression.name) !== target.id
          || !hasCallArgumentList(sourceCall.slice(start + spelling.length))
          || expression.signature.returnType !== fn.returnType
          || expression.type !== fn.returnType
          || expression.signature.parameters.length !== parameters.length
          || arguments_.length !== parameters.length
          || parameters.some((type, index) => expression.signature.parameters[index] !== type
            || arguments_[index]?.type !== type)) {
        throw new TypeError("call signature differs from its target or arguments");
      }
      calls++;
    }
    if (expression.arguments) {
      if (!Array.isArray(expression.arguments)) throw new TypeError("invalid call arguments");
      for (const argument of expression.arguments) visitExpression(argument, scope);
    }
    for (const key of ["left", "right", "operand"])
      if (expression[key]) visitExpression(expression[key], scope);
  };
  const visitStatements = (statements, parent) => {
    const scope = new Map(parent);
    for (const statement of statements) {
      visitStatement(statement, scope);
      if (statement.symbol) scope.set(statement.symbol.name, statement.symbol.id);
    }
  };
  const visitStatement = (statement, scope) => {
    checkNode(statement, statement.kind);
    if (statement.symbol) {
      const symbol = resolveSymbol(snapshot, statement.symbol.ref);
      if (symbol.id !== statement.symbol.id || symbol.name !== statement.symbol.name
          || symbol.kind !== statement.symbol.kind || symbol.type !== statement.symbol.type
          || !sameRange(symbol.range, statement.symbol.range)
          || symbol.range?.start < statement.range?.start
          || symbol.range?.end > statement.range?.end) {
        throw new TypeError("statement differs from its symbol");
      }
    }
    for (const key of ["expression", "initializer", "condition", "target", "value"])
      if (statement[key]) visitExpression(statement[key], scope);
    for (const key of ["body", "thenBody", "elseBody"]) {
      if (statement[key] && !Array.isArray(statement[key])) throw new TypeError("invalid statement body");
      if (statement[key]) visitStatements(statement[key], scope);
    }
  };
  for (const fn of snapshot.functions) {
    if (moduleFacts) { source=moduleFacts.sources.get(fn.sourcePath); if(!source || !moduleFacts.modules.has(fn.sourcePath)) throw new TypeError("function has foreign module source"); }
    checkNode(fn, "function");
    checkType(fn.returnType, fn.returnTypeRef);
    const definition = resolveSymbol(snapshot, fn.symbol);
    if (definition.kind !== "function" || definition.name !== fn.name
        || moduleFacts && definition.sourcePath !== fn.sourcePath
        || definition.type !== fn.returnType
        || !(moduleFacts && fn.name === "default" && /^export\s+default\s+function\s*\(/.test(sourceSpan(definition.range)))
          && identifierName(sourceSpan(definition.range)) !== fn.name
        || definition.range?.start < fn.range?.start
        || definition.range?.end > fn.range?.end) {
      throw new TypeError("function differs from its symbol");
    }
    if (!Array.isArray(fn.parameters) || !Array.isArray(fn.body)) {
      throw new TypeError("invalid function structure");
    }
    const parameterScope = new Map(moduleFacts?.views.get(fn.sourcePath) ?? []);
    for (const parameter of fn.parameters) parameterScope.set(parameter.name,parameter.id);
    for (const parameter of fn.parameters) {
      checkNode(parameter, "parameter");
      checkType(parameter.type, parameter.typeRef);
      const symbol = resolveSymbol(snapshot, parameter.ref);
      if (symbol.id !== parameter.id || symbol.kind !== "parameter"
          || symbol.name !== parameter.name || symbol.type !== parameter.type
          || !sameRange(symbol.range, parameter.range)) {
        throw new TypeError("parameter differs from its symbol");
      }
    }
    visitStatements(fn.body, parameterScope);
  }
  for (const module of snapshot.modules ?? []) {
    source=moduleFacts.sources.get(module.sourcePath);
    visitStatements(module.initialization,moduleFacts.views.get(module.sourcePath));
  }
  if (usedNodes.size !== snapshot.nodes.length) throw new TypeError("unused snapshot node");
  return deepFreeze({ snapshotId: snapshot.snapshotId, functions: snapshot.functions.length, calls });
}
