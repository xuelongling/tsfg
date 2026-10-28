// SPDX-License-Identifier: MIT
import { integerNames } from './identity.mjs';
import { floatNames } from './float.mjs';

// Product scalar operation rules shared by ordinary and closure-owned HIR.
// Callers retain their own exact schemas, source anchors and error identities.
export const scalarOperations = Object.freeze({ "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "rem",
  "<<": "shl", ">>": "shr", ">>>": "ushr", "&": "and", "|": "or", "^": "xor",
  "===": "eq", "!==": "ne", "<": "lt", "<=": "le", ">": "gt", ">=": "ge" });
const comparisons = new Set(["===", "!==", "<", "<=", ">", ">="]);
// All supported binary operators associate left. A group node is the explicit
// barrier allowing a child with otherwise incompatible precedence/association.
const precedence = { "||": -1, "&&": 0, "|": 1, "^": 2, "&": 3, "===": 4, "!==": 4,
  "<": 5, "<=": 5, ">": 5, ">=": 5, "<<": 6, ">>": 6, ">>>": 6,
  "+": 7, "-": 7, "*": 8, "/": 8, "%": 8 };
const integer = type => integerNames.includes(type);
const floating = type => floatNames.includes(type);
const scalar = type => type === 'bool' || integer(type) || floating(type);
const binary = expression => ['binary', 'shortCircuit'].includes(expression.kind);

export function validScalarUnary(operator, result, operand, operandKind) {
  return scalar(result) && result === operand && !['binary', 'shortCircuit'].includes(operandKind)
    && (operator === '!' ? result === 'bool' : ['+', '-', '~'].includes(operator)
      && (integer(result) || floating(result) && ['+', '-'].includes(operator)));
}

export function validScalarBinary(kind, operator, result, left, right, leftExpression, rightExpression) {
  const short = kind === 'shortCircuit';
  if (!(short ? ['&&', '||'].includes(operator) : kind === 'binary' && Object.hasOwn(scalarOperations, operator))
      || !scalar(left) || !scalar(right) || !scalar(result)) return false;
  const shift = ['<<', '>>', '>>>'].includes(operator);
  if ((shift ? right !== 'i32' : left !== right)
      || result !== (short || comparisons.has(operator) ? 'bool' : left)
      || (short ? left !== 'bool' : !['===', '!=='].includes(operator) && !integer(left)
        && !(floating(left) && (comparisons.has(operator) || ['+', '-', '*', '/', '%'].includes(operator))))) return false;
  if (binary(leftExpression) && (!Object.hasOwn(precedence, leftExpression.operator)
      || precedence[leftExpression.operator] < precedence[operator])) return false;
  if (binary(rightExpression) && (!Object.hasOwn(precedence, rightExpression.operator)
      || precedence[rightExpression.operator] <= precedence[operator])) return false;
  return true;
}

export { comparisons as scalarComparisons, precedence as scalarPrecedence };
