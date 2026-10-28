// SPDX-License-Identifier: MIT
import { canonical, own, budget, readJson, record, array, check, same, bindingFor, factsIdentity,
  referenceProfile, failure } from './reference-common.mjs';
import { verifyReferenceFacts } from './reference-facts.mjs';
import { verifyReferenceGraph } from './reference-facts-shape.mjs';
import { scalarValueType } from './reference-types.mjs';
export const referenceHirFormat = own({ family: 'tsfg.reference-hir-candidate', version: 5, semanticProfile: referenceProfile });
const operations = Object.freeze({ number: 'scalar.literal.unresolved', boolean: 'scalar.boolean', this: 'ref.this',
  reference: 'ref.parameter', assignment: 'ref.field.write', binary: 'scalar.add', 'method-call': 'ref.method.call',
  super: 'ref.super', 'super-construct': 'ref.super.construct', construct: 'ref.construct',
  'reference-identity': 'ref.identity', 'local-assignment': 'local.write' });
const sourceKinds = { ...Object.fromEntries(Object.entries(operations).map(([source, operation]) => [operation, source])), 'ref.class': 'reference',
  'local.read': 'reference', 'local.location': 'reference' };
function convertGraph(input, direction) {
  const graph = structuredClone(input), toHir = direction === 'hir';
  const symbols = new Map(graph.symbols.map(symbol => [symbol.id, symbol]));
  const types = new Map(graph.types.map(type => [type.id, type]));
  function view(value, witness) {
    if (!witness || scalarValueType(types.get(witness.sourceType))) return value;
    if (toHir) return { kind: 'ref.view', sourceType: witness.sourceType, targetType: witness.targetType,
      members: witness.members, origin: witness.origin, value };
    record(value, ['kind','sourceType','targetType','members','origin','value']);
    check(value.kind === 'ref.view' && value.sourceType === witness.sourceType && value.targetType === witness.targetType
      && same(value.members, witness.members) && same(value.origin, witness.origin), 'witness');
    check(value.value && value.value.type === witness.sourceType && same(value.value.origin, witness.origin), 'witness');
    return value.value;
  }
  function expression(value, localLocation = false) {
    if (value === null) return;
    const sourceKind = toHir ? value.kind : value.kind === 'ref.field.read' || value.kind === 'ref.field.location'
      ? 'field' : sourceKinds[value.kind];
    check(sourceKind, 'unsupported', 'unknown reference HIR operation');
    if (!toHir && sourceKind === 'reference') {
      const symbol = symbols.get(value.symbol);
      const expected = symbol?.kind === 'class' ? 'ref.class' : symbol?.kind === 'local'
        ? localLocation ? 'local.location' : 'local.read' : 'ref.parameter';
      check(value.kind === expected, localLocation || value.kind === 'local.location' ? 'location' : 'closure');
    }
    // Every conversion boundary owns its exact wrapper. Unwrap before traversing
    // children, so no unknown wrapper fields or extra references can disappear.
    if (!toHir && ['assignment','local-assignment'].includes(sourceKind)) value.right = view(value.right, value.compatibility);
    if (!toHir && ['method-call','super-construct','construct'].includes(sourceKind))
      value.arguments = value.arguments.map((argument, index) => view(argument, value.argumentCompatibility[index]));
    if (!toHir && sourceKind === 'field')
      check(value.permission?.writeUse === (value.kind === 'ref.field.location'), 'permission');
    for (const key of ['receiver','left','right']) expression(value[key], sourceKind === 'local-assignment' && key === 'left');
    for (const argument of value.arguments) expression(argument);
    if (toHir && ['assignment','local-assignment'].includes(sourceKind)) value.right = view(value.right, value.compatibility);
    if (toHir && ['method-call','super-construct','construct'].includes(sourceKind))
      value.arguments = value.arguments.map((argument, index) => view(argument, value.argumentCompatibility[index]));
    value.kind = toHir ? sourceKind === 'field'
      ? value.permission.writeUse ? 'ref.field.location' : 'ref.field.read' : operations[sourceKind] : sourceKind;
    if (toHir && sourceKind === 'reference') {
      const symbol = symbols.get(value.symbol);
      value.kind = symbol?.kind === 'class' ? 'ref.class' : symbol?.kind === 'local'
        ? localLocation ? 'local.location' : 'local.read' : 'ref.parameter';
    }
    check(value.kind, 'unsupported');
  }
  function statements(body) {
    for (const statement of array(body)) {
      record(statement, ['kind','local','expression','compatibility','origin', ...(statement.kind === 'if' ? ['branch'] : [])]);
      if (statement.kind === 'if') {
        record(statement.branch, ['condition','conditionCompatibility','then','else']);
        expression(statement.branch.condition);
        for (const block of [statement.branch.then, statement.branch.else]) {
          record(block, ['body','origin']); statements(block.body);
        }
        continue;
      }
      if (statement.kind === 'local') {
        record(statement.local, ['kind','bindings']);
        for (const binding of array(statement.local.bindings, 4096)) {
          record(binding, ['symbol','type','initializer','compatibility','origin']);
          if (!toHir) binding.initializer = view(binding.initializer, binding.compatibility);
          expression(binding.initializer);
          if (toHir) binding.initializer = view(binding.initializer, binding.compatibility);
        }
      }
      if (!toHir && statement.kind === 'return') statement.expression = view(statement.expression, statement.compatibility);
      expression(statement.expression);
      if (toHir && statement.kind === 'return') statement.expression = view(statement.expression, statement.compatibility);
    }
  }
  for (const item of graph.classes) {
    const constructor = item.constructor;
    const implicit = constructor.kind === 'implicit-derived';
    if (implicit) {
      const forward = constructor.implicitForward;
      if (toHir) forward.kind = 'ref.super.forward';
      else {
        record(forward, ['kind','target','baseSignature','parameters','origin']);
        check(forward.kind === 'ref.super.forward', 'forwarding'); delete forward.kind;
      }
    }
    const boundary = implicit ? { kind: 'successful-forward', target: constructor.implicitForward.target }
      : item.base ? { kind: 'successful-return', expressionId: constructor.superCall } : { kind: 'entry' };
    if (toHir) constructor.initializationBoundary = boundary;
    else {
      // Entering initialization does not assert a value for absent initializers.
      record(constructor.initializationBoundary, Object.keys(boundary));
      check(same(constructor.initializationBoundary, boundary), 'initialization');
      delete constructor.initializationBoundary;
    }
    for (const field of item.fields) {
      if (!toHir) field.initializer = view(field.initializer, field.initializerCompatibility);
      expression(field.initializer);
      if (toHir) field.initializer = view(field.initializer, field.initializerCompatibility);
    }
    for (const callable of [constructor, ...item.methods]) statements(callable.body);
  }
  return graph;
}
/** Independent owned HIR. Each Source field survives the lossless operation
 * mapping; reference conversions additionally contain one value in a ref.view.
 * A view changes access projection, never object identity or allocation class.
 * Cold checks reverse only these exact mappings, retain all other fields and
 * apply the complete graph verifier. This establishes no official Source trust.
 */
