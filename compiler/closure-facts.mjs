// SPDX-License-Identifier: MIT
import { check, record, array, text, range, same, budget, functionType, valueType, callable, failure } from './closure-common.mjs';
import { sourceGrammar } from './closure-source-grammar.mjs';
import { integerRange as scalarRange } from './identity.mjs';
import { floatBits } from './float.mjs';
import { validScalarUnary, validScalarBinary } from './scalar-operators.mjs';
export const expressionType = value => valueType(value.type,
  ['call','indirectCall'].includes(value.kind) ? value.signature?.returnSignature : value.signature);
function compatible(actual, expected) {
  if (!same(actual, expected)) failure(typeof actual === 'object' && typeof expected === 'object' ? 'capability' : 'signature',
    'callable adaptation is not implemented for differing owned descriptors');
}
/** Complete bounded verification, shared by Snapshot input and independent cold HIR. */
export function verifyClosureFacts(source, functions, symbols) {
  budget({ source, functions, symbols }); record(source, ['path','content']); text(source.path);
  check(typeof source.content === 'string' && source.content.isWellFormed(), 'source');
  const rootRange = { start: 0, end: source.content.length }, grammar = sourceGrammar(source);
  const defs = new Map(), fns = new Map(), headers = new Map(), locations = new Map(), fnScopes = new Map(), scopes = new Map();
  for (const symbol of array(symbols)) {
    record(symbol, ['id','name','kind','type','writable','range'], ['lexicalOwner','signature','presence']);
    text(symbol.id); text(symbol.name); range(symbol.range, rootRange); grammar.name(symbol.range, symbol.name);
    check(!defs.has(symbol.id) && ['function','parameter','local'].includes(symbol.kind) && typeof symbol.writable === 'boolean', 'symbol');
    if (symbol.lexicalOwner !== undefined) text(symbol.lexicalOwner);
    if (symbol.kind !== 'function') valueType(symbol.type, symbol.signature);
    defs.set(symbol.id, symbol);
  }
  for (const fn of array(functions, 128)) {
    record(fn, ['name','symbol','parameters','returnType','body','range'], ['lexicalParent','captures','returnSignature','parameterInitializers']);
    text(fn.symbol); check(!fns.has(fn.symbol), 'identity'); range(fn.range, rootRange); array(fn.parameters, 64); array(fn.body, 128);
    const def = defs.get(fn.symbol); check(def?.kind === 'function' && def.name === fn.name && def.type === fn.returnType && !def.writable, 'symbol');
    check((def.lexicalOwner ?? null) === (fn.lexicalParent ?? null), 'owner');
    functionType(fn); fns.set(fn.symbol, fn); headers.set(fn.symbol, grammar.header(fn));
    check(def.range.end === headers.get(fn.symbol).definition.end, 'source'); grammar.expect(def.range.start, headers.get(fn.symbol).definition.start, []);
    if (fn.parameterInitializers !== undefined) check(array(fn.parameterInitializers, 64).length === fn.parameters.length
      && fn.parameterInitializers.every(value => value === null), 'capability', 'default parameter initialization is not implemented');
  }
  check(fns.size > 0, 'schema');
  const top = new Map(); scopes.set('root', top);
  const install = (scope, symbol) => { check(!scope.has(symbol.name), 'scope'); scope.set(symbol.name, symbol.id); };
  const addLocation = (symbol, owner, scope, role, index) => {
    check(!locations.has(symbol.id), 'symbol'); check(symbol.kind === role && (symbol.lexicalOwner === undefined || symbol.lexicalOwner === owner), 'owner');
    locations.set(symbol.id, { owner, scope, role, index });
  };
  const nestedDeclarations = new Map();
  function collect(fn, body, scopePath) {
    const scope = new Map(); scopes.set(fn.symbol + ':' + scopePath, scope); let localIndex = 0, childScope = 0;
    for (const item of body) {
      record(item, ['kind','range'], ['symbol','initializer','expression','target','value','body','condition','thenBody','elseBody']);
      range(item.range, fn.range);
      if (item.kind === 'variable') {
        const symbol = defs.get(item.symbol?.id); check(symbol && same(item.symbol, symbol), 'symbol'); install(scope, symbol);
        addLocation(symbol, fn.symbol, scopePath, 'local', localIndex++);
      } else if (item.kind === 'functionDeclaration') {
        const nested = fns.get(item.symbol?.id), symbol = defs.get(item.symbol?.id);
        check(nested && symbol && same(item.symbol, symbol) && nested.lexicalParent === fn.symbol && same(nested.range, item.range), 'owner');
        check(!nestedDeclarations.has(nested.symbol), 'owner'); nestedDeclarations.set(nested.symbol, { owner: fn.symbol, scopePath }); install(scope, symbol);
        addLocation(symbol, fn.symbol, scopePath, 'function', 0);
      }
      for (const key of ['body','thenBody','elseBody']) if (item[key]) {
        const children = array(item[key], 128);
        // An omitted alternate and an explicit empty alternate introduce no scope.
        if (key !== 'elseBody' || children.length) collect(fn, children, scopePath + '/' + childScope++);
      }
    }
  }
  for (const fn of functions) {
    if (!fn.lexicalParent) { install(top, defs.get(fn.symbol)); addLocation(defs.get(fn.symbol), null, 'root', 'function', 0); }
    collect(fn, fn.body, '0');
    const scope = scopes.get(fn.symbol + ':0');
    for (const [index, p] of fn.parameters.entries()) {
      const symbol = defs.get(p.id); check(symbol && same(symbol, p) && p.kind === 'parameter' && p.writable, 'symbol');
      install(scope, p); addLocation(p, fn.symbol, '0', 'parameter', index);
      if (p.presence !== undefined) {
        record(p.presence, ['undefined','null','optional','default','range','annotation']);
        check(['undefined','null','optional','default'].every(key => p.presence[key] === false), 'capability', 'only required nonnullable parameters are represented');
        range(p.presence.range, fn.range); range(p.presence.annotation, p.presence.range);
        check(p.presence.range.start === p.range.start && p.presence.annotation.start >= p.range.end, 'range');
        grammar.annotation(p.presence.annotation.start, p.presence.annotation.end, valueType(p.type, p.signature));
        grammar.expect(p.range.end, p.presence.annotation.start, [':']);
      }
    }
  }
  check(locations.size === defs.size, 'symbol');
  function lexical(fn, active = new Set()) {
    check(!active.has(fn.symbol), 'owner'); active.add(fn.symbol);
    let inherited = new Map(top);
    if (fn.lexicalParent) {
      const location = nestedDeclarations.get(fn.symbol), parent = fns.get(fn.lexicalParent);
      check(location && parent && location.owner === parent.symbol, 'owner');
      inherited = lexical(parent, active);
      const segments = location.scopePath.split('/'); let path = segments[0];
      for (let index = 0; index < segments.length; index++) {
        if (index) path += '/' + segments[index];
        for (const [name, id] of scopes.get(parent.symbol + ':' + path)) inherited.set(name, id);
      }
    }
    active.delete(fn.symbol); fnScopes.set(fn.symbol, inherited); return inherited;
  }
  for (const fn of functions) lexical(fn);
  let remaining = 4096;
  for (const fn of functions) {
    const captures = [], captureMap = new Map();
    const access = (id, read, write) => {
      const location = locations.get(id); check(location, 'symbol');
      if (location.owner === null || location.owner === fn.symbol) return;
      if (!captureMap.has(id)) { const fact = { symbol: id, read: false, write: false }; captureMap.set(id, fact); captures.push(fact); }
      const fact = captureMap.get(id); fact.read ||= read; fact.write ||= write;
    };
    function expression(value, parent, visible, initialized, write = false) {
      check(--remaining >= 0, 'limit'); record(value, ['kind','type','range'], ['symbol','target','callee','signature','arguments','operand','operator','left','right','boolean','literal','float']);
      if (value.kind === 'call' && value.range?.start < parent.start) {
        // Direct Source calls can retain trivia excluded by their enclosing
        // expression. Validate that exact prefix without changing source anchors.
        range(value.range, fn.range); grammar.expect(value.range.start, parent.start, []);
        range(value.range, { start: value.range.start, end: parent.end });
      } else range(value.range, parent);
      if (write) check(['reference','group'].includes(value.kind), 'permission', 'assignment requires an owned writable binding');
      const type = expressionType(value);
      const common = ['kind','type','range', ...(value.signature ? ['signature'] : [])];
      const exact = extra => record(value, [...common, ...extra]);
      if (value.kind === 'reference' || value.kind === 'functionReference') {
        const named = value.kind === 'functionReference', id = named ? value.target : value.symbol, def = defs.get(id);
        exact([named ? 'target' : 'symbol']); check(def && visible.get(def.name) === id, 'scope'); grammar.name(value.range, def.name);
        if (named) { check(def.kind === 'function', 'symbol'); compatible(type, functionType(fns.get(id))); }
        else { check(def.kind !== 'function', 'symbol'); compatible(type, valueType(def.type, def.signature)); }
        const location = locations.get(id);
        if (location.owner === fn.symbol && def.kind === 'local') check(initialized.has(id), 'dominance');
        if (write) check(def.writable && !named, 'permission'); access(id, !write, write);
      } else if (value.kind === 'call' || value.kind === 'indirectCall') {
        const indirect = value.kind === 'indirectCall'; exact([indirect ? 'callee' : 'target','arguments']);
        const sig = callable(value.signature, 0, !indirect); compatible(type, sig.returns); array(value.arguments, 64);
        check(value.arguments.length === sig.parameters.length, 'signature');
        let calleeEnd;
        if (indirect) {
          // Source's callee reference may retain leading trivia that the call
          // expression excludes. Only a token-free prefix can cross this seam.
          check(value.callee?.range, 'range');
          const calleeStart = Math.min(value.range.start, value.callee.range.start);
          check(calleeStart >= fn.range.start, 'range');
          grammar.expect(calleeStart, Math.max(value.range.start, value.callee.range.start), []);
          expression(value.callee, { start: calleeStart, end: value.range.end }, visible, initialized); compatible(expressionType(value.callee), sig);
          calleeEnd = value.callee.range.end;
        } else {
          const target = fns.get(value.target); check(target && visible.get(target.name) === target.symbol, 'scope'); compatible(sig, functionType(target));
          if (value.signature.presence !== undefined) check(same(value.signature.presence, target.parameters.map(p => p.presence ?? null)), 'signature');
          const first = grammar.between(value.range.start, value.range.end)[0]; check(first, 'source'); grammar.name({ start: first.start, end: first.end }, target.name); calleeEnd = first.end;
        }
        let previous = calleeEnd;
        for (const [index, argument] of value.arguments.entries()) {
          grammar.expect(previous, argument.range.start, [index ? ',' : '(']);
          expression(argument, value.range, visible, initialized); compatible(expressionType(argument), sig.parameters[index]); previous = argument.range.end;
        }
        const tail = grammar.spelling(previous, value.range.end);
        check(same(tail, value.arguments.length ? [')'] : ['(',')']) || value.arguments.length > 0 && same(tail, [',',')']), 'source');
      } else if (value.kind === 'boolean') {
        exact(['boolean']); check(type === 'bool' && typeof value.boolean === 'boolean', 'type'); grammar.expect(value.range.start, value.range.end, [String(value.boolean)]);
      } else if (value.kind === 'integer') {
        exact(['literal']); record(value.literal, ['decimal','token']); check(typeof type === 'string' && !['bool','f32','f64'].includes(type), 'type');
        let integer; try { integer = (value.literal.token.startsWith('-') ? -1n : 1n) * BigInt(value.literal.token.replace(/^-/, '').replaceAll('_', '')); } catch { failure('constant'); }
        const [min, max] = scalarRange(type); check(integer.toString() === value.literal.decimal && integer >= min && integer <= max, 'constant');
        check(grammar.spelling(value.range.start, value.range.end).join('') === value.literal.token, 'source');
      } else if (value.kind === 'floating') {
        exact(['float']); record(value.float, ['bits','token']); check(['f32','f64'].includes(type), 'type');
        check(floatBits(value.float.token, type) === value.float.bits && grammar.spelling(value.range.start, value.range.end).join('') === value.float.token, 'constant');
      } else if (value.kind === 'group' || value.kind === 'unary') {
        const group = value.kind === 'group'; exact(group ? ['operand'] : ['operator','operand']);
        expression(value.operand, value.range, visible, initialized, write); compatible(type, expressionType(value.operand));
        check(group || validScalarUnary(value.operator, type, expressionType(value.operand), value.operand.kind), 'type');
        grammar.expect(value.range.start, value.operand.range.start, [group ? '(' : value.operator]); grammar.expect(value.operand.range.end, value.range.end, group ? [')'] : []);
      } else if (value.kind === 'write') {
        exact(['operator','left','right']); check(value.operator === '=', 'capability');
        expression(value.right, value.range, visible, initialized); expression(value.left, value.range, visible, initialized, true);
        compatible(type, expressionType(value.left)); compatible(type, expressionType(value.right));
        grammar.expect(value.range.start, value.left.range.start, []); grammar.expect(value.left.range.end, value.right.range.start, ['=']); grammar.expect(value.right.range.end, value.range.end, []);
      } else if (value.kind === 'binary' || value.kind === 'shortCircuit') {
        exact(['operator','left','right']); expression(value.left, value.range, visible, initialized); expression(value.right, value.range, visible, initialized);
        check(validScalarBinary(value.kind, value.operator, type, expressionType(value.left), expressionType(value.right),
          value.left, value.right), 'type');
        grammar.expect(Math.min(value.range.start, value.left.range.start), Math.max(value.range.start, value.left.range.start), []);
        grammar.expect(value.left.range.end, value.right.range.start, [value.operator]); grammar.expect(value.right.range.end, value.range.end, []);
      } else failure('capability', 'unsupported owned closure expression');
    }
    function statements(body, parent, inherited, initialized, scopePath) {
      const visible = new Map(inherited); for (const [name, id] of scopes.get(fn.symbol + ':' + scopePath)) visible.set(name, id);
      let previous = parent.start, childScope = 0, returned = false;
      for (const item of body) {
        check(--remaining >= 0, 'limit'); range(item.range, parent); check(item.range.start >= previous, 'range');
        const gap = grammar.spelling(previous, item.range.start).filter(token => token !== ';');
        if (item.kind === 'variable') {
          record(item, ['kind','range','symbol','initializer']); const def = defs.get(item.symbol.id);
          check(gap.length === 1 && ['const','let'].includes(gap[0]) && def.writable === (gap[0] === 'let'), 'source');
          check(item.range.start === def.range.start && item.initializer, 'capability', 'uninitialized closure locals are not implemented');
          expression(item.initializer, item.range, visible, initialized); compatible(expressionType(item.initializer), valueType(def.type, def.signature));
          const annotation = grammar.between(def.range.end, item.initializer.range.start);
          if (annotation[0]?.text === ':') { check(annotation.at(-1)?.text === '=', 'source'); grammar.annotation(annotation[0].end, annotation.at(-1).start, valueType(def.type, def.signature)); }
          else grammar.expect(def.range.end, item.initializer.range.start, ['=']);
          grammar.expect(item.initializer.range.end, item.range.end, []); initialized.add(def.id);
        } else {
          check(gap.length === 0, 'source');
          if (item.kind === 'functionDeclaration') record(item, ['kind','range','symbol']);
          else if (item.kind === 'return' || item.kind === 'expression') {
            record(item, ['kind','range','expression']); expression(item.expression, item.range, visible, initialized);
            grammar.expect(item.range.start, item.expression.range.start, item.kind === 'return' ? ['return'] : []);
            check(grammar.spelling(item.expression.range.end, item.range.end).every(t => t === ';'), 'source');
            if (item.kind === 'return') { compatible(expressionType(item.expression), valueType(fn.returnType, fn.returnSignature)); returned = true; }
          } else if (item.kind === 'assignment') {
            record(item, ['kind','range','target','value']); expression(item.target, item.range, visible, initialized, true); expression(item.value, item.range, visible, initialized);
            compatible(expressionType(item.target), expressionType(item.value)); grammar.expect(item.range.start, item.target.range.start, []); grammar.expect(item.target.range.end, item.value.range.start, ['=']);
            check(grammar.spelling(item.value.range.end, item.range.end).every(t => t === ';'), 'source');
          } else if (item.kind === 'block') {
            record(item, ['kind','range','body']); const tokens = grammar.between(item.range.start, item.range.end); check(tokens[0]?.text === '{' && tokens.at(-1)?.text === '}', 'source');
            const blockReturned = statements(item.body, { start: tokens[0].end, end: tokens.at(-1).start }, visible, new Set(initialized), scopePath + '/' + childScope++); returned ||= blockReturned;
          } else if (item.kind === 'if' || item.kind === 'while') {
            const branch = item.kind === 'if'; record(item, ['kind','range','condition', ...(branch ? ['thenBody'] : ['body'])], branch ? ['elseBody'] : []);
            const alternate = branch && item.elseBody !== undefined ? array(item.elseBody, 128) : [];
            expression(item.condition, item.range, visible, initialized); compatible(expressionType(item.condition), 'bool');
            grammar.expect(item.range.start, item.condition.range.start, [item.kind,'(']);
            const body = array(branch ? item.thenBody : item.body, 128); check(body.length === 1, 'capability'); grammar.expect(item.condition.range.end, body[0].range.start, [')']);
            const left = statements(body, { start: body[0].range.start, end: body.at(-1).range.end }, visible, new Set(initialized), scopePath + '/' + childScope++);
            let last = body.at(-1).range.end;
            if (alternate.length) { check(alternate.length === 1, 'capability'); grammar.expect(last, alternate[0].range.start, ['else']);
              const right = statements(alternate, { start: alternate[0].range.start, end: alternate.at(-1).range.end }, visible, new Set(initialized), scopePath + '/' + childScope++); returned ||= left && right; last = alternate.at(-1).range.end; }
            grammar.expect(last, item.range.end, []);
          } else failure('capability', 'unsupported owned closure statement');
        }
        previous = item.range.end;
      }
      check(grammar.spelling(previous, parent.end).every(token => token === ';'), 'source'); return returned;
    }
    const inherited = fnScopes.get(fn.symbol), initialized = new Set(fn.parameters.map(p => p.id));
    check(statements(fn.body, headers.get(fn.symbol), inherited, initialized, '0'), 'return');
    check(same(fn.captures ?? [], captures), 'capture');
  }
  const roots = functions.filter(fn => !fn.lexicalParent).sort((a,b) => a.range.start - b.range.start); let previous = 0;
  for (const fn of roots) { check(fn.range.start >= previous, 'range'); grammar.expect(previous, fn.range.start, []); previous = fn.range.end; }
  grammar.expect(previous, source.content.length, []);
  return { defs, functions: fns, locations, scopes, headers };
}
