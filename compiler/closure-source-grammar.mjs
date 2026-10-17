// SPDX-License-Identifier: MIT
import { identifierName } from './module-facts.mjs';
import { check, same, failure, scalarTypeIds, valueType, range } from './closure-common.mjs';

// Token guards check a bounded, already owned grammar. They do not parse TS ASTs,
// resolve names or decide assignment compatibility. Offsets remain UTF-16.
export function sourceGrammar(source) {
  const content = source.content, tokens = [];
  const token = /\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*|\s+|(?:\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})|[$_\p{ID_Start}])(?:\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})|[$\u200c\u200d\p{ID_Continue}])*|(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9_]+)?)|>>>|===|!==|=>|&&|\|\||<<|>>|<=|>=|\+\+|--|[^\s]/gu;
  let match;
  while ((match = token.exec(content))) {
    if (/^\s|^\/\*|^\/\//u.test(match[0])) continue;
    tokens.push({ text: match[0], start: match.index, end: token.lastIndex });
    check(tokens.length <= 50000, 'limit');
  }
  const between = (start, end) => { check(start <= end, 'range'); const selected = tokens.filter(t => t.start >= start && t.end <= end);
    check(!tokens.some(t => t.start < start && t.end > start || t.start < end && t.end > end), 'range'); return selected; };
  const spelling = (start, end) => between(start, end).map(t => t.text);
  const expect = (start, end, expected) => check(same(spelling(start, end), expected), 'source');
  const name = (anchor, expected) => { range(anchor, { start: 0, end: content.length });
    let actual; try { actual = identifierName(content.slice(anchor.start, anchor.end)); } catch { failure('source'); }
    check(actual === expected, 'source'); };
  function typeReader(items, start = 0) {
    let index = start;
    const take = text => check(items[index++]?.text === text, 'capability', 'unsupported owned type annotation');
    function type(depth = 0) {
      check(depth <= 64, 'limit');
      if (items[index]?.text !== '(') {
        const raw = items[index++]?.text, scalar = ({ boolean: 'bool', number: 'f64' })[raw] ?? raw;
        check(Object.hasOwn(scalarTypeIds, scalar), 'capability', 'unsupported owned type annotation'); return scalar;
      }
      take('('); const parameters = [];
      while (items[index]?.text !== ')') {
        check(parameters.length < 64, 'limit');
        try { identifierName(items[index++]?.text ?? ''); } catch { failure('capability', 'unsupported callable parameter annotation'); }
        take(':'); parameters.push(type(depth + 1));
        if (items[index]?.text !== ',') break;
        index++;
      }
      take(')'); take('=>'); return { parameters, returns: type(depth + 1) };
    }
    return { read: type, index: () => index, take };
  }
  function annotation(start, end, expected) {
    const items = between(start, end), reader = typeReader(items);
    check(same(reader.read(), expected) && reader.index() === items.length, 'signature');
  }
  function header(fn) {
    const items = between(fn.range.start, fn.range.end); let index = 0;
    if (items[index]?.text === 'export') index++;
    check(items[index++]?.text === 'function', 'source');
    const definition = items[index++]; name({ start: definition?.start, end: definition?.end }, fn.name);
    check(items[index++]?.text === '(', 'source');
    for (const [position, p] of fn.parameters.entries()) {
      if (position) check(items[index++]?.text === ',', 'source');
      const item = items[index++]; check(item?.end === p.range.end && item?.start >= p.range.start, 'source'); expect(p.range.start, item.start, []); name(p.range, p.name);
      check(items[index++]?.text === ':', 'capability', 'only required annotated parameters are currently represented');
      const reader = typeReader(items, index), expected = valueType(p.type, p.signature);
      check(same(reader.read(), expected), 'signature'); index = reader.index();
    }
    if (fn.parameters.length && items[index]?.text === ',') index++;
    check(items[index++]?.text === ')' && items[index++]?.text === ':', 'source');
    const reader = typeReader(items, index); check(same(reader.read(), valueType(fn.returnType, fn.returnSignature)), 'signature'); index = reader.index();
    check(items[index]?.text === '{' && items.at(-1)?.text === '}', 'source');
    return { start: items[index].end, end: items.at(-1).start, definition: { start: definition.start, end: definition.end } };
  }
  return { between, spelling, expect, name, annotation, header };
}
