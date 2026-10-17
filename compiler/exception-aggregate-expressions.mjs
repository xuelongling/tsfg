// SPDX-License-Identifier: MIT
import { check, record, array, range, same } from './exception-common.mjs';
import { exceptionBinding } from './exception-scope.mjs';
import { exceptionIdentifierName } from './exception-identifiers.mjs';

// The caller performs the shared depth/step/type guard and owns unknown proofs,
// group/write once-evaluation and exception scopes. This handles only the actual
// aggregate leaf/path/comparison routes; it never invokes the old verifier.
export function verifyExceptionAggregateExpression(value, parent, scope, context, index, depth, write, operatorContext, verifyChild) {
  const state = context.aggregate;
  if (!state) return null;
  const g = context.grammar;
  range(value.range, parent, context.source.content);
  if (value.kind === 'reference' && state.byType.has(value.type)) {
    record(value, ['kind','type','range','symbol']);
    const binding = exceptionBinding(value.symbol, scope, context, write);
    check(binding.type === value.type, 'type', 'aggregate reference must retain its nominal declared type');
    g.name(value.range, binding.name, parent, index, true);
    return { type: value.type, next: index + 1, binding, mask: 0, aggregateUse: true };
  }
  if (value.kind === 'construct') {
    record(value, ['kind','type','range','target','arguments','signature']);
    check(!write, 'permission');
    const target = state.constructors.get(value.target);
    check(target && value.type === target.decl.id && same(value.signature, target.ctor.signature), 'signature', 'construct must use its actual nominal constructor');
    check(array(value.arguments).length === 0, 'capability', 'explicit constructor arguments require a separate cold tracer');
    let next = g.expect(index, 'new');
    check(exceptionIdentifierName(g.at(next).text) === target.decl.name && !scope.bindings.has(target.decl.name), 'scope', 'constructor name is shadowed or belongs to another class'); next++;
    if (g.spelling(next) === '(') next = g.expect(next + 1, ')');
    g.span(value.range, parent, index, next - 1);
    return { type: value.type, next, mask: 0, aggregateUse: true };
  }
  if (value.kind === 'field') {
    record(value, ['kind','type','range','receiver','fieldPath','symbol','permission']);
    check(!write, 'capability', 'field writes require a separate cold tracer');
    const receiver = verifyChild(value.receiver, value.range, scope, context, index, depth + 1, false, true);
    check(receiver.mask === 0 && state.byType.has(receiver.type), 'type', 'field receiver requires an owned nominal instance');
    let next = receiver.next, owner = receiver.type, last;
    for (const id of array(value.fieldPath, undefined, 1)) {
      const item = state.fields.get(id);
      check(item && item.decl.id === owner, 'identity', 'field path crosses nominal ownership');
      next = g.expect(next, '.');
      check(exceptionIdentifierName(g.at(next).text) === item.field.name, 'source', 'field path spelling differs from its actual field'); next++;
      check(item.field.access === 'public', 'capability', 'constructor/self private field access has no cold tracer');
      owner = item.field.type; last = item;
    }
    check(last && value.symbol === last.field.symbol && value.type === last.field.type, 'symbol');
    check(same(value.permission, { readable: true, writable: !last.field.readonly, constructorSelf: false, classRef: last.decl.id }), 'permission', 'field permissions differ from the declared member');
    g.span(value.range, parent, index, next - 1);
    return { type: value.type, next, mask: 0, aggregateUse: true };
  }
  if (value.kind === 'boolean') {
    record(value, ['kind','type','range','boolean']);
    check(value.type === 'bool' && typeof value.boolean === 'boolean' && !write, 'type');
    const next = g.expect(index, value.boolean ? 'true' : 'false');
    (operatorContext ? g.span : g.raw)(value.range, parent, index);
    return { type: 'bool', next, mask: 0 };
  }
  if (value.kind === 'binary') {
    record(value, ['kind','type','range','operator','left','right']);
    check(!write && value.type === 'bool' && ['===','!=='].includes(value.operator), 'capability', 'only aggregate-backed strict boolean equality has a cold tracer');
    const left = verifyChild(value.left, value.range, scope, context, index, depth + 1, false, true);
    const right = verifyChild(value.right, value.range, scope, context, g.expect(left.next, value.operator), depth + 1, false, true);
    check(left.type === 'bool' && right.type === 'bool' && left.mask === 0 && right.mask === 0
      && (left.aggregateUse || right.aggregateUse), 'type', 'aggregate equality operands need their own exact scalar/flow proof');
    g.span(value.range, parent, index, right.next - 1);
    return { type: 'bool', next: right.next, mask: 0, aggregateUse: true };
  }
  return null;
}
