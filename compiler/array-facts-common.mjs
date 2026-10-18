// SPDX-License-Identifier: MIT
// Complete cold Array facts ownership; official checking remains with Source.
// The frame boundary completes safe graph preflight before entering this model.
import { canonical, sha256 } from './identity.mjs';
import { numericTokenSyntax } from './float.mjs';
import { identifierName, sourceTrivia, skipCallTrivia } from './module-facts.mjs';

export const arrayFactsLimits = Object.freeze({ bytes: 2097152, depth: 64, jsonTokens: 200000,
  stringBytes: 1048576, safeNonnegativeIntegers: true, allowNul: true, rejectPrototypeKeys: true });
export function arrayFactsFailure(kind, cause = undefined) {
  throw Object.assign(new TypeError('r03-array-facts-' + kind + ': invalid owned Array facts', { cause }),
    { code: 'r03-array-facts-' + kind, ruleId: 'r01-input-boundary', phase: 'input' });
}
export const arrayCheck = (condition, kind = 'schema') => { if (!condition) arrayFactsFailure(kind); };
export function arrayRecord(value, keys) {
  arrayCheck(value && typeof value === 'object' && !Array.isArray(value));
  arrayCheck(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
export const list = (value, min, max) => {
  arrayCheck(Array.isArray(value));
  arrayCheck(value.length >= min && value.length <= max, 'limit'); return value;
};
export const text = value => arrayCheck(typeof value === 'string' && value.length > 0 && value.isWellFormed(), 'input');
export const digest = value => arrayCheck(typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value), 'identity');
export const equal = (a, b) => canonical(a) === canonical(b);
export function logicalPath(value) {
  text(value);
  arrayCheck(value.startsWith('/') && !value.includes('\\') && !value.includes('\0')
    && value.slice(1).split('/').every(part => part && part !== '.' && part !== '..'), 'input');
  return value;
}
export const originIdentity = (domain, sourcePath, range, field) =>
  sha256(domain + '\0' + canonical({ sourcePath, [field]: range }));
export function range(value, parent, content) {
  arrayRecord(value, ['start', 'end']);
  const boundary = i => !(content.charCodeAt(i) >= 0xdc00 && content.charCodeAt(i) <= 0xdfff
    && content.charCodeAt(i - 1) >= 0xd800 && content.charCodeAt(i - 1) <= 0xdbff);
  arrayCheck(Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end)
    && !Object.is(value.start, -0) && !Object.is(value.end, -0)
    && value.start >= parent.start && value.start < value.end && value.end <= parent.end
    && boundary(value.start) && boundary(value.end), 'input');
  return value;
}
export const window = (content, start, end) => sourceTrivia(content, start, end);
export const compact = (content, span) => window(content, span.start, span.end).replace(/\s/g, '');
export const lineBreak = text => /[\r\n\u2028\u2029]/.test(text);
export function tokenAt(token, span, content, signed = false) {
  const raw = content.slice(span.start, span.end);
  if (!signed || !/^[+-]/.test(token)) { arrayCheck(raw === token, 'input'); return; }
  arrayCheck(raw[0] === token[0], 'input');
  const rest = raw.slice(1), offset = skipCallTrivia(rest);
  arrayCheck(offset >= 0 && rest.slice(offset) === token.slice(1), 'input');
}
export function nameAt(name, span, content) {
  text(name);
  let decoded;
  try { decoded = identifierName(content.slice(span.start, span.end)); } catch { arrayFactsFailure('input'); }
  arrayCheck(decoded === name, 'input');
}

/** Raw literal arithmetic only. Reject before allocating powers or a large BigInt. */
export function arrayIndexDecimal(token, maximum = 4294967294n) {
  text(token);
  arrayCheck(Buffer.byteLength(token, 'utf8') <= 65536, 'limit');
  arrayCheck(!/^[+-]/.test(token), 'input');
  let syntax;
  try { syntax = numericTokenSyntax(token); } catch { arrayFactsFailure('input'); }
  if (syntax.radix) {
    const clean = syntax.text.replaceAll('_', ''), prefix = clean.slice(0, 2).toLowerCase();
    const digits = clean.slice(2).replace(/^0+/, '') || '0';
    arrayCheck(prefix === '0x' ? digits.length <= 8 : prefix === '0b'
      ? digits.length <= 32 : digits.length < 11 || digits.length === 11 && digits[0] <= '3', 'input');
    const value = BigInt(prefix + digits);
    arrayCheck(value <= maximum, 'input'); return value.toString();
  }
  const match = syntax.decimal;
  arrayCheck(match, 'input');
  const fraction = (match[2] ?? match[3] ?? '').replaceAll('_', '');
  let digits = ((match[1] ?? '').replaceAll('_', '') + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const trimmed = digits.replace(/0+$/, ''), trailing = digits.length - trimmed.length;
  let exponent = (match[4] ?? '0').replaceAll('_', ''), negative = exponent.startsWith('-');
  exponent = exponent.replace(/^[+-]/, '').replace(/^0+/, '') || '0';
  // A nonzero coefficient has at most65536 digits. Any exponent with more than
  // six effective decimal digits is already outside the integer/small-domain bounds.
  arrayCheck(exponent.length <= 6, 'input');
  const scale = (negative ? -Number(exponent) : Number(exponent)) - fraction.length + trailing;
  arrayCheck(scale >= 0 && trimmed.length + scale <= 10, 'input');
  digits = trimmed + '0'.repeat(scale);
  const value = BigInt(digits);
  arrayCheck(value <= maximum, 'input'); return value.toString();
}
