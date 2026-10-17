// SPDX-License-Identifier: MIT
import { nullableSnapshotFacts } from './nullable-frontend.mjs';
import { check, record, budget, same, own, candidate, valueType, scalarType, nullableType, hirFormat } from './nullable-common.mjs';

function project(snapshot) {
  const source = snapshot.source;
  const headers = snapshot.functions.map(fn => {
    const parameterTypes = fn.parameters.map(p => valueType(p.presence)), returnId = valueType(fn.returnPresence);
    const signatureHash = candidate('tsfg.core-nullable-candidate.signature.v1', { parameters: parameterTypes, returnType: returnId });
    return { source: fn, id: candidate('tsfg.core-nullable-candidate.function.v1', { name: fn.name, signatureHash,
      source: { path: source.path, digest: source.hash } }), signatureHash, parameterTypes, returnId };
  });
  const functions = headers.map(header => {
    const fn = header.source, bindings = new Map(snapshot.symbols.map(symbol => [symbol.id, symbol]));
    const lift = (value, expected) => {
      if (value.type === expected) return value;
      check(value.type === scalarType.id && expected === nullableType.id, 'signature');
      return { kind: 'nullableWrap', type: expected, operand: value, range: value.range };
    };
    function expression(raw) {
      if (raw.kind === 'reference') return { kind: 'reference', type: valueType(bindings.get(raw.symbol).presence), binding: raw.symbol, range: raw.range };
      const target = headers.find(item => item.source.symbol === raw.target);
      return { kind: 'call', type: target.returnId, target: target.id, signatureHash: target.signatureHash,
        arguments: raw.arguments.map((arg, index) => lift(expression(arg), target.parameterTypes[index])), range: raw.range };
    }
    return { id: header.id, name: fn.name, ownedSymbol: fn.symbol, signatureHash: header.signatureHash,
      role: snapshot.exports[0].target === fn.symbol ? 'entry' : 'internal', range: fn.range,
      returnType: header.returnId === scalarType.id ? scalarType : nullableType,
      parameters: fn.parameters.map((p,index) => ({ id: p.id, name: p.name, type: header.parameterTypes[index], range: p.range })),
      body: fn.body.map(item => item.kind === 'variable' ? {
        kind: 'local', binding: { id: item.symbol.id, name: item.symbol.name, type: valueType(item.symbol.presence), mutable: false, range: item.symbol.range },
        initializer: lift(expression(item.initializer), valueType(item.symbol.presence)), range: item.range,
      } : { kind: 'return', value: lift(expression(item.expression), header.returnId), range: item.range }) };
  });
  return { format: hirFormat, snapshot, inputIdentity: snapshot.inputIdentity, source, target: snapshot.target,
    types: [scalarType, nullableType], functions };
}
export function buildNullableHir(snapshot) {
  const result = project(nullableSnapshotFacts(snapshot)); budget(result); return own(result);
}
export function verifyNullableHir(hir) {
  budget(hir); record(hir, ['format','snapshot','inputIdentity','source','target','types','functions']);
  check(same(hir.format, hirFormat), 'schema');
  const expected = project(nullableSnapshotFacts(hir.snapshot));
  check(same(hir, expected), 'hir'); return own(expected);
}
