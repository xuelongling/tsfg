// SPDX-License-Identifier: MIT
import { i32TypeId, boolTypeId, scalarName, own } from './identity.mjs';
import { scalarOperations as operations } from './scalar-operators.mjs';
import { floatNames } from './float.mjs';

const floatType = id => floatNames.includes(scalarName(id));

export const coreQuote = text => JSON.stringify(text).replace(/\\u([0-9a-f]{4})/g, (_, hex) => {
    const code = Number.parseInt(hex, 16);
    return code < 128 ? `\\${hex.slice(2)}` : String.fromCharCode(code);
  });

/** Shared scalar/closure SSA control and definition selection. Callers validate
 * their own representation. Leaf policies add actual domain operations only.
 */
export function emitCoreSsaFunction(fn, context) {
  const { verified, emittedGlobals = [], emittedHosts = [], functionSymbol } = context;
  const quote = coreQuote;
  const blocks = [], bindingTypes = new Map();
  let valueIndex = 0, current, definitions = new Map(), declared = new Set();
  const coreType = context.coreType ?? (type => type === i32TypeId ? "i32" : type === boolTypeId ? "i1" : floatType(type) ? scalarName(type) : `!tsfg_core.integer<${quote(scalarName(type))}>`);
  let reservedBodyBytes = 0;
  const variable = () => { context.budget?.register(valueIndex + 1); return `%v${valueIndex++}`; };
  const line = text => { context.budget?.line(text); reservedBodyBytes += Buffer.byteLength(text, "utf8") + 1; current.lines.push(text); };
  const newBlock = (parameterTypes = []) => {
    context.budget?.block(blocks.length + 1);
    if (!blocks.length) context.budget?.parameters(parameterTypes.length);
    const block = { name: `bb${blocks.length}`, parameters: parameterTypes.map(type => ({ name: variable(), type })), lines: [], terminated: false };
    blocks.push(block); return block;
  };
  const attrsFor = anchor => `tsfg_source.start = ${anchor.start} : i64, tsfg_source.end = ${anchor.end} : i64`;
  const edge = (block, values = []) => `^${block.name}${values.length ? `(${values.join(", ")} : ${block.parameters.map(p => coreType(p.type)).join(", ")})` : ""}`;
  const branch = (block, values, anchor) => {
    line(`    cf.br ${edge(block, values)} {${attrsFor(anchor)}}`);
    current.terminated = true;
  };
  const conditional = (condition, left, right, anchor) => {
    line(`    cf.cond_br ${condition}, ${edge(left)}, ${edge(right)} {${attrsFor(anchor)}}`);
    current.terminated = true;
  };
  const fuel = (event, anchor) => line(`    "tsfg_core.fuel"() {event = ${event} : i32, ${attrsFor(anchor)}} : () -> ()`);
  const operationLine = (result, name, operands, operandTypes, resultType, attributes, anchor) => {
    line('    ' + (result === null ? '' : result + ' = ') + '"' + name + '"(' + operands.join(', ')
      + ') {' + (attributes ? attributes + ', ' : '') + attrsFor(anchor) + '} : ('
      + operandTypes.map(coreType).join(', ') + ') -> ' + (resultType === null ? '()' : coreType(resultType)));
  };
  current = newBlock(fn.parameters.map(parameter => parameter.type));
  fn.parameters.forEach((parameter,index) => {
    definitions.set(parameter.id,current.parameters[index].name); declared.add(parameter.id);
    bindingTypes.set(parameter.id,parameter.type);
  });
  if(fn.kind!=='module-initialization'&&!context.exception)fuel(1, fn.range);
  const emit = expression => {
    context.budget?.step();
    const special = context.emitValueLeaf?.(expression, api);
    if (special !== undefined) return special;
    if (expression.kind === "reference") return definitions.get(expression.binding);
    if(expression.kind==='global') {
      const name=variable(),index=emittedGlobals.findIndex(global=>global.id===expression.global);
      line(`    ${name} = "tsfg_core.global_load"() {global = ${index} : i64, ${attrsFor(expression.range)}} : () -> ${coreType(expression.type)}`);
      return name;
    }
    if(expression.kind==='host') {
      const operands=expression.arguments.map(emit),name=variable(),index=emittedHosts.findIndex(host=>host.id===expression.target);
      line(`    ${name} = "tsfg_core.authorized_host"(${operands.join(', ')}) {host = ${index} : i64, ${attrsFor(expression.range)}} : (i32) -> i32`);
      return name;
    }
    if (expression.kind === "call") {
      const operands = expression.arguments.map(emit), target = verified.functions.find(fn => fn.id === expression.target);
      const name = variable();
      line(`    ${name} = "func.call"(${operands.join(", ")}) {callee = @${quote(functionSymbol(target))}, tsfg_core.function_id = ${quote(target.id)}, tsfg_core.signature_hash = ${quote(target.signatureHash)}, ${attrsFor(expression.range)}} : (${expression.arguments.map(argument => coreType(argument.type)).join(", ")}) -> ${coreType(expression.type)}`);
      return name;
    }
    if (expression.kind === "write") {
      const value = emit(expression.right); let target = expression.left;
      while (target.kind === "group") target = target.operand;
      definitions.set(target.binding, value); return value;
    }
    if (expression.kind === "group" || expression.kind === "unary" && expression.operator === "+" && !floatType(expression.type)) return emit(expression.operand);
    if (expression.kind === "shortCircuit") {
      const left = emit(expression.left), outer = new Map(definitions), outerDeclared = new Set(declared);
      const rhs = newBlock(), shortcut = newBlock(), join = newBlock([boolTypeId]);
      conditional(left, expression.operator === "&&" ? rhs : shortcut, expression.operator === "&&" ? shortcut : rhs, expression.range);
      current = rhs; definitions = new Map(outer); const right = emit(expression.right);
      const rhsExit = current, rhsDefinitions = new Map(definitions);
      const changed = [...outerDeclared].filter(id => rhsDefinitions.get(id) !== outer.get(id));
      for (const id of changed) join.parameters.push({ name: variable(), type: bindingTypes.get(id) });
      current = shortcut; branch(join, [left, ...changed.map(id => outer.get(id))], expression.range);
      current = rhsExit; branch(join, [right, ...changed.map(id => rhsDefinitions.get(id))], expression.range);
      current = join; definitions = new Map(outer); declared = outerDeclared;
      changed.forEach((id, index) => definitions.set(id, join.parameters[index + 1].name));
      return join.parameters[0].name;
    }
    const operands = expression.kind === "binary" ? [emit(expression.left), emit(expression.right)]
      : expression.kind === "unary" ? [emit(expression.operand)] : [];
    const name = variable(), type = coreType(expression.type);
    const constant = ["constant", "boolean", "floating"].includes(expression.kind);
    const op = constant ? "constant" : expression.kind === "binary" ? operations[expression.operator]
      : ({ "+": "pos", "-": "neg", "~": "not", "!": "bool_not" })[expression.operator];
    const valueAttr = expression.kind === "floating" ? `value = ${quote(expression.bits)}, ` : constant ? expression.kind === "constant" && expression.type !== i32TypeId
      ? `value = ${quote(expression.decimal)}, `
      : `value = ${expression.kind === "constant" ? expression.decimal : Number(expression.value)} : ${type}, ` : "";
    const operandTypes = expression.kind === "binary" ? [expression.left.type, expression.right.type]
      : expression.kind === "unary" ? [expression.operand.type] : [];
    line(`    ${name} = "tsfg_core.${op}"(${operands.join(", ")}) {${valueAttr}${attrsFor(expression.range)}} : (${operandTypes.map(coreType).join(", ")}) -> ${type}`);
    return name;
  };
  const emitBody = statements => {
    for (const statement of statements) {
      if (!current) break;
      context.budget?.step();
      if (context.emitStatementLeaf?.(statement, api)) continue;
      if (statement.kind === "local") {
        bindingTypes.set(statement.binding.id, statement.binding.type);
        declared.add(statement.binding.id);
        if (statement.initializer) {
          const value = emit(statement.initializer);
          definitions.set(statement.binding.id, value);
        }
      } else if(statement.kind==='initialize'||statement.kind==='assign'&&statement.target.kind==='global') {
        const value=emit(statement.value),global=statement.kind==='initialize'?statement.global:statement.target.global;
        const descriptor=emittedGlobals.find(item=>item.id===global),index=emittedGlobals.indexOf(descriptor);
        line(`    "tsfg_core.global_store"(${value}) {global = ${index} : i64, initialize = ${statement.kind==='initialize'?'true':'false'}, ${attrsFor(statement.range)}} : (${coreType(descriptor.type)}) -> ()`);
      } else if (statement.kind === "assign") {
        let target = statement.target; while (target.kind === "group") target = target.operand;
        const value = emit(statement.value);
        definitions.set(target.binding, value);
      }
      else if(statement.kind==='expression')emit(statement.value);
      else if (statement.kind === "return") {
        const result = emit(statement.value), type = coreType(fn.returnType.id);
        line(`    "func.return"(${result}) {${attrsFor(statement.range)}} : (${type}) -> ()`);
        current.terminated = true; current = null;
      } else if (statement.kind === "block") {
        const outer = new Set(declared);
        emitBody(statement.body);
        definitions = new Map([...definitions].filter(([id]) => outer.has(id)));
        declared = outer;
      } else if (statement.kind === "if") {
        const condition = emit(statement.condition), outer = new Map(definitions), outerDeclared = new Set(declared);
        const yes = newBlock(), no = newBlock();
        conditional(condition, yes, no, statement.condition.range);
        current = yes; definitions = new Map(outer); emitBody(statement.thenBody);
        const yesExit = current, yesDefinitions = new Map(definitions);
        current = no; definitions = new Map(outer); declared = new Set(outerDeclared); emitBody(statement.elseBody);
        const noExit = current, noDefinitions = new Map(definitions);
        const keys = [...outerDeclared].filter(id => (!yesExit || yesDefinitions.has(id)) && (!noExit || noDefinitions.has(id)));
        if (yesExit || noExit) {
          const join = newBlock(keys.map(id => bindingTypes.get(id)));
          if (yesExit) { current = yesExit; branch(join, keys.map(id => yesDefinitions.get(id)), statement.range); }
          if (noExit) { current = noExit; branch(join, keys.map(id => noDefinitions.get(id)), statement.range); }
          current = join; definitions = new Map(keys.map((id, index) => [id, join.parameters[index].name]));
        } else { current = null; definitions = outer; }
        declared = outerDeclared;
      } else if (statement.kind === "while") {
        const outer = new Map(definitions), outerDeclared = new Set(declared), keys = [...outer.keys()];
        const header = newBlock(keys.map(id => bindingTypes.get(id)));
        branch(header, keys.map(id => outer.get(id)), statement.condition.range);
        current = header; definitions = new Map(keys.map((id, index) => [id, header.parameters[index].name]));
        fuel(2, statement.condition.range);
        const condition = emit(statement.condition), incoming = new Map(definitions);
        const loop = newBlock(), exit = newBlock();
        conditional(condition, loop, exit, statement.condition.range);
        current = loop; definitions = new Map(incoming); emitBody(statement.body);
        if (current) branch(header, keys.map(id => definitions.get(id)), statement.condition.range);
        current = exit; definitions = incoming; declared = outerDeclared;
      }
    }
  };
  // Exception control is planned here, beside the existing SSA definitions and
  // allocators. The adapter receives only a frozen trace after the graph closes.
  const emitExceptionalBody = () => {
    const policy = context.exception;
    /** @type {any[]} */ const queue = [];
    /** @type {any} */ const trace = { frames: [], blocks: [], values: [], bindings: [], edges: [] };
    const ordinal = value => Number(value.slice(2));
    const record = (items, value) => { context.budget?.step(); items.push(value); };
    const value = (name, type, block, definition, index, anchor) => record(trace.values,
      { ordinal: ordinal(name), type, block: blocks.indexOf(block), definition, index, range: anchor });
    const binding = (item, region, block, position, name, initializer = null) => record(trace.bindings,
      { binding: item.id, scope: region.scope, kind: item.role, block: blocks.indexOf(block), position,
        value: ordinal(name), from_binding: initializer?.binding ?? '', type: item.type, writable: item.writable,
        range: item.range, initializer_range: initializer ? [initializer.range] : [] });
    const task = (region, position, role, frame, pending, incoming, carry = false, resumes = [], caught = null, existing = null) => {
      context.budget?.step();
      const block = existing ?? newBlock(carry ? [policy.carrierType] : []);
      const item = { block, region, position, role, frame, pending, definitions: new Map(incoming), resumes, caught, operations: [] };
      record(trace.blocks, { ordinal: blocks.indexOf(block), scope: region.scope, position, role,
        frames: frame ? [{ frame: frame.index, arm: frame.arm }] : [],
        pending: pending ? [{ scope: pending.scope, statement: pending.statement }] : [],
        parameters: block.parameters.map(parameter => ordinal(parameter.name)), range: region.range });
      if (carry) value(block.parameters[0].name, policy.carrierType, block, 'blockArgument', 0, region.range);
      queue.push(item); return item;
    };
    const transfer = (from, target, arguments_, kind, origin) => {
      context.budget?.edge?.(trace.edges.length + 1);
      record(trace.edges, { ordinal: trace.edges.length, from: blocks.indexOf(from.block), to: blocks.indexOf(target.block),
        kind, arguments: arguments_.map(ordinal), scope: origin.scope, statement: origin.statement, range: origin.range });
      record(from.operations, { kind: 'branch', target: target.block, arguments: arguments_, range: origin.range });
      from.block.terminated = true;
    };
    const root = task(fn.region, 0, 'entry', null, null, definitions, false, [], null, current);
    record(root.operations, { kind: 'fuel', range: fn.range });
    fn.parameters.forEach((parameter, index) => {
      const name = current.parameters[index].name;
      value(name, parameter.type, current, 'parameter', index, parameter.range);
      binding(parameter, fn.region, current, 0, name);
    });
    const escape = pending => task(fn.region, 0, 'escape', null, pending, new Map(), true);
    for (let next = 0; next < queue.length; next++) {
      context.budget?.step(); const item = queue[next]; current = item.block;
      definitions = new Map(item.definitions); declared = new Set(definitions.keys());
      let carrier = item.block.parameters[0]?.name;
      if (item.caught) {
        definitions.set(item.caught.id, carrier); declared.add(item.caught.id);
        bindingTypes.set(item.caught.id, item.caught.type);
        binding(item.caught, item.region, current, 0, carrier);
      }
      if (item.role === 'escape') {
        record(item.operations, { kind: 'escape', operand: carrier, range: item.pending.range });
        current.terminated = true; continue;
      }
      for (let index = item.position; index < item.region.body.length; index++) {
        context.budget?.step(); const statement = item.region.body[index];
        const origin = { scope: item.region.scope, statement: index, range: statement.range };
        if (statement.kind === 'local') {
          const name = definitions.get(statement.initializer.binding);
          if (typeof name !== 'string') throw new TypeError('r03-hir-cfg: missing reached alias definition');
          definitions.set(statement.binding.id, name); declared.add(statement.binding.id);
          bindingTypes.set(statement.binding.id, statement.binding.type);
          binding(statement.binding, item.region, current, index, name, statement.initializer);
        } else if (statement.kind === 'block') {
          const normal = item.frame?.arm === 'finally';
          const resumes = normal ? [...item.resumes, { region: item.region, position: index + 1,
            definitions: new Map(definitions), origin }] : [];
          const target = task(statement.region, 0, 'region', item.frame, item.pending, definitions, normal, resumes);
          transfer(item, target, normal ? [carrier] : [], 'enter', origin); break;
        } else if (statement.kind === 'try') {
          const frame = { index: trace.frames.length, arm: 'try', statement,
            definitions: new Map(definitions), scope: item.region.scope, position: index };
          record(trace.frames, { scope: item.region.scope, statement: index, try_scope: statement.tryRegion.scope,
            catch_scope: statement.catchClause?.region.scope ?? '', catch_binding: statement.catchClause?.binding ?? '',
            finally_scope: statement.finallyRegion?.scope ?? '', range: statement.range });
          const target = task(statement.tryRegion, 0, 'region', frame, null, frame.definitions);
          transfer(item, target, [], 'enter', origin); break;
        } else if (statement.kind === 'throw') {
          carrier = definitions.get(statement.value.binding);
          if (typeof carrier !== 'string') throw new TypeError('r03-hir-cfg: missing reached throw definition');
          if (statement.value.type === i32TypeId) {
            const packed = variable();
            value(packed, policy.carrierType, current, 'pack', item.operations.length, statement.value.range);
            record(item.operations, { kind: 'pack', result: packed, operand: carrier, range: statement.value.range }); carrier = packed;
          }
          const frame = item.frame; let target, kind;
          if (frame?.arm === 'try' && frame.statement.catchClause) {
            const clause = frame.statement.catchClause;
            target = task(clause.region, 0, 'region', { ...frame, arm: 'catch' }, null, frame.definitions, true, [],
              clause.binding === null ? null : clause.region.bindings.find(binding => binding.id === clause.binding));
            kind = 'catch';
          } else if (frame && frame.statement.finallyRegion) {
            target = task(frame.statement.finallyRegion, 0, 'region', { ...frame, arm: 'finally' }, origin, frame.definitions, true);
            kind = 'finally';
          } else { target = escape(origin); kind = 'escape'; }
          transfer(item, target, [carrier], kind, origin); break;
        }
      }
      if (current.terminated) continue;
      if (item.frame?.arm !== 'finally' || !item.pending)
        throw new TypeError('r03-hir-cfg: reachable exception function fallthrough');
      if (item.resumes.length) {
        const resume = item.resumes.at(-1);
        const target = task(resume.region, resume.position, 'continuation', item.frame, item.pending,
          resume.definitions, true, item.resumes.slice(0, -1));
        transfer(item, target, [carrier], 'resume', resume.origin);
      } else transfer(item, escape(item.pending), [carrier], 'escape', item.pending);
    }
    // No serialization takes place until every route, scope and SSA definition
    // has been selected. The same formatters and private allocators serve both paths.
    for (const item of queue) {
      current = item.block;
      for (const operation of item.operations) {
        if (operation.kind === 'fuel') fuel(1, operation.range);
        else if (operation.kind === 'branch') branch(operation.target, operation.arguments, operation.range);
        else if (operation.kind === 'pack') operationLine(operation.result, policy.packOperation, [operation.operand],
          [i32TypeId], policy.carrierType, policy.packAttributes, operation.range);
        else operationLine(null, policy.escapeOperation, [operation.operand], [policy.carrierType], null, '', operation.range);
      }
    }
    current = null; return own(trace);
  };
  /** Merge a value without exposing blocks or definition state to leaf policies.
   * @param {string | null} condition
   * @param {string} resultType
   * @param {{start: number, end: number}} anchor
   * @param {() => string | null | undefined} onTrue
   * @param {() => string | null | undefined} onFalse
   */
  const branchValue = (condition, resultType, anchor, onTrue, onFalse) => {
    context.budget?.step();
    if (!current || current.terminated || typeof condition !== "string" || !condition)
      throw new TypeError("r03-hir-cfg: branch value requires a live condition");
    const outer = new Map(definitions), outerDeclared = new Set(declared);
    const yes = newBlock(), no = newBlock(), join = newBlock([resultType]);
    conditional(condition, yes, no, anchor);
    const arm = (block, callback) => {
      current = block; definitions = new Map(outer); declared = new Set(outerDeclared);
      const value = callback();
      if (!current || current.terminated || typeof value !== "string" || !value)
        throw new TypeError("r03-hir-cfg: branch value requires both exits and values");
      return { exit: current, value, definitions: new Map(definitions), declared: new Set(declared) };
    };
    const left = arm(yes, onTrue), right = arm(no, onFalse);
    const changed = [...outerDeclared].filter(id => left.definitions.get(id) !== outer.get(id)
      || right.definitions.get(id) !== outer.get(id));
    for (const id of changed) {
      if (!left.declared.has(id) || !right.declared.has(id) || !bindingTypes.has(id)
          || typeof left.definitions.get(id) !== "string" || typeof right.definitions.get(id) !== "string")
        throw new TypeError("r03-hir-cfg: branch value lost an outer binding");
      join.parameters.push({ name: variable(), type: bindingTypes.get(id) });
    }
    current = left.exit; branch(join, [left.value, ...changed.map(id => left.definitions.get(id))], anchor);
    current = right.exit; branch(join, [right.value, ...changed.map(id => right.definitions.get(id))], anchor);
    current = join; definitions = new Map(outer); declared = outerDeclared;
    changed.forEach((id, index) => definitions.set(id, join.parameters[index + 1].name));
    return join.parameters[0].name;
  };
  const api = {
    emit, coreType, attrsFor, quote, branchValue, lookup: id => definitions.get(id),
    operation: (name, operands, operandTypes, resultType, attributes, anchor) => {
      const result = resultType === null ? null : variable();
      operationLine(result, name, operands, operandTypes, resultType, attributes, anchor);
      return result;
    },
  };
  const trace = context.exception ? emitExceptionalBody() : undefined;
  if (!context.exception) emitBody(fn.body);
  if(fn.kind==='module-initialization'&&current) {
    const name=variable();
    line(`    ${name} = "tsfg_core.constant"() {value = 0 : i32, ${attrsFor(fn.range)}} : () -> i32`);
    line(`    "func.return"(${name}) {${attrsFor(fn.range)}} : (i32) -> ()`);
    current.terminated=true;current=null;
  }
  if (current || blocks.some(block => !block.terminated)) throw new TypeError("r03-hir-cfg: reachable function fallthrough");
  const type = coreType(fn.returnType.id);
  const text = blocks.map((block, index) => {
    const label = index ? '  ^' + block.name + (block.parameters.length
      ? '(' + block.parameters.map(p => p.name + ': ' + coreType(p.type)).join(', ') + ')' : '') + ':\n' : '';
    if (context.exception && index) context.budget?.label?.(label);
    return label + block.lines.join('\n');
  }).join('\n');
  return { entryParameters: blocks[0].parameters, blocksText: text, resultType: type, coreType, reservedBodyBytes, ...(trace ? { trace } : {}) };
}
