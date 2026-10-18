// SPDX-License-Identifier: MIT
import { check, failure, record, array, text, range, same, budget, scalarType, typeFor, presenceMask, valueType, coreTextLimits, presenceBudget, presenceDomainBudget, presenceFailure, presenceRethrow } from './nullable-common.mjs';
import { sourceGrammar } from './closure-source-grammar.mjs';

// Reuse only the bounded token guards. Nullable declarations, flow and export
// rules are independent of M19's nonnullable closure grammar.
export function verifyNullableFacts(source, facts, exports, sourceVersion = 3) {
  try {
    check(sourceVersion === 3 || sourceVersion === 4, 'schema');
    const result = verify(source, facts, exports, sourceVersion); return sourceVersion === 3 ? result : undefined;
  }
  catch (error) {
    if (sourceVersion !== 3) presenceRethrow(error);
    if (error.code?.startsWith('r03-nullable-')) throw error;
    failure('source', error.message);
  }
}
function verify(source, facts, exports, sourceVersion) {
  if (sourceVersion === 4) { presenceBudget({ source, facts, exports }); presenceDomainBudget(facts); }
  else budget({ source, facts, exports });
  record(source, ['path','content']); text(source.path, coreTextLimits.path);
  check(typeof source.content === 'string' && source.content.isWellFormed(), 'source');
  record(facts, ['status','inputs','functions','symbols']); check(facts.status === 'ok');
  const content = source.content, root = { start: 0, end: content.length }, grammar = sourceGrammar(source);
  const within = (value, parent = root) => range(value, parent, content);
  const defs = new Map(), fns = new Map(), headers = new Map(), used = new Set(), top = new Map();
  const symbols = array(facts.symbols, 4096), functions = array(facts.functions, 512); check(functions.length > 0);
  for (const [index, symbol] of symbols.entries()) {
    record(symbol, ['id','name','kind','type','writable','range'], ['presence','returnPresence']);
    check(symbol.id === 's' + (index + 1) && !defs.has(symbol.id), 'identity'); text(symbol.name, sourceVersion === 4 ? coreTextLimits.name : undefined);
    check(symbol.type === 'i32' && ['function','parameter','local'].includes(symbol.kind), 'type');
    check(symbol.writable === (symbol.kind === 'parameter'), 'permission');
    within(symbol.range); grammar.name(symbol.range, symbol.name); defs.set(symbol.id, symbol);
  }
  const annotation = (items, start) => {
    const members = new Set(); let next = start;
    for (;;) {
      const item = items[next++];
      check(item && ['i32', 'null', 'undefined'].includes(item.text) && !members.has(item.text), 'capability');
      members.add(item.text);
      if (items[next]?.text !== '|') break;
      next++;
    }
    check(members.has('i32'), 'capability');
    const mask = (members.has('undefined') ? 1 : 0) | (members.has('null') ? 2 : 0);
    return { next, mask, range: { start: items[start].start, end: items[next - 1].end } };
  };
  const presence = (shape, declaration, ann, mask) => {
    record(shape, ['undefined','null','optional','default','range','annotation']);
    check(presenceMask(shape) === mask && shape.optional === false && shape.default === false, 'capability');
    check(same(shape.range, declaration) && same(shape.annotation, ann), 'range'); within(shape.range); within(shape.annotation, shape.range);
  };
  const sourceOwners = sourceVersion === 4 ? presenceSourceOwners(grammar, content) : undefined;
  if (sourceVersion === 4) check(sourceOwners.length === functions.length, 'source');
  let previous = 0;
  for (const [fnIndex, fn] of functions.entries()) {
    const ownerStart = previous, sourceOwner = sourceOwners?.[fnIndex];
    record(fn, ['name','symbol','parameters','returnType','body','range'], ['returnPresence','parameterInitializers']);
    text(fn.name, coreTextLimits.name);
    check(fn.returnType === 'i32' && !fns.has(fn.symbol) && !top.has(fn.name), 'identity'); within(fn.range);
    if (sourceVersion === 4) check(same(fn.range, sourceOwner.span), 'range');
    check(fn.range.start >= previous, 'range'); grammar.expect(previous, fn.range.start, []); previous = fn.range.end;
    const def = defs.get(fn.symbol); check(def?.kind === 'function' && def.name === fn.name && def.presence === undefined && same(def.returnPresence, fn.returnPresence), 'symbol');
    used.add(def.id); top.set(fn.name, def.id); fns.set(fn.symbol, fn);
    const items = sourceOwner ? sourceOwner.items : grammar.between(fn.range.start, fn.range.end); let index = 0;
    const exported = items[index]?.text === 'export'; if (exported) index++;
    check(items[index++]?.text === 'function', 'capability'); const definition = items[index++];
    check(definition?.end === def.range.end, 'source');
    if (sourceVersion === 4) check(def.range.start === items[exported ? 1 : 0].end, 'range');
    grammar.expect(def.range.start, definition.start, []); grammar.name(def.range, fn.name);
    check(items[index++]?.text === '(', 'source');
    const params = array(fn.parameters, 64);
    for (const [position, p] of params.entries()) {
      if (position) check(items[index++]?.text === ',', 'source');
      check(same(p, defs.get(p.id)) && p.kind === 'parameter' && !used.has(p.id) && p.returnPresence === undefined, 'symbol'); used.add(p.id);
      within(p.range, fn.range); const name = items[index++]; check(name?.end === p.range.end, 'source');
      if (sourceVersion === 4) check(p.range.start === items[index - 2].end, 'range');
      grammar.expect(p.range.start, name.start, []);
      check(items[index++]?.text === ':', 'source'); const ann = annotation(items, index); index = ann.next;
      presence(p.presence, { start: p.range.start, end: ann.range.end }, ann.range, ann.mask);
    }
    if (params.length && items[index]?.text === ',') index++;
    check(items[index++]?.text === ')' && items[index++]?.text === ':', 'source');
    const ann = annotation(items, index); index = ann.next;
    if (ann.mask) {
      record(fn.returnPresence, ['undefined','null','range','annotation']);
      check(presenceMask(fn.returnPresence) === ann.mask && same(fn.returnPresence.range, fn.range)
        && same(fn.returnPresence.annotation, ann.range), 'signature');
    } else check(fn.returnPresence === undefined, 'signature');
    check(items[index]?.text === '{' && items.at(-1)?.text === '}', 'source');
    const span = sourceOwner ? sourceOwner.span : { start: ownerStart, end: items.at(-1).end };
    if (params.length) check(array(fn.parameterInitializers, 64).length === params.length && fn.parameterInitializers.every(value => value === null), 'capability');
    else check(fn.parameterInitializers === undefined, 'schema');
    headers.set(fn.symbol, { start: items[index].end, end: items.at(-1).start, exported, ...(sourceVersion === 4 ? { span } : {}) });
  }
  grammar.expect(previous, content.length, []);
  const fit = (actual, expected) => check(actual === expected || actual === scalarType.id && typeFor(expected).kind === 'nullable-i32', 'signature');
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
        check(typeFor(left).kind === 'nullable-i32' && right === scalarType.id, 'type');
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
      const shape = typeFor(type);
      if (shape.kind === 'nullable-i32') check(same(value.presenceFlow, { undefined: shape.undefined, null: shape.null }), 'capability', 'nullable narrowing/get/retype is not represented');
      else check(value.kind === 'shortCircuit' || returning && fn.returnPresence
        ? same(value.presenceFlow, { undefined: false, null: false }) : value.presenceFlow === undefined, 'flow');
      return type;
    }
    const body = array(fn.body, 4096), header = headers.get(fn.symbol); let end = header.start, returned = false;
    try {
    check(body.length > 0, 'return');
    if (sourceVersion === 4 && grammar.between(header.start, header.end).some(token => token.text === 'if')) {
      steps += verifyPresenceBody(source, fn, body, header, grammar, top); check(steps <= 200000, 'limit'); continue;
    }
    for (const item of body) {
      check(!returned, 'return'); within(item.range, header); check(item.range.start >= end, 'range');
      const gap = grammar.spelling(end, item.range.start).filter(token => token !== ';');
      if (item.kind === 'variable') {
        record(item, ['kind','symbol','initializer','range']); const def = defs.get(item.symbol?.id);
        check(def?.kind === 'local' && !def.writable && def.returnPresence === undefined && same(item.symbol, def) && !used.has(def.id), 'symbol');
        check(!localNames.has(def.name) && same(gap, ['const']) && item.range.start === def.range.start, 'scope');
        const tokens = grammar.between(def.range.end, item.initializer?.range?.start); check(tokens[0]?.text === ':', 'source');
        const ann = annotation(tokens, 1); check(ann.next === tokens.length - 1 && tokens.at(-1)?.text === '=', 'source');
        if (ann.mask) presence(def.presence, item.range, ann.range, ann.mask); else check(def.presence === undefined, 'signature');
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
    } catch (error) { if (sourceVersion === 4) presenceRethrow(error, { sourceId: source.path, ...header.span }); throw error; }
  }
  check(used.size === defs.size, 'symbol');
  const expectedExports = [];
  for (const fn of functions) if (headers.get(fn.symbol).exported) {
    check(fn.returnPresence === undefined && fn.parameters.every(p => valueType(p.presence) === scalarType.id), 'capability', 'public entry must use required scalar i32 ABI');
    expectedExports.push({ name: fn.name, target: fn.symbol, sourcePath: source.path, range: fn.range, definition: defs.get(fn.symbol).range });
  }
  for (const entry of array(exports, 512)) record(entry, ['name','target','sourcePath','range','definition']);
  check(expectedExports.length === 1 && same(exports, expectedExports), 'export');
  return { defs, functions: fns, headers };
}

