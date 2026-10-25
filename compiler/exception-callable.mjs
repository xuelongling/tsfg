// SPDX-License-Identifier: MIT
import { check, record, array, same } from './exception-common.mjs';
import { exceptionAnnotation } from './exception-types.mjs';
import { exceptionIdentifierName } from './exception-identifiers.mjs';

// Callable type identity is independent of runtime target identity. Ordinary
// Core must separately prove an invoked value comes from owned function code.
export function exceptionCallableSignature(signature) {
  record(signature, ['parameters','returnType']);
  const scalars = ['bool','i8','i16','i32','i64','u8','u16','u32','u64','isize','usize','f32','f64'];
  check(array(signature.parameters).every(type => scalars.includes(type)) && scalars.includes(signature.returnType),
    'capability', 'callable signatures require exact nonnullable scalar parameters and result');
}
export function exceptionCallableAnnotation(grammar, index, signature, profile) {
  exceptionCallableSignature(signature);
  let next = grammar.expect(index, '(');
  for (const [ordinal,type] of signature.parameters.entries()) {
    if (ordinal) next = grammar.expect(next, ',');
    exceptionIdentifierName(grammar.at(next).text); next = grammar.expect(next + 1, ':');
    next = exceptionAnnotation(grammar,next,type,profile);
  }
  next = grammar.expect(next, ')');
  next = grammar.expect(next, '=>');
  return exceptionAnnotation(grammar, next, signature.returnType, profile);
}
export function exceptionCallableReference(value, binding) {
  check(['parameter','local'].includes(binding.kind) && binding.type === 'function', 'capability', 'callable reads require an owned declared binding');
  check(!Object.hasOwn(value, 'presenceFlow'), 'schema', 'nonnullable callable references must omit presence flow');
  exceptionCallableSignature(binding.signature); exceptionCallableSignature(value.signature);
  check(same(value.signature, binding.signature), 'signature', 'reference signature differs from its declared callable parameter');
  return value.signature;
}
