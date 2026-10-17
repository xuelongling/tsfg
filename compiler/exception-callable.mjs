// SPDX-License-Identifier: MIT
import { check, record, array, same } from './exception-common.mjs';
import { exceptionAnnotation } from './exception-types.mjs';

// This first callable tracer owns only nonnullable () => bool descriptions.
// Nested signatures and other parameter/result shapes need their own cold seam;
// neither a structural signature nor a parameter reference identifies a runtime target.
export function exceptionCallableSignature(signature) {
  record(signature, ['parameters','returnType']);
  check(array(signature.parameters).length === 0 && signature.returnType === 'bool', 'capability', 'only zero-parameter bool-returning callable signatures are implemented');
}
export function exceptionCallableAnnotation(grammar, index, signature, profile) {
  exceptionCallableSignature(signature);
  let next = grammar.expect(index, '('); next = grammar.expect(next, ')');
  next = grammar.expect(next, '=>');
  return exceptionAnnotation(grammar, next, signature.returnType, profile);
}
export function exceptionCallableReference(value, binding) {
  check(binding.kind === 'parameter' && binding.type === 'function', 'capability', 'only direct callable parameter references are implemented');
  check(!Object.hasOwn(value, 'presenceFlow'), 'schema', 'nonnullable callable references must omit presence flow');
  exceptionCallableSignature(binding.signature); exceptionCallableSignature(value.signature);
  check(same(value.signature, binding.signature), 'signature', 'reference signature differs from its declared callable parameter');
  return value.signature;
}