export function buildReferenceHir(input) {
  const facts = verifyReferenceFacts(input), graph = convertGraph(facts.graph, 'hir');
  return verifyReferenceHir({ format: referenceHirFormat,
    context: { scope: graph.scope, factsDigest: factsIdentity(facts.graph) }, sources: graph.sources,
    options: graph.options, types: graph.types, symbols: graph.symbols, classes: graph.classes });
}
export function verifyReferenceHir(hir) {
  try { return checkedHir(hir); }
  catch (error) { if (error.code?.startsWith('reference-facts-')) throw error; failure('schema'); }
}
function checkedHir(hir) {
  budget(hir);
  record(hir, ['format','context','sources','options','types','symbols','classes']);
  check(same(hir.format, referenceHirFormat), 'profile'); record(hir.context, ['scope','factsDigest']);
  const graph = convertGraph({ scope: hir.context.scope, semanticProfile: hir.format.semanticProfile,
    sources: hir.sources, options: hir.options, types: hir.types, symbols: hir.symbols, classes: hir.classes }, 'facts');
  verifyReferenceGraph(graph, bindingFor(graph));
  check(hir.context.factsDigest === factsIdentity(graph), 'identity');
  return own(hir);
}
export const printReferenceHir = hir => canonical(verifyReferenceHir(hir));
export const readReferenceHir = bytes => verifyReferenceHir(readJson(bytes));
