// SPDX-License-Identifier: MIT
import { check, record, same, presenceMask, scalarType, presenceFailure, presenceRethrow } from './nullable-common.mjs';

// A finite source-token plan for captured guards, not a TypeScript evaluator.
// Strings are one token here so comments, braces and escaped quotes inside the
// tag cannot change statement ownership. Other source grammar remains shared.
function tokens(content, header) {
  const rows = [], pattern = /\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*|\s+|"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n\u2028\u2029])*"|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n\u2028\u2029])*'|(?:\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})|[$_\p{ID_Start}])(?:\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})|[$\u200c\u200d\p{ID_Continue}])*|===|!==|[^\s]/gu;
  pattern.lastIndex = header.start; let match;
  while ((match = pattern.exec(content)) && match.index < header.end) {
    check(pattern.lastIndex <= header.end, 'source');
    if (/^\s|^\/\*|^\/\//u.test(match[0])) continue;
    rows.push({ text: match[0], start: match.index, end: pattern.lastIndex }); check(rows.length <= 50000, 'limit');
  }
  return rows;
}

// Decode only a literal tag, without eval/Function/AST access. The final value
// must be exactly "undefined"; identity escapes follow TS string literal rules.
function undefinedTag(raw) {
  check(raw.length >= 2 && ['"',"'"].includes(raw[0]) && raw.at(-1) === raw[0], 'capability');
  let decoded = '';
  for (let i = 1; i < raw.length - 1; i++) {
    let c = raw[i];
    if (c === '\\') {
      c = raw[++i]; check(c !== undefined, 'source');
      if (c === '\r' || c === '\n' || c === '\u2028' || c === '\u2029') { if (c === '\r' && raw[i + 1] === '\n') i++; continue; }
      if (c === 'u' || c === 'x') {
        let digits;
        if (c === 'u' && raw[i + 1] === '{') { const end = raw.indexOf('}', i + 2); check(end > i + 2, 'source'); digits = raw.slice(i + 2, end); i = end; }
        else { const size = c === 'u' ? 4 : 2; digits = raw.slice(i + 1, i + 1 + size); check(digits.length === size, 'source'); i += size; }
        check(/^[0-9a-fA-F]{1,6}$/.test(digits) && Number.parseInt(digits, 16) <= 0x10ffff, 'source');
        c = String.fromCodePoint(Number.parseInt(digits, 16));
      } else {
        check(!/[0-9]/.test(c), 'capability');
        c = ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' })[c] ?? c;
      }
    }
    decoded += c;
  }
  check(decoded === 'undefined', 'capability');
}
function tokenPlan(source, header) {
  const rows = tokens(source.content, header); let index = 0;
  const take = text => { const row = rows[index++]; check(row && (text === undefined || row.text === text), 'capability'); return row; };
  const keyword = take('if'), paren = take('('), first = rows[index];
  const mirrored = first?.text !== 'typeof'; let tag;
  if (mirrored) { tag = take(undefined); undefinedTag(tag.text); }
  let operator;
  if (mirrored) { operator = take(undefined); check(['===','!=='].includes(operator.text), 'capability'); }
  const typeOf = take('typeof'), operand = take(undefined);
  if (!mirrored) { operator = take(undefined); check(['===','!=='].includes(operator.text), 'capability'); tag = take(undefined); undefinedTag(tag.text); }
  const last = mirrored ? operand : tag;
  const close = take(')'), open = take('{');
  const returned = start => {
    const keyword = take('return'), first = rows[index]; check(first, 'capability');
    check(!/[\r\n\u2028\u2029]/.test(source.content.slice(keyword.end, first.start)), 'capability');
    let last;
    while (index < rows.length && ![';','}'].includes(rows[index].text)) last = take(undefined);
    check(last, 'capability'); const end = rows[index]?.text === ';' ? take(';').end : last.end;
    return { range: { start, end }, raw: { start: keyword.end, end: last.end }, first, last };
  };
  const early = returned(open.end), blockEnd = take('}'), final = returned(blockEnd.end);
  check(index === rows.length, 'capability');
  return { range: { start: keyword.start, end: blockEnd.end }, condition: { start: first.start, end: last.end },
    // Raw AST Node.Pos includes trivia following the preceding syntax token.
    // The complete condition alone starts at its first actual token.
    typeofRange: { start: mirrored ? operator.end : paren.end, end: operand.end }, operand: { start: typeOf.end, end: operand.end },
    tagRange: { start: mirrored ? paren.end : operator.end, end: tag.end }, operator: operator.text,
    block: { start: close.end, end: blockEnd.end }, early, final };
}

