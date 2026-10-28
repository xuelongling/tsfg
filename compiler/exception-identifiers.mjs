// SPDX-License-Identifier: MIT
import { check } from './exception-common.mjs';

// Cold input has no official-checker guarantee. The Source scanner checks each
// escape against ID_Start/ID_Continue before joining identifier characters;
// two surrogate escapes never become one valid identifier code point.
const identifierStart = /^[$_\p{ID_Start}]$/u;
const identifierPart = /^[$\u200c\u200d\p{ID_Continue}]$/u;
export function exceptionIdentifierName(spelling) {
  check(typeof spelling === 'string' && spelling.length > 0, 'source', 'empty identifier token');
  const escape = /\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/uy;
  let index = 0, name = '', first = true;
  while (index < spelling.length) {
    let point;
    if (spelling[index] === '\\') {
      escape.lastIndex = index;
      const match = escape.exec(spelling);
      check(match && match.index === index, 'source', 'invalid identifier escape');
      point = Number.parseInt(match[1] ?? match[2], 16); index = escape.lastIndex;
    } else {
      point = spelling.codePointAt(index); index += point > 0xffff ? 2 : 1;
    }
    check(point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff), 'source', 'identifier code point is not a Unicode scalar');
    const character = String.fromCodePoint(point);
    check((first ? identifierStart : identifierPart).test(character), 'source', 'identifier code point is invalid at this position');
    name += character; first = false;
  }
  return name;
}
