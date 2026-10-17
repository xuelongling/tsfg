// SPDX-License-Identifier: MIT
import { budget, check, record, array, same, canonical, own, sha256, origin, hirFormat, valueType, rawSignature,
  functionType, typeIdentity, signatureIdentity, functionIdentity, bindingIdentity, hash } from './closure-common.mjs';
import { verifyClosureFacts, expressionType } from './closure-facts.mjs';
import { closureSnapshotFacts } from './closure-frontend.mjs';
import bytecodeSchema from '../contracts/bytecode.schema.json' with { type: 'json' };
const target = { ...bytecodeSchema.target, pointerBits: '64' };
function projectGraph(source, functions, symbols, inputIdentity, sourceOrigin) {
  const facts = verifyClosureFacts(source, functions, symbols), ids = new Map(), pool = new Map();
  function functionId(id) {
    if (ids.has(id)) return ids.get(id);
    const fn = facts.functions.get(id), location = facts.locations.get(id);
    const owned = functionIdentity(source.path, fn.lexicalParent ? functionId(fn.lexicalParent) : null, location.scope, fn.name, functionType(fn));
    ids.set(id, owned); return owned;
  }
  for (const fn of functions) functionId(fn.symbol);
  for (const symbol of symbols) if (symbol.kind !== 'function') {
    const location = facts.locations.get(symbol.id);
    ids.set(symbol.id, bindingIdentity(functionId(location.owner), location.role, location.scope + ':' + location.index));
  }
  function intern(descriptor) {
    const id = typeIdentity(descriptor);
    if (!pool.has(id)) pool.set(id, typeof descriptor === 'string' ? { id, kind: 'scalar', name: descriptor }
      : { id, kind: 'function', parameters: descriptor.parameters.map(intern), returnType: intern(descriptor.returns) });
    return id;
  }
  const binding = symbol => ({ id: ids.get(symbol.id), owner: ids.get(facts.locations.get(symbol.id).owner), name: symbol.name,
    type: intern(valueType(symbol.type, symbol.signature)), writable: symbol.writable, range: symbol.range,
    ...(symbol.presence ? { presence: symbol.presence } : {}) });
  function expression(value) {
    const common = { kind: value.kind, type: intern(expressionType(value)), range: value.range };
    if (value.kind === 'reference') return { ...common, binding: ids.get(value.symbol) };
    if (value.kind === 'functionReference') return { ...common, target: ids.get(value.target) };
    if (['call','indirectCall'].includes(value.kind)) return { ...common,
      ...(value.kind === 'call' ? { target: ids.get(value.target) } : { callee: expression(value.callee) }),
      ...(value.signature.presence ? { parameterPresence: value.signature.presence } : {}),
      signature: intern(functionTypeFromSignature(value.signature)), signatureHash: signatureIdentity(functionTypeFromSignature(value.signature)), arguments: value.arguments.map(expression) };
    if (value.kind === 'integer') return { ...common, kind: 'constant', ...value.literal };
    if (value.kind === 'floating') return { ...common, ...value.float };
    if (value.kind === 'boolean') return { ...common, value: value.boolean };
    return { ...common, ...(value.operator ? { operator: value.operator } : {}),
      ...Object.fromEntries(['left','right','operand'].filter(key => value[key]).map(key => [key, expression(value[key])])) };
  }
  function statement(item) {
    const common = { kind: item.kind, range: item.range };
    if (item.kind === 'functionDeclaration') return { ...common, target: ids.get(item.symbol.id) };
    if (item.kind === 'variable') return { ...common, kind: 'local', binding: binding(item.symbol), initializer: expression(item.initializer) };
    if (item.kind === 'return' || item.kind === 'expression') return { ...common, value: expression(item.expression) };
    if (item.kind === 'assignment') return { ...common, kind: 'assign', target: expression(item.target), value: expression(item.value) };
    return { ...common, ...(item.condition ? { condition: expression(item.condition) } : {}),
      ...Object.fromEntries(['body','thenBody','elseBody'].filter(key => item[key]).map(key => [key, item[key].map(statement)])) };
  }
  const ownedFunctions = functions.map(fn => ({ id: ids.get(fn.symbol), name: fn.name,
    lexicalParent: fn.lexicalParent ? ids.get(fn.lexicalParent) : null, lexicalScope: facts.locations.get(fn.symbol).scope,
    definitionRange: facts.defs.get(fn.symbol).range, range: fn.range,
    signature: intern(functionType(fn)), signatureHash: signatureIdentity(functionType(fn)), returnType: intern(valueType(fn.returnType, fn.returnSignature)),
    parameters: fn.parameters.map(binding), captures: (fn.captures ?? []).map(c => ({ binding: ids.get(c.symbol), read: c.read, write: c.write })), body: fn.body.map(statement) }));
  return { format: hirFormat, inputIdentity, source: { ...source, hash: sha256(source.content) }, sourceOrigin, target,
    types: [...pool.values()].sort((a,b) => Buffer.from(a.id).compare(Buffer.from(b.id))), functions: ownedFunctions };
}
function functionTypeFromSignature(sig) {
  return { parameters: sig.parameters.map((kind,index) => valueType(kind, sig.parameterSignatures?.[index] ?? undefined)), returns: valueType(sig.returnType, sig.returnSignature) };
}
export function buildClosureHir(snapshot) {
  const facts = closureSnapshotFacts(snapshot);
  return verifyClosureHir(projectGraph(facts.source, facts.functions, facts.symbols, snapshot.inputIdentity, snapshot.sourceOrigin));
}
/** Cold verification reconstructs only this exact operation mapping, then checks
 * the complete owned graph, lexical identity and all source/type invariants.
 * There is no Source session, raw captured response or Snapshot-local ID in HIR.
 */
