// SPDX-License-Identifier: MIT
import { check, failure, record, range, same, wireLimits } from './exception-common.mjs';
import { exceptionValueType, exceptionAssignmentType } from './exception-types.mjs';
import { exceptionBinding, exceptionOccurrenceType, exceptionWrite } from './exception-scope.mjs';
import { exceptionReferencePresence } from './exception-presence.mjs';
import { exceptionCallableReference } from './exception-callable.mjs';
import { verifyExceptionAggregateExpression } from './exception-aggregate-expressions.mjs';
import { verifyExceptionModuleExpression } from './exception-module-expressions.mjs';

// A proof belongs to one declared symbol on this path, never to a spelling or
// assigned payload. The expression result is distinct from its target's type.
// Source trims group/write operands; direct references retain their raw start.
/** @returns {any} */
export function verifyExceptionExpression(value, parent, scope, context, index, depth = 0, write = false, operatorContext = false, nullableReturn = false) {
  check(depth <= wireLimits.depth && ++context.steps <= wireLimits.jsonTokens, 'limit');
  check(value && typeof value === 'object' && !Array.isArray(value));
  range(value.range, parent, context.source.content);
  const functionValue = context.functionValues?.expression(value, parent, scope, context, index, depth, verifyExceptionExpression);
  if (functionValue) {
    check(!write && !nullableReturn, 'permission', 'function values are not writable targets');
    return functionValue;
  }
  const callable = value.type === 'function';
  if (callable) check(['reference','group','write'].includes(value.kind) && !nullableReturn,
    'capability', 'callable expressions require owned bindings or actual code declarations');
  else {
    exceptionValueType(value.type, context.profile, context.aggregate);
  }
  check(!nullableReturn || value.kind === 'reference', 'capability', 'nullable returns require a direct reference tracer');
  if (write) check(['reference','group'].includes(value.kind), 'permission', 'assignment requires a direct owned binding');
  const g = context.grammar, first = index;
  if (value.kind === 'boolean') {
    record(value, ['kind','type','range','boolean']);
    check(!write && value.type === 'bool' && typeof value.boolean === 'boolean', 'type');
    const next = g.expect(index, value.boolean ? 'true' : 'false');
    (operatorContext ? g.span : g.raw)(value.range, parent, index);
    return { type:'bool', next, mask:0 };
  }
  const aggregateValue = verifyExceptionAggregateExpression(value, parent, scope, context, index, depth, write, operatorContext, verifyExceptionExpression);
  if (aggregateValue) return aggregateValue;
  const moduleValue = verifyExceptionModuleExpression(value, parent, scope, context, index, depth, write, operatorContext, nullableReturn, verifyExceptionExpression);
  if (moduleValue) return moduleValue;
  if (context.closures && value.kind === 'call') return context.closures.directCall(value, parent, scope, context, index, write);
  // Aggregate variants own exact metadata; construct alone requires its ctor signature.
  if (!callable) check(!Object.hasOwn(value, 'signature'), 'signature', 'noncallable expression must omit callable metadata');
  if (value.kind === 'reference') {
    record(value, ['kind','type','range','symbol'], ['presenceFlow','signature']);
    const binding = exceptionBinding(value.symbol, scope, context, write);
    check(value.type === exceptionOccurrenceType(binding, scope, write), 'type', 'occurrence type lacks the same-symbol path proof');
    g.name(value.range, binding.name, parent, index, operatorContext);
    if (callable) {
      const signature = exceptionCallableReference(value, binding);
      return { type: value.type, next: index + 1, binding, signature, mask: 0 };
    }
    const mask = exceptionReferencePresence(value, binding, context.profile, write, nullableReturn);
    context.closures?.access(binding, write, context);
    return { type: value.type, next: index + 1, binding, mask };
  }
  if (value.kind === 'group') {
    record(value, ['kind','type','range','operand']);
    const operand = verifyExceptionExpression(value.operand, value.range, scope, context, g.expect(index, '('), depth + 1, write, true);
    check(operand.mask === 0, 'capability', 'nullable groups require a separate flow tracer');
    const next = g.expect(operand.next, ')');
    check(value.type === operand.type, 'type'); g.span(value.range, parent, first, next - 1);
    return { ...operand, type: value.type, next };
  }
  if (value.kind === 'write') {
    record(value, ['kind','type','range','operator','left','right']);
    check(value.operator === '=', 'capability', 'compound assignment has no scalar-flow tracer yet');
    const left = verifyExceptionExpression(value.left, value.range, scope, context, index, depth + 1, true, true);
    const right = verifyExceptionExpression(value.right, value.range, scope, context, g.expect(left.next, '='), depth + 1, false, true);
    check(right.mask === 0, 'capability', 'nullable write payloads require a separate flow tracer');
    exceptionAssignmentType(left.type, right.type); check(value.type === right.type, 'type', 'write result must retain the once-evaluated RHS type');
    if (callable) check(same(left.signature, right.signature), 'signature', 'callable write changes its declared signature');
    exceptionWrite(scope, left.binding.id); g.span(value.range, parent, first, right.next - 1);
    return { type: value.type, next: right.next, mask: 0, ...(callable ? {signature:right.signature} : {}) };
  }
  if (value.kind === 'type-test') {
    record(value, ['kind','type','range','operator','operand','typeTest']);
    record(value.typeTest, ['tag','typeofRange','tagRange']);
    check(value.type === 'bool' && ['===','!=='].includes(value.operator) && value.typeTest.tag === 'boolean', 'type');
    let next = index, operand, typeofFirst, typeofLast, tagIndex;
    if (g.spelling(next) === 'typeof') {
      typeofFirst = next; next = g.expect(next, 'typeof');
      operand = verifyExceptionExpression(value.operand, value.range, scope, context, next, depth + 1);
      typeofLast = operand.next - 1;
      next = g.expect(operand.next, value.operator); tagIndex = next; g.booleanTag(next++);
    } else {
      tagIndex = next; g.booleanTag(next++); next = g.expect(next, value.operator);
      typeofFirst = next; next = g.expect(next, 'typeof');
      operand = verifyExceptionExpression(value.operand, value.range, scope, context, next, depth + 1);
      typeofLast = operand.next - 1; next = operand.next;
    }
    check(operand.binding && ['unknown','bool'].includes(operand.type), 'capability', 'typeof proof requires a direct unknown/bool binding');
    // The expression is trimmed, while both metadata nodes retain raw AST Pos.
    // Derive their narrow envelope entirely from this expression's parsed tokens.
    const rawEnvelope = { start: g.rawStart(first), end: g.at(next - 1).end };
    range(rawEnvelope, parent, context.source.content);
    g.raw(value.typeTest.typeofRange, rawEnvelope, typeofFirst, typeofLast);
    g.raw(value.typeTest.tagRange, rawEnvelope, tagIndex); g.span(value.range, parent, first, next - 1);
    return { type: 'bool', next, mask: 0, test: { symbol: operand.binding.id, booleanWhenTrue: value.operator === '===' } };
  }
  failure('capability', 'exception expression kind is not implemented: ' + value.kind);
}
