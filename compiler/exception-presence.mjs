// SPDX-License-Identifier: MIT
import { presenceMask } from './nullable-common.mjs';
import { check, record, same } from './exception-common.mjs';
import { exceptionAnnotation } from './exception-types.mjs';

// Reuse the finite mask model only. Exception DTO keys, source anchors and
// error categories stay here; nullable protocol/type IDs never cross this seam.
function mask(shape) {
  if (shape === undefined) return 0;
  check(shape && typeof shape.undefined === 'boolean' && typeof shape.null === 'boolean', 'type');
  return presenceMask(shape);
}
export function exceptionPresenceAnnotation(grammar, index, type, profile) {
  let next = index, members = 0, payload = false;
  for (;;) {
    const spelling = grammar.spelling(next), absence = spelling === 'undefined' ? 1 : spelling === 'null' ? 2 : 0;
    if (absence) {
      check(!(members & absence), 'capability', 'duplicate nullable annotation member is not implemented');
      members |= absence; next++;
    } else {
      check(!payload, 'capability', 'mixed scalar union is not implemented');
      next = exceptionAnnotation(grammar, next, type, profile); payload = true;
    }
    if (grammar.spelling(next) !== '|') break;
    next = grammar.expect(next, '|');
  }
  check(payload, 'capability', 'nullable annotation requires an owned scalar payload');
  if (members) check(type === 'i32' && profile.target, 'capability', 'only targeted nullable i32 declarations have a cold tracer');
  return { next, mask: members, first: index, last: next - 1 };
}
export function verifyExceptionParameterPresence(shape, annotation, name, parent, grammar) {
  record(shape, ['undefined','null','optional','default','range','annotation']);
  check(shape.optional === false && shape.default === false, 'capability', 'optional/default selection is not implemented');
  check(mask(shape) === annotation.mask, 'type', 'parameter members differ from their source annotation');
  grammar.raw(shape.range, parent, name, annotation.last);
  grammar.span(shape.annotation, shape.range, annotation.first, annotation.last);
}
export function verifyExceptionReturnPresence(fn, definition, annotation, grammar) {
  const present = Object.hasOwn(fn, 'returnPresence');
  check(Object.hasOwn(definition, 'returnPresence') === present, 'signature', 'function symbol and declaration return presence differ');
  check(present === (annotation.mask !== 0), 'signature', 'return presence must match the exact annotated member set');
  if (!present) return;
  const shape = fn.returnPresence;
  record(shape, ['undefined','null','range','annotation']);
  check(mask(shape) === annotation.mask && same(definition.returnPresence, shape), 'signature');
  check(same(shape.range, fn.range), 'range', 'return declaration range belongs to its original function');
  grammar.span(shape.annotation, shape.range, annotation.first, annotation.last);
}
export function exceptionReferencePresence(value, binding, profile, write, returning) {
  const members = mask(binding.presence);
  if (members) {
    check(binding.kind === 'parameter' && binding.type === 'i32' && profile.target, 'capability', 'nullable local or scalar profile is not implemented');
    check(!write, 'capability', 'nullable writes require a separate flow tracer');
  }
  if (members || returning) {
    record(value.presenceFlow, ['undefined','null']);
    check(mask(value.presenceFlow) === members, 'flow', 'direct reference cannot erase or invent absence without a path proof');
  } else check(!Object.hasOwn(value, 'presenceFlow'), 'flow', 'ordinary reference must omit absent presence metadata');
  return members;
}
