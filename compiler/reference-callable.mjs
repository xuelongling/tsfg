// SPDX-License-Identifier: MIT
import { array, record, check } from './reference-common.mjs';
import { referenceValueType } from './reference-types.mjs';
import { verifyReferenceWitness } from './reference-relations.mjs';

/** One invocation owns one callable's lexical environment. Only actual binding
 * membership establishes ownership; names and generated ID prefixes never do.
 * Initializers finish before a local becomes visible, including within one list.
 */
export function verifyReferenceCallable(state, callable, visit, constructor = false) {
  const parameters = new Map(callable.signature.parameters.map(value => [value.symbol, value]));
  const locals = new Map();
  const scope = { reference(value, write) {
    const symbol = state.symbols.get(value.symbol);
    if (symbol?.kind === 'local') {
      const binding = locals.get(value.symbol);
      check(binding, 'scope', 'local is not initialized in this callable scope', value.origin);
      check(binding.type === value.type, 'unsupported', 'local flow-type views are not consumed yet', value.origin);
      check(value.origin.source === binding.origin.source && value.origin.start >= binding.origin.end,
        'scope', 'local occurrence precedes its completed initializer', value.origin);
      check(!write || binding.kind === 'let', 'mutability', 'const local cannot be rebound', value.origin);
    } else {
      const parameter = parameters.get(value.symbol);
      check(parameter && parameter.type === value.type && ['parameter','implicit-parameter'].includes(symbol?.kind), 'closure');
      check(!write, 'mutability', 'local assignment cannot target a parameter', value.origin);
    }
  } };
  const witness = (value, source, target, origin) => verifyReferenceWitness(state, value, source, target, origin);
  function statements(body, parent, allowBranch = false) {
    let returned = false, previous = null;
    for (const statement of array(body)) {
      record(statement, ['compatibility','expression','kind','local','origin', ...(statement.kind === 'if' ? ['branch'] : [])]);
      state.origin(statement.origin, parent);
      if (statement.kind === 'if') {
        check(allowBranch && !constructor && body.length === 1, 'unsupported',
          'terminal if must be the sole method statement', statement.origin);
        check(statement.local === null && statement.expression === null && statement.compatibility === null, 'body');
        check(referenceValueType(state.types.get(callable.signature.return)), 'body', 'terminal if requires a reference return');
        const branch = statement.branch;
        record(branch, ['condition','conditionCompatibility','then','else']);
        const boolean = [...state.types.values()].find(type => type.kind === 'boolean');
        check(branch.condition && state.types.get(branch.condition.type)?.kind === 'boolean', 'condition',
          'terminal if condition requires an owned boolean type', branch.condition?.origin);
        visit(branch.condition, statement.origin, scope);
        witness(branch.conditionCompatibility, branch.condition.type, boolean.id, branch.condition.origin);
        for (const block of [branch.then, branch.else]) {
          record(block, ['body','origin']); state.origin(block.origin, statement.origin);
          const entries = array(block.body, 4096);
          check(entries.length === 1 && entries[0].kind === 'return' && entries[0].expression
            && referenceValueType(state.types.get(entries[0].expression.type)), 'body',
            'terminal if block requires exactly one reference return', block.origin);
          check(statements(entries, block.origin), 'body');
        }
        check(branch.condition.origin.end <= branch.then.origin.start && branch.then.origin.end <= branch.else.origin.start,
          'origin', 'terminal if condition and branch blocks overlap or reverse source order', statement.origin);
        returned = true; continue;
      }
      check(!returned && ['local','expression','return'].includes(statement.kind), 'body');
      if (previous) check(previous.source === statement.origin.source && previous.end <= statement.origin.start,
        'origin', 'owned statements overlap or reverse source order', statement.origin);
      previous = statement.origin;
      if (statement.kind === 'local') {
        check(!constructor, 'unsupported', 'constructor locals are not consumed yet', statement.origin);
        check(statement.expression === null && statement.compatibility === null, 'body');
        record(statement.local, ['kind','bindings']);
        check(['const','let'].includes(statement.local.kind), 'unsupported', 'only initialized const/let locals are consumed');
        const bindings = array(statement.local.bindings, 4096); check(bindings.length > 0, 'scope');
        let prior = null;
        for (const binding of bindings) {
          record(binding, ['symbol','type','initializer','compatibility','origin']);
          state.origin(binding.origin, statement.origin); state.valueType(binding.type);
          if (prior) check(prior.end <= binding.origin.start && prior.source === binding.origin.source, 'origin');
          prior = binding.origin;
          check(!parameters.has(binding.symbol) && !locals.has(binding.symbol) && binding.initializer !== null, 'scope');
          visit(binding.initializer, binding.origin, scope, false, binding.type);
          witness(binding.compatibility, binding.initializer.type, binding.type, binding.initializer.origin);
          const symbol = state.symbols.get(binding.symbol);
          state.useSymbol(binding.symbol, 'local', symbol?.name, binding.type, binding.origin);
          // An identifier anchor precedes its own initializer, without pretending
          // that the identifier span equals the entire typed declaration span.
          check(symbol.declaration.source === binding.origin.source && symbol.declaration.start === binding.origin.start
            && symbol.declaration.end <= binding.initializer.origin.start, 'origin');
          locals.set(binding.symbol, { ...binding, kind: statement.local.kind });
        }
      } else {
        check(statement.local === null, 'body');
        if (statement.expression !== null) visit(statement.expression, statement.origin, scope, false,
          statement.kind === 'return' ? callable.signature.return : '');
        if (statement.kind === 'return') {
          check(!constructor, 'unsupported', 'constructor return forms are not consumed yet', statement.origin);
          if (statement.expression === null) check(state.types.get(callable.signature.return).kind === 'void'
            && statement.compatibility === null, 'witness');
          else witness(statement.compatibility, statement.expression.type, callable.signature.return, statement.expression.origin);
          returned = true;
        } else check(statement.expression !== null && statement.compatibility === null, 'body');
      }
    }
    return returned;
  }
  const returned = statements(callable.body, callable.origin, true);
  check(constructor || state.types.get(callable.signature.return).kind === 'void' || returned, 'body');
}
