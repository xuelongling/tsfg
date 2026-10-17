// SPDX-License-Identifier: MIT
import { check, record, array, same } from './exception-common.mjs';
import { exceptionIdentifierName } from './exception-identifiers.mjs';
import { exceptionBinding, exceptionOccurrenceType } from './exception-scope.mjs';
import { exceptionReferencePresence } from './exception-presence.mjs';

// Module projection owns a required raw source name on reads/calls. Scope and
// nullable proof models stay shared; no legacy module body verifier is invoked.
export function verifyExceptionModuleExpression(value, parent, scope, context, index, depth, write, operatorContext, nullableReturn, verifyChild) {
  const module = context.module;
  if (!module) return null;
  const g = context.grammar;
  if (value.kind === 'reference') {
    record(value, ['kind','type','range','symbol','name'], ['presenceFlow']);
    const binding = exceptionBinding(value.symbol, scope, context, write);
    check(binding.sourcePath === context.source.path && value.type === exceptionOccurrenceType(binding, scope, write), 'scope', 'module occurrence has foreign ownership or lacks its path proof');
    check(value.name === g.at(index).text, 'source', 'module reference name must retain its original spelling');
    g.name(value.range, binding.name, parent, index, operatorContext);
    const mask = exceptionReferencePresence(value, binding, context.profile, write, nullableReturn);
    return { type: value.type, next: index + 1, binding, mask };
  }
  if (value.kind === 'boolean') {
    record(value, ['kind','type','range','boolean']);
    check(!write && value.type === 'bool' && typeof value.boolean === 'boolean', 'type');
    const next = g.expect(index, value.boolean ? 'true' : 'false');
    (operatorContext ? g.span : g.raw)(value.range, parent, index);
    return { type: 'bool', next, mask: 0 };
  }
  if (value.kind !== 'call') return null;
  record(value, ['kind','type','range','name','target','arguments','signature']);
  check(!write && !operatorContext && !nullableReturn, 'capability', 'only direct ordinary module calls have a cold tracer');
  const spelling = g.at(index).text, name = exceptionIdentifierName(spelling);
  check(value.name === spelling && !scope.bindings.has(name), 'scope', 'callee source spelling is foreign or lexically shadowed');
  check(module.visible.get(name) === value.target, 'scope', 'call target is not the actual local/imported function');
  const fn = module.functions.get(value.target);
  check(fn && value.type === fn.returnType, 'type', 'module call result differs from its actual declaration');
  const signature = { parameters: fn.parameters.map(parameter => parameter.type), returnType: fn.returnType,
    ...(fn.parameters.length ? { presence: fn.parameters.map(parameter => parameter.presence) } : {}) };
  check(same(value.signature, signature), 'signature', 'complete call signature differs from the defining source function');
  const argumentsList = array(value.arguments);
  check(argumentsList.length === fn.parameters.length, 'signature');
  let next = g.expect(index + 1, '(');
  for (const [ordinal, argument] of argumentsList.entries()) {
    if (ordinal) next = g.expect(next, ',');
    const result = verifyChild(argument, value.range, scope, context, next, depth + 1);
    check(result.type === fn.parameters[ordinal].type && result.mask === 0, 'type', 'argument payload lacks the callee parameter contract'); next = result.next;
  }
  if (argumentsList.length && g.spelling(next) === ',') next = g.expect(next, ',');
  next = g.expect(next, ')'); g.raw(value.range, parent, index, next - 1); context.calls++;
  return { type: value.type, next, mask: 0 };
}
