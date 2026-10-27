// SPDX-License-Identifier: MIT
import { check, record, text, failure } from './reference-common.mjs';
import { numericTokenSyntax } from './float.mjs';
import { verifyReferenceNominal } from './reference-scalar-policy.mjs';

export const scalarValueType = type => ['number','boolean','scalar','number-literal'].includes(type?.kind);
export const referenceValueType = type => ['class-instance','class-this','class-this-view'].includes(type?.kind);

/** Validate semantic roles independently of the spelling of an owned type ID. */
export function verifyReferenceTypes(types, sources) {
  const primitives = new Map(), nominals = new Set(), leaves = new Set();
  for (const type of types.values()) {
    if (['number','boolean','void'].includes(type.kind)) {
      check(!primitives.has(type.kind), 'closure'); primitives.set(type.kind, type.id);
      check(type.scalar === (type.kind === 'number' ? 'f64' : type.kind === 'boolean' ? 'bool' : '')
        && type.nominal === null && type.literal === '', 'scalar');
      leaves.add(type.id);
    } else if (type.kind === 'scalar') {
      check(['i32','f32'].includes(type.scalar), 'unsupported', 'class scalar kind is not consumed yet');
      check(!nominals.has(type.scalar) && type.literal === '', 'nominal'); nominals.add(type.scalar);
      verifyReferenceNominal(type, sources); leaves.add(type.id);
    } else if (type.kind === 'number-literal') {
      text(type.literal); check(type.scalar === '' && type.nominal === null, 'scalar'); leaves.add(type.id);
    } else {
      check(['class-instance','class-constructor','class-this','class-this-view','method-function'].includes(type.kind),
        'unsupported', 'owned type role is not consumed yet');
      check(type.scalar === '' && type.nominal === null && type.literal === '', 'scalar');
    }
    if (leaves.has(type.id)) check(type.declaration === '' && type.target === '' && type.thisArgument === '', 'closure');
  }
  check(['number','boolean','void'].every(kind => primitives.has(kind)), 'closure');
  return { primitives, leaves };
}

/** Preserve a literal occurrence; this checks spelling and metadata, never R01
 * range, value, rounding or a resolved execution scalar. Official display text
 * may already have rounded: it must never replace the original token.
 */
export function verifyReferenceNumericLiteral(state, value, contextType) {
  const narrow = state.types.get(value.type);
  check(narrow?.kind === 'number-literal', 'expression');
  record(value.numericLiteral, ['state','officialType','defaultScalar','contextType']);
  const literal = value.numericLiteral;
  check(literal.state === 'unresolved' && literal.officialType === value.type
    && literal.contextType === contextType, 'literal', 'literal narrow identity or actual slot context differs', value.origin);
  if (contextType) {
    check(state.types.has(contextType), 'closure'); state.typeUses.add(contextType);
    check(['number','scalar','number-literal'].includes(state.types.get(contextType).kind), 'literal');
  }
  let syntax;
  try {
    check(typeof value.token === 'string' && !/^[+-]/.test(value.token), 'representation');
    syntax = numericTokenSyntax(value.token);
  } catch { failure('representation', 'invalid numeric literal token', value.origin); return; }
  const expectedDefault = !syntax.radix && /[.eE]/.test(value.token) ? 'f64' : 'i32';
  check(literal.defaultScalar === expectedDefault, 'literal', 'literal source default differs from its token category', value.origin);
  check(value.origin.end - value.origin.start === value.token.length, 'origin');
}