// Match only bounded source-token delimiters before trusting any DTO owner/header range.
function presenceSourceOwners(grammar, content) {
  const tokens = grammar.between(0, content.length), owners = []; let index = 0, previous = 0;
  while (index < tokens.length) {
    const first = index; if (tokens[index]?.text === 'export') index++;
    check(tokens[index]?.text === 'function', 'capability');
    while (index < tokens.length && tokens[index].text !== '{') index++;
    check(index < tokens.length, 'source'); let depth = 0, closing;
    do {
      const token = tokens[index++];
      if (token.text === '{') depth++; else if (token.text === '}') depth--;
      if (depth === 0) closing = token;
    } while (depth > 0 && index < tokens.length);
    check(closing && depth === 0, 'source');
    owners.push({ span: { start: previous, end: closing.end }, items: tokens.slice(first, index) }); previous = closing.end;
  }
  return owners;
}

// A finite token plan only guards already captured Source4 facts; it is not a TS parser or flow solver.
function presenceTokenPlan(header, grammar, content) {
  const items = grammar.between(header.start, header.end); let index = 0;
  const take = expected => { const token = items[index++]; check(token && (expected === undefined || token.text === expected), 'capability'); return token; };
  const returned = start => {
    const keyword = take('return'), value = take(undefined);
    check(!/[\r\n\u2028\u2029]/.test(content.slice(keyword.end, value.start)), 'capability');
    const end = items[index]?.text === ';' ? take(';').end : value.end;
    return { range: { start, end }, value: { start: keyword.end, end: value.end }, token: value };
  };
  const guards = []; let end = header.start;
  while (items[index]?.text === 'if') {
    check(guards.length < 2, 'limit'); const keyword = take('if'); take('(');
    const left = take(undefined); take('==='); const right = take(undefined), close = take(')');
    const open = take('{'), result = returned(open.end), blockEnd = take('}');
    guards.push({ range: { start: keyword.start, end: blockEnd.end }, condition: { start: left.start, end: right.end },
      left: { start: left.start, end: left.end }, right: { start: right.start, end: right.end },
      block: { start: close.end, end: blockEnd.end }, result, absence: right.text === 'null' ? 'null' : 'undefined' });
    end = blockEnd.end;
  }
  check(guards.length > 0, 'capability'); const final = returned(end);
  check(index === items.length, 'capability'); return { guards, final };
}
function verifyPresenceBody(source, fn, body, header, grammar, top) {
  const primary = span => ({ sourceId: source.path, start: span.start, end: span.end });
  const demand = (condition, category, span) => { if (!condition) presenceFailure(category, primary(span)); };
  const shape = (value, keys, span) => { try { record(value, keys); } catch (error) { presenceRethrow(error, primary(span)); } };
  const anchor = (actual, expected) => { shape(actual, ['start','end'], expected); demand(same(actual, expected), 'range', expected); };
  const name = (span, expected) => { try { grammar.name(span, expected); } catch (error) { presenceRethrow(error, primary(span)); } };
  const plan = presenceTokenPlan(header, grammar, source.content), owner = header.span;
  const guarded = fn.parameters.filter(p => presenceMask(p.presence) !== 0);
  demand(guarded.length === 1 && fn.parameters.length > 1 && fn.returnPresence === undefined, 'capability', owner);
  const parameter = guarded[0], mask = presenceMask(parameter.presence);
  const routes = [ { mask: 1, tests: ['undefined'], flows: [1] }, { mask: 2, tests: ['null'], flows: [2] },
    { mask: 3, tests: ['null','undefined'], flows: [3,1] }, { mask: 3, tests: ['undefined','null'], flows: [3,2] } ];
  demand(body.length === plan.guards.length + 1, 'capability', owner);
  for (const guard of plan.guards) {
    if (guard.absence === 'undefined') { name(guard.right, 'undefined');
      demand(!top.has('undefined') && !fn.parameters.some(p => p.name === 'undefined'), 'binding', guard.right); }
  }
  const route = routes.find(item => item.mask === mask && same(item.tests, plan.guards.map(g => g.absence)));
  if (!route) {
    const bad = plan.guards.findIndex((guard, index) => !routes.some(item => item.mask === mask
      && item.tests.length > index && item.tests.slice(0, index + 1).every((test, step) => test === plan.guards[step].absence)));
    presenceFailure('capability', primary(bad < 0 ? owner : plan.guards[bad].right));
  }
  const reference = (value, expected, parameter, flow) => {
    shape(value, flow === undefined ? ['kind','type','symbol','range'] : ['kind','type','symbol','presenceFlow','range'], expected);
    demand(value.kind === 'reference', 'capability', expected); demand(value.type === 'i32', 'type', expected);
    demand(parameter !== undefined && value.symbol === parameter.id, 'binding', expected); anchor(value.range, expected); name(expected, parameter.name);
    if (flow !== undefined) { shape(value.presenceFlow, ['undefined','null'], expected);
      demand(same(value.presenceFlow, { undefined: !!(flow & 1), null: !!(flow & 2) }), 'flow', expected); }
  };
  for (const [index, guard] of plan.guards.entries()) {
    const item = body[index]; shape(item, ['kind','condition','thenBody','range'], guard.range);
    demand(item.kind === 'if', 'capability', guard.range); anchor(item.range, guard.range);
    const condition = item.condition; shape(condition, ['kind','type','operator','left','right','range'], guard.condition);
    demand(condition.kind === 'presenceTest' && condition.operator === '===', 'capability', guard.condition);
    demand(condition.type === 'bool', 'type', guard.condition); anchor(condition.range, guard.condition);
    reference(condition.left, guard.left, parameter, route.flows[index]);
    const right = condition.right; shape(right, ['kind','type','absence','range'], guard.right);
    demand(right.kind === 'absence' && right.absence === guard.absence, 'capability', guard.right);
    demand(right.type === 'i32', 'type', guard.right); anchor(right.range, guard.right);
    demand(Array.isArray(item.thenBody), 'schema', guard.block); demand(item.thenBody.length === 1, 'capability', guard.block);
    const block = item.thenBody[0]; shape(block, ['kind','body','range'], guard.block);
    demand(block.kind === 'block', 'capability', guard.block); anchor(block.range, guard.block);
    demand(Array.isArray(block.body), 'schema', guard.result.range); demand(block.body.length === 1, 'capability', guard.result.range);
    const result = block.body[0]; shape(result, ['kind','expression','range'], guard.result.range);
    demand(result.kind === 'return', 'capability', guard.result.range); anchor(result.range, guard.result.range);
    const fallback = fn.parameters.find(p => p.id === result.expression?.symbol && p.id !== parameter.id && presenceMask(p.presence) === 0);
    reference(result.expression, guard.result.value, fallback, undefined);
  }
  const result = body.at(-1); shape(result, ['kind','expression','range'], plan.final.range);
  demand(result.kind === 'return', 'capability', plan.final.range); anchor(result.range, plan.final.range);
  reference(result.expression, plan.final.value, parameter, 0); return plan.guards.length * 4 + 1;
}
