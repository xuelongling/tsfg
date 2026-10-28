// SPDX-License-Identifier: MIT
import { verifyModuleCallableHir } from './module-callable-hir.mjs';
import { check } from './module-callable-common.mjs';
import { functionIdentity, signatureHash, own } from './identity.mjs';
import { coreExchangeFormat } from './core-ssa-emitter.mjs';
import { emitScalarCore } from './scalar-core-emitter.mjs';

// This boundary consumes the complete reconstructed candidate. Its private
// function/signature domain must never leak into the formal scalar exchange.
export function moduleCallableCoreView(hir) {
  const verified = verifyModuleCallableHir(hir);
  const types = new Map(verified.types.map(type => [type.id, type]));
  const identities = new Map(), signatures = new Map();
  function unsupported(kind, owner, range = owner.range) {
    throw Object.assign(new TypeError('r03-d-capability: module callable Core lowering is not implemented'),
      {code: 'r03-d-capability', ruleId: 'r01-ts-baseline', phase: 'lowering',
        unsupportedKind: kind, primary: {sourceId: owner.sourcePath, ...range}});
  }
  function scalar(id, owner, range) {
    const type = types.get(id);
    if (type?.kind !== 'scalar' || !['bool', 'i32'].includes(type.name))
      unsupported('function-value', owner, range);
    return {kind: 'scalar', name: type.name, id: type.id};
  }
  for (const fn of verified.functions) {
    const result = scalar(fn.returnType, fn), parameters = fn.parameters
      .map(parameter => scalar(parameter.type, fn, parameter.range).name);
    signatures.set(fn.id, signatureHash(result.name, parameters));
    identities.set(fn.id, fn.kind === 'module-initialization' ? fn.id
      : functionIdentity(fn.sourcePath, fn.name, result.name, parameters));
  }
  const functionId = id => { check(identities.has(id), 'identity'); return identities.get(id); };
  const globalIds = new Set(verified.globals.map(global => global.id));
  const visible = entries => entries.map(entry => ({...entry,
    target: globalIds.has(entry.target) ? entry.target : functionId(entry.target)}));
  function body(statements, fn) {
    return statements.map(statement => {
      const common = {kind: statement.kind, range: statement.range};
      if (statement.kind === 'initialize') return {...common, global: statement.global,
        value: expression(statement.value, fn)};
      if (statement.kind === 'local') {
        scalar(statement.binding.type, fn, statement.binding.range);
        return {...common, binding: {...statement.binding}, initializer: expression(statement.initializer, fn)};
      }
      if (statement.kind === 'assign') return {...common,
        target: expression(statement.target, fn), value: expression(statement.value, fn)};
      if (['return', 'expression'].includes(statement.kind))
        return {...common, value: expression(statement.value, fn)};
      if (statement.kind === 'block') return {...common, body: body(statement.body, fn)};
      if (statement.kind === 'if') return {...common, condition: expression(statement.condition, fn),
        thenBody: body(statement.thenBody, fn), elseBody: body(statement.elseBody, fn)};
      if (statement.kind === 'while') return {...common, condition: expression(statement.condition, fn),
        body: body(statement.body, fn)};
      return unsupported('statement:' + statement.kind, fn, statement.range);
    });
  }
  function expression(value, fn) {
    if (value.kind === 'indirectCall') unsupported('indirect-call', fn, value.range);
    if (value.kind === 'functionReference') unsupported('function-value', fn, value.range);
    scalar(value.type, fn, value.range);
    if (['constant', 'boolean', 'reference', 'global'].includes(value.kind)) return {...value};
    if (value.kind === 'call') {
      // The private function-type ID is consumed here, never relabelled formal.
      const {signature, signatureHash: privateHash, ...common} = value;
      const target = functionId(value.target);
      return {...common, target, signatureHash: signatures.get(value.target),
        arguments: value.arguments.map(argument => expression(argument, fn))};
    }
    if (['group', 'unary'].includes(value.kind)) return {...value, operand: expression(value.operand, fn)};
    if (['binary', 'shortCircuit'].includes(value.kind)) return {...value,
      left: expression(value.left, fn), right: expression(value.right, fn)};
    return unsupported('expression:' + value.kind, fn, value.range);
  }
  verified.globals.forEach(global => scalar(global.type, global, global.range));
  const source = item => ({path: item.path, hash: item.hash, length: item.content.length});
  const functions = verified.functions.map(fn => {
    const id = functionId(fn.id);
    return {id, name: fn.name, symbol: 'f' + id.slice(7), kind: fn.kind, sourcePath: fn.sourcePath,
      signatureHash: signatures.get(fn.id), returnType: scalar(fn.returnType, fn),
      parameters: fn.parameters.map(parameter => ({...parameter})), range: fn.range, body: body(fn.body, fn)};
  });
  const modules = verified.modules.map(module => ({...module,
    initializer: functionId(module.initializer), bindings: visible(module.bindings), exports: visible(module.exports)}));
  const closure = {...verified.closure,
    roots: verified.closure.roots.map(root => ({...root, target: functionId(root.target)})),
    functions: verified.closure.functions.map(functionId),
    initialization: verified.closure.initialization.map(functionId)};
  return own({exchange: coreExchangeFormat, inputIdentity: verified.inputIdentity,
    source: source(verified.source), target: verified.target, functions,
    moduleState: {sources: verified.sources.map(source), modules, globals: verified.globals,
      hostImports: verified.hostImports, closure}});
}

export function emitModuleCallableCore(hir) {
  return emitScalarCore(moduleCallableCoreView(hir));
}