export function verifyTypeofBody(source, fn, body, header, grammar, expression) {
  const primary = span => ({ sourceId: source.path, ...span });
  const demand = (condition, category, span) => { if (!condition) presenceFailure(category, primary(span)); };
  const shape = (value, keys, span) => { try { record(value, keys); } catch (error) { presenceRethrow(error, primary(span)); } };
  const anchor = (actual, expected) => { shape(actual, ['start','end'], expected); demand(same(actual, expected), 'range', expected); };
  const plan = tokenPlan(source, header), guarded = fn.parameters.filter(p => presenceMask(p.presence));
  demand(guarded.length === 1 && fn.parameters.length > 1 && fn.returnPresence === undefined && body.length === 2, 'capability', header.span);
  const parameter = guarded[0], mask = presenceMask(parameter.presence), ne = plan.operator === '!==';
  demand((mask === 1 || mask === 3) && (!ne || mask === 1), 'flow', plan.condition);
  const reference = (value, expected, target, flow) => {
    shape(value, flow === undefined ? ['kind','type','symbol','range'] : ['kind','type','symbol','presenceFlow','range'], expected);
    demand(value.kind === 'reference', 'capability', expected); demand(value.type === 'i32', 'type', expected);
    demand(target !== undefined && value.symbol === target.id, 'binding', expected); anchor(value.range, expected);
    try { grammar.name(expected, target.name); } catch (error) { presenceRethrow(error, primary(expected)); }
    if (flow !== undefined) { shape(value.presenceFlow, ['undefined','null'], expected);
      demand(same(value.presenceFlow, { undefined: !!(flow & 1), null: !!(flow & 2) }), 'flow', expected); }
  };
  const item = body[0]; shape(item, ['kind','condition','thenBody','range'], plan.range);
  demand(item.kind === 'if', 'capability', plan.range); anchor(item.range, plan.range);
  const condition = item.condition; shape(condition, ['kind','type','operator','operand','typeTest','range'], plan.condition);
  demand(condition.kind === 'type-test' && condition.operator === plan.operator, 'capability', plan.condition);
  demand(condition.type === 'bool', 'type', plan.condition); anchor(condition.range, plan.condition);
  reference(condition.operand, plan.operand, parameter, mask);
  shape(condition.typeTest, ['tag','typeofRange','tagRange'], plan.condition);
  demand(condition.typeTest.tag === 'undefined', 'capability', plan.tagRange);
  anchor(condition.typeTest.typeofRange, plan.typeofRange); anchor(condition.typeTest.tagRange, plan.tagRange);
  demand(Array.isArray(item.thenBody) && item.thenBody.length === 1, 'capability', plan.block);
  const block = item.thenBody[0]; shape(block, ['kind','body','range'], plan.block);
  demand(block.kind === 'block' && Array.isArray(block.body) && block.body.length === 1, 'capability', plan.block); anchor(block.range, plan.block);
  const early = block.body[0]; shape(early, ['kind','expression','range'], plan.early.range);
  demand(early.kind === 'return', 'capability', plan.early.range); anchor(early.range, plan.early.range);
  const scalar = value => fn.parameters.find(p => p.id === value?.symbol && p.id !== parameter.id && presenceMask(p.presence) === 0);
  reference(early.expression, plan.early.raw, ne ? parameter : scalar(early.expression), ne ? 0 : undefined);
  const final = body[1]; shape(final, ['kind','expression','range'], plan.final.range);
  demand(final.kind === 'return', 'capability', plan.final.range); anchor(final.range, plan.final.range);
  // Source6's inequality route has a direct scalar fallback. Only equality
  // continues through the recursive nullable continuation profile.
  if (ne) { reference(final.expression, plan.final.raw, scalar(final.expression), undefined); return 5; }
  const expected = ['reference','call'].includes(final.expression?.kind) ? plan.final.raw : { start: plan.final.first.start, end: plan.final.last.end };
  anchor(final.expression?.range, expected);
  const uses = new Set(), narrowed = new Map([[parameter.id, mask === 1 ? 0 : 2]]);
  // Continuation groups use the same bounded source/expression walker. Only
  // their inner reference is checked against the independently proved arm;
  // outer groups retain their source range and never acquire invented flow.
  const constraint = mask === 3 ? undefined : def => def.id === parameter.id;
  demand(expression(final.expression, plan.final.raw, false, 0, narrowed, uses, constraint) === scalarType.id, 'type', expected);
  demand(uses.has(parameter.id), 'flow', expected);
  return 5;
}