export function verifyClosureHir(hir) {
  budget(hir); record(hir, ['format','inputIdentity','source','sourceOrigin','target','types','functions']);
  check(same(hir.format, hirFormat) && same(hir.target, target), 'identity'); hash(hir.inputIdentity); origin(hir.sourceOrigin);
  record(hir.source, ['path','content','hash']); check(typeof hir.source.content === 'string' && hir.source.content.isWellFormed(), 'source'); check(hir.source.hash === sha256(hir.source.content), 'identity');
  const types = new Map();
  for (const item of array(hir.types)) { record(item, ['id','kind'], ['name','parameters','returnType']); hash(item.id); check(!types.has(item.id), 'identity'); types.set(item.id, item); }
  const resolved = new Map(), active = new Set();
  function descriptor(id) {
    if (resolved.has(id)) return resolved.get(id);
    const item = types.get(id); check(item && !active.has(id), 'type'); active.add(id); let value;
    if (item.kind === 'scalar') { record(item, ['id','kind','name']); value = valueType(item.name); }
    else { record(item, ['id','kind','parameters','returnType']); check(item.kind === 'function', 'type'); value = { parameters: array(item.parameters, 64).map(descriptor), returns: descriptor(item.returnType) }; }
    check(typeIdentity(value) === id, 'identity'); active.delete(id); resolved.set(id, value); return value;
  }
  for (const id of types.keys()) descriptor(id);
  const functions = array(hir.functions, 128), functionTable = new Map(), symbols = [], seenSymbols = new Set();
  const add = symbol => { check(!seenSymbols.has(symbol.id), 'identity'); seenSymbols.add(symbol.id); symbols.push(symbol); return symbol; };
  const fromBinding = binding => {
    record(binding, ['id','owner','name','type','writable','range'], ['presence']); const type = descriptor(binding.type);
    return { id: binding.id, name: binding.name, kind: 'local', type: typeof type === 'string' ? type : 'function', writable: binding.writable, range: binding.range,
      lexicalOwner: binding.owner, ...(typeof type !== 'string' ? { signature: rawSignature(type) } : {}), ...(binding.presence ? { presence: binding.presence } : {}) };
  };
  for (const fn of functions) {
    record(fn, ['id','name','lexicalParent','lexicalScope','definitionRange','range','signature','signatureHash','returnType','parameters','captures','body']);
    check(!functionTable.has(fn.id), 'identity'); const returns = descriptor(fn.returnType);
    const symbol = { id: fn.id, name: fn.name, kind: 'function', type: typeof returns === 'string' ? returns : 'function', writable: false, range: fn.definitionRange,
      ...(fn.lexicalParent !== null ? { lexicalOwner: fn.lexicalParent } : {}) };
    functionTable.set(fn.id, { fn, symbol: add(symbol), returns });
  }
  function expression(value) {
    check(value && typeof value === 'object', 'schema'); const type = descriptor(value.type); /** @type {any} */ const raw = { kind: value.kind, type: typeof type === 'string' ? type : 'function', range: value.range };
    if (typeof type !== 'string' && !['call','indirectCall'].includes(value.kind)) raw.signature = rawSignature(type);
    if (value.kind === 'reference') return { ...raw, symbol: value.binding };
    if (value.kind === 'functionReference') return { ...raw, target: value.target };
    if (['call','indirectCall'].includes(value.kind)) {
      const signature = descriptor(value.signature); check(typeof signature !== 'string' && value.signatureHash === signatureIdentity(signature), 'signature');
      return { ...raw, signature: { ...rawSignature(signature), ...(value.parameterPresence ? { presence: value.parameterPresence } : {}) }, ...(value.kind === 'call' ? { target: value.target } : { callee: expression(value.callee) }), arguments: array(value.arguments, 64).map(expression) };
    }
    if (value.kind === 'constant') return { ...raw, kind: 'integer', literal: { decimal: value.decimal, token: value.token } };
    if (value.kind === 'floating') return { ...raw, float: { bits: value.bits, token: value.token } };
    if (value.kind === 'boolean') return { ...raw, boolean: value.value };
    return { ...raw, ...(value.operator ? { operator: value.operator } : {}), ...Object.fromEntries(['left','right','operand'].filter(key => value[key]).map(key => [key, expression(value[key])])) };
  }
  function statement(item) {
    check(item && typeof item === 'object', 'schema'); const common = { kind: item.kind, range: item.range };
    if (item.kind === 'functionDeclaration') { const entry = functionTable.get(item.target); check(entry, 'symbol'); return { ...common, symbol: entry.symbol }; }
    if (item.kind === 'local') return { ...common, kind: 'variable', symbol: add(fromBinding(item.binding)), initializer: expression(item.initializer) };
    if (item.kind === 'return' || item.kind === 'expression') return { ...common, expression: expression(item.value) };
    if (item.kind === 'assign') return { ...common, kind: 'assignment', target: expression(item.target), value: expression(item.value) };
    return { ...common, ...(item.condition ? { condition: expression(item.condition) } : {}), ...Object.fromEntries(['body','thenBody','elseBody'].filter(key => item[key]).map(key => [key, array(item[key], 128).map(statement)])) };
  }
  const rawFunctions = functions.map(fn => {
    const entry = functionTable.get(fn.id), params = array(fn.parameters, 64).map(binding => { const symbol = fromBinding(binding); symbol.kind = 'parameter'; return add(symbol); });
    return { name: fn.name, symbol: fn.id, parameters: params, returnType: entry.symbol.type,
      ...(typeof entry.returns !== 'string' ? { returnSignature: rawSignature(entry.returns) } : {}),
      range: fn.range, ...(fn.lexicalParent !== null ? { lexicalParent: fn.lexicalParent } : {}),
      captures: array(fn.captures).map(c => { record(c, ['binding','read','write']); return { symbol: c.binding, read: c.read, write: c.write }; }), body: array(fn.body, 128).map(statement) };
  });
  const source = { path: hir.source.path, content: hir.source.content };
  const expected = projectGraph(source, rawFunctions, symbols, hir.inputIdentity, hir.sourceOrigin);
  check(same(hir, expected), 'hir'); return own(hir);
}
