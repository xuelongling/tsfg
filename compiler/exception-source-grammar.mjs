// SPDX-License-Identifier: MIT
import { exceptionIdentifierName } from './exception-identifiers.mjs';
import { check, range, wireLimits } from './exception-common.mjs';

// Bounded scalar/unknown token guards, not a TS parser or name resolver.
// String tokens are admitted only as validated boolean typeof tags; unsupported
// expression variants still fail capability. All offsets remain original UTF16.
const reserved = new Set(('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with implements interface let package private protected public static yield await eval arguments').split(' '));
export function exceptionSourceGrammar(source) {
  const content = source.content, root = { start: 0, end: content.length }, tokens = [];
  const scanner = /\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*|\s+|"(?:\\[^\r\n\u2028\u2029]|[^"\\\r\n\u2028\u2029])*"|'(?:\\[^\r\n\u2028\u2029]|[^'\\\r\n\u2028\u2029])*'|(?:\\u(?:\{[0-9a-fA-F]+\}|[0-9a-fA-F]{4})|[$_\p{ID_Start}])(?:\\u(?:\{[0-9a-fA-F]+\}|[0-9a-fA-F]{4})|[$\u200c\u200d\p{ID_Continue}])*|===|!==|=>|[{}():;,=|@.!]/uy;
  let position = 0;
  while (position < content.length) {
    scanner.lastIndex = position;
    const match = scanner.exec(content);
    check(match && match.index === position, 'capability', 'exception source token is not implemented');
    position = scanner.lastIndex;
    if (/^\s|^\/\*|^\/\//u.test(match[0])) continue;
    tokens.push({ text: match[0], start: match.index, end: position });
    check(tokens.length <= wireLimits.sourceTokensPerFile, 'limit');
  }
  const at = index => { check(index >= 0 && index < tokens.length, 'source', 'missing source token'); return tokens[index]; };
  const spelling = index => tokens[index]?.text;
  const rawStart = index => index === 0 ? 0 : at(index - 1).end;
  const expect = (index, text) => { check(at(index).text === text, 'source', 'expected source token ' + text); return index + 1; };
  const raw = (value, parent, first, last = first) => {
    range(value, parent, content);
    check(value.start === rawStart(first) && value.end === at(last).end, 'range', 'raw source anchor differs');
  };
  const token = (value, parent, index) => {
    range(value, parent, content); const item = at(index);
    check(value.start === item.start && value.end === item.end, 'range', 'token source anchor differs');
  };
  const span = (value, parent, first, last = first) => {
    range(value, parent, content);
    check(value.start === at(first).start && value.end === at(last).end, 'range', 'trimmed source anchor differs');
  };
  const name = (value, expected, parent, index, trimmed = false) => {
    (trimmed ? span : raw)(value, parent, index);
    const decoded = exceptionIdentifierName(at(index).text);
    check(!reserved.has(decoded), 'source', 'reserved word cannot define or reference an owned binding');
    check(decoded === expected, 'source', 'identifier differs from its defining symbol');
  };
  const booleanTag = index => {
    const literal = at(index).text, quote = literal[0];
    check((quote === '"' || quote === "'") && literal.at(-1) === quote, 'source', 'typeof tag must be a string literal');
    let decoded = '';
    for (let next = 1; next < literal.length - 1; next++) {
      let character = literal[next];
      if (character !== '\\') { decoded += character; continue; }
      character = literal[++next];
      if (character === 'u' || character === 'x') {
        const braced = character === 'u' && literal[next + 1] === '{';
        const start = next + (braced ? 2 : 1), end = braced ? literal.indexOf('}', start) : start + (character === 'u' ? 4 : 2);
        const digits = literal.slice(start, end);
        check(end > start && end < literal.length - 1 && /^[0-9a-fA-F]+$/.test(digits)
          && (braced ? digits.length <= 6 : digits.length === (character === 'u' ? 4 : 2)), 'source', 'invalid tag escape');
        const point = Number.parseInt(digits, 16); check(point <= 0x10ffff, 'source');
        decoded += String.fromCodePoint(point); next = braced ? end : end - 1;
      } else {
        check(character !== undefined && !/[1-9]/.test(character)
          && (character !== '0' || !/[0-9]/.test(literal[next + 1])), 'source', 'legacy numeric string escape is not supported');
        decoded += ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0' })[character] ?? character;
      }
    }
    check(decoded === 'boolean', 'capability', 'only the boolean typeof tag is implemented');
  };
  return { root, length: tokens.length, at, spelling, rawStart, expect, raw, token, span, name, booleanTag };
}
