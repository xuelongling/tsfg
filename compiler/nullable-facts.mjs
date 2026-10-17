// SPDX-License-Identifier: MIT
import { check, failure, record, array, text, range, same, budget, scalarType, nullableType, valueType, coreTextLimits } from './nullable-common.mjs';
import { sourceGrammar } from './closure-source-grammar.mjs';

// Reuse only the bounded token guards. Nullable declarations, flow and export
// rules are independent of M19's nonnullable closure grammar.
export function verifyNullableFacts(source, facts, exports) {
  try { return verify(source, facts, exports); }
  catch (error) {
    if (error.code?.startsWith('r03-nullable-')) throw error;
    failure('source', error.message);
  }
}
function verify(source, facts, exports) {
  budget({ source, facts, exports }); record(source, ['path','content']); text(source.path, coreTextLimits.path);
  check(typeof source.content === 'string' && source.content.isWellFormed(), 'source');
  record(facts, ['status','inputs','functions','symbols']); check(facts.status === 'ok');
  const content = source.content, root = { start: 0, end: content.length }, grammar = sourceGrammar(source);
  const within = (value, parent = root) => range(value, parent, content);
  const defs = new Map(), fns = new Map(), headers = new Map(), used = new Set(), top = new Map();
  const symbols = array(facts.symbols, 4096), functions = array(facts.functions, 512); check(functions.length > 0);
  for (const [index, symbol] of symbols.entries()) {
    record(symbol, ['id','name','kind','type','writable','range'], ['presence','returnPresence']);
    check(symbol.id === 's' + (index + 1) && !defs.has(symbol.id), 'identity'); text(symbol.name);
    check(symbol.type === 'i32' && ['function','parameter','local'].includes(symbol.kind), 'type');
    check(symbol.writable === (symbol.kind === 'parameter'), 'permission');
    within(symbol.range); grammar.name(symbol.range, symbol.name); defs.set(symbol.id, symbol);
  }
  const annotation = (items, start) => {
    const first = items[start]; let next = start + 1, nullable = false;
    check(first, 'source');
    if (items[next]?.text === '|') {
      check((first.text === 'i32' && items[next + 1]?.text === 'null') || (first.text === 'null' && items[next + 1]?.text === 'i32'), 'capability');
      next += 2; nullable = true;
    } else check(first.text === 'i32', 'capability');
    return { next, nullable, range: { start: first.start, end: items[next - 1].end } };
  };
  const presence = (shape, declaration, ann, nullable) => {
    record(shape, ['undefined','null','optional','default','range','annotation']);
    check(shape.undefined === false && shape.null === nullable && shape.optional === false && shape.default === false, 'capability');
    check(same(shape.range, declaration) && same(shape.annotation, ann), 'range'); within(shape.range); within(shape.annotation, shape.range);
  };
  let previous = 0;
  for (const fn of functions) {
    record(fn, ['name','symbol','parameters','returnType','body','range'], ['returnPresence','parameterInitializers']);
    text(fn.name, coreTextLimits.name);
    check(fn.returnType === 'i32' && !fns.has(fn.symbol) && !top.has(fn.name), 'identity'); within(fn.range);
    check(fn.range.start >= previous, 'range'); grammar.expect(previous, fn.range.start, []); previous = fn.range.end;
    const def = defs.get(fn.symbol); check(def?.kind === 'function' && def.name === fn.name && !def.presence && same(def.returnPresence, fn.returnPresence), 'symbol');
    used.add(def.id); top.set(fn.name, def.id); fns.set(fn.symbol, fn);
    const items = grammar.between(fn.range.start, fn.range.end); let index = 0;
    const exported = items[index]?.text === 'export'; if (exported) index++;
    check(items[index++]?.text === 'function', 'capability'); const definition = items[index++];
    check(definition?.end === def.range.end, 'source'); grammar.expect(def.range.start, definition.start, []); grammar.name(def.range, fn.name);
    check(items[index++]?.text === '(', 'source');
    const params = array(fn.parameters, 64);
    for (const [position, p] of params.entries()) {
      if (position) check(items[index++]?.text === ',', 'source');
      check(same(p, defs.get(p.id)) && p.kind === 'parameter' && !used.has(p.id) && !p.returnPresence, 'symbol'); used.add(p.id);
      within(p.range, fn.range); const name = items[index++]; check(name?.end === p.range.end, 'source'); grammar.expect(p.range.start, name.start, []);
      check(items[index++]?.text === ':', 'source'); const ann = annotation(items, index); index = ann.next;
      presence(p.presence, { start: p.range.start, end: ann.range.end }, ann.range, ann.nullable);
    }
    if (params.length && items[index]?.text === ',') index++;
    check(items[index++]?.text === ')' && items[index++]?.text === ':', 'source');
    const ann = annotation(items, index); index = ann.next;
    if (ann.nullable) {
      record(fn.returnPresence, ['undefined','null','range','annotation']);
      check(fn.returnPresence.undefined === false && fn.returnPresence.null === true && same(fn.returnPresence.range, fn.range)
        && same(fn.returnPresence.annotation, ann.range), 'signature');
    } else check(fn.returnPresence === undefined, 'signature');
    check(items[index]?.text === '{' && items.at(-1)?.text === '}', 'source');
    if (params.length) check(array(fn.parameterInitializers, 64).length === params.length && fn.parameterInitializers.every(value => value === null), 'capability');
    else check(fn.parameterInitializers === undefined, 'schema');
    headers.set(fn.symbol, { start: items[index].end, end: items.at(-1).start, exported });
  }
  grammar.expect(previous, content.length, []);
  const fit = (actual, expected) => check(actual === expected || actual === scalarType.id && expected === nullableType.id, 'signature');
  let steps = 0;
  for (const fn of functions) {
    const visible = new Map(top), localNames = new Set(), initialized = new Set();
    for (const p of fn.parameters) { check(!localNames.has(p.name), 'scope'); localNames.add(p.name); visible.set(p.name, p.id); initialized.add(p.id); }
    function expression(value, parent, returning = false, depth = 0) {
      check(++steps <= 200000 && depth <= 128, 'limit'); record(value, ['kind','type','range'], ['symbol','target','arguments','signature','presenceFlow','operator','left','right']);
      check(value.type === 'i32', 'type'); within(value.range, parent);
      let type;
      if (value.kind === 'reference') {
        record(value, ['kind','type','range','symbol'], ['presenceFlow']);
        const def = defs.get(value.symbol); check(def && def.kind !== 'function' && visible.get(def.name) === def.id && initialized.has(def.id), 'binding');
        grammar.name(value.range, def.name); type = valueType(def.presence);
      } else if (value.kind === 'call') {
        record(value, ['kind','type','range','target','arguments','signature'], ['presenceFlow']);
        const target = fns.get(value.target); check(target && visible.get(target.name) === target.symbol, 'binding');
        const expected = { parameters: target.parameters.map(p => p.type), returnType: target.returnType,
          ...(target.parameters.length ? { presence: target.parameters.map(p => p.presence) } : {}),
          ...(target.returnPresence ? { returnPresence: target.returnPresence } : {}) };
        // Signature anchors belong to the actual callee declaration, even when
        // that declaration is outside the caller's expression/function range.
        check(same(value.signature, expected), 'signature'); const args = array(value.arguments, 64); check(args.length === target.parameters.length, 'signature');
        const name = grammar.between(value.range.start, value.range.end)[0]; check(name, 'source'); grammar.name({ start: name.start, end: name.end }, target.name);
        let end = name.end;
        for (const [index, arg] of args.entries()) {
          grammar.expect(end, arg.range?.start, [index ? ',' : '(']); fit(expression(arg, value.range, false, depth + 1), valueType(target.parameters[index].presence)); end = arg.range.end;
        }
        const tail = grammar.spelling(end, value.range.end);
        check(same(tail, args.length ? [')'] : ['(',')']) || args.length > 0 && same(tail, [',',')']), 'source');
        type = valueType(target.returnPresence);
      } else if (value.kind === 'shortCircuit') {
        record(value, ['kind','type','range','operator','left','right','presenceFlow']); check(value.operator === '??', 'capability');
        // Direct-call ranges retain leading trivia; its first token still starts
        // the whole coalesce. Operands must retain their actual Source anchors.
        const left = expression(value.left, parent, false, depth + 1);
        const right = expression(value.right, value.range, false, depth + 1);
        check(left === nullableType.id && right === scalarType.id, 'type');
        const leftTokens = grammar.between(value.left.range.start, value.left.range.end);
        const rightTokens = grammar.between(value.right.range.start, value.right.range.end);
        check(leftTokens[0]?.start === value.range.start && leftTokens.at(-1)?.end === value.left.range.end
          && rightTokens.at(-1)?.end === value.right.range.end && value.range.end === value.right.range.end, 'range');
        const operator = grammar.between(value.left.range.end, value.right.range.start);
        check(operator.length === 2 && operator[0].text === '?' && operator[1].text === '?'
          && operator[0].end === operator[1].start, 'source');
        // Calls retain raw Node.Pos at the preceding syntax token's end;
        // references and nested coalesces start at their first actual token.
        const preceding = grammar.between(0, value.range.start).at(-1);
        check(value.left.range.start === (value.left.kind === 'call' ? preceding?.end : leftTokens[0]?.start), 'range');
        check(value.right.range.start === (value.right.kind === 'call' ? operator[1].end : rightTokens[0]?.start), 'range');
        grammar.expect(value.right.range.end, value.range.end, []); type = scalarType.id;
      } else failure('capability', 'only required references, direct calls and nullish coalesce are represented');
      if (type === nullableType.id) check(same(value.presenceFlow, { undefined: false, null: true }), 'capability', 'nullable narrowing/get/retype is not represented');
      else check(value.kind === 'shortCircuit' || returning && fn.returnPresence
        ? same(value.presenceFlow, { undefined: false, null: false }) : value.presenceFlow === undefined, 'flow');
      return type;
    }
    const body = array(fn.body, 4096), header = headers.get(fn.symbol); let end = header.start, returned = false;
    check(body.length > 0, 'return');
    for (const item of body) {
      check(!returned, 'return'); within(item.range, header); check(item.range.start >= end, 'range');
      const gap = grammar.spelling(end, item.range.start).filter(token => token !== ';');
      if (item.kind === 'variable') {
        record(item, ['kind','symbol','initializer','range']); const def = defs.get(item.symbol?.id);
        check(def?.kind === 'local' && !def.writable && !def.returnPresence && same(item.symbol, def) && !used.has(def.id), 'symbol');
        check(!localNames.has(def.name) && same(gap, ['const']) && item.range.start === def.range.start, 'scope');
        const tokens = grammar.between(def.range.end, item.initializer?.range?.start); check(tokens[0]?.text === ':', 'source');
        const ann = annotation(tokens, 1); check(ann.next === tokens.length - 1 && tokens.at(-1)?.text === '=', 'source');
        if (ann.nullable) presence(def.presence, item.range, ann.range, true); else check(def.presence === undefined, 'signature');
        fit(expression(item.initializer, item.range), valueType(def.presence)); grammar.expect(item.initializer.range.end, item.range.end, []);
        used.add(def.id); localNames.add(def.name); visible.set(def.name, def.id); initialized.add(def.id);
      } else if (item.kind === 'return') {
        record(item, ['kind','expression','range']); check(gap.length === 0, 'source');
        fit(expression(item.expression, item.range, true), valueType(fn.returnPresence));
        grammar.expect(item.range.start, item.expression.range.start, ['return']);
        check(grammar.spelling(item.expression.range.end, item.range.end).every(token => token === ';'), 'source'); returned = true;
      } else failure('capability', 'only const initialization and return statements are represented');
      end = item.range.end;
    }
    check(returned, 'return'); check(grammar.spelling(end, header.end).every(token => token === ';'), 'source');
  }
  check(used.size === defs.size, 'symbol');
  const expectedExports = [];
  for (const fn of functions) if (headers.get(fn.symbol).exported) {
    check(!fn.returnPresence && fn.parameters.every(p => !p.presence.null), 'capability', 'public entry must use required scalar i32 ABI');
    expectedExports.push({ name: fn.name, target: fn.symbol, sourcePath: source.path, range: fn.range, definition: defs.get(fn.symbol).range });
  }
  for (const entry of array(exports, 512)) record(entry, ['name','target','sourcePath','range','definition']);
  check(expectedExports.length === 1 && same(exports, expectedExports), 'export');
  return { defs, functions: fns, headers };
}
