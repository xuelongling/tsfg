// SPDX-License-Identifier: MIT
import { emitCoreSsaFunction } from './core-ssa-emitter.mjs';
import { exceptionCoreModel } from './exception-core-model.mjs';
import { sha256, i32TypeId, descriptor, coreSchemaHash, payloadTypeId, entity,
  orderedRange, publicationBudget, check } from './exception-core-common.mjs';

// Core identities/materialized metadata belong here, not in the generic SSA
// allocator. The trace is immutable data; no supplied trace is ever an input.
function materialize(model, trace) {
  const { hir, fn, hirText, semanticHirHash } = model;
  const program = entity('program', { hirSchemaHash: hir.format.schemaHash, semanticHirHash });
  const blockIds = trace.blocks.map(block => entity('block', { program, owner: fn.id, ordinal: block.ordinal }));
  const frameIds = trace.frames.map(frame => entity('frame', { program, owner: fn.id, scope: frame.scope, statement: frame.statement }));
  const values = trace.values.map(value => {
    const id = entity('value', { program, owner: fn.id, ordinal: value.ordinal, type: value.type,
      block: blockIds[value.block], definition: value.definition, index: value.index });
    return { id, ordinal: value.ordinal, owner: fn.id, type: value.type, block: blockIds[value.block],
      definition: value.definition, index: value.index, range: orderedRange(value.range) };
  });
  const valueIds = values.map(value => value.id);
  return {
    family: descriptor.marker.family, version: descriptor.marker.version, schema: coreSchemaHash,
    hir_schema: hir.format.schemaHash, hir_hash: sha256(hirText), semantic_hir_hash: semanticHirHash,
    program_id: program, hir_jcs: hirText, payload_types: [{ id: payloadTypeId, kind: 'payload', members: [i32TypeId] }],
    frames: trace.frames.map((frame, index) => ({ id: frameIds[index], owner: fn.id, scope: frame.scope,
      statement: frame.statement, try_scope: frame.try_scope, catch_scope: frame.catch_scope,
      catch_binding: frame.catch_binding, finally_scope: frame.finally_scope, range: orderedRange(frame.range) })),
    blocks: trace.blocks.map(block => ({ id: blockIds[block.ordinal], ordinal: block.ordinal, owner: fn.id,
      scope: block.scope, position: block.position, role: block.role,
      frames: block.frames.map(state => ({ frame: frameIds[state.frame], arm: state.arm })),
      pending: block.pending.map(pending => ({ scope: pending.scope, statement: pending.statement })),
      parameters: block.parameters.map(index => valueIds[index]), range: orderedRange(block.range) })),
    values,
    bindings: trace.bindings.map(binding => ({ binding: binding.binding, scope: binding.scope, kind: binding.kind,
      block: blockIds[binding.block], position: binding.position, value: valueIds[binding.value], from_binding: binding.from_binding,
      type: binding.type, writable: binding.writable, range: orderedRange(binding.range),
      initializer_range: binding.initializer_range.map(orderedRange) })),
    edges: trace.edges.map(edge => ({ id: entity('edge', { program, owner: fn.id, ordinal: edge.ordinal }),
      ordinal: edge.ordinal, owner: fn.id, from: blockIds[edge.from], to: blockIds[edge.to], kind: edge.kind,
      arguments: edge.arguments.map(index => valueIds[index]), scope: edge.scope, statement: edge.statement, range: orderedRange(edge.range) })),
  };
}
export function emitExceptionCore(input) {
  const model = exceptionCoreModel(input), { hir, fn, source } = model;
  const publication = publicationBudget();
  const coreType = type => {
    if (type === i32TypeId) return 'i32';
    check(type === payloadTypeId, 'type', 'unexpected Core value type');
    return '!tsfg_exception.payload<"' + payloadTypeId + '">';
  };
  const core = emitCoreSsaFunction(model.view, { coreType, exception: model.policy, budget: publication.budget });
  const metadata = materialize(model, core.trace);
  const moduleAttributes = {
    'tsfg_core.version': descriptor.base.core, 'tsfg_core.input_identity': hir.inputIdentity,
    'tsfg_core.source_hash': source.hash, 'tsfg_core.source_path': source.path,
    'tsfg_core.target': hir.target.target, 'tsfg_core.triple': hir.target.triple,
    'tsfg_core.data_layout': hir.target.llvmDataLayout, 'tsfg_core.bytecode_schema': descriptor.base.bytecodeSchemaHash,
    'tsfg_core.source_length': source.length, 'tsfg_core.exception': metadata,
  };
  const functionAttributes = {
    'tsfg_core.function_id': fn.id, 'tsfg_core.signature_hash': fn.signatureHash, 'tsfg_core.type_id': i32TypeId,
    'tsfg_core.function_start': fn.range.start, 'tsfg_core.function_end': fn.range.end,
    'tsfg_exception.callable_type': fn.type, 'tsfg_exception.root_scope': fn.body.scope,
  };
  const { append, attribute, quote } = publication;
  const header = append('module attributes ') + attribute(moduleAttributes) + append(' {\n');
  const parameterParts = [];
  for (const parameter of core.entryParameters) {
    if (parameterParts.length) parameterParts.push(append(', '));
    parameterParts.push(append(parameter.name + ': ' + coreType(parameter.type)));
  }
  const parameters = parameterParts.join('');
  const prefix = append('  func.func @') + quote('f' + fn.id.slice(7)) + append('(') + parameters
    + append(') -> i32 attributes ') + attribute(functionAttributes) + append(' {\n');
  // Shared SSA reserves every operation plus its LF and every block label.
  const suffix = append('  }\n}\n');
  const output = header + prefix + core.blocksText + '\n' + suffix;
  check(Buffer.byteLength(output) <= descriptor.limits.coreTextBytes, 'limit', 'Core output exceeds policy');
  return output;
}
