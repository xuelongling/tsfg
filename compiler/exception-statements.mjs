// SPDX-License-Identifier: MIT
import { check, failure, record, array, range, same, wireLimits } from './exception-common.mjs';
import { verifyExceptionExpression } from './exception-expressions.mjs';
import { exceptionAggregateAnnotation } from './exception-aggregate-facts.mjs';
import { exceptionValueType, exceptionAnnotation, exceptionAssignmentType } from './exception-types.mjs';
import { exceptionScope, declareExceptionBinding, reserveExceptionBindings, exceptionWrite, exceptionBranchScope,
  exceptionDropWrittenProofs, mergeExceptionScopes } from './exception-scope.mjs';

function terminator(context, next) {
  const g = context.grammar;
  if (g.spelling(next) === ';') return next + 1;
  check(g.spelling(next) === '}' || /[\r\n\u2028\u2029]/.test(context.source.content.slice(g.at(next - 1).end, g.at(next).start)), 'source', 'missing statement separator');
  return next;
}
export function verifyExceptionBlock(block, parent, scope, context, index, depth = 0) {
  check(depth <= wireLimits.depth, 'limit'); record(block, ['body','range']);
  range(block.range, parent, context.source.content);
  const g = context.grammar, first = index, body = array(block.body);
  let next = g.expect(index, '{');
  context.closures?.reserve(body, scope, context); reserveExceptionBindings(body, scope, context);
  for (const item of body) {
    check(++context.steps <= wireLimits.jsonTokens, 'limit');
    next = verifyExceptionStatement(item, block.range, scope, context, next, depth + 1);
  }
  const close = next; next = g.expect(next, '}'); g.raw(block.range, parent, first, close);
  return next;
}
function catchClause(fact, parent, parentScope, context, index, depth) {
  record(fact, ['block','range'], ['binding','declarationRange','annotationRange']);
  range(fact.range, parent, context.source.content);
  const g = context.grammar, first = index, scope = exceptionScope(parentScope);
  let next = g.expect(index, 'catch');
  if (fact.binding !== undefined) {
    check(context.module || fact.annotationRange === undefined, 'capability', 'annotated catch has no ordinary private consumer tracer yet');
    const binding = fact.binding;
    check(binding && binding.kind === 'local' && binding.type === 'unknown' && binding.writable === true, 'type', 'catch declaration must remain writable unknown');
    next = g.expect(next, '('); const name = next; g.name(binding.range, binding.name, fact.range, next++);
    if (g.spelling(next) === ':') {
      check(context.module, 'capability', 'ordinary annotated catch requires a separate tracer');
      next = g.expect(next, ':'); g.raw(fact.annotationRange, fact.range, next); next = g.expect(next, 'unknown');
    } else check(fact.annotationRange === undefined, 'schema');
    g.raw(fact.declarationRange, fact.range, name, next - 1);
    declareExceptionBinding(binding, scope, context); context.closures?.catchBinding(binding); next = g.expect(next, ')');
  } else check(fact.declarationRange === undefined && fact.annotationRange === undefined, 'schema');
  next = verifyExceptionBlock(fact.block, fact.range, scope, context, next, depth);
  g.raw(fact.range, parent, first, next - 1); return { next, scope };
}
export function verifyExceptionStatement(item, parent, scope, context, index, depth = 0) {
  check(item && typeof item === 'object' && !Array.isArray(item));
  check(depth <= wireLimits.depth, 'limit'); range(item.range, parent, context.source.content);
  const g = context.grammar, first = index;
  if (item.kind === 'throw' || item.kind === 'return') {
    record(item, ['kind','range'], ['expression']);
    check(item.expression !== undefined, 'capability', 'bare return or throw is not implemented');
    let next = g.expect(index, item.kind);
    check(!/[\r\n\u2028\u2029]/.test(context.source.content.slice(g.at(index).end, g.at(next).start)), 'source', 'line break after abrupt keyword');
    const returningNullable = item.kind === 'return' && context.returnMask !== 0;
    const value = verifyExceptionExpression(item.expression, item.range, scope, context, next, 0, false, false, returningNullable);
    if (item.kind === 'return') {
      check(value.type === context.returnType && (value.mask & ~context.returnMask) === 0, 'type', 'return payload or absence differs from declared result');
      if (value.type === 'function') check(same(value.signature, context.returnSignature), 'signature', 'returned callable signature differs from the declared result');
    }
    next = terminator(context, value.next); g.raw(item.range, parent, first, next - 1); return next;
  }
  if (item.kind === 'functionDeclaration') {
    check(context.closures, 'capability', 'nested declarations require owned closure facts');
    return context.closures.declaration(item, scope, context, index);
  }
  if (item.kind === 'variable') {
    record(item, ['kind','range','symbol','initializer']);
    const binding = item.symbol, keyword = g.spelling(index);
    check(binding && binding.kind === 'local' && ['const','let'].includes(keyword)
      && binding.writable === (keyword === 'let'), 'source', 'local declaration writability differs');
    exceptionValueType(binding.type, context.profile, context.aggregate);
    let next = g.expect(index, keyword); const name = next;
    g.name(binding.range, binding.name, item.range, next++);
    const annotated = g.spelling(next) === ':';
    if (annotated) next = context.aggregate
      ? exceptionAggregateAnnotation(context.aggregate, g, g.expect(next, ':'), binding.type, context.profile)
      : exceptionAnnotation(g, g.expect(next, ':'), binding.type, context.profile, true);
    next = g.expect(next, '=');
    const value = verifyExceptionExpression(item.initializer, item.range, scope, context, next);
    check(value.type !== 'function' && value.mask === 0, 'capability', 'callable or nullable local payloads require a separate flow tracer');
    if (annotated) exceptionAssignmentType(binding.type, value.type);
    else check(binding.type === value.type, 'type', 'inferred local must retain its actual initializer payload');
    g.raw(item.range, parent, name, value.next - 1);
    declareExceptionBinding(binding, scope, context); return terminator(context, value.next);
  }
  if (item.kind === 'assignment') {
    record(item, ['kind','range','target','value']);
    const target = verifyExceptionExpression(item.target, item.range, scope, context, index, 0, true);
    const value = verifyExceptionExpression(item.value, item.range, scope, context, g.expect(target.next, '='));
    check(value.type !== 'function' && value.mask === 0, 'capability', 'callable or nullable assignment payloads require a separate flow tracer');
    exceptionAssignmentType(target.type, value.type); exceptionWrite(scope, target.binding.id);
    const next = terminator(context, value.next); g.raw(item.range, parent, first, next - 1); return next;
  }
  if (item.kind === 'block') {
    record(item, ['kind','range'], ['body']);
    const body = item.body === undefined ? [] : array(item.body, wireLimits.arrayItems, 1), child = exceptionScope(scope);
    const next = verifyExceptionBlock({ body, range: item.range }, parent, child, context, index, depth);
    mergeExceptionScopes(scope, exceptionStatementsCanComplete(body) ? [child] : [], [child]); return next;
  }
  if (item.kind === 'if') {
    record(item, ['kind','range','condition'], ['thenBody','elseBody']);
    const thenBody = item.thenBody === undefined ? [] : array(item.thenBody, wireLimits.arrayItems, 1);
    const elseBody = item.elseBody === undefined ? [] : array(item.elseBody, wireLimits.arrayItems, 1);
    check(thenBody.length === 1 && thenBody[0].kind === 'block'
      && (!elseBody.length || elseBody.length === 1 && elseBody[0].kind === 'block'), 'capability', 'only braced scalar-flow branches are implemented');
    let next = g.expect(index, 'if'); next = g.expect(next, '(');
    const condition = verifyExceptionExpression(item.condition, item.range, scope, context, next);
    check(condition.type === 'bool', 'type'); next = g.expect(condition.next, ')');
    const left = exceptionBranchScope(scope, condition.test, true, context.definitions);
    const right = exceptionBranchScope(scope, condition.test, false, context.definitions);
    next = verifyExceptionStatement(thenBody[0], item.range, left, context, next, depth + 1);
    if (elseBody.length) next = verifyExceptionStatement(elseBody[0], item.range, right, context, g.expect(next, 'else'), depth + 1);
    // Source's if anchor trims leading trivia; its ordinary block anchor does not.
    g.span(item.range, parent, first, next - 1);
    const normal = [];
    if (exceptionStatementsCanComplete(thenBody)) normal.push(left);
    if (exceptionStatementsCanComplete(elseBody)) normal.push(right);
    mergeExceptionScopes(scope, normal, [left, right]); return next;
  }
  if (item.kind === 'try') {
    record(item, ['kind','range','exception']); record(item.exception, ['tryBlock'], ['catchClause','finallyBlock']);
    const fact = item.exception;
    check(fact.catchClause !== undefined || fact.finallyBlock !== undefined, 'schema');
    let next = g.expect(index, 'try');
    const attempted = exceptionScope(scope), paths = [attempted], normal = [];
    next = verifyExceptionBlock(fact.tryBlock, item.range, attempted, context, next, depth);
    if (exceptionStatementsCanComplete(fact.tryBlock.body)) normal.push(attempted);
    if (fact.catchClause !== undefined) {
      const inherited = exceptionScope(scope); exceptionDropWrittenProofs(inherited, [attempted]);
      const caught = catchClause(fact.catchClause, item.range, inherited, context, next, depth);
      next = caught.next; paths.push(caught.scope);
      if (exceptionStatementsCanComplete(fact.catchClause.block.body)) normal.push(caught.scope);
    }
    if (fact.finallyBlock !== undefined) {
      const final = exceptionScope(scope); exceptionDropWrittenProofs(final, paths);
      final.effects = new Map(); // Only finally-body effects resume the original normal continuations.
      next = g.expect(next, 'finally'); next = verifyExceptionBlock(fact.finallyBlock, item.range, final, context, next, depth);
      paths.push(final);
      const continuations = exceptionStatementsCanComplete(fact.finallyBlock.body) ? normal : [];
      mergeExceptionScopes(scope, continuations, paths, final);
    } else mergeExceptionScopes(scope, normal, paths);
    g.raw(item.range, parent, first, next - 1); return next;
  }
  failure('capability', 'exception statement kind is not implemented: ' + item.kind);
}

// Finally overrides prior abrupt completion when it cannot finish normally.
// Branches contribute only their genuine normal paths; an absent else can finish.
export function exceptionStatementsCanComplete(body) {
  let normal = true;
  for (const item of body) {
    let current = true;
    if (item.kind === 'throw' || item.kind === 'return') current = false;
    if (item.kind === 'block') current = exceptionStatementsCanComplete(item.body ?? []);
    if (item.kind === 'if') current = exceptionStatementsCanComplete(item.thenBody ?? []) || exceptionStatementsCanComplete(item.elseBody ?? []);
    if (item.kind === 'try') {
      const fact = item.exception;
      current = exceptionStatementsCanComplete(fact.tryBlock.body)
        || fact.catchClause !== undefined && exceptionStatementsCanComplete(fact.catchClause.block.body);
      if (fact.finallyBlock !== undefined && !exceptionStatementsCanComplete(fact.finallyBlock.body)) current = false;
    }
    normal = normal && current;
  }
  return normal;
}
